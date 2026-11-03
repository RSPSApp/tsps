// Run after `yarn build`: node --test tests/run-energy.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { MovementQueue } = require("../dist/game/model/movement/MovementQueue");
const { Player } = require("../dist/game/entity/impl/player/Player");
const {
  registerRunEnergyDrainModifier,
  registerRunEnergyRestoreModifier,
} = require("../dist/game/content/combat/EquipmentEffects");

/** Only what the static formulas read. */
function subject(weightKg, agility) {
  return {
    getWeightKg: () => weightKg,
    getSkillManager: () => ({ getCurrentLevel: () => agility }),
  };
}

const ticksToEmpty = (unitsLost) => Math.ceil(10000 / unitsLost);

test("energy is stored in OSRS units while the percent accessor keeps whole percentages", () => {
  const player = new Player(null);
  player.setRunEnergy(65.43);
  assert.equal(player.getRunEnergyUnits(), 6543);
  assert.equal(player.getRunEnergy(), 65.43);

  player.setRunEnergyUnits(20000);
  assert.equal(player.getRunEnergyUnits(), 10000);
  assert.equal(player.getRunEnergy(), 100);

  player.addRunEnergyUnits(-250);
  assert.equal(player.getRunEnergyUnits(), 9750);
  player.setRunEnergy(-1);
  assert.equal(player.getRunEnergyUnits(), 0);
});

test("drain follows the Wiki formula and the documented 0 kg / 64 kg tick counts", () => {
  // floor((60 + floor(67 * 0 / 64)) * (1 - 1 / 300)) = 59
  const light = MovementQueue.runEnergyDrainUnits(subject(0, 1));
  assert.equal(light, 59);
  assert.equal(ticksToEmpty(light), 170);

  // floor((60 + floor(67 * 64 / 64)) * (1 - 99 / 300)) = 85
  const heavy = MovementQueue.runEnergyDrainUnits(subject(64, 99));
  assert.equal(heavy, 85);
  assert.equal(ticksToEmpty(heavy), 118);

  // Negative weight counts as 0 and more than 64 kg counts as 64.
  assert.equal(MovementQueue.runEnergyDrainUnits(subject(-25, 1)), light);
  assert.equal(MovementQueue.runEnergyDrainUnits(subject(1024.2, 99)), heavy);

  // A stamina potion's 30% drain: floor(59 * 0.3) = 17, 589 ticks.
  registerRunEnergyDrainModifier((_entity, amount) => Math.floor(amount * 0.3));
  const stamina = MovementQueue.runEnergyDrainUnits(subject(0, 1));
  assert.equal(stamina, 17);
  assert.equal(ticksToEmpty(stamina), 589);
});

test("recovery follows the Wiki's per-tick rate, and graceful raises it", () => {
  // floor(Agility / 10) + 15
  assert.equal(MovementQueue.runEnergyRestoreUnits(subject(0, 1)), 15);
  assert.equal(MovementQueue.runEnergyRestoreUnits(subject(0, 19)), 16);
  assert.equal(MovementQueue.runEnergyRestoreUnits(subject(0, 99)), 24);

  // A full graceful set is +30%: floor(15 * 1.3) = 19.
  registerRunEnergyRestoreModifier((_entity, units) => units * 1.3);
  assert.equal(MovementQueue.runEnergyRestoreUnits(subject(0, 1)), 19);
});
