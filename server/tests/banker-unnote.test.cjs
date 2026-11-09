// Run after `yarn build`: node --test tests/banker-unnote.test.cjs
//
// A banknote used on a banker, against rsprox_transcripts/226/01645.txt (a normal world, Varrock west bank):
// "Un-note the banknotes?" Yes|No; 3 wool notes with 2 free slots all come back (the note's slot is reused), with
// "The bank exchanges your banknotes for items."; 10 anglerfish notes with 1 free slot give one, with "...your
// banknote for an item."; with no room the banker says "You don't have any inventory space." and asks nothing.
// Real plugins, a real Player and Inventory, native packets through ClientConnection.dispatch.
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

const HOME = [3185, 3444];
let core, I, next = 9940;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("unnote" + p.getIndex()); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0)); p.needsPlacement = false;
  const lines = [];
  const sender = p.getPacketSender(), sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, ...rest) => { lines.push(String(text)); return sendString(text, ...rest); });
  const anims = [];
  const sendAnim = sender.sendInterfaceAnimation.bind(sender);
  t.mock.method(sender, "sendInterfaceAnimation", (uid, anim, ...rest) => { anims.push(anim); return sendAnim(uid, anim, ...rest); });
  const c = new ClientConnection(channel); c.player = p;
  const banker = core.NPC.create(core.CacheDefinitions.getNpcId("banker1_new"), new core.Location(HOME[0] + 2, HOME[1], 0));
  core.World.getNpcs().add(banker);
  t.after(() => {
    core.World.getNpcs().remove(banker);
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, banker, inv: p.getInventory(), lines, anims };
}

async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); }
function drain(f) {
  for (let i = 0; i < 6; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); }
}
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
const answer = (f, option) => send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option });
const note = (id) => core.ItemDefinition.forId(id).getNoteId();

/** Fills every slot but `free`, with the notes in `slot`. */
function setUp(f, id, amount, slot, free) {
  for (let i = 0; i < f.inv.capacity(); i++) f.inv.setItem(i, new core.Item(I.RAKE, 1));
  f.inv.setItem(slot, new core.Item(note(id), amount));
  for (let i = 0; i < free; i++) f.inv.setItem(f.inv.capacity() - 1 - i, new core.Item(-1, 0));
  f.inv.refreshItems();
}
async function use(f, slot) {
  await send(f, { type: "item_on_npc", targetIndex: f.banker.getIndex(), itemId: f.inv.getItems()[slot].getId(), slot, widgetId: 149 << 16 });
  drain(f);
}

test("3 wool notes, 2 free slots: Yes un-notes all three (the note's slot too), plural line", async (t) => {
  const f = actor(t);
  setUp(f, I.WOOL, 3, 16, 2);
  await use(f, 16);
  assert.equal(pending(f)?.title, "Un-note the banknotes?");
  assert.deepEqual(pending(f).options, ["Yes", "No"]);
  await answer(f, 1);
  drain(f);
  assert.equal(f.inv.getAmount(I.WOOL), 3);
  assert.equal(f.inv.getAmount(note(I.WOOL)), 0);
  assert.equal(f.inv.getItems()[16].getId(), I.WOOL, "the note's slot takes one");
  assert.ok(f.lines.includes("The bank exchanges your banknotes for items."), f.lines.join(" / "));
});

test("10 anglerfish notes, 1 free slot: one comes back, singular line; No changes nothing", async (t) => {
  const f = actor(t);
  setUp(f, I.ANGLERFISH, 10, 26, 1);
  await use(f, 26);
  await answer(f, 1);
  drain(f);
  assert.equal(f.inv.getAmount(I.ANGLERFISH), 1);
  assert.equal(f.inv.getAmount(note(I.ANGLERFISH)), 9);
  assert.ok(f.lines.includes("The bank exchanges your banknote for an item."), f.lines.join(" / "));

  const no = actor(t);
  setUp(no, I.ANGLERFISH, 10, 26, 1);
  await use(no, 26);
  await answer(no, 2);
  drain(no);
  assert.equal(no.inv.getAmount(note(I.ANGLERFISH)), 10);
  assert.equal(no.inv.getAmount(I.ANGLERFISH), 0);
});

test("no room: the banker says so and asks nothing", async (t) => {
  const f = actor(t);
  setUp(f, I.ANGLERFISH, 9, 26, 0);
  await use(f, 26);
  assert.equal(pending(f), null);
  assert.ok(f.lines.includes("You don't have any inventory space."), f.lines.join(" / "));
  assert.ok(f.anims.includes(610), `chatsad1, as recorded: ${f.anims}`);
  assert.equal(f.inv.getAmount(note(I.ANGLERFISH)), 9);
});

test("an unnoted item that isn't currency: the banker's line, nothing taken (tick 4882, a Mort myre pear)", async (t) => {
  const f = actor(t);
  for (let i = 0; i < f.inv.capacity(); i++) f.inv.setItem(i, new core.Item(-1, 0));
  f.inv.setItem(0, new core.Item(I.RAKE, 1));
  f.inv.refreshItems();
  await use(f, 0);
  assert.equal(pending(f), null);
  assert.ok(f.lines.includes("Hand me a banknote, and I'll try to convert it to an item."), f.lines.join(" / "));
  assert.ok(f.anims.includes(611), `chatsad2, as recorded: ${f.anims}`);
  assert.equal(f.inv.getAmount(I.RAKE), 1);
});
