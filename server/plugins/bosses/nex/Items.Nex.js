/**
 * Nex's items (Wiki):
 * - "Ecumenical key shard": 50 "Combine" into an ecumenical key; a player may hold three keys.
 * - "Zaryte crossbow": an Armadyl crossbow with the nihil horn and 250 nihil shards, no skill, 6
 *   ticks; the prompt and messages are ours (no capture).
 * - "Nihil shard": a pestle and mortar grinds one into nihil dust.
 * Preset (untradeable, unbankable) copies are never consumed by any of these, so a free preset stack
 * cannot become a plain key, crossbow or dust.
 */
const Common = require("./Common.Nex");

const SHARDS_PER_KEY = 50;
const KEY_LIMIT = 3;
const CROSSBOW_SHARDS = 250;
const CROSSBOW_TICKS = 6;
const GRIND_ANIM = 364;
const PRESET_TEXT = "Preset items cannot be used for this.";

function keysHeld(player) {
  const id = Common.core.ItemIdentifiers.ECUMENICAL_KEY;
  let count = player.getInventory().getAmount(id);
  for (const tab of player.getBanks?.() ?? []) count += tab?.getAmount?.(id) ?? 0;
  return count;
}

function combineShards({ player }) {
  const { ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  const shards = plainAmount(inventory, ItemIdentifiers.ECUMENICAL_KEY_SHARD);
  if (shards < SHARDS_PER_KEY) {
    if (inventory.getAmount(ItemIdentifiers.ECUMENICAL_KEY_SHARD) >= SHARDS_PER_KEY) player.sendMessage(PRESET_TEXT);
    else Common.statement(player, `You need at least ${SHARDS_PER_KEY} ecumenical key shards to create a key.`);
    return true;
  }
  if (keysHeld(player) >= KEY_LIMIT) {
    Common.statement(player, `You can't hold more than ${KEY_LIMIT} ecumenical keys at a time.`);
    return true;
  }
  if (inventory.getFreeSlots() <= 0 && !freesSlot(inventory, ItemIdentifiers.ECUMENICAL_KEY_SHARD, SHARDS_PER_KEY)) {
    player.sendMessage("Please free up at least one inventory space to do this.");
    return true;
  }
  deletePlain(inventory, ItemIdentifiers.ECUMENICAL_KEY_SHARD, SHARDS_PER_KEY);
  inventory.adds(ItemIdentifiers.ECUMENICAL_KEY, 1);
  player.sendMessage("You combine 50 shards to create a key.");
  return true;
}

/** The nihil horn on an Armadyl crossbow (either way round), with 250 nihil shards. */
function attachHorn({ player, usedItem, usedWithItem }) {
  const { ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  if ((usedItem && restricted(usedItem)) || (usedWithItem && restricted(usedWithItem))) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  if (plainAmount(inventory, ItemIdentifiers.NIHIL_SHARD) < CROSSBOW_SHARDS) {
    if (inventory.getAmount(ItemIdentifiers.NIHIL_SHARD) >= CROSSBOW_SHARDS) player.sendMessage(PRESET_TEXT);
    else Common.statement(player, `You need ${CROSSBOW_SHARDS} nihil shards to attach the horn to the crossbow.`);
    return true;
  }
  Common.api.sendMultiChatboxPrompt(player, "Create a Zaryte crossbow? This cannot be undone.",
    "Yes.", () => {
      player.getPacketSender().sendInterfaceRemoval();
      Common.later(CROSSBOW_TICKS, () => {
        if (!player.isRegistered()) return;
        const horn = plainSlot(inventory, ItemIdentifiers.NIHIL_HORN);
        const crossbow = plainSlot(inventory, ItemIdentifiers.ARMADYL_CROSSBOW);
        if (horn < 0 || crossbow < 0 || plainAmount(inventory, ItemIdentifiers.NIHIL_SHARD) < CROSSBOW_SHARDS) return;
        inventory.deleteAtSlot(horn, 1);
        inventory.deleteAtSlot(crossbow, 1);
        deletePlain(inventory, ItemIdentifiers.NIHIL_SHARD, CROSSBOW_SHARDS);
        inventory.adds(ItemIdentifiers.ZARYTE_CROSSBOW, 1);
        player.sendMessage("You attach the nihil horn to the crossbow, binding it with the shards' power.");
      });
    },
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

/** Preset, untradeable and unbankable copies (Presets.PvpMode tags them) are never ground into plain dust. */
function restricted(item) {
  const { Item } = Common.core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

function plainSlots(inventory, id) {
  const slots = [];
  inventory.getItems().forEach((item, slot) => {
    if (item && item.getId() === id && item.getAmount() > 0 && !restricted(item)) slots.push(slot);
  });
  return slots;
}

function plainSlot(inventory, id) {
  return plainSlots(inventory, id)[0] ?? -1;
}

/** How many unrestricted copies of the item the inventory holds. */
function plainAmount(inventory, id) {
  return plainSlots(inventory, id).reduce((sum, slot) => sum + inventory.getItems()[slot].getAmount(), 0);
}

/** Whether taking `amount` unrestricted copies empties a slot. */
function freesSlot(inventory, id, amount) {
  let left = amount;
  for (const slot of plainSlots(inventory, id)) {
    const have = inventory.getItems()[slot].getAmount();
    if (have <= left) return true;
    left -= have;
    if (left <= 0) return false;
  }
  return false;
}

/** Takes `amount` copies from the unrestricted slots only, leaving preset stacks untouched. */
function deletePlain(inventory, id, amount) {
  let left = amount;
  for (const slot of plainSlots(inventory, id)) {
    if (left <= 0) break;
    const take = Math.min(left, inventory.getItems()[slot].getAmount());
    inventory.deleteAtSlot(slot, take);
    left -= take;
  }
}

function grindShard({ player }) {
  const { ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIdentifiers.NIHIL_SHARD)) return true;
  const slot = inventory.getItems().findIndex((item) => item?.getId() === ItemIdentifiers.NIHIL_SHARD && item.getAmount() > 0 && !restricted(item));
  if (slot < 0) {
    // Herblore's own refusal (Common.Herblore PRESET_REFUSAL), which this handler runs before.
    player.sendMessage("Preset items cannot be used for this.");
    return true;
  }
  // Shards stack, so taking one from a stack frees no slot: the dust needs room of its own, or it was lost.
  const lastShard = inventory.getItems()[slot].getAmount() === 1;
  if (!lastShard && inventory.getAddableAmount(new Common.core.Item(ItemIdentifiers.NIHIL_DUST, 1)) < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  inventory.deleteAtSlot(slot, 1);
  inventory.adds(ItemIdentifiers.NIHIL_DUST, 1);
  player.performAnimation(Common.animation(GRIND_ANIM));
  player.sendMessage("You grind the nihil shard into dust.");
  return true;
}

function attachItems(api) {
  api.onItemAction("Ecumenical key shard", { Combine: combineShards });
  api.onItemOnItem("Nihil horn", "Armadyl crossbow", attachHorn);
  api.onItemOnItem("Pestle and mortar", "Nihil shard", grindShard);
}

module.exports = { attachItems, combineShards, attachHorn, grindShard, KEY_LIMIT };
