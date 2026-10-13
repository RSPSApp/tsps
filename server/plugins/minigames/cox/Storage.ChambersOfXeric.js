"use strict";

/**
 * Storage units: each raider's private storage and the raid's shared one, built and upgraded
 * with mallignum root planks; and the private storage unit on Mount Quidamortem.
 *
 * Wiki (Tiny storage unit; Chambers of Xeric, Storage units):
 * - A tiny unit holds 25 personal items. Upgrades are shared by every unit in the raid: small
 *   (Construction 30), medium (60), large (90), massive (99), two planks a tier and 150 XP;
 *   building straight to a higher tier costs the planks of the tiers below. Personal / shared
 *   space: 30 / 250, 60 / 500, 90 / 1,000, 120 / 1,500. A hammer (or dragon warhammer or
 *   elder maul) is needed; building or upgrading gives 100 points a tier.
 * - Units stand at each floor's end, in resource rooms, the scavenger and Ice Demon rooms, and
 *   outside the Olm's chamber.
 * - The shared storage only takes raid items (cache enum 1666: raid items and their tools).
 * - Items left in a private storage are kept, and taken out at the storage unit by the bank
 *   chest on the mountain, which must be emptied before entering again.
 * Not on the Wiki (to check against a capture): the interfaces - private 271 (inventory 583; 4 size, 5 to shared, 6 items,
 *   9 withdraw all, 10 deposit all / bank all), shared 550 (inventory 582; 4 size, 5 to private,
 *   7 items), and their side panel 551 (1 the inventory, varbit 3459 private or shared) -
 *   withdraw / deposit 1, 5, 10, All, X; one unit being built at a time ("Someone else is
 *   already building a storage unit."), done 2 ticks later.
 * Not like OSRS: the creation menu is a chatbox choice (the cache's furniture menu has no
 *   rows for these units).
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");

const INVENTORY = { PRIVATE: 583, SHARED: 582, PLAYER: 93 };
const COMPONENT = {
  PRIVATE: { SIZE: 4, TO_SHARED: 5, ITEMS: 6, WITHDRAW_ALL: 9, DEPOSIT_ALL: 10 },
  SHARED: { SIZE: 4, TO_PRIVATE: 5, ITEMS: 7 },
  SIDE: { ITEMS: 1, DISMISS: 8 },
};
const SIDE_INTERFACE = 551;
const VARBIT = { SIDE_PRIVATE: 3459, WARNING_DISMISSED: 5509 };
const MOUNT_UNIT = 30107;
const PLANK = 21036;
/** Wiki (Kindling): it can't be stored since December 2023. */
const KINDLING = 20799;
const HAMMERS = [2347, 13353, 13339, 25644, 21028, 21031, 22370];
const BUILD_ANIM = 3676;

/** The tiers: their object, level, and personal / shared space. Tier 0 is the unbuilt unit. */
const TIERS = [
  { object: 29769, name: "Tiny storage unit", level: 0, personal: 25, shared: 0 },
  { object: 29770, name: "Small storage unit", level: 30, personal: 30, shared: 250 },
  { object: 29779, name: "Medium storage unit", level: 60, personal: 60, shared: 500 },
  { object: 29780, name: "Large storage unit", level: 90, personal: 90, shared: 1000 },
  { object: 37978, name: "Massive storage unit", level: 99, personal: 120, shared: 1500 },
];
const PLANKS_PER_TIER = 2;
const XP_PER_TIER = 150;
const POINTS_PER_TIER = 100;
const UNIT_IDS = new Set(TIERS.map((tier) => tier.object));

/** Cache enum 1666: what the shared storage takes. */
const SHARED_RANGES = [[307, 307], [590, 590], [952, 952], [1265, 1265], [1267, 1267], [1349, 1349], [1351, 1351],
  [1523, 1523], [2347, 2347], [5341, 5341], [5343, 5343], [10010, 10010], [20800, 20801], [20853, 20853],
  [20855, 20868], [20870, 20883], [20901, 20996], [21036, 21036], [25754, 25765]];

const ATTR_PRIVATE = "cox:private-storage";
const ATTR_DISMISSED = "cox:storage-warning-dismissed";
const ATTR_VIEW = "cox:storage-view";

