"use strict";

const { api, Animation, CacheDefinitions, ChatType, DialogueChainBuilder, Item, ItemDefinition, StatementDialogue, Task, TaskManager } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Ids = require("./Ids.Construction");
const Instance = require("./Instance.Construction");
// Native costume-room enums: set representatives, set members, and alternatives.
const STORAGE_ENUMS = {
  MAGIC_WARDROBE: [3289], ARMOUR_CASE: [3290], FANCY_DRESS_BOX: [3291],
  CAPE_RACK: [3292], TREASURE_CHEST: [3293, 3294, 3295, 3296, 3297, 3298], TOY_BOX: [3299],
};
const TIER_NAMES = ["Beginner", "Easy", "Medium", "Hard", "Elite", "Master"];
/** A numeric cache enum; the costume room's are all obj -> obj or int -> obj. */
function numericEnum(id) {
  const values = CacheDefinitions.getEnumValues(id);
  if (!values.size) throw new Error(`Missing costume storage enum ${id}`);
  return values;
}
// The set members of each representative, and the alternatives an item can stand for.
const SET_MEMBERS_ENUM = 3077, ALTERNATES_ENUM = 3303, ALTERNATE_SETS_ENUM = 3304;

// The storage interface (poh_costumes over the inventory, poh_costumes_side beside it). Its init
// script (poh_costumes_init, 3532) takes the furniture's enum, whether the viewer may change the
// storage, and whether to reset the search and scroll; it draws one row per enum entry, each
// 44 components long, and counts what is stored by obj from the poh_costumes inv.
const MAIN = Ids.iface("poh_costumes");
const SIDE = Ids.iface("poh_costumes_side");
const ITEMS = Ids.component("poh_costumes:items");
const SIDE_ITEMS = Ids.component("poh_costumes_side:items");
const TIER = Ids.component("poh_costumes:tier");
const MODE = Ids.component("poh_costumes:mode");
const DEPOSIT_ALL = Ids.component("poh_costumes:depositall");
const SIDE_MODAL = Ids.component("toplevel_osrs_stretch:sidemodal");
const INV = CacheDefinitions.getInventoryId("poh_costumes");
const PLAYER_INV = CacheDefinitions.getInventoryId("inv");
const VARP_TIERS = Ids.varp("if2"); // the chest's highest tier, -1 for other furniture
const VARBIT_MODE = Ids.varbit("poh_costumes_mode");
const MODE_ATTRIBUTE = "construction:costume-storage-mode";
const INIT_SCRIPT = 3532, INV_INIT_SCRIPT = 149, MAIN_MODAL_BACKGROUND_SCRIPT = 917;
const ROW_COMPONENTS = 44;
const OP1 = 1 << 1, OP10 = 1 << 10, DEPTH1 = 1 << 17, DRAG_TARGET = 1 << 20;
const MODAL = 0;
const PICKUP = Ids.seq("human_pickuptable");
const STORE_SOUND = 2238;
// Deposit-all: the rows taken each tick, and the wait before the interface comes back.
const ROWS_PER_TICK = 4, REOPEN_TICKS = 3, NOTHING_TICKS = 2;

/** player -> the storage they have open: { event, house, furniture, tier, position, owner } */
const openFor = new WeakMap();
/** player -> their deposit-all in progress */
const depositing = new WeakMap();

