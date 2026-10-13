/**
 * Pouch loadouts in the bank's pouch view (docs/rune-pouch.md), ten of them (a-j), each a rune
 * and a quantity limit per pouch slot, plus a name picked from a fixed list.
 *
 * Captured:
 * - Clicking a loadout slot opens the client's item search; the chosen rune is set (the slot's
 *   limit cleared first) and "<Rune>: Set a quantity limit? (1 - 15,999, or 0 for no limit)"
 *   asked. The search's "Empty slot" entry answers with pattern_lime_dummy, which clears the
 *   slot (script 4876 lists it first, 4877 resumes with the picked obj).
 * - Loading banks the pouch's runes, then fills each slot up to its limit (16,000 with none),
 *   from the inventory first and then the bank. Short of a limit: "Your pouch could not find
 *   sufficient runes."; otherwise "Loading pouch load-out N...".
 * - A name button selects which loadout is being named (rune_pouch_loadout_name_selected) and a
 *   pick from the list stores the name's key (enum 5865) in rune_pouch_loadout_name_<letter>.
 *
 * The cache packs some of these varbits in two or three parts (`_bitsa`, `_bitsb`, `_bitsc`);
 * the first part holds the low bits (captured for a_rune1/a_rune2).
 */
const Pouch = require("./Common.RunePouch");
const View = require("./Bank.RunePouch");

const LOADOUTS_ATTRIBUTE = "rune-pouch:loadouts";
const LOADOUT_COUNT = View.LOADOUTS.length;
const MAX_LIMIT = 15999;
/** The rune search's "Empty slot" entry (pattern_lime_dummy). */
const EMPTY_SLOT = 11526;
const MESSAGE = {
  INSUFFICIENT: "Your pouch could not find sufficient runes.",
  LOADING: (number) => `Loading pouch load-out ${number}...`,
  LIMIT: (name) => `${name}: Set a quantity limit? (1 - 15,999, or 0 for no limit)`,
};

let COMPONENT = null;

function components() {
  const letters = [...View.LOADOUTS];
  COMPONENT ??= {
    slots: letters.map((letter) => Pouch.component(`bankside:runepouch_loadout_${letter}`)),
    load: letters.map((letter) => Pouch.component(`bankside:runepouch_load_${letter}`)),
    names: letters.map((letter) => Pouch.component(`bankside:runepouch_name_${letter}`)),
    nameList: Pouch.component("bankside:runepouch_name_select_list"),
  };
  return COMPONENT;
}

// ------------------------------------------------------------------ storage

/** Ten loadouts, each `{ runes: [{ id, limit } | null x4], name }`. */
function loadouts(player) {
  const saved = player.getAttribute(LOADOUTS_ATTRIBUTE);
  return Array.from({ length: LOADOUT_COUNT }, (_, index) => {
    const entry = Array.isArray(saved) ? saved[index] : null;
    return {
      runes: Array.from({ length: Pouch.SLOTS }, (_, slot) => {
        const rune = entry?.runes?.[slot];
        const id = Number(rune?.[0]);
        const limit = Number(rune?.[1]);
        return Pouch.isRune(id) ? { id, limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 0), MAX_LIMIT) : 0 } : null;
      }),
      name: Number.isInteger(entry?.name) ? entry.name : 0,
    };
  });
}

function save(player, all) {
  player.setAttribute(LOADOUTS_ATTRIBUTE, all.map((loadout) => ({
    runes: loadout.runes.map((rune) => (rune ? [rune.id, rune.limit] : null)),
    name: loadout.name,
  })));
}

// ------------------------------------------------------------------ varbits

/** Writes a value to a varbit by name, or across its `_bitsa`/`_bitsb`/`_bitsc` parts, low bits first. */
function setPacked(player, name, value) {
  const whole = Pouch.varbit(name);
  if (whole !== null) {
    Pouch.setVarbit(player, whole, value);
    return;
  }
  let shift = 0;
  for (const part of ["bitsa", "bitsb", "bitsc"]) {
    const id = Pouch.varbit(`${name}_${part}`);
    if (id === null) break;
    const { startBit, endBit } = Pouch.core.CacheDefinitions.getVarbit(id);
    const width = endBit - startBit + 1;
    Pouch.setVarbit(player, id, (value >>> shift) & ((1 << width) - 1));
    shift += width;
  }
}

function sendSlot(player, index, slot, rune) {
  const letter = View.LOADOUTS[index];
  setPacked(player, `rune_pouch_loadout_${letter}_cap${slot + 1}`, rune?.limit ?? 0);
  setPacked(player, `rune_pouch_loadout_${letter}_rune${slot + 1}`, rune ? Pouch.typeOf(rune.id) : 0);
}

function sendName(player, index, name) {
  Pouch.setVarbit(player, Pouch.varbit(`rune_pouch_loadout_name_${View.LOADOUTS[index]}`), name);
}

function login({ player }) {
  loadouts(player).forEach((loadout, index) => {
    loadout.runes.forEach((rune, slot) => sendSlot(player, index, slot, rune));
    sendName(player, index, loadout.name);
  });
}

// ------------------------------------------------------------------ setting a slot