const uid = (group, component) => (group << 16) | component;

function sharedItem(id) {
  return SHARED_RANGES.some(([from, to]) => id >= from && id <= to);
}

function definition(id) {
  return Shared.core().ItemDefinition.forId(id);
}

// ---------------------------------------------------------------- the stores

/** A store of items: a list of { id, amount } with a size. Stackables stack, others take a slot each. */
function addTo(list, size, id, amount) {
  const stackable = definition(id)?.isStackable?.() === true || definition(id)?.isNoted?.() === true;
  if (stackable) {
    const existing = list.find((entry) => entry.id === id);
    if (existing) {
      existing.amount += amount;
      return amount;
    }
    if (list.length >= size) return 0;
    list.push({ id, amount });
    return amount;
  }
  const room = Math.max(0, size - list.length);
  const added = Math.min(room, amount);
  for (let i = 0; i < added; i++) list.push({ id, amount: 1 });
  return added;
}

/** Takes up to `amount` of an item out of a store; returns how many came out. */
function takeFrom(list, id, amount) {
  let taken = 0;
  for (let index = list.length - 1; index >= 0 && taken < amount; index--) {
    const entry = list[index];
    if (entry.id !== id) continue;
    const out = Math.min(entry.amount, amount - taken);
    entry.amount -= out;
    taken += out;
    if (entry.amount <= 0) list.splice(index, 1);
  }
  return taken;
}

function countIn(list, id) {
  return list.reduce((sum, entry) => sum + (entry.id === id ? entry.amount : 0), 0);
}

function privateItems(player) {
  let items = player.getAttribute(ATTR_PRIVATE);
  if (!Array.isArray(items)) {
    items = [];
    player.setAttribute(ATTR_PRIVATE, items);
  }
  return items;
}

/** Raid-only items can't leave the raid: they are gone from the private storage once outside. */
function clearRaidItems(player) {
  const items = privateItems(player);
  for (let index = items.length - 1; index >= 0; index--) {
    if (Shared.isRaidItem(items[index].id)) items.splice(index, 1);
  }
}

function sharedStore(raid) {
  raid.sharedItems ??= [];
  return raid.sharedItems;
}

function tierOf(raid) {
  return raid?.storageTier ?? 0;
}

// ---------------------------------------------------------------- the interfaces

/** What the player has open: { kind: "private" | "shared", size, raid }. */
function viewOf(player) {
  return player.getAttribute(ATTR_VIEW) ?? null;
}

function sendSide(player, privateView) {
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT.SIDE_PRIVATE, privateView ? 1 : 0);
  sender.sendVarbit(VARBIT.WARNING_DISMISSED, player.getAttribute(ATTR_DISMISSED) ? 1 : 0);
  sender.sendInterfaceFlagsRange(uid(SIDE_INTERFACE, COMPONENT.SIDE.ITEMS), 0, 27,
    Shared.EVENT.OP1 | Shared.EVENT.OP2 | Shared.EVENT.OP3 | Shared.EVENT.OP4 | Shared.EVENT.OP5 | (1 << 10));
}

/** The private storage; `size` -1 is the mountain's unit (withdraw only, no shared button). */
function openPrivate(player, size) {
  const sender = player.getPacketSender();
  const items = privateItems(player);
  if (size === -1) clearRaidItems(player);
  player.setAttribute(ATTR_VIEW, { kind: "private", size: size === -1 ? 120 : size, mount: size === -1 });
  sender.sendInterfaceSet(Shared.INTERFACE.PRIVATE_STORAGE, SIDE_INTERFACE);
  sender.sendString(size === -1 ? "N/A" : String(size), uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.SIZE));
  sender.sendInterfaceDisplayState(uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.TO_SHARED), size === -1);
  sender.sendInterfaceFlagsRange(uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.ITEMS), 0, Math.max(items.length, 1) + 120,
    Shared.EVENT.OP1 | Shared.EVENT.OP2 | Shared.EVENT.OP3 | Shared.EVENT.OP4 | Shared.EVENT.OP5 | (1 << 10));
  sendSide(player, true);
  refresh(player);
}

