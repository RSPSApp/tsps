const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { resolveAccess } = require("./worldadmin/Access.WorldAdmin");
const { createRequestHandler } = require("./worldadmin/Http.WorldAdmin");

// The world config page's own HTTP listener (spec "Saving", "Restart", "Access").
//   WORLD_ADMIN_PORT (default 49600), WORLD_ADMIN_TOKEN (fixed token), WORLD_ADMIN_BIND (only with a 24+ character token)
// Without WORLD_ADMIN_TOKEN the generated token is kept in data/definitions/world-admin.token
// (gitignored) so the page stays signed in across the restarts it triggers.
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
const PLUGIN_NAME = "WorldAdmin";
const PLUGIN_DIRECTORY = path.join(__dirname, "..");
const DEFINITIONS_DIRECTORY = () => path.resolve("data/definitions");
const TOKEN_FILE_NAME = "world-admin.token";
const SELF_OFF_WARNING =
  "This turns off the world config page; you'd need to edit world.local.json by hand to turn it back on.";

let pluginApi = null;
let httpServer = null;
let access = null;
let boundPort = null;
// The accepted Apply waiting for its restart: { id, kind: "countdown" | "now", seconds? }.
let pendingApply = null;
// Why the last accepted Apply did not happen: { at, message }. Cleared when a new one is accepted.
let lastFailure = null;

/**
 * How the server comes back after Apply. Under nodemon (`yarn dev`, `yarn start`, `dev:stress`,
 * or nodemon started by hand or from an IDE in server/) nodemon.json sets TSPS_RESTARTER=nodemon
 * in the server's environment. npm_lifecycle_event=dev (exported by npm/yarn for the "dev"
 * script) is kept as a fallback for a nodemon run with another config.
 */
