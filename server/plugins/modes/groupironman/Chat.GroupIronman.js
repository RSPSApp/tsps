"use strict";

/**
 * Group chat (Wiki, Chat Interface: "//// or /g: Group"). The client sends it as clan chat on clan
 * type 1, the group's own (Tab.GroupIronman sends that clan's settings and channel). Every member
 * of the group who is logged in and doesn't ignore the speaker gets it as clan chat
 * (chattype_clanchat, 41) on a channel whose name starts with "|": the cache's filtertest
 * (script 5501) shows such lines in the Group tab, which is a Group Ironman's Trade tab.
 * A member in their leaving period is still in the group, so still in its chat.
 */

const { FriendsChatManager } = require("../../interface/FriendsChatManager");
const Common = require("./Common.GroupIronman");

const GIM_CLAN = 1;
const CLAN_CHAT_TYPE = 41; // chattype_clanchat
const GROUP_CHANNEL_PREFIX = "|";
const MAX_MESSAGE_LENGTH = 80; // as clan chat (Clans.plugin.js)
const MESSAGE = Object.freeze({ NOT_IN_GROUP: "You are not in a group." });

/** The channel name the group's lines carry: "|" and the group's name. */
function channelName(group) {
  return GROUP_CHANNEL_PREFIX + (group.name || "Group");
}

/** onSocialPacket: a line said on clan type 1 goes to the speaker's group. */
function chat(event) {
  const { player, packet } = event;
  if (packet?.type !== "clan_chat" || packet.clanType !== GIM_CLAN) return;
  event.handled = true;
  const { group } = Common.groupOf(player);
  if (!group?.ironman) {
    player.getPacketSender().sendMessage(MESSAGE.NOT_IN_GROUP);
    return;
  }
  const text = FriendsChatManager.cleanMessage(packet.text, MAX_MESSAGE_LENGTH);
  if (!text || !FriendsChatManager.allowChat(player, text)) return;
  const line = Common.api.core.encodeChatMessage("clan", text, player.getUsername(), channelName(group), player.getIndex(), CLAN_CHAT_TYPE);
  for (const member of group.members) {
    if (!member.online) continue;
    const listener = Common.onlinePlayer(member.account);
    if (listener && !listener.getRelations().hasIgnore(player.getLongUsername())) listener.getSession?.()?.sendClientPacket?.(line);
  }
}

module.exports = { GIM_CLAN, CLAN_CHAT_TYPE, MESSAGE, channelName, chat };
