"use strict";

/**
 * The panel's rows for one viewer: their group (or a row to form one), the invitations they hold,
 * and the players they could invite. Each row carries its details text and the labels of the two
 * buttons; the actions themselves are worked out again from the store when a button is clicked.
 *
 * The Find tab lists only players the viewer could invite and may know of: logged in to the same
 * kind of character, shown to them by their private chat setting, not ignoring them, not on the
 * viewer's ignore list and not in a group of their own. Nearest first, at most FIND_LIMIT.
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");

const KIND = Object.freeze({ CREATE: "create", MEMBER: "member", INVITED: "invited", INVITATION: "invitation", PLAYER: "player" });
const ACTION = Object.freeze({
  CREATE: "Create", LEAVE: "Leave", DISBAND: "Disband", PROMOTE: "Promote", KICK: "Kick",
  WITHDRAW: "Withdraw", ACCEPT: "Accept", DECLINE: "Decline", INVITE: "Invite",
});
const FIND_LIMIT = 100;
const ONLINE = "<col=00ff00>Online</col>";
const OFFLINE = "<col=ff5f5f>Offline</col>";

let core;

function init(api) {
  core = api.core;
}

/** The buttons a viewer gets on a row, from the store as it is now. */
function actionsFor(me, entry, now = Date.now()) {
  const group = Store.groupOf(me.profile, me.account);
  const leads = group?.leader === me.account;
  switch (entry?.kind) {
    case KIND.CREATE: return group ? [] : [ACTION.CREATE];
    case KIND.MEMBER:
      if (!group?.members.has(entry.account)) return [];
      if (entry.account === me.account) return leads ? [ACTION.LEAVE, ACTION.DISBAND] : [ACTION.LEAVE];
      return leads ? [ACTION.PROMOTE, ACTION.KICK] : [];
    case KIND.INVITED: return leads && Store.invitationStands(group, entry.account, now) ? [ACTION.WITHDRAW] : [];
    case KIND.INVITATION: {
      const inviting = Store.byId(entry.groupId);
      return inviting && Store.invitationStands(inviting, me.account, now) ? [ACTION.ACCEPT, ACTION.DECLINE] : [];
    }
    case KIND.PLAYER: return !group || leads ? [ACTION.INVITE] : [];
    default: return [];
  }
}

function panel(me, entry, fields, now) {
  const [primary = "", secondary = ""] = actionsFor(me, entry, now);
  return { title: "", subtitle: "", info: "", info2: "", description: "", ...fields, primary, secondary };
}

function memberRow(me, group, account, now) {
  const you = account === me.account;
  const leader = account === group.leader;
  const online = Store.isPresent(group.profile, account);
  const flags = [leader && "leader", you && "you", !online && "offline"].filter(Boolean);
  const leads = group.leader === me.account;
  const description = you
    ? (leads
      ? "You lead this group. Leaving hands the lead to the longest-serving member; disbanding ends the group for everyone."
      : "Leaving takes you out of the group. Only the leader can invite, promote or remove members.")
    : (leads ? "Promote makes them the leader; they must be online. Kick removes them from the group." : "");
  const entry = { kind: KIND.MEMBER, account };
  return {
    entry,
    name: Members.nameOf(account),
    detail: flags.length ? ` (${flags.join(", ")})` : "",
    panel: panel(me, entry, {
      title: Members.nameOf(account), subtitle: leader ? "Leader" : "Member", info: online ? ONLINE : OFFLINE,
      info2: `Group: ${group.members.size}/${Members.MEMBER_CAP}`, description,
    }, now),
  };
}

function invitedRow(me, group, account, now) {
  const entry = { kind: KIND.INVITED, account };
  const minutes = Math.max(1, Math.ceil(((group.invites.get(account) ?? now) - now) / 60000));
  return {
    entry,
    name: Members.nameOf(account),
    detail: " (invited)",
    panel: panel(me, entry, {
      title: Members.nameOf(account), subtitle: "Invited", info: `Lapses in ${minutes} min`,
      description: "Waiting for them to accept. The invitation lapses if either of you logs out.",
    }, now),
  };
}

