"use strict";

/**
 * The one Wintertodt every player on the world fights: the round's energy, the break between
 * rounds, the points each player inside has earned and the HUD that shows them.
 *
 * Live captures: script 1421 and varbit 7980 go out every other tick; the break is 100 ticks
 * and a round starts at 3500 energy. Wiki: each pyromancer whose brazier is lit drains 1% every
 * 14 ticks, and with every brazier out the Wintertodt recovers 1% every 35 ticks.
 */

const Shared = require("./WintertodtShared");
const Corners = require("./WintertodtCorners");
const Effects = require("./WintertodtEffects");
const Attacks = require("./WintertodtAttacks");
const Warmth = require("./WintertodtWarmth");

const ATTR_KILLS = "wintertodt:kills";
const ATTR_REWARDS = "wintertodt:rewards-owed";

const round = {
  active: false,
  energy: 0,
  timer: Shared.BREAK_TICKS,
  ticks: 0,
  points: new Map(),
  /** Everyone with the HUD up: inside the prison or in the camp. */
  watchers: new Set(),
  task: null,
};

function isActive() {
  return round.active;
}

function energy() {
  return Math.max(0, Math.ceil(round.energy));
}

function energyPercent() {
  return Math.floor((energy() * 100) / Shared.MAX_ENERGY);
}

function corner(index) {
  return Corners.corner(index);
}

function inPrison(player) {
  return Shared.inZone(Shared.PRISON_ZONE, player.getLocation());
}

function playersInPrison() {
  return [...round.watchers].filter(inPrison);
}

// ------------------------------------------------------------------ points

function pointsOf(player) {
  return round.points.get(player) ?? 0;
}

function addPoints(player, amount) {
  if (!round.active) return;
  const before = pointsOf(player);
  round.points.set(player, before + amount);
  if (before < Shared.REWARD_POINTS && before + amount >= Shared.REWARD_POINTS) {
    player.sendMessage("You have helped enough to earn a supply crate.");
  }
}

/** Leaving the prison or logging out loses the round's points. */
function forgetPlayer(player) {
  round.points.delete(player);
}

// ------------------------------------------------------------------ HUD

function sendHud(player) {
  const points = inPrison(player) ? pointsOf(player) : 0;
  const pyromancers = Corners.state.map((c) => (c.pyromancerHealthy ? 1 : 0));
  const braziers = Corners.state.map((c) => c.brazier);
  player.getPacketSender().sendClientScript(Shared.SCRIPT.HUD_UPDATE, points, energy(), ...pyromancers, ...braziers);
}

function sendTimer(player) {
  player.getPacketSender().sendVarbit(Shared.VARBIT.ROUND_TIMER, round.active ? 0 : Math.max(0, round.timer));
}

/** Opens the HUD: the points and warmth only show inside the prison. */
function openHud(player, inside) {
  round.watchers.add(player);
  player.getPacketSender().sendSubInterface(Shared.OVERLAY_HUD_UID, Shared.INTERFACE.HUD, 1, {
    postScripts: [{ scriptId: inside ? Shared.SCRIPT.HUD_INSIDE : Shared.SCRIPT.HUD_OUTSIDE, args: [] }],
  });
  sendTimer(player);
  sendHud(player);
}

function closeHud(player) {
  round.watchers.delete(player);
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
}

function broadcast() {
  for (const player of round.watchers) {
    sendTimer(player);
    sendHud(player);
  }
}

// ------------------------------------------------------------------ the world

function setObject(id, tile) {
  const { GameObject, ObjectManager } = Shared.core();
  ObjectManager.register(new GameObject(id, Shared.loc(tile), 10, 0, null), true);
}

function pyromancersSay(text) {
  Shared.CORNERS.forEach((_, index) => Corners.say(index, text));
}

// ------------------------------------------------------------------ rounds

function startRound() {
  Effects.setViewers(playersInPrison);
  round.active = true;
  round.energy = Shared.MAX_ENERGY;
  round.timer = 0;
  round.points.clear();
  setObject(Shared.OBJECT.STORM, Shared.STORM_TILE);
  Shared.api()?.emitCustomEvent("wintertodt:round-start", {});
  broadcast();
}

function endRound() {
  for (const player of playersInPrison()) {
    Shared.stopAction(player);
    Shared.removeItems(player, Shared.FUEL_ITEMS);
    reward(player, pointsOf(player));
  }
  round.active = false;
  round.energy = 0;
  round.timer = Shared.BREAK_TICKS;
  round.points.clear();
  Corners.resetAll();
  Attacks.reset();
  setObject(Shared.OBJECT.STORM_IDLE, Shared.STORM_TILE);
  pyromancersSay("We can rest for a time.");
  Shared.api()?.emitCustomEvent("wintertodt:round-end", {});
  broadcast();
}

