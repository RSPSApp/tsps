// Run after `yarn build`: node --test tests/increase-never-lowers-level.test.cjs
//
// A restore or boost never lowers a level. Prayer over base (an ancient brew boosts it past base) and then a restore
// capped at base (a Prayer regeneration step, a Zamorak brew sip) used to drop it to base. A real Player's SkillManager.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");

let core;
before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
});

function prayerAt(current, base = 90) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("overmax");
  const skills = p.getSkillManager();
  skills.setMaxLevel(core.Skill.PRAYER, base).setCurrentLevel(core.Skill.PRAYER, current);
  return skills;
}

test("an increase capped below the current level leaves it alone", () => {
  const over = prayerAt(94);
  over.increaseCurrentLevel(core.Skill.PRAYER, 1, 90);
  assert.equal(over.getCurrentLevel(core.Skill.PRAYER), 94, "94 over a base of 90 stays 94");
  const atCap = prayerAt(90);
  atCap.increaseCurrentLevel(core.Skill.PRAYER, 5, 90);
  assert.equal(atCap.getCurrentLevel(core.Skill.PRAYER), 90);
});

test("an increase below the cap still adds, and stops at the cap", () => {
  const drained = prayerAt(50);
  drained.increaseCurrentLevel(core.Skill.PRAYER, 1, 90);
  assert.equal(drained.getCurrentLevel(core.Skill.PRAYER), 51);
  drained.increaseCurrentLevel(core.Skill.PRAYER, 100, 90);
  assert.equal(drained.getCurrentLevel(core.Skill.PRAYER), 90);
});
