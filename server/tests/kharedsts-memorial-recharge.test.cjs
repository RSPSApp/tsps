// Run from server after build: node --test tests/kharedsts-memorial-recharge.test.cjs
// Real map, Player/Inventory/Equipment, native object/dialogue packets, Bank transfer and PlayerSave.
// Only transport and dialogue text capture are stubbed; rendered-client QA is separate.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const MEMORIAL = [1520, 3478, 0];
const BESIDE = [1520, 3477, 0];
const RECORDED = "'Obey the <col=800080>Laws<col=000000> of your <col=800080>Body<col=000000>, "
  + "<col=800080>Mind<col=000000> and <col=800080>Soul<col=000000>.' - King Kharedst IV";

let core;
let memorialId;
let next = 9850;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  for (const name of ["areas/KourendWoodland", "items/KourendTravelItems", "items/RunePouch"]) {
    require(`../plugins/${name}.plugin`).register(PM.createApi(name));
  }
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(MEMORIAL[0], MEMORIAL[1]);
  PM.emitServerStartup({});
  memorialId = core.CacheDefinitions.getLocId("kourendwoodland_statue");
});
after(() => PM.emitServerShutdown({}));

function actor(t, at) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("memorialqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  core.World.getPlayers().add(p);
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const boxes = [];
  const flags = [];
  const sender = p.getPacketSender();
  const sendFlags = sender.sendInterfaceFlagsRange.bind(sender);
  t.mock.method(sender, "sendInterfaceFlagsRange", (...args) => { flags.push(args); return sendFlags(...args); });
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  const dialogues = p.getDialogueManager();
  const start = dialogues.startDialogues.bind(dialogues);
  t.mock.method(dialogues, "startDialogues", (chain) => {
    for (const box of chain.dialogues.values()) if (box.text != null) boxes.push({ type: box.constructor.name, text: String(box.text) });
    return start(chain);
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.World.getPlayers().remove(p);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, messages, boxes, flags };
}

function tick(f) {
  core.World.processCycle++;
  core.TaskManager.process();
  f.c.processTurnPackets();
  f.p.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.p.getIndex());
  f.p.getSession().flushClient(core.World.processCycle);
  f.p.resetUpdating();
}

test("the map has the Old Memorial, offering Inspect", () => {
  const definition = core.ObjectDefinition.forId(memorialId);
  assert.equal(definition.getName(), "Old Memorial");
  const found = core.MapObjects.get(memorialId, new core.Location(...MEMORIAL), null);
  assert.ok(found, "loc 31714 stands at 1520,3478");
});

test("Inspect opens the recorded inscription in a message box", async (t) => {
  const f = actor(t, BESIDE);
  await f.c.dispatch([{ type: "object_option", id: memorialId, x: MEMORIAL[0], y: MEMORIAL[1], clickType: 1 }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 3 && f.boxes.length === 0; i++) tick(f);
  assert.deepEqual(f.boxes, [{ type: "StatementDialogue", text: RECORDED }]);
  assert.ok(!f.messages.includes("Nothing interesting happens."), JSON.stringify(f.messages));
});

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 3; i++) tick(f);
}
const choose = (f, n) => send(f, { type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: n });
async function inspect(f) {
  await send(f, { type: "object_option", id: memorialId, x: MEMORIAL[0], y: MEMORIAL[1], clickType: 1 });
  const widgetId = core.CacheDefinitions.getComponentId("messagebox:continue");
  assert.ok(f.flags.some((args) => args[0] === widgetId && args[1] === -1 && args[2] === -1 && args[3] === 1),
    "the active messagebox Continue receives native pause flags");
  await send(f, { type: "dialogue_continue", widgetId, childIndex: -1 });
}
function book(f, amount = 32) {
  f.p.getInventory().addItem(new core.Item(25818, 1));
  f.p.setAttribute("kharedst-memoirs:charges", amount);
}
test("native Inspect Continue offers the recorded recharge menu, then the missing-runes message", async (t) => {
  const f = actor(t, BESIDE);
  book(f);
  await inspect(f);
  assert.deepEqual(core.MultiChatboxPrompt.getPending(f.p)?.options, ["Recharge the Book of the Dead.", "Do nothing."]);
  await choose(f, 1);
  assert.equal(f.boxes.at(-1).text, "To charge the Book of the Dead you need Law Runes, Body<br>Runes, Mind Runes and Soul Runes.");
});

const Travel = require("../plugins/items/KourendTravelItems.plugin");
const Pouch = require("../plugins/items/runepouch/Common.RunePouch");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");
const runeIds = () => [core.ItemIdentifiers.LAW_RUNE, core.ItemIdentifiers.BODY_RUNE,
  core.ItemIdentifiers.MIND_RUNE, core.ItemIdentifiers.SOUL_RUNE];
