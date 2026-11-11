/**
 * Chugging barrel (https://oldschool.runescape.wiki/w/Chugging_barrel): assembled (30000) it holds up
 * to five potions, 100 doses each; it drinks one dose of every stored potion in one click. Dismantling
 * it loses the stored potions. Captured in rsprox 4236 (assemble, dismantle, the destroy confirm,
 * "can't store" and "no space" refusals), 4242 (drink, one dose of each potion per click).
 *
 * Native contents interface: rsprox 4236/4237/4239/4242; cache 241 group 886, script 7338, inv 911.
 * Bank-side loadouts and potion storage are separate content.
 */
const Potions = require("./Potions.plugin");
const { examineItem } = require("../../src/main/typescript/elvarg/game/content/ExaminePrice");

const CONTENTS_ATTRIBUTE = "chugging-barrel:potions";
/** Wiki: a maximum of 100 doses per potion, and up to five different potions. */
const DOSES_PER_POTION = 100;
const POTION_TYPES = 5;
// Cache prepot_device; native slots are built by prepot_device_init, not server widgets.
const INTERFACE = 886;
const CONTENTS_WIDGET = (INTERFACE << 16) | 7;
const INVENTORY_WIDGET = (INTERFACE << 16) | 12;
const CONTENTS_INVENTORY = 911;
const INIT_SCRIPT = 7338;
const ITEM_FLAGS = 0x100000 | (3 << 17) | 0x5fe; // OP1..8, OP10, DEPTH3, DRAGTARGET (4237).
const SESSIONS = new WeakMap();
/** Captured: the assemble and dismantle animation (rsprox 4236, line 3382). */
const ASSEMBLE_ANIMATION = 10097;
/** Captured: the drink animation (rsprox 4242, line 48334). */
const DRINK_ANIMATION = 11645;
/** Captured: the barrel's own drink sound, once per click (rsprox 4242), after 30 client ticks. */
const DRINK_SOUND_ID = 9491;
const DRINK_SOUND_DELAY = 30;
const ASSEMBLED_NAME = "Chugging barrel";
const DISASSEMBLED_NAME = "Chugging barrel (disassembled)";
/** Drinks registered as potions for ordinary consumption but not accepted by the barrel. */
const NON_POTION_DRINKS = new Set([
  "Beer", "Cup of tea", "House ale", "Moonlight mead", "Moonlight mead(m)",
  "Slayer's respite", "Slayer's respite(m)",
]);
/** These food-permission drinks are potions and are listed as barrel-compatible. */
const FOOD_PERMISSION_POTIONS = new Set(["Guthix rest", "Saradomin brew"]);

const MESSAGE = {
  /** Captured (4236). */
  ASSEMBLE: "You assemble the Chugging barrel.",
  DISASSEMBLE: "You disassemble the Chugging barrel.",
  NO_POTIONS: "You have no potions in your barrel that you can drink.",
  CANNOT_STORE: "You can't store that in the chugging barrel.",
  FULL: (name) => `Your chugging barrel doesn't have space to store any more ${name}.`,
  WITHDRAWN: (doses, name) => `Deposited ${doses} ${doses === 1 ? "dose" : "doses"} of ${name}.`,
  NO_SPACE: (name) => `You don't have space to deposit any doses of ${name}.`,
  NO_STORAGE: (name) => `You don't have any more doses of ${name} in storage.`,
  FILLED: (doses, name) => `Your chugging barrel has been filled with ${doses} ${doses === 1 ? "dose" : "doses"} of ${name}.`,
  DRINK: (name) => `You drink some of your ${name}.`,
  /** Captured (4236): using a barrel away from a bank. */
  NEAR_BANK: "You must be near a bank to use that barrel.",
  /** Captured (4236): the warning shown before dismantling a barrel that still holds potions. */
  DISMANTLE_WARNING: "Are you sure you want to disassemble the barrel?<br>The potions stored will be lost.",
};

let api = null;
let core = null;

