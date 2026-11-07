// Run after `yarn build`: node --test tests/fenkenstrain-thieving-xp.test.cjs
// Wiki (Creature of Fenkenstrain, Rewards): 1,000 Thieving experience. The scroll showed it and none was paid.
// Real engine: every plugin loaded, a real Player, the quest's own completion.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
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

test("completing Creature of Fenkenstrain pays 1,000 Thieving XP", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9503); p.setUsername("fenken9503"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const before = p.getSkillManager().getExperience(core.Skill.THIEVING);
  assert.equal(require("../plugins/quests/QuestRuntime").questNamed("Creature of Fenkenstrain").complete(p), true);
  assert.equal(p.getSkillManager().getExperience(core.Skill.THIEVING) - before, 1000);
});
