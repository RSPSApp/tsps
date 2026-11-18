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
  const player = {
    location,
    moved: [],
    faces: [],
    animations: [],
    getLocation: () => location,
    getPrivateArea: () => null,
    isRegistered: () => true,
    getCombat: () => ({ reset() {} }),
    getMovementQueue: () => ({ reset() {} }),
    moveTo: (to) => {
      player.moved.push(to);
      player.location = to;
    },
    setPositionToFace: (at) => player.faces.push(at),
    performAnimation: (animation) => player.animations.push(animation),
  };
  return player;
}

const at = (destination) => [destination.location.getX(), destination.location.getY()];

test("the wave knocks players up to five tiles along the eight-way octant from the boss base", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => true);

  const north = pushDestination(playerAt(3045, 2867));
  assert.deepEqual(at(north), [3045, 2872], "straight north, five tiles");

  const west = pushDestination(playerAt(3040, 2849));
  assert.deepEqual(at(west), [3035, 2854], "the west side goes diagonally north-west");
});

test("the push stops at the first blocked tile", (t) => {
  let calls = 0;
  t.mock.method(RegionManager, "canMoveIsBlocked", () => ++calls <= 4);
  const pushed = pushDestination(playerAt(3037, 2849));
  assert.deepEqual(at(pushed), [3033, 2853], "the recorded four-tile north-west knock");
});

test("a player between the ammunition crates is not pushed", () => {
  assert.equal(BETWEEN_CRATES.has("3038,2849"), true);
  assert.equal(BETWEEN_CRATES.has("3056,2849"), true);
  assert.equal(betweenCrates(playerAt(3038, 2849).getLocation()), true);
  assert.equal(pushDestination(playerAt(3038, 2849)), null);
});

test("no push from the boss base", () => {
  assert.equal(pushDestination(playerAt(3043, 2845)), null);
});

test("a pushed player is teleported, knocked down and turned to the boss", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => true);
  const submitted = [];
  t.mock.method(PluginManager.getCoreApi().TaskManager, "submit", (task) => submitted.push(task));
  const player = playerAt(3040, 2849);
  assert.equal(wavePush(player), true);
  assert.equal(submitted.length, 0, "the capture shows a teleport, not a force movement");
  assert.deepEqual(player.moved.map((to) => [to.getX(), to.getY()]), [[3035, 2854]]);
  assert.equal(player.animations.at(-1).id, 7211, "human_knockdown_loop");
  assert.deepEqual(
    [player.faces.at(-1).getX(), player.faces.at(-1).getY()],
    [3043, 2845],
    "facing the boss base",
  );
});

test("a player at the edge stays put but is still knocked down", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => false);
  const player = playerAt(3045, 2872);
  assert.equal(wavePush(player), true);
  assert.equal(player.moved.length, 0);
  assert.equal(player.animations.at(-1).id, 7211);
  assert.deepEqual([player.faces.at(-1).getX(), player.faces.at(-1).getY()], [3043, 2845]);
});
