// Run after `yarn build`: node --test tests/nechryael.test.cjs
// Nechryael summon death spawns (plugins/npcs/Nechryael.plugin.js, docs/nechryael.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Nechryael = require("../plugins/npcs/Nechryael.plugin");

const core = PluginManager.getCoreApi();
const { _test } = Nechryael;
/** Slayer Tower, top floor: the nechryael room of rsprox recording 90. */
const ROOM = { x: 3446, y: 3562, z: 2 };

const providers = [];
const removed = [];
const spawned = [];
const rollHooks = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  Nechryael.register({
    core,
    registerNpcCombatMethodProvider: (ids, Method) => providers.push({ ids, Method }),
    onCombatHitRoll: (hook) => rollHooks.push(hook),
    spawnNpc: ({ id, x, y, z }) => {
      const npc = core.NPC.create(id, new core.Location(x, y, z));
      npc.isRegistered = () => !removed.includes(npc);
      npc.setNeedsPlacement(false);
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => removed.push(npc),
  });
});

function scene(t, { nechryaelId = core.NpcIdentifiers.NECHRYAEL } = {}) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => tasks.push(task));
  t.mock.method(core.World, "getNpcsNear", () => []);
  t.mock.method(core.RegionManager, "blocked", () => false);
  t.mock.method(core.RegionManager, "canMove", () => true);
  spawned.length = 0;
  removed.length = 0;

  const sounds = [];
  const graphics = [];
  const player = new Player(null);
  player.setUsername("nechryael");
  const sender = new Proxy({
    sendSound: (id) => { sounds.push(id); return sender; },
    sendGlobalGraphic: (graphic, tile) => { graphics.push({ id: graphic.getId(), height: graphic.getHeight(), tile }); return sender; },
  }, { get: (object, key) => object[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.setLocation(new core.Location(ROOM.x, ROOM.y, ROOM.z));
  player.setRegistered(true);
  player.setNeedsPlacement(false);

  const nechryael = core.NPC.create(nechryaelId, new core.Location(ROOM.x + 1, ROOM.y, ROOM.z));
  nechryael.isRegistered = () => true;
  nechryael.setNeedsPlacement(false);
  const animations = [];
  t.mock.method(nechryael, "performAnimation", (animation) => animations.push(animation.getId()));
  const method = new (providers[0].Method)();
  return { player, nechryael, method, animations, sounds, graphics, tasks, advance: (ticks) => { cycle += ticks; } };
}

/** Every roll lands on the summon. */
const summonRolls = (t) => t.mock.method(Math, "random", () => 0);

test("nechryael and greater nechryael get the summoning combat method", () => {
  const { NECHRYAEL, NECHRYAEL_2, GREATER_NECHRYAEL, GREATER_NECHRYAEL_2 } = core.NpcIdentifiers;
  assert.deepEqual(providers.map((entry) => entry.ids), [[NECHRYAEL, NECHRYAEL_2, GREATER_NECHRYAEL, GREATER_NECHRYAEL_2]]);
  assert.deepEqual([NECHRYAEL, NECHRYAEL_2, GREATER_NECHRYAEL, GREATER_NECHRYAEL_2], [8, 11, 7278, 11240]);
});

test("a summon replaces the attack: demons_bringdead, sound 2418, a portal and a death spawn beside the player", (t) => {
  summonRolls(t);
  const s = scene(t);
  s.method.start(s.nechryael, s.player);
  assert.deepEqual(s.animations, [1529], "demons_bringdead, not the attack");
  assert.deepEqual(s.method.hits(s.nechryael, s.player), [], "the summon deals no hit");
  assert.deepEqual(s.sounds, [2418]);

  assert.equal(spawned.length, 1);
  const [spawn] = spawned;
  assert.equal(spawn.getId(), core.NpcIdentifiers.DEATH_SPAWN);
  const at = spawn.getLocation();
  assert.equal(Math.max(Math.abs(at.getX() - ROOM.x), Math.abs(at.getY() - ROOM.y)), 1, "on a tile beside the player");
  assert.equal(at.getZ(), ROOM.z);
  assert.deepEqual(s.graphics.map(({ id, height }) => [id, height]), [[333, 92]], "demon_spawn_portal");
  assert.ok(s.graphics[0].tile.equals(at), "the portal is on the spawn's tile");
  assert.equal(spawn.getCombat().getTarget(), null, "it waits for the world to add it");
  s.advance(1);
  assert.ok(_test.tickDeathSpawn(spawn));
  assert.equal(spawn.getCombat().getTarget(), s.player, "then attacks the player");
  assert.ok(spawn.isMultiCombat(), "it joins the single-way fight");
  assert.ok(spawn.hasFlag(core.CombatFactory.BYSTANDER_FLAG));
  assert.equal(s.tasks.length, 1, "its lifetime task");
});

test("each nechryael keeps at most two death spawns alive", (t) => {
  summonRolls(t);
  const s = scene(t);
  for (let attack = 0; attack < 4; attack++) s.method.start(s.nechryael, s.player);
  assert.equal(spawned.length, 2);
  assert.deepEqual(s.animations.slice(0, 2), [1529, 1529]);
  assert.equal(s.animations[2], s.nechryael.getAttackAnim(s.player), "the third attack is an ordinary hit");
  assert.equal(s.method.hits(s.nechryael, s.player).length, 1);

  spawned[0].setHitpoints(0);
  s.method.start(s.nechryael, s.player);
  assert.equal(spawned.length, 3, "a dead spawn frees a place");
});

test("an attack summons only on its roll, and only against a player", (t) => {
  t.mock.method(Math, "random", () => 0.99);
  const s = scene(t);
  s.method.start(s.nechryael, s.player);
  assert.equal(spawned.length, 0);
  assert.equal(s.method.hits(s.nechryael, s.player).length, 1);
  t.mock.restoreAll();
  summonRolls(t);
  const other = scene(t);
  const npcTarget = core.NPC.create(core.NpcIdentifiers.DEATH_SPAWN, new core.Location(ROOM.x - 1, ROOM.y, ROOM.z));
  other.method.start(other.nechryael, npcTarget);
  assert.equal(spawned.length, 0);
});

test("with no open tile beside the player, the nechryael just attacks", (t) => {
  summonRolls(t);
  const s = scene(t);
  t.mock.method(core.RegionManager, "blocked", () => true);
  s.method.start(s.nechryael, s.player);
  assert.equal(spawned.length, 0);
  assert.equal(s.method.hits(s.nechryael, s.player).length, 1);
});

test("a tile beside the player behind a wall is never used", (t) => {
  summonRolls(t);
  const s = scene(t);
  // Only the tile to the east is a step from the player.
  t.mock.method(core.RegionManager, "canMove", (sx, sy, ex, ey) => ex === sx + 1 && ey === sy);
  s.method.start(s.nechryael, s.player);
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].getLocation().equals(new core.Location(ROOM.x + 1, ROOM.y, ROOM.z)));
  t.mock.method(core.RegionManager, "canMove", () => false);
  s.method.start(s.nechryael, s.player);
  assert.equal(spawned.length, 1, "no reachable tile: an ordinary attack");
});

