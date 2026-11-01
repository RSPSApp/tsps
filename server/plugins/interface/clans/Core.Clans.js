/**
 * What every part of clans shares: membership, the channel and the packets (docs/clans.md).
 * The clan is persistent (Store.Clans.js); the channel is who is listening right now.
 */

const Store = require("./Store.Clans");
const PERMISSIONS = require("./data/permissions.json");

const OWN_CLAN = 0;
const CLAN_NOTICE_MESSAGE_TYPE = 43;
const CHANNEL_INTRO = "To talk in your clan's channel, start each line of chat with // or /c.";

// clan_affinitystatus and its guest twin: 1 No current clan, 3 loaded (rsprox 3886, script 4288).
const CLAN_STATUS_VARBIT = 933;
const GUEST_CLAN_STATUS_VARBIT = 12164;
const NO_CLAN = 1;
const CLAN_LOADED = 3;
const HOME_WORLD_VARBIT = 12167; // clan_transmit_homeworld
const RECRUITER_VARBIT = 12170; // clan_i_am_recruiter

const RANK_RECRUIT = 0;
const RANK_ADMINISTRATOR = 100;
const RANK_DEPUTY_OWNER = 125;
const RANK_OWNER = 126;
const RANK_ANYONE = -1;
const NO_SLOT = 0xffff;
const MAX_MEMBERS = 500; // Wiki: Clan

const WORLD = 1; // presence is single-world (social-chat-and-following.md)
/** Live's day count: 2026-01-07 is day 8715 (rsprox 3886 settings 8). */
const RUNE_DAY_EPOCH_MS = Date.UTC(2002, 1, 27);
const DAY_MS = 86400000;
/** Wiki: Clan. Resigning takes this long, and an owner away this long resigns by themselves. */
const RESIGN_MS = 7 * DAY_MS;
const OWNER_ABSENT_MS = 90 * DAY_MS;

/** script 4302: bits 0-9 hold rank 0's title, an index into enum 3797 (24 Recruit). */
const RANK_TITLES_SETTING = 1;
const RECRUIT_TITLE = 24;
const TITLE_SETTINGS = [1, 2, 3, 4, 5];
const HOME_WORLD_SETTING = 6;
const LAST_SEEN_DAY_SETTING = 8; // today's day, sent with a member's last seen (rsprox 3886 tick 664)
/** A member's extra info bits 0-12 are their last seen day, less this (rsprox 3886: 1835 on day 8715). */
const LAST_SEEN_OFFSET = 6880;
const LAST_SEEN_END_BIT = 12;

// Permission settings, stored as rank + 2 (`clan_permission_get`; rsprox 3886 has 102 for an Administrator).
const SETTING_PERMISSIONS = 12;
const SETTING_ASSIGN_RANKS = 14;
const SETTING_EXPEL = 15;
const SETTING_TITLES = 16;
const SETTING_RECRUIT = 17;
const SETTING_BAN = 18;
const STRUCT_TALK = 2954;
const STRUCT_KICK = 2955;
const COFFER_DEPOSIT_SETTING = 19;
const PERMISSION_ROWS = PERMISSIONS.filter((row) => row.setting !== null && !row.special);

/** Channels by clan key, built as players join: { clan, updateNum, users: [{ player, rank, name }] }. */
const channels = new Map();
const channelOfPlayer = new Map();

let core = null;

function init(apiCore) {
  core = apiCore;
}

function runeDay(now = Date.now()) {
  return Math.floor((now - RUNE_DAY_EPOCH_MS) / DAY_MS);
}

function accountOf(player) {
  return player.getUsername().toLowerCase();
}

function clanOf(player) {
  return Store.byMember(accountOf(player));
}

function memberOf(clan, account) {
  return clan.members.find((member) => member.account === account);
}

function ownerOf(clan) {
  return clan.members.find((member) => member.rank === RANK_OWNER);
}