function contents(player) {
  const previous = player.getAttribute(CONTENTS_ATTRIBUTE) ?? {};
  const used = new Set();
  // Old saves have insertion order only. Keep every entry/dose, including legacy excess.
  for (const store of Object.values(previous)) {
    if (!Number.isInteger(store.slot) || store.slot < 0 || used.has(store.slot)) {
      store.slot = 0;
      while (used.has(store.slot)) store.slot++;
    }
    used.add(store.slot);
  }
  const stored = {};
  for (const [key, store] of Object.entries(previous)) {
    const dose = Potions.doseOf(store.itemId);
    const canonical = dose ? familyKey(dose) : key;
    // Keep a colliding legacy entry rather than silently discarding its doses or markings.
    stored[Object.hasOwn(stored, canonical) ? key : canonical] = store;
  }
  if (Object.keys(previous).some((key) => !Object.hasOwn(stored, key))) player.setAttribute(CONTENTS_ATTRIBUTE, stored);
  return stored;
}

function save(player, next) {
  player.setAttribute(CONTENTS_ATTRIBUTE, next);
  refresh(player);
}

function nearBank(player) {
  const query = { player, near: false };
  api.emitCustomEvent("league:near-bank", query);
  return query.near === true;
}

function isBarrelAtSlot(player, item, slot) {
  return Number.isInteger(slot) && player.getInventory().getItems()[slot] === item &&
    item?.getId?.() === core.ItemIdentifiers.CHUGGING_BARREL;
}

function canStore(dose) {
  const name = dose.potion.name;
  if (dose.potion.area || name === "Hunting mix" || NON_POTION_DRINKS.has(name)) return false;
  return !dose.potion.requiresFoodPermission || name.endsWith("mix") || FOOD_PERMISSION_POTIONS.has(name);
}

/** "Prayer potion(4)" -> "Prayer potion". */
function baseName(item) {
  return core.CacheDefinitions.getItem(item.getId()).name.replace(/\(\d+\)$/, "");
}

/** "Prayer potion(4)" -> "Prayer potion(1)", the form the barrel's messages use. */
function oneDoseName(item) {
  return `${baseName(item)}(1)`;
}

function setItem(player, item, id) {
  item.setId(id);
  player.getInventory().refreshItems();
}

function assemble({ player, item }) {
  setItem(player, item, core.ItemIdentifiers.CHUGGING_BARREL);
  player.performAnimation(new core.Animation(ASSEMBLE_ANIMATION));
  player.sendMessage(MESSAGE.ASSEMBLE);
}

function dismantle({ player, item, slot }) {
  if (!isBarrelAtSlot(player, item, slot)) return;
  const next = () => {
    logout({ player });
    setItem(player, item, core.ItemIdentifiers.CHUGGING_BARREL_DISASSEMBLED_);
    player.performAnimation(new core.Animation(ASSEMBLE_ANIMATION));
    player.sendMessage(MESSAGE.DISASSEMBLE);
  };
  if (Object.keys(contents(player)).length === 0) {
    next();
    return;
  }
  player.getPacketSender().sendInterfaceRemoval();
  api.sendMultiChatboxPrompt(player, MESSAGE.DISMANTLE_WARNING, "Yes.", () => {
    if (!isBarrelAtSlot(player, item, slot)) return;
    save(player, {});
    next();
  });
}

/** The swig, its sound and the shared potion and food delays, once per click, when a first potion drinks. */
function startDrinking(player) {
  const timers = player.getTimers();
  timers.extendOrRegister(core.TimerKey.POTION, 3);
  timers.extendOrRegister(core.TimerKey.FOOD, 3);
  player.performAnimation(new core.Animation(DRINK_ANIMATION));
  core.Sounds.sendSound(player, new core.Sound(DRINK_SOUND_ID, 1, DRINK_SOUND_DELAY, 0));
}

