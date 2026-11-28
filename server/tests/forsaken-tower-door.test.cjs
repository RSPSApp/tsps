// Run after `yarn build`: node --test tests/forsaken-tower-door.test.cjs
//
// #6912: the Forsaken Tower's entrance (33491 at 1382,3817) did nothing when opened. Its open leaf
// (33492) is nameless and has no action at all — the same model 36259 — so the door catalog's
// action scan cannot pair them, and pairing them as an ordinary single door leaves it standing for
// 500 ticks.
//
// What live does: rsprox local 1002193 (oploc1 at tick 759, ticks 763-765) and 1002135 (ticks
// 27386-27388) — inviswall on the doorway, the actionless leaf on the tile outside at face 0,
// iron_door_open (71), the player walked across, and the closed door back two ticks later. So it is
// a pass-through gate that shuts behind the opener, and the tower's own doors (33556 -> 33557) are
// the cache-scan kind and must keep working.
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

const DOOR = 33491, OPEN_LEAF = 33492, INVISWALL = 38848, IRON_DOOR_OPEN = 71;
const X = 1382, Y = 3817; // the doorway; the tower is north of it
const OUTSIDE = [X, Y - 1], INSIDE = [X, Y];
const INNER_DOOR = 33556, INNER_OPEN = 33557, INNER_X = 1380, INNER_Y = 3826;

let core;
let next = 6100;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/objects/Doors.plugin").register(PluginManager.createApi("Doors"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(X, Y);
  PluginManager.emitServerStartup({});
});

/** A real player standing outside the entrance, recording the sounds it is sent. */
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("towerdoor" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(...OUTSIDE, 0));
  player.needsPlacement = false;
  players.push(player);
  const sounds = [];
  t.mock.method(player.getPacketSender(), "sendSoundEffect", (...args) => {
    sounds.push([core.World.getProcessCycle(), ...args]);
    return player.getPacketSender();
  });
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, sounds };
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

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];

function open(who, object) {
  const request = { player: who, object, handled: false };
  PluginManager.emitCustomEvent("door:open", request);
  return request.handled === true;
}

/** One game tick: the test players' own movement, then the world's tasks. */
function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
  }
}

test("the entrance is a pass-through gate: it opens, walks the opener in and shuts two ticks later", (t) => {
  tick(12);
  const door = objectAt(DOOR, X, Y);
  assert.ok(door, "the closed door stands on the doorway");
  const { player, sounds } = actor(t);
  assert.equal(open(player, door), true, "the Open option is answered");

  tick(1);
  assert.ok(objectAt(INVISWALL, X, Y), "the doorway is an invisible wall while the door is open");
  assert.ok(objectAt(OPEN_LEAF, X, OUTSIDE[1]), "the actionless leaf stands on the tile outside");
  assert.equal(objectAt(DOOR, X, Y), null, "the closed leaf is gone");
  assert.deepEqual(sounds.filter(([, id]) => id === IRON_DOOR_OPEN).map(([, id]) => id), [IRON_DOOR_OPEN],
    "the iron door's own opening sound, once");

  tick(2); // the close task runs two ticks after the swap
  assert.ok(objectAt(DOOR, X, Y), "the closed door is back");
  assert.equal(objectAt(OPEN_LEAF, X, OUTSIDE[1]), null, "the open leaf is gone");
  assert.equal(objectAt(INVISWALL, X, Y), null, "and so is the invisible wall");
  assert.deepEqual(at(player), INSIDE, "the opener walked through and is standing inside");
});

test("the tower's own doors still open through the cache scan", (t) => {
  tick(12);
  const door = objectAt(INNER_DOOR, INNER_X, INNER_Y);
  assert.ok(door, "33556 stands on its doorway");
  const { player } = actor(t);
  player.setLocation(new core.Location(INNER_X, INNER_Y - 1, 0));
  assert.equal(open(player, door), true);
  tick(1);
  assert.equal(objectAt(INNER_DOOR, INNER_X, INNER_Y), null);
  assert.ok(objectAt(INNER_OPEN, INNER_X, INNER_Y - 1) ?? objectAt(INNER_OPEN, INNER_X, INNER_Y + 1),
    "33556 swaps to its Close leaf beside the doorway");
});
