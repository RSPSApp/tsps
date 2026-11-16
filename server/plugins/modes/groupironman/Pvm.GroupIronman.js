"use strict";

/**
 * Group PvM with players outside the group (Wiki, Group Ironman Mode: Prestige; Hardcore Group
 * Ironman). Content that starts a group activity asks "group-pvm:can-start" { players, activity,
 * allowed, reason } with everyone taking part, then says "group-pvm:started" { players, activity }
 * (the raids: Chambers of Xeric, Theatre of Blood, Tombs of Amascut, The Fractured Archive). A
 * boss's door asks the same with `entrant`, the player walking in to those already there (Nex,
 * The Nightmare, the Royal Titans): only the entrant is judged, so nobody inside can lock out the
 * public.
 *
 * - A Hardcore group must keep its prestige, so its members may not start one with anyone outside
 *   the group: refused, with a line saying why (Wiki: "a message will appear ... blocking the
 *   player from entering"; the line is ours).
 * - A ranked group with Group Prestige is warned first, then loses it when one starts with an
 *   outsider. Warned means before anything happens: the first start is refused with the warning, and
 *   a second within a minute goes ahead (ours). Every group with prestige there is warned by the
 *   same start, so one more goes ahead for all of them. Content that asks its own question after the
 *   check (Chambers of Xeric's "Begin the raid.") says `confirms: true` when it asks, which only warns
 *   and counts as the warning, and checks again without it at the answer: a group that came in while
 *   the question was up wasn't warned, so that start is refused. (Bosses whose kills carry their
 *   damagers are Restrictions.kill's.)
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");

/** How long a warned group has to start again and go ahead. */
const CONFIRM_MS = 60 * 1000;
/** groupId -> { activity, until }: the warning still waiting for its second start. */
const warnings = new Map();

function recordOf(player) {
  const { group } = Common.groupOf(player);
  const record = group?.ironman ? Store.get(group.id) : null;
  return record?.formed ? { group, record } : null;
}

function groupMate(player, other) {
  const query = { player, other, same: false, ironman: false };
  Common.api.emitCustomEvent("grouping:same-group", query);
  return query.same && query.ironman;
}

function withOutsiders(player, players) {
  return players.some((other) => other && other !== player && !groupMate(player, other));
}

/** "group-pvm:can-start": a Hardcore group's member with outsiders is refused; prestige is warned of. */
function canStart(request) {
  const players = (request.players ?? []).filter(Boolean);
  const activity = request.activity ?? "";
  /** groupId -> { group, player }: each group with prestige taking part with outsiders. */
  const prestige = new Map();
  for (const player of request.entrant ? [request.entrant] : players) {
    if (!Common.isGroupIronman(player)) continue;
    const found = recordOf(player);
    if (!found || !withOutsiders(player, players)) continue;
    if (found.record.variant === "hardcore") {
      request.allowed = false;
      const key = request.entrant ? "hardcoreOutsidersYou" : "hardcoreOutsiders";
      request.reason = Common.message(key, { name: player.getUsername(), activity });
      return;
    }
    if (found.record.prestige && !prestige.has(found.group.id)) prestige.set(found.group.id, { group: found.group, player });
  }
  if (request.confirms) {
    for (const { group, player } of prestige.values()) {
      warn(group.id, activity);
      Common.tell(player, "prestigeOutsidersWarning", { activity });
    }
    return;
  }
  const unwarned = [...prestige.values()].filter(({ group }) => !warnedOf(group.id, activity));
  if (unwarned.length === 0) {
    for (const id of prestige.keys()) warnings.delete(id);
    return;
  }
  for (const id of prestige.keys()) warn(id, activity);
  for (const { group } of unwarned) Common.tellGroup(group, "prestigeOutsidersWarning", { activity });
  request.allowed = false;
  request.reason = Common.message("prestigeOutsidersConfirm", { activity });
}

function warn(groupId, activity) {
  warnings.set(groupId, { activity, until: Date.now() + CONFIRM_MS });
}

/** Whether this group was warned of this activity within the last minute: the next start goes ahead. */
function warnedOf(groupId, activity) {
  const warning = warnings.get(groupId);
  return Boolean(warning && warning.activity === activity && warning.until >= Date.now());
}

/** "group-pvm:started": every group with prestige that started with an outsider loses it. */
function started({ players = [] }) {
  const done = new Set();
  for (const player of players.filter(Boolean)) {
    const found = Common.isGroupIronman(player) ? recordOf(player) : null;
    if (!found || done.has(found.group.id) || !found.record.prestige || !withOutsiders(player, players)) continue;
    done.add(found.group.id);
    found.record.prestige = false;
    Store.update(found.record);
    Common.tellGroup(found.group, "prestigeLost");
  }
}

/**
 * "combat-achievements:team-size" { player, size }: a Group Ironman's team is their group, so tasks
 * that need a bigger one aren't asked of them (Wiki, Group Ironman Mode: Combat Achievements).
 */
function teamSize(request) {
  if (!Common.isGroupIronman(request.player)) return;
  const { group } = Common.groupOf(request.player);
  request.size = group?.ironman ? group.members.length : 1;
}

module.exports = { CONFIRM_MS, canStart, started, teamSize, reset: () => warnings.clear() };
