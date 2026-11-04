// Run after `yarn build`: node --test tests/west-ardougne-gate.test.cjs
//
// #2292: the West Ardougne wall gate. Real engine: PluginManager with every plugin loaded, real
// Players, the two quests set to their completed stages through their own registrations, and every
// click sent the way the client's does, through ObjectActionPacketListener.executeAction, so the
// object route (including each door's reach mask), the movement queue, the plugin hooks and the
// tick tasks all run.
//
// EVIDENCE. The active map's terrain sets the blocked-tile flag (RegionManager BLOCKED_TILE,
// 0x200000, tile attribute bit 1 read at RegionManager.ts:918-923) on all four gate tiles, closed
// or open, so no loc swap can ever make them walkable and the queue refuses to step onto them. The
// gate is therefore crossed like the other PASS_THROUGH_GATES: the leaves swing open and the player
// is carried across by a forced movement, then the leaves close.
// NOT CAPTURED. The RSProx archive has no capture of this gate (object search by 8738-8741 finds
// nothing), so the crossing itself (forced walk of 3 tiles, timing) and the open leaves' faces are
// INFERRED. Closed, the map places four type-10 leaves, 8739@(2557,3299) f2, 8738@(2558,3299) f0,
// 8738@(2557,3300) f2, 8739@(2558,3300) f0; the cache gives each its open form (8738 -> 8740, 8739
// -> 8741) as a wall (shape 0), and each is taken to fold back against its own row, the south row
// to the south edge (face 3) and the north row to the north edge (face 1).
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
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const BLOCKED_TILE = 0x200000;
const CLOSED = [
  [8739, 2557, 3299, 2, 10],
  [8738, 2558, 3299, 0, 10],
  [8738, 2557, 3300, 2, 10],
  [8739, 2558, 3300, 0, 10],
];
const OPENED = [
  [8741, 2557, 3299, 3, 0],
  [8740, 2558, 3299, 3, 0],
  [8740, 2557, 3300, 1, 0],
  [8741, 2558, 3300, 1, 0],
];
// A leaf is clicked from the tile outside its own column, on its own row: the west pair from x 2556,
// the east pair from x 2559. (A far leaf is not reachable by a click: the tile between is blocked.)
const NEAR_WEST = [CLOSED[0], CLOSED[2]];
const NEAR_EAST = [CLOSED[1], CLOSED[3]];

let core;
let next = 4300;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init(); // without it every loc definition is undefined and no click is routed
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2557, 3299);
  // The server's startup hooks register the doors' reach masks (Doors.plugin routeWallDoor); without
  // them a click is routed as if no door had a mask.
  PluginManager.emitServerStartup({});
});

/** Every loc the active map places around the gate, as [id, x, y, z, type, face, name]. */
function placedAroundGate() {
  const found = [];
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const at = object.getLocation();
      if (at.getX() < 2545 || at.getX() > 2570 || at.getY() < 3290 || at.getY() > 3312) continue;
      found.push([object.getId(), at.getX(), at.getY(), at.getZ(), object.getType(), object.getFace(), object.getDefinition()?.getName?.()]);
    }
  }
  return found;
}

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("wardougne" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2559, 3299, 0));
  player.needsPlacement = false;
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function quest(key) {
  const found = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
  assert.ok(found, `${key} is registered`);
  return found;
}

function complete(player, ...keys) {
  for (const key of keys) {
    const entry = quest(key);
    entry.setStage(player, entry.completionValue);
    assert.equal(entry.isComplete(player), true, `${key} is complete`);
  }
}

function leaves() {
  return placedAroundGate()
    .filter((row) => /Ardougne Wall Door/.test(String(row[6])))
    .map(([id, x, y, , type, face]) => [id, x, y, face, type]);
}

const sortLeaves = (rows) => [...rows].sort((a, b) => a[1] - b[1] || a[2] - b[2]);
const isOpen = () => leaves().some((leaf) => leaf[4] === 0);

/**
 * One game tick, in the server's order: every player's movement, then the interaction that waits for
 * the player to arrive (a walk-to task, ticked from the player's own turn), then the other tasks
 * (carries, the gate closing).
 */
function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
  }
}

