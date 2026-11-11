"use strict";

/**
 * Bolt pouch (https://oldschool.runescape.wiki/w/Bolt_pouch): four slots of up to 10,000 bolts of
 * one type each (one Mith grapple), bought from Hirko in Keldagrim for 1,500 coins. The bolts are
 * kept on the player, not the item: slot N is varbits xbows_pouch_slotN (a key of enum 336, pouch
 * type -> ammo, which is also the list of what it can hold) and xbows_pouch_numN. Use bolts on the
 * pouch to store them; Open shows interface 433, where a slot's "Remove" takes its bolts out,
 * and the worn ammo's "Unwield" takes it off.
 */

const BOLTS_ATTRIBUTE = "bolt-pouch:bolts";
const SLOTS = 4;
const MAX_AMOUNT = 10000;
const AMMO_TYPE_ENUM = 336;
const PRICE = 1500;
const POUCH_NAME = "Bolt pouch";
const HIRKO = "Hirko";

const MESSAGE = {
  /** Ours (not captured). */
  CANT_HOLD: "The pouch can't hold that.",
  NO_SPACE: "You don't have enough inventory space.",
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

function open({ player }) {
  sendSlots(player, true);
  player.getPacketSender().sendInterface(core.CacheDefinitions.getInterfaceId("xbows_pouch"));
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
  const slot = pouchSlotOf(uid);
  if (slot < 0 && !isAmmoSlot(uid)) return;
  event.handled = true;
  const { player } = event;
  if (!isOpen(player) || !hasPouch(player)) return;
  if (slot >= 0) remove(player, slot);
  else core.EquipPacketListener.unequip(player, core.Equipment.AMMUNITION_SLOT);
}

/**
 * Dragging bolts between the slots and the worn ammo slot is not handled yet: the drag changes
 * nothing, and the slots are sent again so the client shows the pouch as it is.
 */
function drag(event) {
  const { player, packet } = event;
  const from = Number(packet?.sourceWidgetId), to = Number(packet?.targetWidgetId);
  if ((pouchSlotOf(from) < 0 && !isAmmoSlot(from)) || (pouchSlotOf(to) < 0 && !isAmmoSlot(to))) return;
  event.handled = true;
  sendSlots(player, true);
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
  if (event.action !== "receive" || event.text !== "bolt pouch" || event.npcId !== core.NpcIdentifiers.HIRKO) return;
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
  inventory.add(new core.Item(core.ItemIdentifiers.BOLT_POUCH, 1));
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
  },
  BOLTS_ATTRIBUTE,
  slots,
  setSlots,
  store,
  isPouch,
  _test: { typeOf, useOnPouch, open, click, drag, dialogueCondition, dialogueAction, MESSAGE },
};
