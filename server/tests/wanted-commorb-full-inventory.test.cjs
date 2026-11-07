// Run after `yarn build`: node --test tests/wanted-commorb-full-inventory.test.cjs
// Wanted!: buying the commorb from Sir Tiffy takes 10,000 coins and gives the orb. With no room for the orb the coins
// went and the orb never arrived, yet the quest moved on. Real engine: every plugin loaded, a real Player, the quest's
// own stage and its dialogue choice events.
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
let N;
let QuestRuntime;
let next = 9900;
const MISSION = 4;
const COMMORB = 5;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("wanted" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2997, 3373, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const quest = QuestRuntime.questNamed("Wanted!");
  assert.ok(quest, "the Wanted! quest is registered");
  quest.setStage(p, MISSION);
  return { p, inv: p.getInventory(), messages, quest };
}

function choose(f, option) {
  PM.emitCustomEvent("npc-dialogue:choice", { player: f.p, npcId: N.SIR_TIFFY_CASHIEN, option });
}

function buy(f) {
  choose(f, "I'd like to buy one, please.");
  choose(f, "Yes.");
  choose(f, "Yes.");
}

test("buying the commorb with no room for it keeps the coins and the stage", (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.COINS, 50_000));
  for (let slot = 1; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  buy(f);
  assert.equal(f.inv.getAmount(I.COINS), 50_000, "the coins stay");
  assert.equal(f.quest.getStage(f.p), MISSION, "the quest waits for the orb");
  assert.equal(f.inv.getAmount(I.COMMORB), 0);
  f.inv.setItem(27, new core.Item(-1, 0));
  buy(f);
  assert.equal(f.inv.getAmount(I.COMMORB), 1, "with a free slot the purchase goes through");
  assert.equal(f.inv.getAmount(I.COINS), 40_000);
  assert.equal(f.quest.getStage(f.p), COMMORB);
});
