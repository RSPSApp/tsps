"use strict";

/**
 * The group settings (gim_settings, 730), opened by the Group Ironman tab's Settings button. Its
 * scripts draw the group's name and icons from the clan settings the tab sends (Tab.GroupIronman);
 * its rows are the server's: cs 5508 (gim_settings_static) the box at the top, then cs 5509
 * (gim_settings_editable) one row each for the name, the leader and the members, as
 * "Label|value|button" (the button only where the player may act; the last row draws Close).
 *
 * - Name (the leader): asks for the new one, as Tony's "Rename group.".
 * - Leader (the leader): Step down picks who leads next, in 7 days once formed; while that runs,
 *   Cancel keeps the lead.
 * - Members (the leader): pick a member, then remove them (7 days once formed), or keep one being
 *   removed.
 * - Group Storage: the storage unlocks (Unlocks.GroupIronman), in the settings' popup slot.
 * - Leave Group / Cancel Leave (gim_pending_leave).
 * - Hiscores, Options, Raffle: not on this world (ours).
 * All of it goes through Grouping's events; none of it needs a command.
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");
const Unlocks = require("./Unlocks.GroupIronman");

const STATIC_SCRIPT = 5508; // gim_settings_static
const ROW_SCRIPT = 5509; // gim_settings_editable
const MORE_ROWS = -1;
const LAST_ROW = 0;
const MESSAGE = Object.freeze({
  NOT_AVAILABLE: "That isn't available on this world.",
  NOT_LEADER: "Only the group leader can do that.",
  NO_SUCCESSOR: "Nobody else in the group can lead it yet.",
  NO_MEMBERS: "There is nobody else in your group.",
  RENAME_PROMPT: "Enter your group's new name:",
  WHO_LEADS: "Who should lead the group?",
  WHICH_MEMBER: "Which member?",
  REMOVE: (name) => `Remove ${name} from the group?`,
  KEEP: (name) => `Keep ${name} in the group?`,
});

const defs = () => Common.api.core.CacheDefinitions;
const uid = (name) => defs().getComponentId(name);
const group = () => defs().getInterfaceId("gim_settings");

function isOpen(player) {
  return player.getInterfaceId?.() === group();
}

/** The rows, for this player (only a leader gets the buttons). */
function sendRows(player) {
  const { group: mine, member } = Common.groupOf(player);
  if (!mine?.ironman) return;
  const record = Store.get(mine.id);
  const leader = member?.role === "leader";
  const others = mine.members.length > 1;
  const label = Common.data.variants[record?.variant ?? "ranked"]?.label ?? "Group Ironman";
  const leaderName = mine.members.find((each) => each.role === "leader")?.name ?? "";
  const successor = mine.stepDown ? mine.members.find((each) => each.account === mine.stepDown.successor)?.name : null;
  const names = mine.members.map((each) => (each.leaving ? `${each.name} (leaving)` : each.name)).join(", ");
  const sender = player.getPacketSender();
  sender.sendClientScript(STATIC_SCRIPT, "Mode:", record?.formed ? label : `${label} (forming)`);
  sender.sendClientScript(ROW_SCRIPT, uid("gim_settings:name"), leader ? 1 : 0, MORE_ROWS, `Name:|${mine.name || "Group"}|Change`);
  sender.sendClientScript(ROW_SCRIPT, uid("gim_settings:abdication"), leader && others ? 1 : 0, MORE_ROWS,
    successor ? `Leader:|${leaderName}, handing over to ${successor}|Cancel` : `Leader:|${leaderName}|Step down`);
  sender.sendClientScript(ROW_SCRIPT, uid("gim_settings:members"), leader && others ? 1 : 0, LAST_ROW, `Members:|${names}|Manage`);
}

/** The tab's Settings button: the group settings, with the leave state its button shows. */
function open(player) {
  const { member } = Common.groupOf(player);
  player.getPacketSender().sendVarbit(defs().getVarbitId("gim_pending_leave"), member?.leaving ? 1 : 0);
  player.getPacketSender().sendInterface(group());
  sendRows(player);
}

