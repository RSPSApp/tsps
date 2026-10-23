"use strict";

/**
 * Parties formed at the lobby's Grouping Board: up to eight members, applicants the leader
 * accepts or rejects, and the leader's preferences shown on the list.
 *
 * Captured: the list (977) and details (976) screens and their scripts (10094, 10053, 10058,
 * 10060). The scripts give the rights values, the columns and the buttons (docs/fractured-archive.md).
 * Estimates: the rules behind them (applying, a rejected player is blocked until the leader
 * unblocks, leaving hands the lead to the next member), modelled on the Theatre of Blood's.
 */

const Shared = require("./Shared.FracturedArchive");

/** The rights the details screen's scripts take (10053 and 10060). */
const RIGHTS = { CAN_APPLY: 0, MEMBER: 1, LEADER: 2, APPLICANT: 3, CANNOT_APPLY: 4 };
/** Mode as enum 6051 lists it: Normal, or Practice (not out on live yet). */
const MODE = { NORMAL: 0, PRACTICE: 1 };
/** The applicant rows the details screen has (subs 34-40 accept, 41-47 reject). */
const APPLICANT_ROWS = 7;

const parties = new Map();
let nextId = 1;

class Party {
  constructor(leader) {
    this.id = nextId++;
    /** The tfa_mycontroller value the client is sent while in this party (opaque on live). */
    this.controller = 0x2000000 + this.id;
    this.members = [leader];
    this.applicants = [];
    this.blocked = new Set();
    /** Captured: a new party's preferred size reads 4 before the leader sets one. */
    this.preferredSize = 4;
    this.preferredCompletions = 0;
    this.mode = MODE.NORMAL;
    /** Spectating allowed (976:7, the leader's toggle). */
    this.spectating = true;
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
    if (this.blocked.has(player.getUsername()) || this.isFull() || this.raid) return RIGHTS.CANNOT_APPLY;
    return RIGHTS.CAN_APPLY;
  }

  isFull() {
    return this.members.length >= Shared.MAX_PARTY_SIZE;
  }

  /** How long the party has been listed, in ticks (the list shows it). */
  age() {
    return Shared.cycle() - this.createdCycle;
  }

  apply(player) {
    if (this.rightsOf(player) !== RIGHTS.CAN_APPLY || this.applicants.length >= APPLICANT_ROWS) return false;
    for (const other of parties.values()) other.withdraw(player);
    this.applicants.push(player);
    return true;
  }

  withdraw(player) {
    this.applicants = this.applicants.filter((other) => other !== player);
  }

  accept(applicant) {
    if (!this.applicants.includes(applicant) || this.isFull() || partyOf(applicant)) return false;
    this.withdraw(applicant);
    this.members.push(applicant);
    return true;
  }

  reject(applicant) {
    this.withdraw(applicant);
    this.blocked.add(applicant.getUsername());
  }

  /** Moves a member one place up or down; the leader's place is not taken this way. */
  move(index, by) {
    const to = index + by;
    if (index < 1 || to < 1 || index >= this.members.length || to >= this.members.length) return false;
    [this.members[index], this.members[to]] = [this.members[to], this.members[index]];
    return true;
  }

  /** A member leaves; the next member leads. The last one out ends the party. */
  remove(player) {
    this.members = this.members.filter((other) => other !== player);
    this.withdraw(player);
    if (this.members.length === 0 && !this.raid) this.dispose();
  }

  disband() {
    const members = [...this.members];
    this.members = [];
    this.applicants = [];
    this.dispose();
    return members;
  }

  dispose() {
    parties.delete(this.id);
  }
}

function partyOf(player) {
  for (const party of parties.values()) if (party.has(player)) return party;
  return null;
}

function applicationOf(player) {
  for (const party of parties.values()) if (party.applicants.includes(player)) return party;
  return null;
}

/** Parties on the list: not yet in the Archive, oldest first. */
function listed() {
  return [...parties.values()].filter((party) => !party.raid && party.members.length > 0).slice(0, Shared.LIST_ROWS);
}

function create(leader) {
  return partyOf(leader) ?? new Party(leader);
}

function byId(partyId) {
  return parties.get(partyId) ?? null;
}

module.exports = { RIGHTS, MODE, APPLICANT_ROWS, Party, partyOf, applicationOf, listed, create, byId, parties };
