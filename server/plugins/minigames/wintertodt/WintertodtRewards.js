"use strict";

/**
 * What one search of the reward cart gives.
 *
 * Wiki ("Reward Cart", and Module:Wintertodt supply crate behind its calculator): each search
 * tries the uniques in order - phoenix 1/5000, dragon axe 1/10000, tome of fire 1/1000, warm
 * gloves, bruma torch and a pyromancer piece 1/150 each, burnt pages 1/45 - stopping at the
 * first that hits. Otherwise it's the main table: 3/25 each for gems, herbs, seeds, logs, ores
 * and fish (Crafting, Herblore, Farming, Woodcutting, Mining and Fishing decide the tier),
 * 5/25 coins and 1/25 each saltpetre and dynamite. A skill table tries its items best first,
 * each at interpolate(level, low, high) / 256. Materials come noted. A fourth pair of warm
 * gloves becomes a magic seed and a fourth bruma torch 2-3 torstol seeds; the pyromancer piece
 * is the one owned least (ties: garb, hood, robe, boots).
 */

const Shared = require("./WintertodtShared");

function ids() {
  return Shared.core().ItemIdentifiers;
}

/** [item, min, max, low roll, high roll], best first, as the Wiki's module lists them. */
const SKILL_TABLES = {
  CRAFTING: [
    ["UNCUT_DIAMOND", 1, 3, 10, 120], ["UNCUT_RUBY", 2, 4, 50, 140], ["UNCUT_EMERALD", 1, 3, 90, 160],
    ["UNCUT_SAPPHIRE", 1, 3, 255, 255],
  ],
  HERBLORE: [
    ["GRIMY_TORSTOL", 1, 3, -70, 40], ["GRIMY_DWARF_WEED", 2, 4, -50, 50], ["GRIMY_LANTADYME", 2, 4, -30, 60],
    ["GRIMY_CADANTINE", 2, 4, -10, 70], ["GRIMY_KWUARM", 2, 4, 10, 85], ["GRIMY_AVANTOE", 3, 5, 20, 100],
    ["GRIMY_IRIT_LEAF", 3, 5, 30, 115], ["GRIMY_RANARR_WEED", 1, 3, 10, 170], ["GRIMY_TARROMIN", 3, 6, 70, -20],
    ["GRIMY_MARRENTILL", 3, 6, 100, -30], ["GRIMY_GUAM_LEAF", 3, 6, 170, -40], ["GRIMY_HARRALANDER", 3, 6, 255, 255],
  ],
  FARMING: [
    ["SPIRIT_SEED", 1, 1, -20, 5], ["DWARF_WEED_SEED", 1, 3, -60, 25], ["LANTADYME_SEED", 1, 3, -60, 30],
    ["CADANTINE_SEED", 1, 3, -40, 40], ["SNAPDRAGON_SEED", 1, 3, -15, 60], ["YEW_SEED", 1, 2, -10, 70],
    ["SNAPE_GRASS_SEED", 3, 7, -8, 78], ["KWUARM_SEED", 1, 3, -10, 80], ["RANARR_SEED", 1, 3, 0, 110],
    ["AVANTOE_SEED", 1, 3, 0, 130], ["WATERMELON_SEED", 3, 7, -10, 180], ["IRIT_SEED", 1, 3, 0, 170],
    ["TEAK_SEED", 1, 2, 10, 160], ["MAPLE_SEED", 1, 2, 15, 190], ["MAHOGANY_SEED", 1, 2, 20, 190],
    ["TOADFLAX_SEED", 1, 3, 20, 190], ["BANANA_TREE_SEED", 1, 2, 30, 180], ["WILLOW_SEED", 1, 2, 60, 120],
    ["HARRALANDER_SEED", 1, 3, 80, -150], ["TARROMIN_SEED", 1, 3, 150, -150], ["ACORN", 1, 1, 255, 255],
  ],
  WOODCUTTING: [
    ["MAGIC_LOGS", 10, 20, -60, 60], ["YEW_LOGS", 10, 20, -50, 90], ["MAHOGANY_LOGS", 10, 20, -40, 130],
    ["MAPLE_LOGS", 10, 20, 0, 160], ["TEAK_LOGS", 10, 20, 30, 200], ["WILLOW_LOGS", 10, 20, 120, 100],
    ["OAK_LOGS", 10, 20, 255, 255],
  ],
  MINING: [
    ["RUNITE_ORE", 1, 2, -60, 40], ["ADAMANTITE_ORE", 2, 3, -50, 80], ["MITHRIL_ORE", 3, 5, -20, 140],
    ["GOLD_ORE", 8, 11, 0, 160], ["COAL", 10, 14, 0, 180], ["PURE_ESSENCE", 20, 70, 40, 190],
    ["SILVER_ORE", 10, 12, 140, 10], ["LIMESTONE", 3, 7, 200, -20], ["IRON_ORE", 5, 15, 255, 255],
  ],
  FISHING: [
    ["RAW_SHARK", 6, 11, -60, 80], ["RAW_SWORDFISH", 6, 11, -50, 100], ["RAW_LOBSTER", 6, 11, -20, 130],
    ["RAW_TUNA", 6, 11, 10, 160], ["RAW_SALMON", 6, 11, 40, 180], ["RAW_ANCHOVIES", 6, 11, 160, 0],
    ["RAW_TROUT", 6, 11, 255, 255],
  ],
};
/** Seeds are given as they are; every other material comes noted. */
const UNNOTED_TABLES = new Set(["FARMING"]);
const SKILL_TABLE_WEIGHT = 3;
const OTHER = [["COINS", 2000, 4999, 5], ["SALTPETRE", 3, 5, 1], ["DYNAMITE", 3, 5, 1]];
const MAIN_TABLE_TOTAL = 25;

