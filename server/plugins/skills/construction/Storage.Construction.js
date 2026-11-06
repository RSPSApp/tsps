"use strict";

const { api, CacheDefinitions, Item, ItemDefinition } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Instance = require("./Instance.Construction");
// Native costume-room enums: set representatives, set members, and alternatives.
const STORAGE_ENUMS = {
  MAGIC_WARDROBE: [3289], ARMOUR_CASE: [3290], FANCY_DRESS_BOX: [3291],
  CAPE_RACK: [3292], TREASURE_CHEST: [3293, 3294, 3295, 3296, 3297, 3298], TOY_BOX: [3299],
};
/** A numeric cache enum; the costume room's are all obj -> obj or int -> obj. */
function numericEnum(id) {
  const values = CacheDefinitions.getEnumValues(id);
  if (!values.size) throw new Error(`Missing costume storage enum ${id}`);
  return values;
}
// The set members of each representative, and the alternatives an item can stand for.
const SET_MEMBERS_ENUM = 3077, ALTERNATES_ENUM = 3303, ALTERNATE_SETS_ENUM = 3304;

function storageItems(furniture) {
  const result = new Map();
  let enums = STORAGE_ENUMS[furniture.hotspotKey];
  if (!enums) return result;
  if (furniture.hotspotKey === "TREASURE_CHEST") enums = enums.slice(0, furniture.buildableKey.startsWith("OAK") ? 2 : furniture.buildableKey.startsWith("TEAK") ? 3 : 6);
  const members = numericEnum(SET_MEMBERS_ENUM), alternates = numericEnum(ALTERNATES_ENUM), alternateSets = numericEnum(ALTERNATE_SETS_ENUM);
  for (const enumId of enums) for (const representative of numericEnum(enumId).values()) {
    const set = members.has(representative) ? [...numericEnum(members.get(representative)).values()] : [representative];
    for (const id of set) {
      result.set(id, representative);
      if (alternates.has(id)) result.set(alternates.get(id), representative);
      if (alternateSets.has(id)) for (const alternate of numericEnum(alternateSets.get(id)).values()) result.set(alternate, representative);
    }
  }
  return result;
}

function capacity(furniture) {
  const key = furniture.buildableKey;
  if (furniture.hotspotKey === "ARMOUR_CASE") return key.startsWith("OAK") ? 25 : key.startsWith("TEAK") ? 50 : Infinity;
  if (furniture.hotspotKey === "MAGIC_WARDROBE") return ({ OAK_MAGIC_WARDROBE: 7, CARVED_OAK_MAGIC_WARDROBE: 14, TEAK_MAGIC_WARDROBE: 21, CARVED_TEAK_MAGIC_WARDROBE: 28, MAHOGANY_MAGIC_WARDROBE: 35, GILDED_MAGIC_WARDROBE: 42 })[key] ?? Infinity;
  if (furniture.hotspotKey === "CAPE_RACK") return ({ OAK_CAPE_RACK: 0, TEAK_CAPE_RACK: 1, MAHOGANY_CAPE_RACK: 5, GILDED_CAPE_RACK: 10, MARBLE_CAPE_RACK: Infinity })[key] ?? Infinity;
  if (furniture.hotspotKey === "FANCY_DRESS_BOX") return key.startsWith("OAK") ? 2 : key.startsWith("TEAK") ? 4 : Infinity;
  return Infinity;
}

function currentFurniture(event) {
  const house = event.player.getPrivateArea();
  if (!(house instanceof Instance.PlayerHouseInstance)) return null;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture && STORAGE_ENUMS[furniture.hotspotKey] ? { house, furniture } : null;
}

function playerMode(player) {
  const mode = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", mode);
  return mode.mode;
}

function isUltimate(player) { return playerMode(player) === "ultimate"; }

function positionOf(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY(), location.getZ()];
}

function sameContext(event, context, position) {
  const current = currentFurniture(event), now = positionOf(event.player);
  return current?.house === context.house && current.furniture === context.furniture
    && context.house.owner === event.player && !context.house.isDestroyed()
    && now.every((coordinate, index) => coordinate === position[index]);
}

function inventorySnapshot(inventory) {
  return inventory.getItems().map(item => item && ({ item, id: item.getId(), amount: item.getAmount(), meta: JSON.stringify(item.getMeta() ?? null) }));
}

function sameInventory(inventory, snapshot) {
  const items = inventory.getItems();
  return items.length === snapshot.length && snapshot.every((entry, index) => entry
    ? items[index] === entry.item && items[index].getId() === entry.id
      && items[index].getAmount() === entry.amount && JSON.stringify(items[index].getMeta() ?? null) === entry.meta
    : !items[index]);
}

