"use strict";

/**
 * Prestige-bound restrictions (Wiki, Group Ironman Mode: Prestige; data/group-ironman-restricted.json).
 *
 * - Items: a member of a formed ranked group who isn't one of its originals can't equip the listed
 *   boss and raid uniques (and a few Slayer drops) in their first 5 weeks until they have killed
 *   the source once: a collection log category's kill count above 0 ("collection-log:kill-count"),
 *   or a monster this unit saw them kill (KILLS_ATTRIBUTE, from "npc-drops:roll").
 * - Group Prestige: a kill of one of the listed bosses that someone outside the group helped with
 *   costs the group its prestige (the raids, whose parties aren't seen here, are not covered).
 */

const fs = require("fs");
const path = require("path");
const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");
const Wealth = require("./Wealth.GroupIronman");

const KILLS_ATTRIBUTE = "group-ironman:kills";
let data = null;
let trackedNpcs = null;

function rules() {
  if (!data) {
    data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "group-ironman-restricted.json"), "utf8"));
    trackedNpcs = new Set(data.entries.flatMap((entry) => entry.npcs ?? []).map((name) => name.toLowerCase()));
  }
  return data;
}

/** Restricted now: an ironman group's newcomer, formed, ranked, within the restricted weeks. */
function restricted(player, now = Date.now()) {
  const { group, member, account } = Common.groupOf(player);
  const record = group?.ironman ? Store.get(group.id) : null;
  if (!record || record.variant !== "ranked" || !record.formed || !member || record.originals.includes(account)) return false;
  return now - (member.joined || now) < Common.data.wealthCaps.restrictedWeeks * Wealth.WEEK_MS;
}

/** The rule an item falls under, or null. */
function entryFor(itemId) {
  const name = String(Common.api.core.ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase();
  if (!name || rules().except.names.some((part) => name.includes(part))) return null;
  return rules().entries.find((entry) => entry.items.some((item) => name.includes(item.toLowerCase()))) ?? null;
}

function killed(player, entry) {
  for (const category of entry.categories ?? []) {
    const query = { player, category, count: 0 };
    Common.api.emitCustomEvent("collection-log:kill-count", query);
    if (Number(query.count) > 0) return true;
  }
  const kills = player.getAttribute(KILLS_ATTRIBUTE) ?? [];
  return (entry.npcs ?? []).some((npc) => kills.includes(npc.toLowerCase()));
}

/** onCanEquip: a restricted newcomer's item whose source they haven't killed stays unequipped. */
function canEquip(event) {
  const { player, item } = event;
  if (event.allow === false || !item || !Common.isGroupIronman(player) || !restricted(player)) return;
  const entry = entryFor(item.getId());
  if (!entry || killed(player, entry)) return;
  event.allow = false;
  Common.tell(player, "restrictedItem", { source: (entry.categories ?? entry.npcs)[0] });
}

function npcName(npc) {
  return String(npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? "");
}

function groupMate(player, other) {
  const query = { player, other, same: false, ironman: false };
  Common.api.emitCustomEvent("grouping:same-group", query);
  return query.same && query.ironman;
}

/** "npc-drops:roll": notes a tracked monster's kill, and outsider help on a prestige boss. */
function kill(event) {
  const { player, npc, damagers } = event;
  if (!player || !Common.isGroupIronman(player)) return;
  const name = npcName(npc);
  const lower = name.toLowerCase();
  rules();
  if (trackedNpcs.has(lower)) {
    const kills = player.getAttribute(KILLS_ATTRIBUTE) ?? [];
    if (!kills.includes(lower)) player.setAttribute(KILLS_ATTRIBUTE, [...kills, lower]);
  }
  if (!data.prestigeBosses.npcs.includes(name)) return;
  const outsider = (damagers ?? []).some((other) => other && other !== player && !groupMate(player, other));
  const { group } = Common.groupOf(player);
  const record = group?.ironman ? Store.get(group.id) : null;
  if (!outsider || !record?.prestige) return;
  record.prestige = false;
  Store.update(record);
  Common.tellGroup(group, "prestigeLost");
}

module.exports = { KILLS_ATTRIBUTE, restricted, entryFor, killed, canEquip, kill };
