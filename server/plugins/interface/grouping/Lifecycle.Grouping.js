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
 *   stays with them when nobody is, and a group of just them ends.
 * - Group storage (the "Group storage" chests at the banks): only a member of a group, as the store
 *   has it at the click, gets past it. What is stored belongs to the "grouping:storage" handler
 *   (Group Ironman, which this server doesn't have yet).
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Actions = require("./Actions.Grouping");

const STORAGE_EVENT = "grouping:storage";
const STORAGE_NOT_MEMBER = "You need to be in a group to use group storage.";
const STORAGE_UNAVAILABLE = "Group storage isn't available on this world.";
const NO_LONGER_IN_GROUP = "You are no longer in a group.";
/** Ours (the Wiki has no rule for it): one minute, long enough to relog or reconnect. */
const LEADER_GRACE_TICKS = 100;

let api;
/** "profile|encoded" of a leader who logged out -> the token of the hand-over waiting for them. */
const awaited = new Map();
let nextToken = 1;

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

/** The leader is still away after the grace: the lead moves on, or a group of just them ends. */
function settleLead(groupId, account, token) {
  const group = Store.byId(groupId);
  const key = group && `${group.profile}|${account}`;
  if (!group || awaited.get(key) !== token) return;
  awaited.delete(key);
  if (group.leader !== account || Store.isPresent(group.profile, account)) return;
  if (group.members.size === 1) {
    Actions.dissolve(group, account);
    return;
  }
  const successor = Actions.handOver(group, true);
  if (successor !== null) Actions.changed("promoted", group, account, successor);
}

function login({ player }) {
  const me = Members.identify(player);
  if (!me || player.isPlayerBot?.() === true) return;
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
  if (group.leader !== me.account) {
    Actions.changed("offline", group, me.account, me.account);
    return;
  }
  const lapsed = [...group.invites.keys()];
  group.invites.clear();
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
  const request = { player, group: Members.snapshot(group), handled: false };
  api.emitCustomEvent(STORAGE_EVENT, request);
  if (!request.handled) Actions.tell(player, STORAGE_UNAVAILABLE);
  return true;
}

/** "grouping:get" { player }: sets group (a snapshot, or null) and role ("leader", "member" or ""). */
function answerGet(request) {
  const me = Members.identify(request.player);
  const group = me ? Store.groupOf(me.profile, me.account) : undefined;
  request.group = Members.snapshot(group);
  request.role = group ? Members.roleOf(group, me.account) : "";
}

/** "grouping:invite" { player, target }: target is a player or a typed name; sets invited. */
function answerInvite(request) {
  const { player, target } = request;
  const account = typeof target === "string" ? Members.typed(target) : Members.identify(target)?.account;
  request.invited = Actions.invite(player, account);
}

module.exports = {
  STORAGE_EVENT, STORAGE_NOT_MEMBER, STORAGE_UNAVAILABLE, NO_LONGER_IN_GROUP, LEADER_GRACE_TICKS,
  init, login, logout, openStorage, answerGet, answerInvite,
};