function storageItems(furniture) {
  const result = new Map();
  let enums = STORAGE_ENUMS[furniture.hotspotKey];
  if (!enums) return result;
  if (furniture.hotspotKey === "TREASURE_CHEST") enums = enums.slice(0, chestTiers(furniture));
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

/** How many clue tiers a treasure chest holds: oak beginner and easy, teak to medium, mahogany all (Wiki). */
function chestTiers(furniture) {
  return furniture.buildableKey.startsWith("OAK") ? 2 : furniture.buildableKey.startsWith("TEAK") ? 3 : 6;
}

/** The enum the interface shows: the furniture's own, or the chosen tier's for a treasure chest. */
function rowsEnum(furniture, tier = 0) {
  const enums = STORAGE_ENUMS[furniture.hotspotKey];
  return furniture.hotspotKey === "TREASURE_CHEST" ? enums[Math.min(tier, chestTiers(furniture) - 1)] : enums[0];
}

/** The set members of a representative, or just itself. */
function setOf(representative) {
  const members = numericEnum(SET_MEMBERS_ENUM);
  return members.has(representative) ? [...numericEnum(members.get(representative)).values()] : [representative];
}

function capacity(furniture) {
  const key = furniture.buildableKey;
  if (furniture.hotspotKey === "ARMOUR_CASE") return key.startsWith("OAK") ? 25 : key.startsWith("TEAK") ? 50 : Infinity;
  if (furniture.hotspotKey === "MAGIC_WARDROBE") return ({ OAK_MAGIC_WARDROBE: 7, CARVED_OAK_MAGIC_WARDROBE: 14, TEAK_MAGIC_WARDROBE: 21, CARVED_TEAK_MAGIC_WARDROBE: 28, MAHOGANY_MAGIC_WARDROBE: 35, GILDED_MAGIC_WARDROBE: 42 })[key] ?? Infinity;
  if (furniture.hotspotKey === "CAPE_RACK") return ({ OAK_CAPE_RACK: 0, TEAK_CAPE_RACK: 1, MAHOGANY_CAPE_RACK: 5, GILDED_CAPE_RACK: 10, MARBLE_CAPE_RACK: Infinity })[key] ?? Infinity;
  if (furniture.hotspotKey === "FANCY_DRESS_BOX") return key.startsWith("OAK") ? 2 : key.startsWith("TEAK") ? 4 : Infinity;
  return Infinity;
}

/** The line for furniture at its limit: an oak cape rack holds no capes of accomplishment. */
function limitMessage(furniture) {
  if (furniture.hotspotKey === "CAPE_RACK" && capacity(furniture) === 0) return "You'll need a better cape rack to store capes of accomplishment.";
  return "Upgrade this furniture to store more sets.";
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

function inHouse(player, house, furniture) {
  return house.owner === player && player.getPrivateArea() === house
    && house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture));
}

/**
 * Stores the item in `slot`: "stored", or why not ("wrong" item, the furniture's "limit", or
 * "refused" for anything else, an Ultimate's duplicate among them).
 */
function depositSlot(player, house, furniture, slot) {
  if (!inHouse(player, house, furniture)) return "refused";
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() <= 0 || item.getAmount() < 1) return "refused";
  if (item.getMeta()) return "wrong";
  const allowed = storageItems(furniture), set = allowed.get(item.getId());
  if (set == null) return "wrong";
  const stored = furniture.storage ?? {};
  const countsTowardLimit = (representative) => furniture.hotspotKey !== "CAPE_RACK"
    || (numericEnum(SET_MEMBERS_ENUM).has(representative) && [...numericEnum(numericEnum(SET_MEMBERS_ENUM).get(representative)).values()].some(id => ItemDefinition.forId(id).getName().toLowerCase().includes("hood")));
  const used = new Set(Object.keys(stored).filter(id => stored[Number(id)] > 0).map(id => allowed.get(Number(id))).filter(id => id != null && countsTowardLimit(id)));
  if (countsTowardLimit(set) && !used.has(set) && used.size >= capacity(furniture)) return "limit";
  if (isUltimate(player)) {
    const id = item.getId();
    if ((stored[id] ?? 0) > 0) return "refused";
    const beforeItems = inventory.getItems().slice(), beforeValues = inventory.getCopiedItems(), beforeTotal = inventory.getAmount(id);
    inventory.deleteAtSlot(slot, 1, false);
    if (inventory.getAmount(id) !== beforeTotal - 1) {
      for (let index = 0; index < beforeItems.length; index++) {
        const value = beforeValues[index];
        beforeItems[index].setId(value.getId()).setAmount(value.getAmount()).setMeta(value.getMeta());
      }
      inventory.setItems(beforeItems);
      inventory.refreshItems();
      return "refused";
    }
    furniture.storage ??= stored;
    stored[id] = 1;
    player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
    inventory.refreshItems();
    return "stored";
  }
  const amount = item.getAmount();
  if (!Number.isSafeInteger((stored[item.getId()] ?? 0) + amount)) return "refused";
  const id = item.getId();
  inventory.deleteAtSlot(slot, amount);
  furniture.storage ??= stored;
  stored[id] = (stored[id] ?? 0) + amount;
  player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
  return "stored";
}

function depositHouseItem(player, house, furniture, slot) {
  const result = depositSlot(player, house, furniture, slot);
  if (result === "limit") player.sendMessage(limitMessage(furniture));
  return result === "stored";
}