function drink({ player }) {
  if (!nearBank(player)) {
    player.sendMessage(MESSAGE.NEAR_BANK);
    return;
  }
  const stored = contents(player);
  const potions = Object.entries(stored).sort((a, b) => a[1].slot - b[1].slot).slice(0, POTION_TYPES);
  if (!potions.some(([, store]) => Potions.doseOf(store.itemId))) {
    player.sendMessage(MESSAGE.NO_POTIONS);
    return;
  }
  const timerRefusal = Potions.drinkTimerRefusal(player);
  if (timerRefusal) {
    if (timerRefusal.message) player.sendMessage(timerRefusal.message);
    return;
  }
  let started = false;
  const refused = new Set();
  for (const [key, store] of potions) {
    const dose = Potions.doseOf(store.itemId);
    if (!dose) continue;
    // Captured (4242): a refused potion (a divine potion at low Hitpoints) says why and keeps its dose;
    // the rest still drink, in the barrel's order, each against the state the one before left.
    // A player-wide veto (the canDrink hooks, say) is told once; a potion's own refusal is told per potion.
    const permission = Potions.drinkPermissionRefusal(player, dose.entry);
    if (permission) {
      if (!refused.has(permission)) player.sendMessage(permission);
      refused.add(permission);
      continue;
    }
    const canUse = Potions.drinkCanUseRefusal(player, dose.entry);
    if (canUse) {
      player.sendMessage(canUse);
      continue;
    }
    if (!started) {
      started = true;
      startDrinking(player);
    }
    dose.potion.effect(player);
    player.sendMessage(MESSAGE.DRINK(store.name));
    api.emitCustomEvent("potions:drunk", {
      player,
      itemId: store.itemId,
      name: dose.potion.name,
      meta: store.meta ?? null,
    });
    if (store.doses - 1 > 0) stored[key] = { ...store, doses: store.doses - 1 };
    else delete stored[key];
  }
  save(player, stored);
}

function fill(player, item, slot) {
  if (!nearBank(player)) {
    player.sendMessage(MESSAGE.NEAR_BANK);
    return;
  }
  const dose = Potions.doseOf(item.getId());
  if (!dose) {
    player.sendMessage(MESSAGE.CANNOT_STORE);
    return;
  }
  if (!canStore(dose)) {
    player.sendMessage(MESSAGE.CANNOT_STORE);
    return;
  }
  const inventory = player.getInventory();
  if (!Number.isInteger(slot) || inventory.getItems()[slot] !== item || item.getAmount?.() !== 1) return;
  const key = familyKey(dose);
  const stored = contents(player);
  if (stored[key] && (Potions.doseOf(stored[key].itemId)?.entry.chain !== dose.entry.chain ||
      JSON.stringify(item.getMeta?.() ?? null) !== JSON.stringify(stored[key].meta ?? null))) {
    player.sendMessage(MESSAGE.CANNOT_STORE);
    return;
  }
  const current = stored[key]?.doses ?? 0;
  if (!stored[key] && Object.keys(stored).length >= POTION_TYPES) {
    player.sendMessage(MESSAGE.CANNOT_STORE);
    return;
  }
  if (current + dose.doses > DOSES_PER_POTION) {
    player.sendMessage(MESSAGE.FULL(oneDoseName(item)));
    return;
  }
  stored[key] = {
    itemId: item.getId(),
    name: baseName(item).toLowerCase(),
    doses: current + dose.doses,
    meta: item.getMeta?.() ?? null,
    slot: stored[key]?.slot ?? freeSlot(stored),
  };
  save(player, stored);
  const replacement = dose.emptyItemId;
  inventory.setItem(slot, new core.Item(replacement, replacement === -1 ? 0 : 1, item.getMeta?.())).refreshItems();
  player.sendMessage(MESSAGE.FILLED(dose.doses, oneDoseName(item)));
}