function runes(f, amounts) {
  runeIds().forEach((id, i) => { if (amounts[i]) f.p.getInventory().addItem(new core.Item(id, amounts[i])); });
}
const charges = (f) => Number(f.p.getAttribute("kharedst-memoirs:charges"));
const xp = (f) => f.p.getSkillManager().getExperience(core.Skill.MAGIC);
async function quantities(f) { await inspect(f); await choose(f, 1); }

test("recorded 32/250 menu; five charges spend four distinct costs and grant base 50 Magic XP once", async (t) => {
  const f = actor(t, BESIDE); book(f); runes(f, [12, 13, 14, 15]);
  const before = xp(f);
  await quantities(f);
  assert.deepEqual(core.MultiChatboxPrompt.getPending(f.p), {
    title: "The Book of the Dead currently has 32/250 charges.",
    options: ["Add 1 charge.", "Add 5 charges.", "Add 10 charges.", "Add 218 charges.", "Do nothing."],
  });
  await choose(f, 2);
  assert.equal(charges(f), 37);
  assert.deepEqual(runeIds().map((id) => f.p.getInventory().getAmount(id)), [7, 8, 9, 10]);
  assert.equal(xp(f) - before, 50 * GameConstants.EXPERIENCE_MULTIPLIER);
  await choose(f, 2);
  assert.equal(charges(f), 37, "duplicate native selection does not recharge again");
  await quantities(f); await choose(f, 1);
  assert.equal(charges(f), 38, "a fresh inspection can recharge again");
});

test("remaining capacity and unequal supply bound actual charges and XP", async (t) => {
  const f = actor(t, BESIDE); book(f, 248); runes(f, [20, 20, 20, 20]);
  await quantities(f); await choose(f, 3);
  assert.equal(charges(f), 250);
  assert.deepEqual(runeIds().map((id) => f.p.getInventory().getAmount(id)), [18, 18, 18, 18]);
  const g = actor(t, BESIDE); book(g); runes(g, [12, 3, 8, 20]);
  const before = xp(g);
  await quantities(g); await choose(g, 4);
  assert.equal(charges(g), 35);
  assert.equal(xp(g) - before, 30 * GameConstants.EXPERIENCE_MULTIPLIER);
});

test("pouch-only with full pack and mixed inventory/pouch supplies use actual runes", async (t) => {
  for (const mixed of [false, true]) {
    const f = actor(t, BESIDE); book(f);
    f.p.getInventory().addItem(new core.Item(core.ItemIdentifiers.DIVINE_RUNE_POUCH, 1));
    for (const id of runeIds()) Pouch.store(f.p, id, 8);
    if (mixed) runes(f, [2, 1, 4, 0]);
    else while (f.p.getInventory().getFreeSlots() > 0) f.p.getInventory().addItem(new core.Item(core.ItemIdentifiers.LOGS, 1));
    await quantities(f); await choose(f, 2);
    assert.equal(charges(f), 37);
    assert.deepEqual(runeIds().map((id) => Pouch.amountOf(f.p, id)), mixed ? [5, 4, 7, 3] : [3, 3, 3, 3]);
    assert.deepEqual(runeIds().map((id) => f.p.getInventory().getAmount(id)), [0, 0, 0, 0]);
  }
});

test("saved pouch runes without a carried pouch cannot charge", async (t) => {
  const f = actor(t, BESIDE); book(f);
  f.p.setAttribute(Pouch.RUNES_ATTRIBUTE, runeIds().map((id) => [id, 20]));
  await quantities(f);
  assert.equal(charges(f), 32);
  assert.match(f.boxes.at(-1).text, /you need Law Runes/);
});

test("cancel, replacement dialogue, travel and removed book invalidate native callbacks", async (t) => {
  for (const action of ["cancel", "replace", "travel", "remove", "death", "logout"]) {
    const f = actor(t, BESIDE); book(f); runes(f, [20, 20, 20, 20]);
    await quantities(f);
    if (action === "cancel") await choose(f, 5);
    if (action === "replace") f.p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, "Other dialogue.")));
    if (action === "travel") f.p.moveTo(new core.Location(3200, 3200, 0));
    if (action === "remove") { f.p.getInventory().deleteNumber(25818, 1); f.p.getInventory().addItem(new core.Item(25818, 1)); }
    if (action === "death") f.p.setHitpoints(0);
    if (action === "logout") f.p.setRegistered(false);
    await choose(f, 2);
    assert.equal(charges(f), 32, action);
    assert.deepEqual(runeIds().map((id) => f.p.getInventory().getAmount(id)), [20, 20, 20, 20], action);
  }
});

