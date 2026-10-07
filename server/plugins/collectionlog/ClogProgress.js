/**
 * Collection log progress: what a player has obtained (and how many), each category's count and
 * the overview's recent items, kept in persisted attributes and shown through the varps the
 * cache's collection scripts read.
 *
 * As captured obtaining a new log item: on the tick, the unsynced count, the chat message, sound
 * 2304 and the "Collection Log" notification popup (closed by the server 13 ticks later); 5 ticks
 * on, the total, highscore and tab counts and the recent-items list. The message and the popup
 * follow the player's option_collection_new_item (varbit 11959: 1 chat, 2 popup).
 */
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const Data = require("./ClogData");

const VARP = {
  COUNT: 2943,
  COUNT_MAX: 2944,
  HIGHSCORES: 4612,
  UNSYNCED: 4848,
  TAB_COUNT: [4613, 4615, 4617, 4619, 4621],
  TAB_MAX: [4614, 4616, 4618, 4620, 4622],
  RECENT_ITEM: 4623,
  CATEGORY_COUNT: 2048,
};
const NOTIFY_VARBIT = 11959;
const NOTIFY_DEFAULT = 3;
const NOTIFY_CHAT = 1;
const NOTIFY_POPUP = 2;
const RECENT_SIZE = 12;
const EMPTY_RECENT = -1;
const COUNTS_DELAY = 5;
const POPUP_TICKS = 13;
const NOTIFICATIONS_UID = (161 << 16) | 13;
const NOTIFICATION_DISPLAY = 660;
const SCRIPT_NOTIFICATION_INIT = 3343;
/** OSRS's day number: days since 27 February 2002 (8986 on 2026-10-05, as captured). */
const DAY_ZERO = Date.UTC(2002, 1, 27);

const ITEMS_ATTRIBUTE = "clog.items";
const COUNTS_ATTRIBUTE = "clog.counts";
const RECENT_ATTRIBUTE = "clog.recent";

let TaskManager;
let pluginApi;

function bind(api) {
  pluginApi = api;
  TaskManager = api.getTaskManager();
}

function today(now = Date.now()) {
  return Math.floor((now - DAY_ZERO) / 86_400_000);
}

const items = (player) => ({ ...(player.getAttribute(ITEMS_ATTRIBUTE) ?? {}) });
const counts = (player) => ({ ...(player.getAttribute(COUNTS_ATTRIBUTE) ?? {}) });
const recent = (player) => [...(player.getAttribute(RECENT_ATTRIBUTE) ?? [])];
const obtained = (player, itemId) => Number(items(player)[itemId]) || 0;

function uniqueCount(player, inTab = null) {
  return Object.entries(items(player)).filter(([id, amount]) =>
    amount > 0 && (inTab ? inTab.items.has(Number(id)) : Data.isLogged(Number(id)))).length;
}

/** A category's count: a plugin that keeps one answers, otherwise the log's own tally. */
function categoryCount(player, category) {
  const request = { player, category: category.name, struct: category.struct, count: null };
  pluginApi?.emitCustomEvent("collection-log:category-count", request);
  return Number.isFinite(request.count) ? request.count : Number(counts(player)[category.struct]) || 0;
}

function addCategoryCount(player, category, amount = 1) {
  const all = counts(player);
  all[category.struct] = (Number(all[category.struct]) || 0) + amount;
  player.setAttribute(COUNTS_ATTRIBUTE, all);
}

function setCategoryCount(player, category, value) {
  const all = counts(player);
  all[category.struct] = value;
  player.setAttribute(COUNTS_ATTRIBUTE, all);
}

function sendCounts(player, { onlySet = false } = {}) {
  const sender = player.getPacketSender();
  const send = (varp, value) => { if (!onlySet || value !== 0) sender.sendConfig(varp, value); };
  const total = uniqueCount(player);
  send(VARP.COUNT, total);
  sender.sendConfig(VARP.COUNT_MAX, Data.load().itemTotal);
  send(VARP.HIGHSCORES, total);
  Data.tabs().forEach((tab, index) => {
    send(VARP.TAB_COUNT[index], uniqueCount(player, tab));
    sender.sendConfig(VARP.TAB_MAX[index], tab.items.size);
  });
}