/** One stored `id` into the inventory, or false with the full-inventory line. */
function withdrawHouseItem(player, house, furniture, id) {
  if (!inHouse(player, house, furniture)) return false;
  const stored = furniture.storage;
  if (!stored || !(stored[id] > 0)) return false;
  const inventory = player.getInventory();
  if (isUltimate(player)) {
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
  if (!fits(inventory, id)) { player.sendMessage("Your inventory is too full to take it."); return false; }
  const before = inventory.getAmount(id);
  inventory.addItem(new Item(id, 1));
  if (inventory.getAmount(id) !== before + 1) return false;
  if (--stored[id] === 0) delete stored[id];
  player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
  return true;
}

function fits(inventory, id) {
  return inventory.getFreeSlots() > 0 || (ItemDefinition.forId(id).isStackable() && inventory.contains(id));
}

/** The stored ids a row stands for, in the set's own order. */
function storedForRow(furniture, representative) {
  const allowed = storageItems(furniture), order = setOf(representative);
  const rank = (id) => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
  return Object.keys(furniture.storage ?? {}).map(Number)
    .filter(id => furniture.storage[id] > 0 && allowed.get(id) === representative)
    .sort((a, b) => rank(a) - rank(b) || a - b);
}

/**
 * Withdraw on a row: one of every stored piece of its set, as many as the inventory takes. An
 * Ultimate's set comes out whole or not at all.
 */
function withdrawRow(player, house, furniture, representative) {
  const ids = storedForRow(furniture, representative);
  if (!ids.length) return false;
  if (isUltimate(player) || ids.length === 1 && setOf(representative).length === 1) return withdrawHouseItem(player, house, furniture, ids[0]);
  const inventory = player.getInventory();
  if (!ids.some(id => fits(inventory, id))) {
    player.sendMessage("You don't have enough inventory space to take anything.");
    return false;
  }
  let taken = false;
  for (const id of ids) if (fits(inventory, id) && withdrawHouseItem(player, house, furniture, id)) taken = true;
  return taken;
}

// ---------------------------------------------------------------- the interface

function sendStored(player, furniture) {
  const entries = Object.entries(furniture.storage ?? {}).filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id: Number(id), amount }));
  player.getPacketSender().sendInventory(INV, Math.max(1, entries.length), entries);
}

/**
 * Opens the storage: the list as the main modal, and for the owner the inventory as
 * the side modal with Store on each item. `reset` clears the search and scroll.
 */
function openInterface(player, state, reset) {
  const { furniture, owner } = state;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendConfig(VARP_TIERS, furniture.hotspotKey === "TREASURE_CHEST" ? chestTiers(furniture) - 1 : -1);
  sender.sendVarbit(VARBIT_MODE, Number(player.getAttribute(MODE_ATTRIBUTE)) === 1 ? 1 : 0);
  sendStored(player, furniture);
  sender.sendInterfaceScript(MAIN_MODAL_BACKGROUND_SCRIPT, [-1, -2]);
  sender.sendInterface(MAIN);
  if (owner) {
    sender.sendSubInterface(SIDE_MODAL, SIDE, MODAL);
    sender.sendInterfaceScript(INV_INIT_SCRIPT, [SIDE_ITEMS, PLAYER_INV, 4, 7, 1, -1, "Store<col=ff9040>", "", "", "", ""]);
    sender.sendInterfaceFlagsRange(SIDE_ITEMS, 0, 27, OP1 | OP10 | DEPTH1 | DRAG_TARGET);
  }
  const enumId = rowsEnum(furniture, state.tier);
  sender.sendInterfaceScript(INIT_SCRIPT, [enumId, owner ? 1 : 0, reset ? 1 : 0]);
  sender.sendInterfaceFlagsRange(ITEMS, 0, numericEnum(enumId).size * ROW_COMPONENTS - 1, OP1 | OP10);
  openFor.set(player, state);
  player.getInventory().refreshItems();
}

/** The open storage, if it is still on screen and still there. */
function openState(player) {
  const state = openFor.get(player);
  if (!state || player.getInterfaceId?.() !== MAIN || playerMode(player) !== state.mode) return null;
  if (state.owner && !inHouse(player, state.house, state.furniture)) return null;
  if (!state.owner && (player.getPrivateArea() !== state.house || state.house.isDestroyed())) return null;
  return state;
}

function openHouseStorage(event) {
  const context = currentFurniture(event);
  if (!context) return false;
  const { house, furniture } = context;
  const { player } = event, position = positionOf(player);
  const initialMode = playerMode(player);
  if (house.owner !== player) {
    openInterface(player, { event, house, furniture, tier: 0, position, owner: false, mode: initialMode }, true);
    return true;
  }
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "poh-costume-room", resume: () => {
    if (sameContext(event, context, position) && playerMode(player) === initialMode) openHouseStorage(event);
  } };
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || playerMode(player) !== initialMode || !sameContext(event, context, position)) return true;
  openInterface(player, { event, house, furniture, tier: 0, position, owner: true, mode: initialMode }, true);
  return true;
}

