// Run after `yarn build`: node --test tests/disguised-crabs.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const Crabs = require("../plugins/npcs/DisguisedCrabs.plugin");
const { start, track, wake, killed, watched, awake, crabSquares, dormantIds } = Crabs._test;

const core = PluginManager.getCoreApi();
const events = [];
const inCombat = new Set();
const routes = [];
const api = {
  core,
  getAreaManager: () => ({ inMulti: () => false }),
  emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.CombatFactory.inCombat = (mobile) => inCombat.has(mobile);
  core.PathFinder.calculateWalkRoute = (npc, x, y) => routes.push([x, y]);
  start(api);
});

beforeEach(() => {
  events.length = 0;
  routes.length = 0;
  inCombat.clear();
  watched.clear();
  awake.clear();
});

function createCrab(id, x, y) {
  let transform = -1;
  let hitpoints = CacheDefinitions.getNpc(id) ? 60 : 0;
  let maxOverride = -1;
  let location = new Location(x, y, 0);
  const spawn = new Location(x, y, 0);
  const crab = {
    log: [],
    attacked: [],
    moveTo: (to) => { location = to; },
    getId: () => (transform !== -1 ? transform : id),
    getRealId: () => id,
    setNpcTransformationId: (value) => { transform = value; },
    setMaxHitpoints: (value) => { maxOverride = value; },
    getMaxHitpoints: () => (maxOverride >= 0 ? maxOverride : core.NpcDefinition.forId(id).getHitpoints()),
    setHitpoints: (value) => { hitpoints = value; },
    getHitpoints: () => hitpoints,
    performAnimation: (animation) => crab.log.push(`anim ${animation.getId()}`),
    getCombat: () => ({ attack: (target) => crab.attacked.push(target) }),
    getLocation: () => location,
    getSpawnPosition: () => spawn,
    blocked: false,
    getMovementQueue: () => ({ size: () => 0, isMovings: () => false, reset() {}, setBlockMovement: (value) => { crab.blocked = value; } }),
    isRegistered: () => hitpoints > 0,
    getCurrentDefinition: () => core.NpcDefinition.forId(crab.getId()),
    setMobileInteraction() {},
  };
  return crab;
}