function openShared(player, raid) {
  const sender = player.getPacketSender();
  const tier = TIERS[tierOf(raid)];
  player.setAttribute(ATTR_VIEW, { kind: "shared", size: tier.shared, raid });
  sender.sendInterfaceSet(Shared.INTERFACE.SHARED_STORAGE, SIDE_INTERFACE);
  sender.sendString(String(tier.shared), uid(Shared.INTERFACE.SHARED_STORAGE, COMPONENT.SHARED.SIZE));
  sender.sendInterfaceFlagsRange(uid(Shared.INTERFACE.SHARED_STORAGE, COMPONENT.SHARED.ITEMS), 0, tier.shared,
    Shared.EVENT.OP1 | Shared.EVENT.OP2 | Shared.EVENT.OP3 | Shared.EVENT.OP4 | Shared.EVENT.OP5 | (1 << 10));
  sendSide(player, false);
  refresh(player);
}

/** Redraws a player's open storage and their inventory beside it. */
function refresh(player) {
  const view = viewOf(player);
  if (!view) return;
  const sender = player.getPacketSender();
  if (view.kind === "private") {
    const items = privateItems(player);
    sender.sendInventory(INVENTORY.PRIVATE, Math.max(view.size, items.length), items);
  } else {
    const items = sharedStore(view.raid);
    sender.sendInventory(INVENTORY.SHARED, Math.max(view.size, items.length), items);
  }
  player.getInventory().refreshItems();
}

/** Everyone looking at the raid's shared storage sees a change to it. */
function refreshShared(raid) {
  for (const player of raid.players) {
    if (viewOf(player)?.kind === "shared" && viewOf(player).raid === raid) refresh(player);
  }
}

// ---------------------------------------------------------------- moving items

function inventoryAmount(player, id) {
  return player.getInventory().getAmount(id);
}

function deposit(player, slot, amount) {
  const view = viewOf(player);
  if (!view || view.mount) {
    if (view?.mount) player.sendMessage("You can't store items now.");
    return;
  }
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() < 0) return;
  const id = item.getId();
  if (id === KINDLING) {
    player.sendMessage("You can't store kindling.");
    return;
  }
  if (view.kind === "shared" && !sharedItem(id)) {
    player.sendMessage("The shared storage unit cannot hold that item.");
    return;
  }
  const store = view.kind === "private" ? privateItems(player) : sharedStore(view.raid);
  const wanted = Math.min(amount, inventoryAmount(player, id));
  const stored = addTo(store, view.size, id, wanted);
  if (stored <= 0) {
    player.sendMessage(view.kind === "private" ? "Not enough space in your private storage." : "The shared storage is full.");
    return;
  }
  inventory.delete(id, stored);
  if (view.kind === "shared") refreshShared(view.raid);
  else refresh(player);
}

function withdraw(player, id, amount) {
  const view = viewOf(player);
  if (!view) return;
  const { Item } = Shared.core();
  const store = view.kind === "private" ? privateItems(player) : sharedStore(view.raid);
  const inventory = player.getInventory();
  const stackable = definition(id)?.isStackable?.() === true;
  const room = stackable ? (inventory.contains(id) || inventory.getFreeSlots() > 0 ? Infinity : 0) : inventory.getFreeSlots();
  const wanted = Math.min(amount, countIn(store, id), room);
  if (wanted <= 0) {
    player.sendMessage("Not enough space in your inventory.");
    return;
  }
  const taken = takeFrom(store, id, wanted);
  inventory.add(new Item(id, taken), true);
  if (view.kind === "shared") refreshShared(view.raid);
  else refresh(player);
}

