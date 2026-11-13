"use strict";

/**
 * What players do with a group: form, invite, accept, decline, withdraw an invitation, promote,
 * kick, leave and disband. Every action checks the actor's role and the other player against the
 * store as it is now, never against what the client showed or an older invitation said. A change
 * is saved, each member's group and role are copied into their saved attributes, and
 * "grouping:changed" goes out for co-op content and the panel.
 *
 * The cap is checked in the same step that adds a member, so of two players accepting the last
 * place one joins and the other is told the group is full.
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Kinds = require("./Kinds.Grouping");

const { MEMBER_CAP, ROLE } = Members;
const GROUP_ATTRIBUTE = "grouping:group";
const ROLE_ATTRIBUTE = "grouping:role";
const CHANGED_EVENT = "grouping:changed";
/** The Wiki gives invitations no lifetime; here one lapses after two minutes, or at a logout. */
const INVITE_EXPIRY_MS = 2 * 60 * 1000;
/** Trading's wait between trade requests (Trading.ts request_delay), on the same SecondsTimer. */
const INVITE_DELAY_SECONDS = 2;

const MESSAGE = Object.freeze({
  NOT_IN_GROUP: "You aren't in a group.",
  ALREADY_IN_GROUP: "You are already in a group.",
  LEAVE_FIRST: "You must leave your group before joining another.",
  LEADER_ONLY: "Only the group leader can do that.",
  // The same words for a player who is offline, hidden by their private chat setting or ignoring
  // the inviter, so a refusal never tells which.
  CANNOT_INVITE: "That player can't be invited right now.",
  INVITE_SELF: "You can't invite yourself.",
  INVITE_IGNORED: "You can't invite a player on your ignore list.",
  GROUP_FULL: "Your group is full.",
  TARGET_FULL: "That group is full.",
  NO_INVITATION: "You don't have an invitation from that group.",
  INVITATION_VOID: "That invitation is no longer valid.",
  NOT_A_MEMBER: "That player isn't in your group.",
  KICK_SELF: "You can't remove yourself. Leave the group instead.",
  PROMOTE_SELF: "You are already the group leader.",
  CREATED: "You have formed a group. Invite players from the Find tab of ::group, or with ::group invite <name>.",
  // A Group Ironman group is run from the Group Ironman tab and The Node (GroupIronman.plugin.js).
  CREATED_IRONMAN: "You have created a group. Invite players with Apply, or with Invite in the Group Ironman tab.",
  LEFT: "You have left the group.",
  KICKED: "You have been removed from the group.",
  DISBANDED: "The group has been disbanded.",
});

let api;
const inviteTimers = new WeakMap();

function init(pluginApi) {
  api = pluginApi;
}

function tell(player, text) {
  player?.getPacketSender().sendMessage(text);
  return false;
}

/** Tells every member who is logged in, except `except`. */
function tellGroup(group, text, except = null) {
  for (const account of group.members) {
    if (account !== except) tell(Members.onlinePlayer(group.profile, account), text);
  }
}

/** The saved copy of a player's group and role; the store stays the authority. */
function mirror(player, group, account) {
  if (!player) return;
  player.setAttribute(GROUP_ATTRIBUTE, group?.members.has(account) ? group.id : 0);
  player.setAttribute(ROLE_ATTRIBUTE, Members.roleOf(group, account));
}

/**
 * Mirrors everyone involved and emits "grouping:changed" { type, profile, groupId, group, actor,
 * target, players }: group is the snapshot after the change (before it, for "disbanded"), actor and
 * target are account names, and players is every logged-in player whose view of it changed.
 */
function changed(type, group, actor, target, others = [], profile = group.profile) {
  const accounts = new Set([...group.members, ...group.invites.keys(), ...others]);
  if (actor != null) accounts.add(actor);
  if (target != null) accounts.add(target);
  const players = [];
  for (const account of accounts) {
    const player = Members.onlinePlayer(profile, account);
    if (!player) continue;
    mirror(player, Store.groupOf(profile, account), account);
    players.push(player);
  }
  api.emitCustomEvent(CHANGED_EVENT, {
    type, profile, groupId: group.id, group: Members.snapshot(group), players,
    actor: actor == null ? null : Members.keyOf(actor), target: target == null ? null : Members.keyOf(target),
  });
}

function create(player, now = Date.now()) {
  const me = Members.identify(player);
  if (!me) return false;
  if (Store.groupOf(me.profile, me.account)) return tell(player, MESSAGE.ALREADY_IN_GROUP);
  const group = Store.create(me.profile, me.account, now, Kinds.isGroupIronman(player));
  tell(player, group.ironman ? MESSAGE.CREATED_IRONMAN : MESSAGE.CREATED);
  changed("created", group, me.account, null);
  return true;
}

