"use strict";

/**
 * What a player keeps between trips: kill count (varp 2934), unclaimed reward permits (varbit
 * 11936, which also picks the reward pool's look), all permits ever earned, and personal bests.
 */

const Shared = require("./Shared.Tempoross");

const { DATA, VARBIT, VARP } = Shared;

const KILLS_ATTRIBUTE = "tempoross:kills";
const PERMITS_ATTRIBUTE = "tempoross:permits";
const TOTAL_PERMITS_ATTRIBUTE = "tempoross:total-permits";
/** Permits successfully spent on pool rewards: the collection log's "Reward permits claimed". */
const PERMITS_CLAIMED_ATTRIBUTE = "tempoross:permits-claimed";
const BEST_TIME_ATTRIBUTE = "tempoross:best-time";
const BEST_POINTS_ATTRIBUTE = "tempoross:best-points";

const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));

const kills = (player) => count(player, KILLS_ATTRIBUTE);
const permits = (player) => count(player, PERMITS_ATTRIBUTE);
const totalPermits = (player) => count(player, TOTAL_PERMITS_ATTRIBUTE);

/**
 * Permits successfully spent at the pool. A save from before this counter used the collection
 * log's own Tempoross tally, which the old pool search incremented once per successful claim;
 * adopt that ledger the first time the new attribute is absent.
 */
function permitsClaimed(player) {
  const stored = player.getAttribute(PERMITS_CLAIMED_ATTRIBUTE);
  if (stored !== undefined && stored !== null) return Math.max(0, Math.trunc(Number(stored) || 0));
  const request = { player, category: "Tempoross", count: null };
  Shared.api()?.emitCustomEvent?.("collection-log:stored-count", request);
  const migrated = Math.max(0, Math.trunc(Number(request.count) || 0));
  player.setAttribute(PERMITS_CLAIMED_ATTRIBUTE, migrated);
  return migrated;
}
const bestTime = (player) => count(player, BEST_TIME_ATTRIBUTE);
const bestPoints = (player) => count(player, BEST_POINTS_ATTRIBUTE);

function syncVars(player) {
  player.getPacketSender()
    .sendConfig(VARP.KILLS, kills(player))
    .sendVarbit(VARBIT.PERMITS, permits(player));
}

function addKill(player) {
  player.setAttribute(KILLS_ATTRIBUTE, kills(player) + 1);
  syncVars(player);
  return kills(player);
}

function setPermits(player, amount) {
  player.setAttribute(PERMITS_ATTRIBUTE, Math.max(0, Math.min(DATA.rewards.maxPermits, amount)));
  syncVars(player);
}

function addPermits(player, earned) {
  // Content may raise the permits ("minigame:points" { player, minigame, points }).
  const award = { player, minigame: "tempoross", points: earned };
  Shared.api().emitCustomEvent("minigame:points", award);
  earned = award.points;
  setPermits(player, permits(player) + earned);
  player.setAttribute(TOTAL_PERMITS_ATTRIBUTE, totalPermits(player) + earned);
}

/** A permit was actually exchanged for a pool reward. */
function addPermitClaimed(player) {
  player.setAttribute(PERMITS_CLAIMED_ATTRIBUTE, permitsClaimed(player) + 1);
}

/** Wiki: one permit at 2,000 points, one more per 700, and the remainder a chance at another. */
function permitsFor(points, random = Math.random) {
  const { firstPermit, perPermit } = DATA.points;
  if (points < firstPermit) return 0;
  const over = points - firstPermit;
  const whole = 1 + Math.floor(over / perPermit);
  return whole + (random() < (over % perPermit) / perPermit ? 1 : 0);
}

/** Records a finished trip's time (ticks) and points; returns the bests before this trip. */
function recordBests(player, ticks, points) {
  const before = { time: bestTime(player), points: bestPoints(player) };
  if (!before.time || ticks < before.time) player.setAttribute(BEST_TIME_ATTRIBUTE, ticks);
  if (points > before.points) player.setAttribute(BEST_POINTS_ATTRIBUTE, points);
  return {
    time: bestTime(player), points: bestPoints(player),
    newTime: !before.time || ticks < before.time, newPoints: points > before.points,
  };
}

/** 0.6 seconds a tick, shown as m:ss.cc like the captures' "3:25.80". */
function formatTicks(ticks) {
  const hundredths = ticks * 60;
  const minutes = Math.floor(hundredths / 6000);
  const seconds = Math.floor((hundredths % 6000) / 100);
  const rest = hundredths % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(rest).padStart(2, "0")}`;
}

/** The collection log's Tempoross page: kills, then reward permits claimed (cache script 2735). */
function collectionLogCount(request) {
  if (!request?.player || request.category !== "Tempoross") return;
  // Combat Achievements' generic fallback may have filled the kill line first; the
  // Tempoross page's own records still own both of its lines.
  request.count = kills(request.player);
  request.extraCounts = [permitsClaimed(request.player)];
}

function login({ player }) {
  syncVars(player);
}

function attachRecords(api) {
  api.persistAttribute(KILLS_ATTRIBUTE, 0);
  api.persistAttribute(PERMITS_ATTRIBUTE, 0);
  api.persistAttribute(TOTAL_PERMITS_ATTRIBUTE, 0);
  // No default: an absent value is an old save whose ledger is adopted on first use.
  api.persistAttribute(PERMITS_CLAIMED_ATTRIBUTE);
  api.persistAttribute(BEST_TIME_ATTRIBUTE, 0);
  api.persistAttribute(BEST_POINTS_ATTRIBUTE, 0);
  api.onPlayerLogin(login);
  api.onCustomEvent("collection-log:category-count", collectionLogCount);
}

module.exports = {
  attachRecords, kills, permits, totalPermits, permitsClaimed, bestTime, bestPoints, addKill, setPermits, addPermits,
  addPermitClaimed, permitsFor, recordBests, formatTicks, syncVars, collectionLogCount,
};
