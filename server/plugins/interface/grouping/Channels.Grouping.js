"use strict";

/**
 * Grouping's chat-channels, run through the friends chat (FriendsList's "friends-chat:*" events).
 *
 * Activity channels. The Grouping tab's Join (client script 437) sends a plain chat-channel join
 * for the chosen activity's channel, enum 849 ("osrs star cc"). Live (rev 242) answers with owner
 * "osrs star cc", channel name "Stars" and kick rank General, every member Unranked and from any
 * world. No player owns them here, so they run as system channels anyone may enter and talk in.
 * Which exist and the names they show are the Wiki's (data/grouping-channels.json), "Stars" live's.
 *
 * A group's own channel ("#group-<id>", which no typed name reaches): members only, named "Group",
 * its leader shown as owner. Forming or joining a group puts the player in it when they are in no
 * other channel. Its chat is Channel chat, and its members get the friends-chat minimap dot. When
 * the leader joins an activity channel, members in no channel or in the group's own follow; anyone
 * in another channel is told instead, and nobody is moved out of a channel they chose.
 *
 * A Group Ironman group has none: it talks in its own group chat (the Group Ironman tab's, `////`).
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Actions = require("./Actions.Grouping");
/** The Wiki's activity channels (owner -> name shown), Shooting Stars' name from a live capture. */
const { channels: CHANNEL_NAMES } = require("../data/grouping-channels.json");

const ACTIVITY_CHANNEL_ENUM = 849;
const SYSTEM_CHANNEL_EVENT = "friends-chat:system-channel";
const KEY_PREFIX = "#group-";
const GROUP_CHANNEL_NAME = "Group";
const RECRUIT_RANK = 1;
const GENERAL_RANK = 6;
const OWNER_RANK = 7;
const MESSAGE = Object.freeze({
  SWITCH: "Your group talks in its own chat-channel. Use ::group chat to switch to it.",
  BROUGHT: "Your group leader has brought the group to this chat-channel.",
  // Ours: a Group Ironman group's chat is the Group Ironman tab's.
  IRONMAN: "Your group talks in its group chat: start a message with ////.",
});

let api;
let core;
/** The activity channels' keys, the names enum 849 gives. */
const activityKeys = new Set();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const groupKey = (group) => `${KEY_PREFIX}${group.id}`;

function isMember(groupId, player) {
  const me = Members.identify(player);
  const group = Store.byId(groupId);
  return !!me && !!group && group.profile === me.profile && group.members.has(me.account);
}

/** In a group's channel the leader holds the Owner rank and members Recruit, as CoX parties need. */
function rankIn(groupId, player) {
  const me = Members.identify(player);
  const group = Store.byId(groupId);
  if (!me || !group?.members.has(me.account)) return undefined;
  return group.leader === me.account ? OWNER_RANK : RECRUIT_RANK;
}

/** Whether the group runs a chat-channel: every group but a Group Ironman one. */
const hasChannel = (group) => group.ironman !== true;

function registerGroup(group) {
  if (!hasChannel(group)) return;
  const id = group.id;
  api.emitCustomEvent(SYSTEM_CHANNEL_EVENT, {
    key: groupKey(group),
    channel: {
      ownerName: Members.nameOf(group.leader),
      channelName: GROUP_CHANNEL_NAME,
      kickRank: GENERAL_RANK,
      admits: (player) => isMember(id, player),
      rankOf: (player) => rankIn(id, player),
    },
  });
}

/** Server startup: every activity channel, and the channel of every group on disk. */
function registerAll() {
  for (const name of core.CacheDefinitions.getEnumValues(ACTIVITY_CHANNEL_ENUM).values()) {
    if (typeof name !== "string" || !name) continue;
    // The cache's name has no-break spaces; the channel's key is the name as names compare, and its
    // owner the cache's own string, which the tab's script compares to tell Join from Leave.
    const key = core.DisplayNames.key(name);
    // An activity the Wiki gives no channel has none: Join finds it doesn't exist, as any unknown name.
    const channelName = CHANNEL_NAMES[key];
    if (!channelName) continue;
    activityKeys.add(key);
    api.emitCustomEvent(SYSTEM_CHANNEL_EVENT, {
      key,
      channel: { ownerName: name, channelName, kickRank: GENERAL_RANK },
    });
  }
  for (const group of Store.all()) registerGroup(group);
}

