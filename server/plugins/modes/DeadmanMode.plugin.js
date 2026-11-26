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
    // Transcripts guard Deadman-only lines with the world type (Brugsen Bursen's respawn talk): answered on
    // every world, from this world's setting.
    const deadman = api.getPluginConfig("DeadmanMode:enabled", false) === true;
    api.onNpcDialogueCondition(({ text }) => {
      const value = String(text ?? "").trim().replace(/:$/, "").toLowerCase();
      if (value === "if the player is on a deadman mode world") return deadman;
      if (value === "if the player is not on a deadman mode world") return !deadman;
      return null;
    });
    require("./deadman/Preparation.DeadmanMode")(api);
  },
};
