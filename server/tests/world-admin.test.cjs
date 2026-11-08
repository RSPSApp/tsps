const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const PLUGIN = path.join(__dirname, "../plugins/tools/WorldAdmin.plugin.js");
const ENV_KEYS = [
  "WORLD_ADMIN_PORT", "WORLD_ADMIN_TOKEN", "WORLD_ADMIN_BIND", "BROWSER_HOST",
  "TSPS_SUPERVISED", "npm_lifecycle_event",
];
const TOKEN = "test-token-abcdefghijklmnop";

function freshPlugin() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}tools${path.sep}worldadmin${path.sep}`) || key === PLUGIN) {
      delete require.cache[key];
    }
  }
  return require(PLUGIN);
}

function captureLogs() {
  const logs = [];
  const saved = { info: console.info, warn: console.warn, error: console.error };
  for (const level of Object.keys(saved)) {
    console[level] = (...args) => logs.push(`${level}: ${args.map(String).join(" ")}`);
  }
  return { logs, restore: () => Object.assign(console, saved) };
}

/** Starts the plugin on port 0 against a fake core; nothing touches the real data files. */
async function start(t, env = {}, opts = {}) {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { WORLD_ADMIN_PORT: "0", WORLD_ADMIN_TOKEN: TOKEN }, env);
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_KEYS.includes(key) && value === "") delete process.env[key];
  }

  const state = {
    layers: { shipped: { name: "w" }, local: {}, localExists: true, localHash: "hash-1" },
    plan: { nextLocal: { plugins: { Foo: false } }, diff: [{ path: "plugins.Foo", before: true, after: false }], warnings: [], errors: [] },
    online: opts.online ?? 0,
    writes: [],
    shutdowns: [],
    events: [],
    gameUpdateLoaded: opts.gameUpdateLoaded ?? true,
    remaining: 0,
    scheduled: false,
    scheduleId: undefined,
    shuttingDown: false,
  };
  const core = {
    WorldConfigStore: {
      read: () => state.layers,
      plan: () => state.plan,
      write: (dir, nextLocal, expectedHash) => {
        if (expectedHash !== state.layers.localHash) {
          throw new Error("world.local.json changed since loaded; reload the page and try again");
        }
        state.writes.push({ dir, nextLocal, expectedHash });
      },
    },
    WorldConfigCatalog: { build: () => ({ plugins: [], options: [], world: [], membersWorld: true }) },
    Server: {
      shutdown: (reason, options) => state.shutdowns.push({ reason, options }),
      isShuttingDown: () => state.shuttingDown,
    },
    World: { getPlayers: () => ({ sizeReturn: () => state.online }) },
  };
  const hooks = {};
  const api = {
    core,
    onServerStartup: (h) => { hooks.startup = h; },
    onServerShutdown: (h) => { hooks.shutdown = h; },
    emitCustomEvent: (name, payload) => {
      state.events.push({ name, payload });
      if (!state.gameUpdateLoaded) return;
      if (name === "GameUpdate:start") {
        if (state.scheduled) { payload.error = "already scheduled"; return; }
        state.remaining = payload.seconds;
        state.scheduled = true;
        state.scheduleId = payload.id;
        payload.accepted = true;
      } else if (name === "GameUpdate:cancel") {
        payload.cancelled = state.scheduled;
        state.remaining = 0;
        state.scheduled = false;
        state.scheduleId = undefined;
      } else if (name === "GameUpdate:status") {
        payload.remainingSeconds = state.remaining;
        payload.scheduled = state.scheduled;
        if (state.scheduled && state.scheduleId !== undefined) payload.id = state.scheduleId;
      }
    },
  };

  const plugin = freshPlugin();
  const capture = captureLogs();
  let port = null;
  // The token file goes under <cwd>/data/definitions: tests that start without a token use a temp cwd.
  const savedCwd = process.cwd();
  if (opts.cwd) process.chdir(opts.cwd);
  try {
    plugin.register(api);
    await hooks.startup({ timestamp: Date.now() });
  } catch (err) {
    capture.restore();
    throw err;
  } finally {
    process.chdir(savedCwd);
  }
  const link = capture.logs.join("\n").match(/http:\/\/localhost:(\d+)\/\?token=([A-Za-z0-9_-]+)/);
  if (link) port = Number(link[1]);
  t.after(async () => {
    await plugin._test.stop();
    capture.restore();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });
  return { plugin, state, hooks, logs: capture.logs, port, token: link?.[2] };
}

function request(port, { method = "GET", path: urlPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, method, path: urlPath, agent: false,
      headers: {
        Host: `localhost:${port}`,
        ...(data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const apply = (port, body, headers = {}) =>
  request(port, { method: "POST", path: "/api/apply", headers: { ...auth, ...headers }, body });
const tick = () => new Promise((r) => setImmediate(r));

/** A temp server directory with data/definitions, removed after the test. */
function tempServerDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-admin-"));
  fs.mkdirSync(path.join(dir, "data", "definitions"), { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, tokenFile: path.join(dir, "data", "definitions", "world-admin.token") };
}

test("every request needs the token; Host and Origin are checked; no CORS headers", async (t) => {
  const { port } = await start(t);
  assert.ok(port, "startup prints the link");

  assert.equal((await request(port, { path: "/api/catalog" })).status, 401);
  assert.equal((await request(port, { path: "/api/catalog", headers: { Authorization: "Bearer nope" } })).status, 401);
  assert.equal((await request(port, { path: "/api/catalog", headers: { Cookie: "wa_token=nope" } })).status, 401);
  assert.equal((await request(port, { path: "/?token=nope" })).status, 401);
  assert.equal((await request(port, { path: "/api/catalog", headers: { ...auth, Host: "evil.example" } })).status, 403);
  assert.equal((await request(port, { path: "/api/catalog", headers: { ...auth, Host: `evil.example:${port}` } })).status, 403);

  const evil = await request(port, {
    method: "POST", path: "/api/preview", headers: { ...auth, Origin: "http://evil.example" },
    body: { changes: {}, localHash: "hash-1" },
  });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers["access-control-allow-origin"], undefined);

  const same = await request(port, {
    method: "POST", path: "/api/preview", headers: { ...auth, Origin: `http://localhost:${port}` },
    body: { changes: {}, localHash: "hash-1" },
  });
  assert.equal(same.status, 200);
  assert.deepEqual(same.json.errors, []);

  const textBody = await request(port, {
    method: "POST", path: "/api/preview", headers: { ...auth, "Content-Type": "text/plain" }, body: "{}",
  });
  assert.equal(textBody.status, 415);

  const ok = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["access-control-allow-origin"], undefined);
  const preflight = await request(port, { method: "OPTIONS", path: "/api/apply", headers: { ...auth, Origin: "http://evil.example" } });
  assert.equal(preflight.headers["access-control-allow-origin"], undefined);
});

