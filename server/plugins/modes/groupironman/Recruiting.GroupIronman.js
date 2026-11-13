"use strict";

/**
 * Inviting players into a group (Wiki, Group Ironman Mode: Creating or joining a group).
 *
 * - On The Node a group's leader can right-click another player and pick Apply to invite them
 *   (player option 1, shown on The Node only: an Area of its islands). The invited player gets the
 *   invitation as a chat line (chattype 111 "Form group" while the group forms, 112 "Group with"
 *   once formed: rebuildchatbox), whose option the client sends as player option 1 on the inviter
 *   (chat_op_core: opplayer(1, name)). So Apply back on whoever invited you accepts: Grouping
 *   takes an invitation back to its sender as the answer to theirs.
 * - The creation panel's Invite (gim_creation_sidepanel:invite) is a target button: the server gives
 *   the leader's the use-on-player flag, and using it on a player invites them (the client sends it
 *   as a target on that player, "magic:spell-on-player" with that component).
 * - The group panel's Invite turns the leader's Inviting on and off (gim_invitationstatus 1 and 2).
 *   Apply needs it on once the group is formed (ours: a formed group's invitation costs its
 *   prestige, so it is opt-in), and is always there while the group forms.
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");

/** chat_op_core sends an invitation line's option as player option 1, so Apply sits there. */
const APPLY_OPTION_SLOT = 1;
const INVITE_CHAT_TYPE = Object.freeze({ FORMING: 111, FORMED: 112 });
const APPLY = "Apply";
const TARGET_PLAYER_FLAG = 1 << 14; // if_events: may be used on a player
const STATUS = Object.freeze({ NONE: 0, INVITING: 1, NOT_INVITING: 2 });
/** The Node's islands, as npc-spawn-sync.json boxes them. */
const NODE_BOX = Object.freeze({ minX: 3072, minY: 2995, maxX: 3135, maxY: 3071 });
const MESSAGE = Object.freeze({
  NOT_LEADER: "Only the group leader can do that.",
  NOT_INVITING: "Turn on Inviting in your group's tab first.",
  // Ours: the chat lines' own text isn't recorded.
  FORM_GROUP: (name) => `${name} wants to form a group with you.`,
  GROUP_WITH: (name) => `${name} wants you to join their group.`,
});

/** Leaders with Inviting on. */
const inviting = new WeakSet();

const uid = (name) => Common.api.core.CacheDefinitions.getComponentId(name);

/** gim_invitationstatus for the player: the leader's Inviting, or nothing for anyone else. */
function statusOf(player, member) {
  if (member?.role !== "leader") return STATUS.NONE;
  return inviting.has(player) ? STATUS.INVITING : STATUS.NOT_INVITING;
}

/** The group panel's Invite: the leader's Inviting on or off. */
function toggle(player) {
  const { member } = Common.groupOf(player);
  if (member?.role !== "leader") return void player.getPacketSender().sendMessage(MESSAGE.NOT_LEADER);
  if (inviting.has(player)) inviting.delete(player);
  else inviting.add(player);
  player.getPacketSender().sendVarbit(Common.api.core.CacheDefinitions.getVarbitId("gim_invitationstatus"), statusOf(player, member));
}

/**
 * The creation panel's Invite, as a target for the leader. The cache's script gives it op1 and the
 * target verb "Invite" (stonebutton_target_init); with op1 not transmitted, a left-click is the
 * target verb, which starts choosing a player (as Clans' Invite).
 */
function targetFlags(player, member) {
  if (member?.role !== "leader") return;
  player.getPacketSender().sendInterfaceFlagsRange(uid("gim_creation_sidepanel:invite"), -1, -1, TARGET_PLAYER_FLAG);
}

function invite(player, target) {
  Common.api.emitCustomEvent("grouping:invite", { player, target });
}

/** "magic:spell-on-player": the creation panel's Invite used on a player. */
function targetInvite(event) {
  if (event.spellWidget !== uid("gim_creation_sidepanel:invite")) return;
  event.handled = true;
  invite(event.player, event.target);
}

/**
 * "player:option-route" (player option 1, which is Attack unless content takes it): Apply on The
 * Node, or an invitation line's option. A leader invites; anyone not in
 * a group invites too, which accepts when the other player invited them first.
 */
function apply(event) {
  if (event.option !== APPLY_OPTION_SLOT || !onNode(event.player) || !Common.isGroupIronman(event.player)) return;
  const { player, target } = event;
  const { member, group } = Common.groupOf(player);
  event.handled = true;
  if (member && member.role !== "leader") return void player.getPacketSender().sendMessage(MESSAGE.NOT_LEADER);
  const formed = group?.ironman ? Store.get(group.id)?.formed : 0;
  if (formed && !inviting.has(player)) return void player.getPacketSender().sendMessage(MESSAGE.NOT_INVITING);
  invite(player, target);
}

/** "grouping:changed" "invited": a Group Ironman group's invitation, as live's chat line. */
/**
 * The text of an invitation line. rebuildchatbox splits a 111/112 line at its first "|" (script632)
 * and draws only what follows, so the line leads with one; without it the line shows empty.
 */
function lineText(text) {
  return `|${text}`;
}

function invited(event) {
  if (event.type !== "invited" || !event.group?.ironman) return;
  const invitee = Common.onlinePlayer(event.target);
  const inviter = event.group.members.find((member) => member.account === event.actor);
  if (!invitee || !inviter) return;
  const formed = Store.get(event.group.id)?.formed;
  const text = formed ? MESSAGE.GROUP_WITH(inviter.name) : MESSAGE.FORM_GROUP(inviter.name);
  const type = formed ? INVITE_CHAT_TYPE.FORMED : INVITE_CHAT_TYPE.FORMING;
  invitee.getSession?.()?.sendClientPacket?.(Common.api.core.encodeChatMessage("game", lineText(text), inviter.name, "", -1, type));
}

function onNode(player) {
  const at = player.getLocation();
  return at.getZ() === 0 && at.getX() >= NODE_BOX.minX && at.getX() <= NODE_BOX.maxX && at.getY() >= NODE_BOX.minY && at.getY() <= NODE_BOX.maxY;
}

function showApply(player, shown) {
  if (player.isPlayerBot?.() === true) return;
  player.getPacketSender().sendPlayerOption(APPLY_OPTION_SLOT, shown ? APPLY : "", false);
}

/** The Node as an Area: Apply on players there, for Group Ironmen. */
function defineArea() {
  return class NodeArea extends Common.api.core.Area {
    postEnter(mobile) {
      if (mobile.isPlayer() && Common.isGroupIronman(mobile.getAsPlayer())) showApply(mobile.getAsPlayer(), true);
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer() && !logout) showApply(mobile.getAsPlayer(), false);
    }
  };
}

/** The Node's Area, for the plugin to register. */
function nodeArea(api) {
  const NodeArea = defineArea();
  return new NodeArea([new api.core.Boundary(NODE_BOX.minX, NODE_BOX.maxX, NODE_BOX.minY, NODE_BOX.maxY, 0)]);
}

module.exports = {
  APPLY_OPTION_SLOT, INVITE_CHAT_TYPE, STATUS, NODE_BOX, MESSAGE, lineText, statusOf, toggle, targetFlags, targetInvite, apply, invited,
  onNode, nodeArea,
};