function examine(player, id) {
  const definition = ItemDefinition.forId(id);
  player.sendMessage(definition.getExamine?.() || definition.getName());
}

/** Withdraw (op1) or examine (op10) on a row of the list. */
function clickItems(event) {
  const { player } = event;
  const state = openState(player);
  if (!state) return true;
  const representative = numericEnum(rowsEnum(state.furniture, state.tier)).get(Math.floor((event.slot ?? -1) / ROW_COMPONENTS));
  if (representative == null) return true;
  if ((event.opId ?? event.action) === 10) return examine(player, event.itemId > 0 ? event.itemId : representative), true;
  if (!state.owner) return player.sendMessage("Only the owner can withdraw stored items."), true;
  if (withdrawRow(player, state.house, state.furniture, representative)) {
    player.getInventory().refreshItems();
    sendStored(player, state.furniture);
  }
  return true;
}

/** Store (op1) or examine (op10) on an inventory item in the side panel. */
function clickSide(event) {
  const { player } = event;
  const state = openState(player);
  if (!state?.owner) return true;
  const inventory = player.getInventory(), slot = event.slot ?? -1, item = inventory.getItems()[slot];
  if (!item || item.getId() <= 0 || (event.itemId > 0 && event.itemId !== item.getId())) return true;
  if ((event.opId ?? event.action) === 10) return examine(player, item.getId()), true;
  const store = () => {
    const result = depositSlot(player, state.house, state.furniture, slot);
    reportStore(player, state.furniture, result);
    if (result !== "stored") return;
    player.getPacketSender().sendSoundEffect(STORE_SOUND, 1, 0, 1);
    inventory.refreshItems();
    // The warning's prompt closes the interface; it comes back once the item is in.
    if (openState(player) === state) sendStored(player, state.furniture);
    else if (inHouse(player, state.house, state.furniture)) openInterface(player, state, false);
  };
  if (isUltimate(player) && warnsOnDeposit(state.furniture, item)) confirmDeposit(state.event, state, state.position, inventory, store);
  else store();
  return true;
}

function reportStore(player, furniture, result) {
  if (result === "wrong") player.sendMessage("That item does not belong in here.");
  else if (result === "limit") player.sendMessage(limitMessage(furniture));
  else if (result === "refused") player.sendMessage("You cannot store that item here.");
}

/** The inventory slots of the next rows to deposit, from the last slot back: { rows, slots }. */
function nextRows(player, furniture, tried) {
  const allowed = storageItems(furniture), items = player.getInventory().getItems();
  const rows = [];
  for (let slot = items.length - 1; slot >= 0 && rows.length < ROWS_PER_TICK; slot--) {
    const representative = items[slot] && !tried.has(slot) ? allowed.get(items[slot].getId()) : undefined;
    if (representative != null && !rows.includes(representative)) rows.push(representative);
  }
  const slots = [];
  for (let slot = items.length - 1; slot >= 0; slot--) {
    if (items[slot] && !tried.has(slot) && rows.includes(allowed.get(items[slot].getId()))) slots.push(slot);
  }
  return slots;
}

/** One tick of deposit-all: up to four rows go in, with the reach and a sound for each. */
function depositBatch(player, state, run) {
  const allowed = storageItems(state.furniture), slots = nextRows(player, state.furniture, run.tried);
  if (!slots.length) return false;
  const rows = new Set();
  for (const slot of slots) {
    run.tried.add(slot);
    const id = player.getInventory().getItems()[slot]?.getId();
    const result = depositSlot(player, state.house, state.furniture, slot);
    if (result === "stored") { rows.add(allowed.get(id)); run.stored = true; }
    else if (result === "limit" && !run.limited) { run.limited = true; player.sendMessage(limitMessage(state.furniture)); }
  }
  if (rows.size) {
    player.performAnimation(new Animation(PICKUP));
    for (let row = 0; row < rows.size; row++) player.getPacketSender().sendSoundEffect(STORE_SOUND, 1, 15, 1);
    player.getInventory().refreshItems();
  }
  return true;
}

/**
 * Deposit inventory: the interface closes for a "Searching..." box, the items of up
 * to four rows go in each tick, and the interface comes back three ticks after the last. With
 * nothing that belongs, the box says so two ticks in.
 */
