/**
 * What every part of clans shares: membership, the channel and the packets (docs/clans.md).
 * The clan is persistent (Store.Clans.js); the channel is who is listening right now.
 */

const Store = require("./Store.Clans");

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
const HOME_WORLD_SETTING = 6;
/** Stored as rank + 2 (`clan_permission_get`; rsprox 3886 has 102 for an Administrator). */
const BAN_RANK_SETTING = 18;

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
    .sendVarbit(RECRUITER_VARBIT, rank >= RANK_ADMINISTRATOR ? 1 : 0);
}

/** Tells everyone online in the clan what changed, ranks in the channel included. */
function refreshClan(clan) {
  clan.updateNum++;
  Store.save();
  const channel = channels.get(clan.key);
  for (const member of clan.members) {
    const player = onlinePlayer(member.account);
    if (player) sendClan(player, clan);
  }
  if (!channel) return;
  for (const user of channel.users) {
    const member = memberOf(clan, accountOf(user.player));
    if (member) user.rank = member.rank;
  }
  channel.updateNum++;
  const packet = core.encodeClanChannelFull(OWN_CLAN, channelSnapshot(channel));
  for (const { player } of channel.users) send(player, packet);
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
  clan.members.push(newMember(player, rank));
  refreshClan(clan);
  enterClan(player, clan);
}

/** The member's channel and clan go, whether they are online or not. */
function removeMember(clan, account) {
  clan.members = clan.members.filter((member) => member.account !== account);
  const player = onlinePlayer(account);
  if (player) {
    removeFromChannel(player);
    send(player, core.encodeClanChannelFull(OWN_CLAN, null));
    sendClan(player, null);
  }
  refreshClan(clan);
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
 * Finishes a resignation that is due, and starts one for an owner who has been away too long
 * (Wiki: Clan). Runs when a member logs in or opens the settings, which is when it can matter.
 * The Wiki doesn't give the old owner's new rank. A clan with nobody else in it is deleted.
 */
function settleOwnership(clan, now = Date.now()) {
  if (!clan.resignDueAt && now - clan.ownerLastSeen >= OWNER_ABSENT_MS) {
    clan.resignDueAt = now + RESIGN_MS;
    Store.save();
  }
  if (!clan.resignDueAt || now < clan.resignDueAt) return;
  const owner = ownerOf(clan);
  const successor = successorOf(clan);
  if (!successor) {
    deleteClan(clan);
    return;
  }
  owner.rank = RANK_DEPUTY_OWNER;
  successor.rank = RANK_OWNER;
  clan.resignDueAt = 0;
  clan.ownerLastSeen = now;
  refreshClan(clan);
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
  accountOf,
  addMember,
  channelOf,
  clanOf,
  createClan,
  deleteClan,
  enterClan,
  init,
  isOnline,
  joinChannel,
  memberOf,
  onlinePlayer,
  ownerOf,
  refreshClan,
  removeFromChannel,
  removeMember,
  reset,
  runeDay,
  send,
  sendClan,
  sendNotice,
  settleOwnership,
};
