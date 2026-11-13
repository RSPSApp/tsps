"use strict";

const Entrance = require("./maggotking/Entrance.MaggotKing");
const Recovery = require("./maggotking/Recovery.MaggotKing");
const Fight = require("./maggotking/Fight.MaggotKing");

/** The solo Maggot King lair, entered through Vampyrium's darkwood trees after The Blood Moon Rises. */
module.exports = {
  name: "MaggotKing",
  description: "The solo Maggot King lair, entered through Vampyrium's darkwood trees after The Blood Moon Rises.",
  members: true,
  register(api) {
    Recovery.attach(api);
    Entrance.attach(api);
    Fight.attach(api);
  },
};
