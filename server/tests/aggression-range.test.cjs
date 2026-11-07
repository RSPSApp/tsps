// Aggression ranges, measured from an NPC's static spawn footprint
// (Wiki Aggressiveness#Aggression range): max range + attack range. NPC locations are
// south-west corners, so the footprint extends `size - 1` tiles north and east only.
// A player outside it cannot be hunted, and a hunter dragged outside it loses interest and
// walks home instead of following the player across the map.
//
// Run after `yarn build`: node --test tests/aggression-range.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NpcAggression } = require("../dist/game/entity/impl/npc/NpcAggression");
const { CoordinateState } = require("../dist/game/entity/impl/npc/NPCMovementCoordinator");
const GodWarsCommon = require("../plugins/bosses/godwars/Common.GodWars");
const GodWarsCombat = require("../plugins/bosses/godwars/Combat.GodWars");
const ScurriusCommon = require("../plugins/bosses/scurrius/Common.Scurrius");
const ScurriusFight = require("../plugins/bosses/scurrius/Fight.Scurrius");
const ScurriusLair = require("../plugins/bosses/scurrius/Lair.Scurrius");
const core = PluginManager.getCoreApi();

const MUGGER = core.NpcIdentifiers.MUGGER_2;
const BLACK_DEMON = core.NpcIdentifiers.BLACK_DEMON;
/** Open ground, so only the actors decide the hunt. */
const FIELD = { x: 3220, y: 3220 };

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

function scene(t, {
  npcId = MUGGER,
  spawn = new core.Location(FIELD.x, FIELD.y + 2, 0),
  npcAt = spawn.clone(),
  playerAt = new core.Location(FIELD.x, FIELD.y, 0),
  providedNpc = null,
} = {}) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });

  const player = new Player(null);
  player.setUsername("aggression-range");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true, processPackets: () => {} });
  player.setLocation(playerAt.clone());
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.autoRetaliateReturn = () => false;
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setCurrentLevel(skill, 99);
    player.getSkillManager().setMaxLevel(skill, 99);
  }

  const spawnPosition = spawn.clone();
  const npc = providedNpc ?? core.NPC.create(npcId, npcAt.clone());
  npc.setSpawnPosition(spawnPosition.clone());
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  npc.setHitpoints(500);
  // The combat-level rule is not what this suite is about; every test hunts.
  npc.isAggressiveTo = () => true;

  function tick() {
    cycle++;
    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i];
      if (!(task.isRunning() && task.execute() !== false)) tasks.splice(i, 1);
    }
    npc.process();
    const combat = player.getCombat(), movement = player.getMovementQueue();
    combat.getHitQueue().process(cycle);
    player.getTimers().process();
    movement.beginCycle();
    if (combat.hasPendingWork()) combat.preMovementProcess();
    if (movement.hasPendingWork()) movement.process();
    if (combat.hasPendingWork()) combat.postMovementProcess();
  }
  const ticks = (count) => { for (let i = 0; i < count; i++) tick(); };
  const walkPlayer = (dx, dy) => {
    const queue = player.getMovementQueue();
    if (queue.size() === 0) queue.addSteps(player.getLocation().transform(dx, dy));
  };
  t.after(() => {
    core.World.unregisterNpcPosition(npc);
    core.World.unregisterPlayerPosition(player);
  });
  return { player, npc, spawn: spawnPosition, tick, ticks, walkPlayer };
}

test("the aggression range is max range + attack range, measured from the spawn footprint", () => {
  const definition = new core.NpcDefinition();
  assert.equal(definition.getAggressionRange(1), 8, "melee: 7 + 1");
  assert.equal(definition.getAggressionRange(6), 13, "ranged: 7 + 6");
  assert.equal(definition.getAggressionRange(10), 17, "magic: 7 + 10");
  Object.assign(definition, { size: 3 });
  assert.equal(definition.getAggressionRange(1), 8, "the size lives in the footprint, not the radius");
  Object.assign(definition, { combatFollowDistance: 9 });
  assert.equal(definition.getAggressionRange(1), 10, "a longer max range widens it by the same amount");
});

