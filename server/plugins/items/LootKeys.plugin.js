const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { ItemOnGroundManager } = require("../../src/main/typescript/elvarg/game/entity/impl/grounditem/ItemOnGroundManager");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const Food = require("./Food.plugin");
const Potions = require("./Potions.plugin");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ObjectManager } = require("../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { ForceMovement } = require("../../src/main/typescript/elvarg/game/model/ForceMovement");
const { ForceMovementTask } = require("../../src/main/typescript/elvarg/game/task/impl/ForceMovementTask");
const { ObjectIdentifiers } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");

const KEY_IDS = Object.freeze([ItemIdentifiers.LOOT_KEY, ItemIdentifiers.LOOT_KEY_2, ItemIdentifiers.LOOT_KEY_3, ItemIdentifiers.LOOT_KEY_4, ItemIdentifiers.LOOT_KEY_5]);
const KEY_ID_SET = new Set(KEY_IDS);
const KEY_DATA = "lootKey";
const MAX_KEYS = 5;
const LOOT_KEY_SKULL_ICON_BASE = 7;
const UNLOCK_ATTRIBUTE = "lootKeysUnlocked";
const ENABLED_ATTRIBUTE = "lootKeysEnabled";
const SETTINGS_ATTRIBUTE = "lootKeySettings";
const CHEST_ATTRIBUTE = "lootChestContents";
const CHEST_TAB_ATTRIBUTE = "lootChestTab";

const validItem = (item) => Number.isInteger(item?.id) && item.id > 0 && Number.isInteger(item?.amount) && item.amount > 0;
const isLootKey = (item) => KEY_ID_SET.has(item?.getId?.());
const serialiseItem = (item) => validItem({ id: item?.getId?.(), amount: item?.getAmount?.() }) ? { id: item.getId(), amount: item.getAmount(), meta: item.getMeta?.() ?? null } : null;
const keyItems = (key) => (key?.getMetaValue?.(KEY_DATA)?.items ?? []).filter(validItem);
const createKey = (items, index = 0) => new Item(KEY_IDS[Math.max(0, Math.min(MAX_KEYS - 1, index))], 1, { [KEY_DATA]: { items: items.map(serialiseItem).filter(Boolean) } });
const reindexKey = (key, index) => new Item(KEY_IDS[Math.max(0, Math.min(MAX_KEYS - 1, index))], 1, key?.getMeta?.());
const hasEnabledLootKeys = (player) => player?.getAttribute?.(ENABLED_ATTRIBUTE) === true;
// Legacy saves only wrote this boolean after buying keys (including disabling them).
const hasUnlockedLootKeys = (player) => player?.getAttribute?.(UNLOCK_ATTRIBUTE) === true ||
  typeof player?.getAttribute?.(ENABLED_ATTRIBUTE) === "boolean";
const setLootKeysEnabled = (player, enabled) => {
  if (enabled || hasUnlockedLootKeys(player)) player?.setAttribute?.(UNLOCK_ATTRIBUTE, true);
  player?.setAttribute?.(ENABLED_ATTRIBUTE, enabled === true);
};
const countKeys = (player) => (player?.getInventory?.()?.getValidItems?.() ?? []).filter(isLootKey).length;
const lootKeyCountByPlayer = new WeakMap();

function syncLootKeySkull(player) {
  const keyCount = countKeys(player);
  if (lootKeyCountByPlayer.get(player) === keyCount) return;
  lootKeyCountByPlayer.set(player, keyCount);
  player?.setSkullIconOverride?.(keyCount ? LOOT_KEY_SKULL_ICON_BASE + keyCount : null);
}

function getSettings(player) {
  const settings = player?.getAttribute?.(SETTINGS_ATTRIBUTE);
  return { includeSupplies: settings?.includeSupplies !== false, floorValue: Math.max(0, Math.trunc(Number(settings?.floorValue) || 0)) };
}

function setSettings(player, settings) {
  player?.setAttribute?.(SETTINGS_ATTRIBUTE, {
    includeSupplies: settings?.includeSupplies !== false,
    floorValue: Math.max(0, Math.trunc(Number(settings?.floorValue) || 0)),
  });
}

function isEligibleKill(killer, victim) {
  return killer && victim && killer !== victim && killer.isPlayer?.() && victim.isPlayer?.() &&
    !killer.isPlayerBot?.() && Wilderness.isIn(killer) && Wilderness.isIn(victim) &&
    hasEnabledLootKeys(killer) && countKeys(killer) < MAX_KEYS;
}

function itemValue(item) {
  return (ItemDefinition.forId(item?.id ?? item?.getId?.())?.getValue?.() ?? 0) * (item?.amount ?? item?.getAmount?.() ?? 0);
}

const totalValue = (items) => items.reduce((total, item) => total + itemValue(item), 0);
const isSupply = (item) => Food.isFoodItem(item?.getId?.() ?? item?.id) || Potions.isPotionItem(item?.getId?.() ?? item?.id);
const shouldStoreItem = (player, item) => {
  const settings = getSettings(player);
  return (settings.includeSupplies || !isSupply(item)) && (settings.floorValue <= 0 || itemValue(item) < settings.floorValue);
};
const describeKey = (key) => {
  const items = keyItems(key);
  const value = totalValue(items);
  return { items, value, description: `${items.length} item${items.length === 1 ? "" : "s"} (${Math.floor(value).toLocaleString("en-US")} coins)` };
};

const chestItems = (player) => (player?.getAttribute?.(CHEST_ATTRIBUTE) ?? []).filter(validItem);
const setChestItems = (player, items) => player?.setAttribute?.(CHEST_ATTRIBUTE, items.filter(validItem));
const chestTab = (player) => Math.max(0, Math.min(MAX_KEYS - 1, Math.trunc(Number(player?.getAttribute?.(CHEST_TAB_ATTRIBUTE)) || 0)));
const setChestTab = (player, tab) => player?.setAttribute?.(CHEST_TAB_ATTRIBUTE, Math.max(0, Math.min(MAX_KEYS - 1, Math.trunc(Number(tab) || 0))));

function openKey(player, slot, expectedKey = null) {
  const key = player?.getInventory?.()?.getItems?.()?.[slot];
  if (!isLootKey(key) || (expectedKey && key !== expectedKey) || chestItems(player).length) return false;
  const items = keyItems(key);
  if (!items.length) {
    player.sendMessage("This Loot key has no recoverable loot and was not consumed.");
    return false;
  }
  player.getInventory().deleteAtSlot(slot, 1);
  syncLootKeySkull(player);
  setChestItems(player, items);
  setChestTab(player, KEY_IDS.indexOf(key.getId()));
  return true;
}

function hasSameItem(container, item) {
  return container.getValidItems().some((existing) => existing.getId() === item.id && JSON.stringify(existing.getMeta?.() ?? null) === JSON.stringify(item.meta ?? null));
}

function bankForItem(player, item) {
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && hasSameItem(player.getBank(tab), item)) return player.getBank(tab);
  }
  const preferred = player.getBank(Bank.getTabForItem(player, item.id));
  if (preferred.getFreeSlots() > 0) return preferred;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

