// Run after `yarn build`: node --test tests/sheep-herder-reward.test.cjs
//
// #3473: Sheep Herder rewards 3,100 coins and 1,000 Hunter experience. The wiki's
// 3 November 2026 changelog added the experience; the plugin only granted the coins.
//
// Native fixture: the real plugin loaded through PluginManager, a real Player, and the
// quest handle from QuestRuntime, so the assertion runs through the same complete() path
// the dialogue uses. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [2609, 3344];
const HUNTER_XP = 1000;
const COINS = 995;

let core;
let next = 8400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = (key) => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("sheepreward" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return p;
}

test("completing Sheep Herder grants 1,000 Hunter experience", (t) => {
  const p = actor(t);
  const sheepHerder = quest("sheep_herder");
  assert.ok(sheepHerder, "sheep_herder is registered");

  const skills = p.getSkillManager();
  const before = skills.getExperience(core.Skill.HUNTER);

  sheepHerder.complete(p);

  assert.equal(sheepHerder.getStage(p), 3, "the quest reaches its completion stage");
  assert.equal(
    skills.getExperience(core.Skill.HUNTER) - before,
    HUNTER_XP,
    "the reward adds exactly 1,000 Hunter experience"
  );
});

test("the coin reward still lands alongside the experience", (t) => {
  const p = actor(t);
  const sheepHerder = quest("sheep_herder");

  sheepHerder.complete(p);

  // grantReward adds 3,099 and the generic 1-coin reward item completes the 3,100 total.
  assert.equal(p.getInventory().getAmount(COINS), 3100, "the 3,100 coin reward is unchanged");
});

test("completing twice does not grant the experience twice", (t) => {
  const p = actor(t);
  const sheepHerder = quest("sheep_herder");
  const skills = p.getSkillManager();

  sheepHerder.complete(p);
  const afterFirst = skills.getExperience(core.Skill.HUNTER);
  sheepHerder.complete(p);

  assert.equal(skills.getExperience(core.Skill.HUNTER), afterFirst, "a second completion is a no-op");
});
