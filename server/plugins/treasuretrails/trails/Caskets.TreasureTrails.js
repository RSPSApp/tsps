"use strict";

// Opens easy-to-master reward caskets from the exporter's clue-caskets.json tables.
const Rolls = require("../Rolls.RewardCaskets");
const Runtime = require("./Runtime.TreasureTrails");
const { TIERS } = require("./Tiers.TreasureTrails");
const TABLES = require("../../../data/definitions/clue-caskets.json").tables;
const OPENING_ATTRIBUTE = "treasure-trails:opening-casket";
// Wiki "Clue scroll (easy)": on Entrana armour and weapon rolls are removed, and non-shared
// clue uniques cannot be obtained. The exporter's section names carry both distinctions.
const ENTRANA_EXCLUDED = /weapon|armour|uniques/i;
const ENTRANA_KEPT = /shared/i;
let api;
let core;

function between([minimum, maximum], random) { return minimum + Math.floor(random() * (maximum - minimum + 1)); }

function onEntrana(player) {
  const pos = player.getLocation();
  return pos.getZ() === 0 && pos.getX() >= 2800 && pos.getX() <= 2879 && pos.getY() >= 3320 && pos.getY() <= 3391;
}

function entranaTable(table) {
  const entries = table.entries.filter(entry => !ENTRANA_EXCLUDED.test(entry.section ?? "") || ENTRANA_KEPT.test(entry.section ?? ""));
  return { ...table, entries, out_of: entries.reduce((sum, entry) => sum + entry.weight, 0) };
}

function probability(text) {
  const match = /^(\d+)\/(\d+)$/.exec(String(text ?? ""));
  return match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : null;
}

/**
 * Base rolls plus the table's chance-based tertiaries (milestone tertiaries belong to ClueCapacity).
 * With a `player`, the uniques left after Entrana's filter are as likely as "drops:chance" makes
 * them (Rolls.uniqueMultiplier, shared with the Mimic's roll).
 */
function roll(tier, { entrana = false, random = Math.random, rolls = null, player = null } = {}) {
  const table = TABLES[tier.name];
  if (!table) throw new Error(`No ${tier.name} reward table`);
  const drops = Rolls.rollTable(entrana ? entranaTable(table) : table, rolls ?? between(table.rolls, random), random,
    Rolls.uniqueMultiplier(api, player));
  for (const tertiary of table.tertiary ?? []) {
    const chance = probability(tertiary.probability);
    if (chance != null && random() < chance) drops.push({ itemId: tertiary.item_id, amount: between(tertiary.quantity, random), noted: tertiary.noted });
  }
  return drops;
}

/**
 * Milestone items that are not scroll cases (the easy Large spade at 500). ClueCapacity owns
 * the cases and their recovery; anything else is given on the completion that reaches it.
 */
function itemMilestones(player, tier, completed) {
  return (TABLES[tier.name]?.milestones ?? []).filter(row => Number.isSafeInteger(row.item_id) && row.completed === completed).filter(row => {
    const request = { player, itemId: row.item_id, eligible: null };
    api.emitCustomEvent("treasure-trails:case-eligible", request);
    return request.eligible === null;
  }).map(row => ({ itemId: row.item_id, amount: 1, noted: false }));
}

/** A rewarded clue (the master clue tertiary) obeys clue capacity and becomes a box after X Marks the Spot. */
function clueRewards(player, drops) {
  return drops.flatMap(drop => {
    const tier = /^Clue scroll \((\w+)\)$/.exec(core.ItemDefinition.forId(drop.itemId)?.getName?.() ?? "")?.[1];
    if (!tier) return [drop];
    const receive = { player, tier, allowed: null };
    api.emitCustomEvent("treasure-trails:can-receive", receive);
    if (receive.allowed === false) return [];
    const clue = { player, itemId: drop.itemId, box: false };
    api.emitCustomEvent("treasure-trails:clue-item", clue);
    return [{ ...drop, itemId: clue.itemId }];
  });
}