/** Asks for an amount, then runs `action(amount)`. */
function askAmount(player, action) {
  player.setEnteredAmountAction({ execute: function storageAmount(amount) { action(Math.max(0, Math.trunc(Number(amount) || 0))); } });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

const AMOUNT_BY_OP = { 1: 1, 2: 5, 3: 10, 4: Infinity };

function clickStoredItem(event) {
  const { player } = event;
  const view = viewOf(player);
  if (!view) return true;
  const store = view.kind === "private" ? privateItems(player) : sharedStore(view.raid);
  const entry = store[event.slot ?? -1];
  if (!entry) return true;
  const op = event.opId ?? event.action;
  if (op === 10) {
    player.sendMessage(definition(entry.id)?.getExamine?.() ?? "");
    return true;
  }
  if (op === 5) askAmount(player, (amount) => withdraw(player, entry.id, amount));
  else withdraw(player, entry.id, AMOUNT_BY_OP[op] ?? 1);
  return true;
}

function clickInventoryItem(event) {
  const { player } = event;
  const slot = event.slot ?? -1;
  const op = event.opId ?? event.action;
  const item = player.getInventory().getItems()[slot];
  if (!item || item.getId() < 0) return true;
  if (op === 10) {
    player.sendMessage(definition(item.getId())?.getExamine?.() ?? "");
    return true;
  }
  if (op === 5) askAmount(player, (amount) => deposit(player, slot, amount));
  else deposit(player, slot, op === 4 ? inventoryAmount(player, item.getId()) : AMOUNT_BY_OP[op] ?? 1);
  return true;
}

function withdrawAll({ player }) {
  const items = privateItems(player);
  if (items.length === 0) {
    player.sendMessage("There's nothing to withdraw.");
    return true;
  }
  for (const entry of [...items]) withdraw(player, entry.id, entry.amount);
  if (privateItems(player).length > 0) player.sendMessage("Not enough space in your inventory.");
  return true;
}

/** Inside: everything in the inventory into the private storage. On the mountain: all to the bank. */
function depositOrBankAll({ player }) {
  const view = viewOf(player);
  if (!view) return true;
  if (!view.mount) {
    player.getInventory().getItems().forEach((item, slot) => {
      if (item && item.getId() >= 0) deposit(player, slot, item.getAmount());
    });
    return true;
  }
  const { Item, Bank } = Shared.core();
  const items = privateItems(player);
  for (const entry of [...items]) {
    const bank = player.getBank(Bank.getTabForItem(player, entry.id));
    if (bank.getFreeSlots() <= 0 && !bank.contains(entry.id)) continue;
    bank.add(new Item(entry.id, entry.amount), false);
    takeFrom(items, entry.id, entry.amount);
  }
  if (items.length > 0) player.sendMessage("Not enough space in your bank.");
  refresh(player);
  return true;
}

function switchToShared({ player }) {
  const raid = Raid.raidOf(player);
  if (raid) openShared(player, raid);
  return true;
}

function switchToPrivate({ player }) {
  const raid = Raid.raidOf(player);
  openPrivate(player, TIERS[tierOf(raid)].personal);
  return true;
}

function dismissWarning({ player }) {
  player.setAttribute(ATTR_DISMISSED, true);
  player.getPacketSender().sendVarbit(VARBIT.WARNING_DISMISSED, 1);
  return true;
}

// ---------------------------------------------------------------- the units

function hasHammer(player) {
  const weapon = player.getEquipment().getItems()[Shared.core().Equipment.WEAPON_SLOT]?.getId?.();
  return HAMMERS.some((id) => player.getInventory().contains(id) || weapon === id);
}

/** The build / upgrade choices: every tier above the raid's, with the planks it takes from here. */
function openCreation(player, raid) {
  if (!hasHammer(player)) {
    Shared.statement(player, "You need a hammer to build anything here.");
    return;
  }
  const current = tierOf(raid);
  const choices = TIERS.map((tier, index) => ({ tier, index })).filter(({ index }) => index > current);
  if (choices.length === 0) {
    player.sendMessage("The storage units can't be upgraded any further.");
    return;
  }
  const pairs = [];
  for (const { tier, index } of choices.slice(0, 4)) {
    const planks = (index - current) * PLANKS_PER_TIER;
    pairs.push(`${tier.name} (${planks} planks, Construction ${tier.level})`, () => build(player, raid, index));
  }
  Shared.options(player, "Build which storage unit?", ...pairs);
}

function build(player, raid, index) {
  if (raid.destroyed) return;
  if (raid.buildingStorage) {
    player.sendMessage("Someone else is already building a storage unit.");
    return;
  }
  const current = tierOf(raid);
  if (index <= current) return;
  const tier = TIERS[index];
  const { Skill, Animation } = Shared.core();
  if (player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION) < tier.level) {
    player.sendMessage(`You need a Construction level of at least ${tier.level} to build this.`);
    return;
  }
  const planks = (index - current) * PLANKS_PER_TIER;
  if (inventoryAmount(player, PLANK) < planks) {
    player.sendMessage(`You need at least ${planks} mallignum root planks to build this.`);
    return;
  }
  if (!hasHammer(player)) {
    Shared.statement(player, "You need a hammer to build anything here.");
    return;
  }
  player.getInventory().delete(PLANK, planks);
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, (index - current) * XP_PER_TIER);
  player.performAnimation(new Animation(BUILD_ANIM));
  Shared.sound(player, 938);
  raid.addPoints(player, (index - current) * POINTS_PER_TIER);
  raid.buildingStorage = true;
  Shared.later(raid, 2, () => {
    raid.buildingStorage = false;
    raid.storageTier = index;
    replaceUnits(raid, tier.object);
  });
}

