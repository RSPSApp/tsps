// Run after `yarn build`: node --test tests/movement-stopping.test.cjs
// Digging is a partial animation stall: it plays while the true tile keeps walking, and the
// walk queue is never cleared (Wiki: Animation stall; rsprox captures 1858, 3275, 1098).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Location } = require('../dist/game/model/Location');
const Spade = require('../plugins/items/Spade.plugin');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
const { Boundary } = require('../dist/game/model/Boundary');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { World } = require('../dist/game/World');
const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');

const SPADE = 952;
const actions = new Map();
const fallbacks = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  RegionManager.loadMapFiles(3200, 3200);
  Spade.register({
    core: PluginManager.getCoreApi(),
    onItemAction: (name, named, options) => (options?.fallback ? fallbacks : actions).set(name, named),
  });
});

function digPlayer() {
  const movement = { resets: 0 };
  const animations = [];
  const sounds = [];
  const player = {
    isPlayer: () => true,
    isPlayerBot: () => false,
    getAsPlayer() { return this; },
    getMovementQueue: () => ({ reset: () => { movement.resets++; } }),
    performAnimation: (animation) => animations.push(animation.getId()),
    getPacketSender: () => ({
      sendSoundEffect: (id, loops, delay, volume) => sounds.push({ id, loops, delay, volume }),
    }),
  };
  return { player, movement, animations, sounds };
}

test('every spade registers the shared Dig handler and its nothing-found fallback', () => {
  assert.deepEqual([...actions.keys()], ['Spade', 'Large spade', 'Eastfloor spade']);
  assert.deepEqual([...fallbacks.keys()], ['Spade', 'Large spade', 'Eastfloor spade']);
});

test('a Dig plays human_dig and its synth without clearing the walk', () => {
  const { player, movement, animations, sounds } = digPlayer();
  const event = { player, itemId: SPADE, slot: 0, clickType: 1, option: 'Dig', handled: false };
  assert.equal(actions.get('Spade').Dig(event), false, 'the event stays open for content dig handlers');
  assert.deepEqual(animations, [CacheDefinitions.getSeqId('human_dig') ?? 830]);
  assert.deepEqual(sounds, [{ id: 1470, loops: 0, delay: 0, volume: 1 }]);
  assert.equal(movement.resets, 0, 'a partial stall leaves the true tile walking');
  assert.equal(event.handled, false);
});

test('a real player keeps its queued route through a Dig and shows the sequence', () => {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => {} });
  player.setLocation(new Location(3200, 3200, 0));
  player.getMovementQueue().requestWalk(new Location(3205, 3200, 0));
  const queued = player.getMovementQueue().size();
  assert.ok(queued > 0);
  actions.get('Spade').Dig({ player, itemId: SPADE, slot: 0, clickType: 1, option: 'Dig', handled: false });
  assert.equal(player.getAnimation().getId(), CacheDefinitions.getSeqId('human_dig') ?? 830);
  assert.equal(player.getMovementQueue().size(), queued, 'the walk is not cleared by the dig');
});

// Consumer tests for the optional area queued-NPC-step policy. These use real
// MovementQueue/PrivateArea/collision, not a predicate-only content assertion.
function stepActor(t, policy, { player = false, run = false } = {}) {
  class StepArea extends PrivateArea {
    // This multi-actor test area has an explicit lifetime, not a last-player exit.
    postLeave(mobile) { this.remove(mobile); }
  }
  const AreaType = policy === undefined ? StepArea : class extends StepArea {
    canNpcStep(npc, from, to) { return policy(npc, from, to); }
  };
  const area = new AreaType([new Boundary(3190, 3210, 3190, 3210, 0)]);
  const start = new Location(3200, 3200, 0);
  const mobile = player ? new Player(null) : NPC.create(PluginManager.getCoreApi().NpcIdentifiers.MAN, start);
  if (player) mobile.getSession = () => ({ sendClientPacket: () => {} });
  mobile.setLocation(start);
  if (!player) assert.equal(World.getNpcs().add(mobile), true);
  area.enter(mobile);
  if (player) { mobile.needsPlacement = false; mobile.setRunning(run); }
  else { mobile.setNeedsPlacement(false); mobile.setMovementSteps(run ? 2 : 1); }
  const queue = mobile.getMovementQueue();
  t.after(() => {
    queue.reset(); area.leave(mobile, false);
    if (!player) World.getNpcs().remove(mobile);
    area.destroy();
  });
  assert.equal(mobile.getArea(), area);
  assert.equal(queue.getMobility().canMove(), true);
  return { mobile, area, queue, start };
}

