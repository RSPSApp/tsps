"use strict";

const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { attachBrain } = require("../brain/attachBrain");

const DEFAULT_SITE = Object.freeze({ x: 3147, y: 3230, z: 0 });
const SPAWN_RING_TILES = 10;
const SPAWN_ATTEMPTS = 16;

function parseEnvInt(name, fallback, min = 0) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

function ringOffset(index) {
  const radius = Math.min(SPAWN_RING_TILES, 1 + Math.floor((index - 1) / 6));
  const slot = (index - 1) % 6;
  const angle = (slot / 6) * Math.PI * 2;
  return {
    dx: Math.round(Math.cos(angle) * radius),
    dy: Math.round(Math.sin(angle) * radius),
  };
}

/**
 * Opt-in benchmark workload: spawns N bots on one activity at a fixed site, enables
 * tick metrics after a warmup, then logs one combined report. Repeatable across
 * branches for before/after comparisons. Off unless BOT_BENCH_COUNT is set.
 */
function createBotBenchmark(options = {}) {
  const {
    api,
    botApi,
    runtime,
    tickMetrics,
    resetMovementState,
    brainRegistry,
    brainWorld,
  } = options;

  const count = parseEnvInt("BOT_BENCH_COUNT", 0, 0);
  if (count <= 0 || !runtime || !tickMetrics) {
    return null;
  }
  const brainActivityId = process.env.BOT_BENCH_ACTIVITY ?? "lumbridge_normal_trees";
  const brainActivity = brainRegistry?.byId?.get(brainActivityId) ?? null;
  if (!brainActivity) {
    botApi?.log?.("bot_bench_unknown_activity", { activity: brainActivityId });
    return null;
  }
  const site = {
    x: parseEnvInt("BOT_BENCH_X", DEFAULT_SITE.x, 0),
    y: parseEnvInt("BOT_BENCH_Y", DEFAULT_SITE.y, 0),
    z: parseEnvInt("BOT_BENCH_Z", DEFAULT_SITE.z, 0),
  };
  const warmupMs = parseEnvInt("BOT_BENCH_WARMUP_MS", 20000, 0);
  const durationMs = parseEnvInt("BOT_BENCH_SECONDS", 60, 5) * 1000;
  const shouldExit = (process.env.BOT_BENCH_EXIT ?? "0") === "1";
  const RegionManager = api?.getRegionManager?.() ?? null;

  function resolveSpawnLocation(index) {
    if (!RegionManager) {
      return new Location(site.x, site.y, site.z);
    }
    RegionManager.loadMapFiles(site.x, site.y);
    const baseOffset = ringOffset(index);
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const rotate = Math.floor((attempt / 6) + 0.001);
      const angle = (rotate * Math.PI) / 3;
      const dx = Math.round(
        baseOffset.dx * Math.cos(angle) - baseOffset.dy * Math.sin(angle)
      );
      const dy = Math.round(
        baseOffset.dx * Math.sin(angle) + baseOffset.dy * Math.cos(angle)
      );
      const candidate = new Location(site.x + dx, site.y + dy, site.z);
      if (!RegionManager.blocked(candidate, null)) {
        return candidate;
      }
    }
    return new Location(site.x, site.y, site.z);
  }

  function spawnBenchBot(index) {
    const bot = runtime.spawnPvpBot(resolveSpawnLocation(index), {
      mode: brainActivity.mode,
    });
    if (!bot) {
      return false;
    }
    const username = bot.getUsername?.();
    const state = username ? runtime.botStatesByName?.get?.(username) : null;
    if (!state) {
      return true;
    }
    state.home = { x: site.x, y: site.y, z: site.z };
    // PvP bots keep their pvp-only priming; other brain activities drop it.
    if (state.autonomy && brainActivity.mode !== "pvp") {
      state.autonomy.allowedAutonomousModes = null;
    }
    botApi?.log?.("bot_bench_brain_attached", { username, activity: brainActivity.id });
    return attachBrain({
      runtime,
      registry: brainRegistry,
      world: brainWorld,
      bot,
      activity: brainActivity,
      home: site,
      resetMovementState,
    });
  }

  function start() {
    let spawned = 0;
    for (let index = 0; index < count; index++) {
      if (spawnBenchBot(index)) {
        spawned++;
      }
    }
    const setup = {
      requested: count,
      spawned,
      mode: brainActivity.id,
      driver: "brain",
      site,
      warmupMs,
      durationMs,
    };
    console.info(`[bot_bench_start] ${JSON.stringify(setup)}`);
    botApi?.log?.("bot_bench_start", setup);

    setTimeout(() => {
      tickMetrics.setEnabled(true);
      console.info(`[bot_bench_measure_start] ${JSON.stringify(setup)}`);
    }, warmupMs);

    setTimeout(() => {
      const report = tickMetrics.flush(Date.now());
      tickMetrics.setEnabled(false);
      const result = { ...setup, report };
      console.info(`[bot_bench_report] ${JSON.stringify(result)}`);
      botApi?.log?.("bot_bench_report", result);
      if (shouldExit) {
        setTimeout(() => process.exit(0), 500);
      }
    }, warmupMs + durationMs);
  }

  if (typeof api?.onServerStartup === "function") {
    api.onServerStartup(() => setTimeout(start, 1000));
  }
  return { start };
}

module.exports = {
  createBotBenchmark,
};
