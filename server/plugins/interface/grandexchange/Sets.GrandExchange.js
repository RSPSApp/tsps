/** Native itemsets (451) / itemsets_side (430); recipes come from cache enums 1033/1034. */
const SETS = 451;
const MAIN_ITEMS = (SETS << 16) | 3;
const SIDE = 430;
const SIDE_ITEMS = SIDE << 16;
const RECIPE_LIST = 1033;
const RECIPE_BY_ITEM = 1034;
const PRESET_TEXT = "Preset items cannot be used for this.";
let api;

function recipe(enumId) {
  const values = api.core.CacheDefinitions.getEnumValues(enumId);
  const set = values.get(-1);
  const pieces = [...values].filter(([key]) => key >= 0).map(([, id]) => id);
  return Number.isInteger(set) && set >= 0 && pieces.length ? { set, pieces } : null;
}

function allowedRecipe(value) {
  return value && (api.core.WorldDefinition.isMembersWorld()
    || !api.core.CacheDefinitions.getItem(value.set).isMembers);
}

function openSets({ player }) {
  if ([SETS, 465, 402].includes(player.getInterfaceId())) player.getPacketSender().sendInterfaceRemoval();
  if (player.busy()) {
    player.sendMessage("Finish what you are doing before opening item sets.");
    return true;
  }
  player.getMovementQueue().reset();
  player.getSkillManager().stopSkillable();
  player.setInterfaceId(SETS);
  player.getPacketSender()
    .sendSubInterface((161 << 16) | 16, SETS, 0)
    .sendSubInterface((161 << 16) | 74, SIDE, 3)
    .sendInterfaceFlagsRange(MAIN_ITEMS, 0, api.core.CacheDefinitions.getEnumValues(RECIPE_LIST).size - 1, 1 << 1)
    .sendInterfaceFlagsRange(SIDE_ITEMS, 0, player.getInventory().capacity() - 1, 1 << 1);
  player.getInventory().refreshItems();
  return true;
}

function counts(ids) {
  const result = new Map();
  for (const id of ids) result.set(id, (result.get(id) ?? 0) + 1);
  return result;
}

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never pack. */
function restricted(item) {
  const { Item } = api.core;
  return item.isPresetItem() || item.getMetaValue(Item.UNTRADEABLE_META) === true
    || item.getMetaValue(Item.UNBANKABLE_META) === true;
}

/** How many of `id` can go into an exchange: the unrestricted copies, the ones it would consume. */
function plainAmount(inventory, id) {
  return inventory.getItems().reduce((total, item) =>
    (item.getId() === id && !restricted(item) ? total + item.getAmount() : total), 0);
}

function holds(inventory, ids) {
  return ids.every((id) => Number.isInteger(id) && id >= 0)
    && [...counts(ids)].every(([id, amount]) => plainAmount(inventory, id) >= amount);
}

/** Takes `amount` of `id` from its unrestricted copies, leaving any restricted one alone. */
function takePlain(inventory, id, amount) {
  let left = amount;
  inventory.getItems().forEach((item, slot) => {
    if (left <= 0 || item.getId() !== id || restricted(item)) return;
    const taken = Math.min(left, item.getAmount());
    inventory.deleteAtSlot(slot, taken, false);
    left -= taken;
  });
}

/** Check the complete result on a copy, then commit once so a full inventory loses nothing. */
function exchange(player, inputs, outputs) {
  const inventory = player.getInventory();
  if (!holds(inventory, inputs)) return false;
  const next = new api.core.Inventory(player).setItems(inventory.getCopiedItems());
  for (const [id, amount] of counts(inputs)) takePlain(next, id, amount);
  for (const [id, amount] of counts(outputs)) {
    if (!Number.isInteger(id) || id < 0) return false;
    const item = new api.core.Item(id, amount);
    if (next.getAddableAmount(item) < amount) {
      player.sendMessage("Not enough space in your inventory.");
      return false;
    }
    next.add(item, false);
  }
  inventory.setItems(next.getItems()).refreshItems();
  return true;
}

function pack(event) {
  const { player, slot, itemId } = event;
  if (player.getInterfaceId() !== SETS || !Number.isInteger(slot) || (event.opId ?? event.action) !== 1) return false;
  const enumId = api.core.CacheDefinitions.getEnumValues(RECIPE_LIST).get(slot);
  if (!Number.isInteger(enumId)) return false;
  const value = recipe(enumId);
  if (!allowedRecipe(value) || (itemId !== undefined && itemId !== value.set)) return false;
  const request = { player, allow: true };
  api.emitCustomEvent("item-sets:can-pack", request);
  if (!request.allow) return true;
  const inventory = player.getInventory();
  if (holds(inventory, value.pieces)) {
    // Stackable components (god pages) produce a noted set in OSRS.
    const set = value.pieces.every((id) => api.core.ItemDefinition.forId(id).isStackable())
      ? api.core.ItemDefinition.forId(value.set).getNoteId() : value.set;
    exchange(player, value.pieces, [set]);
  } else {
    const noted = value.pieces.map((id) => api.core.ItemDefinition.forId(id).getNoteId());
    if (holds(inventory, noted)) exchange(player, noted, [api.core.ItemDefinition.forId(value.set).getNoteId()]);
    else if ([...counts(value.pieces)].every(([id, amount]) => inventory.getAmount(id) >= amount)) player.sendMessage(PRESET_TEXT);
    else player.sendMessage(`Contents: ${value.pieces.map((id) => api.core.ItemDefinition.forId(id).getName()).join(", ")}.`);
  }
  return true;
}

function unpack(event) {
  const { player, slot, itemId } = event;
  const inventory = player.getInventory();
  if (player.getInterfaceId() !== SETS || !Number.isInteger(slot) || slot < 0 || slot >= inventory.capacity()
    || (event.opId ?? event.action) !== 1) return false;
  const held = inventory.getItems()[slot];
  if (!held || held.getId() < 0 || held.getAmount() <= 0 || (itemId !== undefined && itemId !== held.getId())) return false;
  const definition = api.core.ItemDefinition.forId(held.getId());
  const enumId = api.core.CacheDefinitions.getEnumValues(RECIPE_BY_ITEM).get(definition.unNote());
  if (!Number.isInteger(enumId)) return false;
  const value = recipe(enumId);
  if (!allowedRecipe(value) || value.set !== definition.unNote()) return false;
  const pieces = definition.isNoted()
    ? value.pieces.map((id) => {
      const note = api.core.ItemDefinition.forId(id).getNoteId();
      return note >= 0 ? note : id;
    }) : value.pieces;
  exchange(player, [held.getId()], pieces);
  return true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  api.onNpcInteraction("Grand Exchange Clerk", { Sets: openSets });
  api.onObjectInteraction("Grand Exchange booth", { Sets: openSets });
  api.onInterfaceActionButton(MAIN_ITEMS, pack);
  api.onInterfaceActionButton(SIDE_ITEMS, unpack);
};
