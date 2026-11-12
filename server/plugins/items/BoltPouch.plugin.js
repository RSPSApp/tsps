"use strict";

/**
 * Bolt pouch (https://oldschool.runescape.wiki/w/Bolt_pouch): four slots of up to 10,000 bolts of
 * one type each (one Mith grapple), bought from Hirko in Keldagrim for 1,500 coins. The bolts are
 * kept on the player, not the item: slot N is varbits xbows_pouch_slotN (a key of enum 336, pouch
 * type -> ammo, which is also the list of what it can hold) and xbows_pouch_numN. Use bolts on the
 * pouch to store them; Open shows interface 433, where a slot's "Remove" takes its bolts out,
 * the worn ammo's "Unwield" takes it off, and dragging moves bolts between the slots and the
 * worn ammo. Slot 4 is the extra ammo, which Worn Equipment shows beside the ammo slot (cache
 * script 4039) and swaps with it on "Wear". Dizana's quiver on the player turns the swaps off.
 */

const { takeInto } = require("./TakeInto");

const BOLTS_ATTRIBUTE = "bolt-pouch:bolts";
const SLOTS = 4;
const MAX_AMOUNT = 10000;
const AMMO_TYPE_ENUM = 336;
const PRICE = 1500;
const POUCH_NAME = "Bolt pouch";
const HIRKO = "Hirko";
const EXTRA_AMMO_SLOT = 3;
/** Settings > Gameplay > "Ammo-picking behaviour" (setting 305, `take_ammo_toggle`). */
const AMMO_PICKUP_VARBIT = "take_ammo_toggle";

const MESSAGE = {
  QUIVER: "You cannot change ammo from your bolt pouch with Dizana's quiver on your person.",
  /** Ours (not captured). */
  CANT_HOLD: "The pouch can't hold that.",
  PRESET: "Preset items cannot be used for this.",
  NO_SPACE: "You don't have enough inventory space.",
  DESTROY: "You can get another pouch from Hirko in Keldagrim.",
};

let api = null;
let core = null;
let typeByAmmo = null;

