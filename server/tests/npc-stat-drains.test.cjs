const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Skill } = require('../dist/game/model/Skill');
const { World } = require('../dist/game/World');
const { CombatType } = require('../dist/game/content/combat/CombatType');
const { AccuracyFormulasDpsCalc: Accuracy } = require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const { PluginManager } = require('../dist/plugins/PluginManager');
let cycle = 0;
World.getProcessCycle = () => cycle;
function npc(levels = [100, 100, 100, 100, 100], demon = false) {
  const value = Object.create(NPC.prototype);
  value.drainedLevels = new Map();
  value.statRestoreTicks = 100;
  value.getCurrentDefinition = () => ({ getStats: () => levels, getMaxHit: () => 11, hasAttribute: (attribute) => demon && attribute === 'demon' });
  value.isPlayer = () => false;
  value.isNpc = () => true;
  value.getAsNpc = () => value;
  value.performGraphic = () => {};
  value.getCombat = () => ({ getSelectedSpell: () => null });
  return value;
}
function method(name) {
  let registered;
  require(`../plugins/combat/specials/${name}.SpecialAttack`)({ core: PluginManager.getCoreApi(), registerCombatSpecial: (value) => { registered = value; } });
  return registered.combatMethod;
}
function hit(target, damage, accurate = true) {
  return { getTarget: () => target, getTotalDamage: () => damage, isAccurate: () => accurate, getHits: () => [{ getDamage: () => damage }] };
}
test('all five NPC combat levels restore independently without mutating shared definitions', () => {
  cycle = 0;
  const value = npc();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC]) value.setCurrentLevels(skill, 20);
  cycle = 99;
  assert.equal(value.getCurrentLevel(Skill.ATTACK), 20);
  value.setCurrentLevels(Skill.ATTACK, 10);
  cycle = 100;
  assert.equal(value.getCurrentLevel(Skill.ATTACK), 11, 'another drain does not reset regeneration');
  assert.equal(value.getCurrentLevel(Skill.RANGED), 21);
  value.setStatRestoreTicks(20);
  cycle = 200;
  assert.equal(value.getCurrentLevel(Skill.MAGIC), 30);
  assert.equal(value.getMaxLevel(Skill.MAGIC), 100);
  assert.throws(() => value.setCurrentLevels(Skill.MAGIC, NaN), RangeError);
});
test('a fresh drain after natural full recovery starts a fresh regeneration minute', () => {
  cycle = 0;
  const value = npc();
  value.setCurrentLevels(Skill.ATTACK, 99);
  cycle = 1000;
  value.setCurrentLevels(Skill.ATTACK, 90);
  assert.equal(value.getCurrentLevel(Skill.ATTACK), 90);
  cycle = 1099;
  assert.equal(value.getCurrentLevel(Skill.ATTACK), 90);
  cycle = 1100;
  assert.equal(value.getCurrentLevel(Skill.ATTACK), 91);
});
test('NPC drained levels immediately affect accuracy, magic defence and damage', () => {
  cycle = 0;
  const value = npc();
  assert.equal(Accuracy.effectiveAttackLevel(value), 109);
  value.setCurrentLevels(Skill.ATTACK, 0);
  assert.equal(Accuracy.effectiveAttackLevel(value), 9, 'same tick cache is invalidated');
  value.setCurrentLevels(Skill.RANGED, 0);
  value.setCurrentLevels(Skill.MAGIC, 0);
  value.setCurrentLevels(Skill.STRENGTH, 0);
  assert.equal(Accuracy.attackRangedRoll(value), 9 * 64);
  assert.equal(Accuracy.attackMagicRoll(value), 9 * 64);
  assert.equal(Accuracy.defenseMagicRoll(value), 9 * 64);
  for (const style of [CombatType.MELEE, CombatType.RANGED]) assert.equal(value.getCurrentMaxHit(style), 1);
});
test('Warstrike carries NPC drains through Defence, Strength, Attack, Magic and Ranged', () => {
  cycle = 0;
  const value = npc([10, 20, 5, 40, 30]);
  method('BandosGodsword').handleAfterHitEffects(hit(value, 70));
  assert.deepEqual([Skill.DEFENCE, Skill.STRENGTH, Skill.ATTACK, Skill.MAGIC, Skill.RANGED].map((s) => value.getCurrentLevel(s)), [0, 0, 0, 0, 35]);
});
test('Sunder carries NPC drains past depleted Defence', () => {
  cycle = 0;
  const value = npc([2, 30, 0, 4, 5]);
  method('BarrelchestAnchor').handleAfterHitEffects(hit(value, 80));
  assert.deepEqual([Skill.ATTACK, Skill.RANGED, Skill.MAGIC].map((s) => value.getCurrentLevel(s)), [0, 0, 3]);
});
test('Weaken applies base-level demon drains and ignores misses', () => {
  for (const [name, amount] of [['Arclight', 11], ['Darklight', 11], ['Emberlight', 16]]) {
    const value = npc(undefined, true);
    const special = method(name);
    special.handleAfterHitEffects(hit(value, 5));
    for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) assert.equal(value.getCurrentLevel(skill), 100 - amount, name);
    special.handleAfterHitEffects(hit(value, 0, false));
    assert.equal(value.getDefenceLevel(), 100 - amount);
  }
});
test('Elder maul, Bone dagger, Soulshot, Condemn and Ralos drain NPC current stats', () => {
  cycle = 0;
  for (const [name, level] of [['ElderMaul', 65], ['BoneDagger', 80], ['TonalzticsOfRalos', 90]]) {
    const value = npc();
    method(name).handleAfterHitEffects(hit(value, 20));
    assert.equal(value.getDefenceLevel(), level, name);
  }
  const value = npc();
  method('Seercull').handleAfterHitEffects(hit(value, 20));
  method('Seercull').handleAfterHitEffects(hit(value, 20));
  assert.equal(value.getCurrentLevel(Skill.MAGIC), 80, 'Soulshot cannot stack');
  const condemn = method('AccursedSceptre');
  condemn.handleAfterHitEffects(hit(value, 10));
  assert.equal(value.getCurrentLevel(Skill.MAGIC), 80, 'Condemn never restores already drained stats');
  assert.equal(value.getDefenceLevel(), 85);
});
