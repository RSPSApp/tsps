// Run after `yarn build`: node --test tests/grand-tree-doors.test.cjs
//
// The Grand Tree's front doors open in place and shut behind the player (rsprox 1150, 3434, 4263).
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const realCore = PluginManager.getCoreApi();
const ops = [];
const sounds = [];
const shutTasks = [];
const runs = [];
const core = {
  ...realCore,
  ObjectManager: {
    register: (o) => ops.push(["register", o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getType(), o.getFace()]),
    deregister: (o) => ops.push(["deregister", o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getType(), o.getFace()]),
  },
  TaskManager: { submit: (task) => shutTasks.push(task) },
  Sounds: { sendSound: (_player, sound) => sounds.push(sound.getId?.() ?? sound.id) },
};
const handlers = new Map();
const api = {
  core,
  onCustomEvent: (name, handler) => handlers.set(name, handler),
  getTaskManager: () => ({ submit: (task) => runs.push(task) }),
};
const plugin = require("../plugins/areas/GrandTree.plugin");
plugin.register(api);

const O = core.ObjectIdentifiers;

function fakePlayer(x, y) {
  const attributes = new Map();
  return {
    getLocation: () => new core.Location(x, y, 0),
    getPrivateArea: () => null,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {} }),
    getPacketSender: () => ({ sendVarbit() {} }),
  };
}

function click(player, id, x, face) {
  const object = new core.GameObject(id, new core.Location(x, 3492, 0), 10, face, null);
  const event = { player, object, objectId: id, handled: false };
  handlers.get("door:toggle")(event);
  return event;
}

beforeEach(() => {
  ops.length = 0;
  sounds.length = 0;
  shutTasks.length = 0;
  runs.length = 0;
  plugin._test.openLeaves.length = 0;
});

test("the west leaf swaps in place for 1969 and the player walks out through its east tile", () => {
  const event = click(fakePlayer(2465, 3493), O.TREE_DOOR, 2464, 0);
  assert.equal(event.handled, true);
  assert.deepEqual(ops.splice(0), [["deregister", 1967, 2464, 3492, 10, 0], ["register", 1969, 2464, 3492, 10, 0]]);
  assert.deepEqual(sounds, [62]);
  assert.deepEqual(runs[0].steps, [{ wait: 1 }, { walk: [[2465, 3492], [2465, 3491]] }]);
  assert.equal(shutTasks.length, 1);
  shutTasks[0].execute();
  assert.deepEqual(ops, [["deregister", 1969, 2464, 3492, 10, 0], ["register", 1967, 2464, 3492, 10, 0]]);
  assert.equal(plugin._test.openLeaves.length, 0);
});

test("the east leaf is crossed on its own tile, going in from the south", () => {
  click(fakePlayer(2466, 3491), O.TREE_DOOR_2, 2466, 2);
  assert.deepEqual(ops, [["deregister", 1968, 2466, 3492, 10, 2], ["register", 1970, 2466, 3492, 10, 2]]);
  assert.deepEqual(runs[0].steps, [{ wait: 1 }, { walk: [[2466, 3492], [2466, 3493]] }]);
});

test("a player beside the crossing column steps onto it first", () => {
  assert.deepEqual(plugin._test.crossingPath(new core.Location(2464, 3493, 0), 2464, 3492, 0),
    [[2465, 3493], [2465, 3492], [2465, 3491]]);
});

test("a second player crosses a leaf already open without swapping it again", () => {
  click(fakePlayer(2465, 3493), O.TREE_DOOR, 2464, 0);
  ops.length = 0;
  click(fakePlayer(2465, 3491), O.TREE_DOOR, 2464, 0);
  assert.deepEqual(ops, []);
  assert.equal(shutTasks.length, 1);
  assert.deepEqual(runs[1].steps, [{ wait: 1 }, { walk: [[2465, 3492], [2465, 3493]] }]);
});

test("other doors are left to Doors.plugin.js", () => {
  const event = click(fakePlayer(2465, 3493), O.DOOR_5, 2464, 0);
  assert.equal(event.handled, false);
  assert.deepEqual(ops, []);
});
