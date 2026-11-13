"use strict";

/**
 * The Group Ironman tab of the social tab (side_channels_large's tab_gim; SideChannels mounts it
 * through "side-channels:gim-tab"). As the cache draws it (osrs-dumps rev 242):
 *
 * - In a formed group: gim_sidepanel (726). Its scripts read the group from the clan system, clan
 *   type 1 (affined): CLANSETTINGS (name, members, the leader's slot, a member's prestige star as
 *   extra-info bit 28, varclansettings 37 size, 39 group prestige, 40/41 Hardcore lives) and
 *   CLANCHANNEL (who is online, on which world). gim_affinitystatus must be 3.
 * - In a group still forming: gim_creation_sidepanel (723): its name and Confirm (the leader forms
 *   the group, as ::gim form), Cancel (the group ends), the members (clan_create_side_list_players).
 * - In none: gim_limited_sidepanel (721), with "Create Group" on The Node.
 * Any Grouping change re-mounts it for the players it touched ("side-channels:refresh"), and so
 * does a change to the group's record (formed, prestige, lives) for its logged-in members.
 */

const Common = require("./Common.GroupIronman");
const Recruiting = require("./Recruiting.GroupIronman");
const Settings = require("./Settings.GroupIronman");
const Variants = require("./Variants.GroupIronman");

const GIM_CLAN = 1;
const NO_SLOT = 0xffff;
const OWNER_RANK = 126;
const MEMBER_RANK = 0;
const PRESTIGE_BIT = 1 << 28;
const WORLD = 1; // as Clans.plugin.js: presence is single-world
const RUNE_DAY_EPOCH_MS = Date.UTC(2002, 1, 27);
const DAY_MS = 24 * 60 * 60 * 1000;
const SETTING = Object.freeze({ SIZE: 37, PRESTIGE: 39, HARDCORE_LOST: 40, LIVES: 41 });
/** The `ironman` varbit's value per mode: the tab's selected value (side_channels_large_init). */
const TAB_VALUE = Object.freeze({ group: 4, "group-hardcore": 5, "group-unranked": 6 });
const LIST_PLAYERS_SCRIPT = 4448;
const NAME_BUTTON_SCRIPT = 4447;
const CREATE_NAME_ENUM = 4053;
const LIMITED_SCRIPT = 5261;
const MESSAGE = Object.freeze({
  NO_GROUP_NODE: "Create a group here, then invite other Group Ironmen.",
  NO_GROUP: "You are not in a group. Groups are formed on The Node.",
  NAME_PROMPT: "Enter your group's name:",
  INVITE_HELP: "Use Invite on a player, or ::group invite <name>.",
});

let updateNum = 0;

const defs = () => Common.api.core.CacheDefinitions;
const uid = (name) => defs().getComponentId(name);
const groupId = (name) => defs().getInterfaceId(name);
const varbit = (name) => defs().getVarbitId(name);

function runeDay(ms) {
  return Math.max(0, Math.floor((ms - RUNE_DAY_EPOCH_MS) / DAY_MS));
}

function send(player, packet) {
  player.getSession?.()?.sendClientPacket?.(packet);
}

function settingsSnapshot(group, record) {
  const ownerSlot = group.members.findIndex((member) => member.role === "leader");
  return {
    updateNum: ++updateNum,
    creationTime: runeDay(record.formed || Date.now()),
    name: group.name || "Group",
    allowGuests: false,
    talkRank: 0,
    kickRank: OWNER_RANK,
    ownerSlot: ownerSlot < 0 ? NO_SLOT : ownerSlot,
    replacementOwnerSlot: NO_SLOT,
    members: group.members.map((member) => ({
      name: member.name,
      rank: member.role === "leader" ? OWNER_RANK : MEMBER_RANK,
      extraInfo: record.formed && record.originals.includes(member.account) ? PRESTIGE_BIT : 0,
      joinRuneDay: runeDay(member.joined || Date.now()),
      muted: false,
    })),
    banned: [],
    settings: [
      { id: SETTING.SIZE, value: group.members.length },
      { id: SETTING.PRESTIGE, value: record.prestige ? 1 : 0 },
      { id: SETTING.HARDCORE_LOST, value: 0 },
      { id: SETTING.LIVES, value: record.variant === "hardcore" ? record.lives : 0 },
    ],
  };
}

function channelSnapshot(group) {
  return {
    key: group.id,
    updateNum,
    name: group.name || "Group",
    talkRank: 0,
    kickRank: OWNER_RANK,
    users: group.members.filter((member) => member.online)
      .map((member) => ({ name: member.name, rank: member.role === "leader" ? OWNER_RANK : MEMBER_RANK, world: WORLD })),
  };
}

function sendRoles(player, member) {
  const sender = player.getPacketSender();
  sender.sendVarbit(varbit("gim_i_am_leader"), member?.role === "leader" ? 1 : 0);
  sender.sendVarbit(varbit("gim_i_am_member"), member ? 1 : 0);
  sender.sendVarbit(varbit("gim_pending_leave"), member?.leaving ? 1 : 0);
}

/** gim_sidepanel's data: the group as clan type 1, and the varbits its scripts read first. */
function sendGroup(player, group, member, record) {
  const { encodeClanSettingsFull, encodeClanChannelFull } = Common.api.core;
  const sender = player.getPacketSender();
  sendRoles(player, member);
  sender.sendVarbit(varbit("gim_affinitystatus"), 3);
  sender.sendVarbit(varbit("gim_invitationstatus"), Recruiting.statusOf(player, member));
  send(player, encodeClanSettingsFull(GIM_CLAN, settingsSnapshot(group, record)));
  send(player, encodeClanChannelFull(GIM_CLAN, channelSnapshot(group)));
}

