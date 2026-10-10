"use strict";

/**
 * The Mess, Hosidius: shared ids, session state and the appreciation model.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Mess
 *
 * The Wiki only says that serving a dish lowers its appreciation bar and raises the other
 * two, and that the bars recover over time; it does not publish the numbers. The values in
 * APPRECIATION are a parity approximation: a bar is tenths of a percent (30.0 - 100.0%),
 * serving a dish costs it 15.0% and gives the other two 5.0% each, and every 30 ticks all
 * three recover 1.0%. The client's own HUD (interface 235) reads inventory 173's counts for
 * the three dish items, so the bars are driven entirely by sendInventory.
 */

const state = { api: null, core: null };

function init(api) {
  state.api = api;
  state.core = api.core;
}

function api() {
  return state.api;
}

function core() {
  return state.core;
}

/** The Mess's cache objects (yarn dump:loc 27375,27376,27377,27378,9684,21302). */
const OBJECT = Object.freeze({
  FOOD_CUPBOARD: 27375,
  UTENSIL_CUPBOARD: 27376,
  MEAT_TABLE: 27377,
  BUFFET_TABLE: 27378,
  SINK: 9684,
  CLAY_OVEN: 21302,
});

/**
 * The servery's cache items. 13415/13416 are both "Servery incomplete stew": 13415 is the
 * potato-and-water one (needs meat next), 13416 the meat-and-water one (needs potato next).
 */
const ITEM = Object.freeze({
  FLOUR: 13397,
  PASTRY_DOUGH: 13398,
  RAW_MEAT: 13399,
  DISH: 13400,
  PIE_SHELL: 13401,
  UNCOOKED_PIE: 13402,
  MEAT_PIE: 13403,
  PIZZA_BASE: 13404,
  TOMATO: 13405,
  INCOMPLETE_PIZZA: 13406,
  CHEESE: 13407,
  UNCOOKED_PIZZA: 13408,
  PLAIN_PIZZA: 13409,
  PINEAPPLE: 13410,
  PINEAPPLE_CHUNKS: 13411,
  PINEAPPLE_PIZZA: 13412,
  COOKED_MEAT: 13413,
  POTATO: 13414,
  STEW_POTATO: 13415,
  STEW_MEAT: 13416,
  UNCOOKED_STEW: 13417,
  STEW: 13418,
  BOWL: 1923,
  BOWL_OF_WATER: 1921,
  KNIFE: 946,
  BURNT_MEAT: 2146,
  BURNT_PIE: 2329,
  BURNT_STEW: 2005,
  BURNT_PIZZA: 2305,
});

/** Only the 13397-13418 items are the Mess's; everything else can stay in the inventory. */
const SERVERY_ITEM_IDS = new Set(
  Object.values(ITEM).filter((id) => id >= ITEM.FLOUR && id <= ITEM.STEW)
);

/** The three dishes the soldiers eat; base XP is the Wiki's "about" per serve at 100%. */
const DISH = Object.freeze({
  MEAT_PIE: { key: "pie", id: ITEM.MEAT_PIE, baseXp: 160, name: "servery meat pie" },
  PINEAPPLE_PIZZA: { key: "pizza", id: ITEM.PINEAPPLE_PIZZA, baseXp: 369, name: "servery pineapple pizza" },
  STEW: { key: "stew", id: ITEM.STEW, baseXp: 168, name: "servery stew" },
});
const DISH_BY_ITEM = new Map(Object.values(DISH).map((dish) => [dish.id, dish]));
const DISH_BY_KEY = new Map(Object.values(DISH).map((dish) => [dish.key, dish]));
const DISH_KEYS = Object.values(DISH).map((dish) => dish.key);

/** HUD: interface 235 (HOSIDIUS_SERVERY_HUD) in the toplevel's overlay_hud. */
const HUD = Object.freeze({
  INTERFACE: 235,
  /** The cs2 bars read inv_total(173, dish item); counts are appreciation in tenths. */
  INVENTORY: 173,
  OVERLAY_UID: (161 << 16) | 8,
});

/** The mess hall on plane 0 (the Wiki map polygon, plus its doorstep). */
const MESS_ZONE = { minX: 1633, maxX: 1649, minY: 3617, maxY: 3637, levels: [0] };

