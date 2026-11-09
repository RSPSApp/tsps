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
  const hooks = {};
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
    registerCommand: (name, handler) => { hooks.command = handler; },
    onPlayerLogin() {},
    onServerShutdown: (handler) => { hooks.shutdown = handler; },
    onCustomEvent: (name, handler) => events.set(name, handler),
  });
  const emit = (name, payload) => { events.get(name)(payload); return payload; };
  return { emit, tasks, pushes, shutdowns, hooks, players };
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
  const steps = [];
  stub(World, "savePlayers", () => { steps.push("savePlayers"); return { failed }; });
  stub(Accounts, "flush", () => {});
  stub(PlayerPunishment, "flush", async () => {});
  stub(GameConstants, "PLAYER_PERSISTENCE", { flush: async () => {} });
  stub(PluginManager, "emitServerShutdown", () => { steps.push("emitServerShutdown"); });
  stub(PluginManager, "removeUnownedPluginNpcs", () => 0);
  stub(ObjectManager, "removePluginObjects", () => 0);
  const exits = [];
  stub(process, "exit", (code) => { exits.push(code); });
  const origError = console.error;
  const origInfo = console.info;
  console.error = () => {};
  console.info = () => {};
  restore.push(() => { console.error = origError; console.info = origInfo; });
  return { exits, saved, steps, restore: () => restore.reverse().forEach((r) => r()) };
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

test("GameUpdate:status reports scheduled and the start id until the task fires; onCancelled is forwarded", () => {
  const { emit, tasks, shutdowns } = loadPlugin();
  assert.deepEqual(emit("GameUpdate:status", {}), { remainingSeconds: 0, scheduled: false });
  const onCancelled = () => {};
  emit("GameUpdate:start", { seconds: 5, id: "page-1", onCancelled, exitCode: 0 });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000;
    // The clock passed zero but the countdown task has not ticked yet.
    const gap = emit("GameUpdate:status", {});
    assert.equal(gap.remainingSeconds, 0);
    assert.equal(gap.scheduled, true);
    assert.equal(gap.id, "page-1");
    tasks[0].execute();
  } finally {
    Date.now = realNow;
  }
  assert.equal(shutdowns[0].options.onCancelled, onCancelled);
  const after = emit("GameUpdate:status", {});
  assert.equal(after.scheduled, false);
  assert.equal(after.id, undefined);

  // A ::gameUpdate-style start without an id echoes none; cancel drops the stored hooks.
  emit("GameUpdate:start", { seconds: 30 });
  assert.equal(emit("GameUpdate:status", {}).id, undefined);
  emit("GameUpdate:cancel", {});
  emit("GameUpdate:start", { seconds: 5, id: "page-2" });
  emit("GameUpdate:cancel", {});
  emit("GameUpdate:start", { seconds: 5 });
  try {
    Date.now = () => realNow() + 6000;
    tasks.at(-1).execute();
  } finally {
    Date.now = realNow;
  }
  assert.equal(shutdowns.at(-1).options.onCancelled, undefined);
});

async function settle() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
}

test("Server.shutdown calls onCancelled once when persistence fails", async () => {
  const ctx = stubShutdownDependencies({ failed: 1 });
  try {
    const reasons = [];
    Server.shutdown("test", { onCancelled: (r) => reasons.push(r), afterPersist: () => reasons.push("hook") });
    await settle();
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /saving players failed/);
    assert.deepEqual(ctx.exits, []);
  } finally { Server.shuttingDown = false; ctx.restore(); }
});

test("Server.shutdown calls onCancelled once when afterPersist throws, and never on success", async () => {
  const ctx = stubShutdownDependencies({ failed: 0 });
  try {
    const reasons = [];
    Server.shutdown("test", { onCancelled: (r) => reasons.push(r), afterPersist: () => { throw new Error("changed since loaded"); } });
    await settle();
    assert.deepEqual(reasons, ["changed since loaded"]);
    assert.equal(Server.shuttingDown, false);

    Server.shutdown("test", { onCancelled: (r) => reasons.push(r), afterPersist: () => {}, exitCode: 75 });
    await settle();
    assert.deepEqual(reasons, ["changed since loaded"]);
    assert.deepEqual(ctx.exits, [75]);
  } finally { Server.shuttingDown = false; ctx.restore(); }
});

