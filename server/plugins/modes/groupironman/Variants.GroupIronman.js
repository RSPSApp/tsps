"use strict";

/**
 * What kind of Group Ironman group a group is, forming it, and who may join (Wiki, Group Ironman
 * Mode; launch post).
 *
 * - A group plays its leader's mode from its creation: ranked (Group Ironman), Hardcore or
 *   Unranked. Its members play the same mode; a login puts a member's mode right after the group
 *   changed while they were away (Hardcore status lost, gone Unranked).
 * - Forming: until the leader forms it (::gim form, at least two members), invitations cost
 *   nothing and everyone in it becomes an original member (individual prestige). Forming gives
 *   Group Prestige unless the leader opts out (::gim form noprestige) or it is Unranked; a Hardcore
 *   group always keeps it (Wiki: Hardcore groups must keep prestige) and gets a life per member.
 * - Joining: an Unranked Group Ironman joins only Unranked groups, and anyone joining one becomes
 *   Unranked. A ranked group that takes a player who has played before becomes Unranked for good;
 *   a formed group with prestige that takes anyone loses it. Either way the leader is warned at
 *   the first invitation and confirms by inviting again within two minutes. A formed Hardcore
 *   group takes nobody (launch post), and takes only Hardcore players while forming.
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");

/** Set when a Group Ironman has played before: after leaving a group (and later The Node). */
const EXPERIENCED_ATTRIBUTE = "group-ironman:experienced";
const CONFIRM_MS = 2 * 60 * 1000;
const LEADER_ONLY = "Only the group leader can do that.";

/** inviter -> { key, until }: a warning given for one invitation, waiting for the second. */
const warnings = new WeakMap();
/** "leader|account" -> what the confirmed invitation does when they join ("unranked"). */
const confirmed = new Map();

function isExperienced(player) {
  return player?.getAttribute?.(EXPERIENCED_ATTRIBUTE) === true;
}

/** The group's record, made from its leader's mode when it has none yet. */
function recordFor(group, leader = null) {
  const record = Store.get(group.id);
  if (record) return record;
  const mode = Common.modeOf(leader ?? Common.onlinePlayer(group.leader));
  return Store.ensure(group.id, Common.variantOfMode(mode) ?? "ranked");
}

/** "grouping:changed" "created": a Group Ironman group plays its leader's mode. */
function created(event) {
  if (event.group?.ironman) recordFor(event.group);
}

/** Warns once per invitation; true when this is the confirming second invitation. */
function confirmedAfterWarning(inviter, key, warningKey, values) {
  const now = Date.now();
  const warning = warnings.get(inviter);
  if (warning?.key === key && warning.until > now) {
    warnings.delete(inviter);
    return true;
  }
  warnings.set(inviter, { key, until: now + CONFIRM_MS });
  return Common.message(warningKey, values);
}

function refuse(request, key, values) {
  request.allowed = false;
  request.reason = Common.message(key, values);
}

/** "grouping:can-join": the Group Ironman rules for an invitation or a join. */
function canJoin(request) {
  const { player, inviter, stage } = request;
  const theirs = Common.variantOfMode(Common.modeOf(player));
  if (!theirs || (request.group && !request.group.ironman)) return;
  const record = request.group
    ? recordFor(request.group)
    : { variant: Common.variantOfMode(Common.modeOf(inviter)) ?? "ranked", formed: 0, prestige: false };
  const account = Common.groupOf(player).account;
  const leader = request.group?.leader ?? Common.groupOf(inviter).account;
  const slot = `${leader}|${account}`;
  if (record.variant === "hardcore") {
    if (record.formed) return refuse(request, "hardcoreNoNewMembers");
    if (theirs !== "hardcore") return refuse(request, isExperienced(player) ? "hardcoreNoUnranked" : "variantMismatch");
    return;
  }
  if (record.variant === "unranked") return;
  if (theirs === "hardcore") return refuse(request, "variantMismatch");
  const converts = theirs === "unranked" || isExperienced(player);
  const costsPrestige = record.formed && record.prestige;
  if (!converts && !costsPrestige) return;
  if (stage === "join") {
    if (converts && confirmed.get(slot) !== "unranked") refuse(request, "variantMismatch");
    return;
  }
  const key = `${slot}|${converts ? "unranked" : "prestige"}`;
  const warningKey = converts ? "warnUnranked" : "warnPrestige";
  const answer = confirmedAfterWarning(inviter, key, warningKey, { name: player.getDisplayName?.() ?? player.getUsername() });
  if (answer !== true) {
    request.allowed = false;
    request.reason = answer;
    return;
  }
  if (converts) confirmed.set(slot, "unranked");
}

