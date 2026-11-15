/**
 * Potion storage (Wiki: Bank, "Potion storage"): bought from the Mastering Mixology reward shop
 * (mm_potion_storage_unlocked), opened from inside the bank; potions there don't use bank space.
 * Stored potions are doses with their vials kept apart; the bank setting "deposit-potion-storage"
 * (bank_depositpotion) sends applicable items there from every tab.
 *
 * The client draws it all from varps (potionstore_content_draw): each potion's doses (varp),
 * its chosen withdraw size (varbit, the size less one), the eight favourites (varps holding the
 * potion's 1-dose obj) and the vials (potionstore_vials). The list is data/potion-storage.json,
 * from the cache; five bankmain:potionstore_items components an entry, in that order (sub / 5),
 * and the section headers after them carry the "Vials:" text with its own withdraw ops.
 *
 * Recorded (rsprox_transcripts/238/04233.txt, 231/911268.txt and others, rev 230-242):
 * - The Potion Storage button sends potionstore_previous_tab (the tab it came from) and
 *   bank_currenttab 15; a bank tab click leaves it.
 * - With it open, a bankside Deposit op on a potion (or its note) or a vial stores it: its
 *   doses on the potion's varp and a vial a potion; empty vials add to the vials.
 * - Withdraw ops on an entry give potions of the chosen size, a dose size's worth of doses and a
 *   vial each, as notes in note mode. Asking for more than the doses make: "You don't have enough
 *   doses in storage to withdraw that amount." (what they do make still comes), or for more than the
 *   vials "You don't have enough vials in storage to withdraw that amount." (that line first); no
 *   vials at all: "You don't have any vials.". The "1 Dose" .. "4 Dose" ops (6-9 on the entry's picture) set the size.
 * - The Vials text's withdraw ops give empty vials.
 * - The favourite icon's op flips the favourite in the client (potionstore_favourite_button);
 *   the server keeps the same eight.
 *
 * - Deposit inventory there stores every storable item (deposit-locked slots stay), and the bank
 *   takes the rest (231/911268 ticks 220, 304; 238/04235 9367). A potion's first doses set its
 *   withdraw size to their own (tick 220: super combat to 4).
 * - Unfinished potions store a vial too (238/04233 tick 4556: 13 noted guam unfinished, 13 vials).
 *
 * Not built: the deposit box, the Deposit inventory keybind packet (it skips the widget click),
 * potion storage in bank searches and presets.
 */
const DATA = require("./data/potion-storage.json");

const STORAGE_ATTRIBUTE = "bank-settings:potion-storage";
/** potionstore_content_draw shows the storage while bank_currenttab is 15. */
const POTION_TAB = 15;
const COMPONENTS_PER_ENTRY = 5;
const WITHDRAW_SUB = 0;
const PICTURE_SUB = 1;
const FAVOURITE_SUB = 4;
const FAVOURITES = 8;
/** Ops 6-9 on the picture: "1 Dose" .. "4 Dose". */
const FIRST_DOSE_OP = 6;
/** The potion enums' keys: 0 the vial, 1-4 the doses; their notes at -10 - dose. */
const NOTE_KEY = (dose) => -10 - dose;
const MAX_INT = 2147483647;

const TEXT = {
  noDoses: "You don't have enough doses in storage to withdraw that amount.",
  noVials: "You don't have any vials.",
  fewVials: "You don't have enough vials in storage to withdraw that amount.",
};

let api;
let core;
let ids;
/** Players looking at the storage (bank_currenttab 15). */
const viewing = new WeakSet();