test("Server.shutdown calls onCancelled when another shutdown is already in progress", async () => {
  const ctx = stubShutdownDependencies({ failed: 0 });
  try {
    Server.shuttingDown = true;
    assert.equal(Server.isShuttingDown(), true);
    const reasons = [];
    let ran = false;
    Server.shutdown("test", { onCancelled: (r) => reasons.push(r), afterPersist: () => { ran = true; } });
    await settle();
    assert.deepEqual(reasons, ["a shutdown is already in progress"]);
    assert.equal(ran, false);
    assert.deepEqual(ctx.exits, []);
  } finally { Server.shuttingDown = false; ctx.restore(); }
});

test("Server.shutdown: a throwing beforeShutdown cancels before plugins are told or players saved", async () => {
  const ctx = stubShutdownDependencies({ failed: 0 });
  try {
    const reasons = [];
    let persisted = false;
    Server.shutdown("test", {
      beforeShutdown: () => { throw new Error("world.local.json changed since loaded"); },
      afterPersist: () => { persisted = true; },
      onCancelled: (r) => reasons.push(r),
      exitCode: 75,
    });
    await settle();
    assert.deepEqual(reasons, ["world.local.json changed since loaded"]);
    assert.deepEqual(ctx.steps, [], "no emitServerShutdown, no player save");
    assert.equal(persisted, false);
    assert.deepEqual(ctx.exits, []);
    assert.equal(Server.shuttingDown, false, "the server keeps running");

    Server.shutdown("test", { beforeShutdown: () => ctx.steps.push("beforeShutdown"), exitCode: 0 });
    await settle();
    assert.deepEqual(ctx.steps.slice(0, 2), ["beforeShutdown", "emitServerShutdown"]);
    assert.deepEqual(ctx.exits, [0]);
  } finally { Server.shuttingDown = false; ctx.restore(); }
});

test("GameUpdate forwards beforeShutdown to Server.shutdown at zero", () => {
  const { emit, tasks, shutdowns } = loadPlugin();
  const beforeShutdown = () => {};
  emit("GameUpdate:start", { seconds: 5, beforeShutdown });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000;
    tasks[0].execute();
  } finally {
    Date.now = realNow;
  }
  assert.equal(shutdowns[0].options.beforeShutdown, beforeShutdown);
});

test("another shutdown during the countdown calls the stored onCancelled once; our own countdown never does", () => {
  const { emit, tasks, hooks } = loadPlugin();
  const reasons = [];
  emit("GameUpdate:start", { seconds: 60, id: "page-1", onCancelled: (r) => reasons.push(r) });
  hooks.shutdown({ timestamp: Date.now() });
  assert.deepEqual(reasons, ["another shutdown started"]);
  assert.equal(emit("GameUpdate:status", {}).scheduled, false);
  hooks.shutdown({ timestamp: Date.now() });
  assert.deepEqual(reasons, ["another shutdown started"], "not called twice");

  emit("GameUpdate:start", { seconds: 5, onCancelled: (r) => reasons.push(r) });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000;
    tasks.at(-1).execute();
  } finally {
    Date.now = realNow;
  }
  // Server.shutdown emits the shutdown event for the countdown's own shutdown.
  hooks.shutdown({ timestamp: Date.now() });
  assert.deepEqual(reasons, ["another shutdown started"]);
});

test("in the countdown's last tick (remainingSeconds 0, task not fired) a new start or ::gameUpdate is refused", () => {
  const { emit, tasks, shutdowns, hooks } = loadPlugin();
  emit("GameUpdate:start", { seconds: 5, id: "page-1" });
  const messages = [];
  const player = { sendMessage: (m) => messages.push(m), getPacketSender: () => ({ sendSystemUpdate() {} }) };
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6000;
    assert.equal(emit("GameUpdate:status", {}).remainingSeconds, 0);
    const second = emit("GameUpdate:start", { seconds: 30, id: "page-2" });
    assert.match(second.error, /already scheduled/);
    assert.equal(second.accepted, undefined);
    hooks.command({ player, parts: ["gameUpdate", "30"] });
    assert.match(messages.at(-1), /already scheduled/);
    assert.equal(tasks.length, 1, "no second countdown task");
    assert.equal(emit("GameUpdate:status", {}).id, "page-1");
    tasks[0].execute();
  } finally {
    Date.now = realNow;
  }
  assert.equal(shutdowns.length, 1);
});
