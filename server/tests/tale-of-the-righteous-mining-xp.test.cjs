// Run after `yarn build`: node --test tests/tale-of-the-righteous-mining-xp.test.cjs
// Wiki (Tale of the Righteous, Rewards): 1,500 Mining experience. Neither the scroll nor the completion had it. Real engine:
// every plugin loaded, a real Player, the quest's own completion.
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

test("completing Tale of the Righteous pays its 1,500 Mining XP", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9501); p.setUsername("righteous9501"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const before = p.getSkillManager().getExperience(core.Skill.MINING);
  assert.equal(require("../plugins/quests/QuestRuntime").questNamed("Tale of the Righteous").complete(p), true);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MINING) - before, 1500);
});
