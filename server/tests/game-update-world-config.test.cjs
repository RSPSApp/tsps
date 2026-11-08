const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { World } = require("../dist/game/World");
const { GameConstants } = require("../dist/game/GameConstants");
const { PlayerPunishment } = require("../dist/util/PlayerPunishment");
const { Accounts } = require("../dist/game/entity/impl/player/Accounts");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");

function loadPlugin() {
  delete require.cache[require.resolve("../plugins/world/GameUpdate.plugin")];
  const plugin = require("../plugins/world/GameUpdate.plugin");
  const events = new Map();
  const tasks = [];
  const pushes = [];
  const shutdowns = [];
  const players = [{
    sendMessage() {},
    getPacketSender: () => ({ sendSystemUpdate: (v) => pushes.push(v) }),
  }];
  class Task {
    constructor(delay, key) { this.key = key; this.stopped = false; }
    stop() { this.stopped = true; }
  }
  const core = {
    Task,
    TaskManager: { submit: (t) => tasks.push(t), cancelTasks: () => {} },
    World: { getPlayers: () => players },
    PlayerRights: { OWNER: 5 },
    Server: {
      getLogger: () => ({ info() {} }),
      shutdown: (reason, options) => shutdowns.push({ reason, options }),
    },
  };
  plugin.register({
    core,
    registerCommand() {},
    onPlayerLogin() {},
    onServerShutdown() {},
    onCustomEvent: (name, handler) => events.set(name, handler),
  });
  const emit = (name, payload) => { events.get(name)(payload); return payload; };
  return { emit, tasks, pushes, shutdowns };
}

test("GameUpdate:start shuts down with the stored hook only once the countdown reaches zero", () => {
  const { emit, tasks, shutdowns } = loadPlugin();
  const afterPersist = () => {};
  const started = emit("GameUpdate:start", { seconds: 5, afterPersist, exitCode: 75 });
  assert.equal(started.accepted, true);
  assert.equal(emit("GameUpdate:status", {}).remainingSeconds, 5);
  const realNow = Date.now;
  try {
    tasks[0].execute();
    assert.deepEqual(shutdowns, []);
    Date.now = () => realNow() + 6000;
    tasks[0].execute();
  } finally {
    Date.now = realNow;
  }
  assert.equal(shutdowns.length, 1);
  assert.equal(shutdowns[0].reason, "gameUpdate");
  assert.equal(shutdowns[0].options.afterPersist, afterPersist);
  assert.equal(shutdowns[0].options.exitCode, 75);
  assert.equal(emit("GameUpdate:status", {}).remainingSeconds, 0);
});

test("GameUpdate:cancel stops the countdown and never runs afterPersist", () => {
  const { emit, tasks, pushes, shutdowns } = loadPlugin();
  let ran = false;
  emit("GameUpdate:start", { seconds: 60, afterPersist: () => { ran = true; } });
  const cancelled = emit("GameUpdate:cancel", {});
  assert.equal(cancelled.cancelled, true);
  assert.equal(pushes.at(-1), 0);
  assert.equal(tasks[0].stopped, true);
  assert.equal(emit("GameUpdate:cancel", {}).cancelled, false);
  assert.equal(ran, false);
  assert.deepEqual(shutdowns, []);
});

test("GameUpdate:start while scheduled or with a bad duration sets payload.error", () => {
  const { emit } = loadPlugin();
  assert.ok(emit("GameUpdate:start", { seconds: 0 }).error);
  assert.ok(emit("GameUpdate:start", { seconds: 1.5 }).error);
  assert.ok(emit("GameUpdate:start", { seconds: 24 * 60 * 60 + 1 }).error);
  assert.equal(emit("GameUpdate:start", { seconds: 30 }).accepted, true);
  const second = emit("GameUpdate:start", { seconds: 30 });
  assert.ok(second.error);
  assert.equal(second.accepted, undefined);
});

function stubShutdownDependencies({ failed }) {
  const saved = [];
  const restore = [];
  const stub = (obj, key, value) => { const old = obj[key]; obj[key] = value; restore.push(() => { obj[key] = old; }); };
  stub(World, "getPlayers", () => ({ sizeReturn: () => 0 }));
  stub(World, "savePlayers", () => ({ failed }));
  stub(Accounts, "flush", () => {});
  stub(PlayerPunishment, "flush", async () => {});
  stub(GameConstants, "PLAYER_PERSISTENCE", { flush: async () => {} });
  stub(PluginManager, "emitServerShutdown", () => {});
  stub(PluginManager, "removeUnownedPluginNpcs", () => 0);
  stub(ObjectManager, "removePluginObjects", () => 0);
  const exits = [];
  stub(process, "exit", (code) => { exits.push(code); });
  const origError = console.error;
  const origInfo = console.info;
  console.error = () => {};
  console.info = () => {};
  restore.push(() => { console.error = origError; console.info = origInfo; });
  return { exits, saved, restore: () => restore.reverse().forEach((r) => r()) };
}

test("Server.shutdown with a persistence failure never calls afterPersist and keeps running", async () => {
  const ctx = stubShutdownDependencies({ failed: 1 });
  try {
    let calls = 0;
    Server.shutdown("test", { afterPersist: () => { calls++; }, exitCode: 75 });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 0);
    assert.deepEqual(ctx.exits, []);
    assert.equal(Server.shuttingDown, false);
  } finally { ctx.restore(); }
});

test("Server.shutdown runs afterPersist once before exiting with exitCode; a throwing hook cancels", async () => {
  const ctx = stubShutdownDependencies({ failed: 0 });
  try {
    const order = [];
    Server.shutdown("test", { afterPersist: () => order.push("hook"), exitCode: 75 });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, ["hook"]);
    assert.deepEqual(ctx.exits, [75]);
    Server.shuttingDown = false;

    Server.shutdown("test", { afterPersist: () => { throw new Error("boom"); }, exitCode: 75 });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(ctx.exits, [75]);
    assert.equal(Server.shuttingDown, false);

    Server.shutdown("test");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(ctx.exits, [75, 0]);
  } finally { Server.shuttingDown = false; ctx.restore(); }
});
