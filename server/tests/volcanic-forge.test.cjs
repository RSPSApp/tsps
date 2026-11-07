// Run after `yarn build`: node --test tests/volcanic-forge.test.cjs
// The Volcanic Forge (object 26755) forges a ward from the three shards of its set
// (https://oldschool.runescape.wiki/w/Volcanic_Forge).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const forge = require("../plugins/items/VolcanicForge.plugin");

const I = PluginManager.getCoreApi().ItemIdentifiers;
const { FORGE_MESSAGE, buildShardSets, setFor, forgeSetFor } = forge._test;
const SETS = buildShardSets(I);

/** A stand-in for the inventory: `forgeSetFor` only reads `getAmount`. */
const pack = (amounts) => ({ getAmount: (id) => amounts[id] ?? 0 });

/** A pack holding one of each id given. */
const holding = (...ids) => pack(Object.fromEntries(ids.map((id) => [id, 1])));

test("each set is the three shards of one ward", () => {
  assert.deepEqual(
    SETS.map((set) => ({ ward: set.ward, shards: [...set.shards] })),
    [
      {
        ward: I.ODIUM_WARD,
        shards: [I.ODIUM_SHARD_1, I.ODIUM_SHARD_2, I.ODIUM_SHARD_3],
      },
      {
        ward: I.MALEDICTION_WARD,
        shards: [I.MALEDICTION_SHARD_1, I.MALEDICTION_SHARD_2, I.MALEDICTION_SHARD_3],
      },
    ],
  );
});

test("the identifiers it is built from are real and distinct", () => {
  const ids = [I.ODIUM_WARD, I.MALEDICTION_WARD, ...SETS.flatMap((set) => set.shards)];
  assert.equal(ids.length, 8);
  for (const id of ids) assert.ok(Number.isInteger(id) && id > 0, `${id} is a real item id`);
  assert.equal(new Set(ids).size, 8, "the two wards and six shards are all different items");
});

test("a shard resolves to its own set only", () => {
  assert.equal(setFor(I.ODIUM_SHARD_1, SETS)?.ward, I.ODIUM_WARD);
  assert.equal(setFor(I.MALEDICTION_SHARD_1, SETS)?.ward, I.MALEDICTION_WARD);
  // The wards themselves and everything else are not shards.
  assert.equal(setFor(I.ODIUM_WARD, SETS), null);
  assert.equal(setFor(I.MALEDICTION_WARD, SETS), null);
  assert.equal(setFor(995, SETS), null);
});

test("a use forges only when every shard of the set is held", () => {
  const odium = [I.ODIUM_SHARD_1, I.ODIUM_SHARD_2, I.ODIUM_SHARD_3];
  const malediction = [I.MALEDICTION_SHARD_1, I.MALEDICTION_SHARD_2, I.MALEDICTION_SHARD_3];

  assert.equal(forgeSetFor(I.ODIUM_SHARD_1, holding(...odium), SETS)?.ward, I.ODIUM_WARD);
  // Two of three is a half set: nothing is forged and nothing is consumed.
  assert.equal(forgeSetFor(I.ODIUM_SHARD_1, holding(odium[0], odium[1]), SETS), null);
  assert.equal(forgeSetFor(I.ODIUM_SHARD_1, holding(odium[0]), SETS), null);
  // A full odium set does not forge a malediction ward.
  assert.equal(forgeSetFor(I.MALEDICTION_SHARD_1, holding(...odium), SETS), null);
  // Any one shard of the set is enough to start, as on the Wiki: the set must be complete.
  assert.equal(forgeSetFor(I.ODIUM_SHARD_3, holding(...odium), SETS)?.ward, I.ODIUM_WARD);
  // Two half sets do not add up to a whole one.
  assert.equal(
    forgeSetFor(I.ODIUM_SHARD_1, holding(odium[0], odium[1], malediction[0], malediction[1]), SETS),
    null,
  );
});

test("the message is the Wiki's wording", () => {
  assert.equal(
    FORGE_MESSAGE,
    "You forge the shield pieces together in the chambers of fire and are blown back by the intense heat.",
  );
});

test("the plugin is members-only, like the forge and the wards", () => {
  assert.equal(forge.name, "VolcanicForge");
  assert.equal(forge.members, true);
});
