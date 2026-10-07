"use strict";

const { Wilderness } = require("../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");

const CHUNK_SIZE_TILES = 16;
// One game tick. Every seek inside the same tick shares one index; engagements
// started during the tick are folded in by trackEngagement so caps still hold.
const INDEX_TTL_MS = 600;

function bucketKey(x, y, z) {
  return `${z}:${Math.floor(x / CHUNK_SIZE_TILES)}:${Math.floor(y / CHUNK_SIZE_TILES)}`;
}

function addToBucket(buckets, location, value) {
  const key = bucketKey(location.getX(), location.getY(), location.getZ());
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    buckets.set(key, [value]);
  }
}

/**
 * Spatial buckets and target counts for pvp seeking, built once per tick from
 * the live entries instead of once per seeking bot.
 */
function buildPvpSeekIndex({ entries, world, pvpMode, isInCombat }) {
  const botBuckets = new Map();
  const realPlayerBuckets = new Map();
  const activeHotspotCombatCounts = new Map();
  const activePvpTargetCounts = new Map();
  const activePvpTargetByUsername = new Map();
  const entryByPlayer = new Map();

  for (const entry of entries) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state) {
      continue;
    }
    entryByPlayer.set(player, entry);
    const location = player.getLocation?.();
    if (location) {
      addToBucket(botBuckets, location, entry);
    }
    if (state.mode !== pvpMode) {
      continue;
    }
    const targetUsername = state.pvp?.targetUsername ?? null;
    const username = player.getUsername?.() ?? null;
    if (targetUsername) {
      activePvpTargetCounts.set(
        targetUsername,
        (activePvpTargetCounts.get(targetUsername) ?? 0) + 1
      );
      if (username) {
        activePvpTargetByUsername.set(username, targetUsername);
      }
    }
    const hotspotId = state.pvp?.hotspotId ?? null;
    if (hotspotId && state.pvp?.phase === "combat" && isInCombat(player)) {
      activeHotspotCombatCounts.set(
        hotspotId,
        (activeHotspotCombatCounts.get(hotspotId) ?? 0) + 1
      );
    }
  }

  world.getPlayers().forEach((candidate) => {
    if (!candidate || candidate.isPlayerBot?.() === true) {
      return;
    }
    if (!world.isPlayerSessionConnected(candidate) || !candidate.isRegistered?.()) {
      return;
    }
    if ((candidate.getHitpoints?.() ?? 0) <= 0 || !Wilderness.isIn(candidate)) {
      return;
    }
    const location = candidate.getLocation?.();
    if (location) {
      addToBucket(realPlayerBuckets, location, candidate);
    }
  });

  return {
    botBuckets,
    realPlayerBuckets,
    activeHotspotCombatCounts,
    activePvpTargetCounts,
    activePvpTargetByUsername,
    entryByPlayer,
  };
}

/** Values bucketed within maxDistanceTiles (chunk-granular) of sourcePlayer. */
function nearby(buckets, sourcePlayer, maxDistanceTiles) {
  const location = sourcePlayer?.getLocation?.();
  if (!location) {
    return [];
  }
  const x = location.getX();
  const y = location.getY();
  const z = location.getZ();
  const radius = Math.max(1, Math.ceil(maxDistanceTiles / CHUNK_SIZE_TILES));
  const values = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const bucket = buckets.get(
        bucketKey(x + dx * CHUNK_SIZE_TILES, y + dy * CHUNK_SIZE_TILES, z)
      );
      if (bucket) {
        values.push(...bucket);
      }
    }
  }
  return values;
}

/** Bots (other than ignoreUsername) currently targeting targetUsername. */
function activeTargetCount(index, targetUsername, ignoreUsername = null) {
  if (!targetUsername) {
    return 0;
  }
  const count = index.activePvpTargetCounts.get(targetUsername) ?? 0;
  const ignored = ignoreUsername
    ? index.activePvpTargetByUsername.get(ignoreUsername) ?? null
    : null;
  return Math.max(0, count - (ignored === targetUsername ? 1 : 0));
}

function hotspotFightCount(index, hotspotId) {
  return Math.floor((index.activeHotspotCombatCounts.get(hotspotId) ?? 0) / 2);
}

/** Folds an engagement started mid-tick into the shared index. */
function trackEngagement(index, player, state, targetUsername) {
  const username = player?.getUsername?.() ?? null;
  if (!index || !username || !targetUsername) {
    return;
  }
  const previous = index.activePvpTargetByUsername.get(username) ?? null;
  if (previous !== targetUsername) {
    if (previous) {
      const previousCount = index.activePvpTargetCounts.get(previous) ?? 0;
      if (previousCount <= 1) {
        index.activePvpTargetCounts.delete(previous);
      } else {
        index.activePvpTargetCounts.set(previous, previousCount - 1);
      }
    }
    index.activePvpTargetByUsername.set(username, targetUsername);
    index.activePvpTargetCounts.set(
      targetUsername,
      (index.activePvpTargetCounts.get(targetUsername) ?? 0) + 1
    );
  }
  const hotspotId = state?.pvp?.hotspotId ?? null;
  if (hotspotId) {
    index.activeHotspotCombatCounts.set(
      hotspotId,
      (index.activeHotspotCombatCounts.get(hotspotId) ?? 0) + 1
    );
  }
}

module.exports = {
  INDEX_TTL_MS,
  buildPvpSeekIndex,
  nearby,
  activeTargetCount,
  hotspotFightCount,
  trackEngagement,
};
