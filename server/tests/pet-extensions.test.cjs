// Run after `yarn build`: node --test tests/pet-extensions.test.cjs
// The Pets plugin's "pets:extensions" hook: another plugin (a Plugin Hub one, say) adds pets of its
// own as the Pets plugin registers, and borrows its ownership helpers.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const Pets = require("../plugins/npcs/Pets.plugin");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});

/** Runs the hook with `rows` as what the extending plugin adds; returns the request it saw. */
function extend(rows) {
  let seen = null;
  Pets.__internals.addExtensionPets({ emitCustomEvent: (name, request) => {
    if (name !== "pets:extensions") return;
    seen = request;
    request.pets.push(...rows);
  } });
  return seen;
}

test("an extension pet joins the pet table, keeping its own fields", (t) => {
  t.after(() => extend([]));
  const request = extend([{ petId: 60001, itemId: 60002, extra: { lines: ["Hi"] } }]);
  const pet = Pets.__internals.PET_BY_ID.get(60001);
  assert.equal(Pets.__internals.PET_BY_ITEM_ID.get(60002), pet);
  assert.equal(pet.enumName, "EXTENSION_60001");
  assert.equal(pet.morphId, 0);
  assert.deepEqual(pet.extra, { lines: ["Hi"] }, "the adding plugin reads its own fields back");
  assert.ok(Pets.__internals.PETS.includes(pet));
  for (const name of ["getOwnedPetItems", "holdsPetItem", "getPetForItemId", "getPetByNpcId"]) {
    assert.equal(typeof request.services[name], "function", `lends ${name}`);
  }
  assert.equal(request.services.getPetForItemId(60002), pet);
});

test("a second register replaces the previous extension pets", () => {
  extend([{ petId: 60001, itemId: 60002 }]);
  extend([{ petId: 60003, itemId: 60004 }]);
  assert.equal(Pets.__internals.PET_BY_ID.get(60001), undefined);
  assert.equal(Pets.__internals.PETS.filter((pet) => pet.extension).length, 1);
  extend([]);
  assert.equal(Pets.__internals.PETS.filter((pet) => pet.extension).length, 0);
});

test("rows without ids, or taking a real pet's NPC or item, are skipped", (t) => {
  t.mock.method(console, "error", () => {});
  const real = Pets.__internals.PETS.find((pet) => !pet.extension);
  extend([{ petId: "x", itemId: 1 }, { petId: real.petId, itemId: 60010 }, { petId: 60011, itemId: real.itemId }]);
  assert.equal(Pets.__internals.PETS.filter((pet) => pet.extension).length, 0);
  assert.equal(Pets.__internals.PET_BY_ID.get(real.petId), real, "the real pet stays");
});