function noteId(item) {
  const definition = ItemDefinition.forId(item.id);
  const id = definition.getNoteId?.() ?? -1;
  const note = id >= 0 ? ItemDefinition.forId(id) : null;
  return note?.isNoted?.() && note.getName?.().toLowerCase() === definition.getName?.().toLowerCase() ? id : item.id;
}

function takeChestItem(player, index, destination, asNotes = false, requestedAmount = Number.MAX_SAFE_INTEGER) {
  const items = chestItems(player);
  const item = items[index];
  if (!item) return false;
  const amount = Math.max(1, Math.min(item.amount, Math.trunc(Number(requestedAmount) || 0)));
  const moved = { ...item, id: destination === "bank" ? ItemDefinition.forId(item.id).unNote() : asNotes ? noteId(item) : item.id, amount };
  if (destination === "inventory") {
    const inventory = player.getInventory();
    const stackable = ItemDefinition.forId(moved.id).isStackable?.() === true;
    if (!((stackable && hasSameItem(inventory, moved)) || inventory.getFreeSlots() >= (stackable ? 1 : amount))) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    inventory.add(new Item(moved.id, moved.amount, moved.meta), false);
    inventory.refreshItems();
  } else {
    const bank = bankForItem(player, moved);
    if (!bank) {
      player.sendMessage("You need more space in your bank.");
      return true;
    }
    bank.add(new Item(moved.id, moved.amount, moved.meta), false);
  }
  item.amount -= amount;
  if (item.amount <= 0) items.splice(index, 1);
  setChestItems(player, items);
  return true;
}

