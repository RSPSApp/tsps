// Run after `yarn build`: node --test tests/inferno-combat-achievements-style.test.cjs
// The Inferno's Nibbler Chaser (no magic) and Facing Jad Head-on II (melee only before Zuk) read
// each hit's combat style. They compared String(CombatType) - "0", "1", "2" - with "MAGIC" and
// "MELEE", so a melee-only run lost Head-on II and a magic run still got Nibbler Chaser.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const Achievements = require("../plugins/minigames/inferno/CombatAchievements.Inferno");

let dealt;
const completed = [];
Achievements({
  core: { CombatType, World: { getProcessCycle: () => 0 } },
  onCustomEvent() {},
  onPlayerDealtDamage(handler) { dealt = handler; },
  onCombatHitResolved() {},
  onNpcDeath() {},
  emitCustomEvent(name, event) { if (name === "combat-achievements:complete") completed.push(event.task); },
});

/** A won run whose player lands one hit of each style in `styles`, before Zuk's wave. */
function winWith(styles) {
  const player = { getHitpoints: () => 99, isPlayer: () => true };
  completed.length = 0;
  Achievements.start(player);
  for (const style of styles) dealt({ player, hit: { getCombatType: () => style } });
  Achievements.finish(player, true, 1);
  return completed;
}

test("a melee-only run gets Facing Jad Head-on II and Nibbler Chaser", () => {
  const tasks = winWith([CombatType.MELEE, CombatType.MELEE]);
  assert.ok(tasks.includes("Facing Jad Head-on II"), tasks.join());
  assert.ok(tasks.includes("Nibbler Chaser"), tasks.join());
});

test("a magic hit loses both; a ranged hit loses only Head-on II", () => {
  const magic = winWith([CombatType.MELEE, CombatType.MAGIC]);
  assert.ok(!magic.includes("Nibbler Chaser"), magic.join());
  assert.ok(!magic.includes("Facing Jad Head-on II"), magic.join());
  const ranged = winWith([CombatType.RANGED]);
  assert.ok(ranged.includes("Nibbler Chaser"), ranged.join());
  assert.ok(!ranged.includes("Facing Jad Head-on II"), ranged.join());
});
