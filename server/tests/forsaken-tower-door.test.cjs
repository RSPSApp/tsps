// Run after `yarn build`: node --test tests/forsaken-tower-door.test.cjs
//
// #6912: the Forsaken Tower's entrance (33491 at 1382,3817) did nothing when opened. Its open leaf
// (33492) is nameless and has no action at all — the same model 36259 — so the door catalog's
// action scan cannot pair them; SINGLE_DOOR_OPEN_IDS carries the pair. Wiki (The Forsaken Tower):
// the entrance is how players get in, and the tower's own doors (33556 -> 33557) are the cache-scan
// kind, so they must keep working.
//
// Only the Doors plugin is loaded: the click seam is "door:open", which is the same function the
// Open option runs (Doors.plugin.js requestDoorOpen), and the map region is the tower's own.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const DOOR = 33491, OPEN_LEAF = 33492, X = 1382, Y = 3817;
const INNER_DOOR = 33556, INNER_OPEN = 33557, INNER_X = 1380, INNER_Y = 3826;

let core;
let next = 6100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/objects/Doors.plugin").register(PluginManager.createApi("Doors"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(X, Y);
  PluginManager.emitServerStartup({});
});

function player() {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const who = new Player(new PlayerSession(channel));
  who.setIndex(next++);
  who.setUsername("towerdoor" + who.getIndex());
  who.setRegistered(true);
  who.setLocation(new core.Location(X, Y - 1, 0));
  who.needsPlacement = false;
  return who;
}

/** The object instance standing on a tile, or null (a doorway can hold a floor loc too). */
function objectAt(id, x, y) {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === 0) return object;
    }
  }
  return null;
}

/** Where a door's open leaf went after it swung (the leaf sits beside the doorway). */
function leafNear(id, x, y) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const found = objectAt(id, x + dx, y + dy);
      if (found) return [x + dx, y + dy];
    }
  }
  return null;
}

function open(who, object) {
  const request = { player: who, object, handled: false };
  PluginManager.emitCustomEvent("door:open", request);
  return request.handled === true;
}

function tick(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

test("the tower's entrance opens into its actionless leaf and frees the doorway", () => {
  const door = objectAt(DOOR, X, Y);
  assert.ok(door, "the closed door stands on the doorway");
  assert.equal(open(player(), door), true, "the Open option is answered");
  tick(1);
  assert.equal(objectAt(DOOR, X, Y), null, "the closed leaf is gone");
  assert.ok(leafNear(OPEN_LEAF, X, Y), "the open leaf has swung beside the doorway");
  assert.equal(core.RegionManager.blocked(new core.Location(X, Y, 0)), false, "the doorway tile is clear");
  assert.equal(core.RegionManager.blocked(new core.Location(X, Y + 1, 0)), false, "and the tile inside it");
});

test("the tower's own doors still open through the cache scan", () => {
  const door = objectAt(INNER_DOOR, INNER_X, INNER_Y);
  assert.ok(door, "33556 stands on its doorway");
  assert.equal(open(player(), door), true);
  tick(1);
  assert.equal(objectAt(INNER_DOOR, INNER_X, INNER_Y), null);
  assert.ok(leafNear(INNER_OPEN, INNER_X, INNER_Y), "33556 swaps to its Close leaf");
});