const takeAllChestItems = (player, destination, asNotes) => {
  for (let index = chestItems(player).length - 1; index >= 0; index--) takeChestItem(player, index, destination, asNotes);
  return true;
};
const destroyChestItem = (player, index, amount = Number.MAX_SAFE_INTEGER) => {
  const items = chestItems(player);
  if (!items[index] || !Number.isSafeInteger(amount) || amount <= 0) return false;
  items[index].amount -= Math.min(items[index].amount, amount);
  if (items[index].amount === 0) items.splice(index, 1);
  setChestItems(player, items);
  return true;
};

const LootKeys = { CHEST_ATTRIBUTE, CHEST_TAB_ATTRIBUTE, ENABLED_ATTRIBUTE, KEY_IDS, MAX_KEYS, SETTINGS_ATTRIBUTE, UNLOCK_ATTRIBUTE, chestItems, chestTab, countKeys, createKey, describeKey, destroyChestItem, getSettings, hasEnabledLootKeys, hasUnlockedLootKeys, isEligibleKill, isLootKey, isSupply, keyItems, openKey, reindexKey, setChestItems, setChestTab, setLootKeysEnabled, setSettings, shouldStoreItem, takeAllChestItems, takeChestItem, totalValue };

const pendingLoot = new WeakMap();
const recentlyDefeated = new WeakMap();
const warnedAtKeyLimit = new WeakSet();
const UNLOCK_COST = 1_000_000;
const RECENT_DEATH_WINDOW_MS = 6_000;
const DESTROY_VALUE_LIMIT = 1_000_000;

function pending(victim) {
  let state = pendingLoot.get(victim);
  if (!state) pendingLoot.set(victim, state = { drops: [], keys: [] });
  return state;
}

function killerCannotReceiveKey(killer) {
  return killer?.isDyingReturn?.() === true || Date.now() - (recentlyDefeated.get(killer) ?? 0) < RECENT_DEATH_WINDOW_MS;
}

function queueDrop(event) {
  const state = pending(event.player);
  if (LootKeys.isLootKey(event.item)) {
    state.keys.push(event.item);
    event.handled = true; // Keys are never kept on the defeated player.
    return;
  }
  if (!LootKeys.isEligibleKill(event.killer, event.player) || killerCannotReceiveKey(event.killer)) return;
  if (!LootKeys.shouldStoreItem(event.killer, event.item)) return;
  state.drops.push(event);
  event.suppressDefaultDrop = true;
}

function giveKey(killer, key, location) {
  const receivedKey = LootKeys.reindexKey(key, LootKeys.countKeys(killer));
  if (killer.getInventory().getFreeSlots() > 0) {
    killer.getInventory().addItem(receivedKey);
    syncLootKeySkull(killer);
    return true;
  }
  ItemOnGroundManager.registerNonGlobals(killer, receivedKey, location.clone());
  return false;
}

function createLootKey({ killer, victim }) {
  const state = pendingLoot.get(victim);
  pendingLoot.delete(victim);
  recentlyDefeated.set(victim, Date.now());
  if (!state || !LootKeys.isEligibleKill(killer, victim) || killerCannotReceiveKey(killer)) return;

  // Later hooks can change eligibility, including the bot's selected equipment drops.
  const drops = state.drops.filter((entry) => entry.dropEligible === true && !entry.handled && entry.item?.isValid?.()).map((entry) => entry.item);
  const candidates = drops.length ? [LootKeys.createKey(drops, LootKeys.countKeys(killer))] : [];
  candidates.push(...state.keys.sort((left, right) => LootKeys.describeKey(right).value - LootKeys.describeKey(left).value));
  const available = LootKeys.MAX_KEYS - LootKeys.countKeys(killer);
  const received = candidates.slice(0, available).map((key) => giveKey(killer, key, victim.getLocation()));
  if (drops.length) killer.sendMessage(received[0]
    ? "Your opponent's loot has been placed in a Loot key."
    : "Your inventory is full, so your Loot key has been placed on the ground.");
}

