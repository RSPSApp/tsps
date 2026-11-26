"use strict";

const Common = require("./maggotking/Common.MaggotKing");
const Entrance = require("./maggotking/Entrance.MaggotKing");
const Recovery = require("./maggotking/Recovery.MaggotKing");
const Fight = require("./maggotking/Fight.MaggotKing");
const Eggs = require("./maggotking/Eggs.MaggotKing");
const Resupply = require("./maggotking/Resupply.MaggotKing");
const Rewards = require("./maggotking/Rewards.MaggotKing");

function describeEncounters({ npcIds }) {
  npcIds.add(Common.core().NpcIdentifiers.MAGGOT_KING);
}

/** The solo Maggot King lair, entered through Vampyrium's darkwood trees after The Blood Moon Rises. */
module.exports = {
  name: "MaggotKing",
  description: "The solo Maggot King lair, entered through Vampyrium's darkwood trees after The Blood Moon Rises.",
  members: true,
  register(api) {
    Recovery.attach(api);
    Entrance.attach(api);
    Fight.attach(api);
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    Eggs.attach(api);
    Resupply.attach(api);
    Rewards.attach(api);
  },
};