test("GET /?token= sets an HttpOnly SameSite=Strict cookie and redirects to /; the cookie authenticates", async (t) => {
  const { port } = await start(t);
  const res = await request(port, { path: `/?token=${TOKEN}` });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/");
  const cookie = res.headers["set-cookie"][0];
  assert.ok(cookie.startsWith(`wa_token_${port}=`), cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const pair = cookie.split(";")[0];
  assert.equal((await request(port, { path: "/api/catalog", headers: { Cookie: pair } })).status, 200);
  // Another worktree's cookie (same host, other port) is not this listener's.
  const otherPort = `wa_token_${port + 1}=${encodeURIComponent(TOKEN)}`;
  assert.equal((await request(port, { path: "/api/catalog", headers: { Cookie: otherPort } })).status, 401);
  assert.equal((await request(port, { path: "/api/catalog", headers: { Cookie: `wa_token=${TOKEN}` } })).status, 401);
});

test("catalog reports layers, mode, online players and countdown", async (t) => {
  const { port, state } = await start(t, { npm_lifecycle_event: "dev" }, { online: 3 });
  const res = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.layers, { localHash: "hash-1", localExists: true });
  assert.equal(res.json.mode, "dev");
  assert.equal(res.json.onlinePlayers, 3);
  assert.equal(res.json.countdown.remainingSeconds, 0);
  assert.deepEqual(res.json.catalog.plugins, []);
  assert.equal(state.layers.local.shouldNotLeak, undefined);
});

