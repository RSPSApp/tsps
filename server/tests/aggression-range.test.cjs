// Aggression ranges, measured from an NPC's static spawn (Wiki Aggressiveness#Aggression range):
//   aggression range = max range + attack range + size - 1
// An NPC outside it cannot attack the player, and a hunter dragged outside it loses interest and
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
/** Open ground, so only the actors decide the hunt. */
const FIELD = { x: 3220, y: 3220 };

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

function scene(t) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });

  const player = new Player(null);
  player.setUsername("aggression-range");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true, processPackets: () => {} });
  player.setLocation(new core.Location(FIELD.x, FIELD.y, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.autoRetaliateReturn = () => false;
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setCurrentLevel(skill, 99);
    player.getSkillManager().setMaxLevel(skill, 99);
  }

  const spawn = new core.Location(FIELD.x, FIELD.y + 2, 0);
  const npc = core.NPC.create(MUGGER, spawn.clone());
  npc.setSpawnPosition(spawn.clone());
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
  return { player, npc, spawn, tick, ticks, walkPlayer };
}

test("the aggression range is max range + attack range + size - 1 (Wiki)", () => {
  const definition = new core.NpcDefinition();
  assert.equal(definition.getAggressionRange(1), 8, "melee, size 1: 7 + 1 + 0");
  assert.equal(definition.getAggressionRange(6), 13, "ranged, size 1: 7 + 6 + 0");
  assert.equal(definition.getAggressionRange(10), 17, "magic, size 1: 7 + 10 + 0");
  Object.assign(definition, { size: 3 });
  assert.equal(definition.getAggressionRange(1), 10, "a size-3 melee NPC adds two tiles");
  Object.assign(definition, { combatFollowDistance: 9 });
  assert.equal(definition.getAggressionRange(1), 12, "a longer max range widens it by the same amount");
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
