// Run after `yarn build`: node --test tests/npc-exact-move.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Location } = require('../dist/game/model/Location');
const { PlayerSession } = require('../dist/net/PlayerSession');

before(() => CachePipeline.initialize());

test('the default angle faces the way it travels (0 south, 512 west, 1024 north, 1536 east)', () => {
  assert.equal(NPC.travelAngle(0, -1), 0);
  assert.equal(NPC.travelAngle(-1, 0), 512);
  assert.equal(NPC.travelAngle(0, 1), 1024);
  assert.equal(NPC.travelAngle(1, 0), 1536);
  // A capture of the Doom of Mokhaiotl's burrowed zooms: north-west 768, east 1536.
  assert.equal(NPC.travelAngle(-4, 4), 768);
  assert.equal(NPC.travelAngle(4, 0), 1536);
});

test('exactMove moves the NPC at once and keeps the glide for this tick only', () => {
  const npc = new NPC(14709, new Location(3421, 6435, 0));
  npc.exactMove(new Location(3417, 6439, 0));
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [3417, 6439]);
  assert.deepEqual(npc.getExactMove(), { fromX: 3421, fromY: 6435, startCycles: 0, endCycles: 30, angle: 768 });
  const view = PlayerSession.prototype.exactMoveView.call(null, npc.getExactMove(), npc.getLocation());
  assert.deepEqual(view, {
    startDeltaX: 4, startDeltaY: -4, endDeltaX: 0, endDeltaY: 0,
    startCycleOffset: 0, endCycleOffset: 30, direction: 768,
  });
  npc.resetUpdating();
  assert.equal(npc.getExactMove(), null);
  npc.exactMove(new Location(3420, 6439, 0), { startCycles: 5, endCycles: 40, angle: 100 });
  assert.deepEqual(npc.getExactMove(), { fromX: 3417, fromY: 6439, startCycles: 5, endCycles: 40, angle: 100 });
});

test('a gliding NPC stays in view in its teleport tick; a plain teleport still leaves it for that tick', () => {
  const { World } = require('../dist/game/World');
  const npc = new NPC(14709, new Location(3222, 3221, 0));
  assert.ok(World.getNpcs().add(npc, true), 'registered');
  try {
    const localNpcs = [];
    const player = {
      getLocation: () => new Location(3222, 3218, 0),
      getPrivateArea: () => null,
      getArea: () => null,
      getLocalNpcs: () => localNpcs,
      getAttribute: () => undefined,
    };
    const refresh = () => World.updateLocalNpcs(player, [npc]);
    refresh();
    assert.deepEqual(localNpcs, [npc], 'in view');

    npc.exactMove(new Location(3226, 3221, 0));
    refresh();
    assert.deepEqual(localNpcs, [npc], 'still in view, so the glide reaches the client with the teleport');
    npc.resetUpdating();
    npc.setNeedsPlacement(false);

    npc.moveTo(new Location(3222, 3221, 0));
    refresh();
    assert.deepEqual(localNpcs, [], 'a plain teleport: out for the tick, as before');
    npc.resetUpdating();
    npc.setNeedsPlacement(false);
    refresh();
    assert.deepEqual(localNpcs, [npc], 'and back the tick after');
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('headbars besides the hitpoints one last a tick; showing one again replaces it', () => {
  const npc = new NPC(14707, new Location(3421, 6435, 0));
  npc.showHeadbar(81, { fill: 0, endFill: 100, duration: 390 });
  npc.showHeadbar(11, { fill: 13 });
  assert.deepEqual(npc.getHeadbars(), [
    { id: 81, fill: 0, endFill: 100, duration: 390, delay: 0 },
    { id: 11, fill: 13, endFill: 13, duration: 0, delay: 0 },
  ]);
  npc.showHeadbar(81, { fill: 0, endFill: 100, duration: 510 });
  assert.equal(npc.getHeadbars().filter((bar) => bar.id === 81).length, 1, 'restarted, not stacked');
  assert.equal(npc.getHeadbars().find((bar) => bar.id === 81).duration, 510);
  npc.removeHeadbar(81);
  assert.deepEqual(npc.getHeadbars().find((bar) => bar.id === 81), { id: 81, remove: true });
  npc.resetUpdating();
  assert.deepEqual(npc.getHeadbars(), []);
});

test('a face tile lasts a tick; crawling stays until it is turned off', () => {
  const npc = new NPC(14710, new Location(3421, 6435, 0));
  npc.faceTile(new Location(3419, 6445, 0));
  assert.deepEqual(npc.getFaceTile(), { x: 3419, y: 6445 });
  npc.resetUpdating();
  assert.equal(npc.getFaceTile(), null);
  assert.equal(npc.isCrawling(), false);
  npc.setCrawling(true);
  npc.resetUpdating();
  assert.equal(npc.isCrawling(), true);
});

test('the attack timing hook lets an attack ignore the timer, or leave it as it was', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const api = PluginManager.createApi('timing-test');
  api.onAttackTiming((event) => {
    if (event.target !== 'larva') return;
    event.ignoreDelay = true;
    event.keepDelay = true;
  });
  const event = (target) => ({ attacker: {}, target, method: null, ignoreDelay: false, keepDelay: false });
  const larva = event('larva');
  PluginManager.emitAttackTiming(larva);
  assert.deepEqual([larva.ignoreDelay, larva.keepDelay], [true, true]);
  const boss = event('boss');
  PluginManager.emitAttackTiming(boss);
  assert.deepEqual([boss.ignoreDelay, boss.keepDelay], [false, false]);
});
