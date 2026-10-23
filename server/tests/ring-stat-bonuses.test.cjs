// Run after `yarn build`: node --test tests/ring-stat-bonuses.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const ItemDefinitionLoader = require("../plugins/items/ItemDefinitionLoader.plugin");

function bonusesFor(ringId) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.RING_SLOT] = { getId: () => ringId };
  const manager = new BonusManager();
  BonusManager.update({
    getEquipment: () => ({ getItems: () => items }),
    getBonusManager: () => manager,
  });
  return {
    attack: manager.getAttackBonus(),
    defence: manager.getDefenceBonus(),
    other: manager.getOtherBonus(),
  };
}

test("the Fremennik stat rings apply their equipment bonuses, and the imbued forms double them", async () => {
  await CachePipeline.initialize();
  ItemDefinitionLoader.register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });

  const warrior = bonusesFor(ItemIdentifiers.WARRIOR_RING);
  assert.equal(warrior.attack[BonusManager.ATTACK_SLASH], 4);
  assert.equal(warrior.defence[BonusManager.DEFENCE_SLASH], 4);
  const warriorImbued = bonusesFor(ItemIdentifiers.WARRIOR_RING_I_);
  assert.equal(warriorImbued.attack[BonusManager.ATTACK_SLASH], 8);
  assert.equal(warriorImbued.defence[BonusManager.DEFENCE_SLASH], 8);

  const archers = bonusesFor(ItemIdentifiers.ARCHERS_RING);
  assert.equal(archers.attack[BonusManager.ATTACK_RANGE], 4);
  assert.equal(archers.defence[BonusManager.DEFENCE_RANGE], 4);
  const archersImbued = bonusesFor(ItemIdentifiers.ARCHERS_RING_I_);
  assert.equal(archersImbued.attack[BonusManager.ATTACK_RANGE], 8);
  assert.equal(archersImbued.defence[BonusManager.DEFENCE_RANGE], 8);

  const seers = bonusesFor(ItemIdentifiers.SEERS_RING);
  assert.equal(seers.attack[BonusManager.ATTACK_MAGIC], 6);
  assert.equal(seers.defence[BonusManager.DEFENCE_MAGIC], 6);
  assert.equal(seers.other[BonusManager.MAGIC_STRENGTH], 0.2);
  const seersImbued = bonusesFor(ItemIdentifiers.SEERS_RING_I_);
  assert.equal(seersImbued.attack[BonusManager.ATTACK_MAGIC], 12);
  assert.equal(seersImbued.defence[BonusManager.DEFENCE_MAGIC], 12);
  assert.equal(seersImbued.other[BonusManager.MAGIC_STRENGTH], 0.5);

  const berserker = bonusesFor(ItemIdentifiers.BERSERKER_RING);
  assert.equal(berserker.other[BonusManager.STRENGTH], 4);
  assert.equal(berserker.defence[BonusManager.DEFENCE_CRUSH], 4);
  const berserkerImbued = bonusesFor(ItemIdentifiers.BERSERKER_RING_I_);
  assert.equal(berserkerImbued.other[BonusManager.STRENGTH], 8);
  assert.equal(berserkerImbued.defence[BonusManager.DEFENCE_CRUSH], 8);

  assert.equal(ItemDefinition.forId(ItemIdentifiers.WARRIOR_RING).getName(), "Warrior ring");
});