function onlinePlayer(account) {
  return core.World.getPlayers().search((player) => accountOf(player) === account) ?? null;
}

function isOnline(player) {
  return core.World.getPlayers().search((other) => other === player) != null;
}

/** Wiki: Clan: the next highest rank, and between equals whoever joined first. */
function successorOf(clan) {
  let best = null;
  for (const member of clan.members) {
    if (member.rank === RANK_OWNER) continue;
    if (!best || member.rank > best.rank || (member.rank === best.rank && member.joinRuneDay < best.joinRuneDay)) {
      best = member;
    }
  }
  return best;
}

/** A new clan's rank for a permission: the row's minimum, else as rsprox 3886's clan has it. */
function defaultRank(row) {
  if (row.minRank !== null) return row.minRank;
  if (row.category.startsWith("Notifications") || row.setting === COFFER_DEPOSIT_SETTING) return RANK_RECRUIT;
  return RANK_ADMINISTRATOR;
}

function permissionRank(clan, setting) {
  const saved = clan.permissions?.[setting];
  return saved ?? defaultRank(PERMISSION_ROWS.find((row) => row.setting === setting));
}

function rowByStruct(struct) {
  return PERMISSIONS.find((row) => row.struct === struct);
}

/** Talk and kick live on the clan itself, as the packets carry them. */
function rowRank(clan, row) {
  if (row.struct === STRUCT_TALK) return clan.talkRank;
  if (row.struct === STRUCT_KICK) return clan.kickRank;
  return permissionRank(clan, row.setting);
}

function titleSetting(clan, setting) {
  return clan.titles?.[setting] ?? (setting === RANK_TITLES_SETTING ? RECRUIT_TITLE : 0);
}

function memberExtraInfo(member) {
  return (member.lastSeenDay ?? LAST_SEEN_OFFSET) - LAST_SEEN_OFFSET;
}