function useOnBarrel(event) {
  const { player, usedItem, usedWithItem } = event;
  const barrelFirst = usedItem?.getId?.() === core.ItemIdentifiers.CHUGGING_BARREL;
  const barrelSecond = usedWithItem?.getId?.() === core.ItemIdentifiers.CHUGGING_BARREL;
  if (!barrelFirst && !barrelSecond) return;
  event.handled = true;
  const item = barrelFirst ? usedWithItem : usedItem;
  const slot = barrelFirst ? event.usedWithItemSlot : event.usedItemSlot;
  fill(player, item, slot);
}

function freeSlot(stored) {
  const slots = new Set(Object.values(stored).map((store) => store.slot));
  let slot = 0;
  while (slots.has(slot)) slot++;
  return slot;
}

function familyKey(dose) {
  return String(dose.entry.chain[dose.entry.chain.length - 1]);
}

function family(itemId) {
  const dose = Potions.doseOf(itemId);
  return dose && canStore(dose) ? dose : null;
}

function displayed(store) {
  const dose = family(store.itemId);
  return dose ? dose.entry.chain[dose.entry.chain.length - Math.min(store.doses, dose.entry.chain.length)] : -1;
}

function current(player, session = SESSIONS.get(player)) {
  return session && SESSIONS.get(player) === session && player.getInterfaceId() === INTERFACE &&
    player.getInventory().getItems().includes(session.barrel) &&
    session.barrel.getId() === core.ItemIdentifiers.CHUGGING_BARREL && nearBank(player);
}

function refresh(player) {
  if (!current(player)) return;
  const stored = Object.values(contents(player));
  player.getPacketSender().sendInventory(CONTENTS_INVENTORY, POTION_TYPES,
    Array.from({ length: POTION_TYPES }, (_, slot) => {
      const store = stored.find((entry) => entry.slot === slot);
      const dose = store && family(store.itemId);
      return dose ? { id: dose.entry.chain[dose.entry.chain.length - 1], amount: store.doses } : { id: -1, amount: 0 };
    }), INTERFACE);
}

function open({ player, item, slot }) {
  if (!isBarrelAtSlot(player, item, slot)) return;
  if (!nearBank(player)) {
    player.sendMessage(MESSAGE.NEAR_BANK);
    return;
  }
  player.setEnteredAmountAction(null);
  player.getPacketSender().sendInterface(INTERFACE);
  SESSIONS.set(player, { barrel: item });
  refresh(player);
  player.getPacketSender()
    .sendInterfaceFlagsRange(CONTENTS_WIDGET, 0, POTION_TYPES - 1, ITEM_FLAGS)
    .sendInterfaceFlagsRange(INVENTORY_WIDGET, 0, 27, ITEM_FLAGS)
    .sendInterfaceScript(INIT_SCRIPT, [core.ItemIdentifiers.CHUGGING_BARREL]);
}

function logout({ player }) {
  const session = SESSIONS.get(player);
  if (session?.prompt && player.getEnteredAmountAction() === session.prompt) player.setEnteredAmountAction(null);
  SESSIONS.delete(player);
}

function select(player, buttonId, slot, itemId) {
  if (!Number.isInteger(slot) || slot < 0) return null;
  if (buttonId === CONTENTS_WIDGET && slot < POTION_TYPES) {
    const entry = Object.entries(contents(player)).find(([, store]) => store.slot === slot);
    if (!entry || displayed(entry[1]) !== itemId) return null;
    return { key: entry[0], dose: family(entry[1].itemId), store: entry[1] };
  }
  if (buttonId === INVENTORY_WIDGET && slot < 28) {
    const item = player.getInventory().getItems()[slot];
    if (!item || item.getId() !== itemId || item.getAmount() !== 1) return null;
    const dose = family(itemId);
    return { key: dose ? familyKey(dose) : null, dose, item };
  }
  return null;
}

