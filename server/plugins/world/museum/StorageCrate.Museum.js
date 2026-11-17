/**
 * The Varrock Museum storage crate (loc 24534): common finds from the cleaning activity
 * (arrowheads, jewellery, pottery, old chipped vase) go in, and each comes back as one random
 * item (OSRS Wiki: Storage crate, Specimen cleaning; table in data/museum-storage-crate.json).
 *
 * Recorded (rsprox local 1000153, arrowheads used on the crate):
 * - On arrival a chatmenu titled "Finds placed in this crate cannot be retrieved." offers
 *   placing all finds, only the used one, all without asking again (varbit
 *   vm_crate_warningdisabled), or keeping them.
 * - The choice swaps the find for its reward in the same slot, with the spam line below,
 *   human_pickupfloor (827), synth sound 2739 (delay 15) and Tinse Torpe's (1908, chathap1)
 *   thanks.
 *
 * Ours: "Add finds" (the left-click, Wiki: Varrock Museum, 14 March 2019) is the same menu
 * without the single-item line; the message when no finds are carried; one message and one
 * thanks for a batch of several finds (only a single find was recorded); a rolled stackable
 * reward that would overflow the carried stack leaves its find in place with a space message.
 */
"use strict";

const DATA = require("../data/museum-storage-crate.json");

const STATE_ATTRIBUTE = "museum:state";
const TITLE = "Finds placed in this crate cannot be retrieved.";
const PLACE_ALL = "Place all your finds in the crate.";
const PLACE_ONE = "Place that item in the crate: ";
const PLACE_ALL_QUIET = "Place all your finds, and don't ask this again.";
const KEEP = "Keep your items.";
const PLACED_MESSAGE = "You place the find into the crate with all the others and pick up your reward from the crate.";
const NO_FINDS_MESSAGE = "You don't have any finds to put in the crate."; // Ours
const THANKS = "Thanks for helping us out; we really do appreciate it.";
const FULL_STACK_MESSAGE = "You don't have enough inventory space."; // Ours
const MAX_STACK = 2147483647;
const PLACE_SOUND = 2739;
const PLACE_SOUND_DELAY = 15;
const FINDS = new Set(DATA.finds);
const FIND_NAMES = ["Arrowheads", "Jewellery", "Pottery", "Old chipped vase"];

let api = null;
let ids = null;

/** Cache ids by gameval, resolved on first use (the cache loads after register). */
function idsOf() {
  if (ids) return ids;
  const defs = api.core.CacheDefinitions;
  const need = (kind, value) => {
    if (!Number.isInteger(value)) throw new Error(`[museum] unknown ${kind} gameval`);
    return value;
  };
  ids = {
    crate: need("loc", defs.getLocId("vm_crate")),
    warningVarbit: need("varbit", defs.getVarbitId("vm_crate_warningdisabled")),
    pickup: need("seq", defs.getSeqId("human_pickupfloor")),
    happy: need("seq", defs.getSeqId("chathap1")),
    thanksNpc: need("npc", defs.getNpcId("vm_archaeologist6_npc_dummy")), // Tinse Torpe
  };
  return ids;
}

function stateOf(player) {
  const raw = player.getAttribute(STATE_ATTRIBUTE);
  return raw && typeof raw === "object" ? raw : {};
}

function warningDisabled(player) {
  return stateOf(player).crateWarningDisabled === true;
}

function disableWarning(player) {
  player.setAttribute(STATE_ATTRIBUTE, { ...stateOf(player), crateWarningDisabled: true });
  player.getPacketSender().sendVarbit(idsOf().warningVarbit, 1);
}

function findSlots(player) {
  const items = player.getInventory().getItems();
  const slots = [];
  for (let slot = 0; slot < items.length; slot++) {
    if (FINDS.has(items[slot]?.getId?.())) slots.push(slot);
  }
  return slots;
}

/** One reward from the Wiki's 195-weight table, `random` returning [0, 1). */
function rollReward(random = Math.random) {
  let roll = random() * DATA.rewardsTotalWeight;
  let picked = DATA.rewards[DATA.rewards.length - 1];
  for (const entry of DATA.rewards) {
    roll -= entry.weight;
    if (roll < 0) { picked = entry; break; }
  }
  const amount = picked.min == null ? 1 : picked.min + Math.floor(random() * (picked.max - picked.min + 1));
  return { itemId: picked.item, amount };
}

