// A fighter must never stay "in combat" with a target it cannot reach.
//
// Both give-up paths in Combat.postMovementProcess are skipped by an actor that cannot move
// (a stun, a placement, a teleport in transit) and by a route whose step the mover rejects -
// the checkpoint is kept, so the queue never empties. Without the deadline in
// Combat.giveUpUnreachableTarget, such an actor held its target (and so
// CombatFactory.inCombat, the teleport and busy gates) indefinitely.
//
// The deadline measures a pursuit that got nowhere: no distance closed and no step taken. A step
// the mover accepted is the chase still going, so a target walked away at the same speed does not
// spend the budget - the tests below hold both halves up, and say which one a case is for.
//
// Run after `yarn build`: node --test tests/unreachable-combat.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();

const MUGGER = core.NpcIdentifiers.MUGGER_2;
/** Matches Combat.UNREACHABLE_GIVE_UP_CYCLES. */
const GIVE_UP_CYCLES = 20;
/** Open ground, so nothing but the actors themselves decides the fight. */
const FIELD = { x: 3220, y: 3220 };

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

/**
 * A real player and NPC on the live map, ticked in World order (NPCs first, then players) with
 * a cycle counter, so Combat's own reach, routing and give-up code is what runs. Nothing wanders
 * or respawns: the fight is driven only through Combat. `blockAgent` is the only actor put on the
 * World grid on purpose - but both fighters are `isRegistered`, so `Mobile.setLocation` keeps a
 * tile occupant for wherever they end up, and `t.after` takes it back out. A left-behind occupant
 * is a wall to the next scene's pursuer, which tests entity blocks by accident.
 */
function scene(t, { gap = 18, playerImmobile = false, npcImmobile = false, noRetreat = false } = {}) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });

  const player = new Player(null);
  player.setUsername("unreachable-combat");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true, processPackets: () => {} });
  const messages = [];
  t.mock.method(player, "sendMessage", (m) => messages.push(m));
  player.setLocation(new core.Location(FIELD.x, FIELD.y, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setCurrentLevel(skill, 99);
    player.getSkillManager().setMaxLevel(skill, 99);
  }
  if (playerImmobile) player.getMovementQueue().setBlockMovement(true);

  const npc = core.NPC.create(MUGGER, new core.Location(FIELD.x, FIELD.y + gap, 0));
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  npc.setHitpoints(500);
  // These tests are about the unreachable deadline, not the aggression-range leash: opt out of
  // the latter so a target far from the spawn cannot end the engagement early.
  if (noRetreat) npc.setFlag("combat:no-retreat");
  if (npcImmobile) npc.getMovementQueue().setBlockMovement(true);

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
  const moveNpcTo = (x, y) => npc.setLocation(new core.Location(x, y, 0));
  /** Queues one walking step for the player, as a client click would; the mover consumes it. */
  const walkPlayer = (dx, dy) => {
    const queue = player.getMovementQueue();
    if (queue.size() === 0) queue.addSteps(player.getLocation().transform(dx, dy));
  };
  /**
   * Puts a real npc on the World grid, which is all `MovementQueue.canWalkTo` consults for
   * entity occupancy. It is never processed, so it simply stands its ground.
   */
  const blockers = [];
  const blockAgent = (x, y) => {
    const blocker = core.NPC.create(MUGGER, new core.Location(x, y, 0));
    blocker.isRegistered = () => true;
    core.World.registerNpcPosition(blocker);
    blockers.push(blocker);
    return blocker;
  };
  t.after(() => {
    core.World.unregisterNpcPosition(npc);
    core.World.unregisterPlayerPosition(player);
    for (const blocker of blockers) core.World.unregisterNpcPosition(blocker);
  });
  return { player, npc, messages, tick, ticks, moveNpcTo, walkPlayer, blockAgent };
}

test("a player that cannot move, chasing a target that never comes, gives up", (t) => {
  const s = scene(t, { playerImmobile: true, npcImmobile: true });
  s.player.getCombat().attack(s.npc);
  s.ticks(GIVE_UP_CYCLES - 1);
  assert.ok(s.player.getCombat().getTarget(), "still patient one cycle short of the deadline");
  assert.deepEqual(s.messages, []);
  s.tick();
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(core.CombatFactory.inCombat(s.player), false, "not held in combat by an unreachable target");
  assert.deepEqual(s.messages, ["I can't reach that!"]);
});

