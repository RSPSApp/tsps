"use strict";

/**
 * Leaving a Group Ironman group (Wiki, Group Ironman Mode: Leaving a group). A member who leaves
 * has seven days to change their mind; one the leader removes has seven days to settle their
 * affairs. Until then they stay listed as leaving: they still count as the group's for trading
 * and can deposit into its storage but not withdraw (group storage reads `leaving`), can't join
 * another group, and can't lead. After the seven days they are out.
 *
 * - A leaving leader hands the lead on at once, to the longest-serving member who isn't leaving;
 *   with nobody else to take it they lead on until they go.
 * - The last member who isn't leaving may only start leaving if content lets the group end
 *   ("grouping:can-end": group storage that still holds items doesn't). The group ends when its
 *   last member's seven days are over (Wiki: a group with no members left is disbanded).
 * - `::group stay` takes back a leave; a removed member can't stay (the leader can take a removal
 *   back: Leadership.unkick).
 * - Each member who goes is reported as "left" or "kicked", so content can follow up (the Group
 *   Ironman plugin asks them what they become).
 * Other groups leave and kick at once (Actions), and so does a Group Ironman group that content
 * says has no leaving period yet ("grouping:leaving-period": one still forming).
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Actions = require("./Actions.Grouping");
const Kinds = require("./Kinds.Grouping");

const LEAVING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEAVING_MS = LEAVING_DAYS * DAY_MS;

const MESSAGE = Object.freeze({
  LEAVING: `You are leaving the group. For ${LEAVING_DAYS} days you can still trade with it and deposit into its storage, but not withdraw. Use ::group stay to change your mind.`,
  KICKED: `You have been removed from the group. You have ${LEAVING_DAYS} days to settle your affairs with it: you can still trade with it and deposit into its storage, but not withdraw.`,
  ALREADY_LEAVING: "You are already leaving the group. Use ::group stay to change your mind.",
  TARGET_LEAVING: "That player is already leaving the group.",
  NOT_LEAVING: "You aren't leaving your group.",
  CANNOT_STAY: "You were removed from the group, so you can't stay.",
  STAYING: "You are staying in the group.",
  LEFT: "You have left the group.",
});

/** Whole days (at least one) from `now` until `until`. */
function daysUntil(until, now = Date.now()) {
  return Math.max(1, Math.ceil((until - now) / DAY_MS));
}

function daysLeft(group, account, now = Date.now()) {
  return daysUntil(group.leaving.get(account)?.until ?? now, now);
}

function begin(group, account, kicked, now) {
  Store.setLeaving(group, account, now + LEAVING_MS, kicked);
  if (group.leader === account) Actions.handOver(group, true) ?? Actions.handOver(group, false);
}

/** ::group leave: a Group Ironman group keeps the leaver for LEAVING_DAYS; any other leaves at once. */
function leave(player, now = Date.now()) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!Kinds.hasLeavingPeriod(group)) return Actions.leave(player);
  if (Members.isLeaving(group, me.account)) return Actions.tell(player, MESSAGE.ALREADY_LEAVING);
  if (Members.staying(group).length === 1) {
    const kept = Kinds.endRefusal(group, player);
    if (kept !== null) return Actions.tell(player, kept);
  }
  begin(group, me.account, false, now);
  Actions.tell(player, MESSAGE.LEAVING);
  Actions.tellGroup(group, `${Members.nameOf(me.account)} is leaving the group.`, me.account);
  Actions.changed("leaving", group, me.account, me.account);
  return true;
}

/** ::group kick: in a Group Ironman group the member is leaving, removed, for LEAVING_DAYS. */
function kick(player, account, now = Date.now()) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!Kinds.hasLeavingPeriod(group) || group.leader !== me.account || account === me.account || !group.members.has(account)) {
    return Actions.kick(player, account);
  }
  if (Members.isLeaving(group, account)) return Actions.tell(player, MESSAGE.TARGET_LEAVING);
  begin(group, account, true, now);
  Actions.tell(Members.onlinePlayer(group.profile, account), MESSAGE.KICKED);
  Actions.tellGroup(group, `${Members.nameOf(account)} has been removed from the group.`, account);
  Actions.changed("leaving", group, me.account, account);
  return true;
}

/** ::group stay: takes back a leave while its seven days last. */
function stay(player) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  const entry = group?.leaving.get(me.account);
  if (!entry) return Actions.tell(player, group ? MESSAGE.NOT_LEAVING : Actions.MESSAGE.NOT_IN_GROUP);
  if (entry.kicked) return Actions.tell(player, MESSAGE.CANNOT_STAY);
  Store.clearLeaving(group, me.account);
  Actions.tell(player, MESSAGE.STAYING);
  Actions.tellGroup(group, `${Members.nameOf(me.account)} is staying in the group.`, me.account);
  Actions.changed("stayed", group, me.account, me.account);
  return true;
}

/** The member's seven days are over: they are out, and a group left with nobody ends. */
function finish(group, account, kicked) {
  const type = kicked ? "kicked" : "left";
  Actions.tell(Members.onlinePlayer(group.profile, account), kicked ? Actions.MESSAGE.KICKED : MESSAGE.LEFT);
  if (group.members.size === 1) {
    Actions.changed(type, group, account, account);
    Actions.dissolve(group, account);
    return;
  }
  if (group.leader === account) {
    Actions.handOver(group, false) ?? Store.setLeader(group, Store.byTenure(group)[0]);
  }
  Store.removeMember(group, account);
  Actions.tellGroup(group, `${Members.nameOf(account)} has left the group.`);
  Actions.changed(type, group, account, account);
}

/** Ends every leaving period that has run out. */
function settle(now = Date.now()) {
  for (const group of [...Store.all()]) {
    for (const [account, { until, kicked }] of [...group.leaving]) {
      if (until > now || !Store.byId(group.id)) continue;
      finish(group, account, kicked);
    }
  }
}

module.exports = { LEAVING_DAYS, LEAVING_MS, MESSAGE, daysUntil, daysLeft, leave, kick, stay, settle };
