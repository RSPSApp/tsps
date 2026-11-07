// Run after `yarn build`: node --test tests/ghosts-ahoy-prayer-xp.test.cjs
// Wiki (Ghosts Ahoy, Rewards): 2,400 Prayer experience. The scroll listed it, but nothing paid it. Real engine:
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

test("completing Ghosts Ahoy pays its 2,400 Prayer XP", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9500); p.setUsername("ghostly9500"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const before = p.getSkillManager().getExperience(core.Skill.PRAYER);
  assert.equal(require("../plugins/quests/QuestRuntime").questNamed("Ghosts Ahoy").complete(p), true);
  assert.equal(p.getSkillManager().getExperience(core.Skill.PRAYER) - before, 2400);
});