function prepareDrops(drops, tier) {
  if (!Array.isArray(drops) || !drops.length) throw new Error(`Missing ${tier.name} rewards`);
  return drops.map(drop => {
    if (!Number.isSafeInteger(drop.itemId) || drop.itemId <= 0 || !Number.isSafeInteger(drop.amount) || drop.amount < 1 || typeof drop.noted !== "boolean")
      throw new Error(`Invalid ${tier.name} reward`);
    const definition = core.ItemDefinition.forId(drop.itemId);
    if (!definition || definition === core.ItemDefinition.DEFAULT || definition.getId() !== drop.itemId) throw new Error(`Missing ${tier.name} reward ${drop.itemId}`);
    const creditId = drop.noted ? definition.getNoteId() : drop.itemId;
    const credited = Number.isSafeInteger(creditId) && creditId > 0 ? core.ItemDefinition.forId(creditId) : null;
    if (!credited || credited === core.ItemDefinition.DEFAULT || credited.getId() !== creditId) throw new Error(`Missing credited ${tier.name} reward ${drop.itemId}`);
    return { ...drop, creditId, stackable: credited.isStackable() };
  });
}

function give(player, drops) {
  const credited = new Map();
  for (const drop of drops) {
    const { creditId: id, stackable } = drop;
    for (let i = 0; i < (stackable ? 1 : drop.amount); i++) player.getInventory().forceAdd(player, new core.Item(id, stackable ? drop.amount : 1));
    credited.set(id, (credited.get(id) || 0) + drop.amount);
    api.emitCustomEvent("collection-log:obtain", { player, itemId: drop.itemId, amount: drop.amount });
  }
  player.getInventory().refreshItems();
  return [...credited].map(([itemId, quantity], slot) => ({ itemId, quantity, slot }));
}

/**
 * Wiki "Bloodhound": the master casket's 1/1,000 pet becomes a follower, or goes into the
 * backpack, or to Probita, as every pet does ("pets:award"), not into the reward screen.
 */
function splitPets(drops) {
  const request = { pets: null };
  api.emitCustomEvent("pets:definitions", request);
  const petItems = new Set((request.pets ?? []).map(pet => pet.itemId));
  return { pets: drops.filter(drop => petItems.has(drop.itemId)), drops: drops.filter(drop => !petItems.has(drop.itemId)) };
}

function awardPets(player, pets) {
  for (const pet of pets) api.emitCustomEvent("pets:award", { player, itemId: pet.itemId, source: "treasure-trails:casket", awarded: false });
}

/**
 * Wiki "Mimic": an elite or master casket may turn out to be the Mimic. The table's chance is
 * rolled here; the Mimic plugin decides (its opt-in, one at a time, its dry protection) and
 * answers with the Mimic item carrying this casket's rolls.
 */
function mimicCasket(player, tier, rolls, opened, random = Math.random) {
  const chance = probability(TABLES[tier.name]?.mimic_chance);
  if (chance == null) return null;
  const request = { player, tier: tier.name, rolls, rolled: random() < chance, opened, item: null };
  api.emitCustomEvent("treasure-trails:mimic-casket", request);
  return request.item ?? null;
}

/** The completion's milestone rewards on their own, for a casket that became the Mimic. */
function milestoneDrops(player, tier, count) {
  const request = { player, completed: count, milestones: TABLES[tier.name]?.milestones ?? [], drops: [], handled: false, error: null };
  api.emitCustomEvent("treasure-trails:milestone-rewards", request);
  if (!request.handled || request.error) throw request.error ?? new Error("Treasure Trails milestone service unavailable");
  const drops = [...request.drops, ...itemMilestones(player, tier, count)];
  return drops.length ? prepareDrops(clueRewards(player, drops), tier) : [];
}

// Live captures (rsprox.net): opening a casket says the trail is complete, then the count, the
// collection log and the treasure's worth, the last two lines in red.
const COMPLETED = "Well done, you've completed the Treasure Trail!";
const completedCount = (count, tier) => `<col=ef1020>You have completed ${count} ${tier.name} Treasure Trail${count === 1 ? "" : "s"}.</col>`;

/** The rewards' Grand Exchange worth, as the casket's last message gives it. */
function worth(drops) {
  return drops.reduce((sum, drop) => sum + drop.amount * (core.ItemDefinition.forId(drop.itemId)?.getGrandExchangeValue?.() ?? 0), 0);
}

