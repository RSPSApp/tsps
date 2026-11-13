"use strict";

module.exports = {
  name: "GolemCrafting",
  description: "Shape and power sunstone golems at Wyrmscraig's plinths.",
  members: true,
  register(api) {
    require("./golemcrafting/Activity.GolemCrafting").attach(api);
  },
};