test("greater nechryael summon the same death spawns", (t) => {
  summonRolls(t);
  const s = scene(t, { nechryaelId: core.NpcIdentifiers.GREATER_NECHRYAEL });
  s.method.start(s.nechryael, s.player);
  assert.equal(spawned[0]?.getId(), core.NpcIdentifiers.DEATH_SPAWN);
});

test("a death spawn leaves 99 ticks after it appeared and lets go of a target 8 tiles away", (t) => {
  summonRolls(t);
  const s = scene(t);
  s.method.start(s.nechryael, s.player);
  const [spawn] = spawned;
  s.advance(1);
  assert.ok(_test.tickDeathSpawn(spawn), "it engages");
  s.player.setLocation(new core.Location(spawn.getLocation().getX() + 7, spawn.getLocation().getY(), ROOM.z));
  assert.ok(_test.tickDeathSpawn(spawn));
  assert.equal(spawn.getCombat().getTarget(), s.player, "7 tiles is still in reach");
  s.player.setLocation(new core.Location(spawn.getLocation().getX() + 8, spawn.getLocation().getY(), ROOM.z));
  _test.tickDeathSpawn(spawn);
  assert.equal(spawn.getCombat().getTarget(), null, "8 tiles away it stops");
  s.advance(97);
  assert.ok(_test.tickDeathSpawn(spawn));
  assert.deepEqual(removed, []);
  s.advance(1);
  assert.equal(_test.tickDeathSpawn(spawn), false);
  assert.deepEqual(removed, [spawn], "gone at 99 ticks");
});

test("death spawn hits go through protection prayers; the nechryael's don't", (t) => {
  summonRolls(t);
  const s = scene(t);
  s.method.start(s.nechryael, s.player);
  const roll = (attacker) => {
    const event = { attacker, target: s.player, combatType: core.CombatType.MELEE, forceAccurate: false, bypassProtectionPrayer: false };
    for (const hook of rollHooks) hook(event);
    return event.bypassProtectionPrayer;
  };
  assert.equal(roll(spawned[0]), true);
  assert.equal(roll(s.nechryael), false);
});

test("a bystander's hit neither ties the player up nor draws auto-retaliate (CombatFactory)", (t) => {
  summonRolls(t);
  const s = scene(t);
  s.method.start(s.nechryael, s.player);
  const [spawn] = spawned;
  const retaliations = t.mock.method(core.CombatFactory, "handleRetaliation", () => {});
  const land = (attacker) => {
    const hit = new core.PendingHit(attacker, s.player, core.CombatFactory.MELEE_COMBAT, { delay: 0, damage: 1, rollAccuracy: false });
    core.CombatFactory.executeHit(hit);
  };
  land(spawn);
  assert.equal(retaliations.mock.callCount(), 0);
  assert.equal(s.player.getCombat().ticksSinceAttacked(), Infinity, "no logout hold");
  land(s.nechryael);
  assert.equal(retaliations.mock.callCount(), 1, "an ordinary attacker still draws it");
  assert.equal(s.player.getCombat().ticksSinceAttacked(), 0);
});
