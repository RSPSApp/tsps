"use strict";

/**
 * Who a player is to the groups, and how a group reads to everyone else: the snapshot in every
 * "grouping:changed" and "grouping:get" reply.
 *
 * Wiki (Grouping): the Grouping tab's chat channels have no leader, ranks or cap. The Wiki's
 * groups with those are Group Ironman's (Group Ironman Mode): a leader and members, two to five
 * players, the leader inviting up to four more. That is what a group here follows.
 */

const { accountName, typedAccount } = require("../FriendsChatManager");
const Store = require("./Store.Grouping");

const MAIN_PROFILE = "main";
const MEMBER_CAP = 5;
const ROLE = Object.freeze({ LEADER: "leader", MEMBER: "member" });

let core;

function init(api) {
  core = api.core;
}

function profileOf(player) {
  return player.getProfile?.() ?? MAIN_PROFILE;
}

/** { profile, account, key }: account is the encoded name; undefined for a name accountName refuses. */
function identify(player) {
  const name = accountName(player?.getUsername?.());
  return name && { profile: profileOf(player), account: name.encoded, key: name.key };
}

/** The account's normalised login name ("mike dev"). */
function keyOf(account) {
  return accountName(core.Misc.longToString(account))?.key ?? "";
}

/**
 * The name other players see for an account: its display name if it chose one, otherwise its
 * login name as its owner spells it (DisplayNames.nameOf, given that spelling).
 */
function nameOf(account) {
  const key = keyOf(account);
  return core.DisplayNames.entryOf(key)?.name
    ?? core.DisplayNames.nameOf(Store.spellingOf(account) ?? core.Misc.fixName(key.replace(/ /g, "_")));
}

/** The account a typed name means (a display name, or a login name it still shows), or undefined. */
function typed(name) {
  return typedAccount(name)?.encoded;
}

/** The account's player while it is logged in to this profile, otherwise null. */
function onlinePlayer(profile, account) {
  if (!Store.isPresent(profile, account)) return null;
  return core.World.getPlayers().search((player) => player != null && player.isPlayerBot?.() !== true
    && profileOf(player) === profile && identify(player)?.account === account) ?? null;
}

/** A member of a Group Ironman group in their leaving period (Store's leaving). */
function isLeaving(group, account) {
  return group?.leaving?.has(account) === true;
}

/** The members not leaving. */
function staying(group) {
  return [...group.members].filter((account) => !isLeaving(group, account));
}

function roleOf(group, account) {
  if (!group?.members.has(account)) return "";
  return group.leader === account ? ROLE.LEADER : ROLE.MEMBER;
}

/** The leader, then the members in the order they joined. */
function ordered(group) {
  return [group.leader, ...Store.byTenure(group)];
}

function snapshot(group, now = Date.now()) {
  if (!group) return null;
  return {
    id: group.id,
    profile: group.profile,
    cap: MEMBER_CAP,
    ironman: group.ironman === true,
    name: group.name ?? "",
    leader: keyOf(group.leader),
    members: ordered(group).map((account) => ({
      account: keyOf(account),
      name: nameOf(account),
      role: roleOf(group, account),
      online: Store.isPresent(group.profile, account),
      joined: group.joined.get(account) ?? 0,
      leaving: group.leaving?.get(account)?.until ?? 0,
      kicked: group.leaving?.get(account)?.kicked === true,
    })),
    invites: [...group.invites]
      .filter(([, expires]) => expires > now)
      .map(([account, expires]) => ({ account: keyOf(account), name: nameOf(account), expires })),
  };
}

module.exports = {
  MEMBER_CAP, ROLE, init, profileOf, identify, keyOf, nameOf, typed, onlinePlayer, isLeaving, staying, roleOf, ordered,
  snapshot,
};