function warnsOnDeposit(furniture, item) {
  if (!item || item.getId() <= 0 || item.getAmount() < 1 || item.getMeta()
    || (furniture.storage?.[item.getId()] ?? 0) > 0) return false;
  const representative = storageItems(furniture).get(item.getId()), members = numericEnum(SET_MEMBERS_ENUM);
  return members.has(representative) && numericEnum(members.get(representative)).size > 1;
}

function confirmDeposit(event, context, position, inventory, apply) {
  const player = event.player, snapshot = inventorySnapshot(inventory);
  // The confirmation text and bulk trigger are this server's approximation.
  api.sendMultiChatboxPrompt(player, "Some sets must be complete to withdraw. Continue?", "Deposit", () => {
    if (!sameContext(event, context, position) || !isUltimate(player) || !sameInventory(inventory, snapshot)) return;
    const pin = { player, feature: "poh-costume-room", resume: () => {} };
    api.emitCustomEvent("bank-pin:guard", pin);
    if (pin.locked || !sameContext(event, context, position) || !isUltimate(player) || !sameInventory(inventory, snapshot)) return;
    apply();
  }, "Cancel", () => {});
}

function depositHouseItem(player, house, furniture, slot) {
  if (house.owner !== player || player.getPrivateArea() !== house || !house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture))) return false;
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() <= 0 || item.getAmount() < 1 || item.getMeta()) return false;
  const allowed = storageItems(furniture), set = allowed.get(item.getId());
  if (set == null) return false;
  const stored = furniture.storage ?? {};
  const countsTowardLimit = (representative) => furniture.hotspotKey !== "CAPE_RACK"
    || (numericEnum(SET_MEMBERS_ENUM).has(representative) && [...numericEnum(numericEnum(SET_MEMBERS_ENUM).get(representative)).values()].some(id => ItemDefinition.forId(id).getName().toLowerCase().includes("hood")));
  const used = new Set(Object.keys(stored).filter(id => stored[Number(id)] > 0).map(id => allowed.get(Number(id))).filter(id => id != null && countsTowardLimit(id)));
  if (countsTowardLimit(set) && !used.has(set) && used.size >= capacity(furniture)) { player.sendMessage("Upgrade this furniture to store more sets."); return false; }
  if (isUltimate(player)) {
    const id = item.getId();
    if ((stored[id] ?? 0) > 0) return false;
    const beforeItems = inventory.getItems().slice(), beforeValues = inventory.getCopiedItems(), beforeTotal = inventory.getAmount(id);
    inventory.deleteAtSlot(slot, 1, false);
    if (inventory.getAmount(id) !== beforeTotal - 1) {
      for (let index = 0; index < beforeItems.length; index++) {
        const value = beforeValues[index];
        beforeItems[index].setId(value.getId()).setAmount(value.getAmount()).setMeta(value.getMeta());
      }
      inventory.setItems(beforeItems);
      inventory.refreshItems();
      return false;
    }
    furniture.storage ??= stored;
    stored[id] = 1;
    player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
    inventory.refreshItems();
    return true;
  }
  const amount = item.getAmount();
  if (!Number.isSafeInteger((stored[item.getId()] ?? 0) + amount)) return false;
  const id = item.getId();
  inventory.deleteAtSlot(slot, amount);
  furniture.storage ??= stored;
  stored[id] = (stored[id] ?? 0) + amount;
  player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
  return true;
}

function withdrawHouseItem(player, house, furniture, id) {
  if (house.owner !== player || player.getPrivateArea() !== house || !house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture))) return false;
  const stored = furniture.storage;
  if (!stored || !(stored[id] > 0)) return false;
  const inventory = player.getInventory();
  const mode = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", mode);
  if (mode.mode === "ultimate") {
    const representative = storageItems(furniture).get(id);
    const members = numericEnum(SET_MEMBERS_ENUM);
    if (members.has(representative)) {
      const set = [...numericEnum(members.get(representative)).values()];
      const alternates = numericEnum(ALTERNATES_ENUM), alternateSets = numericEnum(ALTERNATE_SETS_ENUM);
      // Sets with alternatives or stackable members need their own verified transfer rules.
      if (new Set(set).size === set.length && set.every(member =>
        !alternates.has(member) && !alternateSets.has(member) && !ItemDefinition.forId(member).isStackable())) {
        if (!set.every(member => stored[member] > 0)) {
          player.sendMessage("You need the complete set to withdraw it.");
          return false;
        }
        if (inventory.getFreeSlots() < set.length) {
          player.sendMessage("Not enough space in your inventory.");
          return false;
        }
        // Nonstackable additions do not mutate existing item objects; retain them on rollback.
        const beforeItems = inventory.getItems().slice();
        for (const member of set) {
          const before = inventory.getAmount(member);
          inventory.add(new Item(member, 1), false);
          if (inventory.getAmount(member) !== before + 1) {
            inventory.setItems(beforeItems);
            inventory.refreshItems();
            return false;
          }
        }
        for (const member of set) if (--stored[member] === 0) delete stored[member];
        player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
        inventory.refreshItems();
        return true;
      }
    }
  }
  if (inventory.getFreeSlots() === 0 && !(ItemDefinition.forId(id).isStackable() && inventory.contains(id))) { player.sendMessage("Not enough space in your inventory."); return false; }
  const before = inventory.getAmount(id);
  inventory.addItem(new Item(id, 1));
  if (inventory.getAmount(id) !== before + 1) return false;
  if (--stored[id] === 0) delete stored[id];
  player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
  return true;
}