/**
 * The find in `slot` becomes its reward: in the same slot, or onto a stack already carried.
 * A reward that would overflow the carried stack is refused before the find is taken (false).
 */
function swapForReward(player, slot) {
  const inventory = player.getInventory();
  const reward = rollReward();
  const stackable = api.core.ItemDefinition.forId(reward.itemId).isStackable();
  const carried = stackable ? inventory.getAmount(reward.itemId) : 0;
  if (carried > 0) {
    if (carried > MAX_STACK - reward.amount) return false;
    inventory.deleteAtSlot(slot, 1, false);
    inventory.add(new api.core.Item(reward.itemId, reward.amount), false);
  } else {
    inventory.setItem(slot, new api.core.Item(reward.itemId, reward.amount));
  }
  return true;
}

function close(player) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
}

function place(player, slots) {
  const live = slots.filter((slot) => FINDS.has(player.getInventory().getItems()[slot]?.getId?.()));
  if (live.length === 0) {
    close(player);
    return;
  }
  let placed = 0;
  for (const slot of live) {
    if (!swapForReward(player, slot)) break;
    placed++;
  }
  if (placed === 0) {
    close(player);
    player.sendMessage(FULL_STACK_MESSAGE);
    return;
  }
  player.getInventory().refreshItems();
  if (placed < live.length) player.sendMessage(FULL_STACK_MESSAGE);
  player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, PLACED_MESSAGE);
  player.performAnimation(new api.core.Animation(idsOf().pickup));
  player.getPacketSender().sendSound(PLACE_SOUND, 255, PLACE_SOUND_DELAY);
  const { DialogueChainBuilder, NpcDialogue } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new NpcDialogue(0, idsOf().thanksNpc, THANKS, undefined, idsOf().happy)));
}

/** Where the used find is now: its slot if it is still there, else the same item moved. */
function usedSlot(player, itemId, slot) {
  const inventory = player.getInventory();
  return inventory.getItems()[slot]?.getId?.() === itemId ? slot : inventory.getSlotForItemId(itemId);
}

/** The warning menu; `slot` is the used find, or null for the Add finds option. */
function offer(player, slot) {
  if (findSlots(player).length === 0) {
    player.sendMessage(NO_FINDS_MESSAGE);
    return;
  }
  if (warningDisabled(player)) {
    place(player, findSlots(player));
    return;
  }
  const options = [[PLACE_ALL, () => place(player, findSlots(player))]];
  if (slot != null) {
    const itemId = player.getInventory().getItems()[slot].getId();
    const name = api.core.ItemDefinition.forId(itemId).getName();
    options.push([PLACE_ONE + name, () => place(player, [usedSlot(player, itemId, slot)])]);
  }
  options.push([PLACE_ALL_QUIET, () => {
    disableWarning(player);
    place(player, findSlots(player));
  }]);
  options.push([KEEP, () => close(player)]);
  const { DialogueChainBuilder, OptionDialogue } = api.core;
  const menu = new OptionDialogue(0, { executeOption: (option) => options[option - 1]?.[1]() },
    ...options.map(([label]) => label)).setTitle(TITLE);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(menu));
}

function addFinds({ player, objectId }) {
  if (objectId !== idsOf().crate) return false;
  offer(player, null);
  return true;
}

function useFind(event) {
  const { player, itemId, objectId, itemSlot: slot } = event;
  if (objectId !== idsOf().crate || !FINDS.has(itemId)) return false;
  const items = player.getInventory().getItems();
  const used = Number.isInteger(slot) && items[slot]?.getId?.() === itemId ? slot : player.getInventory().getSlotForItemId(itemId);
  if (used >= 0) offer(player, used);
  return true;
}

function syncWarningVarbit({ player }) {
  if (warningDisabled(player)) player.getPacketSender().sendVarbit(idsOf().warningVarbit, 1);
}

module.exports = function registerStorageCrate(pluginApi) {
  api = pluginApi;
  pluginApi.onObjectInteraction("Storage crate", { "Add finds": addFinds });
  for (const name of FIND_NAMES) pluginApi.onItemOnObject(name, "Storage crate", useFind);
  pluginApi.onPlayerLogin(syncWarningVarbit);
};

module.exports.rollReward = rollReward;
module.exports.LAMP = DATA.lamp;
