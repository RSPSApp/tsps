"use strict";

const { randomUUID } = require("node:crypto");
const League = require("../league/Common.LeagueMode");
const Actors = require("./Actors.EchoBosses");
const orbs = require("../data/league-echo-orbs.json").orbs;
const ENCOUNTER_ATTRIBUTE = "echo-boss:encounter";
const sessions = new Map();
let api;

function eligible(player, boss) {
  const orb = orbs[boss];
  return !!orb && League.leagueOf(player) === 6 && player.isRegistered?.() !== false &&
    player.getHitpoints() > 0 && player.getInventory().contains(api.core.ItemIdentifiers[orb.item]);
}

/** Claim before starting any fade, spawn or temporary loadout transaction. */
function claim(event) {
  if (event.token || !eligible(event.player, event.boss) || sessions.has(event.player)) return;
  const token = randomUUID();
  // Live times an Echo from entry (Echo Hunllef's personal best is its whole Gauntlet run).
  sessions.set(event.player, { player: event.player, boss: event.boss, token, actors: new Set(), state: "active",
    startedAt: api.core.World.getProcessCycle() });
  event.token = token;
}

function matching(event) {
  const session = sessions.get(event.player);
  return session && session.token === event.token && session.boss === event.boss ? session : null;
}

function validate(event) {
  const session = matching(event);
  event.valid = !!session && session.state === "active" && eligible(event.player, event.boss);
}

/**
 * echo-boss:configure { player, boss, role, npc, token }: the owning controller has spawned a
 * normal boss for this session, or changed its form. It becomes the session's Echo actor:
 * dressed as the role's Echo form and marked, so normal kill credit, drops and orb rolls skip it.
 * `configured` answers whether it was accepted, and `maxHits` the Wiki's labelled per-attack
 * maxima ({ label, maxHit }) for a controller that caps by attack.
 */
function configure(event) {
  const session = matching(event);
  if (!session || session.state !== "active" || !event.npc) return;
  const fresh = !session.actors.has(event.npc);
  try {
    const dressed = Actors.dress(event.npc, session.boss, event.role, fresh);
    if (!dressed) return;
    event.maxHits = dressed.maxHits;
  } catch (error) {
    api.log(`Echo actor could not be dressed: ${session.boss} ${event.role}: ${error.message}`);
    return;
  }
  event.npc.setAttribute(ENCOUNTER_ATTRIBUTE, { token: session.token, player: session.player, boss: session.boss });
  session.actors.add(event.npc);
  event.configured = true;
}

function completed(event) {
  const session = matching(event);
  // Hunllef's temporary kit replaces the inventory containing the orb. Possession was
  // checked before escrow; completion must not require it to exist in the supplied kit.
  if (!session || session.state !== "active" || League.leagueOf(event.player) !== 6 ||
      event.player.isRegistered?.() === false || event.player.getHitpoints() <= 0 ||
      !Array.isArray(event.npcs) || !event.npcs.length ||
      event.npcs.some(npc => !session.actors.has(npc))) return;
  session.state = "committing";
  // The owning controller alone declares its final phase complete. Re-entrant callbacks
  // cannot roll again while delivery executes, nor after a committed reward.
  const result = require("./Loot.EchoBosses").complete(event);
  if (!result?.success) {
    session.state = "failed";
    api.log?.(`Echo reward delivery failed: ${session.boss} (${session.token})`);
    return;
  }
  session.state = "completed";
  api.emitCustomEvent("echo-boss:credited", { player: event.player, boss: event.boss, token: event.token, killCount: result.killCount,
    ticks: Math.max(0, api.core.World.getProcessCycle() - session.startedAt) });
}

/** Cancels both directions of queued combat when a session ceases to exist. */
function clearCombat(session) {
  for (const npc of session.actors) {
    api.core.HitQueue.dropHitsFrom(npc);
    npc.getCombat?.()?.reset?.();
    npc.getCombat?.()?.getHitQueue?.()?.clear?.();
  }
}

function release(event) {
  const session = sessions.get(event.player);
  if (!session || session.token !== event.token) return;
  clearCombat(session);
  sessions.delete(event.player);
}

function leave({ player }) {
  const session = sessions.get(player);
  if (session) release({ player, token: session.token });
}

function shutdown() {
  for (const session of [...sessions.values()]) release(session);
}

function attach(pluginApi) {
  api = pluginApi;
  api.onCustomEvent("echo-boss:claim", claim);
  api.onCustomEvent("echo-boss:validate", validate);
  api.onCustomEvent("echo-boss:configure", configure);
  api.onCustomEvent("echo-boss:completed", completed);
  api.onCustomEvent("echo-boss:release", release);
  api.onPlayerLogout(leave);
  api.onPlayerDisconnect(leave);
  api.onPlayerDeath(leave);
  api.onServerShutdown(shutdown);
}

module.exports = { attach, claim, validate, configure, completed, release, leave, shutdown, sessions, ENCOUNTER_ATTRIBUTE };