function sendCreation(player, group, member) {
  const sender = player.getPacketSender();
  const names = group.members.map((entry) => entry.name);
  while (names.length < 5) names.push("");
  sender.sendClientScript(LIST_PLAYERS_SCRIPT, uid("gim_creation_sidepanel:contents"), ...names.slice(0, 5), member?.name ?? "");
  if (group.name) {
    sender.sendClientScript(NAME_BUTTON_SCRIPT, uid("gim_creation_sidepanel:universe"), uid("gim_creation_sidepanel:name"), CREATE_NAME_ENUM, group.name);
  }
  if (member?.role === "leader") {
    sender.sendInterfaceFlagsRange(uid("gim_creation_sidepanel:contents"), 0, 4, 1 << 1);
    Recruiting.targetFlags(player, member);
  }
}

function sendLimited(player) {
  const { encodeClanSettingsFull, encodeClanChannelFull } = Common.api.core;
  send(player, encodeClanSettingsFull(GIM_CLAN, null));
  send(player, encodeClanChannelFull(GIM_CLAN, null));
  const here = Recruiting.onNode(player);
  player.getPacketSender().sendClientScript(LIMITED_SCRIPT, uid("gim_limited_sidepanel:button"), here ? 1 : 0,
    uid("gim_limited_sidepanel:text"), here ? MESSAGE.NO_GROUP_NODE : MESSAGE.NO_GROUP);
}

/** "side-channels:gim-tab" { player, tab, group, onMount }: what the tab shows now. */
function gimTab(request) {
  const { player } = request;
  const tab = TAB_VALUE[Common.modeOf(player)];
  if (!tab) return;
  request.tab = tab;
  const { group, member } = Common.groupOf(player);
  const record = group?.ironman ? Variants.recordFor(group) : null;
  if (!record) {
    sendRoles(player, null);
    request.group = groupId("gim_limited_sidepanel");
    request.onMount = () => sendLimited(player);
  } else if (record.formed) {
    sendGroup(player, group, member, record);
    request.group = groupId("gim_sidepanel");
    request.onMount = () => sendGroup(player, group, member, record);
  } else {
    sendRoles(player, member);
    request.group = groupId("gim_creation_sidepanel");
    request.onMount = () => sendCreation(player, group, member);
  }
}

function refresh(player) {
  if (player) Common.api.emitCustomEvent("side-channels:refresh", { player });
}

/** "grouping:changed": the tab again for every player it touched. */
function changed(event) {
  for (const player of event.players ?? []) refresh(player);
}

/** Store.onUpdate: the group's record changed; its logged-in members see it. */
function recordChanged(record) {
  Common.api?.core?.World?.getPlayers?.()?.forEach((player) => {
    if (player && player.isPlayerBot?.() !== true && Common.groupOf(player).group?.id === record.groupId) refresh(player);
  });
}

/** "ironman:mode-changed": a player who became (or stopped being) a Group Ironman. */
function modeChanged({ player }) {
  refresh(player);
}

/**
 * onInterfaceActionClick on the three panels. Each action that changes something comes back as a
 * Grouping change or a record update, which redraws the tab; a refused one changes nothing.
 */
function click(event) {
  const { player, buttonId, slot } = event;
  const group = buttonId >>> 16;
  if (![groupId("gim_limited_sidepanel"), groupId("gim_creation_sidepanel"), groupId("gim_sidepanel")].includes(group)) return;
  event.handled = true;
  const api = Common.api;
  if (buttonId === uid("gim_limited_sidepanel:button")) {
    if (Recruiting.onNode(player)) api.emitCustomEvent("grouping:create", { player });
  } else if (buttonId === uid("gim_creation_sidepanel:name")) {
    player.setEnteredSyntaxAction({ execute: (name) => api.emitCustomEvent("grouping:rename", { player, name }) });
    player.getPacketSender().sendEnterInputPrompt(MESSAGE.NAME_PROMPT);
  } else if (buttonId === uid("gim_creation_sidepanel:confirm")) {
    Variants.form(player);
  } else if (buttonId === uid("gim_creation_sidepanel:cancel")) {
    const leader = Common.groupOf(player).member?.role === "leader";
    api.emitCustomEvent(leader ? "grouping:disband" : "grouping:leave", { player });
  } else if (buttonId === uid("gim_creation_sidepanel:contents") && Number.isInteger(slot)) {
    const target = Common.groupOf(player).group?.members[slot];
    if (target) api.emitCustomEvent("grouping:kick", { player, target: target.name });
  } else if (buttonId === uid("gim_sidepanel:invite")) {
    Recruiting.toggle(player);
  } else if (buttonId === uid("gim_creation_sidepanel:invite")) {
    player.getPacketSender().sendMessage(MESSAGE.INVITE_HELP);
  } else if (buttonId === uid("gim_sidepanel:settings")) {
    Settings.open(player);
  } else if (buttonId === uid("gim_sidepanel:refresh") || buttonId === uid("gim_creation_sidepanel:refresh")) {
    refresh(player);
  }
}

module.exports = {
  GIM_CLAN, SETTING, TAB_VALUE, MESSAGE,
  settingsSnapshot, channelSnapshot, gimTab, changed, recordChanged, modeChanged, click,
};
