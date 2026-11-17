// Run after `yarn build`: node --test tests/camelot-gate.test.cjs
//
// #6003: the Camelot castle grounds gate (kr_camelot_metalgateclosedl/r 26081/26082 at 2757-2758,3482, face 1)
// opened into its nameless open leaves (26083/26084) and stayed open, so the client showed "Close null" (debug
// ids on) or no menu at all. Live (the user's rsprox captures local 1001994 ticks 16536-16541, 17415-17419,
// 17539-17543 and local 1001800 ticks 23184, 23277; rev 242): Open puts inviswall 38848 on both gate tiles and
// the open leaves on the tiles north (left rotation 0, right rotation 2), sound 69 (grate_open), the player
// steps across in the same tick, and the gate is back two ticks later.
//
// Real engine, as farming-guild-door.test.cjs: every plugin loaded, real Players, every click through
// ObjectActionPacketListener.executeAction, and the movement queue and tick tasks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

const LEFT = 26081, RIGHT = 26082, LEFT_OPEN = 26083, RIGHT_OPEN = 26084, INVISWALL = 38848;
const GATE_Y = 3482, NORTH_Y = 3483;

let core;
let next = 5700;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2757, GATE_Y);
  PluginManager.emitServerStartup({});
});

function actor(t, x, y) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("camelotgate" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  players.push(player);
  const sounds = [];
  t.mock.method(player.getPacketSender(), "sendSoundEffect", (...args) => {
    sounds.push(args);
    return player.getPacketSender();
  });
  return { player, sounds };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

function until(condition, limit = 12) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
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
const isOpen = () => locAt(LEFT_OPEN, 2757, NORTH_Y) != null && locAt(RIGHT_OPEN, 2758, NORTH_Y) != null;
const isShut = () => locAt(LEFT_OPEN, 2757, NORTH_Y) == null && locAt(RIGHT_OPEN, 2758, NORTH_Y) == null
  && locAt(INVISWALL, 2757, GATE_Y) == null && locAt(INVISWALL, 2758, GATE_Y) == null
  && locAt(LEFT, 2757, GATE_Y) != null && locAt(RIGHT, 2758, GATE_Y) != null;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const click = (player, id, x) => new ObjectActionPacketListener().executeAction(player, id, x, GATE_Y, 1);
const settle = () => tick(12);

for (const [label, id, x] of [["left", LEFT, 2757], ["right", RIGHT, 2758]]) {
  test(`as captured: the ${label} leaf opens the gate for two ticks and the player steps north through it`, (t) => {
    settle();
    assert.ok(isShut(), "the gate starts shut");
    const { player, sounds } = actor(t, x, GATE_Y);
    click(player, id, x);
    assert.ok(until(isOpen, 4), "both leaves swing open onto the tiles north");
    // Live steps across on the swap's own tick (local 1001994 tick 17417); every walkOver gate here
    // (walkOverGate in Doors.plugin.js) steps a tick later, still before the gate shuts.
    assert.equal(locAt(LEFT_OPEN, 2757, NORTH_Y).getFace(), 0);
    assert.equal(locAt(RIGHT_OPEN, 2758, NORTH_Y).getFace(), 2);
    assert.ok(locAt(INVISWALL, 2757, GATE_Y) && locAt(INVISWALL, 2758, GATE_Y), "inviswall on both gate tiles");
    assert.ok(sounds.some(([id]) => id === 69), "grate_open (69)");
    tick();
    assert.deepEqual(at(player), [x, NORTH_Y], "the player is through a tick after the click");
    tick();
    assert.ok(isShut(), "the gate is back by the second tick, with no nameless leaf left standing");
  });
}

test("as captured: from inside the grounds the gate lets the player back out south", (t) => {
  settle();
  const { player } = actor(t, 2758, NORTH_Y);
  click(player, RIGHT, 2758);
  assert.ok(until(() => at(player)[1] === GATE_Y, 6), `the player steps out: ${at(player)}`);
  assert.ok(until(isShut, 3), "the gate is back");
});