// Plan every slot change before committing; full inventories never consume unreturned doses.
function transfer(player, selected, quantity, mode) {
  const inventory = player.getInventory();
  const items = inventory.getItems().slice();
  const stored = Object.fromEntries(Object.entries(contents(player)).map(([key, store]) => [key, { ...store }]));
  const { key, dose } = selected;
  if (!dose) {
    player.sendMessage(selected.item?.getId() === core.ItemIdentifiers.CHUGGING_BARREL ? "Don't be silly." : MESSAGE.CANNOT_STORE);
    return;
  }
  const name = `${dose.potion.name}(1)`;
  let store = stored[key];
  let moved = 0;
  if (mode === "withdraw") {
    if (!store) return;
    let left = Math.min(quantity, store.doses);
    const chain = dose.entry.chain;
    const max = chain.length;
    // Native withdrawal fills existing partial vials first (4239 ticks 41..54).
    for (let slot = 0; slot < items.length && left > 0; slot++) {
      const item = items[slot], partial = family(item.getId());
      if (!partial || partial.entry.chain !== dose.entry.chain || partial.doses >= max ||
          JSON.stringify(item.getMeta()) !== JSON.stringify(store.meta ?? null)) continue;
      const count = Math.min(left, max - partial.doses);
      items[slot] = new core.Item(chain[max - partial.doses - count], 1, store.meta);
      left -= count;
      moved += count;
    }
    for (let slot = 0; slot < items.length && left > 0; slot++) {
      if (items[slot].getId() > 0 && items[slot].getAmount() > 0) continue;
      const count = Math.min(left, max);
      items[slot] = new core.Item(chain[max - count], 1, store.meta);
      left -= count;
      moved += count;
    }
    if (!moved) {
      player.sendMessage(MESSAGE.NO_SPACE(name));
      return;
    }
    store.doses -= moved;
    if (!store.doses) delete stored[key];
    player.sendMessage(MESSAGE.WITHDRAWN(moved, name));
  } else {
    if (!store && Object.keys(stored).length >= POTION_TYPES) {
      player.sendMessage(MESSAGE.FULL(name));
      return;
    }
    const room = Math.max(0, DOSES_PER_POTION - (store?.doses ?? 0));
    if (!room) {
      player.sendMessage(MESSAGE.FULL(name));
      return;
    }
    let left = quantity;
    for (let slot = 0; slot < items.length && left > 0 && moved < room; slot++) {
      const item = items[slot], source = family(item.getId());
      if (!source || source.entry.chain !== dose.entry.chain || item.getAmount() !== 1 ||
          (mode === "store" && item.getId() !== selected.item.getId())) continue;
      // Different item markings cannot be merged into a single metadata-bearing balance.
      if (store && JSON.stringify(item.getMeta()) !== JSON.stringify(store.meta ?? null)) continue;
      const count = mode === "store" ? source.doses : Math.min(source.doses, left, room - moved);
      if (count > room - moved) continue;
      const remainder = source.doses - count;
      items[slot] = new core.Item(remainder ? source.entry.chain[source.entry.chain.length - remainder] : source.emptyItemId,
        remainder || source.emptyItemId > 0 ? 1 : 0, item.getMeta());
      store ??= { itemId: item.getId(), name: dose.potion.name.toLowerCase(), doses: 0, meta: item.getMeta(), slot: freeSlot(stored) };
      stored[key] = store;
      store.doses += count;
      moved += count;
      left -= mode === "store" ? 1 : count;
    }
    if (!moved) {
      player.sendMessage(room < dose.doses && mode === "store" ? MESSAGE.FULL(name) : MESSAGE.NO_STORAGE(name));
      return;
    }
    player.sendMessage(mode === "fill"
      ? `Your chugging barrel has been filled with ${moved} ${moved === 1 ? "dose" : "doses"} of ${name} from your bank.`
      : MESSAGE.FILLED(moved, name));
  }
  for (let slot = 0; slot < items.length; slot++) inventory.setItem(slot, items[slot]);
  inventory.refreshItems();
  save(player, stored);
}