function lookup() {
  if (ids) return ids;
  const { CacheDefinitions } = core;
  const entries = DATA.potions.map((entry, index) => {
    const values = CacheDefinitions.getEnumValues(entry.enum);
    const doseObjs = new Map();
    for (let dose = 1; dose <= 4; dose++) if (Number.isInteger(values.get(dose))) doseObjs.set(dose, values.get(dose));
    const notes = new Map();
    // The potions' enums list their notes; the unfinished potions' don't, so their own note is used.
    for (const [dose, obj] of doseObjs) {
      const note = Number.isInteger(values.get(NOTE_KEY(dose))) ? values.get(NOTE_KEY(dose)) : core.ItemDefinition.forId(obj).getNoteId();
      if (Number.isInteger(note) && note > 0 && note !== obj) notes.set(dose, note);
    }
    return {
      index,
      dosesVarp: CacheDefinitions.getVarpId(entry.doses),
      doses: entry.doses,
      sizeVarbit: entry.size ? CacheDefinitions.getVarbitId(entry.size) : null,
      size: entry.size ?? null,
      doseObjs,
      notes,
      favouriteObj: doseObjs.get(1),
    };
  });
  /** Every potion obj and note -> [entry, dose]. */
  const byObj = new Map();
  for (const entry of entries) {
    for (const [dose, obj] of entry.doseObjs) byObj.set(obj, [entry, dose]);
    for (const [dose, obj] of entry.notes) byObj.set(obj, [entry, dose]);
  }
  const component = (name) => CacheDefinitions.getComponentId(name);
  ids = {
    entries,
    byObj,
    button: component("bankmain:potionstore_button"),
    items: component("bankmain:potionstore_items"),
    tabs: component("bankmain:tabs"),
    depositInventory: component("bankmain:depositinv"),
    vialsVarp: CacheDefinitions.getVarpId("potionstore_vials"),
    favouriteVarps: Array.from({ length: FAVOURITES }, (_, i) => CacheDefinitions.getVarpId(`potionstore_favourite_${i + 1}`)),
    previousTab: CacheDefinitions.getVarbitId("potionstore_previous_tab"),
    currentTab: CacheDefinitions.getVarbitId("bank_currenttab"),
    unlocked: CacheDefinitions.getVarbitId("mm_potion_storage_unlocked"),
    depositSetting: CacheDefinitions.getVarbitId("bank_depositpotion"),
    vial: core.ItemIdentifiers.VIAL,
    vialNote: core.ItemDefinition.forId(core.ItemIdentifiers.VIAL).getNoteId(),
  };
  return ids;
}

/** The saved storage: { doses: { varp name: n }, sizes: { varbit name: v }, vials, favourites }. */
function storage(player) {
  let saved = player.getAttribute(STORAGE_ATTRIBUTE);
  if (!saved || typeof saved !== "object") {
    saved = { doses: {}, sizes: {}, vials: 0, favourites: [] };
    player.setAttribute(STORAGE_ATTRIBUTE, saved);
  }
  saved.doses ??= {};
  saved.sizes ??= {};
  saved.vials = Math.max(0, Number(saved.vials) | 0);
  if (!Array.isArray(saved.favourites)) saved.favourites = [];
  return saved;
}

const dosesOf = (player, entry) => Math.max(0, Number(storage(player).doses[entry.doses]) | 0);
/** The chosen withdraw size: the varbit + 1 (potionstore_get_vile_size); 1 without one. */
const sizeOf = (player, entry) => (entry.size ? (Number(storage(player).sizes[entry.size]) | 0) : 0) + 1;

function unlocked(player) {
  return player.getPacketSender().getVarbit(lookup().unlocked) === 1;
}

function sendAll(player) {
  const known = lookup();
  const saved = storage(player);
  const sender = player.getPacketSender();
  for (const entry of known.entries) {
    sender.sendConfig(entry.dosesVarp, dosesOf(player, entry));
    if (entry.sizeVarbit !== null) sender.sendVarbit(entry.sizeVarbit, sizeOf(player, entry) - 1);
  }
  sender.sendConfig(known.vialsVarp, saved.vials);
  known.favouriteVarps.forEach((varp, i) => sender.sendConfig(varp, saved.favourites[i] ?? -1));
}

function setDoses(player, entry, doses) {
  storage(player).doses[entry.doses] = doses;
  player.getPacketSender().sendConfig(entry.dosesVarp, doses);
}

function setVials(player, vials) {
  storage(player).vials = vials;
  player.getPacketSender().sendConfig(lookup().vialsVarp, vials);
}

/** Whether deposits go here: the storage tab open, or the bank setting on. */
function routing(player) {
  if (!unlocked(player) || !core.Bank.isOpen(player)) return false;
  return viewing.has(player) || player.getPacketSender().getVarbit(lookup().depositSetting) === 1;
}

function openStorage(player) {
  const known = lookup();
  const sender = player.getPacketSender();
  sender.sendVarbit(known.previousTab, player.getCurrentBankTab());
  sender.sendVarbit(known.currentTab, POTION_TAB);
  viewing.add(player);
}

const stackable = (id) => core.ItemDefinition.forId(id).isStackable();

