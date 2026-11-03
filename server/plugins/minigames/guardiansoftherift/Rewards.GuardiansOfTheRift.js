"use strict";

/**
 * What closing the rift pays out.
 *
 * rsprox captures, on the tick the rift closes:
 *   @mes_hl_gre@The Great Guardian successfully closed the rift!</col>
 *   Amount of rifts you have closed: <col=ff0000>1,713</col>.
 *   Elemental energy attuned: <col=ef1020>2</col>. Catalytic energy attuned: <col=ef1020>4</col>.
 *   Total elemental energy: <col=ef1020>5</col>. Total catalytic energy: <col=ef1020>7</col>.
 *   You've been awarded 4,410 bonus Runecraft XP for closing the rift.
 * (total_gotr_kills +1; 4,410 is 45 x level 98). The "attuned" numbers are the game's points:
 * 165 elemental and 407 catalytic energy gave 2 and 4.
 * Wiki: a point per 100 energy of each type, the remainder a chance of one more (73 energy is a
 * 73% chance); both the points and the XP need 300 energy in the game.
 * Abyssal pearls aren't paid here: they come from the Rewards Guardian's searches (Wiki). A close
 * that is delivered twice pays nothing the second time.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");

const XP_PER_LEVEL = 45;

/** Wiki: one point per 100 energy, and the rest as a chance of one more. */
function pointsFor(energy, random = Math.random) {
  const whole = Math.floor(energy / 100);
  return whole + (random() < (energy % 100) / 100 ? 1 : 0);
}

function red(value) {
  return `<col=ef1020>${value}</col>`;
}

/** The points a closed rift awards, after "minigame:points" (a league's tier passive multiplies them). */
function awarded(player, points) {
  const award = { player, minigame: "guardians-of-the-rift", points };
  Shared.api().emitCustomEvent("minigame:points", award);
  return award.points;
}

/**
 * rsprox capture (a player with 2 and 2 energy): below the 300 the close says only that, with no
 * rift counted, no totals and no XP.
 */
function closed({ player, state }) {
  // A close is paid once: a duplicated event can't pay the XP or points twice.
  if (!state || state.closedPaid) return;
  state.closedPaid = true;
  const earned = state.elemental + state.catalytic >= Shared.REWARD_ENERGY;
  if (!earned) {
    player.sendMessage(Shared.highlight(player, "gre", "The Great Guardian successfully closed the rift!"));
    player.sendMessage("You did not contribute enough to attune any elemental or catalytic energy.");
    return;
  }
  const elemental = awarded(player, pointsFor(state.elemental));
  const catalytic = awarded(player, pointsFor(state.catalytic));
  const banked = Records.points(player);
  Records.setPoints(player, banked.elemental + elemental, banked.catalytic + catalytic);
  const total = Records.points(player);
  const rifts = Records.addRiftClosed(player);

  player.sendMessage(Shared.highlight(player, "gre", "The Great Guardian successfully closed the rift!"));
  player.sendMessage(`Amount of rifts you have closed: <col=ff0000>${Shared.formatNumber(rifts)}</col>.`);
  player.sendMessage(`Elemental energy attuned: ${red(elemental)}. Catalytic energy attuned: ${red(catalytic)}.`);
  player.sendMessage(`Total elemental energy: ${red(total.elemental)}. Total catalytic energy:  ${red(total.catalytic)}.`);
  awardXp(player);
  Shared.api().emitCustomEvent("collection-log:count", { player, category: "Guardians of the Rift" });
  Shared.api().emitCustomEvent("guardians-of-the-rift:rift-closed", { player, elemental, catalytic, rifts });
}

function awardXp(player) {
  const { GameConstants } = Shared.core();
  const experience = Shared.runecraftLevel(player) * XP_PER_LEVEL;
  Shared.addXp(player, "RUNECRAFTING", experience);
  const gained = Math.floor(experience * (GameConstants.EXPERIENCE_MULTIPLIER ?? 1));
  player.sendMessage(`You've been awarded ${Shared.formatNumber(gained)} bonus Runecraft XP for closing the rift.`);
}

module.exports = {
  pointsFor, closed,
  attach() {
    Game.on("closed", closed);
  },
};
