/**
 * Nightmare Zone: what the units share - the plugin api, plugins/minigames/data/nightmare-zone.json,
 * cache ids by name, the saved figures (points, coffer, dreams), tick timing, quests and the
 * dialogue pages.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let core = null;
let data = null;

const POINTS_ATTRIBUTE = "nightmare-zone:points";
const COFFER_ATTRIBUTE = "nightmare-zone:coffer";
const DREAM_ATTRIBUTE = "nightmare-zone:dream";
const PREVIOUS_ATTRIBUTE = "nightmare-zone:previous-dream";
const UNLOCKED_ATTRIBUTE = "nightmare-zone:coffer-unlocked";
const HOST = "nzone_host";
const LIST_MENU_SCRIPT = 217;
const PAUSE_BUTTON = 1;

/** Each dreamer's dream (Dream.NightmareZone makes and ends them; the other units read them). */
const dreams = new Map();
const dreamOf = (player) => dreams.get(player) ?? null;

/** The list menu's pending pick per player (the boss list). */
const listMenus = new WeakMap();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "nightmare-zone.json"), "utf8"));
}

const varbitId = (name) => core.CacheDefinitions.getVarbitId(name);
const component = (name) => core.CacheDefinitions.getComponentId(name);

function varbit(player, name, value) {
  const id = varbitId(name);
  if (id != null) player.getPacketSender().sendVarbit(id, value);
}

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function every(action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })());
}

function message(name, values = {}) {
  return String(data.messages[name]).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
}

const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);
const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const commas = (value) => Number(value).toLocaleString("en-GB");

function inBox(location, [x0, y0, x1, y1]) {
  const x = location.getX();
  const y = location.getY();
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// ---------------------------------------------------------------- saved figures

function points(player) {
  return Number(player.getAttribute(POINTS_ATTRIBUTE)) || 0;
}

/** Reward points: the attribute is the truth, varp nzone_rewardpoints shows it. */
function addPoints(player, amount) {
  const total = Math.min(data.pointsCap, points(player) + amount);
  player.setAttribute(POINTS_ATTRIBUTE, total);
  const id = core.CacheDefinitions.getVarpId(data.pointsVarp);
  if (id != null) player.getPacketSender().sendConfig(id, total);
  return total;
}

/** The coffer, in coins (varbit nzone_cash holds thousands, as recorded). */
function coffer(player) {
  return (Number(player.getAttribute(COFFER_ATTRIBUTE)) || 0) * data.coffer.unit;
}

function setCoffer(player, coins) {
  const thousands = Math.floor(coins / data.coffer.unit);
  player.setAttribute(COFFER_ATTRIBUTE, thousands);
  varbit(player, "nzone_cash", thousands);
}

/** The dream Dominic has prepared: { mode, difficulty, boss? }, or null. */
function preparedDream(player) {
  const value = player.getAttribute(DREAM_ATTRIBUTE);
  return value ? JSON.parse(value) : null;
}

/** The vial shows a potion for any code 1-127 (the multiloc on nzone_purchaseddream). */
function dreamCode(dream) {
  if (!dream) return 0;
  return data.codes[`${dream.mode}:${dream.difficulty}`] ?? 1;
}

function setPreparedDream(player, dream) {
  player.setAttribute(DREAM_ATTRIBUTE, dream ? JSON.stringify(dream) : "");
  varbit(player, "nzone_purchaseddream", dreamCode(dream));
}

function previousDream(player) {
  const value = player.getAttribute(PREVIOUS_ATTRIBUTE);
  return value ? JSON.parse(value) : null;
}

function setPreviousDream(player, dream) {
  player.setAttribute(PREVIOUS_ATTRIBUTE, JSON.stringify(dream));
  varbit(player, "nzone_previousdream", dreamCode(dream));
}

// ---------------------------------------------------------------- bosses and quests

function questComplete(player, key) {
  const request = { player, key };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** The bosses a player has unlocked, by their place in the list. */
function unlockedBosses(player) {
  return data.bosses.map((boss, index) => (questComplete(player, boss.quest) ? index : -1)).filter((index) => index >= 0);
}

/** A boss's forms, as npc ids for the difficulty (the cache's nzone_<form>_<difficulty>). */
function bossForms(index, difficulty) {
  return data.bosses[index].forms.map((form) => core.CacheDefinitions.getNpcId(`nzone_${form}_${difficulty}`)).filter((id) => id != null);
}

function bossName(index) {
  return data.bosses[index].label.split(": ").pop();
}

// ---------------------------------------------------------------- dialogue

function hostId() {
  return core.CacheDefinitions.getNpcId(HOST);
}

/**
 * Recorded pages, then `menu` ([title, [[text, action], ...]]) or `done`. Pages are [speaker,
 * text, chathead animation]; "box" is a messagebox, ["item", text, itemId] the objectbox. `at[i]`
 * runs as page i shows.
 */
function talk(player, pages, { at = {}, done, menu } = {}) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, StatementDialogue, ItemStatementDialogue, ActionDialogue, OptionDialogue } = core;
  const manager = player.getDialogueManager();
  const chain = new DialogueChainBuilder();
  let index = 0;
  pages.forEach(([speaker, text, anim], page) => {
    if (at[page]) {
      const next = index + 1;
      const hook = at[page];
      chain.add(new ActionDialogue(index++, { execute: () => { hook(); manager.startDialogue(next); } }));
    }
    if (speaker === "player") chain.add(new PlayerDialogue(index++, text, anim));
    else if (speaker === "box") chain.add(new StatementDialogue(index++, text));
    else if (speaker === "item") chain.add(new ItemStatementDialogue(index++, anim, text));
    else chain.add(new NpcDialogue(index++, hostId(), text, "Dominic Onion", anim));
  });
  if (menu) {
    const [title, options] = menu;
    const option = new OptionDialogue(index++, {
      executeOption(choice) {
        player.getPacketSender().sendInterfaceRemoval();
        manager.reset();
        options[Number(choice) - 1]?.[1](); // options are one-based
      },
    }, ...options.map(([text]) => text));
    option.setTitle?.(title);
    chain.add(option);
  } else {
    chain.add(new ActionDialogue(index++, {
      execute: () => {
        manager.reset();
        player.getPacketSender().sendInterfaceRemoval();
        done?.();
      },
    }));
  }
  manager.startDialogues(chain);
}