function restartMode() {
  if (process.env.TSPS_SUPERVISED === "1") return "supervised";
  if (process.env.TSPS_RESTARTER === "nodemon" || process.env.npm_lifecycle_event === "dev") return "dev";
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

function shuttingDown() {
  return pluginApi.core.Server.isShuttingDown?.() === true;
}

/**
 * Drops a countdown Apply that GameUpdate no longer runs for us (cancelled in game with
 * ::gameUpdate cancel). Once the countdown has fired the shutdown is in progress, and its own
 * afterPersist / onCancelled settle the pending apply.
 */
function pendingApplyNow(status) {
  if (
    pendingApply?.kind === "countdown" &&
    !(status.scheduled === true && status.id === pendingApply.id) &&
    !shuttingDown()
  ) {
    pendingApply = null;
  }
  return pendingApply;
}

function readLayers() {
  return pluginApi.core.WorldConfigStore.read(DEFINITIONS_DIRECTORY());
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** The store's plan, plus a warning when the change switches this page itself off. */
function planFor(layers, changes) {
  const catalog = pluginApi.core.WorldConfigCatalog.build(PLUGIN_DIRECTORY, layers);
  const plan = pluginApi.core.WorldConfigStore.plan(layers, changes, catalog);
  const switchedTo =
    plainObject(plan.nextLocal?.plugins)[PLUGIN_NAME] ?? plainObject(layers.shipped?.plugins)[PLUGIN_NAME];
  if (switchedTo !== false) return plan;
  return { ...plan, warnings: [...plan.warnings, SELF_OFF_WARNING] };
}

function layerSummary(layers) {
  const summary = { localHash: layers.localHash, localExists: layers.localExists };
  if (layers.localError) summary.localError = layers.localError;
  return summary;
}

function catalogAction() {
  const layers = readLayers();
  const status = gameUpdateStatus();
  const pending = pendingApplyNow(status);
  return {
    status: 200,
    body: {
      catalog: pluginApi.core.WorldConfigCatalog.build(PLUGIN_DIRECTORY, layers),
      layers: layerSummary(layers),
      mode: restartMode(),
      onlinePlayers: onlinePlayers(),
      countdown: {
        remainingSeconds: status.remainingSeconds ?? 0,
        scheduled: status.scheduled === true,
        available: status.remainingSeconds !== undefined,
      },
      pending: pending ? { kind: pending.kind, seconds: pending.seconds } : null,
      lastFailure,
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

function recordFailure(id, reason) {
  if (pendingApply?.id === id) pendingApply = null;
  lastFailure = { at: new Date().toISOString(), message: `Restart cancelled: ${reason}. Nothing was written.` };
}

/**
 * The beforeShutdown hook: refuses a restart whose write is already doomed (world.local.json
 * edited by hand or broken since Apply), before any plugin is shut down. afterPersist checks
 * again, for an edit made while players are being saved.
 */
function checkBeforeShutdown(id, expectedHash) {
  return function checkWorldConfigUnchanged() {
    let reason = null;
    try {
      const layers = readLayers();
      if (layers.localError) reason = `world.local.json does not parse (${layers.localError}); fix it by hand first`;
      else if (layers.localHash !== expectedHash) reason = "world.local.json changed since loaded; reload the page and try again";
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    if (reason === null) return;
    console.error(`[world-admin] world.local.json not written, restart cancelled: ${reason}`);
    recordFailure(id, reason);
    throw new Error(reason);
  };
}

/** The afterPersist hook: writes what Apply accepted, refusing if the file changed since. */
function deferredWrite(id, nextLocal, expectedHash) {
  return function writeWorldConfig() {
    try {
      pluginApi.core.WorldConfigStore.write(DEFINITIONS_DIRECTORY(), nextLocal, expectedHash);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[world-admin] world.local.json not written, restart cancelled: ${reason}`);
      recordFailure(id, reason);
      throw err;
    }
    if (pendingApply?.id === id) pendingApply = null;
    console.info("[world-admin] world.local.json written; restarting");
  };
}

/** Server.shutdown's onCancelled: the restart did not happen and the server keeps running. */
function restartCancelled(id) {
  return function onRestartCancelled(reason) {
    // A refused write already recorded the precise reason (and cleared the pending apply).
    if (pendingApply?.id !== id && lastFailure) return;
    console.warn(`[world-admin] restart cancelled: ${reason}`);
    recordFailure(id, reason);
  };
}

function restartNow(id, shutdownOptions) {
  pendingApply = { id, kind: "now" };
  return {
    status: 202,
    body: { applied: "restarting" },
    // Only once the 202 has been sent: the shutdown may exit the process.
    afterResponse: () => pluginApi.core.Server.shutdown("worldConfig", shutdownOptions),
  };
}

function applyAction({ changes, localHash, seconds = DEFAULT_COUNTDOWN_SECONDS }) {
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_COUNTDOWN_SECONDS) {
    return { status: 400, body: { error: `seconds must be a whole number from 1 to ${MAX_COUNTDOWN_SECONDS}` } };
  }
  const status = gameUpdateStatus();
  if (pendingApplyNow(status) || status.scheduled === true || status.remainingSeconds > 0 || shuttingDown()) {
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
    lastFailure = null;
    console.info("[world-admin] world.local.json written; takes effect at the next restart");
    return { status: 200, body: { applied: "written", restartNeeded: true, plan } };
  }

  const id = crypto.randomUUID();
  const shutdownOptions = {
    beforeShutdown: checkBeforeShutdown(id, layers.localHash),
    afterPersist: deferredWrite(id, plan.nextLocal, layers.localHash),
    onCancelled: restartCancelled(id),
    exitCode: mode === "supervised" ? SUPERVISED_EXIT_CODE : DEV_EXIT_CODE,
  };
  if (onlinePlayers() > 0) {
    const start = { seconds, id, ...shutdownOptions };
    pluginApi.emitCustomEvent("GameUpdate:start", start);
    if (start.error) return { status: 409, body: { error: start.error } };
    if (start.accepted === true) {
      lastFailure = null;
      pendingApply = { id, kind: "countdown", seconds };
      return { status: 202, body: { applied: "countdown", seconds } };
    }
    // Nothing answered: GameUpdate is switched off, so there is no countdown.
  }
  lastFailure = null;
  return restartNow(id, shutdownOptions);
}

function cancelAction() {
  const payload = {};
  pluginApi.emitCustomEvent("GameUpdate:cancel", payload);
  if (pendingApply?.kind === "countdown" && !shuttingDown()) pendingApply = null;
  return { status: 200, body: { cancelled: payload.cancelled === true } };
}

const actions = {
  catalog: catalogAction,
  preview: previewAction,
  apply: applyAction,
  cancel: cancelAction,
};

// The listener stays open through a shutdown: when the shutdown cancels itself the page still
// shows why. Process exit (or nodemon's SIGUSR2 restart) releases the port, and unref keeps the
// listener from holding the process open by itself.
async function startWorldAdmin() {
  if (process.env.BROWSER_HOST === "1" || httpServer) return;
  access = resolveAccess(process.env, { tokenFile: path.join(DEFINITIONS_DIRECTORY(), TOKEN_FILE_NAME) });
  for (const note of access.notes) console.warn(`[world-admin] ${note}`);
  const server = http.createServer(createRequestHandler(
    { token: access.token, loopback: access.loopback, port: () => boundPort },
    actions,
    pluginApi.core.WorldConfigStore.worldSettingKeys(),
  ));
  const listening = await new Promise((resolve) => {
    server.on("error", (error) => {
      console.error(`[world-admin] server error: ${error.message}`);
      resolve(false);
    });
    server.listen(access.port, access.host, () => resolve(true));
  });
  if (!listening) return;
  server.unref();
  httpServer = server;
  boundPort = server.address().port;
  console.info(`[world-admin] listening on ${access.host}:${boundPort}`);
  console.info(`[world-admin] world config page: http://localhost:${boundPort}/?token=${access.token}`);
}

/** Tests only: close the listener and forget the state. */
function stopWorldAdmin() {
  const server = httpServer;
  httpServer = null;
  pendingApply = null;
  lastFailure = null;
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

module.exports = {
  name: PLUGIN_NAME,
  description: "Local web page for editing world.json settings and plugin switches.",
  register(api) {
    pluginApi = api;
    api.onServerStartup(startWorldAdmin);
  },
  _test: { stop: stopWorldAdmin },
};