test("random token when WORLD_ADMIN_TOKEN is unset; WORLD_ADMIN_BIND alone still binds 127.0.0.1 and says why", async (t) => {
  const { dir } = tempServerDir(t);
  const { port, token, logs } = await start(t, { WORLD_ADMIN_TOKEN: "", WORLD_ADMIN_BIND: "0.0.0.0" }, { cwd: dir });
  assert.ok(port);
  assert.ok(token && token.length >= 24 && token !== TOKEN);
  const text = logs.join("\n");
  assert.match(text, /WORLD_ADMIN_BIND.*WORLD_ADMIN_TOKEN/);
  assert.match(text, /127\.0\.0\.1/);
  assert.doesNotMatch(text, /listening on 0\.0\.0\.0/);
  // The token is printed exactly once.
  assert.equal(text.split(token).length - 1, 1);
  assert.equal((await request(port, { path: "/api/catalog", headers: { Authorization: `Bearer ${token}` } })).status, 200);
});

test("the generated token is kept in data/definitions/world-admin.token and reused on the next start", async (t) => {
  const { dir, tokenFile } = tempServerDir(t);
  const first = await start(t, { WORLD_ADMIN_TOKEN: "" }, { cwd: dir });
  assert.ok(first.token && first.token.length >= 24);
  assert.equal(fs.readFileSync(tokenFile, "utf8").trim(), first.token);
  if (process.platform !== "win32") assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
  await first.plugin._test.stop();

  const second = await start(t, { WORLD_ADMIN_TOKEN: "" }, { cwd: dir });
  assert.equal(second.token, first.token);
  assert.match(second.logs.join(" "), /world config page: http:\/\/localhost:\d+\/\?token=/);
  assert.equal((await request(second.port, { path: "/api/catalog", headers: { Authorization: `Bearer ${first.token}` } })).status, 200);
});

test("WORLD_ADMIN_TOKEN wins over the token file, which is left alone", async (t) => {
  const { dir, tokenFile } = tempServerDir(t);
  const fileToken = "file-token-0123456789abcdefghij";
  fs.writeFileSync(tokenFile, fileToken + "\n");
  const { port, token } = await start(t, {}, { cwd: dir });
  assert.equal(token, TOKEN);
  assert.equal(fs.readFileSync(tokenFile, "utf8"), fileToken + "\n");
  assert.equal((await request(port, { path: "/api/catalog", headers: { Authorization: `Bearer ${fileToken}` } })).status, 401);
  assert.equal((await request(port, { path: "/api/catalog", headers: auth })).status, 200);
});

test("BROWSER_HOST=1 never listens", async (t) => {
  const { port, logs } = await start(t, { BROWSER_HOST: "1" });
  assert.equal(port, null);
  assert.doesNotMatch(logs.join("\n"), /token=/);
});

test("apply with a stale localHash is 409 and writes nothing", async (t) => {
  const { port, state } = await start(t);
  const res = await apply(port, { changes: { plugins: { Foo: false } }, localHash: "old-hash" });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /changed since you loaded it/);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.shutdowns, []);
});

test("malformed world.local.json: catalog returns localError and apply is 409", async (t) => {
  const { port, state } = await start(t);
  state.layers = { shipped: {}, local: {}, localExists: true, localHash: "bad", localError: "Unexpected token" };
  const cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.layers.localError, "Unexpected token");
  const res = await apply(port, { changes: {}, localHash: "bad" });
  assert.equal(res.status, 409);
  assert.deepEqual(state.writes, []);
});

test("plan errors are 400 with the plan", async (t) => {
  const { port, state } = await start(t);
  state.plan = { ...state.plan, errors: ["bad value"] };
  const res = await apply(port, { changes: {}, localHash: "hash-1" });
  assert.equal(res.status, 400);
  assert.deepEqual(res.json.errors, ["bad value"]);
  assert.deepEqual(state.writes, []);
});

test("manual mode writes immediately and says a restart is needed", async (t) => {
  const { port, state } = await start(t, {}, { online: 5 });
  const res = await apply(port, { changes: { plugins: { Foo: false } }, localHash: "hash-1" });
  assert.equal(res.status, 200);
  assert.equal(res.json.applied, "written");
  assert.equal(res.json.restartNeeded, true);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].expectedHash, "hash-1");
  assert.deepEqual(state.writes[0].nextLocal, { plugins: { Foo: false } });
  assert.deepEqual(state.shutdowns, []);
  assert.equal(state.events.filter((e) => e.name === "GameUpdate:start").length, 0);
});

