// Run after `yarn build`: node --test tests/crandor-secret-wall.test.cjs
//
// #2386 / PR 2414: Dragon Slayer's secret wall (dragonsecretdoor 2606 at 2836,9600, a wall on the south
// edge of 9600) swings open for the player who unlocked it and shuts two ticks later (RSProx 2951 ticks
// 85-89; the open leaf is 25039 at 2836,9599 and live puts the invisible blocker 38848 on the doorway).
// The Dragon Slayer stage check guards a click, but ordinary walking never calls it, so while the wall
// stands open a player without the shortcut must still be unable to walk or follow across it.
//
// Real engine, as west-ardougne-gate.test.cjs: PluginManager with every plugin loaded, real Players, the
// quest at its real stages through its own registration, every click through
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
const { FollowPlayerPacketListener } = require("../dist/net/packet/impl/FollowPlayerPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const WALL = 2606, OPEN_LEAF = 25039, X = 2836, WALL_Y = 9600;
const STAGE_LOCKED = 1, STAGE_CRANDOR = 9;

let core;
let next = 5200;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(X, WALL_Y);
  PluginManager.emitServerStartup({});
});

function actor(t, stage, x, y) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("crandor" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "dragon_slayer_i");
  assert.ok(quest, "Dragon Slayer I is registered");
  quest.setStage(player, stage);
  return { player, messages };
}

/**
 * One game tick in the server's order: movement, the walk-to that waits on arrival, then other tasks, then
 * the end-of-cycle reset (World.ts calls resetUpdating on every player). Without that reset a player moved
 * by moveTo, as a forced movement ends, keeps needsPlacement and cannot walk on: the queue reports
 * Mobility.INVALID until the next cycle clears it.
 */
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

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const isOpen = () => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === OPEN_LEAF && where.getX() === X && where.getY() === WALL_Y - 1) return true;
    }
  }
  return false;
};
const settle = () => tick(12);
const click = (player, id) => new ObjectActionPacketListener().executeAction(player, id, X, id === OPEN_LEAF ? WALL_Y - 1 : WALL_Y, 1);
const stand = (player, y) => player.setLocation(new core.Location(X, y, 0));
const walk = (player, ...ys) => ys.forEach((y) => player.getMovementQueue().addSteps(new core.Location(X, y, 0)));

test("eligible A crosses north through the wall; locked B's ordinary walk across the open doorway stays blocked", (t) => {
  const a = actor(t, STAGE_CRANDOR, X, 9598).player;
  const b = actor(t, STAGE_LOCKED, X, 9598).player;
  settle();
  click(a, WALL);
  assert.ok(until(isOpen), "A's click opens the wall");
  stand(b, 9599);
  walk(b, 9600, 9601);
  const seen = [];
  for (let i = 0; i < 2; i++) { tick(); seen.push(at(b)[1]); }
  assert.ok(seen.every((y) => y <= 9599), `B never gets across while it stands open: ${seen}`);
  assert.ok(until(() => at(a)[1] === 9600, 8), "A is carried across");
  assert.deepEqual(at(a), [X, 9600]);
  walk(a, 9601, 9602);
  tick(3);
  assert.deepEqual(at(a), [X, 9602], "the carried opener is not stuck: it walks on as captured");
  settle();
  assert.equal(isOpen(), false, "the wall shuts again");
  assert.ok(at(b)[1] <= 9599, "B stayed on the Karamja side");
});

test("eligible A crosses south through the wall; locked B's ordinary walk across the open doorway stays blocked", (t) => {
  const a = actor(t, STAGE_CRANDOR, X, 9601).player;
  const b = actor(t, STAGE_LOCKED, X, 9601).player;
  settle();
  click(a, WALL);
  assert.ok(until(isOpen), "A's click opens the wall");
  stand(b, 9600);
  walk(b, 9599, 9598);
  const seen = [];
  for (let i = 0; i < 2; i++) { tick(); seen.push(at(b)[1]); }
  assert.ok(seen.every((y) => y >= 9600), `B never gets across while it stands open: ${seen}`);
  assert.ok(until(() => at(a)[1] === 9599, 8), "A is carried across");
  assert.deepEqual(at(a), [X, 9599]);
  walk(a, 9598, 9597);
  tick(3);
  assert.deepEqual(at(a), [X, 9597], "the carried opener is not stuck: it walks on");
  settle();
  assert.equal(isOpen(), false, "the wall shuts again");
  assert.ok(at(b)[1] >= 9600, "B stayed on the Crandor side");
});

for (const [label, from, away] of [["south", 9599, 9598], ["north", 9600, 9601]]) {
  test(`locked B clicking the open leaf from the ${label} is not carried across someone else's opening`, (t) => {
    const a = actor(t, STAGE_CRANDOR, X, away).player;
    const b = actor(t, STAGE_LOCKED, X, away).player;
    settle();
    click(a, WALL);
    assert.ok(until(isOpen), "A's click opens the wall");
    stand(b, from);
    click(b, OPEN_LEAF);
    tick(4);
    assert.deepEqual(at(b), [X, from], "B did not move");
    assert.ok(b.getForceMovement() == null, "B was not carried");
    settle();
  });
}

// The maintainer named walking and following. Following is the client's Follow option: the real
// FollowPlayerPacketListener.follow sets the follow target and the movement queue then paths each tick.
// The leader is a third player C standing on the far side, not the opener: a leader who is moved by
// moveTo (the opener's carry ends that way) bumps its teleport serial and the follow is dropped
// (MovementQueue.processFollowing), so following the opener proves nothing. B follows C while A's click
// has the wall open; B's route to C crosses the doorway tile on the first tick, inside the two ticks the
// wall stands open. Without the invisible blocker 38848 B steps over and the assertion fails.
for (const [label, openerY, followerY, leaderY, blockedAt] of [
  ["north", 9598, 9599, 9603, (y) => y <= 9599],
  ["south", 9601, 9600, 9596, (y) => y >= 9600],
]) {
  test(`locked B following a player on the far side ${label} is not led through the open wall`, (t) => {
    const a = actor(t, STAGE_CRANDOR, X, openerY).player;
    const b = actor(t, STAGE_LOCKED, X, openerY).player;
    const c = actor(t, STAGE_LOCKED, X, leaderY).player;
    settle();
    click(a, WALL);
    assert.ok(until(isOpen), "A's click opens the wall");
    stand(b, followerY);
    FollowPlayerPacketListener.follow(b, c);
    assert.equal(b.getFollowing(), c, "B is following C");
    const seen = [];
    for (let i = 0; i < 2; i++) { tick(); seen.push(at(b)[1]); }
    assert.ok(seen.every(blockedAt), `B's follow never takes it over the blocker: ${seen}`);
    settle();
    assert.equal(isOpen(), false, "the wall shuts again");
    for (let i = 0; i < 6; i++) tick();
    assert.ok(blockedAt(at(b)[1]), "and B, still following, stays on its own side");
    b.setFollowing(null);
  });
}
