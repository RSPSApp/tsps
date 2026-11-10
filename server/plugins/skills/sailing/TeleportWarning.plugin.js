"use strict";

// All Settings "Show warning when teleporting from your boat at sea" (471): with it on, a teleport
// spell cast aboard your own boat, which would leave the boat lost at sea, asks first. Nothing is
// used up until the player says yes. Ours: the question and its options, after live's Escape
// prompt (no capture of the teleport warning).
const WARNING_VARBIT = 16620;
const QUESTION = "Accept that your boat may be lost at sea?";
const YES = "Yes, teleport away.";
const NO = "No, stay on the boat.";

let api = null;

/**
 * "spell:teleport-confirm": wraps the cast's `proceed`, so the warning comes after any other
 * plugin's question (the Wilderness warning) whichever answers first.
 */
function confirmTeleport(request) {
  const { player } = request ?? {};
  if (!player || typeof request.proceed !== "function") return;
  if (player.getPacketSender().getVarbit?.(WARNING_VARBIT) !== 1 || !api.core.Sailing.instanceAboard(player)) return;
  const proceed = request.proceed;
  request.proceed = () => {
    // Asked again at the answer: the player may have left the boat meanwhile.
    if (!api.core.Sailing.instanceAboard(player)) return proceed();
    api.sendMultiChatboxPrompt(player, QUESTION, YES, () => proceed(), NO, () => {});
  };
}

module.exports = {
  name: "SailingTeleportWarning",
  description: "Warns before a teleport spell takes the player off their boat at sea, when its All Settings row is on.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent("spell:teleport-confirm", confirmTeleport);
  },
  WARNING_VARBIT, QUESTION, YES, NO, confirmTeleport,
};
