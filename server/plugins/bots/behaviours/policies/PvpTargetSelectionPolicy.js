"use strict";

const { randomInRange } = require("../navigation/BotNavigation");
const { getPvpLoadout, getPvpProfile } = require("../pvp/PvpAssignment");

function scorePvpCandidate(sourceEntry, candidateEntry) {
  const sourcePlayer = sourceEntry?.player;
  const sourceState = sourceEntry?.state;
  const candidatePlayer = candidateEntry?.player;
  const candidateState = candidateEntry?.state;
  if (!sourcePlayer || !sourceState || !candidatePlayer || !candidateState) {
    return Number.NEGATIVE_INFINITY;
  }

  const sourceProfile = getPvpProfile(sourceState?.pvp?.profileId);
  const sourceLoadout = getPvpLoadout(sourceState?.pvp?.loadoutId);
  const distance = sourcePlayer.getLocation().getDistance(candidatePlayer.getLocation());
  let score = 100 - distance * 6;

  if (sourceState.pvp?.hotspotId && sourceState.pvp.hotspotId === candidateState.pvp?.hotspotId) {
    score += 32;
  }
  if (
    sourceLoadout.tags.includes("hybrid") &&
    candidateState.pvp?.preferredCombatStyle === "hybrid"
  ) {
    score += 8;
  }
  if (candidateState.pvp?.confidenceTier != null) {
    score += Math.max(
      -8,
      10 - Math.abs((sourceProfile.confidenceTier ?? 2) - candidateState.pvp.confidenceTier) * 4
    );
  }
  if (distance <= sourceProfile.chaseDistanceTiles) {
    score += 10;
  }
  return score;
}

function compareCandidateRank(a, b) {
  if ((b?.score ?? Number.NEGATIVE_INFINITY) !== (a?.score ?? Number.NEGATIVE_INFINITY)) {
    return (b?.score ?? Number.NEGATIVE_INFINITY) - (a?.score ?? Number.NEGATIVE_INFINITY);
  }
  return (a?.distance ?? Number.POSITIVE_INFINITY) - (b?.distance ?? Number.POSITIVE_INFINITY);
}

function insertTopCandidate(pool, candidate, maxSize) {
  if (!Array.isArray(pool) || !candidate || maxSize <= 0) {
    return;
  }
  let insertAt = pool.length;
  while (insertAt > 0 && compareCandidateRank(candidate, pool[insertAt - 1]) < 0) {
    insertAt -= 1;
  }
  pool.splice(insertAt, 0, candidate);
  if (pool.length > maxSize) {
    pool.length = maxSize;
  }
}

function pickPvpOpponent({
  sourceEntry,
  candidateEntries,
  index,
  nowMs,
  pvpMaxDistanceTiles,
  isInCombat,
  isPvpCandidate,
}) {
  const sourcePlayer = sourceEntry?.player;
  const sourceState = sourceEntry?.state;
  const pool = candidateEntries;
  if (!sourcePlayer || !sourceState || !Array.isArray(pool)) {
    return null;
  }

  const sourceHotspotId = sourceState?.pvp?.hotspotId ?? null;
  const requireSameHotspot = false;

  const topCandidates = [];
  for (const other of pool) {
    if (
      typeof isPvpCandidate === "function" &&
      !isPvpCandidate({
        sourceEntry,
        candidateEntry: other,
        index,
        nowMs,
        isInCombat,
      })
    ) {
      continue;
    }
    if (
      requireSameHotspot &&
      (other?.state?.pvp?.hotspotId ?? null) !== sourceHotspotId
    ) {
      continue;
    }
    const distance = sourcePlayer.getLocation().getDistance(other.player.getLocation());
    if (distance > pvpMaxDistanceTiles) {
      continue;
    }
    insertTopCandidate(
      topCandidates,
      {
        entry: other,
        distance,
        score: scorePvpCandidate(sourceEntry, other),
      },
      3
    );
  }

  if (topCandidates.length === 0) {
    return null;
  }
  return topCandidates[randomInRange(0, topCandidates.length - 1)].entry;
}

module.exports = {
  scorePvpCandidate,
  pickPvpOpponent,
};
