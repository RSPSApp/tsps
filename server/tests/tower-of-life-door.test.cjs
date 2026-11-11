// Run after `yarn build`: node --test tests/tower-of-life-door.test.cjs
//
// Tower of Life (#3980): the tower door (21814, open leaf 21815) used to teleport the player through
// instead of opening. The quest's door:toggle check runs first; a pass leaves the door to the Doors plugin,
// which lets that player through and shuts it (tower-of-life-door-pass-through.test.cjs).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

const DOOR = 21814, OPEN_LEAF = 21815, X = 2649, Y = 3225, STAGE_KEY = "quest.tower_of_life.stage";
let core;
let next = 5800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(X, Y);
  PluginManager.emitServerStartup({});
});

function actor(t, stage) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("tolfloor" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(X, Y - 1, 0));
  player.needsPlacement = false;
  player.setAttribute(STAGE_KEY, stage);
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => { messages.push(message); return player.getPacketSender(); });
  return { player, messages };
}

// A wall door swings onto the neighbouring tile, so look within one tile of the doorway.
const locAt = (id) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && Math.abs(where.getX() - X) <= 1 && Math.abs(where.getY() - Y) <= 1 && where.getZ() === 0) return object;
    }
  }
  return null;
};

const players = [];
function tick(count) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

test("a player who is not admitted is turned away and the door stays shut", (t) => {
  const { player, messages } = actor(t, 0);
  new ObjectActionPacketListener().executeAction(player, DOOR, X, Y, 1);
  tick(4);
  assert.ok(messages.some((message) => message.startsWith("Only builders")), JSON.stringify(messages));
  assert.ok(locAt(DOOR) && !locAt(OPEN_LEAF), "the door never opened");
});

test("after the quest the door lets the player out through the doorway and shuts, instead of teleporting", (t) => {
  const { player } = actor(t, 16);
  new ObjectActionPacketListener().executeAction(player, DOOR, X, Y, 1);
  tick(1);
  for (let i = 0; i < 6 && player.getLocation().getY() !== Y; i++) tick(1);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [X, Y], "the player walks one tile out, onto the doorway");
  tick(6);
  assert.ok(locAt(DOOR) && !locAt(OPEN_LEAF), "the door is shut again (a pass-through gate in Doors.plugin.js)");
});
