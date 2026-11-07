// Run after `yarn build`: node --test tests/theatre-lamp-bank-tabs.test.cjs
// A Night at the Theatre's lamp reclaim counted the bank's first tab only (getBank() with no tab), so lamps banked in
// another tab were handed out again. Real engine: every plugin loaded, a real Player and real bank tabs, the quest's
// own night-at-the-theatre:claim-lamps event.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("four lamps banked in a later tab leave nothing to reclaim", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9360); p.setUsername("theatrelamp"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const q = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((x) => x.key === "a_night_at_the_theatre");
  assert.ok(q); q.setStage(p, q.completionValue); assert.equal(q.isComplete(p), true, "the reclaim is for a completed quest");
  const lamp = core.ItemIdentifiers.ANTIQUE_LAMP_23;
  p.getBank(3).add(new core.Item(lamp, 4), false);
  assert.equal(p.getBank(0).getAmount(lamp), 0, "none in the first tab");
  PM.emitCustomEvent("night-at-the-theatre:claim-lamps", { player: p });
  assert.equal(p.getInventory().getAmount(lamp), 0, "no lamps handed out again");
});
