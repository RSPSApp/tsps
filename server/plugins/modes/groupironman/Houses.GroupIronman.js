"use strict";

/**
 * Teleport to House's Group options (Update:Group Ironman Improvements, 2 March 2022): "Group:
 * Choose" brings up a choice of whose house to visit, "Group: Previous" goes to the house visited
 * last that way. SpellTeleports asks whose ("teleports:group-house"); the house's own rules (on
 * this world, not in building mode, open to visitors) are Construction's.
 * The choice is a chatbox list of the group members logged in (ours: the update names no interface).
 */

const Common = require("./Common.GroupIronman");

const LAST_HOUSE_ATTRIBUTE = "group-ironman:last-house";
const TITLE = "Whose house?";
const MESSAGE = Object.freeze({
  NONE_ONLINE: "None of your group members are online.",
  NO_PREVIOUS: "You haven't teleported to a group member's house yet.",
  PREVIOUS_OFFLINE: "That group member isn't online.",
});

/** The group members logged in, other than the player: [{ name, account, player }]. */
function mates(player, group, account) {
  return group.members
    .filter((member) => member.online && member.account !== account)
    .map((member) => ({ name: member.name, account: member.account, player: Common.onlinePlayer(member.account) }))
    .filter((mate) => mate.player);
}

function go(request, mate) {
  request.player.setAttribute(LAST_HOUSE_ATTRIBUTE, mate.account);
  request.pick(mate.player);
}

/** "teleports:group-house" { player, previous, pick, handled }: a Group Ironman's teammates' houses. */
function groupHouse(request) {
  const { player } = request;
  const { group, account } = Common.groupOf(player);
  if (!group?.ironman || !Common.isGroupIronman(player)) return;
  request.handled = true;
  const online = mates(player, group, account);
  const sender = player.getPacketSender();
  if (request.previous) {
    const last = player.getAttribute(LAST_HOUSE_ATTRIBUTE);
    if (!last) return void sender.sendMessage(MESSAGE.NO_PREVIOUS);
    const mate = online.find((each) => each.account === last);
    return mate ? go(request, mate) : void sender.sendMessage(MESSAGE.PREVIOUS_OFFLINE);
  }
  if (!online.length) return void sender.sendMessage(MESSAGE.NONE_ONLINE);
  const options = online.slice(0, 5).flatMap((mate) => [mate.name, () => go(request, mate)]);
  Common.api.sendMultiChatboxPrompt(player, TITLE, ...options);
}

module.exports = { LAST_HOUSE_ATTRIBUTE, TITLE, MESSAGE, groupHouse };
