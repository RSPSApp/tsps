"use strict";

/**
 * ::group on its own opens the panel; with a word it does what the panel's buttons do, by name:
 * ::group invite <name>, accept [name], decline [name], withdraw <name>, promote <name>,
 * kick <name>, leave, disband, create, info (the group as a chat line) and chat (into the group's
 * own chat-channel).
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Actions = require("./Actions.Grouping");
const Activities = require("./Activities.Grouping");
const Channels = require("./Channels.Grouping");
const Panel = require("./Panel.Grouping");

const USAGE = "Use ::group, or ::group invite/accept/decline/withdraw/promote/kick <name>, leave, disband, info or chat.";

/** The group whose invitation the player means: the one led or joined by `name`, else the newest. */
function invitationFrom(player, name) {
  const me = Members.identify(player);
  if (!me) return undefined;
  const invitations = Store.invitationsFor(me.profile, me.account, Date.now());
  if (!name) return invitations.at(-1);
  const account = Members.typed(name);
  return invitations.find((group) => group.members.has(account));
}

/** The group in one chat line: its members (leader first, offline marked) and who is invited. */
function describe(player) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group) return Actions.tell(player, Actions.MESSAGE.NOT_IN_GROUP);
  const snapshot = Members.snapshot(group);
  const members = snapshot.members.map(({ name, role, online }) =>
    `${name}${role === Members.ROLE.LEADER ? " (leader)" : ""}${online ? "" : " (offline)"}`);
  const invited = snapshot.invites.map(({ name }) => name);
  Actions.tell(player, `Group (${group.members.size}/${snapshot.cap}): ${members.join(", ")}.`
    + (invited.length ? ` Invited: ${invited.join(", ")}.` : ""));
  const tooBig = Activities.tooBigFor(group);
  if (tooBig.length) Actions.tell(player, `Too many players for: ${tooBig.join(", ")}.`);
  return true;
}

function run({ player, parts = [] }) {
  const [, word = "", ...rest] = parts;
  const name = rest.join(" ").trim();
  switch (word.toLowerCase()) {
    case "": Panel.open(player); break;
    case "create": Actions.create(player); break;
    case "invite": Actions.invite(player, Members.typed(name)); break;
    case "accept": Actions.accept(player, invitationFrom(player, name)); break;
    case "decline": Actions.decline(player, invitationFrom(player, name)); break;
    case "withdraw": Actions.withdraw(player, Members.typed(name)); break;
    case "promote": Actions.promote(player, Members.typed(name)); break;
    case "kick": Actions.kick(player, Members.typed(name)); break;
    case "leave": Actions.leave(player); break;
    case "disband": Actions.disband(player); break;
    case "info": describe(player); break;
    case "chat": Channels.switchToGroupChannel(player); break;
    default: Actions.tell(player, USAGE);
  }
  return true;
}

module.exports = { USAGE, run, describe, invitationFrom };
