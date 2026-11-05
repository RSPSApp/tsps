// Run after `yarn build`: node --test tests/troll-gates.test.cjs
//
// The Troll Stronghold prison door needs the prison key, and the arena's north exit needs Dad beaten.
// Those checks guard a click, and ordinary walking never calls them, so while another player's opening
// stands a locked player must still be unable to walk or follow across it, or get carried by clicking
// the open leaf. Prison door: RSProx 740 ticks 1470-1473 (rev 233.1) puts inviswall 38848 on the doorway
// with the open leaf. Arena exit: no capture, so its blockers are inferred from the door and Crandor.
//
// Native fixture, in the shape of crandor-secret-wall.test.cjs: every plugin loaded, real Players, the
// quest at real stages, clicks through ObjectActionPacketListener.executeAction, real map clipping, and
// the movement queue and tick tasks running. No client ran.
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

const PRISON_DOOR_ATTRIBUTE = "troll-stronghold:prison-door-unlocked";
const STAGE_NOT_BEATEN_DAD = 1;
const STAGE_BEATEN_DAD = 20;

/** `along` maps a position on the crossing axis to a tile; `low` and `high` are the tiles either side. */
const GATES = [
  {
    label: "prison door", closed: 3780, open: 3781, z: 1, door: [2848, 10107], leaf: [2847, 10107],
    along: (v) => [v, 10107], low: 2847, high: 2848,
    eligible: (player) => { quest().setStage(player, STAGE_BEATEN_DAD); player.setAttribute(PRISON_DOOR_ATTRIBUTE, true); },
    locked: (player) => quest().setStage(player, STAGE_BEATEN_DAD),
  },
  {
    label: "arena exit", closed: 3785, open: 3787, z: 0, door: [2916, 3629], leaf: [2916, 3628],
    along: (v) => [2916, v], low: 3628, high: 3629,
    eligible: (player) => quest().setStage(player, STAGE_BEATEN_DAD),
    locked: (player) => quest().setStage(player, STAGE_NOT_BEATEN_DAD),
  },
];

let core;
let next = 5400;
const players = [];
const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "troll_stronghold");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const gate of GATES) core.RegionManager.loadMapFiles(...gate.door);
  PluginManager.emitServerStartup({});
});

function actor(t, gate, prepare, position) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("trollgate" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(...gate.along(position), gate.z));
  player.needsPlacement = false;
  players.push(player);
  t.after(() => players.splice(players.indexOf(player), 1));
  assert.ok(quest(), "Troll Stronghold is registered");
  prepare(player);
  return player;
}

/** One game tick in the server's order, ending with the end-of-cycle reset (see crandor-secret-wall). */
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

function isOpen(gate) {
  const list = core.MapObjects.mapObjects.get(core.MapObjects.getHash(gate.leaf[0], gate.leaf[1], gate.z)) ?? [];
  return list.some((object) => object.getId() === gate.open);
}

const settle = () => tick(12);
const click = (player, gate, id, [x, y]) => new ObjectActionPacketListener().executeAction(player, id, x, y, 1);
const clickClosed = (player, gate) => click(player, gate, gate.closed, gate.door);
const position = (gate, player) => (gate.along(0)[0] === 0 ? player.getLocation().getX() : player.getLocation().getY());
const stand = (gate, player, v) => player.setLocation(new core.Location(...gate.along(v), gate.z));
const walk = (gate, player, ...vs) => vs.forEach((v) => player.getMovementQueue().addSteps(new core.Location(...gate.along(v), gate.z)));

/** Each direction: A's start and arrival, B's side, and a further tile each way. */
const directions = (gate) => [
  { name: "from the low side", from: gate.low, to: gate.high, beyond: gate.high + 1, staysOut: (v) => v <= gate.low },
  { name: "from the high side", from: gate.high, to: gate.low, beyond: gate.low - 1, staysOut: (v) => v >= gate.high },
];

test("what the cache says about the leaves and the blocker", () => {
  for (const id of [3780, 3781, 3785, 3786, 3787, 38848]) {
    const definition = core.CacheDefinitions.getObject(id);
    console.log(`TROLL_GATE_CACHE ${id} name=${JSON.stringify(definition?.name)} actions=${JSON.stringify(definition?.actions)}`);
    assert.ok(definition, `the cache has loc ${id}`);
  }
  assert.ok((core.CacheDefinitions.getObject(38848).actions ?? []).every((action) => !action), "the blocker has no options");
});

for (const gate of GATES) {
  test(`${gate.label}: a locked player's click doesn't open it`, (t) => {
    const b = actor(t, gate, gate.locked, gate.low);
    settle();
    clickClosed(b, gate);
    tick(4);
    assert.equal(isOpen(gate), false, "still shut");
    assert.ok(position(gate, b) <= gate.low, "and the player stays on their side");
    b.getCombat().reset();
    settle();
  });

  for (const way of directions(gate)) {
    test(`${gate.label} ${way.name}: the eligible opener crosses and walks on; a locked walk across stays blocked`, (t) => {
      const a = actor(t, gate, gate.eligible, way.from);
      const b = actor(t, gate, gate.locked, way.from);
      settle();
      clickClosed(a, gate);
      assert.ok(until(() => isOpen(gate)), "A's click opens it");
      walk(gate, b, way.to, way.beyond);
      const seen = [];
      for (let i = 0; i < 2; i++) { tick(); seen.push(position(gate, b)); }
      assert.ok(seen.every(way.staysOut), `B never gets across while it stands open: ${seen}`);
      assert.ok(until(() => position(gate, a) === way.to, 8), "A crosses");
      walk(gate, a, way.beyond);
      tick(3);
      assert.equal(position(gate, a), way.beyond, "the opener isn't stuck: it walks on");
      settle();
      assert.equal(isOpen(gate), false, "it shuts again");
      assert.ok(way.staysOut(position(gate, b)), "B stayed on its own side");
    });

    test(`${gate.label} ${way.name}: a locked player clicking the open leaf isn't carried across`, (t) => {
      const a = actor(t, gate, gate.eligible, way.from);
      const b = actor(t, gate, gate.locked, way.from);
      settle();
      clickClosed(a, gate);
      assert.ok(until(() => isOpen(gate)), "A's click opens it");
      click(b, gate, gate.open, gate.leaf);
      tick(4);
      assert.ok(way.staysOut(position(gate, b)), "B stays on its own side");
      assert.ok(b.getForceMovement() == null, "B was not carried");
      settle();
    });

    test(`${gate.label} ${way.name}: a locked player following someone on the far side isn't led through`, (t) => {
      const a = actor(t, gate, gate.eligible, way.from);
      const b = actor(t, gate, gate.locked, way.from);
      const c = actor(t, gate, gate.locked, way.beyond + (way.beyond - way.to) * 2);
      settle();
      clickClosed(a, gate);
      assert.ok(until(() => isOpen(gate)), "A's click opens it");
      FollowPlayerPacketListener.follow(b, c);
      assert.equal(b.getFollowing(), c, "B is following C");
      const seen = [];
      for (let i = 0; i < 2; i++) { tick(); seen.push(position(gate, b)); }
      assert.ok(seen.every(way.staysOut), `B's follow never takes it across: ${seen}`);
      settle();
      assert.equal(isOpen(gate), false, "it shuts again");
      tick(6);
      assert.ok(way.staysOut(position(gate, b)), "and B, still following, stays on its side");
      b.setFollowing(null);
    });
  }
}
