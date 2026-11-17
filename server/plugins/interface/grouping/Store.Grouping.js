"use strict";

/**
 * The groups (Grouping.plugin.js), written whole to data/saves/groups.json on every change, as
 * the clans' store is: there are few of them and they change rarely. Pending invitations and who
 * is logged in live only in memory, since a logout or a restart ends both.
 *
 * A member is the encoded name of their account (FriendsChatManager's accountName, the value
 * PlayerRelations keys friends and ignores by), so a display-name change, a case change or
 * "a_b" for "a b" can't make a second entry. A group belongs to one character profile: an
 * account's main, league and hardcore characters share its name but not their groups.
 *
 * Group: { id, profile, leader, members: Set<encoded>, joined: Map<encoded, ms>,
 *          invites: Map<encoded, expiry ms>, ironman: boolean,
 *          leaving: Map<encoded, { until: ms, kicked: boolean }>, seen: Map<encoded, ms>,
 *          stepDown: { successor: encoded, until: ms } | null, name: string ("" for none) }
 * A Group Ironman group (ironman) keeps a member who leaves or is removed for a while, in leaving;
 * seen is when each member last logged in or out, and stepDown a leader's hand-over still waiting.
 */

const fs = require("fs");
const path = require("path");

const FILE_ENV = "TSPS_GROUPS_FILE";
const DEFAULT_FILE = path.join("data", "saves", "groups.json");

let groups = null;
let nextId = 1;
/** "profile|encoded" -> the group that account is in. */
const memberships = new Map();
/** "profile|encoded" of every account logged in now. */
const present = new Set();
/** encoded -> the login name as its owner types it ("MikeDev"), for one without a display name. */
const spellings = new Map();

const slot = (profile, account) => `${profile}|${account}`;

function file() {
  return process.env[FILE_ENV] || path.join(process.cwd(), DEFAULT_FILE);
}

function revive(saved) {
  const members = saved.members.map((member) => [BigInt(member.account), Number(member.joined) || 0]);
  for (const member of saved.members) {
    if (typeof member.name === "string" && member.name) spellings.set(BigInt(member.account), member.name);
  }
  const leaving = (saved.leaving ?? []).map((entry) =>
    [BigInt(entry.account), { until: Number(entry.until) || 0, kicked: entry.kicked === true }]);
  return {
    id: saved.id,
    profile: saved.profile,
    leader: BigInt(saved.leader),
    members: new Set(members.map(([account]) => account)),
    joined: new Map(members),
    invites: new Map(),
    ironman: saved.ironman === true,
    leaving: new Map(leaving),
    seen: new Map(saved.members.filter((member) => Number(member.seen) > 0)
      .map((member) => [BigInt(member.account), Number(member.seen)])),
    stepDown: saved.stepDown
      ? { successor: BigInt(saved.stepDown.successor), until: Number(saved.stepDown.until) || 0 } : null,
    name: typeof saved.name === "string" ? saved.name : "",
  };
}

function load() {
  if (groups) return groups;
  const loaded = new Map();
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    groups = loaded;
    return groups;
  }
  for (const record of saved.groups ?? []) loaded.set(record.id, revive(record));
  // Only once it has all been read: a file that can't be keeps throwing, so save() can't replace it.
  groups = loaded;
  nextId = Math.max(1, Number(saved.nextId) || 1);
  memberships.clear();
  for (const group of groups.values()) {
    for (const account of group.members) memberships.set(slot(group.profile, account), group);
  }
  return groups;
}

function serialise(group) {
  return {
    id: group.id,
    profile: group.profile,
    leader: String(group.leader),
    members: [...group.members].map((account) => ({
      account: String(account), name: spellings.get(account) ?? "", joined: group.joined.get(account) ?? 0,
      ...(group.seen.get(account) ? { seen: group.seen.get(account) } : {}),
    })),
    ...(group.ironman ? { ironman: true } : {}),
    ...(group.name ? { name: group.name } : {}),
    ...(group.stepDown ? { stepDown: { successor: String(group.stepDown.successor), until: group.stepDown.until } } : {}),
    ...(group.leaving.size ? {
      leaving: [...group.leaving].map(([account, { until, kicked }]) => ({ account: String(account), until, kicked })),
    } : {}),
  };
}

function save() {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ nextId, groups: [...load().values()].map(serialise) }, null, 2));
  fs.renameSync(temporary, target);
}

function groupOf(profile, account) {
  load();
  return memberships.get(slot(profile, account));
}

function byId(id) {
  return load().get(Number(id));
}

function all() {
  return load().values();
}

