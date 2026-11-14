const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const { test } = require("node:test");
const AdmZip = require("adm-zip");

const PLUGIN = path.join(__dirname, "../plugins/tools/WorldAdmin.plugin.js");
const ENV_KEYS = [
  "WORLD_ADMIN_PORT", "WORLD_ADMIN_TOKEN", "WORLD_ADMIN_BIND", "WORLD_ADMIN_TLS_CERT", "WORLD_ADMIN_TLS_KEY", "TSPS_WORLD_ADMIN_SOCKET", "BROWSER_HOST",
  "TSPS_SUPERVISED", "npm_lifecycle_event", "TSPS_RESTARTER", "WT_SLOT", "PORT",
];
const TOKEN = "test-token-abcdefghijklmnop";

function freshPlugin(pluginFile = PLUGIN) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}tools${path.sep}worldadmin${path.sep}`) || key === pluginFile) {
      delete require.cache[key];
    }
  }
  return require(pluginFile);
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
      worldSettingKeys: () => ["name", "experienceMultiplier"],
      read: () => state.layers,
      plan: () => state.plan,
      write: (dir, nextLocal, expectedHash) => {
        if (expectedHash !== state.layers.localHash) {
          throw new Error("world.local.json changed since loaded; reload the page and try again");
        }
        state.writes.push({ dir, nextLocal, expectedHash });
      },
    },
    WorldConfigCatalog: {
      build: () => ({ plugins: [], options: [], world: [], membersWorld: true }),
      invalidate: () => {},
    },
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

  const plugin = freshPlugin(opts.pluginFile);
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
  // The log never carries the token: it is WORLD_ADMIN_TOKEN or sits in the token file.
  const link = capture.logs.join("\n").match(/world config page: https?:\/\/localhost:(\d+)\//);
  if (link) port = Number(link[1]);
  let token = process.env.WORLD_ADMIN_TOKEN;
  if (link && !token) {
    try {
      token = fs.readFileSync(path.join(opts.cwd ?? savedCwd, "data", "definitions", "world-admin.token"), "utf8").trim();
    } catch {
      token = undefined;
    }
  }
  t.after(async () => {
    await plugin._test.stop();
    capture.restore();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });
  return { plugin, state, hooks, logs: capture.logs, port, token };
}

/** `ca`: the test certificate, to make the request over https. */
function request(port, { method = "GET", path: urlPath = "/", headers = {}, body, ca } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined || typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const req = (ca ? https : http).request({
      host: "127.0.0.1", port, method, path: urlPath, agent: false, ...(ca ? { ca, servername: "localhost" } : {}),
      headers: {
        Host: `localhost:${port}`,
        ...(data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString("utf8");
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, bytes, text, json });
      });
    });
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/** POST /api/apply declaring a body over the cap but sending only a few bytes; resolves on the response. */
function oversizedPost(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, method: "POST", path: "/api/apply", agent: false,
      headers: {
        Host: `localhost:${port}`, Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json", "Content-Length": 1024 * 1024 + 1,
      },
    }, (res) => {
      res.resume();
      res.on("end", () => { req.destroy(); resolve({ status: res.statusCode, headers: res.headers }); });
    });
    req.on("error", reject);
    req.write("{}");
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
  // IPv6 loopback (WORLD_ADMIN_BIND=::1 stays in loopback mode) is accepted; another port is not.
  assert.equal((await request(port, { path: "/api/catalog", headers: { ...auth, Host: `[::1]:${port}` } })).status, 200);
  assert.equal((await request(port, { path: "/api/catalog", headers: { ...auth, Host: `[::1]:${port + 1}` } })).status, 403);

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
  // Over http a Secure cookie would never be sent back.
  assert.doesNotMatch(cookie, /Secure/);
  const pair = cookie.split(";")[0];
  assert.equal((await request(port, { path: "/api/catalog", headers: { Cookie: pair } })).status, 200);
  // Another worktree's cookie (same host, other port) is not this listener's.
  const otherPort = `wa_token_${port + 1}=${encodeURIComponent(TOKEN)}`;
  assert.equal((await request(port, { path: "/api/catalog", headers: { Cookie: otherPort } })).status, 401);
  assert.equal((await request(port, { path: "/api/catalog", headers: { Cookie: `wa_token=${TOKEN}` } })).status, 401);
});

test("the panel links to the map and cache editors on this worktree's client port", async (t) => {
  const { port } = await start(t, { PORT: "3103" });
  const catalog = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(catalog.status, 200);
  assert.equal(catalog.json.mapEditorUrl, "http://localhost:3103/?edit=1");
  assert.equal(catalog.json.cacheEditorUrl, "http://localhost:3103/?cache=1");

  const page = await request(port, { path: "/", headers: auth });
  assert.equal(page.status, 200);
  assert.match(page.text, /id="map-editor-link" class="tool-link"/);
  assert.match(page.text, /id="cache-editor-link" class="tool-link"/);
  assert.match(page.text, /<nav class="tool-group" aria-label="Tools">/);
  assert.match(page.text, /<div class="tool-group-label">Tools<\/div>/);
  assert.match(page.text, /\.tool-link:hover \{ background: #2a2c30; color: #fff; \}/);
  assert.match(page.text, /function updateToolLink\(id, href, flag\)/);
});

test("the panel serves its bundled assets with authentication", async (t) => {
  const { port } = await start(t);
  for (const [file, type] of [
    ["panel.js", "application/javascript"],
    ["panel.css", "text/css"],
    ["skill-icons.json", "application/json"],
    ...[400, 500, 600].map(weight => [`fonts/plex-sans-${weight}.woff2`, "font/woff2"]),
  ]) {
    const asset = `/panel/${file}`;
    assert.equal((await request(port, { path: asset })).status, 401);
    const result = await request(port, { path: asset, headers: auth });
    assert.equal(result.status, 200);
    assert.ok(result.headers["content-type"].startsWith(type));
    assert.ok(result.bytes.length > 0);
  }
  assert.equal((await request(port, { path: "/plugins", headers: auth })).status, 404);
  assert.equal((await request(port, { path: "/panel/Access.WorldAdmin.js", headers: auth })).status, 404);
});

test("plugin ZIPs can be deleted and re-imported, with access and package checks", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "world-admin-plugins-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tools = path.join(directory, "plugins", "tools");
  fs.mkdirSync(tools, { recursive: true });
  const pluginFile = path.join(tools, path.basename(PLUGIN));
  fs.copyFileSync(PLUGIN, pluginFile);
  fs.symlinkSync(path.join(path.dirname(PLUGIN), "worldadmin"), path.join(tools, "worldadmin"), "dir");
  const { port } = await start(t, {}, { pluginFile });
  const upload = (body, headers = {}) => request(port, {
    method: "POST", path: "/api/plugins/import", headers: { "Content-Type": "application/zip", ...headers }, body,
  });
  const manifest = { format: 1, id: "welcome", name: "Welcome", version: "1.0.0", description: "Greets players" };
  const makeZip = (source, filename = "Welcome.plugin.js") => {
    const zip = new AdmZip();
    zip.addFile("plugin.json", Buffer.from(JSON.stringify(manifest)));
    zip.addFile(filename, Buffer.from(source));
    return zip.toBuffer();
  };
  const source = 'throw new Error("Must never execute during upload");';
  const zip = makeZip(source);
  assert.equal((await upload(zip)).status, 401);
  assert.equal((await upload(zip, { ...auth, Origin: "http://elsewhere.test" })).status, 403);
  assert.equal((await upload(zip, { ...auth, "Content-Type": "text/plain" })).status, 415);
  assert.equal((await upload(makeZip(source, "nested/Welcome.plugin.js"), auth)).status, 400);
  assert.equal((await upload(makeZip("!"), auth)).status, 400);
  assert.equal((await upload(Buffer.alloc(0), { ...auth, "Content-Length": 1024 * 1024 + 1 })).status, 413);
  const response = await upload(zip, auth);
  assert.equal(response.status, 201);
  assert.deepEqual(response.json, { name: "Welcome", version: "1.0.0" });
  assert.equal((await upload(makeZip("module.exports = {}"), auth)).status, 409);
  const installed = path.join(directory, "plugins", "imported", "welcome");
  assert.equal(fs.readFileSync(path.join(installed, "Welcome.plugin.js"), "utf8"), source);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(installed, "plugin.json"), "utf8")), manifest);

  const remove = (packageId, headers) => request(port, {
    method: "POST", path: "/api/plugins/delete", headers, body: { packageId },
  });
  assert.equal((await remove("welcome")).status, 401);
  assert.equal((await remove("welcome", { ...auth, Origin: "http://elsewhere.test" })).status, 403);
  assert.equal((await remove("../tools", auth)).status, 400);
  fs.symlinkSync(tools, path.join(path.dirname(installed), "linked"), "junction");
  assert.equal((await remove("linked", auth)).status, 404);
  assert.equal((await remove("tools", auth)).status, 404);
  assert.ok(fs.existsSync(pluginFile));
  assert.equal((await remove("welcome", auth)).status, 200);
  assert.equal(fs.existsSync(installed), false);
  assert.equal((await remove("welcome", auth)).status, 404);
  assert.equal((await upload(makeZip("module.exports = { register() {} };"), auth)).status, 201);

  const reinstalledEntry = require.resolve(path.join(installed, "Welcome.plugin.js"));
  require(reinstalledEntry);
  assert.ok(require.cache[reinstalledEntry]);
  fs.writeFileSync(path.join(installed, "extra.txt"), "Created by the plugin");
  assert.equal((await remove("welcome", auth)).status, 200);
  assert.equal(fs.existsSync(installed), false);
  assert.equal(require.cache[reinstalledEntry], undefined);
  assert.equal((await upload(zip, auth)).status, 201);
  assert.equal((await remove("welcome", auth)).status, 200);

  const install = (packageId, version, headers) => request(port, {
    method: "POST", path: "/api/plugins/install", headers, body: { packageId, version },
  });
  const releases = "https://github.com/RSPSApp/tsps-plugins/releases/download/";
  const asset = "https://release-assets.githubusercontent.com/welcome.zip";
  const downloads = [];
  let redirect = asset;
  let assetBody = zip;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    downloads.push(String(url));
    assert.equal(options.redirect, "manual");
    if (String(url).startsWith(releases)) return new Response(null, { status: 302, headers: { Location: redirect } });
    assert.equal(String(url), asset);
    return new Response(assetBody);
  });
  assert.equal((await install("welcome", "1.0.0")).status, 401);
  assert.equal((await install("welcome", "1.0.0", { ...auth, Origin: "http://elsewhere.test" })).status, 403);
  assert.equal((await install("../welcome", "1.0.0", auth)).status, 400);
  assert.deepEqual(downloads, []);
  assert.equal((await install("welcome", "1.0.0", auth)).status, 201);
  assert.deepEqual(downloads, [releases + "welcome-v1.0.0/welcome-1.0.0.zip", asset]);
  assert.equal(fs.readFileSync(path.join(installed, "Welcome.plugin.js"), "utf8"), source);
  assert.equal((await install("welcome", "1.0.0", auth)).status, 409);
  assert.equal((await remove("welcome", auth)).status, 200);
  assert.equal((await install("welcome", "2.0.0", auth)).status, 502);
  assetBody = Buffer.alloc(1024 * 1024 + 1);
  assert.equal((await install("welcome", "1.0.0", auth)).status, 502);
  redirect = "https://elsewhere.test/welcome.zip";
  assert.equal((await install("welcome", "1.0.0", auth)).status, 502);
  assert.equal(downloads.at(-1), releases + "welcome-v1.0.0/welcome-1.0.0.zip");
  assert.equal(fs.existsSync(installed), false);
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

test("the Players panel reads saved characters and keeps login credentials private", async (t) => {
  const { DatabaseSync } = require("node:sqlite");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "world-admin-players-"));
  const database = path.join(directory, "players.sqlite");
  const original = process.env.PLAYER_SAVE_DATABASE_PATH;
  t.after(() => {
    if (original === undefined) delete process.env.PLAYER_SAVE_DATABASE_PATH;
    else process.env.PLAYER_SAVE_DATABASE_PATH = original;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const db = new DatabaseSync(database);
  db.exec("CREATE TABLE player_saves (username TEXT PRIMARY KEY, save_json TEXT)");
  const insert = db.prepare("INSERT INTO player_saves VALUES (?, ?)");
  insert.run("test_player", JSON.stringify({
    username: "Test Player", rights: { id: 1 }, skills: { maxLevel: [1, 1, 1, 10, 1, 1, 1] },
    passwordHashWithSalt: "private-hash", attributes: { "login-tokens": ["private-token"] },
  }));
  insert.run("league:test_player", "{}");
  db.close();
  const { port } = await start(t);
  process.env.PLAYER_SAVE_DATABASE_PATH = database;
  assert.equal((await request(port, { path: "/api/players" })).status, 401);
  const list = await request(port, { path: "/api/players", headers: auth });
  assert.deepEqual(list.json.players, [
    { username: "Test Player", id: "test player", online: false, rights: 1, banned: false, muted: false, combat: 3, total: 16 },
  ]);
  const details = await request(port, { path: "/api/players/save?name=test%20player", headers: auth });
  assert.equal(details.status, 200);
  assert.equal(details.json.save.skills.maxLevel[3], 10);
  assert.doesNotMatch(details.text, /private-hash|private-token/);
  assert.equal((await request(port, { path: "/api/players/save?name=..", headers: auth })).status, 400);
});

test("restart mode: nodemon.json's TSPS_RESTARTER=nodemon means dev, with or without npm_lifecycle_event", async (t) => {
  const nodemonConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../nodemon.json"), "utf8"));
  assert.equal(nodemonConfig.env?.TSPS_RESTARTER, "nodemon");

  const viaNodemon = await start(t, { TSPS_RESTARTER: "nodemon" });
  assert.equal((await request(viaNodemon.port, { path: "/api/catalog", headers: auth })).json.mode, "dev");
  await viaNodemon.plugin._test.stop();

  const plain = await start(t, {});
  assert.equal((await request(plain.port, { path: "/api/catalog", headers: auth })).json.mode, "manual");
  await plain.plugin._test.stop();

  const supervised = await start(t, { TSPS_RESTARTER: "nodemon", TSPS_SUPERVISED: "1" });
  assert.equal((await request(supervised.port, { path: "/api/catalog", headers: auth })).json.mode, "supervised");
});

test("port: WORLD_ADMIN_PORT, else 49600 + WT_SLOT for worktrees slotted before the port existed, else 49600", () => {
  const { resolveAccess } = require("../plugins/tools/worldadmin/Access.WorldAdmin");
  const env = { WORLD_ADMIN_TOKEN: TOKEN };
  assert.equal(resolveAccess({ ...env }).port, 49600);
  assert.equal(resolveAccess({ ...env, WT_SLOT: "3" }).port, 49603);
  assert.equal(resolveAccess({ ...env, WT_SLOT: "3", WORLD_ADMIN_PORT: "49650" }).port, 49650);
  assert.equal(resolveAccess({ ...env, WT_SLOT: "0" }).port, 49600);
  assert.equal(resolveAccess({ ...env, WT_SLOT: "abc" }).port, 49600);
  assert.equal(resolveAccess({ ...env, WT_SLOT: "" }).port, 49600);
});

test("an empty or garbage token file is replaced by a fresh valid token", (t) => {
  const { resolveAccess } = require("../plugins/tools/worldadmin/Access.WorldAdmin");
  const { tokenFile } = tempServerDir(t);
  for (const contents of ["", "garbage!! not a token\n", "short\n"]) {
    fs.writeFileSync(tokenFile, contents);
    const access = resolveAccess({}, { tokenFile });
    assert.match(access.token, /^[A-Za-z0-9_-]{24,}$/);
    assert.equal(fs.readFileSync(tokenFile, "utf8"), access.token + "\n");
    assert.deepEqual(access.notes, []);
    // And it is reused from then on.
    assert.equal(resolveAccess({}, { tokenFile }).token, access.token);
  }
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
  // The token is never logged; the line names the token file relative to the server dir.
  assert.equal(text.includes(token), false);
  assert.match(text, /world config page: http:\/\/localhost:\d+\/\?token=<token from data\/definitions\/world-admin\.token>/);
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
  assert.match(second.logs.join(" "), /world config page: http:\/\/localhost:\d+\/\?token=<token from data\/definitions\/world-admin\.token>/);
  assert.equal(second.logs.join(" ").includes(first.token), false);
  assert.equal((await request(second.port, { path: "/api/catalog", headers: { Authorization: `Bearer ${first.token}` } })).status, 200);
});

test("WORLD_ADMIN_TOKEN wins over the token file, which is left alone", async (t) => {
  const { dir, tokenFile } = tempServerDir(t);
  const fileToken = "file-token-0123456789abcdefghij";
  fs.writeFileSync(tokenFile, fileToken + "\n");
  const { port, token, logs } = await start(t, {}, { cwd: dir });
  assert.equal(token, TOKEN);
  assert.equal(logs.join("\n").includes(TOKEN), false, "WORLD_ADMIN_TOKEN is not logged");
  assert.match(logs.join("\n"), /world config page: http:\/\/localhost:\d+\/\?token=<WORLD_ADMIN_TOKEN> \(the configured WORLD_ADMIN_TOKEN\)/);
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
  // A declared Content-Length above the 1 MB cap with a small body: the server answers 413 from
  // the header alone. Sending the full 1 MB raced the early 413 + Connection: close (EPIPE).
  assert.equal((await oversizedPost(port)).status, 413);
  assert.equal((await post({ changes: { world: { zones: [] } }, localHash: "hash-1" })).status, 400, "zones is not a world setting");
  assert.equal((await post({ changes: { world: { plugins: {} } }, localHash: "hash-1" })).status, 400);
  const preview = await request(port, {
    method: "POST", path: "/api/preview", headers: auth, body: { changes: { world: { someUnknown: 1 } }, localHash: "hash-1" },
  });
  assert.equal(preview.status, 400);
  assert.match(preview.json.error, /changes\.world\.someUnknown is not a world setting/);
  await tick();
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.shutdowns, []);
});

test("GET / without page.html is a 404 text body; unknown routes 404", async (t) => {
  const { port } = await start(t);
  const fs = require("node:fs");
  const page = path.join(__dirname, "../plugins/tools/worldadmin/panel/page.html");
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


test("a hand edit during the countdown is caught by beforeShutdown: cancelled before shutdown starts, lastFailure set", async (t) => {
  const { port, state } = await start(t, { npm_lifecycle_event: "dev" }, { online: 1 });
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 202);
  const start0 = state.events.find((e) => e.name === "GameUpdate:start");
  assert.equal(typeof start0.payload.beforeShutdown, "function");
  // Unchanged file: the check passes.
  start0.payload.beforeShutdown();

  state.layers = { ...state.layers, localHash: "hand-edited" };
  Object.assign(state, { remaining: 0, scheduled: false, scheduleId: undefined, shuttingDown: true });
  const capture = captureLogs();
  try {
    assert.throws(() => start0.payload.beforeShutdown(), /changed since loaded/);
    start0.payload.onCancelled("world.local.json changed since loaded; reload the page and try again");
  } finally {
    capture.restore();
  }
  state.shuttingDown = false;
  assert.match(capture.logs.join("\n"), /not written, restart cancelled/);
  assert.deepEqual(state.writes, []);
  const cat = await request(port, { path: "/api/catalog", headers: auth });
  assert.equal(cat.json.pending, null);
  assert.match(cat.json.lastFailure.message, /^Restart cancelled: world\.local\.json changed since loaded.*Nothing was written\.$/);

  // A file that stopped parsing is refused the same way.
  assert.equal((await apply(port, { changes: {}, localHash: "hand-edited" })).status, 202);
  const start1 = state.events.filter((e) => e.name === "GameUpdate:start").at(-1);
  state.layers = { ...state.layers, localError: "Unexpected token" };
  const capture2 = captureLogs();
  try {
    assert.throws(() => start1.payload.beforeShutdown(), /does not parse/);
  } finally {
    capture2.restore();
  }
});

test("an immediate restart carries beforeShutdown too", async (t) => {
  const { port, state } = await start(t, { npm_lifecycle_event: "dev" }, { online: 0 });
  assert.equal((await apply(port, { changes: {}, localHash: "hash-1" })).status, 202);
  await tick();
  assert.equal(typeof state.shutdowns[0].options.beforeShutdown, "function");
});

test("WORLD_ADMIN_BIND beyond loopback needs a WORLD_ADMIN_TOKEN of 24+ token characters", async (t) => {
  const { resolveAccess } = require("../plugins/tools/worldadmin/Access.WorldAdmin");
  const weak = resolveAccess({ WORLD_ADMIN_BIND: "0.0.0.0", WORLD_ADMIN_TOKEN: "short" });
  assert.equal(weak.host, "127.0.0.1");
  assert.equal(weak.loopback, true);
  assert.match(weak.notes.join("\n"), /WORLD_ADMIN_BIND ignored: WORLD_ADMIN_TOKEN must be at least 24 characters/);
  const badChars = resolveAccess({ WORLD_ADMIN_BIND: "0.0.0.0", WORLD_ADMIN_TOKEN: "has spaces in it but is long enough" });
  assert.equal(badChars.host, "127.0.0.1");
  const strong = resolveAccess({ WORLD_ADMIN_BIND: "0.0.0.0", WORLD_ADMIN_TOKEN: TOKEN });
  assert.equal(strong.host, "0.0.0.0");
  assert.equal(strong.loopback, false);
  assert.deepEqual(strong.notes, []);
  // A loopback bind keeps working with any configured token.
  assert.equal(resolveAccess({ WORLD_ADMIN_BIND: "localhost", WORLD_ADMIN_TOKEN: "short" }).host, "localhost");
  // ::1 stays in loopback mode, and its own Host header is let through.
  const { hostAllowed } = require("../plugins/tools/worldadmin/Access.WorldAdmin");
  const v6 = resolveAccess({ WORLD_ADMIN_BIND: "::1", WORLD_ADMIN_TOKEN: "short" });
  assert.equal(v6.loopback, true);
  assert.equal(hostAllowed({ headers: { host: "[::1]:49600" } }, 49600, v6.loopback), true);
  assert.equal(hostAllowed({ headers: { host: "[::2]:49600" } }, 49600, v6.loopback), false);
  assert.equal(strong.tokenSource, "env");
  assert.equal(resolveAccess({}, {}).tokenSource, "memory");

  const { logs } = await start(t, { WORLD_ADMIN_BIND: "0.0.0.0", WORLD_ADMIN_TOKEN: "short" });
  const text = logs.join("\n");
  assert.match(text, /WORLD_ADMIN_BIND ignored/);
  assert.match(text, /listening on 127\.0\.0\.1:/);
});

test("every pluginPanel method page.html calls is one the bundle's createPluginPanel returns", () => {
  const dir = path.join(__dirname, "../plugins/tools/worldadmin/panel");
  const page = fs.readFileSync(path.join(dir, "page.html"), "utf8");
  const bundle = fs.readFileSync(path.join(dir, "panel.js"), "utf8");
  const called = [...new Set([...page.matchAll(/pluginPanel\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))];
  assert.ok(called.length > 0, "page.html drives the plugin panel");
  // A minified method is `name(){` or `name:` in the returned object.
  const missing = called.filter((name) => !new RegExp("[,{]" + name + "(\\(|:)").test(bundle));
  assert.deepEqual(missing, [], "a missing method throws in enterReconnect before the reconnect overlay starts (#4501)");
});

// Throwaway self-signed certificates for localhost and 127.0.0.1 (see fixtures/world-admin-tls).
const TLS_FIXTURES = path.join(__dirname, "fixtures", "world-admin-tls");
const tlsFixture = (name) => path.join(TLS_FIXTURES, name);
const fingerprint = (file) => new crypto.X509Certificate(fs.readFileSync(file)).fingerprint256;

/** The fingerprint of the certificate the listener on `port` presents now. */
function servedFingerprint(port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", rejectUnauthorized: false }, () => {
      const served = socket.getPeerCertificate().fingerprint256;
      socket.end();
      resolve(served);
    });
    socket.on("error", reject);
  });
}

test("WORLD_ADMIN_TLS_CERT and _KEY serve the page over https, with a Secure cookie and its https origin", async (t) => {
  const ca = fs.readFileSync(tlsFixture("cert-a.pem"));
  const { port, logs } = await start(t, {
    WORLD_ADMIN_TLS_CERT: tlsFixture("cert-a.pem"), WORLD_ADMIN_TLS_KEY: tlsFixture("key-a.pem"),
  });
  assert.ok(port, "startup prints the https link");
  const text = logs.join("\n");
  assert.match(text, /listening on 127\.0\.0\.1:\d+ \(https\)/);
  assert.match(text, /world config page: https:\/\/localhost:\d+\/\?token=<WORLD_ADMIN_TOKEN>/);

  const login = await request(port, { path: `/?token=${TOKEN}`, ca });
  assert.equal(login.status, 302);
  const cookie = login.headers["set-cookie"][0];
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/; Secure$/);
  assert.equal((await request(port, { path: "/api/catalog", ca, headers: { Cookie: cookie.split(";")[0] } })).status, 200);

  const preview = (origin) => request(port, {
    method: "POST", path: "/api/preview", ca, headers: { ...auth, Origin: origin }, body: { changes: {}, localHash: "hash-1" },
  });
  assert.equal((await preview(`https://localhost:${port}`)).status, 200);
  // The http origin of the same host is another origin once the page is on https.
  assert.equal((await preview(`http://localhost:${port}`)).status, 403);
  // Plain http gets no answer from the https listener.
  await assert.rejects(request(port, { path: "/api/catalog", headers: auth }));
});

