"use strict";

// OPT-IN PREPARATION. Progression and PvP remain closed; see the preparation document.
module.exports = {
  name: "DeadmanMode",
  description: "Unfinished permanent Deadman character entry and protection preparation. XP and PvP are disabled.",
  members: true,
  config: {
    "DeadmanMode:enabled": {
      type: "boolean", label: "Deadman source preparation", default: false,
      help: "Unfinished isolated character preparation. Blocks all XP and PvP; not a playable Deadman world. Restart to change.",
    },
  },
  register(api) {
    require("./deadman/Preparation.DeadmanMode")(api);
  },
};
