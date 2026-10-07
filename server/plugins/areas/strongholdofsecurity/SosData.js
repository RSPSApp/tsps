/**
 * data/definitions/stronghold-of-security.json, plus the player's progress: a floor counts as
 * completed once its reward is claimed, which is also what unlocks its emote (the emote tab's
 * cache scripts read the four sos_emote varbits).
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");

const DATA = JSON.parse(
  fs.readFileSync(path.join(GameConstants.DEFINITIONS_DIRECTORY, "stronghold-of-security.json"), "utf8"),
);
const FLOORS = DATA.floors;
const CLAIMED_ATTRIBUTE = "sos.claimed";

const toLocation = ([x, y, z]) => new Location(x, y, z ?? 0);

/** Where a floor's up-ladder leads: the surface, or the given tile on the floor above. */
function upDestination(floor) {
  return toLocation(floor.upTo === "surface" ? DATA.surface : floor.upTo);
}

function floorByObject(field, id) {
  return FLOORS.find((floor) => (Array.isArray(floor[field]) ? floor[field].includes(id) : floor[field] === id)) ?? null;
}

function claimed(player) {
  return new Set(player.getAttribute(CLAIMED_ATTRIBUTE) ?? []);
}

function isClaimed(player, floor) {
  return claimed(player).has(FLOORS.indexOf(floor));
}

function claim(player, floor) {
  const all = claimed(player);
  all.add(FLOORS.indexOf(floor));
  player.setAttribute(CLAIMED_ATTRIBUTE, [...all]);
  player.getPacketSender().sendVarbit(floor.reward.emoteVarbit, 1);
}

/** Wiki: "Full completion of the stronghold ceases all questioning by doors." */
function isComplete(player) {
  return FLOORS.every((floor) => isClaimed(player, floor));
}

function restore({ player }) {
  for (const floor of FLOORS) if (isClaimed(player, floor)) player.getPacketSender().sendVarbit(floor.reward.emoteVarbit, 1);
}

module.exports = { DATA, FLOORS, CLAIMED_ATTRIBUTE, toLocation, upDestination, floorByObject, claimed, isClaimed, claim, isComplete, restore };
