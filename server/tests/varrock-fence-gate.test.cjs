// Run after `yarn build`: node --test tests/varrock-fence-gate.test.cjs
//
// The fence gate east of Varrock by the quetzal platform (vm_fencegate_l/_r, 24560/24561, at
// 3296,3428-3429). rsprox captures 232/3228 ticks 561-568, 642-644 and 931-937, 232/3227 tick
// 4504 and 232/3231 tick 288: Open swaps both leaves for vm_fencing_invisible_wall (24562) in the
// doorway and swings them west (24561 at 3295,3429 and 24560 at 3294,3429, rotation 1), the player
// walks across on the next tick, and the closed gate is back two ticks after it opened. No synth
// is sent for the gate (the only sound in the windows is the patrol wheelbarrow's sound_area 3670).
//
// Real engine: every plugin loaded, real Players, clicks sent through
// ObjectActionPacketListener.executeAction so the route, walk-to and tick tasks all run.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

let core;
let LEFT, RIGHT, WALL;
let next = 4500;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3296, 3428);
  PluginManager.emitServerStartup({});
  LEFT = core.CacheDefinitions.getLocId("vm_fencegate_l");
  RIGHT = core.CacheDefinitions.getLocId("vm_fencegate_r");
  WALL = core.CacheDefinitions.getLocId("vm_fencing_invisible_wall");
});

const closed = () => [[LEFT, 3296, 3428, 0], [RIGHT, 3296, 3429, 0]];
const opened = () => [[LEFT, 3294, 3429, 1], [RIGHT, 3295, 3429, 1], [WALL, 3296, 3428, 0], [WALL, 3296, 3429, 0]];

/** The gate's locs around the doorway, as [id, x, y, face], sorted. */
function gateLocs() {
  const found = [];
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const at = object.getLocation();
      if (at.getX() < 3292 || at.getX() > 3299 || at.getY() < 3426 || at.getY() > 3431 || at.getZ() !== 0) continue;
      if (![LEFT, RIGHT, WALL].includes(object.getId())) continue;
      found.push([object.getId(), at.getX(), at.getY(), object.getFace()]);
    }
  }
  return sort(found);
}
const sort = (rows) => [...rows].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

function actor(t, x, y) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("vmgate" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  players.push(player);
  const sounds = [];
  t.mock.method(core.Sounds, "sendSound", (target, sound) => {
    if (target === player) sounds.push(sound?.getId?.() ?? sound?.id ?? sound);
  });
  return { player, sounds };
}

/** One game tick in World.process's order: tasks first, then each player's steps and walk-to reach. */
function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.process();
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
  }
}

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const click = (player, id, x, y) => new ObjectActionPacketListener().executeAction(player, id, x, y, 1);

/** Ticks until the gate opens; returns how many ticks that took. */
function untilOpen(limit = 8) {
  for (let i = 0; i < limit; i++) {
    if (gateLocs().some((row) => row[0] === WALL)) return i;
    tick();
  }
  assert.fail("the gate never opened");
}

test("the map places the closed gate the tests rely on", () => {
  tick(6);
  assert.deepEqual(gateLocs(), sort(closed()));
});

for (const [label, from, leaf, to] of [
  // Each opener starts a tile away, so the gate opens the tick after they reach the doorway, as in the captures.
  ["east to west, left leaf", [3298, 3428], "left", [3295, 3428]],
  ["west to east, left leaf", [3294, 3428], "left", [3296, 3428]],
  ["east to west, right leaf", [3298, 3429], "right", [3295, 3429]],
]) {
  test(`Open passes the player through and shuts two ticks later (${label})`, (t) => {
    const { player, sounds } = actor(t, ...from);
    tick(6);
    const [id, x, y] = leaf === "left" ? [LEFT, 3296, 3428] : [RIGHT, 3296, 3429];
    click(player, id, x, y);
    assert.ok(untilOpen() >= 1, "opened on a tick, after the walk to the gate");
    assert.deepEqual(gateLocs(), sort(opened()), "invisible walls in the doorway, leaves swung west");
    assert.notDeepEqual(at(player), to, "not across yet on the opening tick");
    tick();
    assert.deepEqual(at(player), to, "the player walked across on the next tick");
    assert.deepEqual(gateLocs(), sort(opened()), "still open one tick after opening");
    tick();
    assert.deepEqual(gateLocs(), sort(closed()), "closed again two ticks after opening");
    assert.deepEqual(sounds, [], "live sends no synth for this gate");
    players.splice(players.indexOf(player), 1);
  });
}
