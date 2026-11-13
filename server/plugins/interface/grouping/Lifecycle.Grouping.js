"use strict";

/**
 * A group around its members' logins and logouts, group storage's door, and the requests other
 * plugins send.
 *
 * - Login: the store says which group the player is in, whatever their save last held, before
 *   anyone is shown the member list.
 * - Logout: the member keeps their place, shown offline, and every invitation to them lapses. A
 *   leader's invitations lapse at once too. The lead waits LEADER_GRACE_TICKS for them, so a relog
 *   or a restart keeps it; after that it passes to the longest-serving member who is logged in,
 *   stays with them when nobody is, and a group of just them ends. A Group Ironman group follows
 *   its own leadership rules instead (Leadership: 30 days away, not a minute).
 * - Each login and logout is noted per member (Store.markSeen) for those rules.
 * - Leaving periods and Group Ironman hand-overs that are due are settled every SETTLE_TICKS from
 *   server start, and at every login first, so nobody logs in to a group they have left.
 * - Group storage (the "Group storage" chests at the banks): only a member of a group, as the store
 *   has it at the click, gets past it. What is stored belongs to the "grouping:storage" handler
 *   (Group Ironman, which this server doesn't have yet).
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Actions = require("./Actions.Grouping");
const Leaving = require("./Leaving.Grouping");
const Leadership = require("./Leadership.Grouping");

const STORAGE_EVENT = "grouping:storage";
const STORAGE_NOT_MEMBER = "You need to be in a group to use group storage.";
const STORAGE_UNAVAILABLE = "Group storage isn't available on this world.";
const NO_LONGER_IN_GROUP = "You are no longer in a group.";
/** Ours (the Wiki has no rule for it): one minute, long enough to relog or reconnect. */
const LEADER_GRACE_TICKS = 100;
/** How often leaving periods and hand-overs are settled (100 ticks, a minute). */
const SETTLE_TICKS = 100;

let api;
/** "profile|encoded" of a leader who logged out -> the token of the hand-over waiting for them. */
const awaited = new Map();
let nextToken = 1;
let started = false;

function init(pluginApi) {
  api = pluginApi;
}

function later(ticks, action) {
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(ticks, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** Settles whatever is due: leaving periods that ran out, then Group Ironman hand-overs. */
function settle(now = Date.now()) {
  Leaving.settle(now);
  Leadership.settle(now);
}

/** Settles every SETTLE_TICKS from server start. */
function start() {
  if (started) return;
  started = true;
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(SETTLE_TICKS, false);
    }
    execute() {
      settle();
    }
  })());
}

/** The leader is still away after the grace: the lead moves on, or a group of just them ends. */
function settleLead(groupId, account, token) {
  const group = Store.byId(groupId);
  const key = group && `${group.profile}|${account}`;
  if (!group || awaited.get(key) !== token) return;
  awaited.delete(key);
  if (group.leader !== account || Store.isPresent(group.profile, account)) return;
  if (group.members.size === 1) {
    if (!group.ironman) Actions.dissolve(group, account);
    return;
  }
  const successor = Actions.handOver(group, true);
  if (successor !== null) Actions.changed("promoted", group, account, successor);
}

function login({ player }) {
  const me = Members.identify(player);
  if (!me || player.isPlayerBot?.() === true) return;
  settle();
  Store.setPresent(me.profile, me.account, true);
  awaited.delete(`${me.profile}|${me.account}`);
  Store.rememberSpelling(me.account, player.getUsername());
  const group = Store.groupOf(me.profile, me.account);
  const saved = Number(player.getAttribute(Actions.GROUP_ATTRIBUTE)) || 0;
  Actions.mirror(player, group, me.account);
  if (!group) {
    if (saved) Actions.tell(player, NO_LONGER_IN_GROUP);
    return;
  }
  Store.markSeen(group, me.account, Date.now());
  Actions.changed("online", group, me.account, me.account);
}