test("a size-3 footprint extends north and east only", () => {
  const origin = new core.Location(3200, 3200, 0);
  const at = (x, y) => new core.Location(x, y, 0);
  assert.equal(core.CombatRange.footprintDistance(origin, 3, at(3200, 3192)), 8, "south");
  assert.equal(core.CombatRange.footprintDistance(origin, 3, at(3192, 3200)), 8, "west");
  assert.equal(core.CombatRange.footprintDistance(origin, 3, at(3200, 3210)), 8, "north, measured from maxY 3202");
  assert.equal(core.CombatRange.footprintDistance(origin, 3, at(3210, 3200)), 8, "east, measured from maxX 3202");
  assert.equal(core.CombatRange.footprintDistance(origin, 3, at(3201, 3201)), 0, "inside the footprint");
  assert.equal(core.CombatRange.footprintDistance(origin, 3, new core.Location(3200, 3200, 1)),
    Number.MAX_SAFE_INTEGER, "another plane");
});

test("a size-3 NPC acquires at its south and north spawn-footprint boundaries", (t) => {
  const x = FIELD.x, y = FIELD.y;
  assert.equal(core.NpcDefinition.forId(BLACK_DEMON).getSize(), 3);

  const south = scene(t, {
    npcId: BLACK_DEMON,
    spawn: new core.Location(x, y, 0),
    npcAt: new core.Location(x, y - 7, 0),
    playerAt: new core.Location(x, y - 9, 0),
  });
  NpcAggression.runAggression(south.player, [south.npc]);
  assert.equal(south.npc.getCombat().getTarget(), null, "nine tiles south is outside the eight-tile limit");
  south.player.setLocation(new core.Location(x, y - 8, 0));
  NpcAggression.runAggression(south.player, [south.npc]);
  assert.equal(south.npc.getCombat().getTarget(), south.player, "eight tiles south is inside");

  const north = scene(t, {
    npcId: BLACK_DEMON,
    spawn: new core.Location(x, y, 0),
    npcAt: new core.Location(x, y + 8, 0),
    playerAt: new core.Location(x, y + 11, 0),
  });
  NpcAggression.runAggression(north.player, [north.npc]);
  assert.equal(north.npc.getCombat().getTarget(), null, "eleven tiles north is outside the footprint limit");
  north.player.setLocation(new core.Location(x, y + 10, 0));
  NpcAggression.runAggression(north.player, [north.npc]);
  assert.equal(north.npc.getCombat().getTarget(), north.player, "ten tiles north is inside");
});

test("a player outside the aggression range is not hunted, even right next to the NPC", (t) => {
  const s = scene(t);
  // Wandered (or was dragged) nine tiles from its spawn; the player is adjacent but outside
  // the 8-tile melee aggression range from the spawn.
  s.npc.setSpawnPosition(new core.Location(FIELD.x, FIELD.y - 9, 0));
  NpcAggression.runAggression(s.player, [s.npc]);
  assert.equal(s.npc.getCombat().getTarget(), null);
});

test("a player inside the aggression range is hunted", (t) => {
  const s = scene(t);
  NpcAggression.runAggression(s.player, [s.npc]);
  assert.equal(s.npc.getCombat().getTarget(), s.player);
});

test("a hunter loses interest outside the aggression range and walks home", (t) => {
  const s = scene(t);
  s.npc.getCombat().attack(s.player);
  let cycles = 0;
  // Walk north a tile a tick: the NPC follows at the same speed, so the fight never starts and
  // the only thing that can end the chase is the aggression range.
  while (s.npc.getCombat().getTarget() != null && cycles < 30) {
    s.walkPlayer(0, 1);
    s.tick();
    cycles++;
  }
  const fromSpawn = s.player.getLocation().getDistance(s.spawn);
  assert.ok(fromSpawn > 8, `the player was outside the range when it ended (${fromSpawn})`);
  assert.equal(s.npc.getCombat().getTarget(), null, "the NPC let go");
  assert.equal(s.npc.getMovementCoordinator().getCoordinateState(), CoordinateState.RETREATING,
    "and is walking back to its spawn");

  s.ticks(30);
  assert.equal(s.npc.getCombat().getTarget(), null);
  assert.ok(s.npc.getLocation().getDistance(s.spawn) < fromSpawn, "it moved home, not after the player");
});

