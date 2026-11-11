"use strict";

// All Settings "Show warning when teleporting from your boat at sea" (471): with it on, a teleport
// cast or used aboard your own boat, which would leave the boat lost at sea, asks first: spells,
// tablets and scrolls, jewellery and the other teleport items. Nothing is used up until the player
// says yes. Ours: the question and its options, after live's Escape prompt (no capture of the
// teleport warning).
/** Varbit 16620 `sailing_warning_teleportoffboat`: the row is ticked while it is 0 (struct param 1084), which warns. */
const WARNING_VARBIT = 16620;
const QUESTION = "Accept that your boat may be lost at sea?";
const YES = "Yes, teleport away.";
const NO = "No, stay on the boat.";

let api = null;

/** The row ticked: varbit 0, the default, so a new account is warned. */
function warns(player) {
  return player.getPacketSender().getVarbit?.(WARNING_VARBIT) !== 1;
}

/**
 * "spell:teleport-confirm" (spells) and "teleport:confirm" (TeleportHandler.confirm: items and
 * the other spells): wraps the request's `proceed`, so the warning comes after any other plugin's
 * question (the Wilderness warning) whichever answers first. A yes runs the request's `recheck`
 * first when it has one (the teleport rules again: the player may have moved on meanwhile); a
 * no, or a failed recheck, runs its `refused`.
 */
function confirmTeleport(request) {
  const { player } = request ?? {};
  if (!player || typeof request.proceed !== "function") return;
  if (!warns(player) || !api.core.Sailing.instanceAboard(player)) return;
  const proceed = request.proceed;
  const recheck = typeof request.recheck === "function" ? request.recheck : () => true;
  const refused = () => request.refused?.();
  request.proceed = () => {
    // Asked again at the answer: the player may have left the boat meanwhile.
    if (!api.core.Sailing.instanceAboard(player)) return proceed();
    api.sendMultiChatboxPrompt(player, QUESTION, YES, () => (recheck() ? proceed() : refused()), NO, refused);
  };
}

module.exports = {
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent("spell:teleport-confirm", confirmTeleport);
    api.onCustomEvent("teleport:confirm", confirmTeleport);
  },
  WARNING_VARBIT, QUESTION, YES, NO, confirmTeleport, warns,
};
