"use strict";

const DEFAULT_WINDOW_MS = 30000;
const DEFAULT_MAX_SAMPLES = 200000;
const MAX_CYCLE_SAMPLES = 50000;
const BYTES_PER_MB = 1024 * 1024;

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[index];
}

function summarise(values, count) {
  if (count <= 0) {
    return null;
  }
  const sorted = values.slice(0, count).sort((a, b) => a - b);
  let sum = 0;
  for (const value of sorted) {
    sum += value;
  }
  return {
    count,
    avg: sum / count,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

function scale(summary, factor) {
  if (!summary) {
    return null;
  }
  return {
    count: summary.count,
    avg: round(summary.avg * factor),
    p50: round(summary.p50 * factor),
    p95: round(summary.p95 * factor),
    p99: round(summary.p99 * factor),
    max: round(summary.max * factor),
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Opt-in per-bot tick instrumentation for comparing scheduler/behaviour changes.
 * Disabled it is one boolean check per entry; enabled it samples per-entry and
 * per-cycle nanoseconds plus heap movement, and logs a percentile report per window.
 * Buffers are allocated on first enable so idle worlds pay nothing.
 */
function createBotTickMetrics(options = {}) {
  const windowMs =
    Number.isFinite(options.windowMs) && options.windowMs > 0
      ? Math.max(1000, Math.floor(options.windowMs))
      : DEFAULT_WINDOW_MS;
  const maxSamples =
    Number.isFinite(options.maxSamples) && options.maxSamples > 0
      ? Math.max(1, Math.floor(options.maxSamples))
      : DEFAULT_MAX_SAMPLES;
  const log =
    typeof options.log === "function"
      ? options.log
      : (message, extra) =>
          console.info(`[${message}] ${JSON.stringify(extra ?? {})}`);

  let enabledFlag = options.enabled === true;
  let entrySamples = null;
  let cycleSamples = null;
  let entryCount = 0;
  let entryDropped = 0;
  let cycleCount = 0;
  let cycleDropped = 0;
  let windowStartedAt = Date.now();
  let cycleStartNs = 0n;
  let heapStart = 0;
  let heapPeak = 0;
  let heapEnd = 0;
  let totalEntries = 0;
  let totalRuns = 0;

  function ensureBuffers() {
    if (!entrySamples) {
      entrySamples = new Float64Array(maxSamples);
      cycleSamples = new Float64Array(Math.min(maxSamples, MAX_CYCLE_SAMPLES));
    }
  }

  function reset(nowMs) {
    entryCount = 0;
    entryDropped = 0;
    cycleCount = 0;
    cycleDropped = 0;
    totalEntries = 0;
    totalRuns = 0;
    heapPeak = process.memoryUsage().heapUsed;
    heapStart = heapPeak;
    heapEnd = heapPeak;
    windowStartedAt = nowMs;
  }

  function flush(nowMs = Date.now()) {
    if (!enabledFlag) {
      return null;
    }
    const windowMsActual = Math.max(1, nowMs - windowStartedAt);
    const report = {
      windowMs: windowMsActual,
      runs: totalRuns,
      entries: totalEntries,
      entriesPerSecond: Math.round((totalEntries * 1000) / windowMsActual),
      runMs: scale(summarise(cycleSamples, cycleCount), 1 / 1e6),
      entryUs: scale(summarise(entrySamples, entryCount), 1 / 1e3),
      entrySamplesDropped: entryDropped,
      cycleSamplesDropped: cycleDropped,
      heapPeakMb: Math.round((heapPeak / BYTES_PER_MB) * 10) / 10,
      heapWindowDeltaMb:
        Math.round(((heapEnd - heapStart) / BYTES_PER_MB) * 10) / 10,
    };
    log("bot_tick_metrics", report);
    reset(nowMs);
    return report;
  }

  if (enabledFlag) {
    ensureBuffers();
  }

  const metrics = {
    get enabled() {
      return enabledFlag;
    },

    /** Benchmark harnesses flip this on after their warmup window. */
    setEnabled(value, nowMs = Date.now()) {
      const next = value === true;
      if (next === enabledFlag) {
        return;
      }
      enabledFlag = next;
      if (next) {
        ensureBuffers();
        reset(nowMs);
      }
    },

    beginCycle(nowMs = Date.now()) {
      if (!enabledFlag) {
        return;
      }
      cycleStartNs = process.hrtime.bigint();
      const heapUsed = process.memoryUsage().heapUsed;
      if (heapUsed > heapPeak) {
        heapPeak = heapUsed;
      }
      if (windowStartedAt === 0) {
        windowStartedAt = nowMs;
      }
    },

    recordEntry(ns) {
      if (!enabledFlag) {
        return;
      }
      if (entryCount < entrySamples.length) {
        entrySamples[entryCount++] = ns;
      } else {
        entryDropped++;
      }
    },

    endCycle(nowMs = Date.now(), entries = 0) {
      if (!enabledFlag) {
        return;
      }
      const cycleNs = Number(process.hrtime.bigint() - cycleStartNs);
      if (cycleCount < cycleSamples.length) {
        cycleSamples[cycleCount++] = cycleNs;
      } else {
        cycleDropped++;
      }
      heapEnd = process.memoryUsage().heapUsed;
      if (heapEnd > heapPeak) {
        heapPeak = heapEnd;
      }
      totalEntries += entries;
      totalRuns++;
      if (nowMs - windowStartedAt >= windowMs) {
        flush(nowMs);
      }
    },

    flush,
  };

  return metrics;
}

module.exports = {
  createBotTickMetrics,
};