test("runes and charges are re-read when quantity selection arrives", async (t) => {
  const f = actor(t, BESIDE); book(f); runes(f, [20, 20, 20, 20]);
  await quantities(f);
  f.p.getInventory().deleteNumber(runeIds()[2], 20);
  await choose(f, 2);
  assert.equal(charges(f), 32);
  assert.deepEqual(runeIds().map((id) => f.p.getInventory().getAmount(id)), [20, 20, 0, 20]);
  runes(f, [0, 0, 20, 0]); await quantities(f);
  f.p.setAttribute("kharedst-memoirs:charges", 249);
  await choose(f, 4);
  assert.equal(charges(f), 250);
  assert.deepEqual(runeIds().map((id) => f.p.getInventory().getAmount(id)), [19, 19, 19, 19]);
});

test("equipped Book, memoir page capacity and existing shared balance survive save/load", async (t) => {
  const f = actor(t, BESIDE);
  f.p.getEquipment().setItem(3, new core.Item(25818, 1));
  f.p.setAttribute("kharedst-memoirs:charges", 150);
  runes(f, [10, 10, 10, 10]);
  await quantities(f); await choose(f, 2);
  assert.equal(charges(f), 155);
  const g = actor(t, BESIDE);
  PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
  assert.equal(charges(g), 155);
  assert.equal(g.p.getEquipment().getItems()[3].getId(), 25818);
  assert.equal(xp(g), xp(f));
  g.p.getEquipment().deleteNumber(25818, 1);
  g.p.getInventory().addItem(new core.Item(21760, 1));
  g.p.setAttribute("kharedst-memoirs:added-pages", { piscarilius: true });
  await inspect(g); await choose(g, 1);
  assert.equal(charges(g), 155, "inspecting lower-cap memoirs must not erase existing Book charges");
  g.p.setAttribute("kharedst-memoirs:charges", 18);
  g.p.setAttribute("kharedst-memoirs:charged-pages", 1);
  await quantities(g); await choose(g, 3);
  assert.equal(charges(g), 20);
});

test("memoirs without a page and no held book leave inscription-only behaviour", async (t) => {
  for (const memoir of [false, true]) {
    const f = actor(t, BESIDE);
    if (memoir) f.p.getInventory().addItem(new core.Item(21760, 1));
    await inspect(f);
    assert.equal(core.MultiChatboxPrompt.getPending(f.p), null);
    assert.equal(f.p.getDialogueManager().isActive(), false);
  }
});

test("generic pouch spending is atomic and an ordinary pouch cannot supply a saved fourth slot", async (t) => {
  const f = actor(t, BESIDE); book(f);
  f.p.getInventory().addItem(new core.Item(core.ItemIdentifiers.RUNE_POUCH, 1));
  f.p.setAttribute(Pouch.RUNES_ATTRIBUTE, runeIds().map((id) => [id, 20]));
  const request = { player: f.p, costs: [{ id: runeIds()[0], amount: 3 }, { id: runeIds()[1], amount: 21 }] };
  PM.emitCustomEvent("rune-pouch:supply", request);
  assert.notEqual(request.consumed, true);
  assert.deepEqual(runeIds().map((id) => Pouch.amountOf(f.p, id)), [20, 20, 20, 20]);
  await quantities(f);
  assert.match(f.boxes.at(-1).text, /you need Law Runes/);
  assert.equal(charges(f), 32);
});

test("real bank deposit/withdraw while a recharge menu is pending cannot spend replacement book charges", async (t) => {
  const f = actor(t, BESIDE); book(f); runes(f, [10, 10, 10, 10]);
  await quantities(f);
  const { Bank } = core;
  f.p.getBank(0).open();
  Bank.deposit(f.p, 25818, f.p.getInventory().getSlotForItemId(25818), 1, false);
  assert.equal(f.p.getInventory().getAmount(25818), 0);
  Bank.withdraw(f.p, 25818, f.p.getBank(0).getSlotForItemId(25818), 1, 0);
  assert.equal(f.p.getInventory().getAmount(25818), 1);
  f.p.getPacketSender().sendInterfaceRemoval();
  await choose(f, 2);
  assert.equal(charges(f), 32);
  assert.deepEqual(runeIds().map((id) => f.p.getInventory().getAmount(id)), [10, 10, 10, 10]);
  await quantities(f); await choose(f, 2);
  assert.equal(charges(f), 37, "legitimate fresh recharge after banking still works");
});
