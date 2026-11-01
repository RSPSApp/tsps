/**
 * Clans (see docs/clans.md): the player's own clan, its channel, `//` chat and the Your Clan tab.
 * The clan is persistent (Store.Clans.js); the channel is who is listening right now.
 */

const Store = require("./Store.Clans");
const { FriendsChatManager } = require("../FriendsChatManager");

const OWN_CLAN = 0;
const CLAN_CHAT_MESSAGE_TYPE = 41;
const CLAN_NOTICE_MESSAGE_TYPE = 43;
const CHANNEL_INTRO = "To talk in your clan's channel, start each line of chat with // or /c.";
const MAX_MESSAGE_LENGTH = 80;
const MAX_NAME_LENGTH = 20;

// clan_affinitystatus and its guest twin: 1 No current clan, 3 loaded (rsprox 3886, script 4288).
const CLAN_STATUS_VARBIT = 933;
const GUEST_CLAN_STATUS_VARBIT = 12164;
const NO_CLAN = 1;
const CLAN_LOADED = 3;
const HOME_WORLD_VARBIT = 12167; // clan_transmit_homeworld
const BUTTON_TIMEOUT_VARBIT = 13806; // clan_transmit_affined_timeout

const YOUR_CLAN_GROUP = 701;
const CHANNEL_BUTTON = 8; // Chat, or Leave once in the channel (rsprox 2528)
const SETTINGS_BUTTON = 9;
/** rsprox 2528 ticks 352-357 and 378-384: the reply to Chat, and how long the button stays grey. */
const JOIN_DELAY_TICKS = 3;
const BUTTON_TIMEOUT_TICKS = 5;

const RANK_RECRUIT = 0;
const RANK_OWNER = 126;
const RANK_ADMINISTRATOR = 100;
const RANK_ANYONE = -1;
const NO_SLOT = 0xffff;

const WORLD = 1; // presence is single-world (social-chat-and-following.md)
/** Live's day count: 2026-01-07 is day 8715 (rsprox 3886 settings 8). */
const RUNE_DAY_EPOCH_MS = Date.UTC(2002, 1, 27);
const DAY_MS = 86400000;
/** script 4302: bits 0-9 hold rank 0's title, an index into enum 3797 (24 Recruit). */
const RANK_TITLES_SETTING = 1;
const RECRUIT_TITLE = 24;
const HOME_WORLD_SETTING = 6;
/** Stored as rank + 2 (`clan_permission_get`; rsprox 3886 has 102 for an Administrator). */
const BAN_RANK_SETTING = 18;

/** Channels by clan key, built as players join: { clan, updateNum, users: [{ player, rank, name }] }. */
const channels = new Map();
const channelOfPlayer = new Map();

let core = null;

function runeDay(now = Date.now()) {
  return Math.floor((now - RUNE_DAY_EPOCH_MS) / DAY_MS);
}

function accountOf(player) {
  return player.getUsername().toLowerCase();
}

function memberOf(clan, account) {
  return clan.members.find((member) => member.account === account);
}

function settingsSnapshot(clan) {
  const ownerSlot = clan.members.findIndex((member) => member.rank === RANK_OWNER);
  return {
    updateNum: clan.updateNum,
    creationTime: clan.creationTime,
    name: clan.name,
    allowGuests: clan.allowGuests,
    talkRank: clan.talkRank,
    kickRank: clan.kickRank,
    ownerSlot: ownerSlot < 0 ? NO_SLOT : ownerSlot,
    replacementOwnerSlot: NO_SLOT,
    members: clan.members.map(({ name, rank, joinRuneDay, muted }) => ({
      name,
      rank,
      extraInfo: 0,
      joinRuneDay,
      muted,
    })),
    banned: [],
    settings: [
      { id: RANK_TITLES_SETTING, value: RECRUIT_TITLE },
      { id: HOME_WORLD_SETTING, value: WORLD },
      { id: BAN_RANK_SETTING, value: RANK_ADMINISTRATOR + 2 },
    ],
  };
}

function channelUser({ name, rank }) {
  return { name, rank, world: WORLD };
}

