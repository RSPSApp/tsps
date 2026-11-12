// Run after `yarn build`: node --test tests/lumbridge-kitchen-ross-doors.test.cjs
//
// Two single doors the catalog never paired, so Open did nothing:
// - Lumbridge Castle's kitchen door (hundred_lumbridge_door 12348 at 3207,3217, face 1). Its id+1 is a
//   Large door (12349), so the id+1 scan skips it. 1544, the castle door's open leaf, is the same model
//   with Close; the castle door 1543 must keep 1544 as its own open leaf.
// - Ross's house in East Ardougne (40178 at 2610,3316, face 2), one of the twelve Mahogany Homes clients'
//   houses and its only way in. Open/Pick-lock with the models of Ardougne's picklock doors 11719/11720,
//   which open under their own ids; 40177 is a hotspot and 40179 a mirror.
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

const KITCHEN_DOOR = 12348, CASTLE_DOOR = 1543, CASTLE_DOOR_OPEN = 1544, ROSS_DOOR = 40178;

let core;
let next = 5650;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3207, 3217);
  core.RegionManager.loadMapFiles(2610, 3316);
  PluginManager.emitServerStartup({});
});

function actor(x, y, z = 0) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("door" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  players.push(player);
  return player;
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

const locsAt = (x, y, z) => core.MapObjects.mapObjects.get(core.MapObjects.getHash(x, y, z)) ?? [];
const locAt = (id, x, y, z = 0) => locsAt(x, y, z).find((object) => object.getId() === id) ?? null;
const near = (id, x, y, z = 0) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
  .map(([dx, dy]) => locAt(id, x + dx, y + dy, z)).find(Boolean) ?? null;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const click = (player, id, x, y) => new ObjectActionPacketListener().executeAction(player, id, x, y, 1);
const walk = (player, x, y) => player.getMovementQueue().walkToTile(new core.Location(x, y, player.getLocation().getZ()), () => {});
const settle = () => tick(12);

test("the Lumbridge kitchen door opens into the dining room and closes back as itself", () => {
  settle();
  const player = actor(3207, 3216);
  click(player, KITCHEN_DOOR, 3207, 3217);
  assert.ok(until(() => locAt(KITCHEN_DOOR, 3207, 3217) == null), "the closed door leaves its wall");
  const open = near(CASTLE_DOOR_OPEN, 3207, 3217);
  assert.ok(open, "its open leaf (1544) stands beside the doorway");
  walk(player, 3207, 3218);
  assert.ok(until(() => at(player)[1] === 3218), `the player walks into the dining room: ${at(player)}`);
  click(player, CASTLE_DOOR_OPEN, open.getLocation().getX(), open.getLocation().getY());
  assert.ok(until(() => locAt(KITCHEN_DOOR, 3207, 3217) != null), "closing puts the kitchen door back");
  assert.equal(locAt(KITCHEN_DOOR, 3207, 3217).getFace(), 1);
  assert.equal(near(CASTLE_DOOR_OPEN, 3207, 3217), null, "no open leaf is left behind");
});

test("the castle door 1543 still opens as 1544 and closes back as 1543", () => {
  settle();
  const player = actor(3208, 3214, 1);
  click(player, CASTLE_DOOR, 3207, 3214);
  assert.ok(until(() => locAt(CASTLE_DOOR, 3207, 3214, 1) == null), "the Duke's door opens");
  const open = near(CASTLE_DOOR_OPEN, 3207, 3214, 1);
  assert.ok(open, "as its open leaf 1544");
  click(player, CASTLE_DOOR_OPEN, open.getLocation().getX(), open.getLocation().getY());
  assert.ok(until(() => locAt(CASTLE_DOOR, 3207, 3214, 1) != null), "and shuts as the castle door, not the kitchen door");
  assert.equal(locAt(KITCHEN_DOOR, 3207, 3214, 1), null);
});

test("Ross's door opens under its own id, lets the player in, and shuts again", () => {
  settle();
  const player = actor(2611, 3316);
  click(player, ROSS_DOOR, 2610, 3316);
  assert.ok(until(() => locAt(ROSS_DOOR, 2610, 3316) == null), "the closed door leaves its wall");
  const open = near(ROSS_DOOR, 2610, 3316);
  assert.ok(open, "the same loc swings open beside the doorway");
  walk(player, 2609, 3316);
  assert.ok(until(() => at(player)[0] === 2609), `the player walks into the house: ${at(player)}`);
  click(player, ROSS_DOOR, open.getLocation().getX(), open.getLocation().getY());
  assert.ok(until(() => locAt(ROSS_DOOR, 2610, 3316) != null), "closing puts the door back on its wall");
  assert.equal(locAt(ROSS_DOOR, 2610, 3316).getFace(), 2);
});