/** Makes the group Unranked for good: no prestige, no Hardcore lives, every member Unranked. */
function makeUnranked(record, group) {
  record.variant = "unranked";
  record.prestige = false;
  record.lives = 0;
  Store.update(record);
  for (const member of group.members) {
    const player = member.online ? Common.onlinePlayer(member.account) : null;
    if (player) Common.setMode(player, Common.modeOfVariant("unranked"));
  }
  Common.tellGroup(group, "nowUnranked");
}

/** "grouping:changed" "joined": conversions and prestige, as warned at the invitation. */
function joined(event) {
  if (!event.group?.ironman) return;
  const record = recordFor(event.group);
  const joiner = Common.onlinePlayer(event.target);
  const slot = `${event.group.leader}|${event.target}`;
  const conversion = confirmed.get(slot);
  confirmed.delete(slot);
  if (record.variant === "unranked") {
    if (joiner && Common.modeOf(joiner) !== Common.modeOfVariant("unranked")) {
      Common.setMode(joiner, Common.modeOfVariant("unranked"));
      Common.tell(joiner, "youAreUnranked");
    }
    return;
  }
  if (conversion === "unranked") {
    makeUnranked(record, event.group);
    return;
  }
  if (record.formed && record.prestige) {
    record.prestige = false;
    Store.update(record);
    Common.tellGroup(event.group, "prestigeLost");
  }
}

/** ::gim form [noprestige]: the leader forms the group; its members now are its originals. */
function form(player, optOut = false, now = Date.now()) {
  const { group, member } = Common.groupOf(player);
  if (!group?.ironman) return Common.tell(player, "notIronGroup");
  if (member?.role !== "leader") return void player.getPacketSender().sendMessage(LEADER_ONLY);
  const record = recordFor(group, player);
  if (record.formed) return Common.tell(player, "alreadyFormed");
  if (group.members.length < Common.data.groupSize.min) return Common.tell(player, "formTooSmall");
  record.formed = now;
  record.originals = group.members.map((entry) => entry.account);
  record.prestige = record.variant === "hardcore" || (record.variant === "ranked" && !optOut);
  if (record.variant === "hardcore") record.lives = group.members.length;
  Store.update(record);
  Common.tellGroup(group, "formed");
  Common.tellGroup(group, record.prestige ? "formedPrestige" : "formedNoPrestige");
  return true;
}

/** "account:banned" { name }: a member banned for good costs a formed group its Group Prestige (Wiki). */
function memberBanned({ name }) {
  const query = { name, groups: [] };
  Common.api.emitCustomEvent("grouping:of-account", query);
  for (const group of query.groups ?? []) {
    const record = group.ironman ? Store.get(group.id) : null;
    if (!record?.formed || !record.prestige) continue;
    record.prestige = false;
    Store.update(record);
    Common.tellGroup(group, "prestigeLost");
  }
}

/** "grouping:leaving-period": a group still forming has none; its members come and go at once. */
function leavingPeriod(request) {
  if (!Store.get(request.groupId)?.formed) request.period = false;
}

/** A login: the member plays their group's mode (never back up from Unranked). */
function login({ player }) {
  const { group } = Common.groupOf(player);
  const record = group?.ironman ? Store.get(group.id) : null;
  const current = Common.variantOfMode(Common.modeOf(player));
  if (!record || !current || current === record.variant || current === "unranked") return;
  if (record.variant === "ranked" && current !== "hardcore") return;
  Common.setMode(player, Common.modeOfVariant(record.variant));
  Common.tell(player, record.variant === "unranked" ? "youAreUnranked" : "hardcoreLost");
}

module.exports = {
  EXPERIENCED_ATTRIBUTE, CONFIRM_MS, isExperienced, recordFor, created, canJoin, joined, makeUnranked, form,
  leavingPeriod, memberBanned, login,
};