function varbit(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function component(name) {
  return core.CacheDefinitions.getComponentId(name);
}

/** The pouch type for an ammo obj, or 0 when the pouch can't hold it. */
function typeOf(ammoId) {
  if (!typeByAmmo) {
    typeByAmmo = new Map();
    for (const [type, obj] of core.CacheDefinitions.getEnumValues(AMMO_TYPE_ENUM)) typeByAmmo.set(Number(obj), type);
  }
  return typeByAmmo.get(ammoId) ?? 0;
}

/** Plain stacks only: the pouch keeps an id and an amount, so item state stays on its item. */
function isStorable(item) {
  return item != null && item.getId() > 0 && typeOf(item.getId()) > 0 && Object.keys(item.getMeta?.() ?? {}).length === 0;
}

function capOf(ammoId) {
  return ammoId === core.ItemIdentifiers.MITH_GRAPPLE_2 ? 1 : MAX_AMOUNT;
}

function isPouch(item) {
  return item?.getDefinition?.()?.getName?.() === POUCH_NAME;
}

function hasPouch(player) {
  return player.getInventory().getValidItems().some(isPouch);
}

// ------------------------------------------------------------------ slots

/** The four slots, each `{ id, amount }` or null. */
function slots(player) {
  const saved = player.getAttribute(BOLTS_ATTRIBUTE);
  return Array.from({ length: SLOTS }, (_, slot) => {
    const id = Number(saved?.[slot]?.[0]);
    const amount = Number(saved?.[slot]?.[1]);
    return typeOf(id) > 0 && Number.isInteger(amount) && amount > 0 ? { id, amount: Math.min(amount, capOf(id)) } : null;
  });
}

function setSlots(player, next) {
  const saved = next.map((entry) => (entry && entry.amount > 0 ? [entry.id, entry.amount] : null));
  player.setAttribute(BOLTS_ATTRIBUTE, saved.some(Boolean) ? saved : null);
  sendSlots(player);
}

function sendSlots(player, force = false) {
  const sender = player.getPacketSender();
  const set = (id, value) => {
    if (id !== null && (force || sender.getVarbit(id) !== value)) sender.sendVarbit(id, value);
  };
  slots(player).forEach((entry, slot) => {
    set(varbit(`xbows_pouch_slot${slot + 1}`), entry ? typeOf(entry.id) : 0);
    set(varbit(`xbows_pouch_num${slot + 1}`), entry?.amount ?? 0);
  });
}

/** Adds up to `amount` of `ammoId`, to its slot or else the first empty one; returns how many went in. */
function store(player, ammoId, amount) {
  const current = slots(player);
  let slot = current.findIndex((entry) => entry?.id === ammoId);
  if (slot < 0) slot = current.findIndex((entry) => !entry);
  if (slot < 0) return 0;
  const moved = Math.min(Math.floor(amount), capOf(ammoId) - (current[slot]?.amount ?? 0));
  if (!(moved > 0)) return 0;
  current[slot] = { id: ammoId, amount: (current[slot]?.amount ?? 0) + moved };
  setSlots(player, current);
  return moved;
}

// ------------------------------------------------------------------ inventory

/** Ours: using bolts on the pouch stores every plain stack of them that fits, as the rune pouch does. */
function useOnPouch(event) {
  const { player, usedItem, usedWithItem } = event;
  const ammo = isPouch(usedItem) ? usedWithItem : isPouch(usedWithItem) ? usedItem : null;
  if (!ammo || typeOf(ammo.getId()) === 0) return;
  event.handled = true;
  const inventory = player.getInventory();
  const plain = inventory.getItems().filter((item) => item?.getId() === ammo.getId() && isStorable(item));
  if (plain.length === 0) {
    player.sendMessage(MESSAGE.PRESET);
    return;
  }
  const moved = store(player, ammo.getId(), plain.reduce((sum, item) => sum + item.getAmount(), 0));
  if (moved <= 0) {
    player.sendMessage(MESSAGE.CANT_HOLD);
    return;
  }
  let left = moved;
  for (const item of plain) {
    const taken = Math.min(left, item.getAmount());
    inventory.deleteAtSlot(inventory.getItems().indexOf(item), taken, false);
    left -= taken;
    if (left <= 0) break;
  }
  inventory.refreshItems();
}

/**
 * Interface 433 has no frame of its own: it fills the side panel in place of the inventory, as
 * the Wiki's picture shows it.
 */
function open({ player }) {
  const sender = player.getPacketSender();
  const group = core.CacheDefinitions.getInterfaceId("xbows_pouch");
  sender.sendInterfaceRemoval();
  sendSlots(player, true);
  sender.sendSubInterface(component("toplevel_osrs_stretch:sidemodal"), group, 0);
  player.setInterfaceId(group);
  return true;
}

// ------------------------------------------------------------------ interface 433

function pouchSlotOf(uid) {
  return [1, 2, 3, 4].findIndex((n) => component(`xbows_pouch:bolt_${n}`) === uid);
}

function isAmmoSlot(uid) {
  return uid === component("xbows_pouch:current_bolt");
}

function isOpen(player) {
  return player.getInterfaceId?.() === core.CacheDefinitions.getInterfaceId("xbows_pouch");
}

/** "Remove": the slot's bolts go to the inventory (Ours: all of them, when they fit). */
function remove(player, slot) {
  const current = slots(player);
  const entry = current[slot];
  if (!entry) return;
  const inventory = player.getInventory();
  const item = new core.Item(entry.id, entry.amount);
  if (inventory.getAddableAmount(item) < entry.amount) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return;
  }
  current[slot] = null;
  setSlots(player, current);
  inventory.add(item, false);
  inventory.refreshItems();
}

function click(event) {
  const uid = (event.groupId << 16) | event.childId;
  const { player } = event;
  if (uid === component("wornitems:extra_ammo_slot")) {
    event.handled = true;
    wearExtraAmmo(player);
    return;
  }
  const slot = pouchSlotOf(uid);
  if (slot < 0 && !isAmmoSlot(uid)) return;
  event.handled = true;
  if (!isOpen(player) || !hasPouch(player)) return;
  if (slot >= 0) remove(player, slot);
  else core.EquipPacketListener.unequip(player, core.Equipment.AMMUNITION_SLOT);
}

/** Worn Equipment's extra ammo slot: "Wear" swaps it with the worn ammo, mid-fight too (Wiki). */
function wearExtraAmmo(player) {
  if (!hasPouch(player) || !slots(player)[EXTRA_AMMO_SLOT]) return;
  if (quiverOnPerson(player)) player.sendMessage(MESSAGE.QUIVER);
  else swapWithAmmo(player, EXTRA_AMMO_SLOT, true);
}

function quiverOnPerson(player) {
  const isQuiver = (item) => /^(Blessed )?Dizana's quiver/i.test(item?.getDefinition?.()?.getName?.() ?? "");
  return player.getInventory().getValidItems().some(isQuiver) || player.getEquipment().getValidItems().some(isQuiver);
}

