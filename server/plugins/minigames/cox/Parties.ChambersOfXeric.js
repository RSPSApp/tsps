"use strict";

/**
 * Raiding parties. A party belongs to a chat-channel: whoever makes it leads it, the
 * channel's members on Mount Quidamortem are its raiders, and leaving the channel leaves the
 * party. A party can be advertised on the recruiting board.
 *
 * Not on the Wiki (to check against a capture): one party per chat-channel, made by a Recruit or above; the board lists 40;
 * the preferred size, combat level and skill total are only shown, never enforced; Challenge
 * Mode is a party setting that can't change once the party is inside; a leader leaving hands
 * the party to the highest-ranked raider who can kick, or else disbands it.
 * rsprox captures 820, 843 and 3389: the party also has a scale (a number of players to scale the
 * raid by, 0 for none) and a map layout (Small, Large or Full; Challenge Mode is always Full).
 * The maker's last scale and layout are remembered for their next party.
 */

const Shared = require("./Shared.ChambersOfXeric");

const parties = new Map();
const advertised = [];

class Party {
  constructor(leader, channel) {
    this.leader = leader.getUsername();
    this.channelKey = channel.key;
    this.created = Shared.cycle();
    this.preferredSize = 0;
    this.preferredCombat = 0;
    this.preferredTotal = 0;
    this.scaling = Number(leader.getAttribute(Shared.ATTR.LAST_SCALING)) || 0;
    this.layoutPool = Number(leader.getAttribute(Shared.ATTR.LAST_LAYOUT)) || Shared.LAYOUT_POOL.SMALL;
    this.challenge = false;
    this.raid = null;
  }

  /** The layout the raid will generate: Challenge Mode's is always the full one. */
  get layout() {
    return this.challenge ? Shared.LAYOUT_POOL.FULL : this.layoutPool;
  }

  isLeader(player) {
    return this.leader.toLowerCase() === player.getUsername().toLowerCase();
  }

  /** The party's chat-channel as one of its members is in it, or null if they aren't. */
  channel(player) {
    const channel = player ? Shared.channelOf(player) : null;
    return channel?.key === this.channelKey ? channel : null;
  }

  /** Everyone in the party's chat-channel. */
  members() {
    return Shared.channelByKey(this.channelKey)?.members ?? [];
  }

  isAdvertised() {
    return advertised.includes(this);
  }

  /** The party can't be changed once its raid has been built. */
  isLocked() {
    return !!this.raid?.map;
  }
}

function partyOf(player) {
  const channel = Shared.channelOf(player);
  return channel ? parties.get(channel.key) ?? null : null;
}

function partyForChannel(key) {
  return parties.get(key) ?? null;
}

function create(player, channel) {
  const party = new Party(player, channel);
  parties.set(channel.key, party);
  return party;
}

function advertise(party) {
  if (party.isAdvertised()) return true;
  if (advertised.length >= Shared.BOARD_ROWS) return false;
  advertised.push(party);
  return true;
}

function delist(party) {
  const index = advertised.indexOf(party);
  if (index >= 0) advertised.splice(index, 1);
}

function disband(party) {
  delist(party);
  if (parties.get(party.channelKey) === party) parties.delete(party.channelKey);
  party.raid?.destroy("disbanded");
  party.raid = null;
}

/**
 * Hands the party to the best-ranked raider (one who can kick from the channel) when its
 * leader leaves; false if there is none.
 */
function appointLeader(party, leaving) {
  const raid = party.raid;
  if (!raid) return false;
  const candidates = [...raid.players].filter((player) => player !== leaving);
  let best = null;
  let bestRank = -Infinity;
  for (const player of candidates) {
    const channel = party.channel(player);
    if (!channel) continue;
    const rank = channel.rankOf(player);
    if (rank >= channel.kickRank && rank > bestRank) {
      best = player;
      bestRank = rank;
    }
  }
  if (!best) return false;
  party.leader = best.getUsername();
  for (const player of raid.players) {
    Shared.raidMessage(player, player === best ? "You are the new party leader." : `${Shared.displayName(best)} is your new party leader.`);
  }
  raid.refreshTabs();
  return true;
}

function all() {
  return [...parties.values()];
}

function listed() {
  return [...advertised];
}

function clear() {
  parties.clear();
  advertised.length = 0;
}

module.exports = { Party, partyOf, partyForChannel, create, advertise, delist, disband, appointLeader, all, listed, clear };