function listStorage(event, page = 0) {
  const context = currentFurniture(event);
  if (!context) return;
  const { house, furniture } = context;
  const entries = Object.entries(furniture.storage ?? {}).filter(([, amount]) => amount > 0);
  if (!entries.length) { event.player.sendMessage("This storage is empty."); return; }
  const options = [];
  for (const [id, amount] of entries.slice(page * 4, page * 4 + 4)) options.push(`${ItemDefinition.forId(Number(id)).getName()} x${amount}`, () => {
    if (house.owner !== event.player) { event.player.sendMessage("Only the owner can withdraw stored items."); return; }
    withdrawHouseItem(event.player, house, furniture, Number(id));
    listStorage(event, page);
  });
  if ((page + 1) * 4 < entries.length) options.push("More items", () => listStorage(event, page + 1));
  api.sendMultiChatboxPrompt(event.player, house.owner === event.player ? "Withdraw an item" : "View stored items", ...options);
}

function openHouseStorage(event) {
  const context = currentFurniture(event);
  if (!context) return false;
  const { house, furniture } = context;
  if (house.owner !== event.player) { listStorage(event); return true; }
  const { player } = event, position = positionOf(event.player), initialMode = playerMode(event.player);
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "poh-costume-room", resume: () => {
    if (sameContext(event, context, position) && playerMode(player) === initialMode) openHouseStorage(event);
  } };
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || playerMode(player) !== initialMode || !sameContext(event, context, position)) return true;
  api.sendMultiChatboxPrompt(event.player, "Costume storage", "Deposit inventory", () => {
    if (!sameContext(event, context, position) || playerMode(player) !== initialMode) return;
    const inventory = player.getInventory();
    const apply = () => {
      for (let slot = 0; slot < 28; slot++) depositHouseItem(player, house, furniture, slot);
      player.sendMessage("Stored eligible costume items. Use an item on the furniture to deposit it individually.");
    };
    if (isUltimate(player) && inventory.getItems().some(item => warnsOnDeposit(furniture, item))) {
      confirmDeposit(event, context, position, inventory, apply);
    } else apply();
  }, "Withdraw items", () => listStorage(event), "Cancel", () => {});
  return true;
}

function storeItemOnFurniture(event) {
  const context = currentFurniture(event);
  if (!context) return false;
  const { player } = event;
  if (context.house.owner !== player) { player.sendMessage("You cannot store that item here."); return true; }
  const inventory = player.getInventory(), item = inventory.getItems()[event.itemSlot], position = positionOf(player), initialMode = playerMode(player);
  if (!item || (event.item && event.item !== item) || (event.itemId != null && event.itemId !== item.getId())) {
    player.sendMessage("You cannot store that item here.");
    return true;
  }
  const beforePin = inventorySnapshot(inventory);
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "poh-costume-room", resume: () => {
    if (sameContext(event, context, position) && playerMode(player) === initialMode && sameInventory(inventory, beforePin)) storeItemOnFurniture(event);
  } };
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || playerMode(player) !== initialMode || !sameContext(event, context, position) || !sameInventory(inventory, beforePin)) return true;
  if (isUltimate(player) && warnsOnDeposit(context.furniture, item)) {
    confirmDeposit(event, context, position, inventory, () => {
      if (!depositHouseItem(player, context.house, context.furniture, event.itemSlot)) player.sendMessage("You cannot store that item here.");
    });
    return true;
  }
  if (!depositHouseItem(event.player, context.house, context.furniture, event.itemSlot)) event.player.sendMessage("You cannot store that item here.");
  return true;
}

Object.assign(module.exports, { storageItems, depositHouseItem, withdrawHouseItem, openHouseStorage, storeItemOnFurniture });