test('NPC area veto precedes all commits and retains the same queued checkpoint until released', t => {
  let allowed = false;
  const calls = [];
  const f = stepActor(t, (npc, from, to) => {
    calls.push([npc, from.clone(), to.clone()]); return allowed;
  });
  const target = f.start.transform(1, 0);
  assert.equal(f.queue.canWalkTo(target), true, 'actual collision permits the candidate');
  f.queue.addCheckpoint(target);
  const size = f.queue.size(), direction = f.mobile.getWalkingDirection();
  f.queue.process();
  assert.ok(f.mobile.getLocation().equals(f.start));
  assert.equal(f.mobile.getWalkingDirection(), direction);
  assert.equal(f.queue.size(), size);
  assert.equal(f.queue.wasRouteInvalidated(), true, 'policy veto is not dynamic occupancy');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], f.mobile);
  assert.ok(calls[0][1].equals(f.start)); assert.ok(calls[0][2].equals(target));
  allowed = true; f.queue.process();
  assert.ok(f.mobile.getLocation().equals(target)); assert.equal(f.queue.size(), 0);
});

test('each diagonal run substep consults the area with the updated source; denial has no axial fallback', t => {
  const calls = [];
  const f = stepActor(t, (_npc, from, to) => {
    calls.push([from.clone(), to.clone()]); return calls.length === 1;
  }, { run: true });
  const first = f.start.transform(1, 1), target = f.start.transform(2, 2);
  assert.equal(f.queue.canWalkTo(first), true);
  assert.equal(f.queue.canWalkTo(target, first), true);
  f.queue.addCheckpoint(target); f.queue.process();
  assert.equal(calls.length, 2);
  assert.ok(calls[0][0].equals(f.start)); assert.ok(calls[0][1].equals(first));
  assert.ok(calls[1][0].equals(first)); assert.ok(calls[1][1].equals(target));
  assert.ok(f.mobile.getLocation().equals(first)); assert.equal(f.queue.size(), 1);
});

test('true and null policies never authorize static clipping or dynamic occupancy', t => {
  for (const result of [true, null]) {
    let calls = 0;
    const f = stepActor(t, () => { calls++; return result; });
    const target = f.start.transform(1, 0);
    assert.equal(f.queue.canWalkTo(target), true);
    RegionManager.addClipping(target.getX(), target.getY(), 0, 0x200000, f.area);
    assert.equal(f.queue.canWalkTo(target), false);
    f.queue.addCheckpoint(target); f.queue.process();
    assert.ok(f.mobile.getLocation().equals(f.start)); assert.equal(calls, 0);
    RegionManager.removeClipping(target.getX(), target.getY(), 0, 0x200000, f.area);
    const occupant = NPC.create(PluginManager.getCoreApi().NpcIdentifiers.MAN, target);
    assert.equal(World.getNpcs().add(occupant), true);
    f.area.enter(occupant); occupant.setNeedsPlacement(false);
    try {
      assert.equal(f.queue.canWalkTo(target), false, 'real registered NPC occupies the candidate');
      f.queue.process(); assert.ok(f.mobile.getLocation().equals(f.start)); assert.equal(calls, 0);
    } finally { f.area.leave(occupant, false); World.getNpcs().remove(occupant); }
    f.queue.process(); assert.ok(f.mobile.getLocation().equals(target)); assert.equal(calls, 1);
  }
});

test('clipping-ignoring queued walking still consults policy, while neutral leaves it unchanged', t => {
  for (const result of [false, null]) {
    let calls = 0;
    const f = stepActor(t, () => { calls++; return result; });
    const target = f.start.transform(1, 0);
    RegionManager.addClipping(target.getX(), target.getY(), 0, 0x200000, f.area);
    assert.equal(f.queue.canWalkTo(target), false);
    f.mobile.setFlag(MovementQueue.IGNORE_CLIPPING_FLAG);
    f.queue.addCheckpoint(target); f.queue.process(); assert.equal(calls, 1);
    assert.ok(f.mobile.getLocation().equals(result === false ? f.start : target));
    assert.equal(f.queue.size(), result === false ? 1 : 0);
  }
});

test('the NPC-only step policy never runs for a player sharing that area', t => {
  let calls = 0;
  const f = stepActor(t, () => { calls++; return false; }, { player: true });
  const target = f.start.transform(1, 0);
  assert.equal(f.queue.canWalkTo(target), true);
  f.queue.addCheckpoint(target); f.queue.process();
  assert.ok(f.mobile.getLocation().equals(target)); assert.equal(calls, 0);
});

test('the inherited neutral area policy preserves ordinary and scripted queued NPC walking', t => {
  for (const scripted of [false, true]) {
    const f = stepActor(t);
    f.mobile.setScriptedMovement(scripted);
    const target = f.start.transform(1, 0);
    assert.equal(f.queue.canWalkTo(target), true);
    f.queue.addCheckpoint(target); f.queue.process();
    assert.ok(f.mobile.getLocation().equals(target)); assert.equal(f.queue.size(), 0);
    assert.equal(f.mobile.isScriptedMovement(), scripted, 'the generic policy never changes the script owner');
  }
});
