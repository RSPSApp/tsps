// Run after `yarn build`: node --test tests/hallowvale-ral-doors.test.cjs
//
// Issue 6545: Old Man Ral's house doors in Meiyerditch did not open, so Darkness of Hallowvale
// could not reach him. Live (the user's Darkness of Hallowvale capture, rev 242, ticks 836-845)
// opens them like any door: area_sanguine_ghetto_door1 (17600) at 3602,3208 (rotation 3) goes and
// area_sanguine_ghetto_open_door1 (18031) stands on 3602,3207 at rotation 0; door2 (17601) at
// 3606,3206 the same, onto 18032 at 3606,3205; door_open (62) each time. They swing shut on their
// own about 499 ticks later (t841 -> t1340).
//
// Real engine, as sea-slug-doors.test.cjs: every plugin loaded, real Players, every click through
// ObjectActionPacketListener.executeAction and the ticks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

let core;
let next = 5900;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3602, 3208);
  PluginManager.emitServerStartup({});
});

function actor(t, x, y, z) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("raldoor" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  players.push(player);
  t.after(() => {
    player.getDialogueManager().reset?.();
    player.setRegistered(false);
    players.splice(players.indexOf(player), 1);
  });
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

const locAt = (id, x, y, z) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === z) return object;
    }
  }
  return null;
};
const click = (player, id, x, y) => new ObjectActionPacketListener().executeAction(player, id, x, y, 1);

for (const [name, closed, open, door, leaf, from] of [
  ["the west door (17600)", 17600, 18031, [3602, 3208, 0], [3602, 3207], [3601, 3209]],
  ["the east door (17601)", 17601, 18032, [3606, 3206, 0], [3606, 3205], [3605, 3204]],
]) {
  test(`Old Man Ral's ${name} opens onto its own open leaf and closes again`, (t) => {
    const [x, y, z] = door;
    const player = actor(t, from[0], from[1], z);
    tick(2);
    assert.ok(locAt(closed, x, y, z), "the closed door is on the map");
    assert.equal(locAt(closed, x, y, z).getFace(), 3, "rotation 3, as live");
    click(player, closed, x, y);
    assert.ok(until(() => locAt(open, leaf[0], leaf[1], z) !== null, 8), "the open leaf stands on the next tile south");
    assert.equal(locAt(open, leaf[0], leaf[1], z).getFace(), 0, "rotation 0 (live loc_add_change)");
    assert.equal(locAt(closed, x, y, z), null, "the closed door is gone");
    click(player, open, leaf[0], leaf[1]);
    assert.ok(until(() => locAt(closed, x, y, z) !== null, 8), "Close puts the closed door back");
    assert.equal(locAt(open, leaf[0], leaf[1], z), null);
  });
}
