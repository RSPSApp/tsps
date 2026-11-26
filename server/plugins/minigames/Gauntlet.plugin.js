"use strict";

/**
 * The Gauntlet and the Corrupted Gauntlet: the lobby under Prifddinas, the maze built for each
 * run, and the Crystalline Hunllef. Each unit lives in ./gauntlet/; add one line per unit.
 */
/** Playable encounter IDs, read without starting a run or rolling rewards. */
function describeEncounters({ npcIds }) {
  for (const monster of Object.values(require("./gauntlet/Monsters.Gauntlet").MONSTERS)) for (const id of Object.values(monster.ids)) npcIds.add(id);
  for (const ids of Object.values(require("./gauntlet/Hunllef.Gauntlet").IDS)) {
    for (const style of ["melee", "ranged", "magic"]) npcIds.add(ids[style]);
  }
}

module.exports = {
  name: "Gauntlet",
  description: "Adds the Gauntlet and Corrupted Gauntlet: the lobby under Prifddinas, the maze built for each run and the Crystalline Hunllef.",
  members: true,
  register(api) {
    require("./gauntlet/Equipment.Gauntlet").register(api);
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    require("./gauntlet/Lobby.Gauntlet")(api);
    require("./gauntlet/Run.Gauntlet")(api);
    require("./gauntlet/Prep.Gauntlet")(api);
    require("./gauntlet/Weapons.Gauntlet")(api);
    require("./gauntlet/Commands.Gauntlet")(api);
    require("./gauntlet/CombatAchievements.Gauntlet")(api);
    require("./gauntlet/Echo.Gauntlet")(api);
  },
};
