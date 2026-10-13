/**
 * Rune pouch: what the units share - the plugin api, the pouch the player carries, its rune
 * slots and the vars the client reads (docs/rune-pouch.md).
 *
 * OSRS keeps the pouch's runes on the player, not on the item: slot N is varbits
 * rune_pouch_type_N (a key of enum 982, rune pouch type -> rune) and rune_pouch_quantity_N.
 * Slots keep their place when one empties, and a new rune takes the first empty slot.
 */

const RUNES_ATTRIBUTE = "rune-pouch:runes";
const SELECTED_QUANTITY_ATTRIBUTE = "rune-pouch:selected-quantity";
const CUSTOM_QUANTITY_ATTRIBUTE = "rune-pouch:custom-quantity";
/** Before runes moved to the player they were stored in the pouch item's meta under this key. */
const LEGACY_META_KEY = "rune-pouch";

const MAX_AMOUNT = 16000;
const SLOTS = 4;
const POUCHES = [
  { name: "Rune pouch", slots: 3 },
  { name: "Rune pouch (l)", slots: 3 },
  { name: "Divine rune pouch", slots: 4 },
  { name: "Divine rune pouch (l)", slots: 4 },
];
const SLOTS_BY_POUCH = new Map(POUCHES.map((pouch) => [pouch.name, pouch.slots]));
/** Rune pouch type -> rune obj (rune_pouch_type_N's values). */
const RUNE_TYPE_ENUM = 982;
/** if1: how many slots the open pouch has; the cache scripts lay out 3 or 4 and title "Divine Rune Pouch" at 4. */
const POUCH_SLOTS_VARP = 261;

/** meslayer_close: closes the chatbox input if it is in the given mode; 7 is the count prompt (meslayer_mode7). */
const MESLAYER_CLOSE_SCRIPT = 101;
const COUNT_INPUT_MODE = 7;

const MESSAGE = {
  CANT_HOLD: "The pouch can't hold that.",
  EMPTY: "Your pouch is empty.",
  CANT_EMPTY: "It was not possible to empty the pouch.",
  /** Ours (not captured). */
  NO_SPACE: "You don't have enough inventory space.",
};

