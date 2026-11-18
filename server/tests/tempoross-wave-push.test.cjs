// Run after `yarn build`: node --test tests/tempoross-wave-push.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const { pushDestination, wavePush, betweenCrates, BETWEEN_CRATES } = require("../plugins/minigames/tempoross/Attacks.Tempoross");

before(async () => {
  await CachePipeline.initialize();
  Shared.bind({ core: PluginManager.getCoreApi() });
});

function playerAt(x, y, z = 0) {
  const location = new Location(x, y, z);
  return {
    getLocation: () => location,
    getPrivateArea: () => null,
    isRegistered: () => true,
    getCombat: () => ({ reset() {} }),
    getMovementQueue: () => ({ reset() {} }),
    setForceMovement() {},
  };
}

test("the wave pushes away from Tempoross, up to three tiles", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => true);
  const west = pushDestination(playerAt(3040, 2849));
  assert.deepEqual([west.location.getX(), west.location.getY()], [3037, 2849]);
  assert.equal(west.facing, 1, "faces east, back at Tempoross");

  const south = pushDestination(playerAt(3050, 2835));
  assert.deepEqual([south.location.getX(), south.location.getY()], [3050, 2832]);
  assert.equal(south.facing, 0, "faces north, back at Tempoross");
});

test("the push stops at the first blocked tile", (t) => {
  let calls = 0;
  t.mock.method(RegionManager, "canMoveIsBlocked", () => ++calls === 1);
  const pushed = pushDestination(playerAt(3040, 2849));
  assert.deepEqual([pushed.location.getX(), pushed.location.getY()], [3039, 2849]);
});

test("a player between the ammunition crates is not pushed", () => {
  assert.equal(BETWEEN_CRATES.has("3038,2849"), true);
  assert.equal(BETWEEN_CRATES.has("3056,2849"), true);
  assert.equal(betweenCrates(playerAt(3038, 2849).getLocation()), true);
  assert.equal(pushDestination(playerAt(3038, 2849)), null);
});

test("no push when the player is on the boss centre or has nowhere to go", (t) => {
  assert.equal(pushDestination(playerAt(3047, 2849)), null);
  t.mock.method(RegionManager, "canMoveIsBlocked", () => false);
  assert.equal(pushDestination(playerAt(3040, 2849)), null);
});

test("a pushed player gets a force movement instead of staying put", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => true);
  const submitted = [];
  t.mock.method(PluginManager.getCoreApi().TaskManager, "submit", (task) => submitted.push(task));
  const player = playerAt(3040, 2849);
  assert.equal(wavePush(player), true);
  assert.equal(submitted.length, 1);
  assert.equal(player.getLocation().getX(), 3040, "the task moves them, not this call");
});
