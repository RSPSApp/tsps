// Run after `yarn build`: node --test tests/pest-control-xp-gate.test.cjs
// A Pest Control XP reward spent its points before addExperience, so an XP gate (the side journal's
// combat-XP lock) dropped the XP and the points were gone. Every plugin loaded with the world's opt-in
// CustomCharacterSummary on (it installs that lock), a real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const COMBAT_XP_LOCKED_ATTRIBUTE = "skills:combat-xp-locked";
let core, Rewards, next = 9870;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const WorldDefinition = require("../dist/game/definition/WorldDefinition");
  const read = WorldDefinition.readWorldConfig;
  WorldDefinition.readWorldConfig = (...args) => {
    const world = read(...args) ?? {};
    return { ...world, plugins: { ...(world.plugins ?? {}), CustomCharacterSummary: true } };
  };
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Rewards = require("../plugins/minigames/pestcontrol/Rewards.PestControl");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function harness(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername("pestxp" + next); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.getSkillManager().setCurrentLevel(core.Skill.ATTACK, 50, false).setMaxLevels(core.Skill.ATTACK, 50, false)
    .setExperience(core.Skill.ATTACK, 101333); // level 50
  player.setAttribute(Rewards.POINTS_ATTRIBUTE, 100);
  const messages = [];
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  t.after(() => player.setRegistered(false));
  return { player, messages };
}

function option(skill, points) {
  return Rewards._test.buildRewards().findIndex((reward) => reward.stat === skill.getClientId() && reward.points === points);
}

test("with combat XP locked, an Attack XP reward is refused and keeps the points", (t) => {
  const { player, messages } = harness(t);
  player.setAttribute(COMBAT_XP_LOCKED_ATTRIBUTE, true);
  const before = player.getSkillManager().getExperience(core.Skill.ATTACK);
  assert.equal(Rewards._test.claimReward(player, option(core.Skill.ATTACK, 10)), false);
  assert.equal(player.getAttribute(Rewards.POINTS_ATTRIBUTE), 100, "points kept");
  assert.equal(player.getSkillManager().getExperience(core.Skill.ATTACK), before);
  assert.deepEqual(messages, ["You can't gain experience in that skill right now."]);
});

test("unlocked, an Attack XP reward spends the points and gives the XP", (t) => {
  const { player } = harness(t);
  const before = player.getSkillManager().getExperience(core.Skill.ATTACK);
  assert.equal(Rewards._test.claimReward(player, option(core.Skill.ATTACK, 10)), true);
  assert.equal(player.getAttribute(Rewards.POINTS_ATTRIBUTE), 90);
  assert.ok(player.getSkillManager().getExperience(core.Skill.ATTACK) > before);
});
