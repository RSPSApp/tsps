"use strict";

/**
 * The Gauntlet's items and recipes, per mode. The Corrupted Gauntlet has its own shards, dust,
 * resources, vial, weapon frame, components, tools and gear (ids 23820-23858); water-filled
 * vials, grym potions, egniol potions and paddlefish are shared.
 *
 * Singing bowl recipes are the Wiki's (Singing Bowl): the armour totals come to 150 / 350 / 650
 * shards and 3 / 7 / 13 of each resource for a basic / attuned / perfected set, as the Wiki's
 * Gauntlet page says. XP is given in Crafting and Smithing alike.
 */

const MODES = {
  regular: {
    shards: 23866, dust: 23867, frame: 23871, grymLeaf: 23875, linum: 23876, ore: 23877, bark: 23878,
    vial: 23879, spike: 23868, bowstring: 23869, orb: 23870,
    sceptre: 23861, axe: 23862, pickaxe: 23863, harpoon: 23864,
    teleportCrystal: 23904, escapeCrystal: 25961, comboFish: 25960,
    helm: [23886, 23887, 23888], body: [23889, 23890, 23891], legs: [23892, 23893, 23894],
    halberd: [23895, 23896, 23897], staff: [23898, 23899, 23900], bow: [23901, 23902, 23903],
  },
  corrupted: {
    shards: 23824, dust: 23830, frame: 23834, grymLeaf: 23835, linum: 23836, ore: 23837, bark: 23838,
    vial: 23839, spike: 23831, bowstring: 23832, orb: 23833,
    sceptre: 23820, axe: 23821, pickaxe: 23822, harpoon: 23823,
    teleportCrystal: 23858, escapeCrystal: 25959, comboFish: 25958,
    helm: [23840, 23841, 23842], body: [23843, 23844, 23845], legs: [23846, 23847, 23848],
    halberd: [23849, 23850, 23851], staff: [23852, 23853, 23854], bow: [23855, 23856, 23857],
  },
};

const SHARED = {
  pestle: 23865,
  waterVial: 23880,
  grymPotion: 23881,
  egniol3: 23884,
  rawPaddlefish: 23872,
  burntPaddlefish: 23873,
  paddlefish: 23874,
};

/** Shards ground per pestle use, and dust per potion (Wiki). */
const DUST_PER_POTION = 10;

/** Armour: per piece and tier, the resources (ore, bark and linum each) and shards. */
const ARMOUR_COST = {
  helm: [{ each: 1, shards: 50, xp: 20 }, { each: 1, shards: 50, xp: 30 }, { each: 2, shards: 100, xp: 40 }],
  body: [{ each: 1, shards: 50, xp: 20 }, { each: 2, shards: 100, xp: 30 }, { each: 2, shards: 100, xp: 40 }],
  legs: [{ each: 1, shards: 50, xp: 20 }, { each: 1, shards: 50, xp: 30 }, { each: 2, shards: 100, xp: 40 }],
};

/** Weapons: a frame makes the basic one, 50 shards attune it, its component perfects it. */
const WEAPON_COMPONENT = { halberd: "spike", staff: "orb", bow: "bowstring" };

function itemsFor(mode) {
  return { ...SHARED, ...MODES[mode] };
}

/** The tier a player can make next of an armour piece or weapon: 0 basic, 1 attuned, 2 perfected, -1 done. */
function nextTier(has, ids) {
  if (has(ids[2])) return -1;
  if (has(ids[1])) return 2;
  if (has(ids[0])) return 1;
  return 0;
}

/**
 * What the singing bowl offers a player now: one entry per product, each piece and weapon at
 * the tier after the one they have. `has(id)` checks inventory and equipment.
 */
function bowlRecipes(mode, has) {
  const I = itemsFor(mode);
  const recipes = [
    { id: I.vial, shards: 10, xp: 5, needs: [] },
    { id: I.teleportCrystal, shards: 50, xp: 20, needs: [] },
    { id: I.escapeCrystal, shards: 200, xp: 100, needs: [] },
    { id: I.comboFish, shards: 10, xp: 5, needs: [[I.paddlefish, 1]] },
  ];
  for (const piece of ["helm", "body", "legs"]) {
    const tier = nextTier(has, I[piece]);
    if (tier < 0) continue;
    const cost = ARMOUR_COST[piece][tier];
    const needs = [[I.ore, cost.each], [I.bark, cost.each], [I.linum, cost.each]];
    if (tier > 0) needs.unshift([I[piece][tier - 1], 1]);
    recipes.push({ id: I[piece][tier], shards: cost.shards, xp: cost.xp, needs, gear: true, tier });
  }
  for (const weapon of ["halberd", "staff", "bow"]) {
    const tier = nextTier(has, I[weapon]);
    if (tier < 0) continue;
    const needs = tier === 0 ? [[I.frame, 1]]
      : tier === 1 ? [[I[weapon][0], 1]]
        : [[I[weapon][1], 1], [I[WEAPON_COMPONENT[weapon]], 1]];
    recipes.push({ id: I[weapon][tier], shards: tier === 1 ? 50 : 0, xp: tier === 0 ? 10 : tier === 1 ? 30 : 0, needs, gear: true, tier });
  }
  return recipes;
}

/** Every item a run can hold, so nothing made inside is mistaken for the player's own. */
function allItemIds() {
  const ids = new Set(Object.values(SHARED));
  for (const mode of Object.values(MODES)) {
    for (const value of Object.values(mode)) [].concat(value).forEach((id) => ids.add(id));
  }
  for (let id = 23882; id <= 23885; id++) ids.add(id);
  return ids;
}

module.exports = { MODES, SHARED, DUST_PER_POTION, ARMOUR_COST, itemsFor, bowlRecipes, allItemIds };
