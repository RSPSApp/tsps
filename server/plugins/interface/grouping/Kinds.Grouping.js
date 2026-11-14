"use strict";

/**
 * Group Ironman groups (Wiki, Group Ironman Mode): a group formed by a Group Ironman is one for
 * good, only Group Ironmen can be in it, and a Group Ironman can be in no other kind. The mode is
 * the Ironman plugin's, asked with "ironman:mode".
 *
 * Also here, because they turn on the same question:
 * - "grouping:same-group" { player, other } -> same, ironman: whether two players (or a player and
 *   a login name, a ground item's owner) are in one group, for the Ironman plugin's exceptions.
 * - "ironman:change-mode": no change into or out of Group Ironman while in a group.
 * - "grouping:can-end" { groupId, group, player, allowed, reason }: content may keep a group from
 *   ending (group storage that still holds items does).
 * - "grouping:can-join" { player, inviter, groupId, group, stage, allowed, reason }: content may
 *   refuse an invitation (stage "invite": player is the invitee, inviter the leader) or a join
 *   (stage "join": inviter null), and say why (Group Ironman's own rules).
 * - "grouping:leaving-period" { groupId, group, period }: content may say a Group Ironman group's
 *   members leave at once, without the leaving period (a group still forming, not yet confirmed).
 */

const { accountName } = require("../FriendsChatManager");
const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");

/** The Ironman plugin's Group Ironman modes: Group, Hardcore Group and Unranked Group Ironman. */
const GROUP_IRONMAN_MODES = Object.freeze(["group", "group-hardcore", "group-unranked"]);
const CAN_END_EVENT = "grouping:can-end";
const CAN_JOIN_EVENT = "grouping:can-join";
const LEAVING_PERIOD_EVENT = "grouping:leaving-period";
const MESSAGE = Object.freeze({
  ONLY_IRONMEN: "Only Group Ironmen can join a Group Ironman group.",
  IRONMAN_ELSEWHERE: "A Group Ironman can only join a Group Ironman group.",
  MODE_LOCKED: "Leave your group first.",
  CANNOT_END: "Your group can't end right now.",
  CANNOT_JOIN: "That player can't join your group right now.",
});

let api;

function init(pluginApi) {
  api = pluginApi;
}

function isGroupIronman(player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return GROUP_IRONMAN_MODES.includes(query.mode);
}

/** Why `player` can't be in a group of this kind (`ironman` true for Group Ironman), or null. */
function refusal(ironman, player) {
  const theirs = isGroupIronman(player);
  if (theirs === (ironman === true)) return null;
  return ironman ? MESSAGE.ONLY_IRONMEN : MESSAGE.IRONMAN_ELSEWHERE;
}

/** Why content won't let this group end now, or null when it may. */
function endRefusal(group, player = null) {
  const request = { groupId: group.id, group: Members.snapshot(group), player, allowed: true, reason: null };
  api.emitCustomEvent(CAN_END_EVENT, request);
  return request.allowed === false ? request.reason || MESSAGE.CANNOT_END : null;
}

/** Why content refuses `player` joining `group` (null: none yet) at `stage`, or null when it may. */
function joinRefusal(group, player, inviter, stage) {
  const request = {
    player, inviter, groupId: group?.id ?? 0, group: Members.snapshot(group), stage, allowed: true, reason: null,
  };
  api.emitCustomEvent(CAN_JOIN_EVENT, request);
  return request.allowed === false ? request.reason || MESSAGE.CANNOT_JOIN : null;
}

/** Whether this group's members leave with a leaving period: Group Ironman groups, unless content says not yet. */
function hasLeavingPeriod(group) {
  if (!group?.ironman) return false;
  const request = { groupId: group.id, group: Members.snapshot(group), period: true };
  api.emitCustomEvent(LEAVING_PERIOD_EVENT, request);
  return request.period !== false;
}

function accountOf(other) {
  if (typeof other === "string") return accountName(other)?.encoded;
  return Members.identify(other)?.account;
}

/** "grouping:same-group" { player, other }: sets same (one group, both members) and ironman. */
function answerSameGroup(request) {
  request.same = false;
  request.ironman = false;
  const me = Members.identify(request.player);
  const other = accountOf(request.other);
  const group = me && other != null ? Store.groupOf(me.profile, me.account) : undefined;
  if (!group || !group.members.has(other)) return;
  request.same = true;
  request.ironman = group.ironman === true;
}

/** "ironman:change-mode": into or out of the Group Ironman modes only outside a group. */
function vetoModeChange(change) {
  if (GROUP_IRONMAN_MODES.includes(change.from) === GROUP_IRONMAN_MODES.includes(change.to)) return;
  const me = Members.identify(change.player);
  if (!me || !Store.groupOf(me.profile, me.account)) return;
  change.allowed = false;
  change.reason = MESSAGE.MODE_LOCKED;
}

module.exports = {
  GROUP_IRONMAN_MODES, CAN_END_EVENT, CAN_JOIN_EVENT, LEAVING_PERIOD_EVENT, MESSAGE,
  init, isGroupIronman, refusal, endRefusal, joinRefusal, hasLeavingPeriod, answerSameGroup, vetoModeChange,
};
