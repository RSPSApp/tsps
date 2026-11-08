const http = require("http");
const path = require("path");
const { resolveAccess } = require("./worldadmin/Access.WorldAdmin");
const { createRequestHandler } = require("./worldadmin/Http.WorldAdmin");

// The world config page's own HTTP listener (spec "Saving", "Restart", "Access").
//   WORLD_ADMIN_PORT (default 49600), WORLD_ADMIN_TOKEN (fixed token), WORLD_ADMIN_BIND (only with a token)
// The startup log prints http://localhost:<port>/?token=<token>; opening it sets a cookie.
// Apply writes data/definitions/world.local.json only (never world.json):
//   manual     - written now, restart by hand;
//   dev        - nodemon restarts after the write (exit code 0);
//   supervised - TSPS_SUPERVISED=1, exits 75 so on-failure restart policies bring it back.
// With players online the write waits for the GameUpdate countdown and runs after players are saved.

const SUPERVISED_EXIT_CODE = 75;
const DEV_EXIT_CODE = 0;
const DEFAULT_COUNTDOWN_SECONDS = 60;
const MAX_COUNTDOWN_SECONDS = 24 * 60 * 60;
const PLUGIN_DIRECTORY = path.join(__dirname, "..");
const DEFINITIONS_DIRECTORY = () => path.resolve("data/definitions");

let pluginApi = null;
let httpServer = null;
let access = null;
let boundPort = null;
// The accepted Apply waiting for its restart: { kind: "countdown" | "now", seconds? }.
let pendingApply = null;

/**
 * How the server comes back after Apply. `yarn dev` / `yarn start` run the server's "dev"
 * script, and npm/yarn export npm_lifecycle_event=dev to it; run-with-env.mjs and nodemon both
 * pass the environment through to the server process. nodemon itself sets no marker of its own.
 */
function restartMode() {
  if (process.env.TSPS_SUPERVISED === "1") return "supervised";
  if (process.env.npm_lifecycle_event === "dev") return "dev";
  return "manual";
}

function onlinePlayers() {
  return pluginApi.core.World.getPlayers()?.sizeReturn?.() ?? 0;
}

function gameUpdateStatus() {
  const payload = {};
  pluginApi.emitCustomEvent("GameUpdate:status", payload);
  return payload;
}

/** Drops a countdown Apply that GameUpdate no longer runs (cancelled in game with ::gameUpdate cancel). */
function pendingApplyNow() {
  if (pendingApply?.kind === "countdown" && !(gameUpdateStatus().remainingSeconds > 0)) {
    pendingApply = null;
  }
  return pendingApply;
}

function readLayers() {
  return pluginApi.core.WorldConfigStore.read(DEFINITIONS_DIRECTORY());
}

function planFor(layers, changes) {
  const catalog = pluginApi.core.WorldConfigCatalog.build(PLUGIN_DIRECTORY, layers);
  return pluginApi.core.WorldConfigStore.plan(layers, changes, catalog);
}

function layerSummary(layers) {
  const summary = { localHash: layers.localHash, localExists: layers.localExists };
  if (layers.localError) summary.localError = layers.localError;
  return summary;
}

function catalogAction() {
  const layers = readLayers();
  const status = gameUpdateStatus();
  const pending = pendingApplyNow();
  return {
    status: 200,
    body: {
      catalog: pluginApi.core.WorldConfigCatalog.build(PLUGIN_DIRECTORY, layers),
      layers: layerSummary(layers),
      mode: restartMode(),
      onlinePlayers: onlinePlayers(),
      countdown: { remainingSeconds: status.remainingSeconds ?? 0, available: status.remainingSeconds !== undefined },
      pending: pending ? { ...pending } : null,
    },
  };
}

function previewAction({ changes }) {
  return { status: 200, body: planFor(readLayers(), changes) };
}

function writeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return { status: /changed since loaded|fix it by hand/.test(message) ? 409 : 500, body: { error: message } };
}

/** The afterPersist hook: writes what Apply accepted, refusing if the file changed since. */
function deferredWrite(nextLocal, expectedHash) {
  return function writeWorldConfig() {
    try {
      pluginApi.core.WorldConfigStore.write(DEFINITIONS_DIRECTORY(), nextLocal, expectedHash);
      console.info("[world-admin] world.local.json written; restarting");
    } catch (err) {
      console.error(`[world-admin] world.local.json not written, restart cancelled: ${err?.message ?? err}`);
      // The shutdown that called us closed the listener; the server keeps running, so reopen it.
      startListener();
      throw err;
    } finally {
      pendingApply = null;
    }
  };
}

