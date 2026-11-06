"use strict";

const Data = require("./Data.BirthdayAnniversary");

const PROGRESS_ATTRIBUTE = "birthday-2026:progress";
const COMPLETE_ATTRIBUTE = "birthday-2026:complete";
const REWARDED_ATTRIBUTE = "birthday-2026:rewarded";
const PHASES = Object.freeze(["new", "agreed", "briefed", "collecting", "returned", "ritual", "portal", "realm", "rewarding", "complete"]);
// 25th_progress values. The rev236 cache fixes what each range shows: BigRedJapan only
// offers Talk-to from 5 to 9 (collecting), 10-24 Gary waits by the grid, 21-30 the portal
// stands, 25-26 Grayzag and Gary are in the Realm, 27-30 Gary is a wizard. Values inside a
// range are this server's phase order; no capture records them.
const PROGRESS_VALUE = Object.freeze({
  new: 0, agreed: 1, briefed: 2, collecting: 5, returned: 10, ritual: 20, portal: 21, realm: 25, rewarding: 27, complete: 30,
});

function initial() { return { version: 1, revision: 0, phase: "new", met: false, collected: [] }; }
function read(player) {
  const raw = player.getAttribute(PROGRESS_ATTRIBUTE);
  if (raw === undefined || raw === null) return initial();
  if (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !PHASES.includes(raw.phase) ||
    typeof raw.met !== "boolean" || !Array.isArray(raw.collected) || raw.collected.some(key => !Data.STOPS.some(stop => stop.key === key))) {
    throw new Error("Invalid 25th Anniversary progress");
  }
  return { ...raw, collected: [...raw.collected] };
}
function save(api, player, state) {
  state.revision++;
  player.setAttribute(PROGRESS_ATTRIBUTE, state);
  api.emitCustomEvent("birthday-2026:changed", { player });
  return true;
}
function rank(phase) { return PHASES.indexOf(phase); }
function collectedSkills(state) {
  return new Set(Data.STOPS.filter(stop => state.collected.includes(stop.key)).flatMap(stop => stop.skills));
}
function nextStop(state) { return Data.STOPS.find(stop => !state.collected.includes(stop.key)) ?? null; }
function allCollected(state) { return Data.STOPS.every(stop => state.collected.includes(stop.key)); }
function complete(player) { return player.getAttribute(COMPLETE_ATTRIBUTE) === true; }
function rewarded(player) { return player.getAttribute(REWARDED_ATTRIBUTE) === true; }

/** Advance only from the expected phase: a stale or replayed dialogue step changes nothing. */
function advance(api, player, from, to) {
  const state = read(player);
  if (!(Array.isArray(from) ? from : [from]).includes(state.phase)) return false;
  state.phase = to;
  return save(api, player, state);
}
function meet(api, player) {
  const state = read(player);
  if (state.met) return true;
  state.met = true;
  return save(api, player, state);
}
function collect(api, player, key) {
  const state = read(player);
  if (state.phase !== "collecting" || state.collected.includes(key)) return false;
  state.collected.push(key);
  return save(api, player, state);
}
function markComplete(api, player) {
  if (complete(player)) return;
  player.setAttribute(COMPLETE_ATTRIBUTE, true);
  api.emitCustomEvent("birthday-2026:changed", { player });
}
function markRewarded(player) { player.setAttribute(REWARDED_ATTRIBUTE, true); }

module.exports = {
  PROGRESS_ATTRIBUTE, COMPLETE_ATTRIBUTE, REWARDED_ATTRIBUTE, PHASES, PROGRESS_VALUE,
  initial, read, rank, collectedSkills, nextStop, allCollected, complete, rewarded,
  advance, meet, collect, markComplete, markRewarded,
};
