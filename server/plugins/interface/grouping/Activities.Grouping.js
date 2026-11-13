"use strict";

/**
 * A group against the activities that use groups. Each minigame says how many players it takes
 * ("grouping:activity" { name, maxSize }, at its startup), from its own rules, so Grouping keeps no
 * table of its own. A minigame forming a party asks for the group ("grouping:members"), and two
 * players can be checked for sharing one ("grouping:same-group").
 *
 * - "grouping:activity" { name, maxSize }
 * - "grouping:members" { player, activity?, maxSize? } -> groupId (0 for none), leader (the
 *   leader's player while online, else null), isLeader, members (the members online, leader first;
 *   just the player without a group), size (every member), max, fits, message (why it doesn't fit)
 * - "grouping:same-group" { player, other } -> same
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");

/** Activity name -> the most players it takes. */
const activities = new Map();

function groupOf(player) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  return { me, group };
}

function announce({ name, maxSize } = {}) {
  if (typeof name === "string" && name && Number.isInteger(maxSize) && maxSize > 0) activities.set(name, maxSize);
}

function tooBigMessage(size, activity, max) {
  return `Your group has ${size} players; ${activity} takes at most ${max}.`;
}

function answerMembers(request) {
  const { me, group } = groupOf(request.player);
  const max = Number.isInteger(request.maxSize) ? request.maxSize : activities.get(request.activity) ?? null;
  request.max = max;
  if (!group) {
    Object.assign(request, {
      groupId: 0, leader: null, isLeader: false, members: request.player ? [request.player] : [], size: 1, fits: true,
    });
    return;
  }
  const online = Members.ordered(group).map((account) => Members.onlinePlayer(group.profile, account)).filter(Boolean);
  Object.assign(request, {
    groupId: group.id,
    leader: Members.onlinePlayer(group.profile, group.leader),
    isLeader: group.leader === me.account,
    members: online,
    size: group.members.size,
    fits: max === null || group.members.size <= max,
  });
  if (!request.fits) request.message = tooBigMessage(group.members.size, request.activity ?? "That activity", max);
}

function answerSameGroup(request) {
  const mine = groupOf(request.player);
  const theirs = groupOf(request.other);
  request.same = !!mine.group && mine.group === theirs.group;
}

/** The activities this group has too many players for, as "Name (max)". */
function tooBigFor(group) {
  return [...activities].filter(([, max]) => group.members.size > max).map(([name, max]) => `${name} (${max})`);
}

/** Forgets every announcement, for tests. */
function reset() {
  activities.clear();
}

module.exports = { activities, announce, answerMembers, answerSameGroup, tooBigFor, tooBigMessage, reset };