/** Every storage unit in the raid becomes the built tier. */
function replaceUnits(raid, objectId) {
  raid.storageUnits ??= findUnits(raid);
  raid.storageUnits = raid.storageUnits.map((unit) => Shared.replaceObject(raid.map, unit, objectId));
}

/** The raid's storage unit hotspots, as its template placed them. */
function findUnits(raid) {
  const units = [];
  const map = raid.map;
  for (const room of map.rooms) {
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        for (const object of map.getChunkObjects(room.plane, room.gridX * 4 + x, room.gridY * 4 + y)) {
          if (UNIT_IDS.has(object.getId())) units.push(object);
        }
      }
    }
  }
  // The two outside the Olm's chamber (its 5 x 7 chunks sit at chunk 0, 8 of the instance).
  for (let x = 0; x < 5; x++) {
    for (let y = 8; y < 15; y++) {
      for (const object of map.getChunkObjects(0, x, y)) {
        if (UNIT_IDS.has(object.getId())) units.push(object);
      }
    }
  }
  return units;
}

function useUnit(event) {
  const { player, objectId } = event;
  const { option } = event;
  if (objectId === MOUNT_UNIT) {
    openPrivate(player, -1);
    return true;
  }
  const raid = Raid.raidOf(player);
  if (!raid || !UNIT_IDS.has(objectId)) return false;
  if (raid.buildingStorage) {
    player.sendMessage(objectId === TIERS[0].object ? "This storage unit is being built!" : "This storage unit is being upgraded!");
    return true;
  }
  if (option === "Private") openPrivate(player, TIERS[tierOf(raid)].personal);
  else if (option === "Shared") openShared(player, raid);
  else if (option === "Build" || option === "Upgrade") openCreation(player, raid);
  return true;
}

/** Entering again needs the mountain's private storage emptied first (Wiki). */
function canEnter(player) {
  clearRaidItems(player);
  if (privateItems(player).length === 0) return true;
  player.sendMessage("You must retrieve all your items from the private storage before you can re-enter the Chambers of Xeric.");
  openPrivate(player, -1);
  return false;
}

module.exports = function registerCoxStorage(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR_PRIVATE);
  api.persistAttribute(ATTR_DISMISSED);
  Shared.onObjectIds(api, [...UNIT_IDS, MOUNT_UNIT], useUnit);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.ITEMS), clickStoredItem);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.SHARED_STORAGE, COMPONENT.SHARED.ITEMS), clickStoredItem);
  api.onInterfaceActionButton(uid(SIDE_INTERFACE, COMPONENT.SIDE.ITEMS), clickInventoryItem);
  api.onInterfaceActionButton(uid(SIDE_INTERFACE, COMPONENT.SIDE.DISMISS), dismissWarning);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.WITHDRAW_ALL), withdrawAll);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.DEPOSIT_ALL), depositOrBankAll);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.TO_SHARED), switchToShared);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.SHARED_STORAGE, COMPONENT.SHARED.TO_PRIVATE), switchToPrivate);
};

Object.assign(module.exports, {
  TIERS, sharedItem, addTo, takeFrom, privateItems, openPrivate, openShared, deposit, withdraw, build, canEnter, findUnits,
});
