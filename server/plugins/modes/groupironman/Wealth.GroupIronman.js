"use strict";

/**
 * New members' wealth transfer limits (Wiki, Group Ironman Mode: Prestige; Tony). A member of a
 * formed ranked group who isn't one of its originals (no Individual Prestige) has a weekly limit on
 * what they receive from the group, by week since joining: 1M coins' worth in the first week, 20M
 * in the second, 50M in the third and 100M in the fourth, each week counted on its own; from the
 * fifth week there is no limit. Unranked groups have none, and Hardcore groups take no new members.
 *
 * Counted at Grand Exchange value (ours): items traded to them by group mates (checked at each
 * accept, counted when the trade completes) and items they take out of group storage (checked and
 * counted at Save, through GroupStorage's "group-storage:*" events). The storage shows what is left
 * (%if1).
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** { record, account } when this player's receipts are limited now, else null. */
function limited(player, now = Date.now()) {
  const { group, member, account } = Common.groupOf(player);
  const record = group?.ironman ? Store.get(group.id) : null;
  if (!record || record.variant !== "ranked" || !record.formed || !member || record.originals.includes(account)) return null;
  const week = Math.floor((now - (member.joined || now)) / WEEK_MS);
  const cap = Common.data.wealthCaps.weeks[week];
  return cap === undefined ? null : { record, account, cap, week };
}

/** What the member has received in `week`: the record keeps only the current week's total. */
function receivedIn(limit) {
  const entry = limit.record.received[limit.account];
  return entry && typeof entry === "object" && entry.week === limit.week ? Number(entry.value) || 0 : 0;
}

/** Coins' worth the player may still receive from the group, or null for no limit. */
function remaining(player, now = Date.now()) {
  const limit = limited(player, now);
  if (!limit) return null;
  return Math.max(0, limit.cap - receivedIn(limit));
}

/** Grand Exchange value of [{ id, amount }] or Items (noted counted as the item itself). */
function valueOf(items) {
  const { ItemDefinition } = Common.api.core;
  let total = 0;
  for (const item of items ?? []) {
    const id = typeof item.getId === "function" ? item.getId() : item.id;
    const amount = typeof item.getAmount === "function" ? item.getAmount() : item.amount;
    if (!(id > 0) || !(amount > 0)) continue;
    const definition = ItemDefinition.forId(ItemDefinition.forId(id).unNote());
    total += Math.max(0, Number(definition.getGrandExchangeValue?.()) || 0) * amount;
  }
  return total;
}

function count(player, value, now = Date.now()) {
  const limit = limited(player, now);
  if (!limit || value <= 0) return;
  limit.record.received[limit.account] = { week: limit.week, value: receivedIn(limit) + value };
  Store.update(limit.record);
}

function groupMates(player, other) {
  const query = { player, other, same: false, ironman: false };
  Common.api.emitCustomEvent("grouping:same-group", query);
  return query.same && query.ironman;
}

function offered(by) {
  return by.getTrading?.()?.getContainer?.()?.getValidItems?.() ?? [];
}

/** onCanTrade: between group mates, neither may be offered more than they may still receive. */
function canTrade(event) {
  const { player, target } = event;
  if (event.allow === false || !Common.isGroupIronman(player) || !groupMates(player, target)) return;
  for (const [receiver, giver] of [[player, target], [target, player]]) {
    const left = remaining(receiver);
    if (left === null || valueOf(offered(giver)) <= left) continue;
    event.allow = false;
    Common.tell(receiver, "capReached", { left: left.toLocaleString("en-GB") });
    if (giver !== receiver) Common.tell(giver, "capTradeOther", { name: receiver.getDisplayName?.() ?? receiver.getUsername() });
    return;
  }
}

/** onTradeCompleted: what a limited member received from a group mate counts. */
function tradeCompleted({ player, partner, received }) {
  if (Common.isGroupIronman(player) && groupMates(player, partner)) count(player, valueOf(received));
}

/** "group-storage:limit" { player, groupId, remaining }: what the storage shows as %if1. */
function storageLimit(request) {
  request.remaining = remaining(request.player);
}

/** "group-storage:can-withdraw" { player, groupId, items, allowed, reason }: at Save. */
function canWithdraw(request) {
  const left = remaining(request.player);
  if (left === null || valueOf(request.items) <= left) return;
  request.allowed = false;
  request.reason = Common.message("capReached", { left: left.toLocaleString("en-GB") });
}

/** "group-storage:withdrawn" { player, groupId, items }: saved, so it counts. */
function withdrawn(request) {
  count(request.player, valueOf(request.items));
}

module.exports = { WEEK_MS, limited, remaining, valueOf, count, canTrade, tradeCompleted, storageLimit, canWithdraw, withdrawn };