function logout({ player }) {
  const me = Members.identify(player);
  if (!me || !Store.isPresent(me.profile, me.account)) return;
  Store.setPresent(me.profile, me.account, false);
  const group = Store.groupOf(me.profile, me.account);
  for (const other of Store.withdrawInvitations(me.profile, me.account)) {
    if (other !== group) Actions.changed("invite-withdrawn", other, me.account, me.account);
  }
  if (!group) return;
  Store.markSeen(group, me.account, Date.now());
  if (group.leader !== me.account) {
    Actions.changed("offline", group, me.account, me.account);
    return;
  }
  const lapsed = [...group.invites.keys()];
  group.invites.clear();
  if (group.ironman) {
    Actions.changed("offline", group, me.account, me.account, lapsed);
    return;
  }
  const token = nextToken++;
  awaited.set(`${me.profile}|${me.account}`, token);
  later(LEADER_GRACE_TICKS, () => settleLead(group.id, me.account, token));
  Actions.changed("offline", group, me.account, me.account, lapsed);
}

function openStorage({ player }) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group) {
    Actions.tell(player, STORAGE_NOT_MEMBER);
    return true;
  }
  const snapshot = Members.snapshot(group);
  const member = snapshot.members.find(({ account }) => account === Members.keyOf(me.account));
  const request = { player, group: snapshot, member, handled: false };
  api.emitCustomEvent(STORAGE_EVENT, request);
  if (!request.handled) Actions.tell(player, STORAGE_UNAVAILABLE);
  return true;
}

/**
 * "grouping:get" { player }: sets group (a snapshot, or null), role ("leader", "member" or ""),
 * member (the player's own entry in the snapshot, or null) and account (their account's key, as
 * snapshots name members, in a group or not).
 */
function answerGet(request) {
  const me = Members.identify(request.player);
  request.account = me ? Members.keyOf(me.account) : null;
  const group = me ? Store.groupOf(me.profile, me.account) : undefined;
  request.group = Members.snapshot(group);
  request.role = group ? Members.roleOf(group, me.account) : "";
  request.member = request.group?.members.find(({ account }) => account === Members.keyOf(me.account)) ?? null;
}

/** "grouping:leave" { player }: as ::group leave (Tony's "Yes, leave my group."). */
function answerLeave(request) {
  request.left = Leaving.leave(request.player) === true;
}

/** "grouping:create" { player }: forms a group led by the player, if they are in none; sets created. */
function answerCreate(request) {
  const me = Members.identify(request.player);
  request.created = !!me && !Store.groupOf(me.profile, me.account) && Actions.create(request.player) === true;
}

/** The account a request's target means: a player, or a typed name. */
function targetAccount(target) {
  return typeof target === "string" ? Members.typed(target) : Members.identify(target)?.account;
}

/** "grouping:stay" { player }: as ::group stay (the group settings' Cancel Leave); sets stayed. */
function answerStay(request) {
  request.stayed = Leaving.stay(request.player) === true;
}

/** "grouping:kick" { player, target }: as ::group kick (the Group Ironman tab's Kick); sets kicked. */
function answerKick(request) {
  request.kicked = Leaving.kick(request.player, targetAccount(request.target)) === true;
}

/** "grouping:disband" { player }: as ::group disband (cancelling a Group Ironman group still forming). */
function answerDisband(request) {
  request.disbanded = Leadership.disband(request.player) === true;
}

/** "grouping:invite" { player, target }: target is a player or a typed name; sets invited. */
function answerInvite(request) {
  const { player, target } = request;
  request.invited = Actions.invite(player, targetAccount(target));
}

module.exports = {
  STORAGE_EVENT, STORAGE_NOT_MEMBER, STORAGE_UNAVAILABLE, NO_LONGER_IN_GROUP, LEADER_GRACE_TICKS, SETTLE_TICKS,
  init, settle, start, login, logout, openStorage, answerGet, answerCreate, answerLeave, answerStay, answerKick, answerDisband,
  answerInvite,
};