/** Ticks until the condition holds, at most `limit` times; returns whether it did. */
function until(condition, limit = 12) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
}

/** Lets any crossing finish and any open gate shut, so a test starts from the map's closed gate. */
function settle() {
  tick(12);
}

function standAt(player, x, y) {
  player.setLocation(new core.Location(x, y, 0));
}

function at(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY()];
}

/** The click the client sends: option 1 on the loc, routed, walked to and then run. */
function clickLeaf(player, [id, x, y]) {
  new ObjectActionPacketListener().executeAction(player, id, x, y, 1);
}

const attributesOf = (player) => JSON.stringify(PlayerSave.fromPlayer(player).attributes);

test("the map places the four closed leaves the tests rely on", () => {
  settle();
  assert.deepEqual(sortLeaves(leaves()), sortLeaves(CLOSED));
});

test("before Biohazard is complete the gate stays shut, nobody is moved, and the player is told why", (t) => {
  const { player, messages } = actor(t);
  complete(player, "plague_city");
  settle();
  standAt(player, 2556, 3299);
  clickLeaf(player, NEAR_WEST[0]);
  tick(6);
  assert.match(messages.join("\n"), /will not let you into West Ardougne/);
  assert.deepEqual(sortLeaves(leaves()), sortLeaves(CLOSED), "no leaf moved");
  assert.deepEqual(at(player), [2556, 3299], "the player stayed put");
  assert.ok(player.getForceMovement() == null);
});

test("a player who has done neither quest cannot open the gate either", (t) => {
  const { player, messages } = actor(t);
  settle();
  standAt(player, 2559, 3300);
  clickLeaf(player, NEAR_EAST[1]);
  tick(6);
  assert.match(messages.join("\n"), /will not let you into West Ardougne/);
  assert.deepEqual(sortLeaves(leaves()), sortLeaves(CLOSED));
  assert.deepEqual(at(player), [2559, 3300]);
});

test("the four gate tiles carry the map's blocked-tile flag, closed and open (why the gate must be crossed, not walked)", (t) => {
  const { player } = actor(t);
  complete(player, "plague_city", "biohazard");
  settle();
  const flags = () => [3299, 3300].flatMap((y) => [2557, 2558].map((x) => core.RegionManager.getClipping(x, y, 0, null)));
  assert.ok(flags().every((flag) => (flag & BLOCKED_TILE) !== 0), `closed: ${flags()}`);
  standAt(player, 2556, 3299);
  clickLeaf(player, NEAR_WEST[0]);
  assert.ok(until(isOpen), "the gate opens");
  assert.ok(flags().every((flag) => (flag & BLOCKED_TILE) !== 0), `open: ${flags()}`);
  settle();
});

for (const [side, startX, endX, group] of [["west", 2556, 2559, NEAR_WEST], ["east", 2559, 2556, NEAR_EAST]]) {
  for (const leaf of group) {
    test(`clicking the closed leaf ${leaf[0]}@${leaf[1]},${leaf[2]} from the ${side}: the gate opens, the player is carried across, the gate closes`, (t) => {
      const { player } = actor(t);
      complete(player, "plague_city", "biohazard");
      settle();
      const y = leaf[2];
      standAt(player, startX, y);
      clickLeaf(player, leaf);
      assert.ok(until(isOpen), "the click opens the gate");
      assert.deepEqual(sortLeaves(leaves()), sortLeaves(OPENED), "all four leaves swing open as walls");
      tick(4);
      assert.deepEqual(at(player), [endX, y], "the player ends on the far side of the same row");
      assert.ok(player.getForceMovement() == null, "the crossing is over");
      assert.ok(until(() => !isOpen()), "the gate shuts again");
      assert.deepEqual(sortLeaves(leaves()), sortLeaves(CLOSED));
    });
  }
}

