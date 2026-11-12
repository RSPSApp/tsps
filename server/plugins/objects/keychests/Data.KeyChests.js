"use strict";

/**
 * The chests, their loot and the enhanced crystal key recipe (../data/key-chests.json), with
 * the cache gamevals they name resolved to ids on first use.
 */
const DATA = require("../data/key-chests.json");

let core = null;
let resolved = null;

function init(api) {
  core = api.core;
}

function objId(name) {
  const id = core.CacheDefinitions.getObjId(name);
  if (id == null) throw new Error(`[KeyChests] no obj gameval '${name}'`);
  return id;
}

/** [obj, amount, "noted"] -> { itemId, min, max, noted }; [obj, amount, weight] in a oneOf. */
function item([name, amount, extra]) {
  const [min, max] = Array.isArray(amount) ? amount : [amount, amount];
  return { itemId: objId(name), min, max, noted: extra === "noted", weight: typeof extra === "number" ? extra : 1 };
}

function mains(list) {
  return list.map((entry) => ({
    weight: entry.weight,
    items: (entry.items ?? []).map(item),
    oneOf: entry.oneOf ? entry.oneOf.map(item) : null,
    fish: entry.fish ?? null,
  }));
}

/** A chest's loot: preRolls, always, one main table, or `tables` (each rolled `times`) and tertiary rolls. */
function loot(table) {
  return {
    preRolls: (table.preRolls ?? []).map((roll) => ({ chance: roll.chance, oneOf: roll.oneOf.map(item) })),
    always: (table.always ?? []).map(item),
    outOf: table.outOf,
    main: mains(table.main ?? []),
    tables: (table.tables ?? []).map((entry) => ({ times: entry.times ?? 1, outOf: entry.outOf, main: mains(entry.main) })),
    tertiary: (table.tertiary ?? []).map((roll) => ({ chance: roll.chance, item: item(roll.item) })),
  };
}

function fishTable(table) {
  const fish = ({ fish: name, ...rest }) => ({ ...rest, itemId: objId(name) });
  return {
    rolls: table.rolls.map(fish),
    fallback: fish(table.fallback),
    shark: fish(table.shark),
    lure: objId(table.lure),
    sharkTable: table.sharkTable,
  };
}

function get() {
  if (resolved) return resolved;
  const chests = Object.entries(DATA.chests).map(([key, chest]) => ({
    ...chest,
    key,
    keyId: objId(chest.key),
    locId: core.CacheDefinitions.getLocId(chest.loc),
    openLocId: chest.openLoc ? core.CacheDefinitions.getLocId(chest.openLoc) : null,
    varbitId: chest.varbit ? core.CacheDefinitions.getVarbitId(chest.varbit) : null,
    loot: loot(chest.loot),
  }));
  const recipe = DATA.enhancedKey;
  resolved = {
    chests,
    fish: fishTable(DATA.fishTable),
    enhancedKey: {
      bowlId: core.CacheDefinitions.getLocId(recipe.bowl),
      productId: objId(recipe.product),
      needs: recipe.needs.map(([name, amount]) => ({ itemId: objId(name), amount })),
      level: recipe.level,
      xp: recipe.xp,
    },
  };
  return resolved;
}

module.exports = { init, get, DATA };