let api = null;
let core = null;
let typeByRune = null;
/** The amount prompt each player has open from the pouch, so closing its interface can close it. */
const prompts = new WeakMap();

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function varbit(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function component(name) {
  return core.CacheDefinitions.getComponentId(name);
}

/** The rune obj for a pouch type, or -1. */
function runeOf(type) {
  return Number(core.CacheDefinitions.getEnumValues(RUNE_TYPE_ENUM).get(type) ?? -1);
}

/** The pouch type for a rune obj, or 0 when the pouch can't hold it. */
function typeOf(runeId) {
  if (!typeByRune) {
    typeByRune = new Map();
    for (const [type, rune] of core.CacheDefinitions.getEnumValues(RUNE_TYPE_ENUM)) typeByRune.set(Number(rune), type);
  }
  return typeByRune.get(runeId) ?? 0;
}

function isRune(runeId) {
  return typeOf(runeId) > 0;
}

function itemName(item) {
  return item?.getDefinition?.()?.getName?.() ?? "";
}

function isPouch(item) {
  return SLOTS_BY_POUCH.has(itemName(item));
}

/**
 * The pouch the player carries, or null. OSRS lets a player own only one (Wiki); with more
 * (spawned), the one with the most slots counts, so a divine pouch keeps its 4th slot.
 */
function findPouch(player) {
  const pouches = player?.getInventory?.()?.getValidItems?.()?.filter(isPouch) ?? [];
  return pouches.reduce((best, pouch) => (!best || slotCount(player, pouch) > slotCount(player, best) ? pouch : best), null);
}

/** How many slots the carried pouch has (3, or 4 for the divine pouch); 0 without one. */
function slotCount(player, pouch = findPouch(player)) {
  return SLOTS_BY_POUCH.get(itemName(pouch)) ?? 0;
}

// ------------------------------------------------------------------ slots

/** The four slots, each `{ id, amount }` or null. */
function slots(player) {
  const saved = player.getAttribute(RUNES_ATTRIBUTE);
  return Array.from({ length: SLOTS }, (_, slot) => {
    const entry = Array.isArray(saved) ? saved[slot] : null;
    const id = Number(entry?.[0]);
    const amount = Number(entry?.[1]);
    return isRune(id) && Number.isInteger(amount) && amount > 0 ? { id, amount: Math.min(amount, MAX_AMOUNT) } : null;
  });
}

function setSlots(player, next) {
  const saved = next.map((entry) => (entry && entry.amount > 0 ? [entry.id, entry.amount] : null));
  player.setAttribute(RUNES_ATTRIBUTE, saved.some(Boolean) ? saved : null);
  sendSlots(player);
}

function isEmpty(player) {
  return slots(player).every((entry) => !entry);
}

/** How many of `runeId` the pouch holds. */
function amountOf(player, runeId) {
  return slots(player).reduce((total, entry) => total + (entry?.id === runeId ? entry.amount : 0), 0);
}

/** How many of `runeId` the pouch could take: up to 16,000 in its slot, or in the first empty one. */
function room(player, runeId, slotLimit = slotCount(player)) {
  const current = slots(player);
  const held = current.findIndex((entry) => entry?.id === runeId);
  if (held >= 0) return held < slotLimit ? MAX_AMOUNT - current[held].amount : 0;
  return current.slice(0, slotLimit).some((entry) => !entry) ? MAX_AMOUNT : 0;
}

/** Adds up to `amount` of `runeId`; returns how many went in. */
function store(player, runeId, amount, slotLimit = slotCount(player)) {
  const moved = Math.min(Math.floor(amount), room(player, runeId, slotLimit));
  if (!(moved > 0)) return 0;
  const current = slots(player);
  const held = current.findIndex((entry) => entry?.id === runeId);
  if (held >= 0) current[held].amount += moved;
  else current[current.findIndex((entry, slot) => slot < slotLimit && !entry)] = { id: runeId, amount: moved };
  setSlots(player, current);
  return moved;
}

/** Removes up to `amount` from `slot`; returns `{ id, amount }` taken, or null. */
function take(player, slot, amount) {
  const current = slots(player);
  const entry = current[slot];
  const taken = Math.min(Math.floor(amount), entry?.amount ?? 0);
  if (!(taken > 0)) return null;
  entry.amount -= taken;
  if (entry.amount <= 0) current[slot] = null;
  setSlots(player, current);
  return { id: entry.id, amount: taken };
}

/** Removes `amount` of `runeId` wherever it is held (spell costs); the caller checked it is there. */
function spend(player, runeId, amount) {
  const slot = slots(player).findIndex((entry) => entry?.id === runeId);
  if (slot >= 0) take(player, slot, amount);
}

// ------------------------------------------------------------------ inventory and bank

/** Whether `amount` of a stackable rune fits in the inventory. */
function inventoryFits(player, runeId) {
  const inventory = player.getInventory();
  return inventory.getFreeSlots() > 0 || inventory.getAmount(runeId) > 0;
}

function addToInventory(player, runeId, amount) {
  const inventory = player.getInventory();
  inventory.add(new core.Item(runeId, amount), false);
  inventory.refreshItems();
}

function bankTab(player, runeId) {
  return player.getBank(core.Bank.getTabForItem(player, runeId));
}

function bankAmount(player, runeId) {
  return bankTab(player, runeId).getAmount(runeId);
}

function addToBank(player, runeId, amount) {
  bankTab(player, runeId).add(new core.Item(runeId, amount), false);
}

function takeFromBank(player, runeId, amount) {
  bankTab(player, runeId).delete(runeId, amount);
}

/** Redraws the open bank after runes moved in or out of it. */
function refreshBank(player) {
  const { Bank } = core;
  if (!Bank.isOpen(player)) return;
  if (player.isSearchingBank()) player.getBank(Bank.BANK_SEARCH_TAB_INDEX).refreshItems();
  else player.getBank(player.getCurrentBankTab()).refreshItems();
}

// ------------------------------------------------------------------ client vars

/** Sends a varbit only when it changes, as OSRS does. */
function setVarbit(player, id, value) {
  const sender = player.getPacketSender();
  if (id !== null && sender.getVarbit(id) !== value) sender.sendVarbit(id, value);
}

function sendSlots(player) {
  slots(player).forEach((entry, slot) => {
    setVarbit(player, varbit(`rune_pouch_quantity_${slot + 1}`), entry?.amount ?? 0);
    setVarbit(player, varbit(`rune_pouch_type_${slot + 1}`), entry ? typeOf(entry.id) : 0);
  });
}

/** The X amount the pouch interface and bank view remember (rune_pouch_customquantity). */
function customQuantity(player) {
  return Number(player.getAttribute(CUSTOM_QUANTITY_ATTRIBUTE) ?? 0);
}

function setCustomQuantity(player, amount) {
  player.setAttribute(CUSTOM_QUANTITY_ATTRIBUTE, amount);
  setVarbit(player, varbit("rune_pouch_customquantity"), amount);
}

/** The pouch interface's quantity button: 0 = 1, 1 = 5, 2 = All, 3 = X (rune_pouch_selectedquantity). */
function selectedQuantity(player) {
  return Number(player.getAttribute(SELECTED_QUANTITY_ATTRIBUTE) ?? 0);
}

function setSelectedQuantity(player, mode) {
  player.setAttribute(SELECTED_QUANTITY_ATTRIBUTE, mode);
  setVarbit(player, varbit("rune_pouch_selectedquantity"), mode);
}

function sendPouchSlots(player, pouch = findPouch(player)) {
  const sender = player.getPacketSender();
  const count = slotCount(player, pouch) || 3;
  if (sender.getVarp(POUCH_SLOTS_VARP) !== count) sender.sendConfig(POUCH_SLOTS_VARP, count);
}

// ------------------------------------------------------------------ amount prompts

/** Asks for an amount in the chatbox; `action` is an EnteredAmountAction. */
function askAmount(player, title, action) {
  prompts.set(player, action);
  player.setEnteredAmountAction(action);
  player.getPacketSender().sendEnterAmountPrompt(title);
}

/**
 * Closing the bank or the pouch interface closes a pouch prompt still open in the chatbox. Closing
 * an interface has already dropped the prompt's action; one that another prompt replaced is left.
 */
function closePrompt(player) {
  const action = prompts.get(player);
  if (!action) return;
  prompts.delete(player);
  const current = player.getEnteredAmountAction?.() ?? null;
  if (current !== null && current !== action) return;
  player.setEnteredAmountAction(null);
  player.getPacketSender().sendClientScript(MESLAYER_CLOSE_SCRIPT, COUNT_INPUT_MODE);
}

/** Login: runes from an old pouch's meta move onto the player, then every var is sent. */
function login(player) {
  migrateLegacyMeta(player);
  sendSlots(player);
  setVarbit(player, varbit("rune_pouch_customquantity"), customQuantity(player));
  setVarbit(player, varbit("rune_pouch_selectedquantity"), selectedQuantity(player));
}

/** Every pouch item still carrying runes in its meta, in the inventory or the bank. */
function legacyPouches(player) {
  const containers = [player.getInventory()];
  for (let tab = 0; tab < core.Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== core.Bank.BANK_SEARCH_TAB_INDEX) containers.push(player.getBank(tab));
  }
  return containers.flatMap((container) => container.getValidItems().filter(
    (item) => isPouch(item) && item.getMetaValue?.(LEGACY_META_KEY)));
}

