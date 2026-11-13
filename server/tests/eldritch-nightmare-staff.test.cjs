// Run after `yarn build`: node --test tests/eldritch-nightmare-staff.test.cjs
// Invocate restores Prayer from the swing's potential damage (Wiki), not what a low target let land.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Skill } = require("../dist/game/model/Skill");
const { PluginManager } = require("../dist/plugins/PluginManager");

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const hitDamageHooks = [];
require("../plugins/combat/specials/EldritchNightmareStaff.SpecialAttack")({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: CombatSpecial.register,
  onCombatHitDamage: (handler) => hitDamageHooks.push(handler),
});

function caster(prayer) {
  const levels = new Map([[Skill.PRAYER, prayer]]);
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill),
      setCurrentLevels: (skill, level) => levels.set(skill, level),
    }),
    prayer: () => levels.get(Skill.PRAYER),
  };
  return player;
}

function invocate(method, attacker, landed, rolled, target = { performGraphic() {} }) {
  const pending = {
    isAccurate: () => true,
    getTotalDamage: () => landed,
    getTarget: () => target,
    getAttacker: () => attacker,
    getCombatMethod: () => method,
  };
  for (const hook of hitDamageHooks) hook({ attacker, hit: pending, damage: { getDamage: () => rolled } });
  method.handleAfterHitEffects(pending);
}

test("Invocate restores half the rolled damage even when the target had less Hitpoints left", () => {
  const method = CombatSpecial.getById("eldritch_nightmare_staff").getCombatMethod();
  const attacker = caster(10);
  invocate(method, attacker, 2, 44);
  assert.equal(attacker.prayer(), 32, "22 from the 44 rolled, not 1 from the 2 that landed");
});

test("another method's hits leave Invocate's restore alone", () => {
  const method = CombatSpecial.getById("eldritch_nightmare_staff").getCombatMethod();
  const attacker = caster(10);
  for (const hook of hitDamageHooks) hook({ attacker, hit: { getCombatMethod: () => ({}) }, damage: { getDamage: () => 44 } });
  invocate(method, attacker, 20, 20);
  assert.equal(attacker.prayer(), 20);
});

test("Invocate restores up to 120 Prayer, and never lowers a level already above it", () => {
  const method = CombatSpecial.getById("eldritch_nightmare_staff").getCombatMethod();
  const near = caster(110);
  invocate(method, near, 44, 44);
  assert.equal(near.prayer(), 120);
  const above = caster(125);
  invocate(method, above, 44, 44);
  assert.equal(above.prayer(), 125);
});

test("Invocate on a house combat dummy restores no Prayer (Wiki)", () => {
  const method = CombatSpecial.getById("eldritch_nightmare_staff").getCombatMethod();
  for (const name of ["poh_combat_dummy_npc", "poh_combat_dummy_undeadslayer_npc"]) {
    const id = CacheDefinitions.getNpcId(name);
    assert.ok(Number.isInteger(id), name);
    const dummy = { performGraphic() {}, isNpc: () => true, getId: () => id };
    const attacker = caster(10);
    invocate(method, attacker, 44, 44, dummy);
    assert.equal(attacker.prayer(), 10, name);
  }
  const other = { performGraphic() {}, isNpc: () => true, getId: () => CacheDefinitions.getNpcId("poh_combat_dummy_npc") + 100000 };
  const attacker = caster(10);
  invocate(method, attacker, 44, 44, other);
  assert.equal(attacker.prayer(), 32, "any other NPC still restores");
});
