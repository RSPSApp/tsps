// Run after `yarn build`: node --test tests/player-online-timer.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { World } = require("../dist/game/World");
const { GameConstants } = require("../dist/game/GameConstants");
const PlayerOnlineTimer = require("../plugins/world/PlayerOnlineTimer.plugin");

const { LIFETIME_SECONDS_ATTRIBUTE, ONLINE_SECONDS_EVENT, LIFETIME_SECONDS_EVENT } =
  PlayerOnlineTimer._test;
const LOGIN_MS = 10_000;
const TICK_MS = GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;
const FOLD_TICKS = PlayerOnlineTimer._test.FOLD_INTERVAL_MS / TICK_MS;

PlayerOnlineTimer.register(PluginManager.createApi("PlayerOnlineTimerTest"));

function player(name) {
  const attributes = new Map();
  return {
    getUsername: () => name,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
}

function ask(event, target) {
  const request = { player: target, seconds: null };
  PluginManager.emitCustomEvent(event, request);
  return request.seconds;
}

/**
 * The plugin reads Date.now when asked, so a scenario freezes one clock; login, logout, startup and
 * the fold beat all go through the real hook and task dispatch rather than the plugin's own functions.
 */
function clock(t) {
  let now = LOGIN_MS;
  t.mock.method(Date, "now", () => now);
  return {
    elapsed: (ms) => {
      now = LOGIN_MS + ms;
    },
    login: (target) => {
      PluginManager.emitPlayerLogin({ player: target, username: target.getUsername() });
    },
    logout: (target) => {
      PluginManager.emitPlayerLogout({ player: target, username: target.getUsername() });
    },
    online: (target) => ask(ONLINE_SECONDS_EVENT, target),
    lifetime: (target) => ask(LIFETIME_SECONDS_EVENT, target),
    /** Runs the engine's own task loop for `ticks` cycles, so the beat fires as it would live. */
    tick: (ticks) => {
      for (let index = 0; index < ticks; index++) {
        now += TICK_MS;
        TaskManager.process();
      }
    },
  };
}

test("the session clock starts on login and reports whole seconds", (t) => {
  const timer = clock(t);
  const zik = player("Zik");
  timer.login(zik);
  assert.equal(timer.online(zik), 0, "the tick they logged in is zero seconds");

  timer.elapsed(45_000);
  assert.equal(timer.online(zik), 45);
  timer.elapsed(45_999);
  assert.equal(timer.online(zik), 45, "a part second is not counted");
  timer.elapsed(60 * 60_000);
  assert.equal(timer.online(zik), 3_600, "keeps counting past a minute and an hour");
});

test("every player has their own session clock, restarted only by their own re-login", (t) => {
  const timer = clock(t);
  const zik = player("Zik");
  const bob = player("Bob");
  timer.login(zik);
  timer.elapsed(29_000);
  timer.login(bob);

  timer.elapsed(31_000);
  assert.equal(timer.online(zik), 31);
  assert.equal(timer.online(bob), 2);

  timer.elapsed(42_000);
  timer.login(zik);
  assert.equal(timer.online(zik), 0, "a re-login starts the session over");
  assert.equal(timer.online(bob), 13, "and leaves everyone else alone");
});

test("a logout banks the session into the lifetime total, which the next session continues", (t) => {
  const timer = clock(t);
  const zik = player("Zik");
  timer.login(zik);
  timer.elapsed(90_000);
  assert.equal(timer.lifetime(zik), 90, "the open session already counts toward the total");

  timer.logout(zik);
  assert.equal(zik.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 90);
  assert.equal(timer.online(zik), 0, "the session ended with the logout");
  assert.equal(timer.lifetime(zik), 90);

  timer.elapsed(100_000);
  timer.login(zik);
  timer.elapsed(110_000);
  assert.equal(timer.online(zik), 10, "the offline gap is not counted");
  assert.equal(timer.lifetime(zik), 100, "the saved total keeps accruing across sessions");

  timer.logout(zik);
  assert.equal(zik.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 100, "banked again, not doubled");
});

test("banking twice for one session does not count it twice", (t) => {
  const timer = clock(t);
  const zik = player("Zik");
  timer.login(zik);
  timer.elapsed(30_000);
  timer.logout(zik);
  timer.logout(zik);
  assert.equal(zik.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 30, "a repeat logout is a no-op");
});

test("the startup task folds the open session once a minute, without changing any answer", (t) => {
  const timer = clock(t);
  const zik = player("Zik");
  timer.login(zik);
  t.mock.method(World, "getPlayers", () => [zik]);
  PluginManager.emitServerStartup({ timestamp: LOGIN_MS });
  t.after(() => TaskManager.cancelTasks("PlayerOnlineTimer"));

  timer.tick(FOLD_TICKS); // one minute of the real game loop
  assert.equal(timer.online(zik), 60, "the session clock is not cut short by a fold");
  assert.equal(timer.lifetime(zik), 60, "and folding neither adds nor loses time for the reader");
  assert.equal(zik.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 60, "the minute is now in the save field");

  timer.tick(FOLD_TICKS);
  assert.equal(zik.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 120, "it keeps up with the clock");
  assert.equal(timer.lifetime(zik), 120);

  timer.elapsed(145_000);
  assert.equal(timer.lifetime(zik), 145, "the part minute still owed counts between folds");
  assert.equal(timer.online(zik), 145);

  timer.logout(zik);
  assert.equal(zik.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 145, "the logout banks only the remainder");
});

test("a shutdown banks every online player before the core saves them", (t) => {
  const timer = clock(t);
  const zik = player("Zik");
  const bob = player("Bob");
  timer.login(zik);
  timer.elapsed(20_000);
  timer.login(bob);
  timer.elapsed(50_000);
  t.mock.method(World, "getPlayers", () => [zik, bob]);

  PluginManager.emitServerShutdown({ timestamp: LOGIN_MS + 50_000 });
  assert.equal(zik.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 50);
  assert.equal(bob.getAttribute(LIFETIME_SECONDS_ATTRIBUTE), 30);
  assert.equal(timer.lifetime(zik), 50, "and the session is closed, so nothing is counted twice");
});

test("a player the clock never saw has been online for 0 seconds", (t) => {
  const timer = clock(t);
  timer.elapsed(5 * 60_000);
  assert.equal(timer.online(player("Ghost")), 0);
  assert.equal(timer.lifetime(player("Ghost")), 0);
  assert.equal(timer.online(undefined), 0);
  assert.equal(timer.lifetime(undefined), 0);
});

test("the lifetime total is a registered save field", () => {
  assert.ok(
    PlayerSave.persistentAttributeKeys.has(LIFETIME_SECONDS_ATTRIBUTE),
    "persistAttribute was called, so every save carries it"
  );
  assert.equal(PlayerSave.attributeDefaults.get(LIFETIME_SECONDS_ATTRIBUTE), "0");
});
