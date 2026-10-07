// Run after `yarn build`: node --test tests/infernal-pickaxe.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const InfernalPickaxe = require("../plugins/skills/mining/InfernalPickaxe.Mining");

InfernalPickaxe.attach({
  core: { Skill, Equipment, ItemIds, ItemIdentifiers },
  onItemOnItem() {},
});

function pickaxe(id = ItemIds.INFERNAL_PICKAXE, meta = {}) {
  const item = {
    id,
    meta: { ...meta },
    getId() { return this.id; },
    setId(value) { this.id = value; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, value) {
      if (value === undefined) delete this.meta[key];
      else this.meta[key] = value;
    },
  };
  return item;
}

function createPlayer(inventory, smithing = 85) {
  const xp = [];
  const deleted = [];
  const messages = [];
  const player = {
    xp,
    deleted,
    messages,
    getEquipment: () => ({ getItems: () => new Array(14).fill(null).map(() => ({ getId: () => 0 })), refreshItems: () => {} }),
    getInventory: () => ({ getItems: () => inventory, refreshItems: () => {}, deleteNumber: (id, amount) => deleted.push([id, amount]) }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.SMITHING ? smithing : 99),
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

test("infernal pickaxe ore experience matches the Wiki halved-bar table", () => {
  assert.equal(InfernalPickaxe._test.oreXp(ItemIds.COPPER_ORE), 3.6);
  assert.equal(InfernalPickaxe._test.oreXp(ItemIds.IRON_ORE), 5.5);
  assert.equal(InfernalPickaxe._test.oreXp(ItemIds.RUNITE_ORE), 25);
  assert.equal(InfernalPickaxe._test.oreXp(ItemIds.CLAY), undefined, "clay is not smeltable");
});

test("a charge is spent and the pickaxe turns uncharged at zero", () => {
  const item = pickaxe();
  assert.equal(InfernalPickaxe._test.charges(item), 5000, "new pickaxes start fully charged");
  InfernalPickaxe._test.useCharge(createPlayer([item]), item);
  assert.equal(InfernalPickaxe._test.charges(item), 4999);
  item.setMetaValue("infernal-pickaxe", { charges: 1 });
  InfernalPickaxe._test.useCharge(createPlayer([item]), item);
  assert.equal(item.getId(), ItemIds.INFERNAL_PICKAXE_UNCHARGED_);
  assert.equal(item.getMetaValue("infernal-pickaxe"), undefined);
});

test("the effect procs one in three, destroys the ore and grants half Smithing XP", () => {
  const item = pickaxe();
  const player = createPlayer([item]);
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(InfernalPickaxe.tryCombustOre(player, item.getId(), ItemIds.COPPER_ORE), true);
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(player.xp, [[Skill.SMITHING, 1.8]], "half of 3.6");
  assert.equal(InfernalPickaxe._test.charges(item), 4999);

  const noProc = createPlayer([pickaxe()]);
  const fresh = noProc.getInventory().getItems()[0];
  Math.random = () => 0.99;
  try {
    assert.equal(InfernalPickaxe.tryCombustOre(noProc, fresh.getId(), ItemIds.COPPER_ORE), false);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(noProc.xp.length, 0);
});

test("using a smouldering stone on a dragon pickaxe creates the infernal pickaxe at 85 Smithing", () => {
  const stone = pickaxe(ItemIds.SMOULDERING_STONE);
  const dragon = pickaxe(ItemIds.DRAGON_PICKAXE);
  const player = createPlayer([stone, dragon]);
  assert.equal(InfernalPickaxe._test.handlePickaxeCreation(player, stone, dragon), true);
  assert.equal(dragon.getId(), ItemIds.INFERNAL_PICKAXE);
  assert.equal(InfernalPickaxe._test.charges(dragon), 5000);
  assert.deepEqual(player.xp.map(([skill]) => skill), [Skill.MINING, Skill.SMITHING]);
  assert.deepEqual(player.deleted, [[ItemIds.SMOULDERING_STONE, 1]]);

  const lowLevel = createPlayer([pickaxe(ItemIds.SMOULDERING_STONE), pickaxe(ItemIds.DRAGON_PICKAXE)], 80);
  assert.equal(InfernalPickaxe._test.handlePickaxeCreation(lowLevel, lowLevel.getInventory().getItems()[0], lowLevel.getInventory().getItems()[1]), true);
  assert.equal(lowLevel.getInventory().getItems()[1].getId(), ItemIds.DRAGON_PICKAXE, "no level, no creation");
});