/**
 * Wiki: 500 points owes two rewards; every further 500 guarantees one more, and the points past
 * the last 500 give that share of a chance at another (1200 points: 3, and a 40% chance of 4).
 */
function rewardsFor(points, random = Math.random) {
  if (points < Shared.REWARD_POINTS) return 0;
  const rewards = Math.floor(points / Shared.REWARD_POINTS) + 1;
  const chance = (points % Shared.REWARD_POINTS) / Shared.REWARD_POINTS;
  return rewards + (random() < chance ? 1 : 0);
}

function reward(player, points) {
  if (points < Shared.REWARD_POINTS) {
    player.sendMessage("You did not earn enough points to be worthy of a gift from the citizens of Kourend this time.");
    return;
  }
  const { GameConstants, Skill } = Shared.core();
  const experience = Shared.firemakingLevel(player) * 100;
  player.getSkillManager().addExperiences(Skill.FIREMAKING, experience);
  const gained = Math.floor(experience * (GameConstants.EXPERIENCE_MULTIPLIER ?? 1));
  player.sendMessage(`You have gained ${gained.toLocaleString("en-US")} Firemaking XP.`);

  const kills = killsOf(player) + 1;
  player.setAttribute(ATTR_KILLS, kills);
  player.sendMessage(`Your subdued Wintertodt count is: <col=ff0000>${kills}</col>.`);

  const earned = rewardsFor(points);
  const owed = Math.min(Shared.MAX_REWARDS, rewardsOwed(player) + earned);
  player.setAttribute(ATTR_REWARDS, owed);
  syncVars(player);
  player.sendMessage(`You're owed an additional ${earned} rewards from the reward cart. You're now owed ${owed} rewards.`);
}

function killsOf(player) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(ATTR_KILLS)) || 0));
}

function rewardsOwed(player) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(ATTR_REWARDS)) || 0));
}

function setRewardsOwed(player, owed) {
  player.setAttribute(ATTR_REWARDS, Math.max(0, Math.min(Shared.MAX_REWARDS, owed)));
  syncVars(player);
}

/** The kill count varp and the cart's varbit (its multiloc shows how full it is). */
function syncVars(player) {
  player.getPacketSender()
    .sendConfig(Shared.VARP.KILLS, killsOf(player))
    .sendVarbit(Shared.VARBIT.REWARDS_OWED, rewardsOwed(player));
}

/** Pyromancers whose brazier is lit drain the energy; with every brazier out it recovers. */
function tickEnergy() {
  const draining = Corners.state.filter((_, index) => Corners.isDraining(index)).length;
  if (draining > 0) round.energy -= draining * Shared.DRAIN_PER_PYROMANCER;
  else if (Corners.litCount() === 0) round.energy = Math.min(Shared.MAX_ENERGY, round.energy + Shared.RECOVERY_PER_TICK);
}

const attackContext = {
  ticks: 0,
  energy: 0,
  players: playersInPrison,
  isActive,
  broadcast,
};

function tick() {
  round.ticks++;
  Corners.setNow(round.ticks);
  Warmth.tick(round.ticks, playersInPrison());
  if (round.active) {
    tickEnergy();
    if (round.energy <= 0) {
      endRound();
      return;
    }
    Corners.tick(round.ticks);
    attackContext.ticks = round.ticks;
    attackContext.energy = round.energy;
    Attacks.tick(attackContext);
  } else if (--round.timer <= 0) {
    startRound();
    return;
  }
  if (round.ticks % Shared.HUD_PERIOD === 0) broadcast();
}

/** The round loop runs from server start, whether or not anyone is there. */
function start() {
  if (round.task) return;
  const { Task, TaskManager } = Shared.core();
  round.task = new (class extends Task {
    constructor() { super(1, "wintertodt", false); }
    execute() { tick(); }
  })();
  TaskManager.submit(round.task);
  Effects.setViewers(playersInPrison);
  Corners.resetAll();
  setObject(Shared.OBJECT.STORM_IDLE, Shared.STORM_TILE);
}

/** For dev commands: jump straight to the next round, or end this one. */
function skipBreak() {
  if (!round.active) startRound();
}

function setEnergy(value) {
  if (!round.active) return;
  round.energy = Math.max(0, Math.min(Shared.MAX_ENERGY, value));
  if (round.energy <= 0) endRound();
  else broadcast();
}

module.exports = {
  ATTR_KILLS, ATTR_REWARDS,
  isActive, energy, energyPercent, corner, inPrison, playersInPrison,
  pointsOf, addPoints, forgetPlayer,
  openHud, closeHud, sendHud, broadcast,
  startRound, endRound, rewardsFor, reward, killsOf, rewardsOwed, setRewardsOwed, syncVars,
  tick, start, skipBreak, setEnergy,
  _round: round,
};