/** A menu alone, with no page before it. */
function choose(player, title, options) {
  talk(player, [], { menu: [title, options] });
}

/** The cache's list menu (interface "menu", script 217), as recorded for the Practice bosses. */
function listMenu(player, title, labels, picked) {
  const sender = player.getPacketSender();
  const menu = core.CacheDefinitions.getInterfaceId("menu");
  sender.sendInterfaceRemoval();
  sender.sendInterface(menu);
  sender.sendClientScript(LIST_MENU_SCRIPT, 0, title, labels.join("|"));
  sender.sendInterfaceFlagsRange((menu << 16) | 3, 0, labels.length - 1, PAUSE_BUTTON);
  listMenus.set(player, { count: labels.length, picked });
}

function listPicked(event) {
  const menu = core.CacheDefinitions.getInterfaceId("menu");
  if (event.groupId !== menu || event.childId !== 3) return;
  const pending = listMenus.get(event.player);
  if (!pending) return;
  event.handled = true;
  listMenus.delete(event.player);
  const index = event.slot ?? event.action;
  event.player.getPacketSender().sendInterfaceRemoval();
  if (Number.isInteger(index) && index >= 0 && index < pending.count) pending.picked(index);
}

function forgetList({ player }) {
  listMenus.delete(player);
}

module.exports = {
  init,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  get data() {
    return data;
  },
  dreams,
  dreamOf,
  POINTS_ATTRIBUTE,
  COFFER_ATTRIBUTE,
  DREAM_ATTRIBUTE,
  PREVIOUS_ATTRIBUTE,
  UNLOCKED_ATTRIBUTE,
  varbit,
  component,
  later,
  every,
  message,
  fill,
  toLocation,
  randomInt,
  commas,
  inBox,
  points,
  addPoints,
  coffer,
  setCoffer,
  preparedDream,
  setPreparedDream,
  previousDream,
  setPreviousDream,
  dreamCode,
  questComplete,
  unlockedBosses,
  bossForms,
  bossName,
  talk,
  choose,
  listMenu,
  listPicked,
  forgetList,
};
