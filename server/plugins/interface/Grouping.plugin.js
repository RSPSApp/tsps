"use strict";

/**
 * Groups of players (server/docs/grouping.md): a leader and up to four members, formed, joined and run
 * from ::group. The Grouping tab's own activity list and minigame teleports stay with
 * SideChannels and MinigameTeleports.
 *
 * Other plugins use the "grouping:" events, never this plugin's modules:
 * - "grouping:changed" (emitted) { type, profile, groupId, group, actor, target, players }
 * - "grouping:get" { player } -> group (a snapshot or null) and role
 * - "grouping:invite" { player, target } -> invited
 * - "grouping:open" { player } opens the panel
 * - "grouping:storage" (emitted) { player, group, handled } when a member opens group storage
 */

const Actions = require("./grouping/Actions.Grouping");
const Commands = require("./grouping/Commands.Grouping");
const Layout = require("./grouping/Layout.Grouping");
const Lifecycle = require("./grouping/Lifecycle.Grouping");
const Members = require("./grouping/Members.Grouping");
const Panel = require("./grouping/Panel.Grouping");
const Rows = require("./grouping/Rows.Grouping");
const Store = require("./grouping/Store.Grouping");

module.exports = {
  name: "Grouping",
  description: "Player groups of up to five: ::group to form one, invite, accept, promote, kick, leave or disband, kept across logins, with grouping:* events for co-op content.",
  register(api) {
    Members.init(api);
    Actions.init(api);
    Lifecycle.init(api);
    Rows.init(api);
    api.persistAttribute(Actions.GROUP_ATTRIBUTE, 0);
    api.persistAttribute(Actions.ROLE_ATTRIBUTE, "");
    api.registerCustomInterface(Layout.buildInterface());
    api.registerCommand("group", Commands.run, undefined, "Form or run a group (invite, accept, decline, promote, kick, leave, disband, info)");
    api.onPlayerLogin(Lifecycle.login);
    api.onPlayerLogout(Lifecycle.logout);
    api.onObjectInteraction("Group storage", { Open: Lifecycle.openStorage });
    api.onCustomEvent(Actions.CHANGED_EVENT, Panel.refresh);
    api.onCustomEvent("grouping:open", Panel.openFor);
    api.onCustomEvent("grouping:get", Lifecycle.answerGet);
    api.onCustomEvent("grouping:invite", Lifecycle.answerInvite);
    api.onInterfaceActionButton(Panel.TAB_UIDS, Panel.clickTab);
    api.onInterfaceActionButton(Panel.ROW_UIDS, Panel.clickRow);
    api.onInterfaceActionButton(Panel.PRIMARY_UIDS, Panel.clickPrimary);
    api.onInterfaceActionButton(Panel.SECONDARY_UIDS, Panel.clickSecondary);
  },
  _test: { Actions, Commands, Layout, Lifecycle, Members, Panel, Rows, Store },
};