function checkOrDestroy(api, event) {
  if (!LootKeys.isLootKey(event.item)) return;
  const option = String(event.option ?? "").toLowerCase();
  if (option === "check") {
    event.player.sendMessage(`This Loot key contains ${LootKeys.describeKey(event.item).description}.`);
    event.handled = true;
    return;
  }
  if (option !== "destroy") return;
  event.handled = true;
  if (!Wilderness.isIn(event.player) || LootKeys.describeKey(event.item).value >= DESTROY_VALUE_LIMIT) {
    event.player.sendMessage("This Loot key cannot be destroyed here or is worth too much.");
    return;
  }
  const key = event.item;
  api.sendMultiChatboxPrompt(event.player, "Destroy Loot key? The loot inside will be destroyed.", "Destroy", () => {
    const slot = event.player.getInventory().getItems().indexOf(key);
    if (slot >= 0) {
      event.player.getInventory().deleteAtSlot(slot, 1);
      syncLootKeySkull(event.player);
    }
  }, "Cancel", () => {});
}

function setFloorValue(player) {
  player.setEnteredAmountAction({ execute: (amount) => {
    if (!Number.isInteger(amount) || amount < 0) return;
    LootKeys.setSettings(player, { ...LootKeys.getSettings(player), floorValue: amount });
    player.sendMessage(`Items worth ${amount.toLocaleString("en-US")} coins or more will drop to the floor.`);
  }});
  player.getPacketSender().sendEnterAmountPrompt("Set Loot Key floor-value threshold (0 to disable)");
}

function openSkullyPrompt(api, player) {
  const enabled = LootKeys.hasEnabledLootKeys(player);
  const settings = LootKeys.getSettings(player);
  api.sendMultiChatboxPrompt(
    player, "Skully's Loot Keys",
    enabled ? "Disable Loot Keys" : LootKeys.hasUnlockedLootKeys(player) ? "Enable Loot Keys" : "Unlock Loot Keys (1,000,000 coins)", () => {
      if (LootKeys.hasEnabledLootKeys(player)) {
        LootKeys.setLootKeysEnabled(player, false);
        player.sendMessage("You will now receive normal PvP loot piles.");
      } else if (!LootKeys.hasUnlockedLootKeys(player) && player.getInventory().getAmount(ItemIdentifiers.COINS) < UNLOCK_COST) {
        player.sendMessage("You need 1,000,000 coins to unlock Loot Keys.");
      } else {
        if (!LootKeys.hasUnlockedLootKeys(player)) player.getInventory().delete(ItemIdentifiers.COINS, UNLOCK_COST);
        LootKeys.setLootKeysEnabled(player, true);
        player.sendMessage("You will now receive Loot keys for Wilderness player kills.");
      }
    },
    `Supplies in keys: ${settings.includeSupplies ? "On" : "Off"}`, () => {
      LootKeys.setSettings(player, { ...settings, includeSupplies: !settings.includeSupplies });
      openSkullyPrompt(api, player);
    },
    `Floor-value threshold: ${settings.floorValue.toLocaleString("en-US")}`, () => setFloorValue(player),
    "What are Loot Keys?", () => player.sendMessage("Loot Keys hold a defeated player's dropped items in one inventory slot. Open them at a Loot Chest."),
    "Never mind", () => {}
  );
}

// Loot Chest
const CHEST_NAME = "Loot Chest";
const GROUP_ID = 742;
const MAIN_MODAL_UID = (161 << 16) | 16;
const CONTENT_UID = (GROUP_ID << 16) | 5;
const INVENTORY_IDS = [558, 559, 560, 561, 562];
const WITHDRAW_ALL_INVENTORY_UID = (GROUP_ID << 16) | 27;
const WITHDRAW_ALL_BANK_UID = (GROUP_ID << 16) | 34;
const DESTROY_UID = (GROUP_ID << 16) | 12;
const DESTROY_CONFIRM_UID = (GROUP_ID << 16) | 43;
const DESTROY_CANCEL_UID = (GROUP_ID << 16) | 44;
const ITEM_MODE_UID = (GROUP_ID << 16) | 16;
const NOTE_MODE_UID = (GROUP_ID << 16) | 21;
const ALL_ACTION_FLAGS = (1 << 11) - 2;
const CHEST_OBJECT_IDS = new Set([43468, 43469, 43484, 43485, 44780, 44781]);
const FEROX_CHEST = { x: 3138, y: 3626, z: 0, type: 10, face: 2 };
const FEROX_REGION_ID = ((FEROX_CHEST.x >> 6) << 8) | (FEROX_CHEST.y >> 6);
const uiState = new WeakMap();
let feroxChestInstalled = false;
let TaskManager;

