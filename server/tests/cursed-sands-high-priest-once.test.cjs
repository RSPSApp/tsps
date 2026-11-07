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