/** Drags between the pouch slots and the worn ammo slot. */
function drag(event) {
  const { player, packet } = event;
  const from = Number(packet?.sourceWidgetId), to = Number(packet?.targetWidgetId);
  const fromSlot = pouchSlotOf(from), toSlot = pouchSlotOf(to);
  if ((fromSlot < 0 && !isAmmoSlot(from)) || (toSlot < 0 && !isAmmoSlot(to))) return;
  event.handled = true;
  if (from !== to && isOpen(player) && hasPouch(player)) {
    if (fromSlot >= 0 && toSlot >= 0) moveBetweenSlots(player, fromSlot, toSlot);
    else if (quiverOnPerson(player)) player.sendMessage(MESSAGE.QUIVER);
    else swapWithAmmo(player, fromSlot >= 0 ? fromSlot : toSlot, fromSlot >= 0);
  }
  // The client's script 4043 has already redrawn both slots as it expects the move to go; the
  // pouch's slots and the worn ammo are sent again so a refused move shows as it is.
  sendSlots(player, true);
  player.getEquipment().refreshItems();
}

/** Two pouch slots swap places (cache script 4043). */
function moveBetweenSlots(player, fromSlot, toSlot) {
  const current = slots(player);
  if (!current[fromSlot]) return;
  [current[fromSlot], current[toSlot]] = [current[toSlot], current[fromSlot]];
  setSlots(player, current);
}

/** Bolts that go on as worn ammo meet its requirements, as any equip does. */
function canWear(player, ammoId) {
  const item = new core.Item(ammoId, 1);
  const unmet = core.EquipmentRequirements.getUnmet(player, item.getDefinition());
  if (unmet != null) {
    player.sendMessage(core.EquipmentRequirements.message(unmet));
    return false;
  }
  return core.PluginManager.emitCanEquip(player, core.Equipment.AMMUNITION_SLOT, item) !== false;
}

/**
 * Moves bolts between pouch `slot` and the worn ammo slot; `wield` is the pouch -> ammo direction.
 * The same bolts merge (the pouch side up to 10,000); otherwise the two swap. Worn ammo the pouch
 * can't take - Rada's blessing or arrows (Wiki), or a stack over 10,000 (script 4043) - comes off
 * into the inventory when bolts are wielded over it, and is never moved into the pouch.
 */
function swapWithAmmo(player, slot, wield) {
  const { Item, Equipment } = core;
  // As the worn tab's Remove: no gear changes while dead, mid-teleport or trading.
  if (player.getHitpoints() <= 0 || player.isTeleportingReturn() || player.getStatus() === core.PlayerStatus.TRADING) return;
  const equipment = player.getEquipment();
  const current = slots(player);
  const entry = current[slot];
  const wornNow = equipment.get(Equipment.AMMUNITION_SLOT);
  let worn = wornNow && wornNow.getId() > 0 ? wornNow : null;
  if (entry && worn && entry.id === worn.getId() && isStorable(worn)) {
    if (wield) {
      const moved = Math.min(entry.amount, 0x7fffffff - worn.getAmount());
      worn.incrementAmountBy(moved);
      entry.amount -= moved;
    } else {
      const moved = Math.min(worn.getAmount(), capOf(entry.id) - entry.amount);
      entry.amount += moved;
      worn.decrementAmountBy(moved);
      if (worn.getAmount() <= 0) equipment.setItem(Equipment.AMMUNITION_SLOT, new Item(-1, 0));
    }
    if (entry.amount <= 0) current[slot] = null;
  } else {
    if (entry && !canWear(player, entry.id)) return;
    if (worn && (!isStorable(worn) || worn.getAmount() > capOf(worn.getId()))) {
      if (!wield || !entry) return player.sendMessage(MESSAGE.CANT_HOLD);
      if (!core.EquipPacketListener.unequip(player, Equipment.AMMUNITION_SLOT)) return;
      worn = null;
    }
    current[slot] = worn ? { id: worn.getId(), amount: worn.getAmount() } : null;
    equipment.setItem(Equipment.AMMUNITION_SLOT, entry ? new Item(entry.id, entry.amount) : new Item(-1, 0));
  }
  setSlots(player, current);
  equipment.refreshItems();
  api.getBonusManager().update(player);
}

// ------------------------------------------------------------------ pickup

/**
 * Ammo-picking behaviour on: ground bolts matching a pouch slot go into it ("your quiver or bolt
 * pouch, if those contain matching ammo"). Ammo matching the worn ammo slot goes there first.
 * Ours: with Dizana's quiver on the player the pouch takes none, as its swaps are off then.
 */
function pickupIntoPouch(event) {
  const { player, groundItemId } = event;
  if (event.handled || player?.getPacketSender?.().getVarbit?.(varbit(AMMO_PICKUP_VARBIT)) !== 1) return;
  if (!hasPouch(player) || quiverOnPerson(player)) return;
  if (player.getEquipment().get(core.Equipment.AMMUNITION_SLOT)?.getId?.() === groundItemId) return;
  const slot = () => slots(player).findIndex((entry) => entry?.id === groundItemId);
  if (slot() < 0) return;
  takeInto(api, event, {
    room: () => (hasPouch(player) && slot() >= 0 ? capOf(groundItemId) - slots(player)[slot()].amount : 0),
    store: (amount) => store(player, groundItemId, amount),
  });
}

