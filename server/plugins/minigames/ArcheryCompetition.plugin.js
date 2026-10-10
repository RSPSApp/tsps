"use strict";

/**
 * The Ranging Guild's shooting range ("Archery Competition"): the Competition Judge starts a
 * round for 200 coins and hands over 10 bronze arrows, and the Target objects score the 10
 * shots. Units live in ./archerycompetition/. Behaviour is the OSRS Wiki's
 * (Target (Ranging Guild), Transcript: Competition Judge).
 */
module.exports = {
  name: "ArcheryCompetition",
  members: true,
  register(api) {
    require("./archerycompetition/Session.ArcheryCompetition")(api);
    require("./archerycompetition/Area.ArcheryCompetition")(api);
    require("./archerycompetition/Judge.ArcheryCompetition")(api);
    require("./archerycompetition/Targets.ArcheryCompetition")(api);
  },
};

module.exports._test = require("./archerycompetition/Session.ArcheryCompetition")._test;