function createPlayer(x, y, { tolerant = false, npcs = [] } = {}) {
  const attributes = new Map();
  return {
    isPlayer: () => true,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getLocation: () => new Location(x, y, 0),
    getLocalNpcs: () => npcs,
    getAggressionTolerance: () => ({ finished: () => tolerant }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
}

const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };

test("the data: every pair as the cache names it", () => {
  const name = (id) => CacheDefinitions.getNpc(id).name;
  const disguises = { "Rock Crab": "Rocks", "Giant Rock Crab": "Boulder", "Sand Crab": "Sandy rocks", "Ammonite Crab": "Fossil Rock", "Swamp Crab": "Swampy log", "King Sand Crab": "Sandy Boulder" };
  for (const [dormant, { family, awakeId }] of dormantIds) {
    assert.equal(name(dormant), disguises[family.name], `${dormant}`);
    assert.equal(name(awakeId), family.name, `${awakeId}`);
  }
});

test("disguises don't wander: every one spawns with wanderRadius 0", () => {
  const spawns = JSON.parse(require("node:fs").readFileSync(path.resolve(__dirname, "../data/definitions/npc-spawns.json"), "utf8"));
  const roaming = spawns.filter((spawn) => dormantIds.has(spawn.id) && spawn.wanderRadius !== 0);
  assert.deepEqual(roaming, []);
});

test("crab squares come from the spawns, and players are watched only inside them", () => {
  assert.ok(crabSquares.has(`${1750 >> 6},${3470 >> 6},0`), "Hosidius' sandy rocks");
  const hosidius = createPlayer(1750, 3470);
  const lumbridge = createPlayer(3222, 3218);
  track({ player: hosidius });
  track({ player: lumbridge });
  assert.deepEqual([...watched], [hosidius]);
});

test("a sand crab wakes for an adjacent player: its crab form and hitpoints, the rise, then the attack", () => {
  const crab = createCrab(5936, 1751, 3471);
  const player = createPlayer(1750, 3470, { npcs: [crab] });
  track({ player });
  runTicks();
  assert.equal(crab.getId(), 5935, "diagonal counts as next to");
  assert.equal(crab.getHitpoints(), 60);
  assert.deepEqual(crab.log, ["anim 1316"]);
  assert.deepEqual(crab.attacked, [], "it rises first (1316 lasts 74 cycles)");
  assert.equal(crab.blocked, true, "and doesn't walk while rising");
  runTicks(3);
  assert.deepEqual(crab.attacked, [player]);
  assert.equal(crab.blocked, false);
});

test("every crab beside the player rises, not just the first", () => {
  const crabs = [createCrab(5936, 1750, 3471), createCrab(7207, 1751, 3470), createCrab(5936, 1749, 3469)];
  const player = createPlayer(1750, 3470, { npcs: crabs });
  track({ player });
  runTicks(4);
  assert.deepEqual(crabs.map((crab) => crab.getId()), [5935, 7206, 5935]);
  assert.ok(crabs.every((crab) => crab.attacked[0] === player));
});

test("it stays scenery for a player two tiles off, or one it has become tolerant of", () => {
  const crab = createCrab(5936, 1750, 3472);
  track({ player: createPlayer(1750, 3470, { npcs: [crab] }) });
  runTicks();
  assert.equal(crab.getId(), 5936);
  watched.clear();
  const near = createCrab(5936, 1750, 3471);
  track({ player: createPlayer(1750, 3470, { tolerant: true, npcs: [near] }) });
  runTicks();
  assert.equal(near.getId(), 5936, "crabs can only be fought while aggressive (Wiki)");
});

test("a giant rock crab wakes with the crab's hitpoints, not the boulder's", () => {
  const crab = createCrab(2262, 2700, 3700);
  wake(crab, createPlayer(2700, 3701));
  assert.equal(crab.getHitpoints(), core.NpcDefinition.forId(2261).getHitpoints());
  assert.ok(crab.getHitpoints() > core.NpcDefinition.forId(2262).getHitpoints());
});

test("out of combat it rests, walks home, sinks and is scenery again, healed", () => {
  const crab = createCrab(5936, 1750, 3471);
  wake(crab, createPlayer(1750, 3470));
  crab.setHitpoints(12);
  inCombat.add(crab);
  runTicks(30);
  assert.equal(crab.getId(), 5935, "never rests while fighting");
  inCombat.clear();
  crab.moveTo(new Location(1752, 3471, 0));
  runTicks(20);
  assert.deepEqual(routes.at(-1), [1750, 3471], "walks back to where it lay");
  crab.moveTo(new Location(1750, 3471, 0));
  crab.log.length = 0;
  runTicks();
  assert.deepEqual(crab.log, ["anim 1314"]);
  runTicks();
  assert.equal(crab.getId(), 5936);
  assert.equal(crab.getHitpoints(), crab.getMaxHitpoints());
  assert.equal(awake.size, 0);
});

test("diary tasks: a sand crab kill, and the fifth rock crab", () => {
  const player = createPlayer(1750, 3470);
  const sand = createCrab(5936, 1750, 3471);
  sand.setNpcTransformationId(5935);
  killed({ killer: player, npc: sand });
  const rock = createCrab(101, 2700, 3720);
  rock.setNpcTransformationId(100);
  for (let i = 0; i < 5; i++) killed({ killer: player, npc: rock });
  assert.deepEqual(events.map((event) => `${event.diary}:${event.task}`), ["kourend:kill-a-sandcrab", "fremennik:kill-5-rock-crabs"]);
});
