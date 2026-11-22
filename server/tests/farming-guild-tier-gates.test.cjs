// Run after `npx tsc --build`: node --test tests/farming-guild-tier-gates.test.cjs
//
// #6538: the Farming Guild's intermediate (west wing) and advanced (north wing) tiers could be walked into at any
// Farming level. Wiki (Farming Guild): 65 for the west wing, 85 for the north wing, "a boost can be used to enter", and
// dropping below the level once inside expels nobody. The cache holds both gates open (leaves 34471/34472 at
// 1243,3729-3730 and 34475/34476 at 1248-1249,3745), so the barrier is the TierGates Area vetoing the step across.
//
// Real engine, as farming-guild-door.test.cjs: every plugin loaded, real Players, the movement queue, the area
// manager and tick tasks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");

const WEST = { inside: [1242, 3729], front: [1244, 3729], beyond: [1238, 3729], level: 65 };
const NORTH = { inside: [1248, 3746], front: [1248, 3744], beyond: [1248, 3750], level: 85 };

let core;
let next = 5900;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[1216, 3712], [1248, 3712], [1216, 3744], [1248, 3744]]) core.RegionManager.loadMapFiles(x, y);
  PluginManager.emitServerStartup({});
});

function actor(t, farming, [x, y], boost = 0) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("tiergate" + player.getIndex());
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
  AreaManager.process(player);
  return { player, messages };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
      AreaManager.process(player);
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const walk = (player, [x, y]) => player.getMovementQueue().addSteps(new core.Location(x, y, 0));
const refusal = (gate, name) => `You need a Farming level of ${gate.level} to enter the ${name} of the Farming Guild.`;

for (const [label, gate, name] of [["west wing", WEST, "intermediate tier"], ["north wing", NORTH, "advanced tier"]]) {
  test(`${label}: one level short, the gate holds and says why`, (t) => {
    const { player, messages } = actor(t, gate.level - 1, gate.front);
    walk(player, gate.beyond);
    tick(8);
    assert.deepEqual(at(player), gate.front, "the player never crossed");
    assert.deepEqual(messages, [refusal(gate, name)], "one refusal, not one per tick");
  });

  test(`${label}: the required level walks through`, (t) => {
    const { player, messages } = actor(t, gate.level, gate.front);
    walk(player, gate.beyond);
    tick(10);
    assert.deepEqual(at(player), gate.beyond);
    assert.deepEqual(messages, []);
  });

  test(`${label}: a boost to the required level is enough`, (t) => {
    const { player, messages } = actor(t, gate.level - 4, gate.front, 4);
    walk(player, gate.beyond);
    tick(10);
    assert.deepEqual(at(player), gate.beyond);
    assert.deepEqual(messages, []);
  });

  test(`${label}: running does not carry a low-level player across`, (t) => {
    const { player } = actor(t, 1, gate.front);
    player.getMovementQueue().setRunToggled?.(true);
    walk(player, gate.beyond);
    tick(8);
    assert.deepEqual(at(player), gate.front);
  });

  test(`${label}: leaving is never stopped, even far below the level`, (t) => {
    const { player, messages } = actor(t, 1, gate.inside);
    walk(player, gate.front);
    tick(8);
    assert.deepEqual(at(player), gate.front);
    assert.deepEqual(messages, []);
  });
}

test("a player well short of every tier is still free to walk the rest of the guild", (t) => {
  const { player, messages } = actor(t, 45, [1249, 3733]);
  walk(player, [1249, 3739]);
  tick(8);
  assert.deepEqual(at(player), [1249, 3739]);
  assert.deepEqual(messages, []);
});
