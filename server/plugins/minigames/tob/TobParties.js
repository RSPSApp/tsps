"use strict";

/**
 * Parties formed at Ver Sinhaza's notice board: up to five members, ten applicants, a leader
 * who accepts or declines them, and the preferred size and combat level shown on the list.
 *
 * Captured: the interface scripts (2317, 2321, 2323, 2340). Estimates: the party rules
 * (applying, declining blocks a player, the leader is the first member). Wiki: one to five
 * players.
 */

const Shared = require("./TobShared");

/** Party rights as the information screen's footer script takes them (estimate). */
const RIGHTS = { CAN_APPLY: 0, MEMBER: 1, LEADER: 2, APPLICANT: 3, BLOCKED: 4 };
const DEFAULT_COMBAT = 3;

const parties = new Map();
let nextId = 1;

class Party {
  constructor(leader) {
    this.id = nextId++;
    this.members = [leader];
    this.applicants = [];
    this.blocked = new Set();
    this.preferredSize = 0;
    this.preferredCombat = DEFAULT_COMBAT;
    /** Normal mode only for now; Entry and Hard would set this. */
    this.mode = "normal";
    this.createdCycle = Shared.cycle();
    this.raid = null;
    parties.set(this.id, this);
  }

  get leader() {
    return this.members[0] ?? null;
  }

  isLeader(player) {
    return this.leader === player;
  }

  has(player) {
    return this.members.includes(player);
  }

  rightsOf(player) {
    if (this.isLeader(player)) return RIGHTS.LEADER;
    if (this.has(player)) return RIGHTS.MEMBER;
    if (this.applicants.includes(player)) return RIGHTS.APPLICANT;
    if (this.blocked.has(player.getUsername())) return RIGHTS.BLOCKED;
    return RIGHTS.CAN_APPLY;
  }

  /** How long the party has been listed, in ticks (the list shows it). */
  age() {
    return Shared.cycle() - this.createdCycle;
  }

  /** Applying to one party withdraws any other application. */
  apply(player) {
    for (const other of parties.values()) {
      if (other !== this) other.applicants = other.applicants.filter((applicant) => applicant !== player);
    }
    if (!this.applicants.includes(player)) this.applicants.push(player);
  }

  withdraw(player) {
    this.applicants = this.applicants.filter((applicant) => applicant !== player);
  }

  accept(player) {
    if (!this.applicants.includes(player) || this.members.length >= Shared.MAX_PARTY_SIZE) return false;
    this.withdraw(player);
    this.members.push(player);
    return true;
  }

  decline(player) {
    this.withdraw(player);
    this.blocked.add(player.getUsername());
  }

  /** Takes a member out; an empty party is gone. Returns whether the party still exists. */
  remove(player) {
    this.members = this.members.filter((member) => member !== player);
    if (this.members.length === 0) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    parties.delete(this.id);
    this.members = [];
    this.applicants = [];
  }
}

function create(leader) {
  return new Party(leader);
}

function partyOf(player) {
  for (const party of parties.values()) if (party.has(player)) return party;
  return null;
}

function applicationOf(player) {
  for (const party of parties.values()) if (party.applicants.includes(player)) return party;
  return null;
}

/** Parties still recruiting (not in the theatre), in the order they were formed. */
function listed() {
  return [...parties.values()].filter((party) => !party.raid);
}

function byId(id) {
  return parties.get(id) ?? null;
}

module.exports = { RIGHTS, Party, create, partyOf, applicationOf, listed, byId, parties };