test("TLS settings that can't be used keep the page closed and say why, rather than serving http", async (t) => {
  const { createPageServer } = require("../plugins/tools/worldadmin/Tls.WorldAdmin");
  const handler = () => {};
  const error = (files) => createPageServer(files, handler).error ?? "";
  assert.match(error({ certFile: tlsFixture("cert-a.pem"), keyFile: "" }), /WORLD_ADMIN_TLS_CERT and WORLD_ADMIN_TLS_KEY must both be set/);
  assert.match(error({ certFile: "", keyFile: tlsFixture("key-a.pem") }), /must both be set/);
  assert.match(error({ certFile: tlsFixture("missing.pem"), keyFile: tlsFixture("key-a.pem") }), /could not read WORLD_ADMIN_TLS_CERT .*missing\.pem/);
  assert.match(error({ certFile: tlsFixture("cert-a.pem"), keyFile: tlsFixture("key-b.pem") }), /can't be used together/);
  assert.equal(createPageServer({ certFile: tlsFixture("cert-a.pem"), keyFile: tlsFixture("key-a.pem") }, handler).secure, true);
  assert.equal(createPageServer(null, handler).secure, false);

  const { port, logs } = await start(t, { WORLD_ADMIN_TLS_CERT: tlsFixture("cert-a.pem") });
  assert.equal(port, null);
  const text = logs.join("\n");
  assert.match(text, /\[world-admin\] not listening: WORLD_ADMIN_TLS_CERT and WORLD_ADMIN_TLS_KEY must both be set/);
  assert.doesNotMatch(text, /listening on/);
});

test("a renewed certificate is served without a restart; one that can't be used keeps the current", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-admin-tls-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const certFile = path.join(dir, "fullchain.pem");
  const keyFile = path.join(dir, "privkey.pem");
  const install = (name) => {
    fs.copyFileSync(tlsFixture(`cert-${name}.pem`), certFile);
    fs.copyFileSync(tlsFixture(`key-${name}.pem`), keyFile);
  };
  install("a");
  const { port, plugin, logs } = await start(t, { WORLD_ADMIN_TLS_CERT: certFile, WORLD_ADMIN_TLS_KEY: keyFile });
  assert.equal(await servedFingerprint(port), fingerprint(tlsFixture("cert-a.pem")));

  install("b");
  assert.equal(plugin._test.reloadCertificate(), true);
  assert.equal(await servedFingerprint(port), fingerprint(tlsFixture("cert-b.pem")));

  fs.writeFileSync(certFile, "not a certificate");
  assert.equal(plugin._test.reloadCertificate(), false);
  assert.equal(await servedFingerprint(port), fingerprint(tlsFixture("cert-b.pem")));
  assert.match(logs.join("\n"), /keeping the current TLS certificate/);
});