function installFeroxChest({ regionId }) {
  if (regionId !== FEROX_REGION_ID || feroxChestInstalled) return;
  feroxChestInstalled = true;
  ObjectManager.register(new GameObject(ObjectIdentifiers.LOOT_CHEST,
    new Location(FEROX_CHEST.x, FEROX_CHEST.y, FEROX_CHEST.z), FEROX_CHEST.type, FEROX_CHEST.face, null), true);
}

function stateFor(player) {
  let state = uiState.get(player);
  if (!state) uiState.set(player, state = { notes: false });
  return state;
}

function inventoryKeys(player) {
  return (player.getInventory().getItems() ?? []).map((item, slot) => ({ item, slot }))
    .filter(({ item }) => LootKeys.isLootKey(item));
}

function nativeInventories(player) {
  const tab = LootKeys.chestTab(player);
  const slots = LootKeys.chestItems(player).slice(0, 28).map((item, slot) => ({ slot, itemId: item.id, quantity: item.amount }));
  return Object.fromEntries(INVENTORY_IDS.map((id, index) => [id, { capacity: 28, slots: index === tab ? slots : [] }]));
}

function sendNativeState(player) {
  const tab = LootKeys.chestTab(player);
  player.getPacketSender().sendInterfaceScript(0, [], undefined, { 4842: tab, 4843: stateFor(player).notes ? 1 : 0 }, nativeInventories(player));
}

function sendActionFlags(player) {
  player.getPacketSender().sendInterfaceFlagsRange(CONTENT_UID, 0, 139, ALL_ACTION_FLAGS);
  [WITHDRAW_ALL_INVENTORY_UID, WITHDRAW_ALL_BANK_UID, DESTROY_UID, DESTROY_CONFIRM_UID, DESTROY_CANCEL_UID, ITEM_MODE_UID, NOTE_MODE_UID]
    .forEach((uid) => player.getPacketSender().sendInterfaceFlagsRange(uid, -1, -1, 1 << 1));
}

function refreshChest(player) {
  const tab = LootKeys.chestTab(player);
  sendActionFlags(player);
  player.getPacketSender().sendInterfaceScript(8006, [], undefined, { 4842: tab, 4843: stateFor(player).notes ? 1 : 0 }, nativeInventories(player));
}

function openChest(player) {
  sendNativeState(player);
  player.setInterfaceId(GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0);
  refreshChest(player);
  return true;
}

function openChestKey(player, slot, key) {
  return LootKeys.openKey(player, slot, key) && openChest(player);
}

function openKeySelection(api, player) {
  if (LootKeys.chestItems(player).length) return openChest(player);
  const keys = inventoryKeys(player);
  if (!keys.length) {
    player.sendMessage("You do not currently have any Wilderness Loot Keys. For more information, speak to Skully in the Ferox Enclave.");
    return true;
  }
  if (keys.length === 1) return openChestKey(player, keys[0].slot, keys[0].item);
  api.sendMultiChatboxPrompt(player, "Choose a Loot key", ...keys.flatMap(({ item, slot }, index) => [
    `Loot key ${index + 1}: ${LootKeys.describeKey(item).description}`,
    () => openChestKey(player, slot, item),
  ]));
  return true;
}

function amountFor(action, item) {
  return ({ 1: 1, 2: 5, 3: 10, 5: item.amount, 7: item.amount }[action]);
}

function handleContentAction(player, event) {
  if (player.getInterfaceId() !== GROUP_ID || event.buttonId !== CONTENT_UID || !Number.isInteger(event.slot)) return false;
  const tab = Math.floor(event.slot / 28);
  const index = event.slot % 28;
  if (tab !== LootKeys.chestTab(player)) return false;
  const item = LootKeys.chestItems(player)[index];
  if (!item) return true;
  const state = stateFor(player);
  if (event.action === 4 || event.action === 6 || event.action === 8) {
    const destination = event.action === 6 ? "bank" : "inventory";
    player.setEnteredAmountAction({ execute: (amount) => {
      if (player.getInterfaceId() !== GROUP_ID || LootKeys.chestItems(player)[index] !== item) return;
      if (Number.isInteger(amount) && amount > 0) {
        if (event.action === 8) LootKeys.destroyChestItem(player, index, amount);
        else LootKeys.takeChestItem(player, index, destination, destination === "inventory" && state.notes, amount);
        refreshChest(player);
      }
    }});
    player.getPacketSender().sendEnterAmountPrompt(event.action === 8 ? "How many would you like to destroy?" : "How many would you like to withdraw?");
    return true;
  }
  if (event.action === 9) LootKeys.destroyChestItem(player, index);
  else {
    const amount = amountFor(event.action, item);
    if (amount === undefined) return event.action === 10;
    LootKeys.takeChestItem(player, index, event.action >= 6 ? "bank" : "inventory", event.action < 6 && state.notes, amount);
  }
  refreshChest(player);
  return true;
}

