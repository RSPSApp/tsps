"use strict";

/**
 * The group settings (gim_settings, 730), opened by the Group Ironman tab's Settings button. Its
 * scripts draw the group from the clan settings the tab already sends (Tab.GroupIronman); the
 * Leave Group button reads gim_pending_leave.
 *
 * - Group Storage: the storage unlocks (Unlocks.GroupIronman), in the settings' popup slot.
 * - Leave Group / Cancel Leave: as ::group leave and ::group stay.
 * - The group's name (the leader): asks for the new one, as Tony's "Rename group.".
 * - Hiscores, Options, Raffle, the leader's step-down and members rows: not on this world; the
 *   message says where to go instead (ours).
 */

const Common = require("./Common.GroupIronman");
const Unlocks = require("./Unlocks.GroupIronman");

const MESSAGE = Object.freeze({
  NOT_AVAILABLE: "That isn't available on this world.",
  STEP_DOWN: "To step down, use ::group promote <name> (it takes 7 days), or talk to the Group Ironman tutor on The Node.",
  MEMBERS: "To remove a member, use ::group kick <name>.",
  RENAME_PROMPT: "Enter your group's new name:",
});

const defs = () => Common.api.core.CacheDefinitions;
const uid = (name) => defs().getComponentId(name);
const group = () => defs().getInterfaceId("gim_settings");

/** The tab's Settings button: the group settings, with the leave state its button shows. */
function open(player) {
  const { member } = Common.groupOf(player);
  player.getPacketSender().sendVarbit(defs().getVarbitId("gim_pending_leave"), member?.leaving ? 1 : 0);
  player.getPacketSender().sendInterface(group());
}

function leaveOrStay(player) {
  const { member } = Common.groupOf(player);
  Common.api.emitCustomEvent(member?.leaving ? "grouping:stay" : "grouping:leave", { player });
  const now = Common.groupOf(player).member;
  player.getPacketSender().sendVarbit(defs().getVarbitId("gim_pending_leave"), now?.leaving ? 1 : 0);
}

function rename(player) {
  if (Common.groupOf(player).member?.role !== "leader") {
    player.getPacketSender().sendMessage("Only the group leader can do that.");
    return;
  }
  player.setEnteredSyntaxAction({ execute: (name) => Common.api.emitCustomEvent("grouping:rename", { player, name }) });
  player.getPacketSender().sendEnterInputPrompt(MESSAGE.RENAME_PROMPT);
}

/** onInterfaceActionClick on gim_settings. */
function click(event) {
  const { player, buttonId } = event;
  if (buttonId >>> 16 !== group()) return;
  event.handled = true;
  const sender = player.getPacketSender();
  switch (buttonId) {
    case uid("gim_settings:close"): sender.sendInterfaceRemoval(); break;
    case uid("gim_settings:storage_unlocks"): Unlocks.fromSettings(player); break;
    case uid("gim_settings:quit"): leaveOrStay(player); break;
    case uid("gim_settings:name"): rename(player); break;
    case uid("gim_settings:abdication"): sender.sendMessage(MESSAGE.STEP_DOWN); break;
    case uid("gim_settings:members"): sender.sendMessage(MESSAGE.MEMBERS); break;
    case uid("gim_settings:hiscores"): case uid("gim_settings:options"): case uid("gim_settings:raffle"):
      sender.sendMessage(MESSAGE.NOT_AVAILABLE);
      break;
    default:
  }
}

module.exports = { MESSAGE, open, click };
