"use strict";

/**
 * Group Ironman's own rules (server/docs/group-ironman.md), on top of the Ironman plugin's modes
 * (Group, Hardcore Group, Unranked Group Ironman) and Grouping's groups:
 * - a group's mode, forming it (::gim form), and who may join (Variants);
 * - Hardcore groups' shared lives (Hardcore);
 * - what a leaver becomes once out of the group (Leaving, the cache's gim_leaving);
 * - Unranked by way of the Ironman tutor in Lumbridge, after 7 days (Unranked);
 * - new members' wealth transfer limits (Wealth), item restrictions and prestige lost to outside
 *   help (Restrictions);
 * - The Node: getting there and back, Tony and Maggie, armour (Node);
 * - the Group Ironman tab of the social tab: the group, its creation, or "Create Group" (Tab), and
 *   the group settings it opens (Settings);
 * - the group storage's unlocks, up to 200 spaces (Unlocks), and group chat (Chat);
 * - inviting: the creation panel's Invite target, Apply on The Node, Inviting (Recruiting);
 * - Teleport to House's Group options (Houses);
 * - raids and group bosses with players outside the group: Hardcore groups refused, prestige
 *   lost (Pvm); combat achievements that need a bigger team than the group's left out (Pvm);
 * - a member's permanent ban costs the group its prestige (Variants);
 * - what a ranked leaver loses beyond their tradeables (Wipe).
 * It talks to Ironman, Grouping and GroupStorage only through their events.
 */

const Armour = require("./groupironman/Armour.GroupIronman");
const Chat = require("./groupironman/Chat.GroupIronman");
const Commands = require("./groupironman/Commands.GroupIronman");
const Common = require("./groupironman/Common.GroupIronman");
const Events = require("./groupironman/Events.GroupIronman");
const Hardcore = require("./groupironman/Hardcore.GroupIronman");
const Houses = require("./groupironman/Houses.GroupIronman");
const Leaving = require("./groupironman/Leaving.GroupIronman");
const Node = require("./groupironman/Node.GroupIronman");
const Pvm = require("./groupironman/Pvm.GroupIronman");
const Recruiting = require("./groupironman/Recruiting.GroupIronman");
const Restrictions = require("./groupironman/Restrictions.GroupIronman");
const Settings = require("./groupironman/Settings.GroupIronman");
const Store = require("./groupironman/Store.GroupIronman");
const Tab = require("./groupironman/Tab.GroupIronman");
const Unlocks = require("./groupironman/Unlocks.GroupIronman");
const Unranked = require("./groupironman/Unranked.GroupIronman");
const Variants = require("./groupironman/Variants.GroupIronman");
const Wipe = require("./groupironman/Wipe.GroupIronman");
const Wealth = require("./groupironman/Wealth.GroupIronman");

module.exports = {
  name: "GroupIronman",
  description: "Group Ironman's rules: The Node, the Group Ironman tab and group chat, storage unlocks, forming groups, Hardcore groups' shared lives, Unranked groups, what a leaver becomes, and new members' weekly wealth limits and item restrictions.",
  register(api) {
    Common.init(api);
    api.persistAttribute(Variants.EXPERIENCED_ATTRIBUTE, false);
    api.persistAttribute(Unranked.UNRANKED_AT_ATTRIBUTE, 0);
    api.persistAttribute(Restrictions.KILLS_ATTRIBUTE, []);
    api.persistAttribute(Houses.LAST_HOUSE_ATTRIBUTE, "");
    api.registerCommand("gim", Commands.run, undefined, "Group Ironman: ::gim info, ::gim form [noprestige]");
    api.onCustomEvent("grouping:changed", Events.changed);
    api.onCustomEvent("grouping:changed", Tab.changed);
    api.onCustomEvent("grouping:changed", Settings.changed);
    api.onCustomEvent("grouping:changed", Recruiting.invited);
    api.onCustomEvent("grouping:can-join", Variants.canJoin);
    api.onCustomEvent("grouping:leaving-period", Variants.leavingPeriod);
    api.onCustomEvent("account:banned", Variants.memberBanned);
    api.onCustomEvent("side-channels:gim-tab", Tab.gimTab);
    api.onCustomEvent("ironman:mode-changed", Tab.modeChanged);
    Store.onUpdate(Tab.recordChanged);
    api.onCustomEvent("ironman:change-mode", Unranked.changeMode);
    api.onCustomEvent("group-storage:limit", Wealth.storageLimit);
    api.onCustomEvent("group-storage:can-withdraw", Wealth.canWithdraw);
    api.onCustomEvent("group-storage:withdrawn", Wealth.withdrawn);
    api.onCustomEvent("group-storage:capacity", Unlocks.capacity);
    api.onCustomEvent("group-storage:unlocks", Unlocks.storageButton);
    api.onSocialPacket(Chat.chat);
    api.onCustomEvent("teleports:group-house", Houses.groupHouse);
    api.onCustomEvent("magic:spell-on-player", Recruiting.targetInvite);
    api.onCustomEvent("player:option-route", Recruiting.apply);
    api.registerArea(Recruiting.nodeArea(api));
    api.onCustomEvent("npc-drops:roll", Restrictions.kill);
    api.onCustomEvent("group-pvm:can-start", Pvm.canStart);
    api.onCustomEvent("group-pvm:started", Pvm.started);
    api.onCustomEvent("combat-achievements:team-size", Pvm.teamSize);
    api.onCanEquip(Restrictions.canEquip);
    api.onCanTrade(Wealth.canTrade);
    api.onTradeCompleted(Wealth.tradeCompleted);
    api.onPlayerDeath(Hardcore.death);
    api.onPlayerLogin(Events.login);
    api.onInterfaceActionClick(Leaving.click);
    api.onInterfaceActionClick(Tab.click);
    api.onInterfaceActionClick(Settings.click);
    api.onInterfaceActionClick(Unlocks.click);
    api.onCustomEvent("tutorial-island:destination", Node.tutorialDestination);
    api.onCustomEvent("npc-dialogue:choice", Node.choice);
    api.onObjectInteraction("Portal", { Enter: Node.portal });
    api.onObjectInteraction("Rowboat", { Travel: Node.rowboat });
    api.onObjectInteraction("Armour crate", { Take: Armour.crate });
    api.onObjectInteraction("Hardcore armour crate", { Take: Armour.crate });
    api.onNpcInteraction("Group Ironman tutor", { Armour: Armour.tonyArmour });
    api.onCanEquip(Armour.crumble);
    api.onCustomEvent("ironman:armour", Armour.adamArmour);
    api.onCustomEvent("ring-of-life:can-escape", Hardcore.ringOfLifeEscape);
    api.onNpcInteraction("Group Storage tutor", { Bank: Node.bank });
    api.onObjectInteraction("Chest", { Bank: Node.chest });
    api.onItemAction("Group ironman helm", { Teleport: Node.helmTeleport });
    api.onItemAction("Hardcore group ironman helm", { Teleport: Node.helmTeleport });
    api.onServerStartup(Unranked.start);
  },
  _test: { Armour, Chat, Commands, Common, Events, Hardcore, Houses, Leaving, Node, Pvm, Recruiting, Restrictions, Settings, Store, Tab, Unlocks, Unranked, Variants, Wealth, Wipe },
};