/** Parity approximation, see the file comment. Tenths of a percent. */
const APPRECIATION = Object.freeze({
  START: 1000,
  MIN: 300,
  MAX: 1000,
  SERVE_LOSS: 150,
  OTHERS_GAIN: 50,
  DECAY_TICKS: 30,
  DECAY_GAIN: 10,
});

/** player -> { appreciation: { pie, pizza, stew } }, alive only while they are in the Mess. */
const sessions = new Map();

let decayTask = null;

function sessionOf(player, create = true) {
  let session = sessions.get(player);
  if (!session && create) {
    session = { appreciation: {} };
    for (const key of DISH_KEYS) session.appreciation[key] = APPRECIATION.START;
    sessions.set(player, session);
  }
  return session ?? null;
}

function level(player) {
  return player.getSkillManager().getCurrentLevel(core().Skill.COOKING);
}

/** Serve XP: the dish's base at 100% appreciation, scaled by the bar. */
function xpFor(dish, appreciation) {
  return (dish.baseXp * appreciation) / APPRECIATION.MAX;
}

/** One serve: the dish's bar drops, the other two rise. */
function applyServe(session, dish) {
  for (const key of DISH_KEYS) {
    const step = key === dish.key ? -APPRECIATION.SERVE_LOSS : APPRECIATION.OTHERS_GAIN;
    session.appreciation[key] = Math.max(
      APPRECIATION.MIN,
      Math.min(APPRECIATION.MAX, session.appreciation[key] + step)
    );
  }
}

/** Push all three bars to the HUD as the three dish items' counts. */
function syncHud(player, session = sessionOf(player)) {
  if (!session) return;
  const items = DISH_KEYS.map((key) => ({ id: DISH_BY_KEY.get(key).id, amount: session.appreciation[key] }));
  player.getPacketSender().sendInventory(HUD.INVENTORY, items.length, items);
}

function openHud(player, session = sessionOf(player)) {
  player.getPacketSender().sendSubInterface(HUD.OVERLAY_UID, HUD.INTERFACE, 1);
  syncHud(player, session);
}

function closeHud(player) {
  player.getPacketSender().closeSubInterface(HUD.OVERLAY_UID);
}

/**
 * Logging out, or leaving the Mess: no servery item survives and the bars reset next visit
 * (the Wiki is silent on both; the Ewesey transcript only blocks taking ingredients out of
 * the kitchen while unqualified).
 */
function cleanUp(player) {
  sessions.delete(player);
  const inventory = player.getInventory();
  for (const id of SERVERY_ITEM_IDS) {
    const amount = inventory.getAmount(id);
    if (amount > 0) inventory.deleteNumber(id, amount);
  }
  closeHud(player);
}

/** Session-only cleanup for a dropped connection: the client is gone, so no packets. */
function forget(player) {
  sessions.delete(player);
}

/** Every DECAY_TICKS all three bars recover a little, served or not. */
function decayTick() {
  for (const [player, session] of sessions) {
    if (typeof player.isRegistered === "function" && !player.isRegistered()) {
      sessions.delete(player);
      continue;
    }
    for (const key of DISH_KEYS) {
      session.appreciation[key] = Math.min(APPRECIATION.MAX, session.appreciation[key] + APPRECIATION.DECAY_GAIN);
    }
    syncHud(player, session);
  }
}

/** A repeating task, as GauntletShared.repeat does it. */
function startDecay() {
  const { Task, TaskManager } = core();
  decayTask = new (class extends Task {
    constructor() {
      super(APPRECIATION.DECAY_TICKS);
    }
    execute() {
      decayTick();
    }
  })();
  TaskManager.submit(decayTask);
}

function stopDecay() {
  decayTask?.stop();
  decayTask = null;
}

module.exports = {
  init,
  api,
  core,
  OBJECT,
  ITEM,
  SERVERY_ITEM_IDS,
  DISH,
  DISH_BY_ITEM,
  DISH_BY_KEY,
  DISH_KEYS,
  HUD,
  MESS_ZONE,
  APPRECIATION,
  sessions,
  sessionOf,
  level,
  xpFor,
  applyServe,
  syncHud,
  openHud,
  closeHud,
  cleanUp,
  forget,
  decayTick,
  startDecay,
  stopDecay,
};