function restartNow(afterPersist, exitCode) {
  pendingApply = { kind: "now" };
  // After the response is sent: shutdown closes this listener.
  setImmediate(() => pluginApi.core.Server.shutdown("worldConfig", { afterPersist, exitCode }));
  return { status: 202, body: { applied: "restarting" } };
}

function applyAction({ changes, localHash, seconds = DEFAULT_COUNTDOWN_SECONDS }) {
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_COUNTDOWN_SECONDS) {
    return { status: 400, body: { error: `seconds must be a whole number from 1 to ${MAX_COUNTDOWN_SECONDS}` } };
  }
  if (pendingApplyNow() || gameUpdateStatus().remainingSeconds > 0) {
    return { status: 409, body: { error: "A restart is already pending; cancel it first" } };
  }
  const layers = readLayers();
  if (layers.localError) {
    return { status: 409, body: { error: `world.local.json does not parse (${layers.localError}); fix it by hand first` } };
  }
  if (localHash !== layers.localHash) {
    return { status: 409, body: { error: "world.local.json changed since you loaded it; reload the page" } };
  }
  const plan = planFor(layers, changes);
  if (plan.errors.length > 0) return { status: 400, body: plan };

  const mode = restartMode();
  if (mode === "manual") {
    try {
      pluginApi.core.WorldConfigStore.write(DEFINITIONS_DIRECTORY(), plan.nextLocal, layers.localHash);
    } catch (err) {
      return writeError(err);
    }
    console.info("[world-admin] world.local.json written; takes effect at the next restart");
    return { status: 200, body: { applied: "written", restartNeeded: true, plan } };
  }

  const exitCode = mode === "supervised" ? SUPERVISED_EXIT_CODE : DEV_EXIT_CODE;
  const afterPersist = deferredWrite(plan.nextLocal, layers.localHash);
  if (onlinePlayers() === 0) return restartNow(afterPersist, exitCode);
  const start = { seconds, afterPersist, exitCode };
  pluginApi.emitCustomEvent("GameUpdate:start", start);
  if (start.accepted === true) {
    pendingApply = { kind: "countdown", seconds };
    return { status: 202, body: { applied: "countdown", seconds } };
  }
  if (start.error) return { status: 409, body: { error: start.error } };
  // GameUpdate is switched off: no countdown available.
  return restartNow(afterPersist, exitCode);
}

function cancelAction() {
  const payload = {};
  pluginApi.emitCustomEvent("GameUpdate:cancel", payload);
  if (pendingApply?.kind === "countdown") pendingApply = null;
  return { status: 200, body: { cancelled: payload.cancelled === true } };
}

const actions = {
  catalog: catalogAction,
  preview: previewAction,
  apply: applyAction,
  cancel: cancelAction,
};

function startListener() {
  if (httpServer || !access) return Promise.resolve();
  const server = http.createServer(createRequestHandler(
    { token: access.token, loopback: access.loopback, port: () => boundPort },
    actions,
  ));
  httpServer = server;
  return new Promise((resolve) => {
    server.on("error", (error) => {
      console.error(`[world-admin] server error: ${error.message}`);
      if (!server.listening && httpServer === server) httpServer = null;
      resolve();
    });
    server.listen(boundPort ?? access.port, access.host, () => {
      boundPort = server.address().port;
      resolve();
    });
  });
}

async function startWorldAdmin() {
  if (process.env.BROWSER_HOST === "1") return;
  access = resolveAccess(process.env);
  boundPort = null;
  for (const note of access.notes) console.warn(`[world-admin] ${note}`);
  await startListener();
  if (!httpServer?.listening) return;
  console.info(`[world-admin] listening on ${access.host}:${boundPort}`);
  console.info(`[world-admin] world config page: http://localhost:${boundPort}/?token=${access.token}`);
}

function stopWorldAdmin() {
  const server = httpServer;
  httpServer = null;
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
}

module.exports = {
  name: "WorldAdmin",
  description: "Local web page for editing world.json settings and plugin switches.",
  register(api) {
    pluginApi = api;
    api.onServerStartup(startWorldAdmin);
    api.onServerShutdown(stopWorldAdmin);
  },
};
