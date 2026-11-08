/**
 * Trouble Brewing, the Mos Le'Harmless minigame (https://oldschool.runescape.wiki/w/Trouble_Brewing).
 * The units are in ./troublebrewing/:
 * - Common: cache placements, teams, timing and the arena boxes;
 * - Lobby: San Fan / Fancy Dan / Honest Jimmy, waiting rooms and the start countdown;
 * - Game: the round, hoppers, boilers, brewing, bottles, scoring and rewards;
 * - Stations: everything the player clicks or uses an item on;
 * - Areas: the arena's teleport/death rules.
 * - Rewards: the saved pieces-of-eight balance and Honest Jimmy's cache-backed omnishop.
 */
const Common = require("./troublebrewing/Common.TroubleBrewing");

module.exports = {
  name: "TroubleBrewing",
  description: "Adds Trouble Brewing on Mos Le'Harmless: the lobby, team rounds of brewing in the arena, scoring and the pieces-of-eight rewards.",
  members: true,
  register(api) {
    Common.init(api);
    api.persistAttribute(Common.PIECES_ATTRIBUTE, 0);
    require("./troublebrewing/Rewards.TroubleBrewing")(api);
    require("./troublebrewing/Areas.TroubleBrewing")(api);
    require("./troublebrewing/Lobby.TroubleBrewing").attachLobby(api);
    require("./troublebrewing/Stations.TroubleBrewing").attachStations(api);
  },
};