function tierOfCasket(id) {
  return TIERS.find(tier => Runtime.data(tier).casket === id) ?? null;
}

function open(event) {
  const { player, slot } = event;
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  const tier = item && item.getAmount() > 0 ? tierOfCasket(item.getId()) : null;
  if (!tier || (event.item && event.item !== item)) return false;
  if (player.getAttribute(OPENING_ATTRIBUTE)) return true;
  player.setAttribute(OPENING_ATTRIBUTE, true);
  try {
    let drops, count, mimic, pets = [];
    try {
      const completed = Number(player.getAttribute(Runtime.completedAttribute(tier)) ?? 0);
      if (!Number.isSafeInteger(completed) || completed < 0 || completed >= Number.MAX_SAFE_INTEGER) throw new Error(`Invalid ${tier.name} completion count`);
      count = completed + 1;
      let rolls = TABLES[tier.name] ? between(TABLES[tier.name].rolls, Math.random) : null;
      if (rolls != null) {
        // Content may change how many times the casket rolls, within its tier's ("treasure-trails:casket-rolls", a league relic).
        const [minimum, maximum] = TABLES[tier.name].rolls;
        const request = { player, tier: tier.name, rolls, minimum, maximum };
        api?.emitCustomEvent?.("treasure-trails:casket-rolls", request);
        if (Number.isInteger(request.rolls)) rolls = Math.max(minimum, Math.min(maximum, request.rolls));
      }
      mimic = mimicCasket(player, tier, rolls, count);
      if (mimic) drops = milestoneDrops(player, tier, count);
      else {
        const request = { player, completed: count, milestones: TABLES[tier.name]?.milestones ?? [], drops: roll(tier, { entrana: onEntrana(player), rolls, player }), handled: false, error: null };
        api.emitCustomEvent("treasure-trails:milestone-rewards", request);
        if (!request.handled || request.error) throw request.error ?? new Error("Treasure Trails milestone service unavailable");
        drops = prepareDrops(clueRewards(player, [...request.drops, ...itemMilestones(player, tier, count)]), tier);
        ({ pets, drops } = splitPets(drops));
      }
    } catch (error) {
      event.error = error;
      player.sendMessage("You can't open this casket right now.");
      return true;
    }
    // A preparation callback may have moved or replaced the clicked stack.
    if (inventory.getItems()[slot] !== item || item.getAmount() < 1) return true;
    if (mimic) {
      // The trail is complete; the Mimic's own chest holds its rewards.
      inventory.setItem(slot, mimic);
      player.setAttribute(Runtime.completedAttribute(tier), count);
      give(player, drops);
      Runtime.restore({ player });
      player.sendMessage("The chest turned out to be the Mimic!");
      player.sendMessage(completedCount(count, tier));
      return true;
    }
    inventory.deleteAtSlot(slot, 1);
    player.setAttribute(Runtime.completedAttribute(tier), count);
    player.sendMessage(COMPLETED);
    player.sendMessage(completedCount(count, tier));
    const slots = give(player, drops);
    awardPets(player, pets);
    Runtime.restore({ player });
    const sender = player.getPacketSender();
    const group = Runtime.data(tier).rewardInterface;
    sender.sendInterface(group);
    sender.sendInterfaceScript(1065, [(group << 16) | 3], undefined, undefined, {
      [Runtime.data(tier).rewardInventory]: { capacity: Math.max(3, slots.length), slots },
    });
    player.sendMessage(`<col=ef1020>Your treasure is worth around ${worth(drops).toLocaleString("en-US")} coins!</col>`);
    // "treasure-trails:casket-opened" { player, tier }: a casket was opened for its rewards (a league relic's bonus casket).
    api?.emitCustomEvent?.("treasure-trails:casket-opened", { player, tier: tier.name });
  } finally {
    player.setAttribute(OPENING_ATTRIBUTE, false);
  }
  return true;
}

module.exports = function attachCaskets(pluginApi) {
  api = pluginApi;
  core = api.core;
  for (const tier of TIERS) api.onItemAction(`Reward casket (${tier.name})`, { Open: open });
};

Object.assign(module.exports, { roll, entranaTable, itemMilestones, clueRewards, prepareDrops, splitPets, give, open, onEntrana, tierOfCasket });
