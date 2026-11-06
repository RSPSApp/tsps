"use strict";

/**
 * The Morytania Diary's Slayer reward (Wiki, Morytania Diary rewards): 2.5% / 5% / 7.5% / 10% more
 * Slayer experience "in the Slayer Tower while on a Slayer task", for the easy / medium / hard /
 * elite diary. It is a diary reward of its own, listed apart from the legs, so wearing the legs
 * does not matter. The Wiki says "completed" on the Slayer changes, "claiming rewards" on the legs
 * page; we use the tier being complete, as the Elite Karamja Diary's Tokkul does (diary:is-complete).
 * Tasks.Slayer.js asks for the boost of a kill it has already counted as on task.
 *
 * "In the Slayer Tower" is the floors (Slayer area 9's first box, slayer-areas.json), the basement
 * (SlayerTower.plugin.js' bounds) and the Grotesque Guardians' roof (Dusk's 1,350 XP also gets
 * the diary's bonus, Wiki: Grotesque Guardians). Which of these the Wiki's "in the Slayer Tower"
 * means for the basement is inferred.
 */
const Data = require("./Data.Slayer");
const SlayerTower = require("../../areas/SlayerTower.plugin");
const Guardians = require("../../bosses/data/grotesque-guardians.json");

const SLAYER_TOWER_AREA = 9;
const MORYTANIA_DIARY = "morytania";
/** The diary tiers from the highest down, and the multiplier of each. */
const TIERS = [["elite", 1.1], ["hard", 1.075], ["medium", 1.05], ["easy", 1.025]];

let api = null;

function init(pluginApi) {
  api = pluginApi;
}

const within = (location, [minX, maxX, minY, maxY, z]) => {
  const x = location.getX();
  const y = location.getY();
  return x >= minX && x <= maxX && y >= minY && y <= maxY && (z === undefined || location.getZ() === z);
};

function inSlayerTower(location) {
  if (!location) return false;
  const area = [...Data.get().areas.values()].find((entry) => entry.id === SLAYER_TOWER_AREA);
  const [minX, minY, maxX, maxY] = area.boxes[0];
  return within(location, [minX, maxX, minY, maxY])
    || within(location, SlayerTower.BASEMENT.bounds)
    || within(location, Guardians.roof.bounds);
}

/** The multiplier of the highest Morytania Diary tier the player has completed. */
function tierBoost(player) {
  for (const [tier, multiplier] of TIERS) {
    const request = { player, diary: MORYTANIA_DIARY, tier, complete: false };
    api.emitCustomEvent("diary:is-complete", request);
    if (request.complete === true) return multiplier;
  }
  return 1;
}

/** The Slayer XP multiplier for a counted on-task kill of `npc` by `player`. */
function boost(player, npc) {
  return inSlayerTower(npc.getLocation?.()) ? tierBoost(player) : 1;
}

module.exports = { init, boost };
