"use strict";

const Data = require("./Data.BirthdayAnniversary");
const Progress = require("./Progress.BirthdayAnniversary");
const Actors = require("./Actors.BirthdayAnniversary");

let active = false;

function setActive(value) { active = value === true; }
function isActive() { return active; }

function send(api, player, symbol, value) {
  const id = api.core.CacheDefinitions.getVarbitId(symbol);
  if (id === null || id === undefined) throw new Error("Missing 25th Anniversary varbit " + symbol);
  player.getPacketSender().sendVarbit(id, value);
}
/** The native multinpc/multiloc parents read these per player; closed events show none of it. */
function refresh(api, { player }) {
  if (!player?.isRegistered?.()) return;
  const state = Progress.read(player), skills = Progress.collectedSkills(state);
  const waiting = active && Progress.rank(state.phase) <= Progress.rank("collecting") && !Actors.following(player);
  send(api, player, "25th_progress", active ? Progress.PROGRESS_VALUE[state.phase] : 0);
  send(api, player, "25th_host_outside", waiting ? 1 : 0);
  for (const skill of Data.SKILLS) send(api, player, "25th_tile_" + skill, active && skills.has(skill) ? 1 : 0);
  send(api, player, "25th_tile_runescape", active && Progress.rank(state.phase) >= Progress.rank("ritual") ? 1 : 0);
}
/** One player's unreadable save must not stop everyone else's refresh (or their login). */
function safeRefresh(api, event) {
  try { refresh(api, event); } catch (error) { console.error("[BirthdayAnniversaryEvents] varbit sync for " + event.player?.getUsername?.() + ": " + error.message); }
}
function all(api) {
  for (const player of api.core.World.getPlayers()) if (player?.isRegistered()) safeRefresh(api, { player });
}

module.exports = { setActive, isActive, refresh, safeRefresh, all };