function depositAll(player, state) {
  const sender = player.getPacketSender();
  const run = { tried: new Set(), stored: false, limited: false };
  depositing.set(player, run);
  openFor.delete(player);
  sender.sendInterfaceRemoval();
  sender.sendTypedMessage(ChatType.MESBOX, "Searching...");
  StatementDialogue.send(player, "Searching...", false);
  const valid = () => depositing.get(player) === run && player.isRegistered?.() !== false
    && sameContext(state.event, state, state.position);
  let found = depositBatch(player, state, run), idle = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player.getIndex?.() ?? player, false); }
    execute() {
      if (!valid()) { if (depositing.get(player) === run) depositing.delete(player); return void this.stop(); }
      if (found && depositBatch(player, state, run)) return;
      found = false;
      idle++;
      if (run.stored || run.limited) {
        if (idle < REOPEN_TICKS) return;
        depositing.delete(player);
        openInterface(player, state, false);
        return void this.stop();
      }
      if (idle < NOTHING_TICKS) return;
      depositing.delete(player);
      sender.sendTypedMessage(ChatType.MESBOX, "Your items do not belong in here.");
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, "Your items do not belong in here.")));
      this.stop();
    }
  })());
}

function clickDepositAll(event) {
  const { player } = event;
  const state = openState(player);
  if (!state?.owner || depositing.has(player)) return true;
  const inventory = player.getInventory();
  if (isUltimate(player) && inventory.getItems().some(item => warnsOnDeposit(state.furniture, item))) {
    confirmDeposit(state.event, state, state.position, inventory, () => depositAll(player, state));
  } else depositAll(player, state);
  return true;
}

/**
 * The treasure chest's tier: op1 asks which tier in a chat menu, the tier's own option shows it
 * at once.
 */
function clickTier(event) {
  const { player } = event;
  const state = openState(player);
  if (!state || state.furniture.hotspotKey !== "TREASURE_CHEST") return true;
  const tiers = TIER_NAMES.slice(0, chestTiers(state.furniture));
  const op = event.opId ?? event.action ?? 1;
  if (op >= 2) {
    if (op - 2 < tiers.length) openInterface(player, { ...state, tier: op - 2 }, false);
    return true;
  }
  openFor.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  tierMenu(player, state, tiers, 0);
  return true;
}

/** Ours: a chat menu shows five options at most, so six tiers page after the fourth. */
function tierMenu(player, state, tiers, first) {
  const page = tiers.length - first > 5 ? tiers.slice(first, first + 4) : tiers.slice(first);
  const options = page.flatMap((name, index) => [name, () => {
    if (state.owner ? inHouse(player, state.house, state.furniture) : player.getPrivateArea() === state.house) openInterface(player, { ...state, tier: first + index }, true);
  }]);
  if (first + page.length < tiers.length) options.push("More...", () => tierMenu(player, state, tiers, first + page.length));
  api.sendMultiChatboxPrompt(player, "Select an option", ...options);
}

/** Deposit mode: the client flips the varbit; the server keeps it. */
function clickMode(event) {
  const { player } = event;
  const state = openState(player);
  if (!state?.owner) return true;
  const mode = Number(player.getAttribute(MODE_ATTRIBUTE)) === 1 ? 0 : 1;
  player.setAttribute(MODE_ATTRIBUTE, mode);
  player.getPacketSender().sendVarbit(VARBIT_MODE, mode);
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
  const store = () => {
    const result = depositSlot(player, context.house, context.furniture, event.itemSlot);
    reportStore(player, context.furniture, result);
    if (result === "stored") player.getPacketSender().sendSoundEffect(STORE_SOUND, 1, 0, 1);
  };
  if (isUltimate(player) && warnsOnDeposit(context.furniture, item)) confirmDeposit(event, context, position, inventory, store);
  else store();
  return true;
}

function attachStorage(pluginApi) {
  pluginApi.persistAttribute(MODE_ATTRIBUTE, 0);
  pluginApi.onInterfaceActionButton(ITEMS, clickItems);
  pluginApi.onInterfaceActionButton(SIDE_ITEMS, clickSide);
  pluginApi.onInterfaceActionButton(DEPOSIT_ALL, clickDepositAll);
  pluginApi.onInterfaceActionButton(TIER, clickTier);
  pluginApi.onInterfaceActionButton(MODE, clickMode);
  pluginApi.onCustomEvent("interface:close", ({ player }) => openFor.delete(player));
}

Object.assign(module.exports, { storageItems, depositHouseItem, withdrawHouseItem, withdrawRow, openHouseStorage, storeItemOnFurniture, attachStorage, MAIN, ROW_COMPONENTS });
