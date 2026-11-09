// Run after `yarn build`: node --test tests/farming-guild-door.test.cjs
//
// #3899: the Farming Guild entrance (kebos_farming_guild_door_left/right_closed 34463/34464 at 1248-1249,3723,
// face 3) did nothing when opened. Live (rsprox 239 ticks 1648-1651 in, 1692 ticks 939-942 out): Open puts
// inviswall 38848 on both doorway tiles and the open leaves 34465/34466 on the tiles south, the player steps
// across in the same tick, and the door is back two ticks later. Wiki (Farming Guild): 45 Farming to enter,
// boosts allowed; leaving is never stopped.
//
// Real engine, as crandor-secret-wall.test.cjs: every plugin loaded, real Players, every click through
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

const LEFT = 34463, RIGHT = 34464, LEFT_OPEN = 34465, RIGHT_OPEN = 34466, INVISWALL = 38848;
const DOOR_Y = 3723, OUTSIDE_Y = 3722;

let core;
let next = 5600;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(1248, DOOR_Y);
  PluginManager.emitServerStartup({});
});

function actor(t, farming, x, y, boost = 0) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("farmguild" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.FARMING, farming, false);
  player.getSkillManager().setCurrentLevels(core.Skill.FARMING, farming + boost, false);
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
const isOpen = () => locAt(LEFT_OPEN, 1248, OUTSIDE_Y) != null && locAt(RIGHT_OPEN, 1249, OUTSIDE_Y) != null;
const isShut = () => !isOpen() && locAt(INVISWALL, 1248, DOOR_Y) == null && locAt(INVISWALL, 1249, DOOR_Y) == null;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const click = (player, id, x) => new ObjectActionPacketListener().executeAction(player, id, x, DOOR_Y, 1);
const settle = () => tick(12);

for (const [label, id, x] of [["right", RIGHT, 1249], ["left", LEFT, 1248]]) {
  test(`45 Farming opens the ${label} leaf, steps into the guild, and the door shuts two ticks later`, (t) => {
    settle();
    const { player, messages } = actor(t, 45, x, OUTSIDE_Y);
    click(player, id, x);
    assert.ok(until(isOpen, 4), "both leaves swing open onto the tiles south");
    assert.ok(locAt(INVISWALL, 1248, DOOR_Y) && locAt(INVISWALL, 1249, DOOR_Y), "inviswall on both doorway tiles");
    assert.ok(until(() => at(player)[1] === DOOR_Y, 4), `the player steps in: ${at(player)}`);
    assert.deepEqual(at(player), [x, DOOR_Y]);
    assert.ok(until(isShut, 4), "the door is back");
    assert.ok(locAt(LEFT, 1248, DOOR_Y) && locAt(RIGHT, 1249, DOOR_Y), "both closed leaves restored");
    assert.deepEqual(messages, []);
  });
}

test("leaving through the door is never stopped, even below 45 Farming", (t) => {
  settle();
  const { player } = actor(t, 1, 1249, DOOR_Y);
  click(player, RIGHT, 1249);
  assert.ok(until(() => at(player)[1] === OUTSIDE_Y, 6), `the player steps out: ${at(player)}`);
  assert.ok(until(isShut, 4), "the door is back");
});

test("below 45 Farming the door stays shut and says why", (t) => {
  settle();
  const { player, messages } = actor(t, 44, 1249, OUTSIDE_Y);
  click(player, RIGHT, 1249);
  tick(4);
  assert.ok(isShut(), "the door never opened");
  assert.deepEqual(at(player), [1249, OUTSIDE_Y]);
  assert.deepEqual(messages, ["You need a Farming level of 45 to enter the Farming Guild."]);
});

test("a boost to 45 Farming is enough to enter", (t) => {
  settle();
  const { player, messages } = actor(t, 42, 1248, OUTSIDE_Y, 3);
  click(player, LEFT, 1248);
  assert.ok(until(() => at(player)[1] === DOOR_Y, 6), `the boosted player steps in: ${at(player)}`);
  assert.deepEqual(messages, []);
  settle();
});

test("a low-level player can't walk in through someone else's opening", (t) => {
  settle();
  const opener = actor(t, 60, 1249, OUTSIDE_Y).player;
  const { player: low, messages } = actor(t, 10, 1248, OUTSIDE_Y);
  click(opener, RIGHT, 1249);
  assert.ok(until(isOpen, 4), "the opener's click opens the door");
  low.getMovementQueue().addSteps(new core.Location(1248, DOOR_Y + 2, 0));
  const seen = [];
  for (let i = 0; i < 3; i++) { tick(); seen.push(at(low)[1]); }
  assert.ok(seen.every((y) => y < DOOR_Y), `the inviswall keeps the low-level player out: ${seen}`);
  settle();
  assert.ok(at(low)[1] < DOOR_Y, "and the shut door keeps them out after");
  assert.ok(at(opener)[1] >= DOOR_Y, "the opener is inside");
  assert.deepEqual(messages, []);
});
