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
 *   outsider. (Bosses whose kills carry their damagers are Restrictions.kill's.)
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");

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
  const warned = new Set();
  for (const player of request.entrant ? [request.entrant] : players) {
    if (!Common.isGroupIronman(player)) continue;
    const found = recordOf(player);
    if (!found || !withOutsiders(player, players)) continue;
    if (found.record.variant === "hardcore") {
      request.allowed = false;
      const key = request.entrant ? "hardcoreOutsidersYou" : "hardcoreOutsiders";
      request.reason = Common.message(key, { name: player.getUsername(), activity: request.activity ?? "" });
      return;
    }
    if (found.record.prestige && !warned.has(found.group.id)) {
      warned.add(found.group.id);
      Common.tell(player, "prestigeOutsidersWarning", { activity: request.activity ?? "" });
    }
  }
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

module.exports = { canStart, started, teamSize };
