// Run after `yarn build`: node --test tests/armour-effects.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

// Obsidian gear is matched by item name, read from the cache.
CachePipeline.initialize();

const registerObsidianEffects = require("../plugins/combat/effects/ObsidianArmour");
const Graceful = require("../plugins/items/GracefulOutfit.plugin");

function item(id) {
  return { getId: () => id };
}

function playerWithEquipment(overrides) {
  const items = new Array(14).fill(null).map(() => item(0));
  for (const [slot, id] of Object.entries(overrides)) {
    items[Number(slot)] = item(id);
  }
  return { isPlayer: () => true, getAsPlayer() { return this; }, getEquipment: () => ({ getItems: () => items }) };
}

test("the obsidian armour set adds 10% melee accuracy and damage, stacking with the berserker necklace", () => {
  let hitModifier;
  let accuracyModifier;
  registerObsidianEffects({
    registerMeleeHitModifier: (modifier) => { hitModifier = modifier; },
    registerMeleeAttackAccuracyModifier: (modifier) => { accuracyModifier = modifier; },
  });
  assert.equal(typeof hitModifier, "function");
  assert.equal(typeof accuracyModifier, "function");

  const weapon = 6528;
  const fullSet = { 0: ItemIdentifiers.OBSIDIAN_HELMET, 4: ItemIdentifiers.OBSIDIAN_PLATEBODY, 7: ItemIdentifiers.OBSIDIAN_PLATELEGS, 3: weapon };
  const setOnly = playerWithEquipment(fullSet);
  assert.ok(Math.abs(hitModifier(setOnly, 100) - 110) < 1e-9);
  assert.ok(Math.abs(accuracyModifier(setOnly, 100) - 110) < 1e-9);

  const withNecklace = playerWithEquipment({ ...fullSet, 2: ItemIdentifiers.BERSERKER_NECKLACE });
  assert.ok(Math.abs(hitModifier(withNecklace, 100) - 132) < 1e-9, "20% necklace * 10% set");
  assert.ok(Math.abs(accuracyModifier(withNecklace, 100) - 110) < 1e-9, "the necklace is damage only");

  const necklaceOnly = playerWithEquipment({ 2: ItemIdentifiers.BERSERKER_NECKLACE, 3: weapon });
  assert.ok(Math.abs(hitModifier(necklaceOnly, 100) - 120) < 1e-9);
  assert.equal(accuracyModifier(necklaceOnly, 100), 100);

  const noWeapon = playerWithEquipment({ 0: ItemIdentifiers.OBSIDIAN_HELMET, 4: ItemIdentifiers.OBSIDIAN_PLATEBODY, 7: ItemIdentifiers.OBSIDIAN_PLATELEGS });
  assert.equal(hitModifier(noWeapon, 100), 100, "no obsidian weapon, no bonus");
});

test("graceful pieces give 3-4% each and the full set another 10%", () => {
  const names = {
    0: "Graceful hood",
    4: "Graceful top",
    7: "Graceful legs",
    9: "Graceful gloves",
    10: "Graceful boots",
    1: "Graceful cape",
  };
  assert.equal(Graceful._test.gracefulRestoreBonusFromSlots({ 0: "Graceful hood" }, false), 0.03);
  assert.ok(Math.abs(Graceful._test.gracefulRestoreBonusFromSlots(names, false) - 0.30) < 1e-9);
  const noCape = { ...names, 1: "Spottier cape" };
  assert.ok(Math.abs(Graceful._test.gracefulRestoreBonusFromSlots(noCape, false) - 0.17) < 1e-9);
  assert.ok(Math.abs(Graceful._test.gracefulRestoreBonusFromSlots(noCape, true) - 0.27) < 1e-9, "agility cape substitutes for the set");
  assert.equal(Graceful._test.gracefulRestoreBonusFromSlots({ 1: "Graceful cape (Arceuus)" }, false), 0.03);
  assert.equal(Graceful._test.gracefulRestoreBonusFromSlots({ 1: "Spottier cape", 0: "Rune full helm" }, false), 0);
});

test("Skillcape.forId resolves every cape variant", () => {
  const { Skillcape } = require("../dist/game/model/Skillcape");
  for (const id of [9747, 9748, 10639]) {
    assert.equal(Skillcape.forId(id), Skillcape.ATTACK);
  }
  assert.equal(Skillcape.forId(9771), Skillcape.AGILITY);
  assert.equal(Skillcape.forId(9813), Skillcape.QUEST_POINT);
  assert.equal(Skillcape.forId(123456), undefined);
});
