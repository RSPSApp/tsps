// Run after `yarn build`: node --test tests/volcanic-forge.test.cjs
// The Volcanic Forge (object 26755) forges a ward from the three shards of its set
// (https://oldschool.runescape.wiki/w/Volcanic_Forge).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const forge = require("../plugins/items/VolcanicForge.plugin");

const { SHARD_SETS, FORGE_MESSAGE, setFor, forgeSetFor } = forge._test;

/** A stand-in for the inventory: `forgeSetFor` only reads `getAmount`. */
const pack = (amounts) => ({ getAmount: (id) => amounts[id] ?? 0 });

test("each set is the three shards of one ward", () => {
  assert.deepEqual(
    SHARD_SETS.map((set) => ({ ward: set.ward, shards: [...set.shards] })),
    [
      { ward: 11926, shards: [11928, 11929, 11930] }, // odium ward
      { ward: 11924, shards: [11931, 11932, 11933] }, // malediction ward
    ],
  );
});

test("a shard resolves to its own set only", () => {
  assert.equal(setFor(11928)?.ward, 11926);
  assert.equal(setFor(11931)?.ward, 11924);
  // The wards themselves and everything else are not shards.
  assert.equal(setFor(11926), null);
  assert.equal(setFor(11924), null);
  assert.equal(setFor(995), null);
});

test("a use forges only when every shard of the set is held", () => {
  assert.equal(forgeSetFor(11928, pack({ 11928: 1, 11929: 1, 11930: 1 }))?.ward, 11926);
  // Two of three is a half set: nothing is forged and nothing is consumed.
  assert.equal(forgeSetFor(11928, pack({ 11928: 1, 11929: 1 })), null);
  assert.equal(forgeSetFor(11928, pack({ 11928: 1 })), null);
  // A full odium set does not forge a malediction ward.
  assert.equal(forgeSetFor(11931, pack({ 11928: 1, 11929: 1, 11930: 1 })), null);
  // Any one shard of the set is enough to start, as on the Wiki: it is the set that must be complete.
  assert.equal(forgeSetFor(11930, pack({ 11928: 1, 11929: 1, 11930: 1 }))?.ward, 11926);
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
