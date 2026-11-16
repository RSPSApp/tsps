// Run after `yarn build`: node --test tests/elder-chaos-druid.test.cjs
// Elder Chaos druids pull fleeing players beside them (plugins/npcs/ElderChaosDruid.plugin.js,
// docs/elder-chaos-druid.md; Wiki: Elder Chaos druid and its transcript).
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const DruidPlugin = require("../plugins/npcs/ElderChaosDruid.plugin");

const core = PluginManager.getCoreApi();
const { _test } = DruidPlugin;
/** A druid spawn at the Chaos Temple (Wiki location table). */
const TEMPLE = { x: 3239, y: 3613, z: 0 };
const listeners = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  DruidPlugin.register({
    core,
    registerNpcCombatMethodProvider() {},
    emitCustomEvent: (name, payload) => listeners.filter((entry) => entry.name === name).forEach((entry) => entry.handler(payload)),
  });
});

function scene(t, { lineOfSight = true } = {}) {
  let cycle = 5000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  t.mock.method(core.RegionManager, "blocked", () => false);
  t.mock.method(core.RegionManager, "canMove", () => true);
  t.mock.method(core.RegionManager, "canProjectileAttackTarget", () => lineOfSight);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => tasks.push(task));
  listeners.length = 0;
  _test.active.clear();

  const druid = core.NPC.create(core.NpcIdentifiers.ELDER_CHAOS_DRUID, new core.Location(TEMPLE.x, TEMPLE.y, TEMPLE.z));
  druid.isRegistered = () => true;
  druid.setNeedsPlacement(false);
  const said = [];
  t.mock.method(druid, "forceChat", (text) => { said.push(text); return druid; });
  const targeted = [];
  t.mock.method(druid.getCombat(), "attack", (target) => targeted.push(target));

  const runner = (name, { dx, dy, damage = 10, moving = true }) => {
    const player = new Player(null);
    player.setUsername(name);
    const sender = new Proxy({}, { get: () => () => sender });
    player.getPacketSender = () => sender;
    player.setLocation(new core.Location(TEMPLE.x + dx, TEMPLE.y + dy, TEMPLE.z));
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    t.mock.method(player.getMovementQueue(), "size", () => (moving ? 3 : 0));
    t.mock.method(player.getMovementQueue(), "handleRegionChange", () => {});
    if (damage > 0) druid.getCombat().addDamage(player, damage);
    return player;
  };
  _test.active.add(druid);
  return { druid, said, targeted, runner, tasks, advance: (ticks) => { cycle += ticks; } };
}

const at = (player) => [player.getLocation().getX() - TEMPLE.x, player.getLocation().getY() - TEMPLE.y];

test("a fleeing damager is teleported beside the druid, which says the Wiki's line", (t) => {
  const { druid, said, targeted, runner } = scene(t);
  const player = runner("runner", { dx: 0, dy: -12 });
  assert.equal(_test.processPulls(), true);
  assert.deepEqual(at(player), [0, -1], "the free tile beside the druid nearest the player");
  assert.deepEqual(said, ["You dare run from us!"]);
  assert.equal(druid.getCombat().getAttackDelay(), 4, "the pull takes the druid's attack turn");
  assert.deepEqual(targeted, [player], "a druid with no target fights the player it pulled");
});

test("the pull reaches 20 tiles and no further", (t) => {
  const { runner } = scene(t);
  const far = runner("far", { dx: 21, dy: 0 });
  _test.processPulls();
  assert.deepEqual(at(far), [21, 0]);
  const edge = runner("edge", { dx: 20, dy: 3 });
  _test.processPulls();
  assert.deepEqual(at(edge), [1, 0]);
});

test("a player attacking, standing still or already in melee distance is not pulled", (t) => {
  const { said, runner } = scene(t);
  const fighter = runner("fighter", { dx: 6, dy: 0 });
  fighter.getCombat().target = core.NPC.create(core.NpcIdentifiers.ELDER_CHAOS_DRUID_2, new core.Location(TEMPLE.x + 7, TEMPLE.y, TEMPLE.z));
  const still = runner("still", { dx: -5, dy: 0, moving: false });
  const beside = runner("beside", { dx: 0, dy: 1 });
  const bystander = runner("bystander", { dx: 3, dy: 3, damage: 0 });
  _test.processPulls();
  assert.deepEqual([fighter, still, beside, bystander].map(at), [[6, 0], [-5, 0], [0, 1], [3, 3]]);
  assert.deepEqual(said, []);
});

test("the fleeing player who did the most damage is pulled first, one per attack turn", (t) => {
  const { runner, advance } = scene(t);
  const light = runner("light", { dx: -8, dy: 0, damage: 5 });
  const heavy = runner("heavy", { dx: 8, dy: 0, damage: 40 });
  _test.processPulls();
  assert.deepEqual(at(heavy), [1, 0]);
  assert.deepEqual(at(light), [-8, 0]);
  advance(3);
  _test.processPulls();
  assert.deepEqual(at(light), [-8, 0], "the attack is still on cooldown");
  advance(1);
  _test.processPulls();
  assert.deepEqual(at(light), [-1, 0]);
});

test("no pull through a wall a spell can't cross, or with no free tile beside the druid", (t) => {
  const { runner } = scene(t, { lineOfSight: false });
  const hidden = runner("hidden", { dx: 0, dy: 9 });
  _test.processPulls();
  assert.deepEqual(at(hidden), [0, 9]);
  t.mock.method(core.RegionManager, "canProjectileAttackTarget", () => true);
  t.mock.method(core.RegionManager, "blocked", () => true);
  _test.processPulls();
  assert.deepEqual(at(hidden), [0, 9]);
});

test("a listener (a read teleport anchoring scroll) can block the pull", (t) => {
  const { druid, said, runner } = scene(t);
  const events = [];
  listeners.push({ name: _test.PULL_EVENT, handler: (event) => { events.push(event); event.blocked = true; } });
  const player = runner("anchored", { dx: 0, dy: -10 });
  _test.processPulls();
  assert.equal(events.length, 1);
  assert.equal(events[0].npc, druid);
  assert.equal(events[0].player, player);
  assert.deepEqual([events[0].destination.getX() - TEMPLE.x, events[0].destination.getY() - TEMPLE.y], [0, -1]);
  assert.deepEqual(at(player), [0, -10]);
  assert.deepEqual(said, []);
  assert.equal(druid.getCombat().getAttackDelay(), 0, "a blocked pull leaves the attack turn");
});

test("a dead or forgotten druid stops being processed", (t) => {
  const { druid } = scene(t);
  druid.getCombat().clearDamageMap();
  assert.equal(_test.processPulls(), false);
  assert.equal(_test.active.has(druid), false);
});

test("a druid's combat starts the pull task, which stops once the druid is idle", (t) => {
  const { druid, runner, tasks } = scene(t);
  _test.active.clear();
  const player = runner("tracked", { dx: 0, dy: -6 });
  new (_test.methodClass())().onCombatBegan(druid, player);
  assert.equal(tasks.length, 1);
  assert.equal(_test.active.has(druid), true);
  tasks[0].execute();
  assert.deepEqual(at(player), [0, -1]);
  druid.getCombat().clearDamageMap();
  t.mock.method(druid.getCombat(), "getTarget", () => null);
  tasks[0].execute();
  assert.equal(tasks[0].isRunning(), false);
  assert.equal(_test.active.has(druid), false);
});