test("a second player can cross while the gate stands open, by clicking an open leaf", (t) => {
  const first = actor(t).player;
  const second = actor(t).player;
  complete(first, "plague_city", "biohazard");
  complete(second, "plague_city", "biohazard");
  settle();
  standAt(first, 2556, 3299);
  clickLeaf(first, NEAR_WEST[0]);
  assert.ok(until(isOpen), "the first click opens the gate");
  standAt(second, 2559, 3299);
  clickLeaf(second, OPENED[1]);
  assert.ok(until(() => at(second)[0] === 2556, 8), "the open leaf takes the click and carries the second player");
  assert.deepEqual(at(second), [2556, 3299]);
  settle();
  assert.deepEqual(at(first), [2559, 3299]);
  assert.deepEqual(sortLeaves(leaves()), sortLeaves(CLOSED));
});

// Each open leaf, clicked from its own side of the gate by a second player while the gate stands open.
// The player must be carried from where they stood: they are watched every tick for any step off
// their tile (a detour the route would take if the leaf's reach mask kept them from the flank).
for (const [side, startX, endX, group] of [["west", 2556, 2559, [OPENED[0], OPENED[2]]], ["east", 2559, 2556, [OPENED[1], OPENED[3]]]]) {
  for (const leaf of group) {
    test(`clicking the open leaf ${leaf[0]}@${leaf[1]},${leaf[2]} from the ${side} carries the player straight across`, (t) => {
      const opener = actor(t).player;
      const rider = actor(t).player;
      complete(opener, "plague_city", "biohazard");
      complete(rider, "plague_city", "biohazard");
      settle();
      const y = leaf[2];
      standAt(opener, startX === 2556 ? 2559 : 2556, y);
      clickLeaf(opener, startX === 2556 ? NEAR_EAST[y === 3299 ? 0 : 1] : NEAR_WEST[y === 3299 ? 0 : 1]);
      assert.ok(until(isOpen), "the opener opens the gate");
      standAt(rider, startX, y);
      clickLeaf(rider, leaf);
      const seen = [];
      for (let i = 0; i < 8 && at(rider)[0] !== endX; i++) {
        tick();
        seen.push(at(rider).join(","));
      }
      assert.deepEqual(at(rider), [endX, y], `carried across: ${seen}`);
      assert.ok(seen.every((tile) => tile === `${startX},${y}` || tile === `${endX},${y}`), `no detour: ${seen}`);
      settle();
    });
  }
}

test("a player who has not finished Biohazard cannot ride a gate someone else opened", (t) => {
  const finished = actor(t).player;
  const unfinished = actor(t);
  complete(finished, "plague_city", "biohazard");
  complete(unfinished.player, "plague_city");
  settle();
  standAt(finished, 2556, 3299);
  clickLeaf(finished, NEAR_WEST[0]);
  assert.ok(until(isOpen), "the gate is open");
  standAt(unfinished.player, 2559, 3299);
  clickLeaf(unfinished.player, OPENED[1]);
  tick(4);
  assert.match(unfinished.messages.join("\n"), /will not let you into West Ardougne/);
  assert.deepEqual(at(unfinished.player), [2559, 3299], "they stayed on their side");
  settle();
});

test("cancelling mid-crossing leaves the player where they were, the gate shuts, and nothing is credited", (t) => {
  const { player } = actor(t);
  complete(player, "plague_city", "biohazard");
  settle();
  standAt(player, 2556, 3299);
  const before = attributesOf(player);
  clickLeaf(player, NEAR_WEST[0]);
  assert.ok(until(isOpen), "the gate opens");
  tick(1);
  core.TaskManager.cancelTasks(player);
  assert.ok(player.getForceMovement() == null, "the forced movement is cleared with the task");
  tick(12);
  assert.deepEqual(at(player), [2556, 3299], "the player was never half-moved");
  assert.deepEqual(sortLeaves(leaves()), sortLeaves(CLOSED), "the gate shut on its own timer");
  assert.equal(attributesOf(player), before, "no quest, XP or other saved state changed");
});

test("a completed crossing changes no saved state either", (t) => {
  const { player } = actor(t);
  complete(player, "plague_city", "biohazard");
  settle();
  standAt(player, 2559, 3299);
  const before = attributesOf(player);
  clickLeaf(player, NEAR_EAST[0]);
  assert.ok(until(() => at(player)[0] === 2556, 12), "the player is carried across");
  settle();
  assert.deepEqual(at(player), [2556, 3299]);
  assert.equal(attributesOf(player), before);
});
