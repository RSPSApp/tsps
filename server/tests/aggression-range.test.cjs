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
  const npc = core.NPC.create(npcId, npcAt.clone());
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
