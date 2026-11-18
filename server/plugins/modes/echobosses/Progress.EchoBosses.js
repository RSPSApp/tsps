"use strict";
/**
 * Validated Echo encounter credit, not individual NPC deaths. Group fights count once.
 * Native region counters come from cache gamevals; task awards use LeagueTasks' existing
 * idempotent API so its points, completion bits, Pact points and reset grants stay authoritative.
 */
const League = require("../league/Common.LeagueMode");
const PROGRESS_ATTRIBUTE = "echo-boss:progress";
const ENCOUNTER_ATTRIBUTE = "echo-boss:encounter";
const MAX_COUNT = 2147483647;
const REGIONS = {
  cerberus: "asgarnia", "kalphite-queen": "desert", "dagannoth-kings": "fremennik",
  "thermonuclear-smoke-devil": "kandarin", "grotesque-guardians": "morytania",
  "corrupted-hunllef": "tirannwn", "king-black-dragon": "wilderness", hespori: "kourend", amoxliatl: "varlamore",
};
const UNIQUE_TASKS = [[1,"defeat-1-unique-echo-boss"],[2,"defeat-2-unique-echo-bosses"],
  [3,"defeat-3-unique-echo-bosses"],[4,"defeat-4-unique-echo-bosses"]];
const TOTAL_TASKS = [[25,"defeat-25-echo-bosses"],[75,"defeat-75-echo-bosses"],[150,"defeat-150-echo-bosses"]];
/**
 * The kill-count message's name. Hunllef's and Thermy's are live's (rsprox.net 1158/1161); the
 * others follow the same "<boss> (Echo)" form (ours: not in the recordings examined).
 */
const NAMES = {
  cerberus: "Cerberus (Echo)", "kalphite-queen": "Kalphite Queen (Echo)", "dagannoth-kings": "Dagannoth Kings (Echo)",
  "thermonuclear-smoke-devil": "Thermonuclear Smoke Devil (Echo)", "grotesque-guardians": "Grotesque Guardians (Echo)",
  "corrupted-hunllef": "Corrupted Hunllef (Echo)", "king-black-dragon": "King Black Dragon (Echo)",
  hespori: "Hespori (Echo)", amoxliatl: "Amoxliatl (Echo)",
};
let api, nativeCounters;
function inLeague(player) { return League.leagueOf(player) === 6; }
const counts = value => !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.values(value).every(count => Number.isSafeInteger(count) && count >= 0 && count <= MAX_COUNT);
/** Saved per boss: Echo completions and the best time in ticks (from entry to completion). */
function progress(player) {
  const saved = player.getAttribute(PROGRESS_ATTRIBUTE);
  if (saved == null) return { version: 1, kills: {}, best: {} };
  if (saved.version !== 1 || !counts(saved.kills) || saved.best !== undefined && !counts(saved.best)) return null;
  return { ...saved, best: saved.best ?? {} };
}
/** M:SS.CC, as live's personal-best message writes a time in ticks. */
function formatTicks(ticks) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}
function totals(state) {
  const counts = Object.keys(REGIONS).map(boss => state.kills[boss] ?? 0);
  return { total: Math.min(MAX_COUNT, counts.reduce((sum,count)=>sum+count,0)), distinct: counts.filter(count=>count>0).length };
}
/** Each region's native kill-count and personal-best varbits (league_echo_killcount_/_pb_<region>). */
function resolveCounters() {
  const cache = api.core.CacheDefinitions;
  const varbit = name => {
    const id = cache.getVarbitId(name);
    if (!Number.isInteger(id)) throw new Error(`Echo boss progression: missing cache varbit ${name}`);
    const definition = cache.getVarbit(id), width = definition.endBit - definition.startBit + 1;
    return { id, maximum: Math.min(MAX_COUNT, 2 ** width - 1) };
  };
  nativeCounters = Object.entries(REGIONS).map(([boss,region]) =>
    ({ boss, kills: varbit(`league_echo_killcount_${region}`), best: varbit(`league_echo_pb_${region}`) }));
}
function publish(player, state) {
  if (!nativeCounters) resolveCounters();
  const sender = player.getPacketSender();
  for (const {boss,kills,best} of nativeCounters) {
    sender.sendVarbit(best.id,Math.min(best.maximum,state.best[boss]??0));
    sender.sendVarbit(kills.id,Math.min(kills.maximum,state.kills[boss]??0));
  }
  const count = totals(state);
  api.emitCustomEvent("league:echo-statistics", { player, ...count });
  return count;
}
function tasks(player, count) {
  for (const [threshold,id] of UNIQUE_TASKS) if (count.distinct >= threshold) api.emitCustomEvent("league:complete-task", {player,id});
  for (const [threshold,id] of TOTAL_TASKS) if (count.total >= threshold) api.emitCustomEvent("league:complete-task", {player,id});
}
/**
 * A committed completion: the kill-count message, the time, then the native counters, in live's
 * order (rsprox.net 1158/1161: the kill count, "You have set a new personal best" or else
 * "Duration", league_echo_pb_<region>, league_echo_killcount_<region>). Live writes the first
 * kill's count with no space after "is:" and every later one with a space.
 */
function credited({player,boss,token,killCount,ticks}) {
  if (!player || !inLeague(player) || !Object.hasOwn(REGIONS,boss) || typeof token !== "string" || !token ||
      !Number.isSafeInteger(killCount) || killCount < 1 || killCount > MAX_COUNT) return;
  const state = progress(player);
  if (!state || killCount <= (state.kills[boss]??0)) return;
  const time = Number.isSafeInteger(ticks) && ticks > 0 && ticks <= MAX_COUNT ? ticks : null;
  const previous = state.best[boss] ?? 0, beaten = time !== null && (previous === 0 || time < previous);
  const next = {version:1,kills:{...state.kills,[boss]:killCount},best:beaten?{...state.best,[boss]:time}:state.best};
  player.setAttribute(PROGRESS_ATTRIBUTE,next);
  player.sendMessage(`Your <col=a53fff>${NAMES[boss]}</col> kill count is:${killCount === 1 ? "" : " "}<col=ff3045>${killCount}</col>`);
  if (beaten) player.sendMessage(`You have set a new personal best: <col=ff3045>${formatTicks(time)}</col>`);
  else if (time !== null) player.sendMessage(`Duration: <col=ff3045>${formatTicks(time)}</col>`);
  const count=publish(player,next);tasks(player,count);
  api.emitCustomEvent("persistence:save", {player,reason:"echo-boss-progression"});
}
function login({player}) {
  if (!inLeague(player)) return;
  const state=progress(player);if(!state)return;
  const count=publish(player,state);tasks(player,count);
}
function answer(event) {
  if (!event.player || !inLeague(event.player)) return;
  const state=progress(event.player);if(state)Object.assign(event,totals(state),{kills:{...state.kills}});
}
function attach(pluginApi) {
  api=pluginApi;nativeCounters=null;
  api.persistAttribute(PROGRESS_ATTRIBUTE,{version:1,kills:{},best:{}});
  api.onCustomEvent("echo-boss:credited",credited);
  api.onCustomEvent("echo-boss:progress",answer);
  api.onCustomEvent("league:login",login);
}
module.exports={attach,credited,login,answer,progress,totals,formatTicks,PROGRESS_ATTRIBUTE,ENCOUNTER_ATTRIBUTE,REGIONS,NAMES};
