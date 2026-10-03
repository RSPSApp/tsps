"use strict";

/**
 * Lobby parties: formed at the grouping obelisk, joined by applying and being accepted. The
 * leader's invocation settings are the party's; when they enter the tombs the party becomes
 * a raid and leaves the recruiting list.
 */

const Shared = require("./ToaShared");
const { InvocationSettings } = require("./ToaInvocations");

const ATTR_SETTINGS = "toa:invocation-settings";
const ATTR_PRESETS = "toa:invocation-presets";
const PRESET_COUNT = 5;

/** Recruiting parties, newest last, as the party list shows them. */
const lobbyParties = [];
/** Per-player lobby state: { current, applied, viewing, listed, tab, viewingValue }. */
const lobbyStates = new WeakMap();

function stateOf(player) {
  let state = lobbyStates.get(player);
  if (!state) {
    state = { current: null, applied: null, viewing: null, listed: [], tab: 0, viewingValue: 0 };
    lobbyStates.set(player, state);
  }
  return state;
}

/** The player's own invocation board: what a party they lead starts with. */
function settingsOf(player) {
  let settings = player.getAttribute(ATTR_SETTINGS);
  if (!(settings instanceof InvocationSettings)) {
    const saved = Array.isArray(settings?.bitmaps) ? settings : null;
    settings = new InvocationSettings(saved?.bitmaps, saved?.kcRequirement ?? 0);
    player.setAttribute(ATTR_SETTINGS, settings);
  }
  return settings;
}

function presetsOf(player) {
  let presets = player.getAttribute(ATTR_PRESETS);
  if (!Array.isArray(presets) || presets.length !== PRESET_COUNT) {
    presets = Array.from({ length: PRESET_COUNT }, () => [0, 0, 0]);
    player.setAttribute(ATTR_PRESETS, presets);
  }
  return presets;
}

class LobbyParty {
  constructor(leader) {
    this.players = [];
    this.applicants = [];
    this.blocked = [];
    this.settings = settingsOf(leader);
    this.createdAt = Shared.cycle();
    this.raid = null;
    this.addPlayer(leader);
  }

  get leader() {
    return this.players[0] ?? null;
  }

  get leaderName() {
    return this.leader ? Shared.displayName(this.leader) : "";
  }

  isLeader(player) {
    return this.players[0] === player;
  }

  insideRaid() {
    return this.raid !== null;
  }

  addPlayer(player) {
    this.players.push(player);
    stateOf(player).current = this;
    this.broadcastMembers();
    player.getPacketSender().sendVarbit(Shared.VARBIT.PARTY_STATUS, 1);
  }

  removePlayer(player) {
    this.players = this.players.filter((member) => member !== player);
    if (stateOf(player).current === this) stateOf(player).current = null;
    this.broadcastMembers();
  }

  memberList() {
    const names = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) =>
      this.players[i] ? Shared.displayName(this.players[i]) : "-");
    return names.join("<br>");
  }

  broadcastMembers() {
    const text = this.memberList();
    for (const member of this.players) sendPartyOverlayText(member, text);
  }

  apply(player) {
    if (this.insideRaid() || this.applicants.includes(player) || this.applicants.length >= Shared.MAX_PARTY_SIZE) {
      return false;
    }
    this.applicants.push(player);
    stateOf(player).applied = this;
    return true;
  }

  withdraw(player) {
    if (!this.applicants.includes(player)) return false;
    this.applicants = this.applicants.filter((applicant) => applicant !== player);
    stateOf(player).applied = null;
    return true;
  }

  /** Accepts or declines an applicant; declined players are blocked until unblocked. */
  answer(player, accept) {
    if (this.players.includes(player) || !this.applicants.includes(player) || stateOf(player).applied !== this) {
      return false;
    }
    if (accept && this.players.length >= Shared.MAX_PARTY_SIZE) return false;
    this.withdraw(player);
    if (accept) {
      stateOf(player).current?.leave(player, true);
      this.addPlayer(player);
    } else if (!this.blocked.includes(player)) {
      this.blocked.push(player);
    }
    return true;
  }

  /** Removes a member; the next member leads (taking the old settings) if the leader left. */
  leave(player, clearOverlay) {
    if (!this.players.includes(player)) return false;
    const wasLeader = this.isLeader(player);
    this.removePlayer(player);
    if (wasLeader && this.leader && !this.insideRaid()) {
      const inherited = settingsOf(this.leader);
      inherited.load(this.settings.bitmaps);
      inherited.kcRequirement = this.settings.kcRequirement;
      this.settings = inherited;
    }
    if (this.players.length === 0) this.unlist();
    if (clearOverlay) sendEmptyPartyOverlay(player);
    return true;
  }

  disband() {
    for (const member of [...this.players]) {
      this.removePlayer(member);
      sendEmptyPartyOverlay(member);
      member.sendMessage("Your party has disbanded.");
    }
    for (const applicant of [...this.applicants]) {
      stateOf(applicant).applied = null;
      applicant.sendMessage("The party to which you were applying has disbanded.");
    }
    this.applicants = [];
    this.unlist();
  }

  unlist() {
    const index = lobbyParties.indexOf(this);
    if (index !== -1) lobbyParties.splice(index, 1);
  }
}

function sendPartyOverlayText(player, text) {
  const { INTERFACE } = Shared;
  player.getPacketSender().sendString(text, (INTERFACE.PARTY_OVERLAY << 16) | 5);
}

function sendEmptyPartyOverlay(player) {
  sendPartyOverlayText(player, Array(Shared.MAX_PARTY_SIZE).fill("-").join("<br>"));
  player.getPacketSender().sendVarbit(Shared.VARBIT.PARTY_STATUS, 0);
}

function createParty(leader) {
  const party = new LobbyParty(leader);
  lobbyParties.push(party);
  return party;
}

function isListFull() {
  return lobbyParties.length >= Shared.MAX_LOBBY_PARTIES;
}

function listed(party) {
  return lobbyParties.includes(party);
}

function currentParty(player) {
  return stateOf(player).current;
}

/** Drops a player from every lobby relationship, e.g. on leaving the lobby or logging out. */
function forget(player) {
  const state = stateOf(player);
  const applied = state.applied;
  if (applied) applied.withdraw(player);
  const current = state.current;
  if (current && !current.insideRaid()) current.leave(player, false);
  state.viewing = null;
  return { applied, current };
}

module.exports = {
  LobbyParty,
  lobbyParties,
  stateOf,
  settingsOf,
  presetsOf,
  createParty,
  isListFull,
  listed,
  currentParty,
  forget,
  sendEmptyPartyOverlay,
  PRESET_COUNT,
};
