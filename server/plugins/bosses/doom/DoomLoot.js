"use strict";

/**
 * The Doom's loot, rolled for each delve completed (Wiki, "Doom of Mokhaiotl#Drops"):
 * - One roll on the regular table (weights out of 104, quantities as at delve 3), scaled by the
 *   delve: Q_n = Q_3 + trunc(Q_3 * M_n).
 * - Demon tears from delve 3: 50, then 10 more a delve, up to 100.
 * - Uniques from delve 2, each from the delve that unlocks it, at the delve's overall rate and
 *   equally likely among those unlocked. Dom from delve 6 on its own rate.
 * - An elite clue: 1/75 at delves 1-2, 1/50 after.
 * Guesses: a unique comes on top of the regular roll; the moon key half is 30105.
 */

const MULTIPLIER = { 1: -0.5, 2: -0.35, 3: 0, 4: 0.05, 5: 0.1, 6: 0.12, 7: 0.14, 8: 0.17 };
const DEEP_MULTIPLIER = 0.2;

const ITEM = {
  MOKHAIOTL_CLOTH: 31109,
  EYE_OF_AYAK: 31115,
  AVERNIC_TREADS: 31088,
  DOM: 31130,
  DEMON_TEAR: 31111,
  CLUE_ELITE: 12073,
};

/** [itemId, min, max, weight]; noted ids where the Wiki says "(noted)". */
const TABLE = [
  [1150, 1, 1, 5], // Dragon med helm (noted)
  [4088, 2, 4, 1], // Dragon platelegs (noted)
  [1408, 1, 1, 5], // Mystic earth staff (noted)
  [1276, 1, 3, 5], // Rune pickaxe (noted)
  [560, 50, 70, 5], // Death rune
  [562, 50, 70, 5], // Chaos rune
  [557, 500, 1000, 5], // Earth rune
  [554, 500, 1000, 5], // Fire rune
  [2, 200, 600, 5], // Steel cannonball
  [9342, 5, 15, 5], // Onyx bolts
  [454, 15, 50, 5], // Coal (noted)
  [445, 20, 60, 5], // Gold ore (noted)
  [452, 3, 6, 5], // Runite ore (noted)
  [22869, 1, 1, 3], // Celastrus seed
  [5295, 1, 3, 2], // Ranarr seed
  [5317, 1, 1, 3], // Spirit seed
  [30771, 151, 400, 5], // Aether catalyst
  [11232, 30, 90, 5], // Dragon dart tip
  [384, 20, 35, 10 / 3], // Raw shark (noted): 5/104 x 2/3
  [30900, 40, 70, 5 / 3, "even"], // Shark lure: 5/104 x 1/3, even quantities
  [29378, 18, 75, 5], // Sun-kissed bones
  [30105, 1, 1, 1], // Tooth half of key (moon key)
  [31111, 100, 300, 7], // Demon tear
  [31099, 1, 2, 7], // Mokhaiotl waystone
];
const TABLE_WEIGHT = 104;

/** Overall unique chance by delve, and the delve each unique unlocks at. */
const UNIQUE_RATE = { 2: 2500, 3: 1000, 4: 450, 5: 270, 6: 255, 7: 240, 8: 210 };
const DEEP_UNIQUE_RATE = 180;
const UNIQUES = [[ITEM.MOKHAIOTL_CLOTH, 2], [ITEM.EYE_OF_AYAK, 3], [ITEM.AVERNIC_TREADS, 4]];
const DOM_RATE = { 6: 1000, 7: 750, 8: 500 };
const DEEP_DOM_RATE = 250;

function multiplier(level) {
  return level > 8 ? DEEP_MULTIPLIER : MULTIPLIER[level];
}

function between(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function oneIn(random, n) {
  return random() < 1 / n;
}

function scaled(quantity, level) {
  return Math.max(1, quantity + Math.trunc(quantity * multiplier(level)));
}

function rollTable(level, random) {
  let pick = random() * TABLE_WEIGHT;
  for (const [id, min, max, weight, rule] of TABLE) {
    pick -= weight;
    if (pick >= 0) continue;
    let quantity = between(random, min, max);
    if (rule === "even") quantity -= quantity % 2;
    return { id, amount: scaled(quantity, level) };
  }
  const [id, min, max] = TABLE[TABLE.length - 1];
  return { id, amount: scaled(between(random, min, max), level) };
}

function tears(level) {
  return level < 3 ? 0 : Math.min(100, 50 + 10 * (level - 3));
}

function rollUnique(level, random) {
  const rate = level > 8 ? DEEP_UNIQUE_RATE : UNIQUE_RATE[level];
  if (!rate || !oneIn(random, rate)) return null;
  const unlocked = UNIQUES.filter(([, from]) => level >= from);
  return unlocked[Math.floor(random() * unlocked.length)][0];
}

function rollDom(level, random) {
  const rate = level > 8 ? DEEP_DOM_RATE : DOM_RATE[level];
  return rate && oneIn(random, rate);
}

/** One delve's loot: [{ id, amount }], and whether anything unique came. */
function roll(level, random = Math.random) {
  const items = [rollTable(level, random)];
  const unique = rollUnique(level, random);
  if (unique) items.push({ id: unique, amount: 1 });
  const dom = rollDom(level, random);
  if (dom) items.push({ id: ITEM.DOM, amount: 1 });
  if (tears(level) > 0) items.push({ id: ITEM.DEMON_TEAR, amount: tears(level) });
  if (oneIn(random, level <= 2 ? 75 : 50)) items.push({ id: ITEM.CLUE_ELITE, amount: 1 });
  return { items, unique: !!unique || dom };
}

/** Adds items into a pile, stacking what is already there. */
function merge(pile, items) {
  for (const item of items) {
    const existing = pile.find((entry) => entry.id === item.id);
    if (existing) existing.amount += item.amount;
    else pile.push({ id: item.id, amount: item.amount });
  }
  return pile;
}

function valueOf(items, ItemDefinition) {
  let total = 0;
  for (const item of items) total += (ItemDefinition?.forId(item.id)?.getValue?.() ?? 0) * item.amount;
  return total;
}

module.exports = { roll, rollTable, rollUnique, rollDom, tears, scaled, merge, valueOf, multiplier, TABLE, TABLE_WEIGHT, ITEM, UNIQUES };