/** The chat-channel the player is in: { key, name, ... }, or null. */
function channelOf(player) {
  const request = { player };
  api.emitCustomEvent("friends-chat:channel", request);
  return request.channel ?? null;
}

function join(player, key) {
  const request = { player, owner: key, notify: true };
  api.emitCustomEvent("friends-chat:join", request);
  return request.joined === true;
}

/** Puts a member in the group's channel if they're in no other; otherwise says how to switch. */
function joinIfFree(player, group) {
  if (!player) return;
  const current = channelOf(player)?.key;
  if (current === groupKey(group)) return;
  if (current == null) join(player, groupKey(group));
  else Actions.tell(player, MESSAGE.SWITCH);
}

function leaveGroupChannel(player, key) {
  if (player && channelOf(player)?.key === key) {
    api.emitCustomEvent("friends-chat:leave", { player, notify: true });
  }
}

function playerFor(event, accountKey) {
  return event.players?.find((player) => Members.identify(player)?.key === accountKey) ?? null;
}

/** "grouping:changed": keeps the group's channel in step with the group. */
function onGroupChanged(event) {
  const key = `${KEY_PREFIX}${event.groupId}`;
  if (event.type === "disbanded") {
    api.emitCustomEvent(SYSTEM_CHANNEL_EVENT, { key, channel: null });
    return;
  }
  const group = Store.byId(event.groupId);
  if (!group || !hasChannel(group)) return;
  // The leader shown as the channel's owner follows every change of lead.
  registerGroup(group);
  if (event.type === "created") joinIfFree(playerFor(event, event.actor), group);
  else if (event.type === "joined") joinIfFree(playerFor(event, event.target), group);
  else if (event.type === "left" || event.type === "kicked") leaveGroupChannel(playerFor(event, event.target), key);
}

/**
 * "friends-chat:joined": a leader joining an activity channel brings their group along. Their return
 * to it at login (a rejoin) brings nobody: members may have chosen another channel meanwhile.
 */
function onChannelJoined({ player, channelKey, rejoin }) {
  if (rejoin || !activityKeys.has(channelKey)) return;
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group || group.leader !== me.account) return;
  const channelName = channelOf(player)?.name ?? channelKey;
  for (const account of group.members) {
    if (account === me.account) continue;
    const member = Members.onlinePlayer(group.profile, account);
    const current = member && channelOf(member)?.key;
    if (!member || current === channelKey) continue;
    if (current == null || current === groupKey(group)) {
      if (join(member, channelKey)) Actions.tell(member, MESSAGE.BROUGHT);
    } else {
      Actions.tell(member, `${Members.nameOf(me.account)} has taken the group to the ${channelName} chat-channel. You can join it from the Grouping tab.`);
    }
  }
}

/** ::group chat: into the group's own channel, out of whichever the player was in. */
function switchToGroupChannel(player) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group) return Actions.tell(player, Actions.MESSAGE.NOT_IN_GROUP);
  if (!hasChannel(group)) return Actions.tell(player, MESSAGE.IRONMAN);
  if (channelOf(player)?.key === groupKey(group)) return Actions.tell(player, "You are already talking in your group's chat-channel.");
  registerGroup(group);
  return join(player, groupKey(group));
}

module.exports = {
  ACTIVITY_CHANNEL_ENUM, KEY_PREFIX, GROUP_CHANNEL_NAME, GENERAL_RANK, MESSAGE,
  init, registerAll, onGroupChanged, onChannelJoined, switchToGroupChannel, groupKey,
};
