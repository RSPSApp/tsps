"use strict";

// This is an imported exporter artifact, not a hand-maintained reward approximation.
const TABLE = require("../../data/definitions/reward-caskets.json").beginner;
const Runtime = require("./Runtime.BeginnerTreasureTrails");
const OPENING_ATTRIBUTE = "treasure-trails:opening-beginner";
let api;
let core;

function between(min, max, random) { return min + Math.floor(random() * (max - min + 1)); }

function roll(random = Math.random) {
  const entries = TABLE.entries;
  const total = TABLE.out_of;
  const drops = [];
  const rolls = between(...TABLE.rolls, random);
  for (let i = 0; i < rolls; i++) {
    let hit = random() * total;
    const entry = entries.find(entry => (hit -= entry.weight) < 0);
    drops.push({ itemId: entry.item_id, amount: between(...entry.quantity, random), noted: entry.noted });
  }
  return drops;
}

function onEntrana(player) {
  const pos = player.getLocation();
  return pos.getZ() === 0 && pos.getX() >= 2800 && pos.getX() <= 2879 && pos.getY() >= 3320 && pos.getY() <= 3391;
}

/** Resolve every credited definition before consumption, including milestone rewards. */
function prepareDrops(drops) {
  if (!Array.isArray(drops) || !drops.length) throw new Error("Missing beginner rewards");
  return drops.map(drop => {
    if (!Number.isSafeInteger(drop.itemId) || drop.itemId <= 0 ||
        !Number.isSafeInteger(drop.amount) || drop.amount < 1 || typeof drop.noted !== "boolean")
      throw new Error("Invalid beginner reward");
    const definition = core.ItemDefinition.forId(drop.itemId);
    if (!definition || definition === core.ItemDefinition.DEFAULT || definition.getId() !== drop.itemId)
      throw new Error(`Missing beginner reward ${drop.itemId}`);
    const creditId = drop.noted ? definition.getNoteId() : drop.itemId;
    if (!Number.isSafeInteger(creditId) || creditId <= 0) throw new Error(`Missing credited beginner reward ${drop.itemId}`);
    const credited = core.ItemDefinition.forId(creditId);
    if (!credited || credited === core.ItemDefinition.DEFAULT || credited.getId() !== creditId)
      throw new Error(`Missing credited beginner reward ${creditId}`);
    return {...drop, creditId, stackable: credited.isStackable()};
  });
}

function give(player, drops) {
  const credited = new Map();
  for (const drop of drops) {
    const {creditId: id, stackable} = drop;
    for (let i = 0; i < (stackable ? 1 : drop.amount); i++) player.getInventory().forceAdd(player, new core.Item(id, stackable ? drop.amount : 1));
    credited.set(id, (credited.get(id) || 0) + drop.amount);
    api.emitCustomEvent("collection-log:obtain", { player, itemId: drop.itemId, amount: drop.amount });
  }
  player.getInventory().refreshItems();
  return [...credited].map(([itemId, quantity], slot) => ({ itemId, quantity, slot }));
}

function open(event) {
  const { player, slot } = event;
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() !== Runtime.data().casket || item.getAmount() < 1 || (event.item && event.item !== item)) return false;
  if (player.getAttribute(OPENING_ATTRIBUTE)) return true;
  if (onEntrana(player)) {
    player.sendMessage("You cannot open this on Entrana, the monks are watching you too closely.");
    return true;
  }
  player.setAttribute(OPENING_ATTRIBUTE, true);
  try {
    // Known fidelity gap: early-account unique eligibility and the online
    // replacement distribution still need a source-backed implementation.
    let drops, count;
    try {
      const completed = Number(player.getAttribute(Runtime.COMPLETED_ATTRIBUTE) ?? 0);
      if (!Number.isSafeInteger(completed) || completed < 0 || completed >= Number.MAX_SAFE_INTEGER)
        throw new Error("Invalid beginner completion count");
      count = completed + 1;
      const request = {player, completed: count, milestones: TABLE.milestones, drops: roll(), handled: false, error: null};
      api.emitCustomEvent("treasure-trails:milestone-rewards", request);
      if (!request.handled || request.error) throw request.error ?? new Error("Beginner milestone service unavailable");
      drops = prepareDrops(request.drops);
    } catch (error) {
      event.error = error;
      player.sendMessage("You can't open this casket right now.");
      return true;
    }
    // A preparation callback may have moved or replaced the clicked stack.
    if (inventory.getItems()[slot] !== item || item.getId() !== Runtime.data().casket || item.getAmount() < 1) return true;
    inventory.deleteAtSlot(slot, 1);
    player.setAttribute(Runtime.COMPLETED_ATTRIBUTE, count);
    const slots = give(player, drops);
    Runtime.restore({ player });
    const sender = player.getPacketSender();
    const group = Runtime.data().rewardInterface;
    sender.sendInterface(group);
    sender.sendInterfaceScript(1065, [(group << 16) | 3], undefined, undefined, {
      [Runtime.data().rewardInventory]: { capacity: Math.max(3, slots.length), slots },
    });
    player.sendMessage(`You have completed ${count} beginner Treasure Trail${count === 1 ? "" : "s"}.`);
  } finally {
    player.setAttribute(OPENING_ATTRIBUTE, false);
  }
  return true;
}

module.exports = function attachRewards(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.onItemAction("Reward casket (beginner)", { Open: open });
};
Object.assign(module.exports, { TABLE, roll, prepareDrops, give, open, onEntrana });