/** "grouping:changed": the rows again for everyone it touched who has the settings open. */
function changed(event) {
  for (const player of event.players ?? []) {
    if (!isOpen(player)) continue;
    const { member } = Common.groupOf(player);
    player.getPacketSender().sendVarbit(defs().getVarbitId("gim_pending_leave"), member?.leaving ? 1 : 0);
    sendRows(player);
  }
}

function emit(event, payload) {
  Common.api.emitCustomEvent(event, payload);
}

function leaveOrStay(player) {
  const { member } = Common.groupOf(player);
  emit(member?.leaving ? "grouping:stay" : "grouping:leave", { player });
  const now = Common.groupOf(player).member;
  player.getPacketSender().sendVarbit(defs().getVarbitId("gim_pending_leave"), now?.leaving ? 1 : 0);
}

/** The leader, or null after telling anyone else why not. */
function asLeader(player) {
  const found = Common.groupOf(player);
  if (found.member?.role === "leader") return found;
  player.getPacketSender().sendMessage(MESSAGE.NOT_LEADER);
  return null;
}

function rename(player) {
  if (!asLeader(player)) return;
  player.setEnteredSyntaxAction({ execute: (name) => emit("grouping:rename", { player, name }) });
  player.getPacketSender().sendEnterInputPrompt(MESSAGE.RENAME_PROMPT);
}

/** Step down: who leads next (members not leaving); while a hand-over runs, Cancel. */
function stepDown(player) {
  const found = asLeader(player);
  if (!found) return;
  if (found.group.stepDown) return emit("grouping:cancel-step-down", { player });
  const candidates = found.group.members.filter((each) => each.account !== found.account && !each.leaving).slice(0, 4);
  if (!candidates.length) return void player.getPacketSender().sendMessage(MESSAGE.NO_SUCCESSOR);
  const options = candidates.flatMap((each) => [each.name, () => emit("grouping:promote", { player, target: each.name })]);
  Common.api.sendMultiChatboxPrompt(player, MESSAGE.WHO_LEADS, ...options);
}

/** Members: pick one, then remove them, or keep one whose removal runs. */
function manageMembers(player) {
  const found = asLeader(player);
  if (!found) return;
  const others = found.group.members.filter((each) => each.account !== found.account).slice(0, 4);
  if (!others.length) return void player.getPacketSender().sendMessage(MESSAGE.NO_MEMBERS);
  const choose = (each) => (each.kicked
    ? Common.api.sendMultiChatboxPrompt(player, MESSAGE.KEEP(each.name),
      "Yes, keep them.", () => emit("grouping:unkick", { player, target: each.name }), "No.", () => {})
    : Common.api.sendMultiChatboxPrompt(player, MESSAGE.REMOVE(each.name),
      "Yes, remove them.", () => emit("grouping:kick", { player, target: each.name }), "No.", () => {}));
  Common.api.sendMultiChatboxPrompt(player, MESSAGE.WHICH_MEMBER, ...others.flatMap((each) => [each.name, () => choose(each)]));
}

/** onInterfaceActionClick on gim_settings. */
function click(event) {
  const { player, buttonId } = event;
  if (buttonId >>> 16 !== group()) return;
  event.handled = true;
  switch (buttonId) {
    case uid("gim_settings:close"): player.getPacketSender().sendInterfaceRemoval(); break;
    case uid("gim_settings:storage_unlocks"): Unlocks.fromSettings(player); break;
    case uid("gim_settings:quit"): leaveOrStay(player); break;
    case uid("gim_settings:name"): rename(player); break;
    case uid("gim_settings:abdication"): stepDown(player); break;
    case uid("gim_settings:members"): manageMembers(player); break;
    case uid("gim_settings:hiscores"): case uid("gim_settings:options"): case uid("gim_settings:raffle"):
      player.getPacketSender().sendMessage(MESSAGE.NOT_AVAILABLE);
      break;
    default:
  }
}

module.exports = { MESSAGE, open, sendRows, changed, click, rename, stepDown, manageMembers };
