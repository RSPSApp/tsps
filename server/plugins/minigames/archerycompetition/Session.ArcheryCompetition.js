"use strict";

/**
 * The Ranging Guild's archery competition: the round state the Competition Judge and the
 * targets share. Mechanics are the OSRS Wiki's (Target (Ranging Guild)): 10 shots a round,
 * ring defences 1000/2000/3000/4000/7000 checked in order with the first failed roll scoring
 * the ring before it, 1 Ranged XP per 2 points and 1 Archery ticket per 10 points.
 *
 * The player's accuracy reuses the core's ranged attack roll
 * (AccuracyFormulasDpsCalc.attackRangedRoll: effective ranged attack * (ranged attack + 64)),
 * which already applies visible boosts, prayers and gear.
 */

const PLAYED_ATTRIBUTE = "archery-competition:played";

const RANGED_LEVEL = 40;
const ENTRY_FEE = 200;
const SHOTS_PER_ROUND = 10;
const ARROWS_PER_ROUND = 10;

/** Ring buckets in checked order, with the shot captions the wiki quotes. */
const RINGS = [
  { ring: "black", defence: 1000, score: 10, caption: "Hit Black!" },
  { ring: "blue", defence: 2000, score: 20, caption: "Hit Blue!" },
  { ring: "red", defence: 3000, score: 30, caption: "Hit Red!" },
  { ring: "yellow", defence: 4000, score: 50, caption: "Hit Yellow!" },
  { ring: "bullseye", defence: 7000, score: 100, caption: "Bulls-Eye!" },
];
const MISS = { ring: "miss", score: 0, caption: "You missed!" };

const sessions = new Map();
let api;
let core;
let attackRollOverride = null;
let randomOverride = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

// --- Wiki maths

function accuracy(attack, defence) {
  return attack < defence ? attack / (2 * defence + 2) : 1 - (defence + 2) / (2 * attack + 2);
}

/** One shot's ring: walk the buckets, the first failed roll returns the ring before it. */
function scoreShot(attack, random = Math.random) {
  let reached = MISS;
  for (const ring of RINGS) {
    if (random() >= accuracy(attack, ring.defence)) return reached;
    reached = ring;
  }
  return reached;
}

function xpFor(score) {
  return score / 2;
}

function ticketsFor(score) {
  return Math.floor(score / 10);
}

/** Wiki score-check tiers; 81-89 is undocumented and reads as "Not bad". */
function scoreMessage(score) {
  if (score <= 0) return "You haven't started yet.";
  if (score >= 90) return "You're pretty good, keep it up.";
  return "Not bad, keep going.";
}

// --- Round state

function level(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.RANGED);
}

function coins(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function sessionOf(player) {
  return sessions.get(player) ?? null;
}

function hasPlayed(player) {
  return player.getAttribute(PLAYED_ATTRIBUTE) === true;
}

function markPlayed(player) {
  player.setAttribute(PLAYED_ATTRIBUTE, true);
}

/** A bow that fires bronze arrows, per the Wiki's "must be able to fire bronze arrows". */
function bowEquipped(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  if (!weapon || typeof weapon.getId !== "function") return false;
  const ranged = core.RangedWeapon.getFor(player);
  return !!ranged && ranged.getAmmunitionData().some((ammo) => ammo.getItemId() === core.ItemIdentifiers.BRONZE_ARROW);
}

function attackRoll(player) {
  return attackRollOverride ? attackRollOverride(player) : core.AccuracyFormulasDpsCalc.attackRangedRoll(player);
}

function canStart(player) {
  const session = sessions.get(player);
  if (session && !session.finished) return false;
  if (level(player) < RANGED_LEVEL) return false;
  if (coins(player) < ENTRY_FEE) return false;
  return player.getInventory().getFreeSlots() > 0 || player.getInventory().contains(core.ItemIdentifiers.BRONZE_ARROW);
}

function startRound(player) {
  if (!canStart(player)) return false;
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, ENTRY_FEE);
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.BRONZE_ARROW, ARROWS_PER_ROUND));
  sessions.set(player, { shots: 0, score: 0, provided: ARROWS_PER_ROUND, finished: false, ticketsAwarded: false });
  markPlayed(player);
  return true;
}

/** One shot: consumes an arrow, adds the ring's score and XP share. Null when it can't shoot. */
function takeShot(player, random = randomOverride ?? Math.random) {
  const session = sessions.get(player);
  if (!session || session.finished) return null;
  if (player.getInventory().getAmount(core.ItemIdentifiers.BRONZE_ARROW) <= 0) return null;
  player.getInventory().deleteNumber(core.ItemIdentifiers.BRONZE_ARROW, 1);
  const shot = scoreShot(attackRoll(player), random);
  session.shots++;
  session.score += shot.score;
  if (session.provided > 0) session.provided--;
  if (shot.score > 0) player.getSkillManager().addExperiences(core.Skill.RANGED, xpFor(shot.score));
  if (session.shots >= SHOTS_PER_ROUND) session.finished = true;
  return shot;
}

/** "At the end you'll be awarded 1 ticket for every 10 points", once a finished round. */
function claimTickets(player) {
  const session = sessions.get(player);
  if (!session || !session.finished || session.ticketsAwarded) return 0;
  session.ticketsAwarded = true;
  const tickets = ticketsFor(session.score);
  if (tickets > 0) {
    player.getInventory().forceAdd(player, new core.Item(core.ItemIdentifiers.ARCHERY_TICKET, tickets));
  }
  return tickets;
}

/** Leaving: no tickets, and the judge takes back whatever arrows he provided. */
function endRound(player) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  const inventory = player.getInventory();
  const remove = Math.min(session.provided, inventory.getAmount(core.ItemIdentifiers.BRONZE_ARROW));
  if (remove > 0) inventory.deleteNumber(core.ItemIdentifiers.BRONZE_ARROW, remove);
}

function leave({ player }) {
  if (player) endRound(player);
}

module.exports = function registerSession(pluginApi) {
  init(pluginApi);
  api.persistAttribute(PLAYED_ATTRIBUTE);
  api.onPlayerLogout(leave);
  api.onPlayerDisconnect(leave);
  api.onPlayerDeath(leave);
};

Object.assign(module.exports, {
  RANGED_LEVEL,
  ENTRY_FEE,
  SHOTS_PER_ROUND,
  ARROWS_PER_ROUND,
  accuracy,
  scoreShot,
  xpFor,
  ticketsFor,
  scoreMessage,
  level,
  coins,
  sessionOf,
  hasPlayed,
  markPlayed,
  bowEquipped,
  attackRoll,
  canStart,
  startRound,
  takeShot,
  claimTickets,
  endRound,
  _test: {
    sessions,
    accuracy,
    scoreShot,
    xpFor,
    ticketsFor,
    scoreMessage,
    init,
    setAttackRoll: (roll) => {
      attackRollOverride = roll;
    },
    setRandom: (random) => {
      randomOverride = random;
    },
    reset: () => {
      sessions.clear();
      attackRollOverride = null;
      randomOverride = null;
    },
  },
});