test("dev mode with players online starts a 60 s GameUpdate with exitCode 0; a second apply is 409; cancel clears it", async (t) => {
  const { port, state } = await start(t, { npm_lifecycle_event: "dev" }, { online: 2 });
  const first = await apply(port, { changes: {}, localHash: "hash-1" });
  assert.equal(first.status, 202);
  const starts = state.events.filter((e) => e.name === "GameUpdate:start");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].payload.seconds, 60);
  assert.equal(starts[0].payload.exitCode, 0);
  assert.equal(typeof starts[0].payload.afterPersist, "function");
  assert.deepEqual(state.writes, [], "nothing written before the countdown ends");

  const second = await apply(port, { changes: {}, localHash: "hash-1", seconds: 30 });
  assert.equal(second.status, 409);
  assert.equal(state.events.filter((e) => e.name === "GameUpdate:start").length, 1);

  const cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.countdown.remainingSeconds, 60);

  const cancel = await request(port, { method: "POST", path: "/api/cancel", headers: auth, body: {} });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.cancelled, true);
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1", seconds: 30 })).status, 202);
  assert.deepEqual(state.writes, []);
});

test("supervised mode passes exitCode 75; afterPersist writes with the hash captured at Apply", async (t) => {
  const { port, state } = await start(t, { TSPS_SUPERVISED: "1" }, { online: 1 });
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1", seconds: 10 })).status, 202);
  const start0 = state.events.find((e) => e.name === "GameUpdate:start");
  assert.equal(start0.payload.exitCode, 75);
  assert.equal(start0.payload.seconds, 10);
  start0.payload.afterPersist();
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].expectedHash, "hash-1");
});

test("a hand edit during the countdown makes afterPersist throw (shutdown cancelled) and clears the pending apply", async (t) => {
  const { port, state } = await start(t, { TSPS_SUPERVISED: "1" }, { online: 1 });
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 202);
  const start0 = state.events.find((e) => e.name === "GameUpdate:start");
  state.layers = { ...state.layers, localHash: "hand-edited" };
  // The countdown fired: GameUpdate cleared its schedule and Server.shutdown is running.
  Object.assign(state, { remaining: 0, scheduled: false, scheduleId: undefined, shuttingDown: true });
  const during = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(during.json.pending.kind, "countdown", "still pending while the shutdown runs");
  const capture = captureLogs();
  try {
    assert.throws(() => start0.payload.afterPersist(), /changed since loaded/);
  } finally {
    capture.restore();
  }
  start0.payload.onCancelled("world.local.json changed since loaded"); // Server.shutdown follows up
  state.shuttingDown = false;
  assert.match(capture.logs.join("\n"), /not written/);
  assert.deepEqual(state.writes, []);
  const cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.pending, null);
  assert.match(cat.json.lastFailure.message, /^Restart cancelled: .*changed since loaded.*Nothing was written\.$/);
  assert.equal((await apply(port, { changes: {}, localHash: "hand-edited" })).status, 202);
  const after = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(after.json.lastFailure, null, "a newly accepted apply clears the failure");
});

test("a cancelled immediate restart (saving players failed) clears pending and reports lastFailure; the page stays up", async (t) => {
  const { port, state, hooks } = await start(t, { npm_lifecycle_event: "dev" }, { online: 0 });
  assert.equal(hooks.shutdown, undefined, "the listener is not closed by onServerShutdown");
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 202);
  await tick();
  assert.equal(state.shutdowns.length, 1);
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 409, "pending while restarting");
  const capture = captureLogs();
  try {
    state.shutdowns[0].options.onCancelled("saving players failed (1 player snapshot(s) failed)");
  } finally {
    capture.restore();
  }
  const cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.pending, null);
  assert.equal(cat.json.lastFailure.message, "Restart cancelled: saving players failed (1 player snapshot(s) failed). Nothing was written.");
  assert.ok(cat.json.lastFailure.at);
  assert.deepEqual(state.writes, []);
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 202);
});

