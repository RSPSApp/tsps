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

/** A real Player over the real cache, with graceful's slot weights hooked into PluginManager. */
function cachePlayer() {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const Graceful = require("../plugins/items/GracefulOutfit.plugin");
  CachePipeline.initialize();
  if (!PluginManager.customEventHooks.get("equipment:weights")?.length) {
    Graceful.register(PluginManager.createApi("GracefulOutfit"));
  }
  const player = new Player(null);
  return player;
}

const drainAt1 = (player) => MovementQueue.runEnergyDrainUnits({
  getWeightKg: () => player.getWeightKg(),
  getSkillManager: () => ({ getCurrentLevel: () => 1 }),
});

test("stackable coins and runes, and notes, weigh nothing however many are carried", () => {
  const { Item } = require("../dist/game/model/Item");
  const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
  const player = cachePlayer();
  // Coins and nature runes carry a 2 g cache weight that OSRS overrides to 0 (Wiki: Weight).
  assert.ok(ItemDefinition.forId(995).getWeight() > 0, "coins keep a raw cache weight");
  player.getInventory().setItem(0, new Item(995, 32000));
  player.getInventory().setItem(1, new Item(561, 5000));
  const notedPlatebodies = ItemDefinition.forId(1127).getNoteId();
  player.getInventory().setItem(2, new Item(notedPlatebodies, 50));
  assert.equal(player.getCarriedWeightGrams(), 0);
  assert.equal(player.getWeightKg(), 0);

  player.getInventory().setItem(3, new Item(1127, 1));
  assert.equal(player.getCarriedWeightGrams(), ItemDefinition.forId(1127).getWeight());
});

test("worn graceful's weight reduction applies to the drain, the packet and the panel alike", () => {
  const { Item } = require("../dist/game/model/Item");
  const EquipmentStats = require("../plugins/interface/EquipmentStats.plugin");
  const player = cachePlayer();
  for (const [slot, id] of [[0, 11850], [1, 11852], [4, 11854], [7, 11856], [9, 11858], [10, 11860]]) {
    player.getEquipment().setItem(slot, new Item(id, 1));
  }
  assert.equal(player.getWeightKg(), -25);
  assert.equal(EquipmentStats._test.getWeight(player), -25);
  assert.equal(drainAt1(player), MovementQueue.runEnergyDrainUnits(subject(0, 1)), "drains as 0 kg");

  // Two rune platebodies (9.979 kg each) still leave the net weight negative.
  player.getInventory().setItem(0, new Item(1127, 1));
  player.getInventory().setItem(1, new Item(1127, 1));
  assert.ok(player.getWeightKg() < 0, `net weight ${player.getWeightKg()} kg`);
  assert.equal(player.getWeightKg(), Math.trunc(EquipmentStats._test.getWeight(player)));
  assert.equal(drainAt1(player), MovementQueue.runEnergyDrainUnits(subject(0, 1)), "drains as 0 kg");
});
