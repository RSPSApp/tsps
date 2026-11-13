"use strict";

/**
 * Rolling a chest's loot (Data.KeyChests.js): a pre-roll that hits is the whole reward;
 * otherwise the always items and one main roll. Fish (the Slayer chests) depend on the
 * player's Fishing level, as the Wiki's fish table does.
 */
const Data = require("./Data.KeyChests");

let core = null;

function init(api) {
  core = api.core;
}

const between = (min, max, random) => (max > min ? min + Math.floor(random() * (max - min + 1)) : min);

function pick(entries, random) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.floor(random() * total);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

const drop = (entry, random) => ({ itemId: entry.itemId, amount: between(entry.min, entry.max, random), noted: entry.noted });

/** The OSRS skilling success chance: low at level 1 to high at level 99, out of 256. */
function successChance(low, high, level) {
  const value = Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5) + 1;
  return Math.min(Math.max(value / 256, 0), 1);
}

/** One fish reward at this Fishing level; `scale` multiplies the brimstone chest's amounts. */
function rollFish(level, scale, random) {
  const table = Data.get().fish;
  const amount = ([min, max]) => Math.floor(between(min, max, random) * scale);
  const hit = table.rolls.find((roll) => random() < successChance(roll.low, roll.high, level)) ?? table.fallback;
  if (hit.sharkTable) {
    const { same, shark } = table.sharkTable;
    const roll = Math.floor(random() * (same + shark + table.sharkTable.lure));
    if (roll >= same + shark) return { itemId: table.lure, amount: Math.floor(between(...table.shark.amount, random) * scale * 2), noted: false };
    if (roll >= same) return { itemId: table.shark.itemId, amount: amount(table.shark.amount), noted: true };
  }
  return { itemId: hit.itemId, amount: amount(hit.amount), noted: true };
}

/** One main-table roll: the entry's items (and its oneOf pick or fish); the rest of outOf is nothing. */
function rollMain({ outOf, main }, fishingLevel, random) {
  let roll = Math.floor(random() * outOf);
  const entry = main.find((candidate) => (roll -= candidate.weight) < 0);
  if (!entry) return [];
  const drops = entry.items.map((item) => drop(item, random));
  if (entry.oneOf) drops.push(drop(pick(entry.oneOf, random), random));
  if (entry.fish != null) drops.push(rollFish(fishingLevel, entry.fish, random));
  return drops;
}

/** How much more likely the chance `rules` ("drops:chance", a league's boosted drops) make a pre-roll's items. */
function boost(entries, rules) {
  const names = entries.map((entry) => core.ItemDefinition.forId(entry.itemId)?.getName?.() ?? "");
  return rules.reduce((value, rule) => (names.some((name) => rule.pattern.test(name)) ? value * rule.multiplier : value), 1);
}

/**
 * A chest's reward: [{ itemId, amount, noted }]; a pre-roll hit is flagged `preRoll`, a tertiary
 * hit `bonus`. `rules` raise the pre-rolls' chances.
 */
function roll(chest, fishingLevel, random = Math.random, rules = []) {
  const { loot } = chest;
  for (const preRoll of loot.preRolls) {
    const [chance, outOf] = preRoll.chance;
    const hits = rules.length ? chance * boost(preRoll.oneOf, rules) : chance;
    if (random() * outOf < hits) return [{ ...drop(pick(preRoll.oneOf, random), random), preRoll: true }];
  }
  const drops = loot.always.map((entry) => drop(entry, random));
  if (loot.outOf != null) drops.push(...rollMain(loot, fishingLevel, random));
  for (const table of loot.tables) for (let i = 0; i < table.times; i++) drops.push(...rollMain(table, fishingLevel, random));
  for (const { chance: [hits, outOf], item } of loot.tertiary) if (Math.floor(random() * outOf) < hits) drops.push({ ...drop(item, random), bonus: true });
  return drops;
}

/** Gives the reward: into the inventory, or on the ground under the player when it won't fit. */
function give(player, drops) {
  const inventory = player.getInventory();
  for (const { itemId, amount, noted } of drops) {
    const noteId = noted ? core.ItemDefinition.forId(itemId).getNoteId() : -1;
    const id = noteId >= 0 ? noteId : itemId;
    const stacks = core.ItemDefinition.forId(id).isStackable();
    if (stacks) inventory.forceAdd(player, new core.Item(id, amount));
    else for (let i = 0; i < amount; i++) inventory.forceAdd(player, new core.Item(id, 1));
  }
  inventory.refreshItems();
}

module.exports = { init, roll, rollFish, give, successChance };