function groupRows(me, group, now) {
  if (!group) {
    const entry = { kind: KIND.CREATE };
    return [{
      entry, name: "Form a group", detail: "",
      panel: panel(me, entry, {
        title: "No group", subtitle: `Up to ${Members.MEMBER_CAP} players`,
        description: "Form a group and invite players from the Find tab. They join from their own Invites tab.",
      }, now),
    }];
  }
  const members = Members.ordered(group).map((account) => memberRow(me, group, account, now));
  const invited = [...group.invites.keys()]
    .filter((account) => Store.invitationStands(group, account, now))
    .map((account) => invitedRow(me, group, account, now));
  return [
    { header: `Members (${group.members.size}/${Members.MEMBER_CAP})` }, ...members,
    ...(invited.length ? [{ header: "Invited" }, ...invited] : []),
  ];
}

function invitationRows(me, now) {
  return Store.invitationsFor(me.profile, me.account, now).map((group) => {
    const entry = { kind: KIND.INVITATION, groupId: group.id };
    const names = Members.ordered(group).map(Members.nameOf);
    return {
      entry,
      name: `${Members.nameOf(group.leader)}'s group`,
      detail: ` (${group.members.size}/${Members.MEMBER_CAP})`,
      panel: panel(me, entry, {
        title: `${Members.nameOf(group.leader)}'s group`, subtitle: `${group.members.size}/${Members.MEMBER_CAP} members`,
        info: names.slice(0, 3).join(", "), info2: names.length > 3 ? `and ${names.length - 3} more` : "",
        description: "Accepting joins this group and turns down your other invitations.",
      }, now),
    };
  });
}

/** Players this viewer may invite and may know of, nearest first. */
function candidates(viewer, me) {
  const group = Store.groupOf(me.profile, me.account);
  if (group && group.leader !== me.account) return [];
  const here = viewer.getLocation();
  const found = [];
  core.World.getPlayers().forEach((other) => {
    if (!other || other === viewer || other.isPlayerBot?.() === true) return;
    const them = Members.identify(other);
    if (!them || them.profile !== me.profile || !Store.isPresent(them.profile, them.account)) return;
    if (group?.members.has(them.account) || viewer.getRelations().hasIgnore(them.account)) return;
    const relations = other.getRelations();
    if (!relations.isVisibleTo(viewer) || relations.hasIgnore(me.account)) return;
    const theirs = Store.groupOf(them.profile, them.account);
    if (theirs && theirs.members.size > 1) return;
    const there = other.getLocation();
    const distance = there.getZ() === here.getZ() ? here.getDistance(there) : Number.MAX_SAFE_INTEGER;
    found.push({ player: other, account: them.account, distance });
  });
  return found.sort((a, b) => a.distance - b.distance).slice(0, FIND_LIMIT);
}

function findRows(viewer, me, now) {
  const group = Store.groupOf(me.profile, me.account);
  return candidates(viewer, me).map(({ player, account }) => {
    const entry = { kind: KIND.PLAYER, account };
    const level = player.getSkillManager().getCombatLevel();
    return {
      entry,
      name: Members.nameOf(account),
      detail: ` (level-${level})`,
      panel: panel(me, entry, {
        title: Members.nameOf(account), subtitle: `Combat level ${level}`,
        description: group ? "Invite them to your group." : "Inviting forms a group, with you as its leader.",
      }, now),
    };
  });
}

/** [groupRows, invitationRows, findRows]: each tab's rows, headers included. */
function tabs(viewer, me, now = Date.now()) {
  return [groupRows(me, Store.groupOf(me.profile, me.account), now), invitationRows(me, now), findRows(viewer, me, now)];
}

module.exports = { KIND, ACTION, FIND_LIMIT, init, actionsFor, candidates, tabs };