/** A new group led by `leader`; `ironman` makes it a Group Ironman group for good. */
function create(profile, leader, now, ironman = false) {
  load();
  const group = {
    id: nextId++, profile, leader, members: new Set([leader]), joined: new Map([[leader, now]]), invites: new Map(),
    ironman: ironman === true, leaving: new Map(), seen: new Map([[leader, now]]), stepDown: null, name: "",
  };
  groups.set(group.id, group);
  memberships.set(slot(profile, leader), group);
  save();
  return group;
}

/** Adds the account, which must not be in a group: the caller checks that and the member cap first. */
function addMember(group, account, now) {
  group.members.add(account);
  group.joined.set(account, now);
  group.seen.set(account, now);
  group.invites.delete(account);
  memberships.set(slot(group.profile, account), group);
  save();
}

/** Removes a member other than the leader (the caller hands the lead on first). */
function removeMember(group, account) {
  group.members.delete(account);
  group.joined.delete(account);
  group.leaving.delete(account);
  group.seen.delete(account);
  if (group.stepDown?.successor === account) group.stepDown = null;
  memberships.delete(slot(group.profile, account));
  save();
}

function setLeader(group, account) {
  group.leader = account;
  group.stepDown = null;
  save();
}

/** A leader's hand-over to `successor` at `until` (ms), or null to call it off. */
function setStepDown(group, stepDown) {
  group.stepDown = stepDown;
  save();
}

function setName(group, name) {
  group.name = name;
  save();
}

/** The group with this name, ignoring case, or undefined. */
function byName(name) {
  const wanted = String(name ?? "").toLowerCase();
  return [...all()].find((group) => group.name && group.name.toLowerCase() === wanted);
}

/** Notes when a member last logged in or out (saved, for the inactive-leader rule). */
function markSeen(group, account, now) {
  if (!group.members.has(account)) return;
  group.seen.set(account, now);
  save();
}

/** Marks a member of a Group Ironman group as leaving until `until` (ms); `kicked` if removed by the leader. */
function setLeaving(group, account, until, kicked) {
  group.leaving.set(account, { until, kicked: kicked === true });
  save();
}

function clearLeaving(group, account) {
  if (group.leaving.delete(account)) save();
}

function remove(group) {
  for (const account of group.members) memberships.delete(slot(group.profile, account));
  load().delete(group.id);
  save();
}

/** Members other than the leader, longest-serving first (the earlier joiner wins a tie, as on the Wiki). */
function byTenure(group) {
  return [...group.members]
    .filter((account) => account !== group.leader)
    .sort((a, b) => (group.joined.get(a) ?? 0) - (group.joined.get(b) ?? 0));
}

/** Drops the group's invitations that have run out, and answers whether this one still stands. */
function invitationStands(group, account, now) {
  const expires = group.invites.get(account);
  if (expires === undefined) return false;
  if (expires > now) return true;
  group.invites.delete(account);
  return false;
}

/** The groups that have invited this account and whose invitation still stands, oldest first. */
function invitationsFor(profile, account, now) {
  return [...all()]
    .filter((group) => group.profile === profile && invitationStands(group, account, now))
    .sort((a, b) => a.invites.get(account) - b.invites.get(account));
}

/** Withdraws every invitation to this account; returns the groups that had one. */
function withdrawInvitations(profile, account) {
  const touched = [];
  for (const group of all()) {
    if (group.profile === profile && group.invites.delete(account)) touched.push(group);
  }
  return touched;
}

function setPresent(profile, account, online) {
  if (online) present.add(slot(profile, account));
  else present.delete(slot(profile, account));
}

function isPresent(profile, account) {
  return present.has(slot(profile, account));
}

/** Notes how the account's owner spells their login name; a member's spelling is saved with them. */
function rememberSpelling(account, username) {
  if (!username || spellings.get(account) === username) return;
  spellings.set(account, username);
  for (const group of all()) {
    if (group.members.has(account)) {
      save();
      return;
    }
  }
}

function spellingOf(account) {
  load();
  return spellings.get(account);
}

/** Forgets what is in memory, so tests can read the file again as a restart would. */
function reset() {
  groups = null;
  nextId = 1;
  memberships.clear();
  present.clear();
  spellings.clear();
}

module.exports = {
  FILE_ENV, all, byId, byName, groupOf, create, setName, addMember, removeMember, setLeader, setStepDown, markSeen, setLeaving, clearLeaving,
  remove, byTenure,
  invitationStands, invitationsFor, withdrawInvitations, setPresent, isPresent, rememberSpelling, spellingOf,
  save, reset,
};
