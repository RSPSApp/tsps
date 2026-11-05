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

/** Wiki footnotes "Only dropped in X": every place the data names has bounds, and its rows drop only there (#2275). */
const { locationRequirement, DROP_LOCATIONS } = __internals;
const limitedRows = () => [...__internals.tablesByNpc.values()].flat().flatMap((table) =>
  ["entries", "tertiary"].flatMap((field) => (table[field] || [])
    .filter((entry) => locationRequirement(entry)).map((entry) => ({ table, field, entry, place: locationRequirement(entry) }))));

test("every place a drop note names has bounds", () => {
  const missing = [...new Set(limitedRows().map((row) => row.place.place))].filter((place) => !DROP_LOCATIONS[place]?.boxes?.length);
  assert.deepEqual(missing, []);
});

test("rows limited to a place are kept inside it and removed outside it", () => {
  const places = new Set();
  for (const { table, field, entry, place } of limitedRows()) {
    places.add(place.place);
    const [x1, y1] = DROP_LOCATIONS[place.place].boxes[0];
    const keeps = (x, y) => __internals.withoutOtherLocations(table, npc("Monster", x, y))[field].includes(entry);
    assert.equal(keeps(x1 + 1, y1 + 1), !place.not, `${table.table_id} ${entry.name} inside ${place.place}`);
    assert.equal(keeps(2903, 9780), place.not, `${table.table_id} ${entry.name} in Taverley Dungeon`);
  }
  assert.deepEqual([...places].sort(), Object.keys(DROP_LOCATIONS).filter((key) => key !== "$comment").sort());
});

test("a blue dragon rolls its frozen tear only in the Ruins of Tapoyauik", () => {
  const table = [...__internals.tablesByNpc.values()].flat().find((candidate) => candidate.table_id === "blue_dragon");
  const rolls = (x, y) => {
    const random = Math.random;
    Math.random = () => 0;
    try {
      return __internals.rollTable(table, player, npc("Blue dragon", x, y)).some((drop) => drop.itemId === 29895);
    } finally {
      Math.random = random;
    }
  };
  assert.equal(rolls(2903, 9780), false, "Taverley Dungeon");
  assert.equal(rolls(1589, 9605), true, "Ruins of Tapoyauik");
});

const HARD_CLUE = 2722;

test("npc-drops:tertiary-chance multiplies a tertiary's chance (Mortimer's clue tasks)", () => {
  const listeners = [];
  const noop = () => undefined;
  const api = new Proxy({
    core: {},
    getItemOnGroundManager: () => ({}),
    emitCustomEvent: (name, payload) => { if (name === "npc-drops:tertiary-chance") listeners.forEach((fn) => fn(payload)); },
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  require("../plugins/npcs/NpcDrops.plugin").register(api);
  const table = [...__internals.tablesByNpc.values()].flat().find((candidate) => candidate.table_id === "bloodveld");
  const hardClue = (roll) => {
    const random = Math.random;
    Math.random = () => roll;
    try {
      return __internals.rollTable(table, player, npc("Bloodveld", ...LUMBRIDGE)).some((drop) => drop.itemId === HARD_CLUE);
    } finally {
      Math.random = random;
    }
  };
  // 1/256: a roll of 1.5/256 misses, and hits at twice the chance.
  assert.equal(hardClue(1.5 / 256), false);
  listeners.push((request) => request.rules.push({ pattern: /^clue scroll/i, multiplier: 2 }));
  assert.equal(hardClue(1.5 / 256), true);
});
