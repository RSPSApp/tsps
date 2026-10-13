// Run after `yarn build`: node --test tests/looting-bag-drops.test.cjs
// Wiki, Looting bag: dropped by monsters in the Wilderness only, except aviansies, abyssal
// demons and black chinchompas (#475: a rat in Lumbridge dropped one).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { __internals } = require("../plugins/npcs/NpcDrops.plugin");

before(() => __internals.loadDrops());

const player = {
  getEquipment: () => ({ get: () => null, getItems: () => [] }),
  getInventory: () => ({ contains: () => false }),
  getAttribute: () => undefined,
  isPlayer: () => true,
};

function npc(name, x, y) {
  const definition = { getName: () => name };
  return { getLocation: () => new Location(x, y, 0), getDefinition: () => definition, getCurrentDefinition: () => definition };
}

/** Rolls with every chance hitting, so the bag drops exactly when the rule allows it. */
function dropsBag(tableId, monster) {
  const table = [...__internals.tablesByNpc.values()].flat().find((candidate) => candidate.table_id === tableId);
  assert.ok(table, `table ${tableId}`);
  const random = Math.random;
  Math.random = () => 0;
  try {
    return __internals.rollTable(table, player, monster).some((drop) => drop.itemId === 11941);
  } finally {
    Math.random = random;
  }
}

const LUMBRIDGE = [3222, 3218];
const WILDERNESS = [3100, 3700];

test("a rat drops a looting bag only in the Wilderness", () => {
  assert.equal(dropsBag("rat", npc("Rat", ...LUMBRIDGE)), false);
  assert.equal(dropsBag("rat", npc("Rat", ...WILDERNESS)), true);
});

test("monsters found everywhere follow the same rule", () => {
  assert.equal(dropsBag("black_demon", npc("Black demon", 2860, 9775)), false, "Taverley Dungeon");
  assert.equal(dropsBag("black_demon", npc("Black demon", ...WILDERNESS)), true);
});

test("abyssal demons never drop one, even in the Wilderness", () => {
  assert.equal(dropsBag("abyssal_demon_drop_table_wilderness", npc("Abyssal demon", ...WILDERNESS)), false);
});