function channelSnapshot(channel) {
  const { clan, updateNum, users } = channel;
  return {
    key: clan.key,
    updateNum,
    name: clan.name,
    talkRank: clan.talkRank,
    kickRank: clan.kickRank,
    users: users.map(channelUser),
  };
}

function send(player, packet) {
  player.getSession().sendClientPacket(packet);
}

function sendNotice(player, text) {
  player.getPacketSender().sendTypedMessage(CLAN_NOTICE_MESSAGE_TYPE, text);
}

function isOnline(player) {
  return core.World.getPlayers().search((other) => other === player) != null;
}

function sendDelta(channel, event) {
  channel.updateNum++;
  const packet = core.encodeClanChannelDelta(OWN_CLAN, channel.clan.key, channel.updateNum, [event]);
  for (const { player } of channel.users) send(player, packet);
}

function joinChannel(player, clan, member) {
  if (channelOfPlayer.has(player)) return;
  let channel = channels.get(clan.key);
  if (!channel) {
    channel = { clan, updateNum: 0, users: [] };
    channels.set(clan.key, channel);
  }
  const user = { player, rank: member.rank, name: member.name };
  sendDelta(channel, { type: "add", user: channelUser(user) });
  channel.users.push(user);
  channelOfPlayer.set(player, channel);
  send(player, core.encodeClanChannelFull(OWN_CLAN, channelSnapshot(channel)));
}

function removeFromChannel(player) {
  const channel = channelOfPlayer.get(player);
  if (!channel) return;
  channelOfPlayer.delete(player);
  const index = channel.users.findIndex((user) => user.player === player);
  channel.users.splice(index, 1);
  if (channel.users.length === 0) channels.delete(channel.clan.key);
  else sendDelta(channel, { type: "delete", index });
}

function sendClan(player, clan) {
  send(player, core.encodeClanSettingsFull(OWN_CLAN, clan ? settingsSnapshot(clan) : null));
  player
    .getPacketSender()
    .sendVarbit(CLAN_STATUS_VARBIT, clan ? CLAN_LOADED : NO_CLAN)
    .sendVarbit(GUEST_CLAN_STATUS_VARBIT, NO_CLAN)
    .sendVarbit(HOME_WORLD_VARBIT, clan ? WORLD : 0);
}

/** Live's order at login: settings, status, then the channel with its intro line (rsprox 3886, 763). */
function login({ player }) {
  const clan = Store.byMember(accountOf(player));
  sendClan(player, clan);
  if (!clan) {
    send(player, core.encodeClanChannelFull(OWN_CLAN, null));
    return;
  }
  const member = memberOf(clan, accountOf(player));
  if (member.leftChannel) {
    send(player, core.encodeClanChannelFull(OWN_CLAN, null));
    return;
  }
  joinChannel(player, clan, member);
  sendNotice(player, CHANNEL_INTRO);
}

function logout({ player }) {
  removeFromChannel(player);
}

function greyChannelButton(player) {
  player.getPacketSender().sendVarbit(BUTTON_TIMEOUT_VARBIT, 1);
  later(BUTTON_TIMEOUT_TICKS, () => {
    if (isOnline(player)) player.getPacketSender().sendVarbit(BUTTON_TIMEOUT_VARBIT, 0);
  });
}

function later(ticks, action) {
  core.TaskManager.submit(
    new (class extends core.Task {
      constructor() {
        super(ticks, false);
      }
      execute() {
        this.stop();
        action();
      }
    })(),
  );
}

function setLeftChannel(clan, member, leftChannel) {
  member.leftChannel = leftChannel;
  Store.save();
}

function toggleChannel(player) {
  const clan = Store.byMember(accountOf(player));
  if (!clan) return;
  const member = memberOf(clan, accountOf(player));
  greyChannelButton(player);
  if (channelOfPlayer.has(player)) {
    removeFromChannel(player);
    setLeftChannel(clan, member, true);
    send(player, core.encodeClanChannelFull(OWN_CLAN, null));
    return;
  }
  setLeftChannel(clan, member, false);
  later(JOIN_DELAY_TICKS, () => {
    if (isOnline(player) && Store.byMember(accountOf(player)) === clan) joinChannel(player, clan, member);
  });
}

