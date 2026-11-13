"use strict";

/**
 * Inviting players into a group (Wiki, Group Ironman Mode: Creating or joining a group).
 *
 * - On The Node a group's leader can right-click another player and pick Apply to invite them
 *   (player option slot 6, shown on The Node only: an Area of its islands).
 * - The creation panel's Invite (gim_creation_sidepanel:invite) is a target button: the server gives
 *   the leader's the use-on-player flag, and using it on a player invites them (the client sends it
 *   as a target on that player, "magic:spell-on-player" with that component).
 * - The group panel's Invite turns the leader's Inviting on and off (gim_invitationstatus 1 and 2).
 *   Apply needs it on once the group is formed (ours: a formed group's invitation costs its
 *   prestige, so it is opt-in), and is always there while the group forms.
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");

const APPLY_OPTION_SLOT = 6;
const APPLY = "Apply";
const TARGET_PLAYER_FLAG = 1 << 14; // if_events: may be used on a player
const OP1_FLAG = 1 << 1;
const STATUS = Object.freeze({ NONE: 0, INVITING: 1, NOT_INVITING: 2 });
/** The Node's islands, as npc-spawn-sync.json boxes them. */
const NODE_BOX = Object.freeze({ minX: 3072, minY: 2995, maxX: 3135, maxY: 3071 });
const MESSAGE = Object.freeze({
  NOT_LEADER: "Only the group leader can do that.",
  NOT_INVITING: "Turn on Inviting in your group's tab first.",
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

/** The creation panel's Invite, as a target for the leader. */
function targetFlags(player, member) {
  if (member?.role !== "leader") return;
  player.getPacketSender().sendInterfaceFlagsRange(uid("gim_creation_sidepanel:invite"), -1, -1, OP1_FLAG | TARGET_PLAYER_FLAG);
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

/** onPlayerOption: Apply on The Node. */
function apply(event) {
  if (event.option !== APPLY_OPTION_SLOT || !onNode(event.player)) return;
  const { player, target } = event;
  const { member, group } = Common.groupOf(player);
  event.handled = true;
  if (member?.role !== "leader") return void player.getPacketSender().sendMessage(MESSAGE.NOT_LEADER);
  const formed = group?.ironman ? Store.get(group.id)?.formed : 0;
  if (formed && !inviting.has(player)) return void player.getPacketSender().sendMessage(MESSAGE.NOT_INVITING);
  invite(player, target);
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
  APPLY_OPTION_SLOT, STATUS, NODE_BOX, MESSAGE, statusOf, toggle, targetFlags, targetInvite, apply, onNode, nodeArea,
};
