"use strict";

/**
 * Knight Waves Training Ground (https://oldschool.runescape.wiki/w/Knight_Waves_Training_Ground).
 *
 * The top floor of Camelot Castle: eight Round Table knights in order, melee only, no Prayer,
 * Ranged or Magic, a safe death, and progress kept while the player leaves, dies or logs out.
 * Completing the eighth (Sir Lancelot) unlocks Chivalry and Piety and the Camelot respawn.
 *
 * The units are in ./knightwaves/:
 * - Common: room bounds, wave table, attribute/varbit and shared helpers;
 * - Room: the area, spawn/despawn lifecycle, wave progression and death recovery;
 * - Combat: the stat drains each knight's damaging hit causes;
 * - Restrictions: the melee-only and no-Prayer rules;
 * - Squire: the activity's conversation outside the room;
 * - Rewards: the XP, prayer and Camelot-respawn rewards.
 *
 * Sources: the OSRS Wiki activity page (waves, hitpoints, weaknesses, drains, rewards), the
 * individual knight pages, and the pinned cache for every id. The wave NPCs 4361 to 4354 carry
 * their full combat definitions.
 */
const Common = require("./knightwaves/Common.KnightWaves");
const Room = require("./knightwaves/Room.KnightWaves");

/** Playable encounter IDs, read without starting a run or rolling rewards. */
function describeEncounters({ npcIds }) {
  for (const knight of Common.KNIGHTS) npcIds.add(knight.id);
}

module.exports = {
  name: "KnightWaves",
  description: "Adds the Knight Waves Training Ground: eight Round Table knights, melee-only, and the Chivalry/Piety unlock.",
  members: true,
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    Common.init(api);
    api.persistAttribute(Common.WAVE_ATTRIBUTE, 0);
    api.onCustomEvent("knight-waves:is-complete", Common.answerComplete);
    api.onCustomEvent("knight-waves:progress", Common.answerProgress);
    require("./knightwaves/Restrictions.KnightWaves").attachRestrictions(api);
    require("./knightwaves/Combat.KnightWaves").attachCombat(api);
    Room.attachRoom(api);
    require("./knightwaves/Squire.KnightWaves").attachSquire(api);
    require("./knightwaves/Rewards.KnightWaves").attachRewards(api);
  },
};
