// Run after `yarn build`: node --test tests/edgeville-brass-key-door.test.cjs
//
// The brass key door of the shed west of the Cooks' Guild (1804 at 3115,3450, face 3). As captured, opening puts
// an invisible wall (38848) in the door's place and the open door (1539) on the tile south; two ticks later the
// door is shut again. The handler registered the wall and the open door beside the closed door without taking
// the door off its tile, so players saw the closed door stay put while a second, open door appeared beside it,
// and each shut stacked another closed door on the tile.
//
// Real engine, as farming-guild-door.test.cjs: every plugin loaded, a real Player, every click through
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

const DOOR = 1804, OPEN_DOOR = 1539, WALL = 38848, BRASS_KEY = 983;
const X = 3115, DOOR_Y = 3450, OUTSIDE_Y = 3449;

let core;
let next = 5850;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(X, DOOR_Y);
  PluginManager.emitServerStartup({});
});

function actor(t, y, key = true) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("brasskey" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(X, y, 0));
  player.needsPlacement = false;
  if (key) player.getInventory().adds(BRASS_KEY, 1);
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
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

function until(condition, limit = 8) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
}

const count = (id, y) => (core.MapObjects.mapObjects.get(core.MapObjects.getHash(X, y, 0)) ?? [])
  .filter((object) => object.getId() === id).length;
const isOpen = () => count(WALL, DOOR_Y) === 1 && count(OPEN_DOOR, OUTSIDE_Y) === 1;
const isShut = () => count(DOOR, DOOR_Y) === 1 && count(WALL, DOOR_Y) === 0 && count(OPEN_DOOR, OUTSIDE_Y) === 0;
const at = (player) => player.getLocation().getY();
const click = (player) => new ObjectActionPacketListener().executeAction(player, DOOR, X, DOOR_Y, 1);

for (const [label, from, to] of [["into the shed", OUTSIDE_Y, DOOR_Y], ["back out", DOOR_Y, OUTSIDE_Y]]) {
  test(`with the brass key the door opens in place of itself and the player goes ${label}`, (t) => {
    tick(8);
    assert.ok(isShut(), "one closed door on its tile to start with");
    const { player, messages } = actor(t, from);
    click(player);
    assert.ok(until(isOpen), "the wall and the open door are placed");
    assert.equal(count(DOOR, DOOR_Y), 0, "the closed door is off its tile while it stands open");
    assert.ok(until(() => at(player) === to), `the player steps through to y ${to}: at ${at(player)}`);
    assert.ok(until(isShut), "two ticks later the door is shut again");
    assert.equal(count(DOOR, DOOR_Y), 1, "and only one closed door stands there");
    assert.deepEqual(messages, ["You unlock the door."]);
  });
}

test("without the brass key the door is locked and nothing moves", (t) => {
  tick(8);
  const { player, messages } = actor(t, OUTSIDE_Y, false);
  click(player);
  tick(4);
  assert.ok(isShut());
  assert.equal(at(player), OUTSIDE_Y);
  assert.deepEqual(messages, ["The door is locked."]);
});