test("an immobile npc gives up a player that never comes", (t) => {
  const s = scene(t, { playerImmobile: true, npcImmobile: true, noRetreat: true });
  s.npc.getCombat().attack(s.player);
  s.ticks(GIVE_UP_CYCLES - 1);
  assert.ok(s.npc.getCombat().getTarget(), "still patient one cycle short of the deadline");
  s.tick();
  assert.equal(s.npc.getCombat().getTarget(), null);
  assert.equal(s.npc.getCombat().hasPendingWork(), false);
});

test("a fighter still walking toward its target keeps it", (t) => {
  const s = scene(t, { noRetreat: true });
  const from = s.npc.getLocation().getDistance(s.player.getLocation());
  s.npc.getCombat().attack(s.player);
  s.ticks(GIVE_UP_CYCLES * 3);
  const to = s.npc.getLocation().getDistance(s.player.getLocation());
  assert.ok(to < from, `the npc closed the gap: ${from} -> ${to}`);
  assert.equal(s.npc.getCombat().getTarget(), s.player, "progress is not a give-up");
});

test("an immobile actor keeps a target that is closing on it", (t) => {
  // The other half of the deadline: patience is only spent when the gap stops closing.
  const s = scene(t, { playerImmobile: true, gap: 10 });
  s.player.getCombat().attack(s.npc);
  for (let i = 0; i < GIVE_UP_CYCLES * 2; i++) {
    s.tick();
    if (i % 2 === 0) s.moveNpcTo(FIELD.x, Math.max(FIELD.y + 1, FIELD.y + 10 - i / 2));
  }
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  assert.deepEqual(s.messages, []);
});

test("an npc whose pursuit step another actor rejects gives up", (t) => {
  // The engagement stuck behind a crowd, which only the deadline can end: a real npc registered
  // in World stands on the tile the mugger must step onto, so `validatedStep` refuses it and the
  // checkpoint is retained - postMovementProcess exempts an entity block by design, and the queue
  // never empties. Nothing is pinned or teleported here: the npc simply never gets a step in.
  const s = scene(t, { gap: 8 });
  s.blockAgent(FIELD.x, FIELD.y + 7);
  s.npc.getCombat().attack(s.player);
  const stuck = s.npc.getLocation();
  let refused = false;
  for (let i = 0; i < GIVE_UP_CYCLES - 1; i++) {
    s.tick();
    refused = refused || s.npc.getMovementQueue().wasBlockedByDynamicOccupancy();
  }
  assert.equal(refused, true, "the mover refused the step as an entity block");
  assert.ok(s.npc.getCombat().getTarget(), "still patient one cycle short of the deadline");
  s.tick();
  assert.equal(s.npc.getCombat().getTarget(), null);
  assert.equal(s.npc.getLocation().equals(stuck), true, "the npc never took a step");
});

test("an npc chasing a target that walks away at its own speed keeps it", (t) => {
  // A held gap is not a failed pursuit. Both actors step south every cycle, so the distance never
  // closes; only the mover knows the chase is still going, and live walks on. The aggression-range
  // leash is opted out here (see aggression-range.test.cjs), since this is the deadline's case.
  const s = scene(t, { gap: 8, noRetreat: true });
  s.npc.getCombat().attack(s.player);
  const chase = GIVE_UP_CYCLES + 5;
  let steps = 0;
  let previous = s.npc.getLocation();
  for (let i = 0; i < chase; i++) {
    s.walkPlayer(0, -1);
    s.tick();
    if (!s.npc.getLocation().equals(previous)) steps++;
    previous = s.npc.getLocation();
  }
  assert.equal(s.npc.getCombat().getTarget(), s.player, `${chase} cycles of held gap is no give-up`);
  assert.equal(steps, chase, "the npc stepped on every cycle of the chase");
  assert.equal(s.player.getLocation().getY(), FIELD.y - chase, "the player walked off the whole way");
  assert.equal(s.npc.getLocation().getDistance(s.player.getLocation()), 8, "the gap never closed or gaped");
});

test("a fight in reach is never given up", (t) => {
  const s = scene(t, { gap: 1 });
  s.player.getCombat().attack(s.npc);
  s.npc.getCombat().attack(s.player);
  s.ticks(GIVE_UP_CYCLES * 3);
  assert.equal(s.npc.getHitpoints() < 500, true, "the player is landing hits");
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  assert.deepEqual(s.messages, []);
});

test("a player with no route to its target is refused on the spot", (t) => {
  // The pre-existing fast path: an empty queue that the route finder cannot fill.
  const s = scene(t, { gap: 6 });
  t.mock.method(core.CombatRange, "route", () => false);
  s.player.getCombat().attack(s.npc);
  s.tick();
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.deepEqual(s.messages, ["I can't reach that!"]);
});
