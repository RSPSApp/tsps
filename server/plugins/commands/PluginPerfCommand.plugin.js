const fs = require("fs");
const path = require("path");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

let pluginApi;
let World;
let ServerPerf;

const PLUGIN_PERF_LOG_FILE = path.join(process.cwd(), "logs", "plugin-performance.log");
const PLUGIN_PERF_LATEST_FILE = path.join(
  process.cwd(),
  "logs",
  "plugin-performance.latest.log"
);
const SERVER_PERF_SNAPSHOT_FILE = path.join(
  process.cwd(),
  "logs",
  "server-performance.snapshot.log"
);
const DEFAULT_LIMIT = 5;
const DEFAULT_INTERVAL_MS = 10000;
const MAX_LIMIT = 15;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 60000;

const pluginPerfStreams = new Map();

function parseIntArg(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function stopPluginPerfStream(username) {
  const existing = pluginPerfStreams.get(username);
  if (existing) {
    clearInterval(existing);
    pluginPerfStreams.delete(username);
  }
}

function appendPluginPerfLog(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return;
  }
  const payload = `${lines.join("\n")}\n`;
  fs.mkdirSync(path.dirname(PLUGIN_PERF_LOG_FILE), { recursive: true });
  fs.appendFileSync(PLUGIN_PERF_LOG_FILE, payload, "utf8");
  // Keep a rolling latest snapshot for quick diagnosis without scanning a large log.
  fs.writeFileSync(PLUGIN_PERF_LATEST_FILE, payload, "utf8");
}

function streamPluginPerfToPlayer(player, limit = DEFAULT_LIMIT) {
  const rows = pluginApi.getPluginPerformanceSnapshot(limit);
  const timestamp = new Date().toISOString();
  const logLines = [];

  if (!rows.length) {
    player.sendMessage("[pluginperf] No samples yet.");
    logLines.push(`${timestamp} [pluginperf] No samples yet.`);
    appendPluginPerfLog(logLines);
    return;
  }

  player.sendMessage(
    `[pluginperf] Top ${rows.length} plugins (total/avg/max ms)`
  );
  logLines.push(`${timestamp} [pluginperf] Top ${rows.length} plugins (total/avg/max ms)`);

  for (const row of rows) {
    const line = `${row.pluginName}: ${row.totalMs.toFixed(1)}/${row.avgMs.toFixed(
      3
    )}/${row.maxMs.toFixed(3)} calls=${row.calls} top=${row.topEventName}(tot=${row.topEventTotalMs.toFixed(
      1
    )}ms c=${row.topEventCalls} avg=${row.topEventAvgMs.toFixed(
      3
    )}ms p95=${row.topEventP95Ms.toFixed(3)}ms)`;
    player.sendMessage(line);
    logLines.push(`${timestamp} ${line}`);
  }

  appendPluginPerfLog(logLines);
}

function streamServerPerfToPlayer(player, limitTicks = 60) {
  const summary = ServerPerf.getSummary(limitTicks);
  const timestamp = new Date().toISOString();
  const lines = [];

  if (!summary || summary.ticks <= 0) {
    player.sendMessage("[serverperf] No tick samples yet.");
    lines.push(`${timestamp} [serverperf] No tick samples yet.`);
    fs.mkdirSync(path.dirname(SERVER_PERF_SNAPSHOT_FILE), { recursive: true });
    fs.appendFileSync(SERVER_PERF_SNAPSHOT_FILE, `${lines.join("\n")}\n`, "utf8");
    return;
  }

  const header1 = `[serverperf] ticks=${summary.ticks} avgTick=${summary.avgTickMs.toFixed(
    1
  )}ms maxTick=${summary.maxTickMs.toFixed(1)}ms avgDrift=${summary.avgDriftMs.toFixed(
    1
  )}ms maxDrift=${summary.maxDriftMs.toFixed(1)}ms`;
  const header2 = `[serverperf] lastTick=${summary.lastTickNumber} players=${summary.lastPlayers} npcs=${summary.lastNpcs} tasks=${summary.lastTasks}`;

  player.sendMessage(header1);
  player.sendMessage(header2);
  lines.push(`${timestamp} ${header1}`);
  lines.push(`${timestamp} ${header2}`);

  for (const phase of summary.topPhases) {
    const line = `[serverperf] ${phase.name}: total=${phase.totalMs.toFixed(1)}ms avg=${phase.avgMs.toFixed(
      1
    )}ms max=${phase.maxMs.toFixed(1)}ms`;
    player.sendMessage(line);
    lines.push(`${timestamp} ${line}`);
  }

  fs.mkdirSync(path.dirname(SERVER_PERF_SNAPSHOT_FILE), { recursive: true });
  fs.appendFileSync(SERVER_PERF_SNAPSHOT_FILE, `${lines.join("\n")}\n`, "utf8");
}

