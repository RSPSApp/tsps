"use strict";

/** The solo Maggot King lair, entered through Vampyrium's darkwood trees after The Blood Moon Rises. */
module.exports = {
  name: "MaggotKing",
  members: true,
  register(api) {
    const Entrance = require("./maggotking/Entrance.MaggotKing");
    Entrance.attach(api);
  },
};