function handleChestInterfaceAction(player, event) {
  if (player.getInterfaceId() !== GROUP_ID) return false;
  if (handleContentAction(player, event)) return true;
  const state = stateFor(player);
  switch (event.buttonId) {
    case ITEM_MODE_UID: state.notes = false; break;
    case NOTE_MODE_UID: state.notes = true; break;
    case WITHDRAW_ALL_INVENTORY_UID: LootKeys.takeAllChestItems(player, "inventory", state.notes); break;
    case WITHDRAW_ALL_BANK_UID: LootKeys.takeAllChestItems(player, "bank", false); break;
    case DESTROY_UID:
    case DESTROY_CANCEL_UID: return true;
    case DESTROY_CONFIRM_UID:
      LootKeys.setChestItems(player, []);
      player.getPacketSender().sendInterfaceRemoval();
      return true;
    default: return false;
  }
  refreshChest(player);
  return true;
}

// Ferox Enclave
const BARRIER_IDS = [39652, 39653];
const BOUNDARY = [[3126,3618],[3130,3618],[3131,3617],[3139,3617],[3140,3618],[3144,3618],[3144,3620],[3150,3626],[3153,3626],[3154,3627],[3156,3627],[3156,3634],[3155,3634],[3155,3636],[3156,3636],[3156,3647],[3148,3647],[3147,3646],[3139,3646],[3138,3645],[3138,3640],[3125,3640],[3125,3633],[3123,3631],[3123,3623],[3124,3622],[3126,3622]];

function tile(location) {
  const value = Location.readTile(location);
  return value && value.z === 0 ? value : null;
}

function isInsideEnclave(location) {
  const point = tile(location);
  if (!point) return false;
  let inside = false;
  for (let index = 0, previous = BOUNDARY.length - 1; index < BOUNDARY.length; previous = index++) {
    const [x, y] = BOUNDARY[index];
    const [lastX, lastY] = BOUNDARY[previous];
    if ((y > point.y) !== (lastY > point.y) && point.x < ((lastX - x) * (point.y - y)) / (lastY - y) + x) inside = !inside;
  }
  return inside;
}

function isSafeLocation(location) {
  const point = tile(location);
  if (isInsideEnclave(point)) return true;
  if (!point) return false;
  for (let x = point.x - 1; x <= point.x + 1; x++) {
    for (let y = point.y - 1; y <= point.y + 1; y++) {
      if ((MapObjects.mapObjects.get(MapObjects.getHash(x, y, point.z)) ?? []).some((object) => BARRIER_IDS.includes(object.getId()))) return true;
    }
  }
  return false;
}

function isTeleblocked(player) {
  return player?.getCombat?.()?.getTeleblockTimer?.()?.finished?.() === false;
}

function crossingTarget(playerLocation, object) {
  const source = tile(playerLocation);
  const barrier = tile(object?.getLocation?.());
  const face = object?.getFace?.();
  if (!source || !barrier || !Number.isInteger(face)) return null;

  // These are type-0 walls. Their map face is the authoritative crossing axis.
  // Use the routed player's current tile: sourceLocation is captured before routing.
  const delta = face === 0 ? { x: source.x < barrier.x ? 1 : -1, y: 0 }
    : face === 2 ? { x: source.x > barrier.x ? -1 : 1, y: 0 }
    : face === 1 ? { x: 0, y: source.y > barrier.y ? -1 : 1 }
    : face === 3 ? { x: 0, y: source.y < barrier.y ? 1 : -1 }
    : null;
  if (!delta) return null;
  const target = { x: source.x + delta.x, y: source.y + delta.y, z: source.z };
  return { entering: isInsideEnclave(target), target, delta };
}

