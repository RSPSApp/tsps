"use strict";

/**
 * Getting to the Dagannoth Kings (see ../DagannothKings.plugin.js for behaviour and
 * sources).
 *
 * Cache (rev 241): the Kings' ladder is multiloc 3831; its "Kings' ladder" variants
 * offer Standard/Slayer/Peek (40417) and Standard/Slayer/Private/Peek (40418).
 * Captured: op2 (Slayer) walks to the task lair at (2900, 4385); op3 on the Private
 * variant is not implemented here. The Slayer lair needs a dagannoth task (Wiki);
 * the refusal line is ours, marked as such. Peek counts the public lair. The
 * Climb-up ladders (10229) in each lair walk back to the dungeon side.
 */
const Common = require("./Common.DagannothKings");
const Area = require("./Area.DagannothKings");
const Hud = require("./Hud.DagannothKings");

/** Only the ladder room's Kings' ladder takes players down; every other ladder is untouched. */
function isEntrance(event) {
  if (event?.objectId !== Common.LADDER_ID) return false;
  const at = event?.location;
  if (!at) return false;
  const [tileX, tileY] = Common.ENTRANCE_TILE;
  const dx = at.x - tileX;
  const dy = at.y - tileY;
  return dx * dx + dy * dy <= 10 * 10;
}

/** Only the lair exit ladders take players back up. */
function isExit(event) {
  if (event?.objectId !== Common.EXIT_LADDER_ID) return false;
  const at = event?.location;
  if (!at) return false;
  return Common.inEitherLair({ getX: () => at.x, getY: () => at.y, getZ: () => at.z ?? 0 });
}

function goPublic({ player, location, objectId }) {
  if (!isEntrance({ location, objectId })) return false;
  player.moveTo(Common.location([...Common.PUBLIC_SPAWN]));
  return true;
}

function taskName(player) {
  const request = { player, task: null };
  try {
    Common.api.emitCustomEvent("slayer:current-task", request);
  } catch {
    return "";
  }
  return String(request.task?.name ?? "").toLowerCase();
}

function goTask({ player, location, objectId }) {
  if (!isEntrance({ location, objectId })) return false;
  if (!taskName(player).includes("dagannoth")) {
    player.sendMessage("You need to be assigned dagannoths as a Slayer task to use the Slayer entrance.");
    return true;
  }
  player.moveTo(Common.location([...Common.TASK_SPAWN]));
  return true;
}

function goPrivate({ player, location, objectId }) {
  if (!isEntrance({ location, objectId })) return false;
  player.sendMessage("Private Dagannoth Kings instances are not available yet.");
  return true;
}

function peekText(count) {
  if (count === 0) return "You peek down the ladder and see no adventurers inside.";
  if (count === 1) return "You peek down the ladder and see 1 adventurer inside.";
  return `You peek down the ladder and see ${count} adventurers inside.`;
}

function peek({ player, location, objectId }) {
  if (!isEntrance({ location, objectId })) return false;
  player.sendMessage(peekText(Area.playersInside().length));
  return true;
}

function climbOut({ player, location, objectId }) {
  if (!isExit({ location, objectId })) return false;
  Hud.hideForLeaver(player);
  player.moveTo(Common.location([...Common.OUTSIDE_TILE]));
  return true;
}

function attach(api) {
  api.onObjectClick(Common.LADDER_ID, 1, goPublic);
  api.onObjectClick(Common.LADDER_ID, 2, goTask);
  api.onObjectClick(Common.LADDER_ID, 3, goPrivate);
  api.onObjectClick(Common.LADDER_ID, 4, peek);
  api.onObjectClick(Common.EXIT_LADDER_ID, 1, climbOut);
}

module.exports = { attach, goPublic, goTask, goPrivate, peek, peekText, climbOut, isEntrance, isExit };
