// Run after `yarn build`: node --test tests/edgeville-dungeon-members-gate.test.cjs
//
// The Edgeville Dungeon members' gate (membergatel 1727 and membergater 1728 at 3131-3132,9917) between
// the zombies and the Wilderness chaos druids. It opened as an ordinary double gate: the leaves stood open
// with a Close option, the opener stayed put and it shut on the generic door timer.
//
// What live does (rsprox capture rev 243, ticks 132-146 going north, 398-401 coming back): both leaves
// become invisible walls (38848) and the actionless open leaves 1573/1574 stand one tile north, with
// iron_door_open (71); the player walks across on that tick, and the gate is shut two ticks later.
//
// Only the Doors plugin is loaded: the click seam is "door:open", the function the Open option runs.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const GATE_L = 1727, GATE_R = 1728, OPEN_L = 1573, OPEN_R = 1574, INVISWALL = 38848, IRON_DOOR_OPEN = 71;
const LX = 3131, RX = 3132, Y = 9917; // the gate's tiles; its wall is their north edge
const SOUTH = [LX, Y], NORTH = [LX, Y + 1];

let core;
let next = 6200;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/objects/Doors.plugin").register(PluginManager.createApi("Doors"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(LX, Y);
  PluginManager.emitServerStartup({});
});

/** A real player on a tile, recording the sounds it is sent. */
function actor(t, [x, y]) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("edgegate" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  players.push(player);
  const sounds = [];
  t.mock.method(player.getPacketSender(), "sendSoundEffect", (...args) => {
    sounds.push(args[0]);
    return player.getPacketSender();
  });
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, sounds };
}

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

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
  }
}

function assertShut() {
  assert.ok(objectAt(GATE_L, LX, Y) && objectAt(GATE_R, RX, Y), "both closed leaves are back");
  assert.equal(objectAt(OPEN_L, LX, Y + 1), null, "the open leaves are gone");
  assert.equal(objectAt(INVISWALL, LX, Y), null, "and so are the invisible walls");
}

for (const [direction, from, to] of [["north, into the Wilderness", SOUTH, NORTH], ["south, back out", NORTH, SOUTH]]) {
  test(`going ${direction}: the gate opens, walks the opener across and shuts two ticks later`, (t) => {
    tick(12);
    const gate = objectAt(GATE_L, LX, Y);
    assert.ok(gate, "the closed gate stands on its tiles");
    const { player, sounds } = actor(t, from);
    assert.equal(open(player, gate), true, "the Open option is answered");

    tick(1);
    assert.ok(objectAt(INVISWALL, LX, Y) && objectAt(INVISWALL, RX, Y), "both leaves are invisible walls");
    assert.ok(objectAt(OPEN_L, LX, Y + 1) && objectAt(OPEN_R, RX, Y + 1), "the actionless open leaves stand north");
    assert.equal(objectAt(GATE_L, LX, Y), null, "the closed leaf is gone");
    assert.deepEqual(sounds.filter((id) => id === IRON_DOOR_OPEN), [IRON_DOOR_OPEN], "iron_door_open, once");

    tick(2);
    assertShut();
    assert.deepEqual(at(player), to, "the opener walked across");
  });
}
