/**
 * The Royal Titans' Combat Achievements that the fight decides (docs/royal-titans.md).
 * Kill-count tasks (Champion 10, Adept 25) finish themselves in the CA system off the kill
 * reports; everything else is decided here. Task names are the Wiki's (cache enums confirm).
 *
 * Per-fight state: avoidable damage by category (melee unprayed, rows, blast pulses,
 * minion explosions), damage dealt to each titan (One by one), minions attacked (Elemental
 * Company), rows spawned vs spell-cleared (I need room), elementals felled by titan damage
 * (Let them fight), blast charge windows (It takes too long), prayer points (No time to
 * pray). Titan Killer streaks count kills in one instance: joining resets to 0, anyone
 * leaving fails the stayers too (Wiki).
 */
const Shared = require("./Shared.RoyalTitans");

const SPEED_RUNNER_TICKS = 150;
const TITAN_KILLER_KILLS = 15;
const LET_THEM_FIGHT_KILLS = 10;
const MONSTER = "Royal Titans";

/** player -> { fight, } while they are in an instance. */
const states = new WeakMap();
let api = null;
let core = null;

const tick = () => core.World.getProcessCycle();
const complete = (player, task) => api.emitCustomEvent("combat-achievements:complete", { player, task });

function stateOf(player) {
  if (!states.has(player)) {
    states.set(player, {
      fight: null,
      prayerStart: 0,
    });
  }
  return states.get(player);
}

function fightOf(player) {
  return states.get(player)?.fight ?? null;
}

function prayerPoints(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.PRAYER);
}

/** A fight starts for this player (called for every party member on spawn). */
function spawned(player, session) {
  stateOf(player).fight = {
    session,
    spawnedAt: tick(),
    damageToBranda: 0,
    damageToEldric: 0,
    attacked: new Set(),
    oneByOneFailed: false,
    minionsAttacked: false,
    rowsSpawned: 0,
    rowsCleared: 0,
    rowsExpired: false,
    titanMinionKills: 0,
    charges: [],
    openCharge: null,
    avoidable: 0,
    prayerStart: prayerPoints(player),
    prayed: false,
  };
}

/** Each tick in the instance: prayer points must never drop (No time to pray). */
function tickPlayer(player) {
  const fight = fightOf(player);
  if (!fight) return;
  if (prayerPoints(player) < fight.prayerStart) fight.prayed = true;
}

/** Damage the Perfect task forbids, by category (called with already-filtered damage). */
function avoidableDamage(player, amount, kind) {
  const fight = player ? fightOf(player) : null;
  if (!fight || !(amount > 0)) return;
  if (kind === "melee" || kind === "row" || kind === "blast" || kind === "explode") {
    fight.avoidable += amount;
  }
}

/**
 * Player-attributed hits on a titan. One by one (Wiki: "Kill one Titan at a time, without
 * attacking the other"): attacking a titan while the other, which this player has already
 * attacked, is still fighting fails it; once that one is dead the other is fair game.
 */
function hitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer() || !target?.isNpc() || !Shared.isLiveTitan(target.getId())) return;
  const fight = fightOf(attacker.getAsPlayer());
  if (!fight) return;
  const brandaHit = target.getId() === Shared.BRANDA_ID;
  const damage = hit.getTotalDamage();
  if (damage > 0) {
    if (brandaHit) fight.damageToBranda += damage;
    else fight.damageToEldric += damage;
  }
  const session = Shared.sessionOfNpc(target);
  const other = brandaHit ? "eldric" : "branda";
  if (fight.attacked.has(other) && Shared.fighting(session?.[other])) fight.oneByOneFailed = true;
  fight.attacked.add(brandaHit ? "branda" : "eldric");
}

/** A titan's wall or blast hit an elemental: a lethal one is a Let them fight kill for the party. */
function minionHitByTitan(session, minion, damage) {
  if (damage < minion.getHitpoints()) return;
  for (const member of session.players) {
    const fight = fightOf(member);
    if (fight) fight.titanMinionKills += 1;
  }
}

/** Any resolved player -> elemental hit marks Elemental Company as failed. */
function minionAttacked(player) {
  const fight = player ? fightOf(player) : null;
  if (fight) fight.minionsAttacked = true;
}

/** Row lifecycle for I need room: every tile spell-cleared before natural despawn. */
function rowSpawned(session) {
  for (const player of session.players) {
    const fight = fightOf(player);
    if (fight) fight.rowsSpawned += 1;
  }
}

function rowCleared(session) {
  for (const player of session.players) {
    const fight = fightOf(player);
    if (fight) fight.rowsCleared += 1;
  }
}

function rowExpired(session) {
  for (const player of session.players) {
    const fight = fightOf(player);
    if (fight) fight.rowsExpired = true;
  }
}

