"use strict";

/**
 * Transcripts guard Deadman-only lines with the world type ("If the player is on a Deadman Mode world:",
 * Brugsen Bursen's respawn talk): answered on every world, from this world's setting.
 */
let deadmanWorld = false;

function worldTypeCondition({ text }) {
  const value = String(text ?? "").trim().replace(/:$/, "").toLowerCase();
  if (value === "if the player is on a deadman mode world") return deadmanWorld;
  if (value === "if the player is not on a deadman mode world") return !deadmanWorld;
  return null;
}

module.exports = function attach(api) {
  deadmanWorld = api.getPluginConfig("DeadmanMode:enabled", false) === true;
  api.onNpcDialogueCondition(worldTypeCondition);
};
