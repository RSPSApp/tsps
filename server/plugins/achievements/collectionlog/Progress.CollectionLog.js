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
const Data = require("./Data.CollectionLog");
const SettingVarpTransmit = require("../../interface/SettingVarpTransmit");

const VARP = {
  COUNT: 2943,
  COUNT_MAX: 2944,
  HIGHSCORES: 4612,
  UNSYNCED: 4848,
  TAB_COUNT: [4613, 4615, 4617, 4619, 4621],
  TAB_MAX: [4614, 4616, 4618, 4620, 4622],
  RECENT_ITEM: 4623,
  CATEGORY_COUNTS: [2048, 2941, 2942],
};
const NOTIFY_VARBIT = 11959;
const NOTIFY_VARP = 2856;
const NOTIFY_DEFAULT = 3;
const NOTIFY_CHAT = 1;
const NOTIFY_POPUP = 2;
/** All Settings rows that toggle one bit of varbit 11959 (cache script 6716). */
const NOTIFY_SETTINGS = new Map([[85, 0], [171, 1]]);
const RECENT_SIZE = 12;
const EMPTY_RECENT = -1;
const COUNTS_DELAY = 5;
/** OSRS's day number: days since 27 February 2002 (8986 on 2026-10-05, as captured). */
const DAY_ZERO = Date.UTC(2002, 1, 27);

const ITEMS_ATTRIBUTE = "clog.items";
const COUNTS_ATTRIBUTE = "clog.counts";
const RECENT_ATTRIBUTE = "clog.recent";
const NOTIFY_ATTRIBUTE = "collection-log:notifications";

let pluginApi;
let core;

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
function categoryCounts(player, category) {
  const request = { player, category: category.name, struct: category.struct, count: null };
  pluginApi?.emitCustomEvent("collection-log:category-count", request);
  return [
    Number.isFinite(request.count) ? request.count : Number(counts(player)[category.struct]) || 0,
    ...[0, 1].map((index) => Number.isFinite(request.extraCounts?.[index]) ? request.extraCounts[index] : 0),
  ];
}

function categoryCount(player, category) {
  return categoryCounts(player, category)[0];
}

/** Cache script 2735 reads up to three mode counters; clear unused ones on every category. */
function sendCategoryCounts(player, category) {
  const values = categoryCounts(player, category);
  VARP.CATEGORY_COUNTS.forEach((varp, index) => player.getPacketSender().sendConfig(varp, values[index]));
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
  const stored = Number(player.getAttribute(NOTIFY_ATTRIBUTE));
  return Number.isInteger(stored) && stored >= 0 && stored <= 7 ? stored : NOTIFY_DEFAULT;
}

function setNotifySetting(player, value) {
  const setting = Number.isInteger(value) ? Math.max(0, Math.min(7, value)) : NOTIFY_DEFAULT;
  player.setAttribute(NOTIFY_ATTRIBUTE, setting);
  player.getPacketSender().sendVarbit(NOTIFY_VARBIT, setting);
  return setting;
}

function notifyVarpBits() {
  const { startBit, endBit } = core.CacheDefinitions.getVarbit(NOTIFY_VARBIT);
  return { startBit, mask: (1 << (endBit - startBit + 1)) - 1 };
}

/** All Settings rows 85 (chat) and 171 (popup) each own one bit of the shared varbit. */
function handleSettingClicked(request) {
  const bit = NOTIFY_SETTINGS.get(request.settingId);
  if (bit === undefined || !request.player) return;
  // The same click already changed the varbit locally and transmitted the whole shared varp.
  // That value is authoritative; toggling it again here would cancel the player's choice.
  const transmitted = SettingVarpTransmit.take(request.player, NOTIFY_VARP, core.World.getProcessCycle());
  if (transmitted !== undefined) {
    request.handled = true;
    return;
  }
  setNotifySetting(request.player, notifySetting(request.player) ^ (1 << bit));
  request.handled = true;
}

/** The client transmits the whole shared varp; keep the whole value and the notification bits. */
function handleVarpTransmit(transmission) {
  if (transmission.varpId !== NOTIFY_VARP || !transmission.player) return;
  SettingVarpTransmit.remember(transmission.player, NOTIFY_VARP, transmission.value, core.World.getProcessCycle());
  const { startBit, mask } = notifyVarpBits();
  transmission.player.setAttribute(NOTIFY_ATTRIBUTE, (transmission.value >> startBit) & mask);
  transmission.player.getPacketSender().sendConfig(NOTIFY_VARP, transmission.value);
  transmission.handled = true;
}

function later(ticks, action) {
  pluginApi.getTaskManager().submit(new (class extends core.Task {
    // Not keyed to the player: a click must not cancel it.
    constructor() { super(ticks); }
    execute() { this.stop(); action(); }
  })());
}

function itemName(itemId) {
  return String(Data.itemName(itemId) ?? "item");
}

function announce(player, itemId) {
  const setting = notifySetting(player);
  const name = itemName(itemId);
  if (setting & NOTIFY_CHAT) player.sendMessage(`New item added to your collection log: <col=ff0000>${name}</col>`);
  if (!(setting & NOTIFY_POPUP)) return;
  core.Sounds.sendSound(player, core.Sound.COLLECTION_LOG_NEW_ITEM);
  // The popup queues behind any other (plugins/interface/Notifications.plugin.js).
  pluginApi?.emitCustomEvent("notification:show", { player, title: "Collection Log", text: `New item:<br><br><col=ffffff>${name}</col>`, colour: -1 });
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
  // "collection-log:slot-filled" { player, itemId }: any slot filled, silent ones too (a league's "Fill 15 slots...").
  pluginApi.emitCustomEvent("collection-log:slot-filled", { player, itemId });
  const total = uniqueCount(player);
  player.getPacketSender().sendConfig(VARP.UNSYNCED, total);
  if (!silent) announce(player, itemId);
  // "collection-log:new-item" { player, itemId }: a newly earned item the player is told about (a clan broadcast).
  if (!silent && !ensure) pluginApi.emitCustomEvent("collection-log:new-item", { player, itemId });
  const list = recent(player);
  list.unshift([itemId, today()]);
  player.setAttribute(RECENT_ATTRIBUTE, list.slice(0, RECENT_SIZE));
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "collection-log-unlock" });
  later(COUNTS_DELAY, () => {
    if (player.isRegistered?.() === false) return;
    sendCounts(player);
    sendRecent(player);
  });
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

module.exports = function attachProgress(api) {
  pluginApi = api;
  core = api.core;
  api.persistAttribute(ITEMS_ATTRIBUTE, {});
  api.persistAttribute(COUNTS_ATTRIBUTE, {});
  api.persistAttribute(RECENT_ATTRIBUTE, []);
  api.persistAttribute(NOTIFY_ATTRIBUTE, NOTIFY_DEFAULT);
  api.onPlayerLogin(restore);
  api.onCustomEvent("settings:setting-clicked", handleSettingClicked);
  api.onCustomEvent("player:varp-transmit", handleVarpTransmit);
};

Object.assign(module.exports, {
  VARP, ITEMS_ATTRIBUTE, COUNTS_ATTRIBUTE, RECENT_ATTRIBUTE, NOTIFY_ATTRIBUTE,
  NOTIFY_VARBIT, NOTIFY_VARP,
  today, items, obtained, uniqueCount, categoryCount, sendCategoryCounts, addCategoryCount, setCategoryCount,
  obtain, restore, reset,
});
