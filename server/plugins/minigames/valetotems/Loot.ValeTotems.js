"use strict";

/**
 * One roll of the Vale offerings loot table (Wiki "Vale offerings"): a 1/100 pre-roll for a
 * unique, then resources, roots, nests or seeds out of 399, the seeds by Fletching level tier.
 * Loot lines are filterable (spam): "You find some loot: 26 x Dirty arrowtips", "You find some loot: Bird nest".
 */
const Shared = require("./Shared.ValeTotems");

const { DATA } = Shared;
const LOOT = DATA.loot;

function pick(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

function amount(entry) {
  const min = entry.min ?? 1;
  const max = entry.max ?? min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function seedTier(level) {
  return LOOT.seedTiers.find((tier) => level >= tier.level) ?? LOOT.seedTiers[LOOT.seedTiers.length - 1];
}

/** The uniques' row on a league's Boosted drops page. */
const DROP_SOURCE = "Vale offerings";

/**
 * The uniques with their weights times what content makes each likelier: "drops:chance"
 * { player, source, rules } (a league's boosted drops) answers rules on the items' names.
 */
function boostedUniques(player) {
  const rules = [];
  Shared.api()?.emitCustomEvent?.("drops:chance", { player, source: DROP_SOURCE, rules });
  return LOOT.uniques.map((entry) => {
    const name = String(Shared.itemName(Shared.obj(entry.item)));
    const multiplier = rules.reduce((value, rule) => (rule.pattern.test(name) ? value * rule.multiplier : value), 1);
    return { ...entry, weight: entry.weight * multiplier, base: entry.weight };
  });
}

/**
 * { id, amount, nests } for this player's next rummage. The unique pre-roll grows with the
 * uniques' boosts averaged over their weights, so each unique is as many times likelier as its own boost.
 */
function roll(player) {
  const uniques = boostedUniques(player);
  const boost = uniques.reduce((sum, entry) => sum + entry.weight, 0) / uniques.reduce((sum, entry) => sum + entry.base, 0);
  if (Math.random() * LOOT.uniqueChance < boost) {
    return { id: Shared.obj(pick(uniques).item), amount: 1 };
  }
  let entry = pick(LOOT.table);
  const level = Shared.level(player, "FLETCHING");
  if (entry.table === "roots") entry = pick(LOOT.roots);
  else if (entry.table === "seeds") entry = pick(seedTier(level).seeds);
  else if (entry.table === "nests") {
    return { id: Shared.obj(pick(LOOT.nests).item), amount: 1, nests: level >= LOOT.nestsDoubleLevel ? 2 : 1 };
  }
  return { id: Shared.obj(entry.item), amount: amount(entry) };
}

function lootLine(id, count) {
  return count === 1 ? `You find some loot: ${Shared.itemName(id)}` : `You find some loot: ${count} x ${Shared.itemName(id)}`;
}

/** Adds the reward (a second nest goes to the floor when there's no room) and says so. */
function give(player, reward) {
  const { Item, ItemOnGroundManager } = Shared.core();
  player.getInventory().adds(reward.id, reward.amount);
  Shared.spam(player, lootLine(reward.id, reward.amount));
  for (let nest = 1; nest < (reward.nests ?? 1); nest++) {
    const id = Shared.obj(pick(LOOT.nests).item);
    if (Shared.hasRoomFor(player, id)) player.getInventory().adds(id, 1);
    else ItemOnGroundManager.registers(player, new Item(id, 1));
    Shared.spam(player, lootLine(id, 1));
  }
  const name = LOOT.collectionLog.find((item) => Shared.obj(item) === reward.id);
  if (name) Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId: reward.id, amount: reward.amount });
}

module.exports = { roll, give };
