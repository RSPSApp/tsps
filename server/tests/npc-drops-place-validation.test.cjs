// Run after `yarn build`: node --test tests/npc-drops-place-validation.test.cjs
//
// A rolled drop is spawned only when it is a real item with a whole, positive amount. Wiki-derived rows never are
// anything else, but plugins build drops too (and answer npc-drops:place / npc-drops:roll), so the roller guards the
// last step: an item id that is an integer and not negative, an amount that is a safe positive integer. Item 0 is
// the cache's "Dwarf remains" (a real item, nothing here uses 0 as a placeholder), so it is not rejected.
// A stackable drop becomes one ground item, a non-stackable one a unit each, a noted row lands as its note only when the
// note exists, and two kills in a row both spawn their drops. dropFor reports the same valid drops to the loot tracker.
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

const COINS = 995;       // stackable
const BONES = 526;       // not stackable
const SHARK = 385;       // not stackable, has a real note
const SHARK_NOTED = 386;
const ODDITY = 777;      // not stackable, its "note" is not a noted item
const ODDITY_NOTE = 778;

const definitions = {
  [COINS]: { stackable: true },
  [BONES]: {},
  [SHARK]: { noteId: SHARK_NOTED },
  [SHARK_NOTED]: { noted: true, stackable: true },
  [ODDITY]: { noteId: ODDITY_NOTE },
  [ODDITY_NOTE]: {},
  0: {},
};
ItemDefinition.forId = (id) => {
  const def = definitions[id] ?? {};
  return { getNoteId: () => def.noteId ?? -1, isNoted: () => def.noted === true, isStackable: () => def.stackable === true };
};

let grounded = [];
let handlers = {};
NpcDrops.register(new Proxy({
  core: {},
  getItemOnGroundManager: () => ({ registerLocation: (_player, item, location) => grounded.push({ id: item.getId(), amount: item.getAmount(), location }) }),
  onCustomEvent: (name, fn) => { handlers[name] = fn; },
  emitCustomEvent: (name, event) => { if (name === "npc-drops:roll") for (const drop of extraDrops) event.drops.push(drop); },
}, { get: (target, key) => (key in target ? target[key] : () => undefined) }));

let extraDrops = [];
let tracked = [];
const player = () => ({
  getEquipment: () => ({ get: () => null }),
  getInventory: () => ({}),
  getAttribute: () => undefined,
  getPacketSender: () => ({ sendClientScript: (_script, _npc, _key, id, amount) => tracked.push([id, amount]) }),
});
const where = { x: 3200, y: 3200 };

beforeEach(() => { grounded = []; tracked = []; extraDrops = []; });

test("rows with a non-integer or negative item id, or an amount that is not a whole positive number, are never spawned", () => {
  const bad = [
    { itemId: -1, amount: 5 },
    { itemId: 1.5, amount: 5 },
    { itemId: "7", amount: 5 },
    { itemId: null, amount: 5 },
    { itemId: undefined, amount: 5 },
    { itemId: COINS, amount: 0 },
    { itemId: COINS, amount: -3 },
    { itemId: COINS, amount: NaN },
    { itemId: COINS, amount: Infinity },
    { itemId: COINS, amount: 1.5 },
    { itemId: COINS, amount: 2 ** 53 },
    { itemId: COINS, amount: "5" },
    { itemId: COINS },
    null,
  ];
  NpcDrops.__internals.placeDrops(player(), bad, where);
  assert.deepEqual(grounded, []);
});

test("valid rows around the bad ones still spawn", () => {
  NpcDrops.__internals.placeDrops(player(), [{ itemId: -1, amount: 1 }, { itemId: COINS, amount: 25 }, { itemId: COINS, amount: NaN }, { itemId: BONES, amount: 1 }], where);
  assert.deepEqual(grounded.map(({ id, amount }) => [id, amount]), [[COINS, 25], [BONES, 1]]);
});

test("item 0 is Dwarf remains, a real item, so it is placed like any other", () => {
  NpcDrops.__internals.placeDrops(player(), [{ itemId: 0, amount: 1 }], where);
  assert.deepEqual(grounded.map(({ id, amount }) => [id, amount]), [[0, 1]]);
});

test("a stackable drop is one ground item with its whole amount; a non-stackable one is a unit item each", () => {
  NpcDrops.__internals.placeDrops(player(), [{ itemId: COINS, amount: 120 }, { itemId: BONES, amount: 3 }], where);
  assert.deepEqual(grounded.map(({ id, amount }) => [id, amount]), [[COINS, 120], [BONES, 1], [BONES, 1], [BONES, 1]]);
});

test("a noted row lands as its note only when the note exists and is noted", () => {
  NpcDrops.__internals.placeDrops(player(), [
    { itemId: SHARK, amount: 4, noted: true },
    { itemId: ODDITY, amount: 2, noted: true },
    { itemId: SHARK, amount: 1, noted: false },
  ], where);
  assert.deepEqual(grounded.map(({ id, amount }) => [id, amount]), [[SHARK_NOTED, 4], [ODDITY, 1], [ODDITY, 1], [SHARK, 1]]);
});

test("two kills in a row each spawn their own drops at their own place", () => {
  NpcDrops.__internals.placeDrops(player(), [{ itemId: COINS, amount: 10 }], { x: 1, y: 1 });
  NpcDrops.__internals.placeDrops(player(), [{ itemId: COINS, amount: 10 }], { x: 2, y: 2 });
  assert.equal(grounded.length, 2);
  assert.deepEqual(grounded.map((item) => item.location), [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
});

test("an unknown npc id rolls no table, drops nothing and does not throw; a plugin's drops are checked the same way", () => {
  const killer = player();
  assert.equal(NpcDrops.__internals.dropFor(killer, { getId: () => -12345 }, -12345, where), 0);
  assert.deepEqual(grounded, []);
  extraDrops = [{ itemId: COINS, amount: 7 }, { itemId: -1, amount: 7 }, { itemId: COINS, amount: NaN }, { itemId: BONES, amount: 0.5 }];
  NpcDrops.__internals.dropFor(killer, { getId: () => -12345 }, -12345, where);
  assert.deepEqual(grounded.map(({ id, amount }) => [id, amount]), [[COINS, 7]]);
  assert.deepEqual(tracked, [[COINS, 7]], "the loot tracker reports only what spawned");
});
