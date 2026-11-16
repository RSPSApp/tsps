"use strict";

/**
 * Player groups, asked of the Grouping plugin through its "grouping:" events: the party board
 * lets a group leader's new party take the group in, and a member applying to their group's
 * party in at once. Without a group, or without the Grouping plugin, nothing answers and every
 * reply reads as "no group".
 */

const Shared = require("./Shared.TombsOfAmascut");

const ACTIVITY = "Tombs of Amascut";
const GROUPING_EVENT = {
  ACTIVITY: "grouping:activity",
  MEMBERS: "grouping:members",
  SAME_GROUP: "grouping:same-group",
};

/** Tells Grouping, at startup, how many players a raid takes. */
function announce() {
  Shared.api().emitCustomEvent(GROUPING_EVENT.ACTIVITY, { name: ACTIVITY, maxSize: Shared.MAX_PARTY_SIZE });
}

/**
 * The player's group against a raid: isLeader, members (online, leader first), fits and, when
 * it doesn't, message.
 */
function membersOf(player) {
  const request = { player, activity: ACTIVITY, maxSize: Shared.MAX_PARTY_SIZE };
  Shared.api().emitCustomEvent(GROUPING_EVENT.MEMBERS, request);
  return request;
}

function sameGroup(player, other) {
  const request = { player, other };
  Shared.api().emitCustomEvent(GROUPING_EVENT.SAME_GROUP, request);
  return request.same === true;
}

module.exports = { ACTIVITY, announce, membersOf, sameGroup };
