"use strict";

const Shared = require("./WintertodtShared");
const Round = require("./WintertodtRound");
const Corners = require("./WintertodtCorners");
const Warmth = require("./WintertodtWarmth");
const Attacks = require("./WintertodtAttacks");

/** ::wintertodt - to the camp, outside the Doors of Dinh. */
function toCamp({ player }) {
  player.moveTo(Shared.randomTile(Shared.EXIT_AREA));
  return true;
}

/** ::wtstart - ends the break between rounds now. */
function startRound({ player }) {
  if (Round.isActive()) {
    player.sendMessage("A round is already under way.");
    return true;
  }
  Round.skipBreak();
  return true;
}

/** ::wtenergy <0-3500> - sets the Wintertodt's energy; 0 ends the round. */
function setEnergy({ player, parts }) {
  const value = Number(parts?.[1]);
  if (!Round.isActive() || !Number.isFinite(value)) {
    player.sendMessage(`Use ::wtenergy <0-${Shared.MAX_ENERGY}> during a round.`);
    return true;
  }
  Round.setEnergy(value);
  return true;
}

/** ::wtpoints <points> - adds points to your round (inside the prison, during a round). */
function addPoints({ player, parts }) {
  const value = Number(parts?.[1]);
  if (!Round.isActive() || !Round.inPrison(player) || !Number.isFinite(value) || value <= 0) {
    player.sendMessage("Use ::wtpoints <points> inside the prison during a round.");
    return true;
  }
  Round.addPoints(player, Math.trunc(value));
  Round.sendHud(player);
  return true;
}

/** ::wtwarmth <0-1000> - sets your warmth meter. */
function setWarmth({ player, parts }) {
  const value = Number(parts?.[1]);
  if (!Number.isFinite(value)) {
    player.sendMessage(`Use ::wtwarmth <0-${Shared.MAX_WARMTH}>.`);
    return true;
  }
  Warmth.setWarmth(player, value);
  return true;
}

/** ::wtinfo - your warm items, warmth and what each attack would take from you now. */
function info({ player }) {
  const standard = Warmth.damageFor(player, "standard");
  const brazier = Warmth.damageFor(player, "brazier");
  const area = Warmth.damageFor(player, "area");
  player.sendMessage(`Warm items: ${Warmth.warmItems(player)}/4, warmth ${Warmth.warmthOf(player) / 10}%, braziers lit ${Corners.litCount()}.`);
  player.sendMessage(`Damage: cold ${standard} (-${standard}%), shrapnel ${brazier} (-${brazier}%), area ${area} (-${area}%).`);
  player.sendMessage(`Cold hit chance per 5 ticks now: ${Math.round(Attacks.standardChance(Round.energy()) * 100)}%.`);
  return true;
}

/** ::wtrewards <count> - sets the rewards the cart owes you. */
function setRewards({ player, parts }) {
  const value = Number(parts?.[1]);
  if (!Number.isFinite(value) || value < 0) {
    player.sendMessage("Use ::wtrewards <count>.");
    return true;
  }
  Round.setRewardsOwed(player, Math.trunc(value));
  player.sendMessage(`The reward cart now owes you ${Round.rewardsOwed(player)} rewards.`);
  return true;
}

/** ::wtlight - lights every brazier and heals every pyromancer. */
function lightAll({ player }) {
  if (!Round.isActive()) {
    player.sendMessage("Start a round first (::wtstart).");
    return true;
  }
  Shared.CORNERS.forEach((_, index) => {
    Corners.healPyromancer(index);
    Corners.setBrazier(index, Shared.BRAZIER.LIT);
  });
  Round.broadcast();
  return true;
}

const ATTACK_CONTEXT = {
  players: Round.playersInPrison,
  isActive: Round.isActive,
  broadcast: Round.broadcast,
};

/** ::wtattack <area|small|large|pyro> - makes the Wintertodt attack you or the nearest corner. */
function attack({ player, parts }) {
  const kind = String(parts?.[1] ?? "").toLowerCase();
  if (!Round.isActive() || !Round.inPrison(player)) {
    player.sendMessage("Use ::wtattack <area|small|large|pyro> inside the prison during a round.");
    return true;
  }
  const index = Corners.nearestCorner(player.getLocation());
  if (kind === "area") {
    if (!Attacks.areaAttack(player, ATTACK_CONTEXT)) player.sendMessage("There's no clear 3x3 around you.");
  } else if (kind === "small" || kind === "large") {
    if (Corners.corner(index).brazier !== Shared.BRAZIER.LIT) Corners.setBrazier(index, Shared.BRAZIER.LIT);
    (kind === "small" ? Attacks.smallBrazierAttack : Attacks.largeBrazierAttack)(index, ATTACK_CONTEXT);
  } else if (kind === "pyro") {
    Attacks.pyromancerAttack(index, ATTACK_CONTEXT);
  } else {
    player.sendMessage("Use ::wtattack <area|small|large|pyro>.");
  }
  return true;
}

module.exports = function registerWintertodtCommands(api) {
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("wintertodt", toCamp, DEVELOPER);
  api.registerCommand("wtstart", startRound, DEVELOPER);
  api.registerCommand("wtenergy", setEnergy, DEVELOPER);
  api.registerCommand("wtpoints", addPoints, DEVELOPER);
  api.registerCommand("wtwarmth", setWarmth, DEVELOPER);
  api.registerCommand("wtrewards", setRewards, DEVELOPER);
  api.registerCommand("wtinfo", info, DEVELOPER);
  api.registerCommand("wtlight", lightAll, DEVELOPER);
  api.registerCommand("wtattack", attack, DEVELOPER);
};