function click(event) {
  const { player, buttonId, slot, itemId, action } = event;
  if (buttonId >>> 16 !== INTERFACE) return;
  event.handled = true;
  const session = SESSIONS.get(player);
  if (!current(player, session) || !Number.isInteger(action)) return;
  player.setEnteredAmountAction(null);
  const selected = select(player, buttonId, slot, itemId);
  if (!selected) return;
  if (action === 10) {
    // The contents show each potion as its 1-dose form, stacked by doses.
    examineItem(player, itemId, selected.store && Number(selected.key) === itemId ? selected.store.doses : 1);
    return;
  }
  if (action < 1 || action > 8) return;
  const mode = action >= 5 ? "fill" : buttonId === CONTENTS_WIDGET ? "withdraw" : "store";
  const quantities = mode === "withdraw"
    ? [selected.dose?.entry.chain.length, 1, Number.MAX_SAFE_INTEGER]
    : [1, 5, Number.MAX_SAFE_INTEGER];
  const run = (amount) => {
    if (!current(player, session) || !Number.isSafeInteger(amount) || amount <= 0) return;
    const next = select(player, buttonId, slot, itemId);
    // A replaced potion/slot must not redirect a pending amount to another balance.
    if (!next || next.key !== selected.key || (selected.item && next.item !== selected.item)) return;
    transfer(player, next, amount, mode);
  };
  if (action === 4 || action === 8) {
    const prompt = {
      execute(amount) {
        if (player.getEnteredAmountAction() !== prompt) return;
        player.setEnteredAmountAction(null);
        run(amount);
      },
    };
    session.prompt = prompt;
    player.setEnteredAmountAction(prompt);
    player.getPacketSender().sendEnterAmountPrompt(mode === "store" ? "Enter amount:" : "Enter amount of doses:");
  } else run(quantities[(action - 1) % 4]);
}

function drag(event) {
  const { player, packet } = event;
  if (packet.type !== "widget_drag" || packet.sourceWidgetId >>> 16 !== INTERFACE) return;
  event.handled = true;
  if (!current(player) || packet.sourceWidgetId !== packet.targetWidgetId) return;
  const widget = packet.sourceWidgetId, from = packet.sourceSlot, to = packet.targetSlot;
  const limit = widget === CONTENTS_WIDGET ? POTION_TYPES : widget === INVENTORY_WIDGET ? 28 : 0;
  if (![from, to].every((slot) => Number.isInteger(slot) && slot >= 0 && slot < limit) || from === to) return;
  player.setEnteredAmountAction(null);
  if (widget === CONTENTS_WIDGET) {
    const stored = contents(player);
    const a = Object.values(stored).find((store) => store.slot === from);
    const b = Object.values(stored).find((store) => store.slot === to);
    if (!a || packet.sourceItemId !== displayed(a) ||
        packet.targetItemId !== (b ? displayed(b) : core.ItemIdentifiers.VIAL)) return;
    a.slot = to;
    if (b) b.slot = from;
    save(player, stored);
  } else {
    const inventory = player.getInventory(), items = inventory.getItems();
    if (items[from].getId() !== packet.sourceItemId || items[to].getId() !== packet.targetItemId) return;
    const source = items[from], target = items[to];
    inventory.setItem(from, target).setItem(to, source);
    inventory.refreshItems();
  }
}

module.exports = {
  name: "ChuggingBarrel",
  description: "Chugging barrel: assemble and dismantle it, store five potions at 100 doses each, and drink one dose of every potion in one click.",
  members: true,
  dependsOn: ["Potions", "LeagueMode"],
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(CONTENTS_ATTRIBUTE, null);
    api.onItemAction(ASSEMBLED_NAME, { Drink: drink, Open: open, Dismantle: dismantle });
    api.onItemAction(DISASSEMBLED_NAME, { Assemble: assemble });
    api.onItemOnItem(useOnBarrel);
    api.onInterfaceActionClick(click);
    api.onCustomEvent("player:widget-action", drag);
    api.onPlayerLogout(logout);
    api.onCustomEvent("interface:close", logout);
  },
};
