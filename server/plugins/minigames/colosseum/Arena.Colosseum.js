"use strict";

/**
 * Inside the arena: Minimus's Start-wave and Leave, the intermission screen's buttons, and
 * what death, logging out and logging back in do to a run.
 *
 * Capture: a death shows "Oh dear, you are dead!" and puts you back in the lobby beside Minimus.
 * Wiki: dying is unsafe and your grave is in the lobby; dying, teleporting out or logging out
 * during a run forfeits it. This server has no graves, so what would drop lands in the lobby.
 */

const Shared = require("./ColosseumShared");
const Run = require("./ColosseumRun");

const MOD_BUTTONS = Shared.COMPONENT.MOD_BUTTONS.map((component) => (Shared.INTERFACE.INTERMISSION << 16) | component);
const CONFIRM_BUTTON = (Shared.INTERFACE.INTERMISSION << 16) | Shared.COMPONENT.CONFIRM;

function ownRun(event) {
  const run = Run.runOf(event.player);
  return run && event.npc?.__colosseumRun === run ? run : null;
}

/** Minimus answers from anywhere in the arena: no walking up to him (as live). */
const MINIMUS_REACH = 64;

function reachMinimus(event) {
  const run = ownRun(event);
  if (run && event.npc === run.minimus) event.range = MINIMUS_REACH;
}

function startWave(event) {
  const run = ownRun(event);
  if (!run) return false;
  run.openIntermission();
  return true;
}

function leave(event) {
  const run = ownRun(event);
  if (!run) return false;
  run.askToLeave();
  return true;
}

function pickModifier(event) {
  const run = Run.runOf(event.player);
  if (!run) return false;
  const uid = event.buttonId ?? (((event.groupId ?? 0) << 16) | (event.childId ?? 0));
  run.selectModifier(MOD_BUTTONS.indexOf(uid) + 1);
  return true;
}

function confirm(event) {
  const run = Run.runOf(event.player);
  if (!run) return false;
  run.confirm();
  return true;
}

/** Nothing in a run is safe: what drops lands in the lobby, as the grave would be. */
function dropInLobby(event) {
  if (!Run.runOf(event.player) || !event.dropEligible) return;
  const { ItemOnGroundManager } = Shared.core();
  ItemOnGroundManager.registerLocation(event.player, event.item, Shared.loc(Shared.LOBBY_RESPAWN));
  event.handled = true;
}

function dieInRun(event) {
  const run = Run.runOf(event.player);
  if (!run) return;
  event.handled = true;
  run.end("death");
  event.player.moveTo(Shared.loc(Shared.LOBBY_RESPAWN));
}

/** Logged out inside (a crash, or the server stopping mid-run): the run is gone, back to the lobby. */
function returnToLobby({ player }) {
  if (Run.runOf(player)) return;
  if (player.getAttribute(Run.ATTR_RUN) !== true && !Shared.inArena(player.getLocation())) return;
  player.setAttribute(Run.ATTR_RUN, null);
  player.moveTo(Shared.loc(Shared.LOBBY_RESPAWN));
}

/** The run's NPCs fight only the player whose run it is. */
function ownRunOnly(event) {
  const run = event.attacker?.__colosseumRun ?? event.target?.__colosseumRun;
  if (!run) return;
  const other = event.attacker?.__colosseumRun ? event.target : event.attacker;
  if (other?.isPlayer?.() && other !== run.player) event.allow = false;
  // The seated Sol Heredit and Minimus are scenery here.
  const npc = event.attacker?.__colosseumRun ? event.attacker : event.target;
  if (npc === run.sol || npc === run.minimus) event.allow = false;
}

module.exports = function registerColosseumArena(api) {
  Shared.bind(api);
  api.persistAttribute(Run.ATTR_RUN);
  api.onNpcRoute(reachMinimus);
  api.onNpcInteraction("Minimus", { "Start-wave": startWave, Leave: leave });
  api.onInterfaceActionButton(MOD_BUTTONS, pickModifier);
  api.onInterfaceActionButton(CONFIRM_BUTTON, confirm);
  api.onPlayerDeathItemDrop(dropInLobby);
  api.onPlayerDeath(dieInRun);
  api.onPlayerLogin(returnToLobby);
  api.onCanAttack(ownRunOnly);
};

module.exports.pickModifier = pickModifier;
module.exports.confirm = confirm;
module.exports.dieInRun = dieInRun;
