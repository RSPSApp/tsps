"use strict";

// All Settings "Show warning when teleporting from your boat at sea" (471): with it on, a teleport
// cast or used aboard your own boat, which would leave the boat lost at sea, asks first: spells,
// tablets and scrolls, jewellery and the other teleport items. Nothing is used up until the player
// says yes. As live: the message box (also a mesbox chat line, cut short as live sends it), then
// the question and its options. Ours: "Yes, teleport away and don't ask this again." unticks the
// row (no recording picks it).
/** Varbit 16620 `sailing_warning_teleportoffboat`: the row is ticked while it is 0 (struct param 1084), which warns. */
const WARNING_VARBIT = 16620;
const SETTING = 471;
const TEXT = "Leaving your boat while out at sea will result in it being <col=7f0000>lost</col>. If this happens, retrieving it will <col=7f0000>incur a gold fee</col> and any <col=7f0000>fish, salvage, <col=7f0000";
const TEXT_BOX = "Leaving your boat while out at sea will result in it being <col=7f0000>lost</col>. If this<br>"
  + "happens, retrieving it will <col=7f0000>incur a gold fee</col> and any <col=7f0000>fish, salvage,<br>"
  + "<col=7f0000>crates or bounty parts</col> on board will be <col=7f0000>lost</col>.";
const QUESTION = "Accept that your boat will be lost at sea?";
const YES = "Yes, teleport away from it.";
const YES_DONT_ASK = "Yes, teleport away and don't ask this again.";
const NO = "No, stay on the boat.";

let api = null;

/** The row ticked: varbit 0, the default, so a new account is warned. */
function warns(player) {
  return player.getPacketSender().getVarbit?.(WARNING_VARBIT) !== 1;
}

/** The message box; its continue asks the question. */
function ask(player, answer) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue, ChatType } = api.core;
  player.getPacketSender().sendTypedMessage(ChatType.MESBOX, TEXT);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, TEXT_BOX))
    .add(new ActionDialogue(1, { execute: () => api.sendMultiChatboxPrompt(player, QUESTION, ...answer) })));
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
  const go = () => (recheck() ? proceed() : refused());
  request.proceed = () => {
    // Asked again at the answer: the player may have left the boat meanwhile.
    if (!api.core.Sailing.instanceAboard(player)) return proceed();
    ask(player, [
      YES, go,
      YES_DONT_ASK, () => {
        api.emitCustomEvent("settings:set", { player, settingId: SETTING, value: 1 });
        go();
      },
      NO, refused,
    ]);
  };
}

module.exports = {
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent("spell:teleport-confirm", confirmTeleport);
    api.onCustomEvent("teleport:confirm", confirmTeleport);
  },
  WARNING_VARBIT, SETTING, TEXT, TEXT_BOX, QUESTION, YES, YES_DONT_ASK, NO, confirmTeleport, warns,
};
