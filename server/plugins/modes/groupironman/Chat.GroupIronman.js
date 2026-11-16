"use strict";

/**
 * Group chat (Wiki, Chat Interface: "//// or /g: Group"). The client sends it as clan chat on clan
 * type 1, the group's own (Tab.GroupIronman sends that clan's settings and channel). Every member
 * of the group who is logged in and doesn't ignore the speaker gets it as clan chat
 * (chattype_clanchat, 41) whose text starts with "|", on a channel named after the group: the
 * cache's panetest and filtertest (script 5501, on the text) put such lines in the Group tab, a
 * Group Ironman's Trade tab, and rebuildchatbox draws them without the bar (script632), with the
 * group's name in brackets. RuneLite reads them the same way (CLAN_GIM_CHAT: "remove |"), and the
 * gateway sends them as clan type 1's.
 * A member in their leaving period is still in the group, so still in its chat.
 */

const { FriendsChatManager } = require("../../interface/FriendsChatManager");
const Common = require("./Common.GroupIronman");

const GIM_CLAN = 1;
const CLAN_CHAT_TYPE = 41; // chattype_clanchat
const GROUP_LINE_MARK = "|";
const MAX_MESSAGE_LENGTH = 80; // as clan chat (Clans.plugin.js)
const MESSAGE = Object.freeze({ NOT_IN_GROUP: "You are not in a group." });

/** The channel name the group's lines carry: the group's name. */
function channelName(group) {
  return group.name || "Group";
}

/** A group line's text: the bar that marks it as the group's, then what was said. */
function lineText(text) {
  return GROUP_LINE_MARK + text;
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
  const line = Common.api.core.encodeChatMessage("clan", lineText(text), player.getUsername(), channelName(group), player.getIndex(), CLAN_CHAT_TYPE);
  for (const member of group.members) {
    if (!member.online) continue;
    const listener = Common.onlinePlayer(member.account);
    if (listener && !listener.getRelations().hasIgnore(player.getLongUsername())) listener.getSession?.()?.sendClientPacket?.(line);
  }
}

module.exports = { GIM_CLAN, CLAN_CHAT_TYPE, MESSAGE, channelName, lineText, chat };