function pickRune(player, index, slot, picked) {
  const runeId = Number(picked);
  if (!View.viewing(player)) return;
  if (runeId === EMPTY_SLOT) return clearSlot(player, index, slot);
  if (!Pouch.isRune(runeId)) return;
  const all = loadouts(player);
  all[index].runes[slot] = { id: runeId, limit: 0 };
  save(player, all);
  sendSlot(player, index, slot, null);
  sendSlot(player, index, slot, all[index].runes[slot]);
  const name = Pouch.core.ItemDefinition.forId(runeId).getName();
  Pouch.askAmount(player, MESSAGE.LIMIT(name), {
    acceptsZero: true,
    execute(amount) {
      const latest = loadouts(player);
      const rune = latest[index].runes[slot];
      if (rune?.id !== runeId) return;
      rune.limit = Math.min(Math.max(Math.floor(amount), 0), MAX_LIMIT);
      save(player, latest);
      sendSlot(player, index, slot, rune);
    },
  });
}

function clearSlot(player, index, slot) {
  const all = loadouts(player);
  all[index].runes[slot] = null;
  save(player, all);
  sendSlot(player, index, slot, null);
}

/** The client opens its item search on the click and answers with the pick. */
function clickSlot(player, index, slot) {
  if (slot < 0 || slot >= Pouch.SLOTS) return;
  player.setEnteredSyntaxAction({ execute: (picked) => pickRune(player, index, slot, picked) });
}

// ------------------------------------------------------------------ loading

/** Takes up to `wanted` of a rune, from the inventory first and then the bank; returns how many. */
function gather(player, runeId, wanted) {
  const inventory = player.getInventory();
  const fromInventory = Math.min(wanted, inventory.getAmount(runeId));
  if (fromInventory > 0) inventory.deleteNumber(runeId, fromInventory);
  const fromBank = Math.min(wanted - fromInventory, Pouch.bankAmount(player, runeId));
  if (fromBank > 0) Pouch.takeFromBank(player, runeId, fromBank);
  return fromInventory + fromBank;
}

function load(player, index) {
  const loadout = loadouts(player)[index];
  const count = Pouch.slotCount(player);
  // The pouch's runes go back to the bank first.
  Pouch.slots(player).forEach((entry) => {
    if (entry) Pouch.addToBank(player, entry.id, entry.amount);
  });
  Pouch.setSlots(player, Array.from({ length: Pouch.SLOTS }, () => null));
  let short = false;
  const filled = Array.from({ length: Pouch.SLOTS }, () => null);
  loadout.runes.slice(0, count).forEach((rune, slot) => {
    if (!rune) return;
    const wanted = rune.limit > 0 ? rune.limit : Pouch.MAX_AMOUNT;
    const got = gather(player, rune.id, wanted);
    if (got < wanted && (rune.limit > 0 || got === 0)) short = true;
    if (got > 0) filled[slot] = { id: rune.id, amount: got };
  });
  Pouch.setSlots(player, filled);
  player.getInventory().refreshItems();
  Pouch.refreshBank(player);
  player.sendMessage(short ? MESSAGE.INSUFFICIENT : MESSAGE.LOADING(index + 1));
}

// ------------------------------------------------------------------ names

function selectName(player, index) {
  Pouch.setVarbit(player, Pouch.varbit("rune_pouch_loadout_name_selected"), index + 1);
}

function pickName(player, sub) {
  const selected = player.getPacketSender().getVarbit(Pouch.varbit("rune_pouch_loadout_name_selected"));
  const rows = Pouch.core.CacheDefinitions.getEnumValues(View.NAME_ORDER_ENUM);
  const name = rows.get(sub - rows.size);
  if (!(selected > 0) || selected > LOADOUT_COUNT || name === undefined) return;
  const all = loadouts(player);
  all[selected - 1].name = Number(name);
  save(player, all);
  sendName(player, selected - 1, Number(name));
}

// ------------------------------------------------------------------ clicks

function click(event) {
  if (event.groupId !== 15) return;
  const { slots, load: loadButtons, names, nameList } = components();
  const buttonId = (event.groupId << 16) | event.childId;
  const slotIndex = slots.indexOf(buttonId);
  const loadIndex = loadButtons.indexOf(buttonId);
  const nameIndex = names.indexOf(buttonId);
  if (slotIndex < 0 && loadIndex < 0 && nameIndex < 0 && buttonId !== nameList) return;
  event.handled = true;
  const { player } = event;
  if (!View.viewing(player)) return;
  if (slotIndex >= 0 && Number.isInteger(event.slot)) clickSlot(player, slotIndex, event.slot - 1);
  else if (loadIndex >= 0) load(player, loadIndex);
  else if (nameIndex >= 0) selectName(player, nameIndex);
  else if (Number.isInteger(event.slot)) pickName(player, event.slot);
}

module.exports = function attach(api) {
  api.persistAttribute(LOADOUTS_ATTRIBUTE);
  api.onPlayerLogin(login);
  api.onInterfaceActionClick(click);
};

module.exports._test = { LOADOUTS_ATTRIBUTE, loadouts, setPacked, pickRune, clickSlot, load, pickName, selectName, click, MESSAGE };