// ------------------------------------------------------------------ Hirko

function isHirko(definition) {
  return definition?.getName?.() === HIRKO;
}

function owns(player) {
  return hasPouch(player) || (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(core.ItemIdentifiers.BOLT_POUCH));
}

function canPay(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS) >= PRICE;
}

/** "What about ammo?": one pouch at a time (Ours: carried or banked), 1,500 coins. */
function dialogueCondition({ player, definition, text }) {
  if (!isHirko(definition)) return null;
  const line = String(text).trim();
  if (line === "With bolt pouch owned:") return owns(player);
  if (line === "Without bolt pouch owned:") return !owns(player);
  if (line === "With less than 1500gp:") return !canPay(player);
  if (line === "With at least 1500gp:") return canPay(player);
  return null;
}

function dialogueAction(event) {
  if (event.action !== "receive" || event.text !== "bolt pouch" || core.CacheDefinitions.getNpc(event.npcId)?.name !== HIRKO) return;
  event.handled = true;
  const { player } = event;
  const inventory = player.getInventory();
  const coins = inventory.getAmount(core.ItemIdentifiers.COINS);
  if (owns(player) || coins < PRICE) {
    event.end = true;
    return;
  }
  if (coins > PRICE && inventory.getFreeSlots() < 1) {
    player.sendMessage(MESSAGE.NO_SPACE);
    event.end = true;
    return;
  }
  inventory.deleteNumber(core.ItemIdentifiers.COINS, PRICE);
  inventory.add(new core.Item(core.ItemIdentifiers.BOLT_POUCH, 1), true);
}

/**
 * Destroy warns only how to get another pouch. Ours: the bolts stay with the player, as for an
 * Ultimate Ironman's lost pouch (Wiki), and show again in the next pouch bought from Hirko.
 */
function destroyPrompt(event) {
  if (isPouch(event.item)) event.warning = MESSAGE.DESTROY;
}

// ------------------------------------------------------------------ death

/**
 * The bolts on a death (the storage items' death hook decides when): a PvP death empties them
 * for the killer; otherwise they stay in the pouch, unless "Always empty bolt pouches on death"
 * is on, and then they go to the grave as they are.
 */
const deathContainer = {
  holds: isPouch,
  varbit: "emptyondeath_boltpouch",
  empty(player) {
    const bolts = slots(player).filter(Boolean);
    if (bolts.length > 0) setSlots(player, Array.from({ length: SLOTS }, () => null));
    return bolts;
  },
};

function isPvpDeath({ player, killer }) {
  return !!killer && killer !== player;
}

/** The pouch is never one of the items kept on death (Wiki). */
function shouldKeepPouch(event) {
  if (isPouch(event.item)) event.keep = false;
}

/**
 * A PvP death destroys the pouch: it is neither dropped nor given back (Wiki). A death that keeps
 * everything (an owner's or developer's) keeps it too.
 */
function deathItemDrop(event) {
  if (isPouch(event.item) && isPvpDeath(event) && event.shouldDropItems !== false) event.handled = true;
}

function login({ player }) {
  sendSlots(player);
}

module.exports = {
  name: "BoltPouch",
  description: "Adds the bolt pouch: four slots of up to 10,000 bolts, stored with Use, the Open interface's Remove and Unwield, and Hirko's sale.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(BOLTS_ATTRIBUTE);
    api.onPlayerLogin(login);
    api.onItemOnItem(useOnPouch);
    api.onItemAction(POUCH_NAME, { Open: open });
    api.onInterfaceActionClick(click);
    api.onCustomEvent("player:widget-action", drag);
    api.onNpcDialogueCondition(dialogueCondition);
    api.onCustomEvent("npc-dialogue:action", dialogueAction);
    api.onCustomEvent("destroy-item:prompt", destroyPrompt);
    api.onCustomEvent("storage:death-containers", (query) => query.containers.push(deathContainer));
    api.onShouldKeepItemOnDeath(shouldKeepPouch);
    api.onPlayerDeathItemDrop(deathItemDrop);
    api.onGroundItemPickup(pickupIntoPouch);
  },
  BOLTS_ATTRIBUTE,
  slots,
  setSlots,
  store,
  isPouch,
  _test: { typeOf, useOnPouch, open, click, drag, pickupIntoPouch, dialogueCondition, dialogueAction, MESSAGE },
};
