// Run after `yarn build`: node --test tests/lightbearer.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Effects = require("../dist/game/content/combat/EquipmentEffects");
const { RestoreSpecialAttackTask } = require("../dist/game/task/impl/RestoreSpecialAttackTask");
const Lightbearer = require("../plugins/items/Lightbearer.plugin");

Lightbearer.register({
  registerSpecialEnergyRestoreModifier: Effects.registerSpecialEnergyRestoreModifier,
});

function createPlayer(ringId = -1) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  equipment[Equipment.RING_SLOT] = { getId: () => ringId };
  const player = {
    isPlayer: () => true,
    isRegistered: () => true,
    getAsPlayer: () => player,
    getEquipment: () => ({ get: (slot) => equipment[slot] }),
    getSpecialPercentage: () => 50,
    setSpecialPercentage() {},
    isRecoveringSpecialAttack: () => true,
    setRecoveringSpecialAttack() {},
    getSpecialAttackRestore: () => ({ start() {}, stop() {} }),
  };
  return player;
}

test("the lightbearer doubles the special-attack energy restore rate", () => {
  assert.equal(new RestoreSpecialAttackTask(createPlayer()).getDelay(), 50);
  assert.equal(new RestoreSpecialAttackTask(createPlayer(ItemIdentifiers.LIGHTBEARER)).getDelay(), 25);
});

test("a non-player keeps the default delay", () => {
  assert.equal(Lightbearer._test.restoreDelay({ isPlayer: () => false }, 50), 50);
});