test("an engaged ranged NPC does not retreat from a reachable player on another floor", (t) => {
  const previous = Object.fromEntries(["CROSS_FLOOR_VISIBILITY", "CROSS_FLOOR_COMBAT"].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.CROSS_FLOOR_VISIBILITY = "1";
  process.env.CROSS_FLOOR_COMBAT = "1";
  const s = scene(t, {
    spawn: new core.Location(FIELD.x, FIELD.y, 0),
    npcAt: new core.Location(FIELD.x, FIELD.y, 0),
    playerAt: new core.Location(FIELD.x + 2, FIELD.y, 1),
  });
  const combat = s.npc.getCombat();
  combat.attack(s.player);
  const ranged = { type: () => core.CombatType.RANGED, attackDistance: () => 2 };
  assert.equal(combat.shouldRetreat(ranged), false, "the enabled ranged fight stays inside the spawn-based leash");
  assert.equal(core.CombatRange.footprintDistance(s.spawn, 1, s.player.getLocation()), Number.MAX_SAFE_INTEGER,
    "same-plane callers retain the default cross-floor rejection");
  assert.equal(core.CombatRange.footprintDistance(s.spawn, 1, s.player.getLocation(), true), 2,
    "the ranged retreat check uses horizontal footprint distance");

  process.env.CROSS_FLOOR_COMBAT = "0";
  assert.equal(combat.shouldRetreat(ranged), true, "disabling cross-floor combat restores the old leash behavior");
  process.env.CROSS_FLOOR_COMBAT = "1";
  const melee = { type: () => core.CombatType.MELEE, attackDistance: () => 1 };
  assert.equal(combat.shouldRetreat(melee), true, "melee cannot use the cross-floor range exception");
});

test("combat:no-retreat keeps a scripted NPC on its target", (t) => {
  const s = scene(t);
  s.npc.setFlag("combat:no-retreat");
  s.npc.getCombat().attack(s.player);
  for (let i = 0; i < 20; i++) {
    s.walkPlayer(0, 1);
    s.tick();
  }
  assert.equal(s.npc.getCombat().getTarget(), s.player);
});

test("a public arena boss is claimed by its area and keeps the room-wide pursuit", (t) => {
  GodWarsCommon.init({ core });
  const faction = GodWarsCommon.factionByKey("saradomin");
  const s = scene(t, { npcId: core.NpcIdentifiers.COMMANDER_ZILYANA });
  // The boss's own hits are not this suite's subject; keep the player alive for the pursuit.
  s.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 100_000);
  // What Dungeon.GodWars does every tick for a player in the shared chamber.
  GodWarsCombat.engage(s.player, faction, [s.npc]);
  assert.equal(s.npc.hasFlag("combat:no-retreat"), true,
    "the chamber's boss joins the arena instead of the open-world leash");
  assert.equal(s.npc.getCombat().getTarget(), s.player);

  // A player crossing the room is beyond the 8-tile aggression range, but the arena owns the fight.
  for (let i = 0; i < 20; i++) {
    s.walkPlayer(0, 1);
    s.tick();
  }
  assert.ok(s.player.getLocation().getDistance(s.spawn) > 8, "the player left the aggression range");
  assert.equal(s.npc.getCombat().getTarget(), s.player, "the boss still pursues");
  assert.notEqual(s.npc.getMovementCoordinator().getCoordinateState(), CoordinateState.RETREATING,
    "and is not walking home to its spawn");
});

test("an ordinary God Wars follower keeps the open-world leash", (t) => {
  GodWarsCommon.init({ core });
  const faction = GodWarsCommon.factionByKey("saradomin");
  const s = scene(t, { npcId: core.NpcIdentifiers.KNIGHT_OF_SARADOMIN });
  s.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 100_000);
  // The dungeon's npcAggression rule makes followers attack on sight; only the general and
  // bodyguards are scripted arena NPCs.
  GodWarsCombat.engage(s.player, faction, [s.npc]);
  assert.equal(s.npc.hasFlag("combat:no-retreat"), false);
  s.npc.getCombat().attack(s.player);

  let cycles = 0;
  while (s.npc.getCombat().getTarget() != null && cycles < 30) {
    s.walkPlayer(0, 1);
    s.tick();
    cycles++;
  }
  assert.equal(s.npc.getCombat().getTarget(), null, "the follower still gives up the chase");
  assert.equal(s.npc.getMovementCoordinator().getCoordinateState(), CoordinateState.RETREATING);
});

/**
 * The real Scurrius producer over a stub plugin API: real NPCs and the real fight, without
 * registering world hooks. The combat method provider is served through PluginManager so
 * `CombatFactory` resolves the actual Scurrius method.
 */
