"use strict";

/**
 * Who leads a Group Ironman group (Wiki, Group Ironman Mode: Leadership; Tony's transcript).
 *
 * - Stepping down takes 7 days, against hijacking: the leader names a successor (::group promote
 *   <name>, a member who isn't leaving), and ::group cancel calls it off. When the 7 days end the
 *   successor leads, if they are still a member who isn't leaving.
 * - An inactive leader: after 30 days away the lead goes to the longest-serving member who isn't
 *   leaving (the earlier joiner on a tie). The old leader stays, as a member.
 * - A leader's logout hands nothing on: Lifecycle's one-minute grace is for other groups.
 * - A removal can be taken back by the leader during its 7 days (::group unkick <name>).
 * Other groups promote at once (Actions.promote).
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Actions = require("./Actions.Grouping");
const Kinds = require("./Kinds.Grouping");

const DAY_MS = 24 * 60 * 60 * 1000;
const STEP_DOWN_DAYS = 7;
const STEP_DOWN_MS = STEP_DOWN_DAYS * DAY_MS;
const INACTIVE_DAYS = 30;
const INACTIVE_MS = INACTIVE_DAYS * DAY_MS;

const MESSAGE = Object.freeze({
  NOT_STEPPING_DOWN: "You aren't stepping down.",
  STEP_DOWN_CANCELLED: "You are no longer stepping down.",
  NOT_REMOVING: "That player isn't being removed from the group.",
  UNKICKED: "You are no longer being removed from the group.",
  NO_DISBAND: "A Group Ironman group can't be disbanded. It ends when its last member leaves.",
});

/** The actor's Group Ironman group, when they lead it; otherwise null after saying why. */
function ledIronGroup(player, me) {
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group) return void Actions.tell(player, Actions.MESSAGE.NOT_IN_GROUP);
  if (group.leader !== me.account) return void Actions.tell(player, Actions.MESSAGE.LEADER_ONLY);
  return group;
}

/** ::group promote: in a Group Ironman group, the lead passes to `account` in 7 days. */
function promote(player, account, now = Date.now()) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!Kinds.hasLeavingPeriod(group)) return Actions.promote(player, account);
  if (!ledIronGroup(player, me)) return false;
  if (account === me.account) return Actions.tell(player, Actions.MESSAGE.PROMOTE_SELF);
  if (!group.members.has(account)) return Actions.tell(player, Actions.MESSAGE.NOT_A_MEMBER);
  const name = Members.nameOf(account);
  if (Members.isLeaving(group, account)) return Actions.tell(player, `${name} is leaving the group.`);
  Store.setStepDown(group, { successor: account, until: now + STEP_DOWN_MS });
  Actions.tell(player, `${name} will lead the group in ${STEP_DOWN_DAYS} days. Use ::group cancel to stay the leader.`);
  Actions.tellGroup(group, `${Members.nameOf(me.account)} is stepping down: ${name} will lead the group in ${STEP_DOWN_DAYS} days.`, me.account);
  Actions.changed("stepping-down", group, me.account, account);
  return true;
}

/** ::group cancel: the leader stays the leader. */
function cancel(player) {
  const me = Members.identify(player);
  const group = ledIronGroup(player, me);
  if (!group) return false;
  if (!group.stepDown) return Actions.tell(player, MESSAGE.NOT_STEPPING_DOWN);
  const successor = group.stepDown.successor;
  Store.setStepDown(group, null);
  Actions.tell(player, MESSAGE.STEP_DOWN_CANCELLED);
  Actions.tellGroup(group, `${Members.nameOf(me.account)} is staying the group leader.`, me.account);
  Actions.changed("step-down-cancelled", group, me.account, successor);
  return true;
}

/** ::group unkick: the leader takes back a removal during its 7 days. */
function unkick(player, account) {
  const me = Members.identify(player);
  const group = ledIronGroup(player, me);
  if (!group) return false;
  if (group.leaving.get(account)?.kicked !== true) return Actions.tell(player, MESSAGE.NOT_REMOVING);
  Store.clearLeaving(group, account);
  const name = Members.nameOf(account);
  Actions.tell(player, `${name} is no longer being removed from the group.`);
  Actions.tell(Members.onlinePlayer(group.profile, account), MESSAGE.UNKICKED);
  for (const other of group.members) {
    if (other !== me.account && other !== account) Actions.tell(Members.onlinePlayer(group.profile, other), `${name} is staying in the group.`);
  }
  Actions.changed("stayed", group, me.account, account);
  return true;
}

/** ::group disband: not for a Group Ironman group past forming, which ends when its last member leaves. */
function disband(player) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (Kinds.hasLeavingPeriod(group)) return Actions.tell(player, MESSAGE.NO_DISBAND);
  return Actions.disband(player);
}

function handTo(group, successor) {
  const before = group.leader;
  Store.setLeader(group, successor);
  Actions.tellGroup(group, `${Members.nameOf(successor)} is now the group leader.`);
  Actions.changed("promoted", group, before, successor);
}

/** Ends hand-overs that are due and replaces leaders inactive for INACTIVE_DAYS. */
function settle(now = Date.now()) {
  for (const group of [...Store.all()]) {
    if (!group.ironman) continue;
    const stepDown = group.stepDown;
    if (stepDown && stepDown.until <= now) {
      const fit = group.members.has(stepDown.successor) && !Members.isLeaving(group, stepDown.successor);
      if (fit) handTo(group, stepDown.successor);
      else Store.setStepDown(group, null);
      continue;
    }
    const leader = group.leader;
    const seen = group.seen.get(leader) ?? group.joined.get(leader) ?? now;
    if (Store.isPresent(group.profile, leader) || now - seen < INACTIVE_MS) continue;
    const successor = Store.byTenure(group).find((account) => !Members.isLeaving(group, account));
    if (successor !== undefined) handTo(group, successor);
  }
}

module.exports = {
  STEP_DOWN_DAYS, STEP_DOWN_MS, INACTIVE_DAYS, INACTIVE_MS, MESSAGE,
  promote, cancel, unkick, disband, settle,
};
