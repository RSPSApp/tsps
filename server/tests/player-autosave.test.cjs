// Run after `yarn build`: node --test tests/player-autosave.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PlayerAutosave } = require("../dist/game/PlayerAutosave");
const { GameConstants } = require("../dist/game/GameConstants");
const TICK_MS = GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;

beforeEach(() => PlayerAutosave.reset());

test("the window is PLAYER_AUTOSAVE_SECONDS: unset is a minute, 0 is off, anything else clamps", () => {
  assert.equal(PlayerAutosave.intervalSeconds({}), 60);
  assert.equal(PlayerAutosave.intervalSeconds({ PLAYER_AUTOSAVE_SECONDS: "0" }), 0, "an explicit 0 disables it");
  assert.equal(PlayerAutosave.intervalSeconds({ PLAYER_AUTOSAVE_SECONDS: "300" }), 300);
  assert.equal(PlayerAutosave.intervalSeconds({ PLAYER_AUTOSAVE_SECONDS: "1" }), 15, "clamped up");
  assert.equal(PlayerAutosave.intervalSeconds({ PLAYER_AUTOSAVE_SECONDS: "99999" }), 3600, "clamped down");
  assert.equal(PlayerAutosave.intervalSeconds({ PLAYER_AUTOSAVE_SECONDS: "soon" }), 60, "garbage keeps the default");
  assert.equal(PlayerAutosave.intervalTicks({ PLAYER_AUTOSAVE_SECONDS: "60" }), Math.round(60000 / TICK_MS));
  assert.equal(PlayerAutosave.intervalTicks({ PLAYER_AUTOSAVE_SECONDS: "0" }), 0);
});

test("a tick saves once per window, and not at all when the autosave is off", () => {
  const saved = [];
  const save = (reason) => saved.push(reason);
  const interval = PlayerAutosave.intervalTicks({ PLAYER_AUTOSAVE_SECONDS: "60" });

  assert.equal(PlayerAutosave.tick(interval - 1, save, { PLAYER_AUTOSAVE_SECONDS: "60" }), false, "not yet");
  assert.equal(PlayerAutosave.tick(interval, save, { PLAYER_AUTOSAVE_SECONDS: "60" }), true, "the first window");
  assert.deepEqual(saved, ["autosave"], "with the reason the persistence layer documents");
  assert.equal(PlayerAutosave.tick(interval + 1, save, { PLAYER_AUTOSAVE_SECONDS: "60" }), false, "not twice");
  assert.equal(PlayerAutosave.tick(interval * 2, save, { PLAYER_AUTOSAVE_SECONDS: "60" }), true, "the next window");
  assert.deepEqual(saved, ["autosave", "autosave"]);

  assert.equal(PlayerAutosave.tick(interval * 3, save, { PLAYER_AUTOSAVE_SECONDS: "0" }), false, "off saves nothing");
  assert.equal(saved.length, 2);
});
