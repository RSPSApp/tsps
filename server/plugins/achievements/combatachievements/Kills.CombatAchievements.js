/**
 * Kill counts for Combat Achievements, and the kill-count tasks they finish ("Kill the King Black
 * Dragon 10 times.", "Open Obor's chest once."). The count's target comes from the task's own
 * description (Data.CombatAchievements.killCountTarget), so every plain kill-count task works without a rule.
 *
 * A kill counts for its monster when an NPC of that name dies with the player as killer. Content
 * that is not one NPC's death (a chest, a wave, a subdued boss, a raid) is counted by its plugin:
 *   api.emitCustomEvent("combat-achievements:kill", { player, monster: "Barrows", count? })
 * where `count` is the plugin's own count after this kill, when it keeps one; the request comes
 * back with `total`, the kill count Combat Achievements now holds (what the boss page shows), so
 * the plugin can tell the player one number. An `announce(total)` function in the request is
 * called with it before any task finishes, so the kill-count message comes first, as live sends
 * it. "combat-achievements:count" { player, monster } comes back with `total` and changes
 * nothing. At login, plugins
 * that keep a count answer
 *   "combat-achievements:kill-count" { player, counts }  -> counts["Zulrah"] = 41
 * so kills from before Combat Achievements still finish their tasks (as the Wiki says kill-count
 * tasks were completed retroactively). The boss pages show the count through the monster's
 * kill-count varp (data/bosses.json).
 *
 * Counts are saved by monster name: the cache's monster keys (enum 3970) are alphabetical and move
 * when a monster is added. Saves keyed by number are from before, and read through the keys of
 * the cache they were written on (data/legacy-monster-keys.json).
 */
const Data = require("./Data.CombatAchievements");
const Progress = require("./Progress.CombatAchievements");
const LEGACY_KEYS = require("./data/legacy-monster-keys.json").names;

const KILLS_ATTRIBUTE = "combat-achievements:kills";

let pluginApi;

function counts(player) {
  const all = {};
  for (const [key, value] of Object.entries(player.getAttribute(KILLS_ATTRIBUTE) ?? {})) {
    const name = /^\d+$/.test(key) ? LEGACY_KEYS[key] : key;
    if (name) all[name] = Math.max(Number(all[name]) || 0, Number(value) || 0);
  }
  return all;
}

function killCount(player, monster) {
  return Number(counts(player)[monster.name]) || 0;
}

function sendKillCount(player, monster) {
  // A monster whose page adds several varps (TzHaar-Ket-Rak's challenges) is left to its plugin.
  if (monster.killVarps.length !== 1) return;
  player.getPacketSender().sendConfig(monster.killVarps[0], killCount(player, monster));
}

/** Finishes the monster's kill-count tasks its count now reaches. */
function checkTasks(player, monster, { silent = false } = {}) {
  const count = killCount(player, monster);
  for (const task of monster.tasks) {
    if (task.killCount !== null && count >= task.killCount) Progress.complete(player, task, { silent });
  }
}

function setCount(player, monster, value) {
  const all = counts(player);
  all[monster.name] = Math.max(0, Math.floor(value));
  player.setAttribute(KILLS_ATTRIBUTE, all);
  sendKillCount(player, monster);
}

/**
 * One more kill (or `amount`), raised to the plugin's own `count` when it is ahead. `announce`
 * hears the new count before any kill-count task finishes.
 */
function addKill(player, monster, { amount = 1, count = null, announce = null } = {}) {
  if (!player || !monster) return;
  const next = Math.max(killCount(player, monster) + amount, Number.isFinite(count) ? count : 0);
  setCount(player, monster, next);
  if (typeof announce === "function") announce(next);
  checkTasks(player, monster);
}

function npcName(npc) {
  return npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? null;
}

function onNpcDeath(event) {
  if (event?.npc?.getMaxHitpoints?.() === 1) return;
  const player = event?.killer;
  if (!player?.isPlayer?.() && !player?.getPacketSender) return;
  const monster = Data.monsterForNpc(npcName(event.npc) ?? "");
  if (!monster || monster.byEvent) return;
  addKill(player, monster);
}

function onKill(request) {
  const monster = Data.monsterNamed(request?.monster ?? "");
  if (!request?.player || !monster) return;
  addKill(request.player, monster, {
    amount: Number(request.amount ?? 1),
    count: Number.isFinite(request.count) ? request.count : null,
    announce: request.announce ?? null,
  });
  request.total = killCount(request.player, monster);
}

/** "combat-achievements:count" { player, monster } -> total: the count, read only. */
function onCount(request) {
  const monster = Data.monsterNamed(request?.monster ?? "");
  if (!request?.player || !monster) return;
  request.total = killCount(request.player, monster);
}

/** At login: catch up with the counts plugins keep, send every count, finish what they reach. */
function restore(player) {
  const request = { player, counts: {} };
  pluginApi?.emitCustomEvent("combat-achievements:kill-count", request);
  const all = counts(player);
  for (const [name, value] of Object.entries(request.counts)) {
    const monster = Data.monsterNamed(name);
    if (monster && Number(value) > (Number(all[monster.name]) || 0)) all[monster.name] = Math.floor(Number(value));
  }
  player.setAttribute(KILLS_ATTRIBUTE, all);
  for (const monster of Data.monsters().values()) {
    if (killCount(player, monster) > 0) {
      sendKillCount(player, monster);
      checkTasks(player, monster, { silent: true });
    }
  }
}

function reset(player) {
  const all = counts(player);
  player.setAttribute(KILLS_ATTRIBUTE, {});
  for (const name of Object.keys(all)) {
    const monster = Data.monsterNamed(name);
    if (monster) sendKillCount(player, monster);
  }
}

module.exports = function attachKills(api) {
  pluginApi = api;
  api.persistAttribute(KILLS_ATTRIBUTE, {});
  api.onNpcDeath(onNpcDeath);
  api.onCustomEvent("combat-achievements:kill", onKill);
  api.onCustomEvent("combat-achievements:count", onCount);
};

Object.assign(module.exports, { KILLS_ATTRIBUTE, counts, killCount, setCount, addKill, checkTasks, onNpcDeath, onKill, onCount, restore, reset });
