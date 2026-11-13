"use strict";

/**
 * Hardcore Group Ironman's shared lives (Wiki, Group Ironman Mode: Hardcore; launch post).
 *
 * - A formed Hardcore group has one life per member it was formed with (Variants.form).
 * - A member's dangerous death costs one, and so does a death in an activity that is safe for
 *   others but not for Hardcore groups (data: hardcoreUnsafeAreas). A member leaving or being
 *   removed costs one too (launch post).
 * - The members online are told how many are left. At none the group is a Group Ironman group:
 *   its members become Group Ironmen, those away at their next login (Variants.login).
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");

function unsafeArea(player) {
  const area = player.getArea?.();
  return !!area && Common.data.hardcoreUnsafeAreas.plugins.includes(area.pluginName);
}

/** Takes a life from the record; at none the group loses Hardcore status. */
function loseLife(record, group, name, key) {
  record.lives = Math.max(0, record.lives - 1);
  Store.update(record);
  Common.tellGroup(group, key, { name, lives: record.lives, livesWord: record.lives === 1 ? "life" : "lives" });
  if (record.lives > 0) return;
  record.variant = "ranked";
  Store.update(record);
  for (const member of group.members) {
    const player = member.online ? Common.onlinePlayer(member.account) : null;
    if (player) Common.setMode(player, Common.modeOfVariant("ranked"));
  }
  Common.tellGroup(group, "hardcoreLost");
}

function hardcoreRecord(group) {
  const record = group?.ironman ? Store.get(group.id) : null;
  return record?.variant === "hardcore" && record.formed ? record : null;
}

/** onPlayerDeath: a member's dangerous or Hardcore-unsafe death. */
function death(event) {
  const { player, itemsLost } = event;
  if (Common.modeOf(player) !== Common.modeOfVariant("hardcore")) return;
  if (itemsLost !== true && !unsafeArea(player)) return;
  const { group } = Common.groupOf(player);
  const record = hardcoreRecord(group);
  if (record) loseLife(record, group, player.getDisplayName?.() ?? player.getUsername(), "lifeLost");
}

/** "grouping:changed" "left" / "kicked": a member gone costs the group a life. */
function departed(event) {
  const record = hardcoreRecord(event.group);
  if (!record) return;
  const name = Common.onlinePlayer(event.target)?.getDisplayName?.() ?? event.target;
  loseLife(record, event.group, name, "lifeLostLeaving");
}

/**
 * "ring-of-life:can-escape" { player, allowed }: the Ring of Life's effect (and the Defence and max
 * capes') works for a Hardcore Group Ironman in these minigames, where a death costs a life
 * (Update:Group Ironman Improvements, 2 March 2022). Its Knight Waves and quest replays don't exist here.
 */
function ringOfLifeEscape(request) {
  if (Common.modeOf(request.player) !== Common.modeOfVariant("hardcore")) return;
  const area = request.player.getArea?.();
  if (area && Common.data.ringOfLifeAreas.plugins.includes(area.pluginName)) request.allowed = true;
}

module.exports = { unsafeArea, loseLife, death, departed, ringOfLifeEscape };
