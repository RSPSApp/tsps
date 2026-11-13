// Run after `yarn build`: node --test tests/bank-collect.test.cjs
//
// The ways into the Grand Exchange collection box (Wiki: Bank, "Collection"; Banker; Bank chest): Collect on
// every NPC and loc that also banks, whatever its name, and a bank NPC's "I'd like to collect items."; a locked
// Bank PIN asks first under the Grand Exchange's title and the right PIN opens the box at once. The
// "I'd like to access my bank account, please." choice opens the bank from any bank NPC, and a banker whose
// transcript lacks it is offered "I'd like to buy more bank slots.". Real plugins, a real Player, native
// packets through ClientConnection.dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");

const HOME = [3185, 3444];
const GE_COLLECT = 402;
const KEYPAD = 213;
const BANK = 12;
let core, C, PinCommon, next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  C = core.CacheDefinitions;
  PinCommon = require("../plugins/interface/bankpin/Common.BankPin");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, npcName) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("bcollect" + p.getIndex()); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0)); p.needsPlacement = false;
  const strings = [];
  const sender = p.getPacketSender(), sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, ...rest) => { strings.push(String(text)); return sendString(text, ...rest); });
  const c = new ClientConnection(channel); c.player = p;
  let npc = null;
  if (npcName) {
    npc = core.NPC.create(typeof npcName === "number" ? npcName : C.getNpcId(npcName), new core.Location(HOME[0] + 2, HOME[1], 0));
    core.World.getNpcs().add(npc);
  }
  t.after(() => {
    if (npc) core.World.getNpcs().remove(npc);
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, npc, strings };
}

async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); }
function drain(f, ticks = 6) {
  for (let i = 0; i < ticks; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); }
}
async function op(f, option) {
  const clickType = f.npc.getCurrentDefinition(f.p).getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `${option} is offered`);
  await send(f, { type: "npc_option", index: f.npc.getIndex(), clickType });
  drain(f);
}
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
/** Talk-to, then past the greeting to the first choice. */
async function talk(f) {
  await op(f, "Talk-to");
  for (let i = 0; i < 6 && !pending(f); i++) { f.p.getDialogueManager().advance(); drain(f, 1); }
  assert.ok(pending(f), "the banker asks");
  return pending(f).options;
}
async function choose(f, text) {
  const index = pending(f).options.indexOf(text);
  assert.ok(index >= 0, `"${text}" is offered`);
  await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
  drain(f, 2);
}
function lockPin(f, pin = "2468") {
  PinCommon.set(f.p, "hash", PinCommon.hash(f.p, pin));
}
function enterPin(f, pin) {
  const action = f.p.getEnteredAmountAction?.() ?? f.p.enteredAmountAction;
  assert.ok(action, "the keypad waits");
  action.execute(Number(pin));
}

// Gnome, Ghost (3003), Nardah (4762) and Sirsal (3843) bankers, and the Ferox Enclave's Banker.
for (const name of ["gnomebanker", 3003, 4762, 3843, "wildy_hub_banker"]) {
  test(`Collect on ${name} opens the collection box`, async (t) => {
    const f = actor(t, name);
    await op(f, "Collect");
    assert.equal(f.p.getInterfaceId(), GE_COLLECT);
  });
}

test("Collect on an NPC that doesn't bank is left to its own plugin", async (t) => {
  const f = actor(t);
  const definition = { getName: () => "Someone", getActions: () => ["Talk-to", null, "Collect", null, null] };
  const event = { player: f.p, npc: {}, definition, npcId: 1, npcIndex: 1, clickType: 3, location: { x: 0, y: 0, z: 0 }, handled: false };
  PM.emitNpcInteraction(event);
  assert.notEqual(f.p.getInterfaceId(), GE_COLLECT);
});

test("Collect on the Emir's Arena bank chest (Open chest) and other banking locs opens the collection box", async (t) => {
  for (const loc of ["duel_chestopen", "bank_buffalo", "bankbooth", "bank_chest"]) {
    const f = actor(t);
    const id = C.getLocId(loc);
    const object = new GameObject(id, new core.Location(HOME[0] + 1, HOME[1], 0), 10, 0, null);
    const definition = object.getDefinition();
    const clickType = definition.getInteractions().indexOf("Collect") + 1;
    assert.ok(clickType > 0, `${loc} offers Collect`);
    // The packet listener passes the option lower-cased.
    const event = { player: f.p, object, definition, objectId: id, clickType, option: "collect", location: { x: HOME[0] + 1, y: HOME[1], z: 0 }, handled: false };
    assert.equal(PM.emitObjectInteraction(event), true, `${loc} handled`);
    assert.equal(f.p.getInterfaceId(), GE_COLLECT, loc);
  }
});

test("a locked PIN asks under the Grand Exchange's title before the collection box; the right PIN opens it at once", async (t) => {
  const f = actor(t, "banker1_new");
  lockPin(f);
  await op(f, "Collect");
  assert.equal(f.p.getInterfaceId(), KEYPAD);
  assert.ok(f.strings.includes("Grand Exchange"), "the keypad's title");
  enterPin(f, "2468");
  assert.equal(f.p.getInterfaceId(), GE_COLLECT, "the same tick");
  f.p.getPacketSender().sendInterfaceRemoval();
  await op(f, "Collect");
  assert.equal(f.p.getInterfaceId(), GE_COLLECT, "entered once for the session");
});

test("the Banker's \"I'd like to collect items.\" opens the collection box", async (t) => {
  const f = actor(t, "banker1_new");
  await talk(f);
  await choose(f, "I'd like to collect items.");
  assert.equal(f.p.getInterfaceId(), GE_COLLECT);
});

test("a Gnome banker's \"I'd like to access my bank account, please.\" opens the bank", async (t) => {
  const f = actor(t, "gnomebanker");
  await talk(f);
  await choose(f, "I'd like to access my bank account, please.");
  assert.equal(f.p.getInterfaceId(), BANK);
});

test("the Ferox Enclave banker offers bank slots between collecting and its own question, as live", async (t) => {
  const f = actor(t, "wildy_hub_banker");
  assert.deepEqual(await talk(f), [
    "I'd like to access my bank account, please.",
    "I'd like to check my PIN settings.",
    "I'd like to collect items.",
    "I'd like to buy more bank slots.",
    "What are you doing out here?",
  ]);
  await choose(f, "I'd like to buy more bank slots.");
  for (let i = 0; i < 4 && f.p.getInterfaceId() !== 947; i++) { f.p.getDialogueManager().advance(); drain(f, 1); }
  assert.equal(f.p.getInterfaceId(), 947, "the purchase list");
});
