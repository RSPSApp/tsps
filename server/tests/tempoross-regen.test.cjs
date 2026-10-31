// Run directly: node --test tests/tempoross-regen.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Fight, scaled } = require("../plugins/minigames/tempoross/Fight.Tempoross");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const DATA = require("../plugins/minigames/data/tempoross.json");

/** regenEnergy only touches these fields, so no cove/core is needed. */
function regenFight(maxEnergy) {
  const fight = Object.create(Fight.prototype);
  fight.maxEnergy = maxEnergy;
  fight.energy = 0;
  fight.regen = 0;
  return fight;
}

test("solo energy regen is the captured 35 a tick", () => {
  const fight = regenFight(scaled(DATA.fight.energyPerPlayer, 1));
  for (let tick = 0; tick < 10; tick++) fight.regenEnergy();
  assert.equal(fight.energy, 350);
});

test("group energy regen keeps the captured ~77-tick essence phase", () => {
  const maxEnergy = scaled(DATA.fight.energyPerPlayer, 2);
  assert.equal(maxEnergy, 5321);

  const fight = regenFight(maxEnergy);
  for (let tick = 0; tick < 76; tick++) fight.regenEnergy();
  assert.ok(fight.energy < maxEnergy, "not full before the captured phase length");

  fight.regenEnergy();
  assert.equal(fight.energy, maxEnergy, "full on tick 77, as a solo fight is");
});

test("Tempoross transitions and jumping spot match the Dec 2024 captures", () => {
  assert.equal(Shared.ANIM.BOSS_SUBMERGE, 8900);
  assert.equal(Shared.ANIM.BOSS_SURFACE, 8901);
  assert.equal(Shared.ANIM.BOSS_ENRAGED_TRANSITION, 8906);
  assert.equal(Shared.ANIM.BOSS_ENRAGED_SPAWN, 8908);
  // Captured spans: 43, 41, 44 and 42 ticks between spawn and removal.
  assert.equal(DATA.fight.specialSpotLifeTicks, 44);
});