test("the certificate watch reloads when certbot replaces the files", async (t) => {
  const { createPageServer, watchCertificate } = require("../plugins/tools/worldadmin/Tls.WorldAdmin");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-admin-tls-"));
  const files = { certFile: path.join(dir, "fullchain.pem"), keyFile: path.join(dir, "privkey.pem") };
  fs.copyFileSync(tlsFixture("cert-a.pem"), files.certFile);
  fs.copyFileSync(tlsFixture("key-a.pem"), files.keyFile);
  const { server } = createPageServer(files, (request, response) => response.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const capture = captureLogs();
  const stop = watchCertificate(server, files, 20);
  t.after(() => {
    stop();
    capture.restore();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { port } = server.address();

  // Certbot writes new files, so their modification times change.
  const later = new Date(Date.now() + 60_000);
  fs.copyFileSync(tlsFixture("cert-b.pem"), files.certFile);
  fs.copyFileSync(tlsFixture("key-b.pem"), files.keyFile);
  fs.utimesSync(files.certFile, later, later);
  fs.utimesSync(files.keyFile, later, later);
  const expected = fingerprint(tlsFixture("cert-b.pem"));
  for (let tries = 0; tries < 100 && (await servedFingerprint(port)) !== expected; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(await servedFingerprint(port), expected);
  assert.match(capture.logs.join("\n"), /TLS certificate reloaded/);
});

test("behind the local panel's pipe the game's page stays http, even with the TLS settings", async (t) => {
  // As local-panel.cjs makes it.
  const socket = process.platform === "win32"
    ? `\\\\.\\pipe\\tsps-world-admin-test-${process.pid}`
    : path.join(tempServerDir(t).dir, "game.sock");
  const { logs } = await start(t, {
    TSPS_WORLD_ADMIN_SOCKET: socket, WORLD_ADMIN_TLS_CERT: tlsFixture("cert-a.pem"), WORLD_ADMIN_TLS_KEY: tlsFixture("key-a.pem"),
  });
  assert.doesNotMatch(logs.join("\n"), /not listening/);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, path: "/api/catalog", headers: { Host: "localhost:0", ...auth } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 200);
});