function passThrough({ player, object }) {
  const current = tile(player.getLocation?.());
  const crossing = crossingTarget(current, object);
  if (!crossing) return true;
  if (crossing.entering && isTeleblocked(player)) {
    player.sendMessage("A magical force prevents you from entering the Ferox Enclave while teleblocked.");
    return true;
  }
  if (current && TaskManager && player.getForceMovement?.() == null) {
    const direction = crossing.delta.y > 0 ? 0 : crossing.delta.y < 0 ? 2 : crossing.delta.x > 0 ? 1 : 3;
    TaskManager.submit(new ForceMovementTask(player, 1, new ForceMovement(
      player.getLocation().clone(), new Location(crossing.delta.x, crossing.delta.y), 0, 30, direction, -1,
    )));
  }
  return true;
}

function denySafeZoneAttack(event) {
  if (event.allow !== null || event.attacker?.isPlayer?.() !== true || event.target?.isPlayer?.() !== true) return;
  if (!isSafeLocation(event.attacker.getLocation()) && !isSafeLocation(event.target.getLocation())) return;
  if (!isTeleblocked(event.attacker) && !isTeleblocked(event.target)) event.allow = false;
}

module.exports = {
  name: "LootKeys",
  // Potions is read-only classification data; depending on its lifecycle would
  // defer this named Talk-to handler behind the generic NpcDialogues fallback.
  dependsOn: ["Wilderness", "Food"],
  register(api) {
    TaskManager = api.getTaskManager();
    api.persistAttribute(LootKeys.UNLOCK_ATTRIBUTE);
    api.persistAttribute(LootKeys.ENABLED_ATTRIBUTE);
    api.persistAttribute(LootKeys.SETTINGS_ATTRIBUTE);
    api.persistAttribute(LootKeys.CHEST_ATTRIBUTE);
    api.persistAttribute(LootKeys.CHEST_TAB_ATTRIBUTE);
    api.onPlayerLogin(({ player }) => syncLootKeySkull(player));
    // ponytail: scan the 28-slot inventory per tick; use inventory-change hooks if this becomes hot.
    api.onPlayerProcess(({ player }) => syncLootKeySkull(player));
    api.onPlayerLogout(({ player }) => lootKeyCountByPlayer.delete(player));
    api.onPlayerDeathItemDrop((event) => {
      if (LootKeys.countKeys(event.killer) < LootKeys.MAX_KEYS) warnedAtKeyLimit.delete(event.killer);
      if (LootKeys.hasEnabledLootKeys(event.killer) && LootKeys.countKeys(event.killer) >= LootKeys.MAX_KEYS && !warnedAtKeyLimit.has(event.killer)) {
        warnedAtKeyLimit.add(event.killer);
        event.killer.sendMessage("You have reached the limit of 5 loot keys.");
      }
      queueDrop(event);
    });
    api.onPlayerDefeated((event) => { warnedAtKeyLimit.delete(event.victim); createLootKey(event); });
    api.onCanBankItem((event) => {
      if (LootKeys.isLootKey(event.item)) {
        event.player.sendMessage("Loot keys cannot be banked.");
        event.allow = false;
      }
    });
    api.onItemAction((event) => checkOrDestroy(api, event));
    api.onNpcInteraction("Skully", { "Talk-to": ({ player }) => { openSkullyPrompt(api, player); return true; } });
    api.onRegionLoaded(installFeroxChest);
    api.onObjectInteraction(CHEST_NAME, { Loot: ({ player }) => openKeySelection(api, player) });
    api.onItemOnObject((event) => {
      if (!CHEST_OBJECT_IDS.has(event.objectId) || !LootKeys.isLootKey(event.item)) return;
      event.handled = true;
      if (LootKeys.chestItems(event.player).length) openChest(event.player);
      else openChestKey(event.player, event.itemSlot, event.item);
    });
    api.onInterfaceActionClick((event) => {
      if (handleChestInterfaceAction(event.player, event)) event.handled = true;
    });
    api.onObjectFirstClick(BARRIER_IDS, passThrough);
    api.onCanAttack(denySafeZoneAttack);
  },
  ...LootKeys,
  isSafeLocation,
  isInsideEnclave,
  _test: { createLootKey, queueDrop, handleInterfaceAction: handleChestInterfaceAction, nativeInventories, open: openChest, openKeySelection, crossingTarget, denySafeZoneAttack, isInsideEnclave, isSafeLocation, passThrough },
};
