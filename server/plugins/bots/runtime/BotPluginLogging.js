const fs = require("fs");
const path = require("path");
const {
  BotRuntimeTelemetry,
} = require("../../../src/main/typescript/elvarg/util/BotRuntimeTelemetry");

const HOT_EVENT_THROTTLES_MS = Object.freeze({
  bot_movement_node_dispatch: 3000,
  path_blocked_retarget: 2500,
  path_blocked_backoff_applied: 1500,
  ditch_post_delay_retry_waiting: 2500,
});

function createBotPluginLogging(options = {}) {
  const api = options.api;
  const logPath = options.logPath;
  const runtimeEventLoggingEnabled = options.runtimeEventLoggingEnabled === true;
  const fileLogWritesEnabled = options.fileLogWritesEnabled === true;
  const telemetryEnabled = options.telemetryEnabled !== false;
  const telemetryLogPath =
    typeof options.telemetryLogPath === "string" && options.telemetryLogPath.length > 0
      ? options.telemetryLogPath
      : null;
  const telemetryIntervalMs = Number.isFinite(options.telemetryIntervalMs)
    ? Math.max(1000, Math.floor(options.telemetryIntervalMs))
    : 10000;
  const mirrorToServerLogger = options.mirrorToServerLogger === true;
  const mirrorErrorsToServerLogger = options.mirrorErrorsToServerLogger !== false;
  const recentLogLimit = Number.isFinite(options.recentLogLimit)
    ? Math.max(1, Math.floor(options.recentLogLimit))
    : 24;

  let botLogStream = null;
  let telemetryLogStream = null;
  let telemetryTimer = null;
  const recentBotLogsByUsername = new Map();
  const lastHotEventAtByKey = new Map();

  const writeTelemetryLine = (line) => {
    if (!fileLogWritesEnabled || !telemetryLogPath || typeof line !== "string") {
      return;
    }
    try {
      if (telemetryLogStream) {
        telemetryLogStream.write(line);
      } else {
        fs.appendFileSync(telemetryLogPath, line);
      }
    } catch (_) {
      // Keep bots running even if telemetry writes fail.
    }
  };

  const flushTelemetrySnapshot = (reason = "interval") => {
    if (!telemetryEnabled) {
      return;
    }
    try {
      const snapshot = BotRuntimeTelemetry.flushIntervalSnapshot(10);
      if (!snapshot || snapshot.totalEvents <= 0) {
        return;
      }
      writeTelemetryLine(
        `[${new Date().toISOString()}] ${reason} ${JSON.stringify(snapshot)}\n`
      );
    } catch (_) {
      // Ignore telemetry flush failures.
    }
  };

  const shouldThrottleHotEvent = (message, extra, nowMs) => {
    const throttleMs = Number(HOT_EVENT_THROTTLES_MS[message] ?? 0);
    if (throttleMs <= 0) {
      return false;
    }
    const username =
      typeof extra?.username === "string" && extra.username.length > 0
        ? extra.username
        : "__global__";
    const key = `${message}|${username}`;
    const lastAt = Number(lastHotEventAtByKey.get(key) ?? 0);
    if (nowMs - lastAt < throttleMs) {
      return true;
    }
    lastHotEventAtByKey.set(key, nowMs);
    return false;
  };

  const rememberRecentBotLog = (username, line) => {
    if (!username || typeof line !== "string") {
      return;
    }
    const history = recentBotLogsByUsername.get(username) ?? [];
    history.push(line);
    if (history.length > recentLogLimit) {
      history.splice(0, history.length - recentLogLimit);
    }
    recentBotLogsByUsername.set(username, history);
  };

  const trackRecentBotLog = (message, extra, timestamp) => {
    const username = extra?.username;
    if (typeof username !== "string" || username.length === 0) {
      return;
    }
    const suffix =
      extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
    rememberRecentBotLog(username, `[${timestamp}] ${message}${suffix}`);
  };

  const writeBotLog = (message, extra) => {
    if (!runtimeEventLoggingEnabled) {
      return;
    }
    try {
      const nowMs = Date.now();
      if (shouldThrottleHotEvent(message, extra, nowMs)) {
        return;
      }
      const timestamp = new Date(nowMs).toISOString();
      const suffix =
        extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
      const line = `[${timestamp}] ${message}${suffix}\n`;
      if (fileLogWritesEnabled) {
        if (botLogStream) {
          botLogStream.write(line);
        } else if (logPath) {
          // Fallback path before stream init completes.
          fs.appendFileSync(logPath, line);
        }
      }
      trackRecentBotLog(message, extra, timestamp);
    } catch (_) {
      // Keep bot behavior running even if file logging fails.
    }
  };

  const shouldMirrorToServerLog = (message) => {
    if (mirrorToServerLogger) {
      return true;
    }
    if (!mirrorErrorsToServerLogger || typeof message !== "string") {
      return false;
    }
    return /error|failed|exception|fatal/i.test(message);
  };

  const botApi = Object.create(api ?? {});
  botApi.log = (message, extra) => {
    BotRuntimeTelemetry.record(message, extra ?? null);
    if (!runtimeEventLoggingEnabled) {
      return;
    }
    if (shouldMirrorToServerLog(message)) {
      api?.log?.(message, extra);
    }
    writeBotLog(message, extra);
  };

  if (runtimeEventLoggingEnabled && fileLogWritesEnabled && logPath) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, "");
      botLogStream = fs.createWriteStream(logPath, {
        flags: "a",
        encoding: "utf8",
      });
      writeBotLog("log_reset");
    } catch (err) {
      api?.log?.("bot_log_init_failed", {
        path: logPath,
        error: String(err?.message ?? err),
      });
    }
  }

  if (telemetryEnabled && fileLogWritesEnabled && telemetryLogPath) {
    try {
      fs.mkdirSync(path.dirname(telemetryLogPath), { recursive: true });
      fs.writeFileSync(telemetryLogPath, "");
      telemetryLogStream = fs.createWriteStream(telemetryLogPath, {
        flags: "a",
        encoding: "utf8",
      });
      telemetryTimer = setInterval(() => {
        flushTelemetrySnapshot("interval");
      }, telemetryIntervalMs);
      telemetryTimer.unref?.();
    } catch (err) {
      api?.log?.("bot_telemetry_log_init_failed", {
        path: telemetryLogPath,
        error: String(err?.message ?? err),
      });
    }
  }

  return {
    botApi,
    recentBotLogsByUsername,
  };
}

module.exports = {
  createBotPluginLogging,
};
