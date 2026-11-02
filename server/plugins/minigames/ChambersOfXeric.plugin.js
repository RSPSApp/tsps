"use strict";

/**
 * Chambers of Xeric: Mount Quidamortem's recruiting board and parties, the raid's randomly
 * laid-out chambers (or Challenge Mode's fixed ones), and later its rooms and the Great Olm.
 * Each unit lives in ./cox/; add one line per unit.
 */
module.exports = {
  name: "ChambersOfXeric",
  members: true,
  register(api) {
    require("./cox/Lobby.ChambersOfXeric")(api);
    require("./cox/Raid.ChambersOfXeric")(api);
    require("./cox/Storage.ChambersOfXeric")(api);
    require("./cox/Resources.ChambersOfXeric")(api);
    require("./cox/Herblore.ChambersOfXeric")(api);
    require("./cox/Supplies.ChambersOfXeric")(api);
    require("./cox/IceDemon.ChambersOfXeric")(api);
    require("./cox/Thieving.ChambersOfXeric")(api);
    require("./cox/Tightrope.ChambersOfXeric")(api);
    require("./cox/Crabs.ChambersOfXeric")(api);
    require("./cox/Tekton.ChambersOfXeric")(api);
    require("./cox/Muttadiles.ChambersOfXeric")(api);
    require("./cox/Vanguards.ChambersOfXeric")(api);
    require("./cox/Vasa.ChambersOfXeric")(api);
    require("./cox/Scavengers.ChambersOfXeric")(api);
    require("./cox/Mystics.ChambersOfXeric")(api);
    require("./cox/Shamans.ChambersOfXeric")(api);
    require("./cox/Guardians.ChambersOfXeric")(api);
    require("./cox/Vespula.ChambersOfXeric")(api);
    require("./cox/Olm.ChambersOfXeric")(api);
    require("./cox/Hud.ChambersOfXeric")(api);
    require("./cox/Rewards.ChambersOfXeric")(api);
    require("./cox/CombatAchievements.ChambersOfXeric")(api);
    require("./cox/Commands.ChambersOfXeric")(api);
  },
};
