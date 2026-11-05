/**
 * Trouble Brewing, the Mos Le'Harmless minigame (https://oldschool.runescape.wiki/w/Trouble_Brewing).
 * The units are in ./troublebrewing/:
 * - Common: cache placements, teams, timing and the arena boxes;
 * - Lobby: San Fan / Fancy Dan / Honest Jimmy, waiting rooms and the start countdown;
 * - Game: the round, hoppers, boilers, brewing, bottles, scoring and rewards;
 * - Stations: everything the player clicks or uses an item on;
 * - Areas: the arena's teleport/death rules.
 * Rewards are pieces of eight on the saved `trouble-brewing:pieces-of-eight` attribute; the
 * Honest Jimmy shop is not implemented here.
 */
const Common = require("./troublebrewing/Common.TroubleBrewing");

module.exports = {
  name: "TroubleBrewing",
  members: true,
  register(api) {
    Common.init(api);
    api.persistAttribute(Common.PIECES_ATTRIBUTE, 0);
    require("./troublebrewing/Areas.TroubleBrewing")(api);
    require("./troublebrewing/Lobby.TroubleBrewing").attachLobby(api);
    require("./troublebrewing/Stations.TroubleBrewing").attachStations(api);
  },
};