test("countdown end gap and foreign countdowns", async (t) => {
  const { port, state } = await start(t, { npm_lifecycle_event: "dev" }, { online: 2 });
  // A ::gameUpdate countdown someone started in game is not the page's pending change.
  Object.assign(state, { remaining: 30, scheduled: true, scheduleId: undefined });
  let cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.pending, null);
  assert.equal(cat.json.countdown.scheduled, true);
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 409);
  Object.assign(state, { remaining: 0, scheduled: false });

  assert.equal((await apply(port, { changes: {}, localHash: "hash-1", seconds: 5 })).status, 202);
  // remainingSeconds reached 0 but the countdown task has not fired yet.
  state.remaining = 0;
  cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.pending.kind, "countdown");
  assert.equal(cat.json.countdown.scheduled, true);
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 409);

  // Cancelled in game, then a foreign countdown started: the page's change is gone.
  Object.assign(state, { remaining: 40, scheduled: true, scheduleId: "someone-else" });
  cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.pending, null);
});

test("switching WorldAdmin itself off adds a warning to the plan", async (t) => {
  const { port, state } = await start(t);
  state.plan = { ...state.plan, nextLocal: { plugins: { WorldAdmin: false } } };
  const res = await request(port, {
    method: "POST", path: "/api/preview", headers: auth,
    body: { changes: { plugins: { WorldAdmin: false } }, localHash: "hash-1" },
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.warnings.some((w) => /turns off the world config page/.test(w)));
  assert.deepEqual(state.plan.warnings, [], "the store plan object is not mutated");
});

test("nobody online, or GameUpdate not loaded: shuts down immediately with the write as afterPersist", async (t) => {
  const { port, state } = await start(t, { npm_lifecycle_event: "dev" }, { online: 0 });
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 202);
  await tick();
  assert.equal(state.shutdowns.length, 1);
  assert.equal(state.shutdowns[0].reason, "worldConfig");
  assert.equal(state.shutdowns[0].options.exitCode, 0);
  assert.equal(state.events.filter((e) => e.name === "GameUpdate:start").length, 0);
  state.shutdowns[0].options.afterPersist();
  assert.equal(state.writes.length, 1);
});

test("GameUpdate not loaded with players online: immediate shutdown", async (t) => {
  const { port, state } = await start(t, { TSPS_SUPERVISED: "1" }, { online: 4, gameUpdateLoaded: false });
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 202);
  await tick();
  assert.equal(state.shutdowns.length, 1);
  assert.equal(state.shutdowns[0].options.exitCode, 75);
});

test("input hardening: non-object bodies, prototype keys and oversized bodies are rejected", async (t) => {
  const { port, state } = await start(t, { npm_lifecycle_event: "dev" }, { online: 0 });
  const post = (body) => request(port, { method: "POST", path: "/api/apply", headers: auth, body });
  assert.equal((await post('{"changes":{"__proto__":{}},"localHash":"hash-1"}')).status, 400);
  assert.equal((await post('{"changes":{"pluginConfig":{"a":{"constructor":1}}},"localHash":"hash-1"}')).status, 400);
  assert.equal((await post('{"changes":{"world":{"prototype":1}},"localHash":"hash-1"}')).status, 400);
  assert.equal((await post("[]")).status, 400);
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post({ changes: [], localHash: "hash-1" })).status, 400);
  assert.equal((await post({ changes: { plugins: [] }, localHash: "hash-1" })).status, 400);
  assert.equal((await post({ changes: { pluginConfig: "x" }, localHash: "hash-1" })).status, 400);
  assert.equal((await post({ changes: {}, localHash: "hash-1", seconds: -5 })).status, 400);
  const big = JSON.stringify({ changes: { world: { name: "x".repeat(1024 * 1024 + 10) } }, localHash: "hash-1" });
  assert.equal((await post(big)).status, 413);
  await tick();
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.shutdowns, []);
});

test("GET / without page.html is a 404 text body; unknown routes 404", async (t) => {
  const { port } = await start(t);
  const fs = require("node:fs");
  const page = path.join(__dirname, "../plugins/tools/worldadmin/page.html");
  const res = await request(port, { path: "/", headers: auth });
  if (fs.existsSync(page)) {
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
  } else {
    assert.equal(res.status, 404);
    assert.match(res.headers["content-type"], /text\/plain/);
  }
  assert.equal((await request(port, { path: "/api/nope", headers: auth })).status, 404);
});