/** The overview's latest items; an empty slot is -1 (script 7809 skips it; 0 would be Dwarf remains). */
function sendRecent(player) {
  const sender = player.getPacketSender();
  const list = recent(player);
  for (let index = 0; index < RECENT_SIZE; index++) {
    const [item, day] = list[index] ?? [EMPTY_RECENT, 0];
    sender.sendConfig(VARP.RECENT_ITEM + index * 2, item);
    sender.sendConfig(VARP.RECENT_ITEM + index * 2 + 1, day);
  }
}

/** On login, as captured. */
function restore({ player }) {
  sendCounts(player, { onlySet: true });
  sendRecent(player);
  const unsynced = uniqueCount(player);
  if (unsynced) player.getPacketSender().sendConfig(VARP.UNSYNCED, unsynced);
  player.getPacketSender().sendVarbit(NOTIFY_VARBIT, notifySetting(player));
}

function notifySetting(player) {
  const sent = player.getPacketSender().getVarbit?.(NOTIFY_VARBIT);
  return Number.isInteger(sent) && sent > 0 ? sent : NOTIFY_DEFAULT;
}

class LaterTask extends Task {
  constructor(ticks, action) {
    // Not keyed to the player: a click must not cancel it.
    super(ticks);
    this.action = action;
  }

  execute() {
    this.stop();
    this.action();
  }
}

function itemName(itemId) {
  return String(CacheDefinitions.getItem(itemId)?.name ?? "item");
}

function announce(player, itemId) {
  const setting = notifySetting(player);
  const name = itemName(itemId);
  const sender = player.getPacketSender();
  if (setting & NOTIFY_CHAT) player.sendMessage(`New item added to your collection log: <col=ff0000>${name}</col>`);
  if (!(setting & NOTIFY_POPUP)) return;
  Sounds.sendSound(player, Sound.COLLECTION_LOG_NEW_ITEM);
  sender.sendSubInterface(NOTIFICATIONS_UID, NOTIFICATION_DISPLAY, 1);
  sender.sendInterfaceScript(SCRIPT_NOTIFICATION_INIT, ["Collection Log", `New item:<br><br><col=ffffff>${name}</col>`, -1]);
  TaskManager.submit(new LaterTask(POPUP_TICKS, () => {
    if (player.isRegistered?.() !== false) sender.closeSubInterface(NOTIFICATIONS_UID);
  }));
}

/**
 * Records `amount` of an item. `ensure` only makes sure it is logged (pets re-synced on login);
 * `silent` skips the message and popup. True when the item was new to the log.
 */
function obtain(player, itemId, amount = 1, { ensure = false, silent = false } = {}) {
  if (!Data.isLogged(itemId) || !(amount > 0)) return false;
  const all = items(player);
  const before = Number(all[itemId]) || 0;
  if (ensure && before > 0) return false;
  all[itemId] = ensure ? Math.max(before, 1) : before + amount;
  player.setAttribute(ITEMS_ATTRIBUTE, all);
  if (before > 0) return false;
  const total = uniqueCount(player);
  player.getPacketSender().sendConfig(VARP.UNSYNCED, total);
  if (!silent) announce(player, itemId);
  const list = recent(player);
  list.unshift([itemId, today()]);
  player.setAttribute(RECENT_ATTRIBUTE, list.slice(0, RECENT_SIZE));
  TaskManager.submit(new LaterTask(COUNTS_DELAY, () => {
    if (player.isRegistered?.() === false) return;
    sendCounts(player);
    sendRecent(player);
  }));
  return true;
}

function reset(player) {
  player.setAttribute(ITEMS_ATTRIBUTE, {});
  player.setAttribute(COUNTS_ATTRIBUTE, {});
  player.setAttribute(RECENT_ATTRIBUTE, []);
  player.getPacketSender().sendConfig(VARP.UNSYNCED, 0);
  sendCounts(player);
  sendRecent(player);
}

module.exports = {
  VARP, ITEMS_ATTRIBUTE, COUNTS_ATTRIBUTE, RECENT_ATTRIBUTE, NOTIFICATIONS_UID,
  bind, today, items, obtained, uniqueCount, categoryCount, addCategoryCount, setCategoryCount,
  obtain, restore, reset,
};
