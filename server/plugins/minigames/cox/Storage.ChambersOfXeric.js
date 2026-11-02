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
 * Wiki (Tiny storage unit, Creation Menu): four rows on keys 1-4, one per tier.
 * Cache (raids_storage_private/_shared/_side and their scripts): private 271 (inventory 583; 4
 *   capacity, 5 to shared, 6 items, 9 withdraw all, 10 deposit all / bank all), shared 550
 *   (inventory 582; 4 capacity, 5 to private, 7 items), side panel 551 (1 the inventory, 8
 *   dismiss; varbits 3459 private or shared, 5509 warning dismissed), withdraw / store 1, 5, 10,
 *   All, X. The shared list draws one child per row of enum 1666, so a click's slot is that row,
 *   not a place in the store. Ops: tiny Private, Build; others Shared, Private, Upgrade; massive
 *   no Upgrade. The creation menu is poh_furniture_creation (458) filled by the script that takes
 *   an item instead of a furniture row (7988, poh_furniture_creation_entry_old), since table 110
 *   has no rows for these units; items 21037-21039 and 24660 are their icons. No client script
 *   calls 7988: the server does.
 * No capture opens or builds a unit (only 29769's LocAddChange appears in any recording), so the
 *   rest stays unchecked: which rows the menu lists once a tier is built (here always all four,
 *   so the keys hold), which icon variant each row uses (21038/21040 are both medium, 21039/
 *   21041/21042 large, 24660-24663 massive), one unit being built at a time ("Someone else is
 *   already building a storage unit."), done 2 ticks later.
 * Items keep their meta in a store (a raid potion's maker, see Supplies).
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");

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
/** A hammer, Imcando hammer (and off-hand), dragon warhammer and elder maul, ornamented ones too. */
const HAMMERS = [2347, 25644, 29775, 13576, 26710, 28035, 21003, 27100];
const BUILD_ANIM = 3676;
const BUILD_MENU = { INTERFACE: 458, CONTENTS: 2, ENTRY_SCRIPT: 7988, LIST_SCRIPT: 1406 };

/** The tiers: their object, menu icon, level, and personal / shared space. Tier 0 is the unbuilt unit. */
const TIERS = [
  { object: 29769, name: "Tiny storage unit", level: 0, personal: 25, shared: 0 },
  { object: 29770, icon: 21037, name: "Small storage unit", level: 30, personal: 30, shared: 250 },
  { object: 29779, icon: 21038, name: "Medium storage unit", level: 60, personal: 60, shared: 500 },
  { object: 29780, icon: 21039, name: "Large storage unit", level: 90, personal: 90, shared: 1000 },
  { object: 37978, icon: 24660, name: "Massive storage unit", level: 99, personal: 120, shared: 1500 },
];
const PLANKS_PER_TIER = 2;
const XP_PER_TIER = 150;
const POINTS_PER_TIER = 100;
const UNIT_IDS = new Set(TIERS.map((tier) => tier.object));

function idRange(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** Cache enum 1666 in its order: what the shared storage takes, and the rows it draws. */
const SHARED_ITEMS = [20853, ...idRange(20855, 20868), ...idRange(20870, 20883), 21036, ...idRange(20901, 20912),
  20800, 20801, ...idRange(20913, 20996), ...idRange(25754, 25765),
  590, 307, 10010, 1351, 1265, 1349, 1267, 5341, 5343, 952, 2347, 1523];
const SHARED_ITEM_SET = new Set(SHARED_ITEMS);

const ATTR_PRIVATE = "cox:private-storage";
const ATTR_DISMISSED = "cox:storage-warning-dismissed";
const ATTR_VIEW = "cox:storage-view";
const ATTR_BUILD_MENU = "cox:storage-build-menu";

const uid = (group, component) => (group << 16) | component;

function sharedItem(id) {
  return SHARED_ITEM_SET.has(id);
}

function definition(id) {
  return Shared.core().ItemDefinition.forId(id);
}

// ---------------------------------------------------------------- the stores

function stacks(id) {
  return definition(id)?.isStackable?.() === true || definition(id)?.isNoted?.() === true;
}

/** A store of items: a list of { id, amount, meta? } with a size. Stackables stack, others take a slot each. */
function addTo(list, size, id, amount, meta = null) {
  if (stacks(id)) {
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
  for (let i = 0; i < added; i++) list.push(meta ? { id, amount: 1, meta } : { id, amount: 1 });
  return added;
}

/** Takes up to `amount` of an item out of a store, `first` before the rest; returns the pieces. */
function pullFrom(list, id, amount, first = null) {
  const entries = list.filter((entry) => entry.id === id && entry !== first).reverse();
  if (first && list.includes(first)) entries.unshift(first);
  const pieces = [];
  let left = amount;
  for (const entry of entries) {
    if (left <= 0) break;
    const out = Math.min(entry.amount, left);
    entry.amount -= out;
    left -= out;
    pieces.push({ id, amount: out, meta: entry.meta ?? null });
    if (entry.amount <= 0) list.splice(list.indexOf(entry), 1);
  }
  return pieces;
}

/** Takes up to `amount` of an item out of a store; returns how many came out. */
function takeFrom(list, id, amount) {
  return pullFrom(list, id, amount).reduce((sum, piece) => sum + piece.amount, 0);
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
  const noSharedSpace = size === -1 || tierOf(Raid.raidOf(player)) === 0;
  if (size === -1) clearRaidItems(player);
  player.setAttribute(ATTR_VIEW, { kind: "private", size: size === -1 ? 120 : size, mount: size === -1 });
  sender.sendInterfaceSet(Shared.INTERFACE.PRIVATE_STORAGE, SIDE_INTERFACE);
  sender.sendString(size === -1 ? "N/A" : String(size), uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.SIZE));
  sender.sendInterfaceDisplayState(uid(Shared.INTERFACE.PRIVATE_STORAGE, COMPONENT.PRIVATE.TO_SHARED), noSharedSpace);
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
  const stored = stacks(id) ? depositStack(inventory, store, view.size, item, amount) : depositEach(inventory, store, view.size, slot, amount);
  if (stored <= 0) {
    player.sendMessage(view.kind === "private" ? "Not enough space in your private storage." : "The shared storage is full.");
    return;
  }
  if (view.kind === "shared") refreshShared(view.raid);
  else refresh(player);
}

function depositStack(inventory, store, size, item, amount) {
  const id = item.getId();
  const stored = addTo(store, size, id, Math.min(amount, inventory.getAmount(id)), item.getMeta());
  if (stored > 0) inventory.delete(id, stored);
  return stored;
}

/** Item by item, the clicked one first, so each keeps its own meta. */
function depositEach(inventory, store, size, slot, amount) {
  const items = inventory.getItems();
  const id = items[slot].getId();
  const slots = [slot, ...items.flatMap((item, index) => (item?.getId() === id && index !== slot ? [index] : []))];
  let stored = 0;
  for (const from of slots) {
    if (stored >= amount || addTo(store, size, id, 1, items[from].getMeta()) === 0) break;
    inventory.deleteAtSlot(from, 1, false);
    stored++;
  }
  return stored;
}

function withdraw(player, id, amount, first = null) {
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
  for (const piece of pullFrom(store, id, wanted, first)) inventory.add(new Item(piece.id, piece.amount, piece.meta), true);
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
  const slot = event.slot ?? -1;
  const entry = view.kind === "private" ? privateItems(player)[slot] : sharedStore(view.raid).find((held) => held.id === SHARED_ITEMS[slot]);
  if (!entry) return true;
  const op = event.opId ?? event.action;
  if (op === 10) {
    player.sendMessage(definition(entry.id)?.getExamine?.() ?? "");
    return true;
  }
  if (op === 5) askAmount(player, (amount) => withdraw(player, entry.id, amount, entry));
  else withdraw(player, entry.id, AMOUNT_BY_OP[op] ?? 1, entry);
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
  for (const entry of [...items]) withdraw(player, entry.id, entry.amount, entry);
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
  if (raid && tierOf(raid) > 0) openShared(player, raid);
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

function buildMenuRow(tier, built, planks) {
  return `${tier.name}|${built ? "Built" : `Mallignum root plank: ${planks}`}<br><br><br>`;
}

/** The creation menu: one row per tier on its Wiki key, with the planks it takes from here. */
function openCreation(player, raid) {
  if (!hasHammer(player)) {
    Shared.statement(player, "You need a hammer to build anything here.");
    return;
  }
  const { Skill } = Shared.core();
  const construction = player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION);
  const current = tierOf(raid);
  const held = inventoryAmount(player, PLANK);
  const sender = player.getPacketSender();
  sender.sendInterface(BUILD_MENU.INTERFACE);
  TIERS.forEach((tier, index) => {
    if (index === 0) return;
    const built = index <= current;
    const planks = (index - current) * PLANKS_PER_TIER;
    const canBuild = !built && construction >= tier.level && held >= planks;
    sender.sendClientScript(BUILD_MENU.ENTRY_SCRIPT, index, tier.icon, tier.level, buildMenuRow(tier, built, planks), canBuild ? 1 : 0);
  });
  sender.sendClientScript(BUILD_MENU.LIST_SCRIPT, TIERS.length - 1, 0);
  sender.sendInterfaceFlagsRange(uid(BUILD_MENU.INTERFACE, BUILD_MENU.CONTENTS), 1, TIERS.length - 1, 1);
  player.setAttribute(ATTR_BUILD_MENU, raid);
}

/** A row chosen: the menu's script resumes with its one-based index (as the POH's menu does). */
function chooseBuild(event) {
  const { player } = event;
  if (event.groupId !== BUILD_MENU.INTERFACE || event.childId !== BUILD_MENU.CONTENTS) return;
  const raid = player.getAttribute(ATTR_BUILD_MENU);
  if (!raid) return;
  event.handled = true;
  player.setAttribute(ATTR_BUILD_MENU, null);
  player.getPacketSender().sendInterfaceRemoval();
  if (TIERS[event.action] && Raid.raidOf(player) === raid) build(player, raid, event.action);
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
  api.onInterfaceActionClick(chooseBuild);
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
  TIERS, sharedItem, addTo, pullFrom, takeFrom, privateItems, openPrivate, openShared, deposit, withdraw, build, canEnter, findUnits,
});