function inviteTimer(player) {
  let timer = inviteTimers.get(player);
  if (!timer) inviteTimers.set(player, (timer = new api.core.SecondsTimer()));
  return timer;
}

/** The invitee, if the inviter may know of them: logged in, shown to them and not ignoring them. */
function reachable(inviter, me, account) {
  const target = Members.onlinePlayer(me.profile, account);
  const relations = target?.getRelations();
  if (!relations || !relations.isVisibleTo(inviter) || relations.hasIgnore(me.account)) return null;
  return target;
}

/** Alone in a group, or in none: free to take an invitation. */
const free = (group) => !group || group.members.size === 1;

function invite(player, account, now = Date.now()) {
  const me = Members.identify(player);
  if (!me || account == null) return tell(player, MESSAGE.CANNOT_INVITE);
  let group = Store.groupOf(me.profile, me.account);
  if (group && group.leader !== me.account) return tell(player, MESSAGE.LEADER_ONLY);
  if (account === me.account) return tell(player, MESSAGE.INVITE_SELF);
  if (player.getRelations().hasIgnore(account)) return tell(player, MESSAGE.INVITE_IGNORED);
  const timer = inviteTimer(player);
  if (!timer.finished()) {
    const seconds = Math.max(1, timer.secondsRemaining());
    return tell(player, `You must wait another ${seconds} ${seconds === 1 ? "second" : "seconds"} before sending more invitations.`);
  }
  timer.start(INVITE_DELAY_SECONDS);
  const target = reachable(player, me, account);
  if (!target) return tell(player, MESSAGE.CANNOT_INVITE);
  const name = Members.nameOf(account);
  if (group?.members.has(account)) return tell(player, `${name} is already in your group.`);
  const theirs = Store.groupOf(me.profile, account);
  // Crossed invitations: inviting someone whose group has invited you takes their invitation.
  if (theirs && free(group) && Store.invitationStands(theirs, me.account, now)) return join(player, me, theirs, now);
  if (!free(theirs)) return tell(player, `${name} is already in a group.`);
  const ironman = group ? group.ironman === true : Kinds.isGroupIronman(player);
  const unfit = Kinds.refusal(ironman, target) ?? Kinds.joinRefusal(group, target, player, "invite");
  if (unfit) return tell(player, unfit);
  if (group && group.members.size >= MEMBER_CAP) return tell(player, MESSAGE.GROUP_FULL);
  if (group && Store.invitationStands(group, account, now)) {
    group.invites.set(account, now + INVITE_EXPIRY_MS);
    return tell(player, `You have already invited ${name}.`);
  }
  if (!group) {
    group = Store.create(me.profile, me.account, now, ironman);
    changed("created", group, me.account, null);
  }
  group.invites.set(account, now + INVITE_EXPIRY_MS);
  tell(player, `You invite ${name} to join your group.`);
  // A Group Ironman's invitation is the chat line live sends, which content draws ("invited").
  if (!group.ironman) tell(target, `${Members.nameOf(me.account)} has invited you to join their group. Type ::group to answer.`);
  changed("invited", group, me.account, account);
  return true;
}

function accept(player, group, now = Date.now()) {
  const me = Members.identify(player);
  if (!me) return false;
  if (!group || group.profile !== me.profile || !Store.invitationStands(group, me.account, now)) {
    return tell(player, MESSAGE.NO_INVITATION);
  }
  return join(player, me, group, now);
}

/** Adds the player to the group they were invited to; the checks and the add are one step. */
function join(player, me, group, now) {
  const current = Store.groupOf(me.profile, me.account);
  if (current === group) {
    group.invites.delete(me.account);
    return tell(player, MESSAGE.ALREADY_IN_GROUP);
  }
  if (!free(current)) return tell(player, MESSAGE.LEAVE_FIRST);
  const unfit = Kinds.refusal(group.ironman, player) ?? Kinds.joinRefusal(group, player, null, "join");
  if (unfit) return tell(player, unfit);
  const leader = Members.onlinePlayer(group.profile, group.leader);
  // Either side ignoring the other since the invitation went out voids it.
  if (player.getRelations().hasIgnore(group.leader) || leader?.getRelations().hasIgnore(me.account)) {
    group.invites.delete(me.account);
    changed("invite-withdrawn", group, me.account, me.account);
    return tell(player, MESSAGE.INVITATION_VOID);
  }
  if (group.members.size >= MEMBER_CAP) {
    group.invites.delete(me.account);
    changed("invite-withdrawn", group, me.account, me.account);
    return tell(player, MESSAGE.TARGET_FULL);
  }
  const kept = current ? Kinds.endRefusal(current, player) : null;
  if (kept !== null) return tell(player, kept);
  if (current) dissolve(current, me.account);
  const withdrawn = Store.withdrawInvitations(me.profile, me.account).filter((other) => other !== group);
  Store.addMember(group, me.account, now);
  tell(player, `You have joined ${Members.nameOf(group.leader)}'s group.`);
  tellGroup(group, `${Members.nameOf(me.account)} has joined the group.`, me.account);
  for (const other of withdrawn) changed("invite-withdrawn", other, me.account, me.account);
  changed("joined", group, me.account, me.account);
  return true;
}

