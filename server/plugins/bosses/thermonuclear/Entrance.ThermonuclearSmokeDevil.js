"use strict";

/**
 * Getting to the Thermonuclear smoke devil (see ../ThermonuclearSmokeDevil.plugin.js
 * for behaviour and sources).
 *
 * Cache (rev 241): crevice 535 (slayer_cave_smokedevil_boss_entrance) at (2378, 9452)
 * offers Use/Peek, crevice 536 (slayer_cave_smokedevil_boss_exit) at (2377, 9452) offers
 * Use - only those two options are registered. Captured (submission 1158): clicking
 * 535 walks the player to (2379, 9452), then a plain teleport to (2376, 9452) with no
 * animation, spotanim or sound, so the pass-through is a plain move. Peek counts the
 * room. Private instances (NR: 100k) are a follow-up and are not implemented here.
 */
const Common = require("./Common.ThermonuclearSmokeDevil");
const Area = require("./Area.ThermonuclearSmokeDevil");

/** Only crevices by the boss room take players through; every other crevice is untouched. */
function isBossCrevice(event) {
  const id = event?.objectId;
  if (id !== Common.CREVICE_OUTSIDE_ID && id !== Common.CREVICE_INSIDE_ID) return false;
  const at = event?.location;
  if (!at) return false;
  const dx = at.x - Common.OUTSIDE_TILE[0];
  const dy = at.y - Common.OUTSIDE_TILE[1];
  return dx * dx + dy * dy <= 30 * 30;
}

function through({ player, location, objectId }) {
  if (!isBossCrevice({ location, objectId })) return false;
  const inside = Common.inLair(player.getLocation());
  player.moveTo(Common.location(inside ? Common.OUTSIDE_TILE : Common.INSIDE_TILE));
  return true;
}

function peekText(count) {
  if (count === 0) return "You peek through the crevice and see no adventurers inside.";
  if (count === 1) return "You peek through the crevice and see 1 adventurer inside.";
  return `You peek through the crevice and see ${count} adventurers inside.`;
}

/** Captured empty; the headcount follows the other bosses' Peek lines (estimate). */
function peek({ player, location, objectId }) {
  if (!isBossCrevice({ location, objectId })) return false;
  player.sendMessage(peekText(Area.playersInside().length));
  return true;
}

function attach(api) {
  // Cache: 535 offers Use/Peek, 536 offers Use - nothing else exists to register.
  api.onObjectInteraction("Crevice", { Use: through, Peek: peek });
}

module.exports = { attach, through, peek, peekText, isBossCrevice };
