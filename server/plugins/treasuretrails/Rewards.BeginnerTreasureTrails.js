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

function give(player, drops) {
  const credited = new Map();
  for (const drop of drops) {
    const definition = core.ItemDefinition.forId(drop.itemId);
    const id = drop.noted ? definition.getNoteId() : drop.itemId;
    if (!(id > 0)) throw new Error(`Missing noted reward ${drop.itemId}`);
    const stackable = core.ItemDefinition.forId(id).isStackable();
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
    // Intentional offline exception: the online anti-bot account-age gate has no
    // place in a private game. Keep the published table intact from casket one.
    const drops = roll();
    // Validate every definition before consuming the casket; a bad import loses nothing.
    for (const drop of drops) {
      const definition = core.ItemDefinition.forId(drop.itemId);
      if (!definition || drop.noted && !(definition.getNoteId() > 0)) throw new Error(`Invalid beginner reward ${drop.itemId}`);
    }
    inventory.deleteAtSlot(slot, 1);
    const count = (Number(player.getAttribute(Runtime.COMPLETED_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(Runtime.COMPLETED_ATTRIBUTE, count);
    api.emitCustomEvent("treasure-trails:milestone-rewards", {player, completed: count, milestones: TABLE.milestones, drops});
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
Object.assign(module.exports, { TABLE, roll, give, open, onEntrana });