module.exports = {
  name: "PluginPerfCommand",
  register(api) {
    pluginApi = api;
    World = api.getWorld();
    ServerPerf = api.getServerPerf();
    api.onPlayerDisconnect(({ username }) => {
      if (username) {
        stopPluginPerfStream(username);
      }
    });

    api.onPlayerLogout(({ username }) => {
      if (username) {
        stopPluginPerfStream(username);
      }
    });

    api.registerCommand("pluginperf", ({ player, parts }) => {
      const firstArg = (parts[1] || "").toLowerCase();
      const legacyLimitArg = parseIntArg(parts[1]);
      const legacyIntervalArg = parseIntArg(parts[2]);
      const usingLegacyNumericForm = legacyLimitArg !== null;
      const sub = usingLegacyNumericForm ? "on" : firstArg || "once";
      const limitArg = usingLegacyNumericForm ? legacyLimitArg : parseIntArg(parts[2]);
      const intervalArg = usingLegacyNumericForm ? legacyIntervalArg : parseIntArg(parts[3]);
      const limit = limitArg && limitArg > 0 ? Math.min(limitArg, MAX_LIMIT) : DEFAULT_LIMIT;
      const intervalMs =
        intervalArg && intervalArg >= MIN_INTERVAL_MS
          ? Math.min(intervalArg, MAX_INTERVAL_MS)
          : DEFAULT_INTERVAL_MS;
      const username = player.getUsername();

      if (sub === "reset") {
        pluginApi.resetPluginPerformanceStats();
        player.sendMessage("[pluginperf] Stats reset.");
        return true;
      }

      if (sub === "off") {
        stopPluginPerfStream(username);
        if (pluginPerfStreams.size === 0) {
          pluginApi.setPluginPerformanceProfilingEnabled(false);
        }
        player.sendMessage(
          `[pluginperf] Live stream disabled. profiling=${pluginApi.isPluginPerformanceProfilingEnabled()}`
        );
        return true;
      }

      if (sub === "on") {
        pluginApi.setPluginPerformanceProfilingEnabled(true);
        stopPluginPerfStream(username);
        const timer = setInterval(() => {
          if (!World.isPlayerSessionConnected(player)) {
            stopPluginPerfStream(username);
            if (pluginPerfStreams.size === 0) {
              pluginApi.setPluginPerformanceProfilingEnabled(false);
            }
            return;
          }
          streamPluginPerfToPlayer(player, limit);
        }, intervalMs);
        timer.unref?.();
        pluginPerfStreams.set(username, timer);
        player.sendMessage(
          `[pluginperf] Live stream enabled every ${intervalMs}ms (limit=${limit}).`
        );
        return true;
      }

      if (sub === "once") {
        const wasEnabled = pluginApi.isPluginPerformanceProfilingEnabled();
        pluginApi.setPluginPerformanceProfilingEnabled(true);
        streamPluginPerfToPlayer(player, limit);
        if (!wasEnabled && pluginPerfStreams.size === 0) {
          pluginApi.setPluginPerformanceProfilingEnabled(false);
        }
        return true;
      }

      player.sendMessage("Usage: ::pluginperf [once|on|off|reset] [limit] [intervalMs]");
      return true;
    }, PlayerRights.ADMINISTRATOR, "Inspect plugin performance");

    api.registerCommand("serverperf", ({ player, parts }) => {
      const ticksArg = parseIntArg(parts[1]);
      const ticks = ticksArg && ticksArg > 0 ? Math.min(ticksArg, 300) : 60;
      streamServerPerfToPlayer(player, ticks);
      return true;
    }, PlayerRights.ADMINISTRATOR, "Show server performance");
  },
};