function decline(player, group) {
  const me = Members.identify(player);
  if (!me || !group || group.profile !== me.profile || !group.invites.delete(me.account)) {
    return tell(player, MESSAGE.NO_INVITATION);
  }
  tell(player, `You decline ${Members.nameOf(group.leader)}'s invitation.`);
  tell(Members.onlinePlayer(group.profile, group.leader), `${Members.nameOf(me.account)} has declined your invitation.`);
  changed("declined", group, me.account, me.account);
  return true;
}

/** The actor's group, when they lead it; otherwise tells them why not and answers undefined. */
function ledGroup(player, me) {
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group) return void tell(player, MESSAGE.NOT_IN_GROUP);
  if (group.leader !== me.account) return void tell(player, MESSAGE.LEADER_ONLY);
  return group;
}

function withdraw(player, account) {
  const me = Members.identify(player);
  const group = ledGroup(player, me);
  if (!group) return false;
  if (!group.invites.delete(account)) return tell(player, "You haven't invited that player.");
  tell(player, `You withdraw your invitation to ${Members.nameOf(account)}.`);
  changed("invite-withdrawn", group, me.account, account);
  return true;
}

function promote(player, account) {
  const me = Members.identify(player);
  const group = ledGroup(player, me);
  if (!group) return false;
  if (account === me.account) return tell(player, MESSAGE.PROMOTE_SELF);
  if (!group.members.has(account)) return tell(player, MESSAGE.NOT_A_MEMBER);
  const name = Members.nameOf(account);
  if (Members.isLeaving(group, account)) return tell(player, `${name} is leaving the group.`);
  if (!Members.onlinePlayer(group.profile, account)) return tell(player, `${name} must be online to lead the group.`);
  Store.setLeader(group, account);
  tellGroup(group, `${name} is now the group leader.`);
  changed("promoted", group, me.account, account);
  return true;
}

function kick(player, account) {
  const me = Members.identify(player);
  const group = ledGroup(player, me);
  if (!group) return false;
  if (account === me.account) return tell(player, MESSAGE.KICK_SELF);
  if (!group.members.has(account)) return tell(player, MESSAGE.NOT_A_MEMBER);
  Store.removeMember(group, account);
  tell(Members.onlinePlayer(group.profile, account), MESSAGE.KICKED);
  tellGroup(group, `${Members.nameOf(account)} has been removed from the group.`);
  changed("kicked", group, me.account, account);
  return true;
}

/**
 * Hands the lead to the longest-serving member who isn't leaving, one who is logged in when
 * `online`; null if none.
 */
function handOver(group, online) {
  const successor = Store.byTenure(group)
    .find((account) => !Members.isLeaving(group, account) && (!online || Store.isPresent(group.profile, account)));
  if (successor === undefined) return null;
  Store.setLeader(group, successor);
  tellGroup(group, `${Members.nameOf(successor)} is now the group leader.`);
  return successor;
}

function leave(player) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group) return tell(player, MESSAGE.NOT_IN_GROUP);
  if (group.members.size === 1) {
    const kept = Kinds.endRefusal(group, player);
    if (kept !== null) return tell(player, kept);
    tell(player, MESSAGE.LEFT);
    dissolve(group, me.account);
    return true;
  }
  tell(player, MESSAGE.LEFT);
  if (group.leader === me.account) handOver(group, true) ?? handOver(group, false);
  Store.removeMember(group, me.account);
  tellGroup(group, `${Members.nameOf(me.account)} has left the group.`);
  changed("left", group, me.account, me.account);
  return true;
}

/** Ends the group: its members leave and its invitations lapse. */
function dissolve(group, actor) {
  const before = { ...group, members: new Set(group.members), invites: new Map(group.invites) };
  group.invites.clear();
  Store.remove(group);
  changed("disbanded", before, actor, null);
}

function disband(player) {
  const me = Members.identify(player);
  const group = ledGroup(player, me);
  if (!group) return false;
  const kept = Kinds.endRefusal(group, player);
  if (kept !== null) return tell(player, kept);
  tellGroup(group, MESSAGE.DISBANDED);
  dissolve(group, me.account);
  return true;
}

module.exports = {
  GROUP_ATTRIBUTE, ROLE_ATTRIBUTE, CHANGED_EVENT, INVITE_EXPIRY_MS, INVITE_DELAY_SECONDS, MESSAGE, ROLE,
  init, tell, tellGroup, mirror, changed, handOver, dissolve,
  create, invite, accept, decline, withdraw, promote, kick, leave, disband,
};
