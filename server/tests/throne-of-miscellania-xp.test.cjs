// Run after `yarn build`: node --test tests/throne-of-miscellania-xp.test.cjs
// Wiki (Throne of Miscellania, Rewards; Changes, 3 November 2026): 1,000 Woodcutting, Mining, Fishing and Farming
// experience. None was paid. Real engine:
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

test("completing Throne of Miscellania pays 1,000 Woodcutting, Mining, Fishing and Farming XP", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9502); p.setUsername("throne9502"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const skills = [core.Skill.WOODCUTTING, core.Skill.MINING, core.Skill.FISHING, core.Skill.FARMING];
  const before = skills.map((skill) => p.getSkillManager().getExperience(skill));
  assert.equal(require("../plugins/quests/QuestRuntime").questNamed("Throne of Miscellania").complete(p), true);
  assert.deepEqual(skills.map((skill, i) => p.getSkillManager().getExperience(skill) - before[i]), [1000, 1000, 1000, 1000]);
});
