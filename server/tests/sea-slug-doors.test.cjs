// Run after `yarn build`: node --test tests/sea-slug-doors.test.cjs
//
// Issue 4117 points 1 and 4: the fishing platform's cabin and Bailey's doors teleported the player
// inside. Live (Sea Slug capture 20261110T112750-5ab63b4, rev 242, ticks 117-137 and 235-241) opens
// them like any door: slug2_village_poordoor (18168) goes and fai_barbarian_poordooropen (11617)
// stands on the next tile west, turned a quarter, and the player walks in; Kennith is talked to
// from 2765,3286. Barbarian Village's own door (11616) keeps 11617 as its open leaf.
//
// Real engine, as priest-in-peril-doors.test.cjs: every plugin loaded, real Players, the quest at
// its real stages, every click through ObjectActionPacketListener.executeAction and the ticks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const DOOR = 18168, DOOR_OPEN = 11617;
let core;
let next = 5800;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2768, 3280);
  PluginManager.emitServerStartup({});
});

function actor(t, stage, x, y, z) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("slugdoor" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  players.push(player);
  t.after(() => {
    player.getDialogueManager().reset?.();
    player.setRegistered(false);
    players.splice(players.indexOf(player), 1);
  });
  QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "sea_slug").setStage(player, stage);
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

const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
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

for (const [name, door, from, inside] of [
  ["Kennith's cabin", [2767, 3285, 1], [2767, 3286], [2765, 3286]],
  ["Bailey's house", [2768, 3276, 0], [2768, 3275], [2766, 3276]],
]) {
  test(`${name}'s door opens in place and the player walks through it`, (t) => {
    const [x, y, z] = door;
    const player = actor(t, 3, from[0], from[1], z);
    tick(4);
    assert.ok(locAt(DOOR, x, y, z), "the closed door is on the map");
    click(player, DOOR, x, y);
    assert.ok(until(() => locAt(DOOR_OPEN, x - 1, y, z) !== null, 6), "the open leaf stands one tile west");
    assert.equal(locAt(DOOR_OPEN, x - 1, y, z).getFace(), 1, "turned a quarter (live rotation 1)");
    assert.notDeepEqual(at(player), [inside[0], inside[1], z], "the click does not move the player inside");
    player.getMovementQueue().walkToTile(new core.Location(inside[0], inside[1], z), () => {});
    assert.ok(until(() => at(player)[0] === inside[0] && at(player)[1] === inside[1], 8), "an ordinary walk reaches the room");
    tick(2);
  });
}

test("an untracked open 11617 leaf still closes as Barbarian Village's 11616, not as 18168", (t) => {
  const player = actor(t, 3, 2779, 3281, 0);
  tick(2);
  const leaf = new core.GameObject(DOOR_OPEN, new core.Location(2779, 3280, 0), 0, 1, null);
  core.ObjectManager.register(leaf, true);
  t.after(() => {
    for (const id of [DOOR_OPEN, 11616, DOOR]) {
      const left = locAt(id, 2779, 3280, 0) ?? locAt(id, 2780, 3280, 0);
      if (left) core.ObjectManager.deregister(left, true);
    }
  });
  click(player, DOOR_OPEN, 2779, 3280);
  assert.ok(until(() => locAt(11616, 2779, 3280, 0) || locAt(11616, 2780, 3280, 0), 6), "it closes into 11616");
  assert.equal(locAt(DOOR, 2779, 3280, 0) ?? locAt(DOOR, 2780, 3280, 0), null);
});