function scurriusProducer(t) {
  const api = new Proxy({
    core,
    spawnNpc: ({ id, x, y, z, wanderRadius }) => {
      const npc = core.NPC.create(id, new core.Location(x, y, z ?? 0));
      if (Number.isFinite(wanderRadius)) npc.getMovementCoordinator().setRadius(wanderRadius);
      return npc;
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  ScurriusCommon.init(api);
  ScurriusFight.attach(api);
  ScurriusLair.attach(api);
  const Method = ScurriusFight._test.defineCombatMethod();
  t.mock.method(PluginManager, "getNpcCombatMethodProviders", () => [{
    pluginName: "Scurrius",
    npcIds: new Set([ScurriusCommon.PUBLIC_ID]),
    provider: { provide: () => new Method() },
  }]);
  return (id = ScurriusCommon.PUBLIC_ID, area = null) => ScurriusLair._test.spawnBoss(id, area);
}

/**
 * The room from the review: spawn 3301,9867, the boss walked to 3304,9866, and a player on the
 * west side at 3290,9867 - eleven tiles from the spawn footprint, but still in the lair.
 */
function inRoomScurriusFight(t, { exempt }) {
  const spawnBoss = scurriusProducer(t);
  const boss = spawnBoss();
  if (!exempt) boss.removeFlag("combat:no-retreat");
  const s = scene(t, {
    providedNpc: boss,
    spawn: new core.Location(...ScurriusCommon.SPAWN_TILE),
    npcAt: new core.Location(3304, 9866, 0),
    playerAt: new core.Location(3290, 9867, 0),
  });
  // He eats with a 20-tile reach; getting up for the between-rounds swipes drops it to melee.
  const state = ScurriusFight.stateOf(boss);
  ScurriusFight._test.startFeeding(boss, state, ScurriusCommon.FEEDING_SPOTS[1]);
  while (state.phase === "feeding") ScurriusFight._test.feedingTurn(boss, state);
  return { ...s, boss, state };
}

test("public Scurrius keeps an in-room player through a feeding transition", (t) => {
  const s = inRoomScurriusFight(t, { exempt: true });
  assert.equal(s.boss.hasFlag("combat:no-retreat"), true,
    "the lair's public fight is scripted arena content, not open-world hunting");
  assert.equal(s.state.phase, "between", "the real feeding round got him up");
  assert.equal(core.CombatFactory.getMethod(s.boss).attackDistance(s.boss), 1,
    "and between rounds he swipes at melee reach");
  assert.ok(core.CombatRange.footprintDistance(s.spawn, 3, s.player.getLocation()) > 8,
    "the player is outside the eight-tile aggression range");
  assert.ok(s.boss.getLocation().getDistance(s.spawn) <= 7, "the boss is still inside its max range");

  s.boss.getCombat().attack(s.player);
  s.boss.process();
  assert.equal(s.boss.getCombat().getTarget(), s.player, "the boss keeps the in-room target");
  assert.notEqual(s.boss.getMovementCoordinator().getCoordinateState(), CoordinateState.RETREATING,
    "and is not sent home mid-fight");
});

test("without the arena exemption the same room-crossing target is dropped", (t) => {
  const s = inRoomScurriusFight(t, { exempt: false });
  assert.equal(s.boss.hasFlag("combat:no-retreat"), false);
  s.boss.getCombat().attack(s.player);
  s.boss.process();
  assert.equal(s.boss.getCombat().getTarget(), null, "the ordinary leash drops it");
  assert.equal(s.boss.getMovementCoordinator().getCoordinateState(), CoordinateState.RETREATING,
    "and sends it home");
});

test("a private Scurrius instance relies on its PrivateArea exemption, not the flag", (t) => {
  const spawnBoss = scurriusProducer(t);
  const instance = new core.PrivateArea([new core.Boundary(3289, 3308, 9858, 9877, 0)]);
  const boss = spawnBoss(ScurriusCommon.SOLO_ID, instance);
  assert.equal(instance.boss, boss);
  assert.equal(boss.getPrivateArea(), instance, "the instance owns its copy");
  assert.equal(boss.hasFlag("combat:no-retreat"), false,
    "Combat.shouldRetreat already exempts every PrivateArea NPC");
});

test("leaving the lair still ends a public Scurrius fight", (t) => {
  const spawnBoss = scurriusProducer(t);
  const boss = spawnBoss();
  const s = scene(t, {
    providedNpc: boss,
    spawn: new core.Location(...ScurriusCommon.SPAWN_TILE),
    npcAt: new core.Location(3304, 9866, 0),
    playerAt: new core.Location(3290, 9867, 0),
  });
  // Full health keeps him in phase one, so this test is about leaving, not the feeding walk.
  boss.setHitpoints(boss.getMaxHitpoints());
  boss.getCombat().attack(s.player);
  s.tick();
  assert.equal(boss.getCombat().getTarget(), s.player, "in the room, he holds the fight");

  // The player leaves: target validity still releases the boss even with the exemption on.
  s.player.setRegistered(false);
  s.tick();
  assert.equal(boss.getCombat().getTarget(), null, "a player who leaves stops being a target");
});
