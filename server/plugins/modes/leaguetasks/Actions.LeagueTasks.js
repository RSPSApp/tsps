/**
 * Awarding the tasks named by a deed rather than a kill or a level (docs/leagues.md, Tasks): each
 * kind listens to the events the skills and content already emit, so no task is named here.
 *
 * - `equip { items }`: any of the items worn, `equip-all { items }` every one of them at once, on
 *   `equipment:changed` (every worn-items refresh) and at login.
 * - `produce { items, count }`: that many of the items made or gathered, whatever the skill:
 *   `skills:produced` { itemId, amount } (cooking, crafting, fletching, herblore, smithing),
 *   `fishing:success` { itemId }, `woodcutting:success` { logId }, `mining:success` { itemId } and
 *   `runecrafting:success` { runeId, rolls, amountPerEssence }.
 * - `hunt { npcs, count }`: creatures caught, `hunter:success` { npcId }.
 * - `pickpocket { npcs, count }`: pockets picked, `thieving:success` { method: "pickpocket", target }.
 * - `clue { tier, count }`: reward caskets of the tier opened, `treasure-trails:casket-opened` { tier }.
 * - `agility-laps { courses, count }`: laps of any of the courses (the agility plugin's keys),
 *   `agility:lap` { course, count }; Yama's stepping stones count each stone as a lap.
 *
 * Counts toward a task are kept per task in `league:task-progress` (task id -> count) until it
 * completes; a deed no open task accepts is not kept.
 */
const Common = require("./Common.LeagueTasks");
const Complete = require("./Complete.LeagueTasks");

/** Progress toward open counted tasks: task id -> count. */
const PROGRESS_ATTRIBUTE = "league:task-progress";

/** League type -> { equip: tasks, produce, hunt, pickpocket, clue, laps: Map(lower-cased name -> tasks) }. */
const index = new Map();

const key = (name) => String(name ?? "").toLowerCase();

function add(map, name, task) {
  map.set(key(name), (map.get(key(name)) ?? []).concat(task));
}

function indexOf(type) {
  if (index.has(type)) return index.get(type);
  const entry = { equip: [], produce: new Map(), hunt: new Map(), pickpocket: new Map(), clue: new Map(), laps: new Map() };
  for (const task of Common.catalog(type).tasks) {
    const trigger = task.trigger;
    if (trigger?.kind === "equip" || trigger?.kind === "equip-all") entry.equip.push(task);
    else if (trigger?.kind === "produce") for (const item of trigger.items ?? []) add(entry.produce, item, task);
    else if (trigger?.kind === "hunt") for (const npc of trigger.npcs ?? []) add(entry.hunt, npc, task);
    else if (trigger?.kind === "pickpocket") for (const npc of trigger.npcs ?? []) add(entry.pickpocket, npc, task);
    else if (trigger?.kind === "clue") add(entry.clue, trigger.tier, task);
    else if (trigger?.kind === "agility-laps") for (const course of trigger.courses ?? []) add(entry.laps, course, task);
  }
  index.set(type, entry);
  return entry;
}

function progressOf(player) {
  const value = player.getAttribute(PROGRESS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** `amount` toward each open task of `kind` that accepts `name`; a task that reaches its count completes. */
function count(player, kind, name, amount = 1) {
  const type = Common.leagueOf(player);
  if (type === null || !(amount > 0)) return;
  const tasks = indexOf(type)[kind].get(key(name));
  if (!tasks) return;
  const done = new Set(Common.completedIds(player));
  const open = tasks.filter((task) => !done.has(task.id));
  if (!open.length) return;
  const progress = { ...progressOf(player) };
  const reached = [];
  for (const task of open) {
    const total = (Number(progress[task.id]) || 0) + amount;
    if (total >= (Number(task.trigger.count) || 1)) {
      delete progress[task.id];
      reached.push(task);
    } else progress[task.id] = total;
  }
  player.setAttribute(PROGRESS_ATTRIBUTE, progress);
  for (const task of reached) Complete.complete(player, task.id, type);
}

function itemName(id) {
  return Number.isInteger(id) && id >= 0 ? Common.core.CacheDefinitions.getItem(id)?.name ?? null : null;
}

function npcName(id) {
  return Number.isInteger(id) && id >= 0 ? Common.core.CacheDefinitions.getNpc(id)?.name ?? null : null;
}

function checkWorn(player) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const tasks = indexOf(type).equip;
  if (!tasks.length) return;
  const worn = new Set(player.getEquipment().getItems().filter((item) => item && item.getId() >= 0).map((item) => key(itemName(item.getId()))));
  for (const task of tasks) {
    const wears = (item) => worn.has(key(item));
    if (task.trigger.kind === "equip-all" ? task.trigger.items.every(wears) : task.trigger.items.some(wears)) Complete.complete(player, task.id, type);
  }
}

function equipmentChanged({ player }) {
  if (player) checkWorn(player);
}

function produced({ player, itemId, amount }) {
  if (player) count(player, "produce", itemName(itemId), Number(amount ?? 1));
}

function gathered({ player, itemId }) {
  if (player) count(player, "produce", itemName(itemId));
}

function chopped({ player, logId }) {
  if (player) count(player, "produce", itemName(logId));
}

function crafted({ player, runeId, rolls, amountPerEssence }) {
  if (player) count(player, "produce", itemName(runeId), (Number(rolls) || 1) * (Number(amountPerEssence) || 1));
}

function hunted({ player, npcId }) {
  if (player) count(player, "hunt", npcName(npcId));
}

function stole({ player, method, target }) {
  if (player && method === "pickpocket") count(player, "pickpocket", target);
}

function casket({ player, tier }) {
  if (player) count(player, "clue", tier);
}

function lapped({ player, course, count: laps }) {
  if (player) count(player, "laps", course, Number(laps ?? 1) || 1);
}

function login({ player, league }) {
  if (Common.catalog(league)) checkWorn(player);
}

module.exports = function attach(api) {
  api.persistAttribute(PROGRESS_ATTRIBUTE, {});
  api.onCustomEvent("equipment:changed", equipmentChanged);
  api.onCustomEvent("skills:produced", produced);
  api.onCustomEvent("fishing:success", gathered);
  api.onCustomEvent("woodcutting:success", chopped);
  api.onCustomEvent("mining:success", gathered);
  api.onCustomEvent("runecrafting:success", crafted);
  api.onCustomEvent("hunter:success", hunted);
  api.onCustomEvent("thieving:success", stole);
  api.onCustomEvent("treasure-trails:casket-opened", casket);
  api.onCustomEvent("agility:lap", lapped);
  api.onCustomEvent("league:login", login);
};

module.exports.PROGRESS_ATTRIBUTE = PROGRESS_ATTRIBUTE;
