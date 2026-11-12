// Run after `yarn build`: node --test tests/cursed-sands-high-priest-once.test.cjs
// Beneath Cursed Sands: the High Priest's chain replays from stage 102 until the quest completes, and its "Maisa shows
// you a spear with a keris on the end" and "an enchanted circlet" steps gave the item whenever none was in the
// inventory: bank it and talk again for another (a partisan high-alchs for 600,000). Real engine: every plugin loaded,
// a real Player at stage 102, the quest's own transcript actions.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let QuestRuntime;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const action = (p, stepId) => PM.emitCustomEvent("npc-dialogue:action", { player: p, npcId: core.NpcIdentifiers.HIGH_PRIEST_2, stepId, kind: "message" });

test("the partisan and circlet are given once, however often the chain replays", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9010); p.setUsername("sands9010"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  QuestRuntime.questNamed("Beneath Cursed Sands").setStage(p, 102);
  const inv = p.getInventory();
  action(p, "aHisly");
  assert.equal(inv.getAmount(I.KERIS_PARTISAN), 1, "the first showing gives the partisan");
  inv.delete(I.KERIS_PARTISAN, 1); // banked (or dropped, or alched)
  action(p, "aHisly");
  assert.equal(inv.getAmount(I.KERIS_PARTISAN), 0, "the replayed chain gives no second partisan");
  action(p, "VenWhi");
  inv.delete(I.CIRCLET_OF_WATER, 1);
  action(p, "VenWhi");
  assert.equal(inv.getAmount(I.CIRCLET_OF_WATER), 0, "nor a second circlet");
});

test("owed at a full showing, given on a replay: the tent and the hand-over give no second copy", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9011); p.setUsername("sands9011"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  QuestRuntime.questNamed("Beneath Cursed Sands").setStage(p, 102);
  const inv = p.getInventory();
  for (let slot = 0; slot < 28; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1));
  action(p, "aHisly");
  action(p, "VenWhi");
  assert.equal(inv.getAmount(I.KERIS_PARTISAN) + inv.getAmount(I.CIRCLET_OF_WATER), 0, "a full inventory: both owed");
  inv.setItem(0, new core.Item(-1, 0));
  inv.setItem(1, new core.Item(-1, 0));
  action(p, "aHisly");
  action(p, "VenWhi");
  assert.deepEqual([inv.getAmount(I.KERIS_PARTISAN), inv.getAmount(I.CIRCLET_OF_WATER)], [1, 1], "the replay with room gives both");
  inv.delete(I.KERIS_PARTISAN, 1);
  inv.delete(I.CIRCLET_OF_WATER, 1); // banked
  action(p, "eRrcx2"); // the tent's owed partisan
  action(p, "MCAnTF"); // the High Priest's owed circlet
  assert.deepEqual([inv.getAmount(I.KERIS_PARTISAN), inv.getAmount(I.CIRCLET_OF_WATER)], [0, 0], "no second copy of either");
});

test("Spade Dig finds the chest only at the read-tablet step and tile, once, with room", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9012); p.setUsername("sands9012"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const quest = QuestRuntime.questNamed("Beneath Cursed Sands");
  const inv = p.getInventory();
  inv.adds(I.SPADE, 1);
  inv.adds(I.STONE_TABLET_5, 1);
  const click = (itemId, option) => PM.emitItemAction({ player: p, item: new core.Item(itemId, 1), itemId, slot: itemId === I.SPADE ? 0 : 1, option, clickType: core.CacheDefinitions.getItem(itemId).inventoryActions.indexOf(option) + 1, handled: false });
  const dig = () => click(I.SPADE, "Dig");
  const chestCount = () => inv.getAmount(I.CHEST_3);
  p.moveTo(new core.Location(3411, 2786, 0));
  quest.setStage(p, 32);
  dig();
  assert.equal(chestCount(), 0, "unread tablet");
  click(I.STONE_TABLET_5, "Read");
  p.getPacketSender().sendInterfaceRemoval();
  quest.setStage(p, 30);
  dig();
  assert.equal(chestCount(), 0, "wrong stage");
  quest.setStage(p, 32);
  p.moveTo(new core.Location(3410, 2786, 0));
  dig();
  assert.equal(chestCount(), 0, "adjacent tile");
  p.moveTo(new core.Location(3411, 2786, 1));
  dig();
  assert.equal(chestCount(), 0, "wrong plane");
  p.moveTo(new core.Location(3411, 2786, 0));
  for (let slot = 2; slot < 28; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1));
  dig();
  assert.equal(chestCount(), 0, "full inventory");
  inv.setItem(2, new core.Item(-1, 0));
  dig();
  assert.equal(chestCount(), 1, "retry with room awards the chest through its transcript");
  assert.equal(quest.getStage(p), 32);
  dig();
  assert.equal(chestCount(), 1, "repeat dig");
  inv.delete(I.CHEST_3, 1);
  p.getBank(0).adds(I.CHEST_3, 1);
  dig();
  assert.equal(chestCount(), 0, "already banked");
  p.getBank(0).delete(I.CHEST_3, 1);
  p.setAttribute("beneath-cursed-sands:mould-found", true);
  dig();
  assert.equal(chestCount(), 0, "mould already found");
});