function settingsSnapshot(clan) {
  const ownerSlot = clan.members.findIndex((member) => member.rank === RANK_OWNER);
  const successor = clan.resignDueAt ? successorOf(clan) : null;
  return {
    updateNum: clan.updateNum,
    creationTime: clan.creationTime,
    name: clan.name,
    allowGuests: clan.allowGuests,
    talkRank: clan.talkRank,
    kickRank: clan.kickRank,
    ownerSlot: ownerSlot < 0 ? NO_SLOT : ownerSlot,
    replacementOwnerSlot: successor ? clan.members.indexOf(successor) : NO_SLOT,
    members: clan.members.map((member) => ({
      name: member.name,
      rank: member.rank,
      extraInfo: memberExtraInfo(member),
      joinRuneDay: member.joinRuneDay,
      muted: member.muted,
    })),
    banned: clan.banned ?? [],
    settings: [
      ...TITLE_SETTINGS.map((id) => ({ id, value: titleSetting(clan, id) })),
      { id: HOME_WORLD_SETTING, value: WORLD },
      { id: LAST_SEEN_DAY_SETTING, value: runeDay() },
      ...PERMISSION_ROWS.map((row) => ({ id: row.setting, value: permissionRank(clan, row.setting) + 2 })),
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

function channelOf(player) {
  return channelOfPlayer.get(player);
}

function sendClan(player, clan) {
  send(player, core.encodeClanSettingsFull(OWN_CLAN, clan ? settingsSnapshot(clan) : null));
  const rank = clan ? memberOf(clan, accountOf(player))?.rank ?? RANK_RECRUIT : RANK_RECRUIT;
  player
    .getPacketSender()
    .sendVarbit(CLAN_STATUS_VARBIT, clan ? CLAN_LOADED : NO_CLAN)
    .sendVarbit(GUEST_CLAN_STATUS_VARBIT, NO_CLAN)
    .sendVarbit(HOME_WORLD_VARBIT, clan ? WORLD : 0)
    .sendVarbit(RECRUITER_VARBIT, clan && rank >= permissionRank(clan, SETTING_RECRUIT) ? 1 : 0);
}

/** The changes as live sends them, saved, to everyone online in the clan. */
function sendSettingsDelta(clan, updates) {
  clan.updateNum++;
  Store.save();
  const packet = core.encodeClanSettingsDelta(OWN_CLAN, clan.updateNum, updates);
  for (const member of clan.members) {
    const player = onlinePlayer(member.account);
    if (player) send(player, packet);
  }
}

/** A channel member's rank follows their clan rank. */
function refreshChannel(clan) {
  const channel = channels.get(clan.key);
  if (!channel) return;
  for (const user of channel.users) {
    const member = memberOf(clan, accountOf(user.player));
    if (member) user.rank = member.rank;
  }
  channel.updateNum++;
  const packet = core.encodeClanChannelFull(OWN_CLAN, channelSnapshot(channel));
  for (const { player } of channel.users) send(player, packet);
}

/** Tells everyone online in the clan the whole clan again, for changes with no delta. */
function refreshClan(clan) {
  clan.updateNum++;
  Store.save();
  for (const member of clan.members) {
    const player = onlinePlayer(member.account);
    if (player) sendClan(player, clan);
  }
  refreshChannel(clan);
}

function setMemberRank(clan, member, rank) {
  member.rank = rank;
  sendSettingsDelta(clan, [{ type: "member_rank", index: clan.members.indexOf(member), rank }]);
  refreshChannel(clan);
  const player = onlinePlayer(member.account);
  if (player) {
    player.getPacketSender().sendVarbit(RECRUITER_VARBIT, rank >= permissionRank(clan, SETTING_RECRUIT) ? 1 : 0);
  }
}

function setMemberMuted(clan, member, muted) {
  member.muted = muted;
  sendSettingsDelta(clan, [{ type: "member_muted", index: clan.members.indexOf(member), muted }]);
}

function setRowRank(clan, row, rank) {
  if (row.struct === STRUCT_TALK) clan.talkRank = rank;
  else if (row.struct === STRUCT_KICK) clan.kickRank = rank;
  else {
    clan.permissions = { ...clan.permissions, [row.setting]: rank };
    sendSettingsDelta(clan, [{ type: "int_setting", setting: row.setting, value: rank + 2 }]);
    return;
  }
  refreshClan(clan);
}

function setBanned(clan, names) {
  clan.banned = names;
  refreshClan(clan);
}

function setTitles(clan, titles) {
  clan.titles = Object.fromEntries(titles);
  sendSettingsDelta(clan, [...titles].map(([setting, value]) => ({ type: "int_setting", setting, value })));
}

/** A member logging in, as rsprox 3886 tick 664 has it. */
function noteSeen(clan, member) {
  const day = runeDay();
  member.lastSeenDay = day;
  sendSettingsDelta(clan, [
    {
      type: "member_extra_info",
      index: clan.members.indexOf(member),
      value: memberExtraInfo(member),
      startBit: 0,
      endBit: LAST_SEEN_END_BIT,
    },
    { type: "int_setting", setting: LAST_SEEN_DAY_SETTING, value: day },
  ]);
}

function newMember(player, rank) {
  return {
    account: accountOf(player),
    name: player.getUsername(),
    rank,
    joinRuneDay: runeDay(),
    lastSeenDay: runeDay(),
    muted: false,
    leftChannel: false,
  };
}

/** The players' new clan, with the first of them as its owner. */
function createClan(name, players) {
  const clan = Store.create({
    name,
    creationTime: runeDay(),
    updateNum: 1,
    allowGuests: true,
    talkRank: RANK_ANYONE,
    kickRank: RANK_ADMINISTRATOR,
    ownerLastSeen: Date.now(),
    resignDueAt: 0,
    members: players.map((player, index) => newMember(player, index === 0 ? RANK_OWNER : RANK_RECRUIT)),
  });
  for (const player of players) enterClan(player, clan);
  return clan;
}

function enterClan(player, clan) {
  sendClan(player, clan);
  joinChannel(player, clan, memberOf(clan, accountOf(player)));
  sendNotice(player, CHANNEL_INTRO);
}

function addMember(clan, player, rank = RANK_RECRUIT) {
  const member = newMember(player, rank);
  clan.members.push(member);
  sendSettingsDelta(clan, [{ type: "add_member", name: member.name, joinRuneDay: member.joinRuneDay }]);
  enterClan(player, clan);
}

/** The member's channel and clan go, whether they are online or not. */
function removeMember(clan, account) {
  const index = clan.members.findIndex((member) => member.account === account);
  clan.members.splice(index, 1);
  const player = onlinePlayer(account);
  if (player) {
    removeFromChannel(player);
    send(player, core.encodeClanChannelFull(OWN_CLAN, null));
    sendClan(player, null);
  }
  sendSettingsDelta(clan, [{ type: "delete_member", index }]);
}

function isBanned(clan, name) {
  return (clan.banned ?? []).some((banned) => banned.toLowerCase() === name.toLowerCase());
}

function deleteClan(clan) {
  for (const member of clan.members) {
    const player = onlinePlayer(member.account);
    if (player) {
      removeFromChannel(player);
      send(player, core.encodeClanChannelFull(OWN_CLAN, null));
    }
  }
  channels.delete(clan.key);
  Store.remove(clan);
  for (const member of clan.members) {
    const player = onlinePlayer(member.account);
    if (player) sendClan(player, null);
  }
}

/**
 * Finishes a resignation that is due, and replaces an owner who has been away too long at once
 * (rsprox has the message; Wiki: Clan). Runs when a member logs in or opens the settings, which is
 * when it can matter. The old owner's new rank is ours. A clan with nobody else in it is deleted
 * when its resignation ends.
 */
function settleOwnership(clan, now = Date.now()) {
  const owner = ownerOf(clan);
  const successor = successorOf(clan);
  const absent = now - clan.ownerLastSeen >= OWNER_ABSENT_MS;
  const resigned = clan.resignDueAt && now >= clan.resignDueAt;
  if (resigned && !successor) {
    deleteClan(clan);
    return;
  }
  if (!successor || (!absent && !resigned)) return;
  owner.rank = RANK_DEPUTY_OWNER;
  successor.rank = RANK_OWNER;
  clan.resignDueAt = 0;
  clan.ownerLastSeen = now;
  refreshClan(clan);
  if (!absent || resigned) return;
  const notice = `${owner.name} has been inactive for over 90 days. The new Clan Owner is <col=ef1020>${successor.name}</col>.`;
  for (const member of clan.members) onlinePlayer(member.account)?.sendMessage(notice);
}

function reset() {
  channels.clear();
  channelOfPlayer.clear();
  Store.reset();
}

module.exports = {
  CHANNEL_INTRO,
  MAX_MEMBERS,
  OWN_CLAN,
  RANK_ADMINISTRATOR,
  RANK_OWNER,
  RANK_RECRUIT,
  RESIGN_MS,
  SETTING_ASSIGN_RANKS,
  SETTING_BAN,
  SETTING_EXPEL,
  SETTING_PERMISSIONS,
  SETTING_RECRUIT,
  SETTING_TITLES,
  accountOf,
  addMember,
  channelOf,
  clanOf,
  createClan,
  deleteClan,
  enterClan,
  init,
  isBanned,
  isOnline,
  joinChannel,
  memberOf,
  noteSeen,
  onlinePlayer,
  ownerOf,
  permissionRank,
  refreshClan,
  removeFromChannel,
  removeMember,
  reset,
  rowByStruct,
  rowRank,
  runeDay,
  send,
  sendClan,
  sendNotice,
  setBanned,
  setMemberMuted,
  setMemberRank,
  setRowRank,
  setTitles,
  settleOwnership,
  titleSetting,
};