function clickYourClan(event) {
  if (event.groupId !== YOUR_CLAN_GROUP) return;
  if (event.childId === CHANNEL_BUTTON) toggleChannel(event.player);
  else if (event.childId === SETTINGS_BUTTON) event.player.sendMessage("Clan settings are not available yet.");
  else return;
  event.handled = true;
}

function chat(event) {
  const { player, packet } = event;
  if (packet.type !== "clan_chat") return;
  event.handled = true;
  if (packet.clanType !== OWN_CLAN) return;
  const channel = channelOfPlayer.get(player);
  if (!channel) {
    sendNotice(player, "You are not currently in a clan channel.");
    return;
  }
  const text = FriendsChatManager.cleanMessage(packet.text, MAX_MESSAGE_LENGTH);
  if (!text || !FriendsChatManager.allowChat(player, text)) return;
  const message = core.encodeChatMessage(
    "clan",
    text,
    player.getUsername(),
    channel.clan.name,
    player.getIndex(),
    CLAN_CHAT_MESSAGE_TYPE,
  );
  for (const user of channel.users) {
    if (!user.player.getRelations().hasIgnore(player.getLongUsername())) send(user.player, message);
  }
}

function newMember(player, rank) {
  return {
    account: accountOf(player),
    name: player.getUsername(),
    rank,
    joinRuneDay: runeDay(),
    muted: false,
    leftChannel: false,
  };
}

/** Stands in for the Clan Hub until phase 2: makes the player the owner of a new clan. */
function createClanCommand({ player, parts }) {
  const name = parts.slice(1).join(" ").trim();
  if (!name || name.length > MAX_NAME_LENGTH || !/^[a-z0-9 _-]+$/i.test(name)) {
    player.sendMessage(`Use ::clancreate <name>: up to ${MAX_NAME_LENGTH} letters, numbers and spaces.`);
    return true;
  }
  if (Store.byMember(accountOf(player))) {
    player.sendMessage("You are already in a clan.");
    return true;
  }
  if (Store.byName(name)) {
    player.sendMessage("That name is taken.");
    return true;
  }
  const member = newMember(player, RANK_OWNER);
  const clan = Store.create({
    name,
    creationTime: runeDay(),
    updateNum: 1,
    allowGuests: true,
    talkRank: RANK_ANYONE,
    kickRank: RANK_ADMINISTRATOR,
    members: [member],
  });
  sendClan(player, clan);
  joinChannel(player, clan, member);
  sendNotice(player, CHANNEL_INTRO);
  return true;
}

/** Stands in for recruiting until phase 2: adds an online player to the commander's clan. */
function addMemberCommand({ player, parts }) {
  const clan = Store.byMember(accountOf(player));
  const targetName = parts.slice(1).join(" ").trim().replace(/_/g, " ").toLowerCase();
  const target = core.World.getPlayers().search((other) => other.getUsername().toLowerCase() === targetName);
  if (!clan || !target) {
    player.sendMessage(clan ? "That player is not online." : "You are not in a clan.");
    return true;
  }
  if (Store.byMember(accountOf(target))) {
    player.sendMessage("That player is already in a clan.");
    return true;
  }
  const member = newMember(target, RANK_RECRUIT);
  clan.members.push(member);
  clan.updateNum++;
  Store.save();
  for (const other of clan.members) {
    const online = core.World.getPlayers().search((candidate) => accountOf(candidate) === other.account);
    if (online) sendClan(online, clan);
  }
  joinChannel(target, clan, member);
  sendNotice(target, CHANNEL_INTRO);
  return true;
}

function reset() {
  channels.clear();
  channelOfPlayer.clear();
  Store.reset();
}

module.exports = {
  name: "Clans",
  register(api) {
    core = api.core;
    api.onCustomEvent("player:bootstrap-complete", login);
    api.onPlayerLogout(logout);
    api.onSocialPacket(chat);
    api.onInterfaceActionClick(clickYourClan);
    api.registerCommand("clancreate", createClanCommand, api.core.PlayerRights.OWNER, "Create a clan");
    api.registerCommand("clanadd", addMemberCommand, api.core.PlayerRights.OWNER, "Add an online player to your clan");
  },
  _reset: reset,
};