const UNIQUE_CHANCE = {
  PHOENIX: 5000, DRAGON_AXE: 10000, TOME: 1000, WARM_GLOVES: 150, BRUMA_TORCH: 150, PYROMANCER: 150, BURNT_PAGE: 45,
};
const PYROMANCER_PIECES = ["PYROMANCER_GARB", "PYROMANCER_HOOD", "PYROMANCER_ROBE", "PYROMANCER_BOOTS"];
const EXTRA_COPIES = 3;

/** The Wiki module's interpolation: the chance (of 256) for an item at this level. */
function interpolate(level, low, high) {
  const unclamped = Math.floor(low + ((high - low) * (level - 1)) / 98);
  return Math.min(Math.max(unclamped + 1, 0), 256);
}

function between(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function oneIn(random, n) {
  return Math.floor(random() * n) === 0;
}

/** How many of an item a player holds anywhere: backpack, worn or banked. */
function owned(player, id) {
  let count = player.getInventory().getAmount(id) + player.getEquipment().getAmount(id);
  for (const tab of player.getBanks?.() ?? []) count += tab?.getAmount?.(id) ?? 0;
  return count;
}

function noted(id) {
  const note = Shared.core().ItemDefinition.forId(id)?.getNoteId?.() ?? -1;
  return note > 0 ? note : id;
}

function rollSkillTable(player, skill, random) {
  const level = Shared.level(player, skill);
  for (const [name, min, max, low, high] of SKILL_TABLES[skill]) {
    if (random() * 256 >= interpolate(level, low, high)) continue;
    const id = ids()[name];
    return { id: UNNOTED_TABLES.has(skill) ? id : noted(id), amount: between(random, min, max) };
  }
  return null;
}

function rollMain(player, random) {
  let roll = Math.floor(random() * MAIN_TABLE_TOTAL);
  for (const skill of Object.keys(SKILL_TABLES)) {
    if (roll < SKILL_TABLE_WEIGHT) return rollSkillTable(player, skill, random);
    roll -= SKILL_TABLE_WEIGHT;
  }
  for (const [name, min, max, weight] of OTHER) {
    if (roll < weight) {
      const id = ids()[name];
      return { id: name === "COINS" ? id : noted(id), amount: between(random, min, max) };
    }
    roll -= weight;
  }
  return null;
}

function pyromancerPiece(player) {
  let best = null;
  for (const name of PYROMANCER_PIECES) {
    const id = ids()[name];
    const count = owned(player, id);
    if (!best || count < best.count) best = { id, count };
  }
  return best.id;
}

/** One search's reward: `{ id, amount, pet? }`. */
function roll(player, random = Math.random) {
  const I = ids();
  if (oneIn(random, UNIQUE_CHANCE.PHOENIX)) return { id: I.PHOENIX, amount: 1, pet: true };
  if (oneIn(random, UNIQUE_CHANCE.DRAGON_AXE)) return { id: I.DRAGON_AXE, amount: 1 };
  if (oneIn(random, UNIQUE_CHANCE.TOME)) return { id: I.TOME_OF_FIRE_EMPTY_, amount: 1 };
  if (oneIn(random, UNIQUE_CHANCE.WARM_GLOVES)) {
    return owned(player, I.WARM_GLOVES) >= EXTRA_COPIES ? { id: I.MAGIC_SEED, amount: 1 } : { id: I.WARM_GLOVES, amount: 1 };
  }
  if (oneIn(random, UNIQUE_CHANCE.BRUMA_TORCH)) {
    return owned(player, I.BRUMA_TORCH) >= EXTRA_COPIES
      ? { id: I.TORSTOL_SEED, amount: between(random, 2, 3) }
      : { id: I.BRUMA_TORCH, amount: 1 };
  }
  if (oneIn(random, UNIQUE_CHANCE.PYROMANCER)) return { id: pyromancerPiece(player), amount: 1 };
  if (oneIn(random, UNIQUE_CHANCE.BURNT_PAGE)) return { id: I.BURNT_PAGE, amount: between(random, 7, 29) };
  return rollMain(player, random);
}

module.exports = { SKILL_TABLES, interpolate, roll, owned, pyromancerPiece, rollSkillTable };