/** Blast charge windows for It takes too long (both die inside one charge phase). */
function blastCharged(session, id) {
  const at = tick();
  for (const player of session.players) {
    const fight = fightOf(player);
    if (fight) fight.openCharge = { id, at };
  }
}

function blastResolved(session, id) {
  for (const player of session.players) {
    const fight = fightOf(player);
    if (fight && fight.openCharge?.id === id) {
      fight.charges.push(fight.openCharge);
      fight.openCharge = null;
    }
  }
}

/** A partner joined mid-fight: their streak resets to 0 (Wiki). */
function joined(player) {
  player.setAttribute(Shared.STREAK_ATTRIBUTE, 0);
  player.setAttribute(Shared.STREAK_FAILED_ATTRIBUTE, null);
  spawned(player, null);
}

/** Someone left (or died): leaver fails, stayers lose their streaks (Wiki). */
function left(player, session) {
  states.delete(player);
  player.setAttribute(Shared.STREAK_FAILED_ATTRIBUTE, true);
  for (const member of session.players) {
    if (member === player) continue;
    member.setAttribute(Shared.STREAK_ATTRIBUTE, 0);
    const fight = fightOf(member);
    if (fight) {
      fight.rowsSpawned = 0;
      fight.rowsCleared = 0;
      fight.rowsExpired = false;
    }
  }
}

function died(player) {
  states.delete(player);
  player.setAttribute(Shared.STREAK_FAILED_ATTRIBUTE, true);
}

/**
 * Both titans down: the kill goes to Combat Achievements, `announce(kills)` tells the
 * player (with CA's total) before any task message, as live orders them, and then the
 * tasks the fight earned are finished. Speed-Runner times spawn-to-second-death (<150).
 */
function killed(player, session, ownKills, announce) {
  let announced = false;
  const request = {
    player,
    monster: MONSTER,
    count: ownKills,
    announce: (kills) => {
      announced = true;
      announce?.(kills);
    },
  };
  api.emitCustomEvent("combat-achievements:kill", request);
  const total = Number.isInteger(request.total) ? request.total : null;
  if (!announced) announce?.(ownKills);

  const state = stateOf(player);
  const fight = state.fight;
  state.fight = null;
  if (!fight) return total;
  const now = tick();
  const duration = now - fight.spawnedAt;
  if (duration < SPEED_RUNNER_TICKS) complete(player, "Royal Titan Speed-Runner");
  if (!fight.oneByOneFailed && fight.damageToBranda + fight.damageToEldric > 0) complete(player, "One by one");
  if (!fight.minionsAttacked) complete(player, "Elemental Company");
  if (fight.titanMinionKills >= LET_THEM_FIGHT_KILLS) complete(player, "Let them fight");
  if (fight.rowsSpawned > 0 && fight.rowsCleared >= fight.rowsSpawned && !fight.rowsExpired) {
    complete(player, "I need room");
  }
  if (fight.avoidable === 0) complete(player, "Perfect Royal Titans");
  if (!fight.prayed) complete(player, "No time to pray");
  // Both titans died inside one charge phase: the kill lands while a charge is open.
  if (fight.openCharge) complete(player, "It takes too long");
  if (player.getAttribute(Shared.STREAK_FAILED_ATTRIBUTE) !== true) {
    const streak = (Number(player.getAttribute(Shared.STREAK_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(Shared.STREAK_ATTRIBUTE, streak);
    if (streak >= TITAN_KILLER_KILLS) complete(player, "Titan Killer");
  }
  return total;
}

function answerKillCount({ player, counts }) {
  const kills = Number(player.getAttribute(Shared.KILLS_ATTRIBUTE)) || 0;
  if (kills > 0) counts[MONSTER] = kills;
}

function answerPersonalBest(request) {
  if (request.monster !== MONSTER) return;
  const best = Number(request.player.getAttribute(Shared.BEST_TICKS_ATTRIBUTE)) || 0;
  if (best > 0) request.best = best;
}

function resetBest(request) {
  if (request.monster !== MONSTER) return;
  request.player.setAttribute(Shared.BEST_TICKS_ATTRIBUTE, 0);
  request.handled = true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onCombatHitResolved(hitResolved);
  pluginApi.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  pluginApi.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
  pluginApi.onCustomEvent("combat-achievements:reset-best", resetBest);
}

module.exports = {
  attach, spawned, tick: tickPlayer, avoidableDamage, hitResolved,
  minionHitByTitan, minionAttacked,
  rowSpawned, rowCleared, rowExpired, blastCharged, blastResolved,
  joined, left, died, killed,
  _test: { states, SPEED_RUNNER_TICKS },
};