/** `count` of the inventory item in `slot` stored: doses and a vial a potion, or the vials themselves. */
function store(player, slot, count) {
  const known = lookup();
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() < 0 || count <= 0) return false;
  const id = item.getId();
  const potion = known.byObj.get(id);
  if (id !== known.vial && id !== known.vialNote && !potion) return false;
  let taken = 0;
  if (stackable(id)) {
    taken = Math.min(count, item.getAmount());
    inventory.deleteAtSlot(slot, taken, false);
  } else {
    // One a slot: the clicked one first, then the others of the same kind in slot order.
    const slots = [slot, ...inventory.getItems().map((_, i) => i).filter((i) => i !== slot)];
    for (const at of slots) {
      if (taken >= count) break;
      if (inventory.getItems()[at]?.getId() !== id) continue;
      inventory.deleteAtSlot(at, 1, false);
      taken++;
    }
  }
  if (taken <= 0) return false;
  if (potion) {
    const [entry, dose] = potion;
    // A potion's first doses set its withdraw size to theirs (rsprox 231/911268 tick 220).
    if (dosesOf(player, entry) === 0 && entry.sizeVarbit !== null) {
      storage(player).sizes[entry.size] = dose - 1;
      player.getPacketSender().sendVarbit(entry.sizeVarbit, dose - 1);
    }
    setDoses(player, entry, dosesOf(player, entry) + dose * taken);
  }
  setVials(player, storage(player).vials + taken);
  inventory.refreshItems();
  return true;
}

/** Bank.INVENTORY_OP_EVENT: a bankside Deposit op on a storable item while deposits go here. */
function depositOp(event) {
  const { player, item, slot, op, option } = event;
  if (event.handled || !routing(player)) return;
  const known = lookup();
  const id = item?.getId?.();
  if (id !== known.vial && id !== known.vialNote && !known.byObj.has(id)) return;
  const { Bank } = core;
  if (op === 1 || op === 9 || op === 10) return;
  event.handled = true;
  if (Bank.asksAmount("deposit", op, option, player.getBankCustomQuantity(), player.getBankQuantityMode())) {
    Bank.promptAmount(player, (amount) => {
      if (player.getInventory().getItems()[slot]?.getId() === id) store(player, slot, amount);
    });
    return;
  }
  const available = player.getInventory().getAmount(id);
  const amount = Bank.actionAmount("deposit", op, option, available, player.getBankCustomQuantity(), player.getBankQuantityMode());
  store(player, slot, amount);
}

/** Whether `slot` is a deposit-locked inventory slot (BankSettings' deposit locks, when there). */
function lockedSlot(player, slot) {
  const request = { player, settings: null };
  api.emitCustomEvent("bank:deposit-locks", request);
  const locks = request.settings;
  return !!locks && !locks.ignoreLocks && (locks.locks & (1 << slot)) !== 0;
}

/** Deposit inventory while deposits go here: the storable items first, the bank takes the rest. */
function depositInventory(player) {
  const known = lookup();
  const inventory = player.getInventory();
  for (let slot = 0; slot < inventory.capacity(); slot++) {
    const id = inventory.getItems()[slot]?.getId();
    if (id === undefined || id < 0 || (id !== known.vial && id !== known.vialNote && !known.byObj.has(id))) continue;
    if (lockedSlot(player, slot)) continue;
    store(player, slot, inventory.getItems()[slot].getAmount());
  }
}

/** Up to `count` potions of `entry` at the chosen size: doses and a vial each. */
function withdrawPotions(player, entry, requested) {
  const saved = storage(player);
  const size = sizeOf(player, entry);
  const obj = entry.doseObjs.get(size);
  if (!Number.isInteger(obj) || requested <= 0) return;
  if (saved.vials <= 0) {
    player.sendMessage(TEXT.noVials);
    return;
  }
  const possible = Math.floor(dosesOf(player, entry) / size);
  // One line, the vials' first (tick 1632: 1 vial, 4 doses, Withdraw-5), else the doses' (280, 1546).
  if (requested > saved.vials) player.sendMessage(TEXT.fewVials);
  else if (requested > possible) player.sendMessage(TEXT.noDoses);
  const wanted = Math.min(requested, possible, saved.vials);
  const given = give(player, player.withdrawAsNote() ? entry.notes.get(size) ?? obj : obj, wanted);
  if (given <= 0) return;
  setDoses(player, entry, dosesOf(player, entry) - given * size);
  setVials(player, saved.vials - given);
}

function withdrawVials(player, requested) {
  const saved = storage(player);
  const known = lookup();
  const wanted = Math.min(requested, saved.vials);
  if (wanted <= 0) return;
  const given = give(player, player.withdrawAsNote() && known.vialNote > 0 ? known.vialNote : known.vial, wanted);
  if (given > 0) setVials(player, saved.vials - given);
}

/** Adds up to `count` of `id`, as many as fit; how many went in. */
function give(player, id, count) {
  const inventory = player.getInventory();
  const fits = inventory.getAddableAmount(new core.Item(id, count));
  if (fits <= 0) {
    inventory.full();
    return 0;
  }
  if (stackable(id)) inventory.add(new core.Item(id, fits), false);
  else for (let i = 0; i < fits; i++) inventory.add(new core.Item(id, 1), false);
  inventory.refreshItems();
  return fits;
}