function migrateLegacyMeta(player) {
  for (const pouch of legacyPouches(player)) {
    const stored = pouch.getMetaValue(LEGACY_META_KEY);
    pouch.setMetaValue(LEGACY_META_KEY, undefined);
    for (const [id, amount] of Object.entries(stored ?? {})) {
      const runeId = Number(id);
      const count = Number(amount);
      if (!isRune(runeId) || !Number.isInteger(count) || count <= 0) continue;
      // Runes that no longer fit (a second old pouch) go to the bank rather than being lost.
      const kept = store(player, runeId, count, SLOTS);
      if (count > kept) addToBank(player, runeId, count - kept);
    }
  }
}

module.exports = {
  RUNES_ATTRIBUTE,
  SELECTED_QUANTITY_ATTRIBUTE,
  CUSTOM_QUANTITY_ATTRIBUTE,
  LEGACY_META_KEY,
  MAX_AMOUNT,
  SLOTS,
  POUCHES,
  MESSAGE,
  init,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  varbit,
  component,
  runeOf,
  typeOf,
  isRune,
  isPouch,
  findPouch,
  slotCount,
  slots,
  setSlots,
  isEmpty,
  amountOf,
  room,
  store,
  take,
  spend,
  inventoryFits,
  addToInventory,
  bankAmount,
  addToBank,
  takeFromBank,
  refreshBank,
  setVarbit,
  sendSlots,
  sendPouchSlots,
  customQuantity,
  setCustomQuantity,
  selectedQuantity,
  setSelectedQuantity,
  askAmount,
  closePrompt,
  login,
};
