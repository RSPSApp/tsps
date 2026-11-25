"use strict";

/**
 * Zulrah: the sacrificial boat from Zul-Andra, the fight at its shrine and what it leaves
 * behind. Each unit lives in ./zulrah/; add one line per unit.
 */
const Shared = require("./zulrah/Shared.Zulrah");

function describeEncounters({ npcIds }) {
  for (const id of Shared.FORM_IDS) npcIds.add(id);
}

module.exports = {
  name: "Zulrah",
  description: "Zulrah: the sacrificial boat from Zul-Andra, the fight at its shrine and what it leaves behind.",
  members: true,
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    require("./zulrah/Access.Zulrah").attach(api);
    require("./zulrah/Shrine.Zulrah")(api);
    require("./zulrah/Commands.Zulrah")(api);
    require("./zulrah/CombatAchievements.Zulrah")(api);
    require("./zulrah/Resurrection.Zulrah")(api);
  },
};
