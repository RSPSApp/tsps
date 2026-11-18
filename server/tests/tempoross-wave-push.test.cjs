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
const { Cove } = require("../plugins/minigames/tempoross/Cove.Tempoross");
const { pushDestination, wavePush, betweenCrates, BETWEEN_CRATES } = require("../plugins/minigames/tempoross/Attacks.Tempoross");

let cove = null;
let nextIndex = 1;

before(async () => {
  await CachePipeline.initialize();
  Shared.bind({ core: PluginManager.getCoreApi() });
  cove = new Cove();
});

/** A player entered into a real cove, then moved to the instance copy of a template tile. */
function playerAt(templateX, templateY, z = 0) {
  let location = new Location(0, 0, 0);
  let area = null;
  const attributes = new Map();
  const player = {
    index: nextIndex++,
    moved: [],
    faces: [],
    animations: [],
    getLocation: () => location,
    getPrivateArea: () => null,
    isRegistered: () => true,
    isPlayer: () => true,
    isNpc: () => false,
    getIndex() { return this.index; },
    getAsPlayer: () => player,
    getArea: () => area,
    setArea: (next) => { area = next; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit() {} }),
    getCombat: () => ({ reset() {} }),
    getMovementQueue: () => ({ reset() {} }),
    getInventory: () => ({ contains: () => false, getAmount: () => 0, delete() {}, refreshItems() {} }),
    moveTo: (to) => {
      player.moved.push(to);
      location = to;
    },
    setLocation: (to) => { location = to; },
    setPositionToFace: (at) => player.faces.push(at),
    performAnimation: (animation) => player.animations.push(animation),
  };
  cove.arrive(player, 0);
  player.moveTo(cove.tile([templateX, templateY, z]));
  player.moved = [];
  return player;
}

const templateAt = (destination) => cove.templateTile(destination.location).slice(0, 2);

test("the wave knocks players up to five tiles, in the recordings' octants", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => true);

  const north = pushDestination(playerAt(3045, 2867));
  assert.deepEqual(templateAt(north), [3045, 2872], "straight north, five tiles");

  const west = pushDestination(playerAt(3040, 2849));
  assert.deepEqual(templateAt(west), [3035, 2854], "the west side goes diagonally north-west");

  // (5,-11) and (-5,-11) from the base are recorded going straight south, not diagonally.
  assert.deepEqual(templateAt(pushDestination(playerAt(3048, 2834))), [3048, 2829]);
  assert.deepEqual(templateAt(pushDestination(playerAt(3038, 2834))), [3038, 2829]);

  // (-8,4) is recorded going diagonally north-west.
  assert.deepEqual(templateAt(pushDestination(playerAt(3035, 2849))), [3030, 2854]);
});

test("the push stops at the first blocked tile", (t) => {
  let calls = 0;
  t.mock.method(RegionManager, "canMoveIsBlocked", () => ++calls <= 4);
  const pushed = pushDestination(playerAt(3037, 2849));
  assert.deepEqual(templateAt(pushed), [3033, 2853], "the recorded four-tile north-west knock");
});

test("a player between the ammunition crates is not pushed", () => {
  assert.equal(BETWEEN_CRATES.has("3038,2849"), true);
  assert.equal(BETWEEN_CRATES.has("3056,2849"), true);
  assert.equal(betweenCrates(new Location(3038, 2849, 0)), true);
  assert.equal(pushDestination(playerAt(3038, 2849)), null, "the instance copy is exempt too");
});

test("no push from the boss base", () => {
  assert.equal(pushDestination(playerAt(3043, 2845)), null);
});

test("a pushed player is teleported, knocked down and turned to the instance's boss", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => true);
  const submitted = [];
  t.mock.method(PluginManager.getCoreApi().TaskManager, "submit", (task) => submitted.push(task));
  const player = playerAt(3040, 2849);
  assert.equal(wavePush(player), true);
  assert.equal(submitted.length, 0, "the capture shows a teleport, not a force movement");
  assert.deepEqual(
    player.moved.map((to) => cove.templateTile(to).slice(0, 2)),
    [[3035, 2854]],
    "moved to the instance copy of the template destination",
  );
  assert.equal(player.animations.at(-1).id, 7211, "human_knockdown_loop");
  assert.deepEqual(
    [player.faces.at(-1).getX(), player.faces.at(-1).getY()],
    [cove.tile([3043, 2845, 0]).getX(), cove.tile([3043, 2845, 0]).getY()],
    "facing the boss's instance tile",
  );
});

test("a player at the edge stays put but is still knocked down", (t) => {
  t.mock.method(RegionManager, "canMoveIsBlocked", () => false);
  const player = playerAt(3045, 2872);
  assert.equal(wavePush(player), true);
  assert.equal(player.moved.length, 0);
  assert.equal(player.animations.at(-1).id, 7211);
  assert.deepEqual(
    [player.faces.at(-1).getX(), player.faces.at(-1).getY()],
    [cove.tile([3043, 2845, 0]).getX(), cove.tile([3043, 2845, 0]).getY()],
  );
});
