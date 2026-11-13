"use strict";

/**
 * Groups of players (server/docs/grouping.md): a leader and up to four members, formed, joined and run
 * from ::group, each with its own chat-channel. The Grouping tab's activity channels (its Join and
 * Leave) are system chat-channels run here too; its teleports stay with MinigameTeleports and its
 * mounting with SideChannels.
 *
 * Other plugins use the "grouping:" events, never this plugin's modules:
 * - "grouping:changed" (emitted) { type, profile, groupId, group, actor, target, players }
 * - "grouping:get" { player } -> group (a snapshot or null) and role
 * - "grouping:invite" { player, target } -> invited
 * - "grouping:create" { player } -> created (a group led by them)
 * - "grouping:leave" { player } -> left; "grouping:rename" { player, name } -> renamed (the leader)
 * - "grouping:of-account" { name } -> groups (snapshots; the account may be offline)
 * - "grouping:promote" { player, target } -> promoted; "grouping:cancel-step-down" { player } ->
 *   cancelled; "grouping:unkick" { player, target } -> kept
 * - "grouping:stay" { player } -> stayed; "grouping:kick" { player, target } -> kicked;
 *   "grouping:disband" { player } -> disbanded
 * - "grouping:leaving-period" (emitted) { groupId, group, period }: false lets a Group Ironman
 *   group's members leave at once (one still forming)
 * - "grouping:can-join" (emitted) { player, inviter, groupId, group, stage, allowed, reason }
 * - "grouping:open" { player } opens the panel
 * - "grouping:storage" (emitted) { player, group, member, handled } when a member opens group storage
 * - "grouping:can-end" (emitted) { groupId, group, player, allowed, reason } before a group ends
 * - "grouping:activity" { name, maxSize }: a minigame says how many players it takes
 * - "grouping:members" { player, activity?, maxSize? } -> the group's members online, and whether it fits
 * - "grouping:same-group" { player, other } -> same, ironman (other: a player or a login name)
 *
 * A group formed by a Group Ironman is a Group Ironman group: only Group Ironmen in it. Once the
 * Group Ironman plugin has it formed, a member who leaves or is removed stays listed as leaving for
 * seven days (Leaving), and its leader steps down over seven days and is replaced after thirty days
 * away (Leadership).
 */

const Actions = require("./grouping/Actions.Grouping");
const Activities = require("./grouping/Activities.Grouping");
const Channels = require("./grouping/Channels.Grouping");
const Commands = require("./grouping/Commands.Grouping");
const Kinds = require("./grouping/Kinds.Grouping");
const Layout = require("./grouping/Layout.Grouping");
const Leadership = require("./grouping/Leadership.Grouping");
const Leaving = require("./grouping/Leaving.Grouping");
const Lifecycle = require("./grouping/Lifecycle.Grouping");
const Members = require("./grouping/Members.Grouping");
const Names = require("./grouping/Names.Grouping");
const Panel = require("./grouping/Panel.Grouping");
const Rows = require("./grouping/Rows.Grouping");
const Store = require("./grouping/Store.Grouping");

module.exports = {
  name: "Grouping",
  description: "Player groups of up to five with their own chat-channel, and the Grouping tab's activity chat-channels: ::group to form, invite, accept, promote, kick, leave or disband, kept across logins. A Group Ironman's group takes only Group Ironmen and keeps leavers for seven days.",
  register(api) {
    Members.init(api);
    Kinds.init(api);
    Actions.init(api);
    Names.init(api);
    Lifecycle.init(api);
    Rows.init(api);
    Channels.init(api);
    api.persistAttribute(Actions.GROUP_ATTRIBUTE, 0);
    api.persistAttribute(Actions.ROLE_ATTRIBUTE, "");
    api.registerCustomInterface(Layout.buildInterface());
    api.registerCommand("group", Commands.run, undefined, "Form or run a group (invite, accept, decline, promote, kick, leave, disband, info, chat)");
    api.onServerStartup(Channels.registerAll);
    api.onPlayerLogin(Lifecycle.login);
    api.onPlayerLogout(Lifecycle.logout);
    api.onServerStartup(Lifecycle.start);
    api.onObjectInteraction("Group storage", { Open: Lifecycle.openStorage });
    api.onCustomEvent(Actions.CHANGED_EVENT, Panel.refresh);
    api.onCustomEvent(Actions.CHANGED_EVENT, Channels.onGroupChanged);
    api.onCustomEvent("friends-chat:joined", Channels.onChannelJoined);
    api.onCustomEvent("grouping:open", Panel.openFor);
    api.onCustomEvent("grouping:get", Lifecycle.answerGet);
    api.onCustomEvent("grouping:invite", Lifecycle.answerInvite);
    api.onCustomEvent("grouping:activity", Activities.announce);
    api.onCustomEvent("grouping:members", Activities.answerMembers);
    api.onCustomEvent("grouping:create", Lifecycle.answerCreate);
    api.onCustomEvent("grouping:leave", Lifecycle.answerLeave);
    api.onCustomEvent("grouping:stay", Lifecycle.answerStay);
    api.onCustomEvent("grouping:of-account", Lifecycle.answerOfAccount);
    api.onCustomEvent("grouping:promote", Lifecycle.answerPromote);
    api.onCustomEvent("grouping:cancel-step-down", Lifecycle.answerCancelStepDown);
    api.onCustomEvent("grouping:unkick", Lifecycle.answerUnkick);
    api.onCustomEvent("grouping:kick", Lifecycle.answerKick);
    api.onCustomEvent("grouping:disband", Lifecycle.answerDisband);
    api.onCustomEvent("grouping:rename", Names.answerRename);
    // Kinds' answer covers Activities' (both players in one group) and adds ironman and login names.
    api.onCustomEvent("grouping:same-group", Kinds.answerSameGroup);
    api.onCustomEvent("ironman:change-mode", Kinds.vetoModeChange);
    api.onInterfaceActionButton(Panel.TAB_UIDS, Panel.clickTab);
    api.onInterfaceActionButton(Panel.ROW_UIDS, Panel.clickRow);
    api.onInterfaceActionButton(Panel.PRIMARY_UIDS, Panel.clickPrimary);
    api.onInterfaceActionButton(Panel.SECONDARY_UIDS, Panel.clickSecondary);
  },
  _test: { Actions, Activities, Channels, Commands, Kinds, Layout, Leadership, Leaving, Lifecycle, Members, Names, Panel, Rows, Store },
};
