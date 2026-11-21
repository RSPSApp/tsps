// Run after `yarn build`: node --test tests/forthos-temple-door.test.cjs
//
// Forthos Dungeon's Temple Doors had no handler, and "Temple Door" is not one of the Doors plugin's
// names, so Open did nothing. Wiki (Temple Door): only the eastern door opens at first, and only
// eastward. rsprox capture 3926 ticks 613-616: hosdun_east_door (1825,9973, face 0) becomes
// inviswall, hosdun_grubby_door_open goes on 1824,9973 (face 1), sound 62, the player crosses east,
// "The door slams shut and locks behind you." the tick after, and the door is back two ticks later.
//
// Real engine, as crandor-secret-wall.test.cjs: every plugin loaded, clicks through
// ObjectActionPacketListener.executeAction, the movement queue and tick tasks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

const X = 1825, Y = 9973, WEST_X = 1802, WEST_Y = 9957;
const SLAM = "The door slams shut and locks behind you.";

let core, EAST, WEST, LEAF;
let next = 6100;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(X, Y);
  PluginManager.emitServerStartup({});
  EAST = core.CacheDefinitions.getLocId("hosdun_east_door");
  WEST = core.CacheDefinitions.getLocId("hosdun_west_door");
  LEAF = core.CacheDefinitions.getLocId("hosdun_grubby_door_open");
});

function actor(t, x, y) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("forthos" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  const sounds = [];
  t.mock.method(core.Sounds, "sendSound", (who, sound) => {
    if (who === player) sounds.push(sound?.getId?.() ?? sound?.id ?? sound);
  });
  t.after(() => players.splice(players.indexOf(player), 1));
  return { player, messages, sounds };
}

/** One game tick in World.process's order: tick tasks first, then each player's movement and walk-to. */
function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.process();
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    for (const player of players) player.resetUpdating();
  }
}

const locAt = (id, x, y) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === 0) return object;
    }
  }
  return null;
};
const isOpen = () => locAt(LEAF, X - 1, Y) != null;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const click = (player, id, x = X, y = Y) => new ObjectActionPacketListener().executeAction(player, id, x, y, 1);

test("the cache ids match the capture", () => {
  assert.equal(EAST, 34843);
  assert.equal(WEST, 34842);
  assert.equal(LEAF, 34841);
});

test("east Temple Door from the west: opens, carries the player east, slams shut a tick later", (t) => {
  const { player, messages, sounds } = actor(t, X - 1, Y);
  tick(2);
  click(player, EAST);
  const sample = () => ({ open: isOpen(), x: at(player)[0], slam: messages.includes(SLAM) });
  const timeline = [sample()];
  for (let i = 0; i < 6; i++) {
    tick();
    timeline.push(sample());
  }
  const opened = timeline.findIndex((step) => step.open);
  assert.ok(opened >= 0, `the door swings open: ${JSON.stringify(timeline)}`);
  assert.ok(sounds.includes(62), `sound 62 on opening: ${sounds}`);
  const crossed = timeline.findIndex((step) => step.x === X);
  assert.ok(crossed >= 0, "the player is carried onto the east tile");
  const slammed = timeline.findIndex((step) => step.slam);
  assert.equal(slammed, opened + 1, `the slam message follows the opening by one tick: ${JSON.stringify(timeline)}`);
  assert.equal(timeline[opened + 1].open, true, "still open on the slam tick (capture tick 615)");
  assert.equal(timeline[opened + 2].open, false, "the door is back two ticks after it opened");
  assert.ok(locAt(EAST, X, Y), "the closed door stands again");
  assert.equal(messages.filter((m) => m === SLAM).length, 1, "the message is sent once");
  tick(4);
});

test("east Temple Door from the east (inside the den) stays locked", (t) => {
  const { player, messages } = actor(t, X, Y);
  tick(2);
  click(player, EAST);
  tick(6);
  assert.deepEqual(at(player), [X, Y], "the player does not cross west");
  assert.equal(isOpen(), false, "the door never opens");
  assert.equal(messages.includes(SLAM), false);
});

test("the west Temple Door stays locked without the temple key", (t) => {
  const { player, messages } = actor(t, WEST_X - 1, WEST_Y);
  tick(2);
  const before = at(player);
  click(player, WEST, WEST_X, WEST_Y);
  tick(6);
  assert.equal(locAt(WEST, WEST_X, WEST_Y) != null, true, "the west door is still shut");
  assert.equal(messages.includes(SLAM), false);
  assert.ok(Math.abs(at(player)[0] - before[0]) <= 1, "the player is not carried through");
});
