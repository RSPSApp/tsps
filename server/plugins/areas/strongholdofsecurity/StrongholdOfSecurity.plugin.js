/**
 * The Stronghold of Security (https://oldschool.runescape.wiki/w/Stronghold_of_Security), from
 * data/definitions/stronghold-of-security.json: its doors and security questions, ladders,
 * portals and reward rooms, as captured. See docs/stronghold-of-security.md.
 */
const Data = require("./SosData");
const Doors = require("./SosDoors");
const Rewards = require("./SosRewards");
const Travel = require("./SosTravel");

module.exports = {
  name: "StrongholdOfSecurity",
  register(api) {
    Doors.bind(api);
    Travel.bind(api);
    for (const key of [Data.CLAIMED_ATTRIBUTE, Travel.DONT_ASK_ATTRIBUTE, Travel.WARNINGS_ATTRIBUTE]) api.persistAttribute(key);
    api.onPlayerLogin(Data.restore);
    api.onObjectInteraction("Entrance", { "Climb-down": Travel.enter });
    for (const floor of Data.FLOORS) {
      api.onObjectInteraction(floor.door, { Open: Doors.open });
      api.onObjectInteraction(floor.reward.name, { [floor.reward.option]: Rewards.open });
    }
    // Ladder handlers return false outside the Stronghold, leaving every other ladder to Ladders.
    for (const name of ["Ladder", "Dripping vine"]) api.onObjectInteraction(name, { "Climb-down": Travel.climbDown, "Climb-up": Travel.climbUp });
    api.onObjectInteraction("Bone Chain", { "Climb-up": Travel.climbUp });
    api.onObjectInteraction("Portal", { Use: Travel.usePortal });
    api.onInterfaceActionClick(Travel.warningClick);
  },
};
