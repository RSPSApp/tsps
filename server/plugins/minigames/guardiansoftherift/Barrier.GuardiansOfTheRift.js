"use strict";

/**
 * The barrier between the lobby and the game: Pass, Peek, Quick-pass and Visual-effects.
 *
 * rsprox captures:
 * - Quick-pass from the lobby steps the player two tiles through, sets `gotr_is_playing` (and the
 *   game id while a game runs) and opens the HUD; from inside it steps them back out and clears
 *   the game's varbits and items. Players can join a game in progress.
 * - From the rift's close until the Portal Guardians close theirs, the way in is refused: "It
 *   looks like the adventurers within are just finishing up. You must wait until they are done to join."
 * - Peek: "Creatures from the Abyss are coming through the rift. There were lots of adventurers
 *   inside when it opened. Great Guardian power: 21%" mid-game and "The adventurers within are
 *   recovering from guarding the rift. There were lots of adventurers inside when the rift
 *   opened." after it (Leagues recordings add "The rift is wide open. Creatures are flooding
 *   through from the Abyss!" and "The rift was successfully closed.", with the number of players).
 * Wiki: Temple of the Eye and 27 Runecraft are needed to play.
 *
 * "Pass" has no capture; it does what Quick-pass does.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");

/** Peek says "lots of adventurers" on a busy world; the captured worlds had hundreds. */
const LOTS_OF_ADVENTURERS = 50;

function adventurers(count) {
  if (count >= LOTS_OF_ADVENTURERS) return "lots of adventurers";
  return count === 1 ? "1 adventurer" : `${count} adventurers`;
}

function insideBarrier(player) {
  return player.getLocation().getY() > Shared.BARRIER.y;
}

/** Two tiles straight through the barrier. */
function cross(player, north) {
  const location = player.getLocation();
  const x = Math.max(Shared.BARRIER.minX, Math.min(Shared.BARRIER.maxX, location.getX()));
  const { Location } = Shared.core();
  player.getMovementQueue().reset();
  player.moveTo(new Location(x, Shared.BARRIER.y + (north ? 1 : -1), Shared.TEMPLE.z));
}

/** Why this player can't come in, or null. */
function refusal(player) {
  if (!Shared.questComplete(player)) return "You need to complete Temple of the Eye to help guard the rift.";
  if (Shared.runecraftLevel(player) < Shared.REQUIRED_RUNECRAFT) {
    return `You need a Runecraft level of at least ${Shared.REQUIRED_RUNECRAFT} to help guard the rift.`;
  }
  const phase = Game.phase();
  if (phase === Game.PHASE.CHARGED || phase === Game.PHASE.CLOSING) {
    return "It looks like the adventurers within are just finishing up. You must wait until they are done to join.";
  }
  return null;
}

/**
 * Capture 1840: the barrier becomes gotr_barrier_noentry when the rift closes and goes back when
 * the Portal Guardians close theirs.
 */
function setBarrierLoc(name) {
  const { GameObject, ObjectManager } = Shared.core();
  if (shownBarrier) ObjectManager.deregister(shownBarrier, true);
  shownBarrier = new GameObject(Shared.loc(name), Shared.location({ x: 3613, y: 9483 }), 10, 0, null);
  ObjectManager.register(shownBarrier, true);
}

function gameEnded() {
  setBarrierLoc(Shared.LOC.BARRIER_FINISHING);
}

function riftsClosed() {
  setBarrierLoc(Shared.LOC.BARRIER);
}

let shownBarrier = null;

const BARRIERS = [Shared.LOC.BARRIER, Shared.LOC.BARRIER_CLOSED, Shared.LOC.BARRIER_FINISHING];

function pass({ player, objectId }) {
  if (!Shared.isLoc(objectId, ...BARRIERS)) return false;
  if (insideBarrier(player)) {
    cross(player, false);
    Game.leave(player);
    return true;
  }
  const reason = refusal(player);
  if (reason) {
    Shared.statement(player, reason);
    return true;
  }
  cross(player, true);
  Game.join(player);
  return true;
}

function peek({ player, objectId }) {
  if (!Shared.isLoc(objectId, ...BARRIERS)) return false;
  const phase = Game.phase();
  const inside = adventurers(Game.startingPlayers());
  let text;
  if (phase === Game.PHASE.PREPARE || phase === Game.PHASE.ATTACK) {
    const opening = Game._game.surged
      ? "The rift is wide open. Creatures are flooding through from the Abyss!"
      : "Creatures from the Abyss are coming through the rift.";
    text = `${opening} There were ${inside} inside when it opened. Great Guardian power: ${Game.powerPercent()}%`;
  } else if (phase === Game.PHASE.CHARGED) {
    text = `The rift was successfully closed. There were ${inside} inside when it opened.`;
  } else {
    text = `The adventurers within are recovering from guarding the rift. There were ${inside} inside when the rift opened.`;
  }
  Shared.statement(player, text);
  return true;
}

/** gotr_colourful_fade_disabled: the Portal Guardians' full-screen colour fade. */
function visualEffects({ player, objectId }) {
  if (!Shared.isLoc(objectId, ...BARRIERS)) return false;
  const disabled = Records.setting(player, "gotr_colourful_fade_disabled") === 1;
  const preference = disabled ? "to not see" : "to see";
  Shared.options(player, `Your current preference is ${preference} colourful full screen effects.`,
    "Enable them.", () => Records.setSetting(player, "gotr_colourful_fade_disabled", 0),
    "Disable them.", () => Records.setSetting(player, "gotr_colourful_fade_disabled", 1));
  return true;
}

module.exports = {
  attach(api) {
    Game.on("ended", gameEnded);
    Game.on("rifts-closed", riftsClosed);
    api.onObjectInteraction("Barrier", { Pass: pass, Peek: peek, "Quick-pass": pass, "Visual-effects": visualEffects });
  },
};