/** Withdraw ops 1-8 (bank's own meanings: default, 1, 5, 10, last X, X, All, All-but-1). */
function withdrawRequest(player, op, available, then) {
  const { Bank } = core;
  if (Bank.asksAmount("withdraw", op, undefined, player.getBankCustomQuantity(), player.getBankQuantityMode())) {
    Bank.promptAmount(player, then);
    return;
  }
  if (op === 7) return then(available);
  if (op === 8) return then(Math.max(0, available - 1));
  then(Bank.actionAmount("withdraw", op, undefined, MAX_INT, player.getBankCustomQuantity(), player.getBankQuantityMode()));
}

function chooseSize(player, entry, op) {
  const dose = op - FIRST_DOSE_OP + 1;
  if (entry.sizeVarbit === null || !entry.doseObjs.has(dose)) return;
  storage(player).sizes[entry.size] = dose - 1;
  player.getPacketSender().sendVarbit(entry.sizeVarbit, dose - 1);
}

/** potionstore_favourite_button: off if it is one, else into the first free place of eight. */
function toggleFavourite(player, entry) {
  const known = lookup();
  const saved = storage(player);
  const obj = entry.favouriteObj;
  if (!Number.isInteger(obj)) return;
  const at = saved.favourites.indexOf(obj);
  if (at >= 0) saved.favourites[at] = -1;
  else {
    const free = Array.from({ length: FAVOURITES }, (_, i) => i).find((i) => !(saved.favourites[i] > 0));
    if (free === undefined) return;
    saved.favourites[free] = obj;
  }
  known.favouriteVarps.forEach((varp, i) => player.getPacketSender().sendConfig(varp, saved.favourites[i] ?? -1));
}

function itemsClick(player, sub, op) {
  const known = lookup();
  const index = Math.floor(sub / COMPONENTS_PER_ENTRY);
  const entry = known.entries[index];
  if (!entry) {
    // Past the entries: the section headers, whose "Vials:" text has the withdraw ops.
    if (op >= 1 && op <= 8) withdrawRequest(player, op, storage(player).vials, (amount) => withdrawVials(player, amount));
    return;
  }
  const part = sub % COMPONENTS_PER_ENTRY;
  if (part === WITHDRAW_SUB && op >= 1 && op <= 8) {
    const possible = Math.floor(dosesOf(player, entry) / sizeOf(player, entry));
    withdrawRequest(player, op, possible, (amount) => withdrawPotions(player, entry, amount));
  } else if (part === PICTURE_SUB && op >= FIRST_DOSE_OP && op <= FIRST_DOSE_OP + 3) chooseSize(player, entry, op);
  else if (part === FAVOURITE_SUB && op === 1) toggleFavourite(player, entry);
}

/** "player:widget-action": the Potion Storage button, its items, and the bank's tabs (which leave it). */
function widgetAction(event) {
  const { player, packet } = event;
  if (!player || !packet || packet.groupId !== core.Bank.MAIN_INTERFACE_ID) return;
  const known = lookup();
  if (packet.widgetId === known.tabs) {
    viewing.delete(player);
    return;
  }
  // Not handled: the bank's own Deposit inventory runs after and banks what is left.
  if (packet.widgetId === known.depositInventory) {
    if (packet.buttonNum === 1 && routing(player)) depositInventory(player);
    return;
  }
  if (!core.Bank.isOpen(player) || !unlocked(player)) return;
  if (packet.widgetId === known.button) {
    if (packet.buttonNum !== 1) return;
    event.handled = true;
    openStorage(player);
  } else if (packet.widgetId === known.items && Number.isInteger(packet.slot)) {
    event.handled = true;
    if (viewing.has(player)) itemsClick(player, packet.slot, packet.buttonNum);
  }
}

function bankOpened({ player }) {
  viewing.delete(player);
}

function login({ player }) {
  sendAll(player);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.persistAttribute(STORAGE_ATTRIBUTE, null);
  api.onPlayerLogin(login);
  api.onCustomEvent("player:widget-action", widgetAction);
  api.onCustomEvent(core.Bank.INVENTORY_OP_EVENT, depositOp);
  api.onCustomEvent(core.Bank.OPENED_EVENT, bankOpened);
}

module.exports = { attach, storage, store, withdrawPotions, withdrawVials, itemsClick, widgetAction, depositOp, TEXT, STORAGE_ATTRIBUTE, viewing };
