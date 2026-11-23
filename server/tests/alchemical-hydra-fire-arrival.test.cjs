// Offline real actor/TaskManager/HitQueue checks; graphics are captured at the packet boundary.
process.env.BROWSER_HOST = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const core = PluginManager.getCoreApi();
let Common, Fight;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  Common = require('../plugins/bosses/alchemicalhydra/Common.AlchemicalHydra');
  ({ Fight } = require('../plugins/bosses/alchemicalhydra/Fight.AlchemicalHydra'));
  Common.init({ core, emitCustomEvent() {} });
});

function encounter(t, x = 1362, y = 10271) {
  t.mock.method(Math, 'random', () => 0.999);
  t.mock.method(core.Projectile.prototype, 'sendProjectile', () => {});
  const tile = (x, y, z = 0) => new core.Location(x, y, z);
  const player = new Player(null, tile(x, y));
  player.setRegistered(true);
  const graphics = [];
  player.getPacketSender = () => new Proxy({
    sendGraphic: (graphic, at) => graphics.push({ id: graphic.id, delay: graphic.delay, at }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  player.sendMessage = () => {};
  player.setHitpoints(99);
  const npc = core.NPC.create(Common.ids.npcs.flame, tile(1364, 10265));
  npc.setRegistered(true);
  let present = true;
  const lair = { players: () => present ? [player] : [], contains: at => at.getZ() === 0 };
  const fight = new Fight(lair, npc);
  fight.phase = 2;
  fight.tickCount = 100;
  let cycle = 100;
  const queue = player.getCombat().getHitQueue();
  queue.process(cycle); // Its area runs after this drain in the actual Player turn.
  const step = () => {
    cycle += 1;
    core.TaskManager.process(); // Actual World order: tasks, then Player hit queue, then area.
    queue.process(cycle);
    fight.tickCount += 1;
    fight.tickFire(lair.players());
  };
  t.after(() => {
    fight.stop();
    player.setRegistered(false);
    npc.setRegistered(false);
    queue.clear();
    core.TaskManager.cancelTasks(fight);
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(npc);
    core.TaskManager.process();
  });
  return { player, npc, fight, graphics, step, tile, leave: () => { present = false; } };
}

test('tracking fire catches on its 60-cycle graphic arrival, not on emission', t => {
  const { player, fight, graphics, step } = encounter(t);
  fight.trackingFire('NW', player);
  fight.tickFire([player]);
  assert.equal(graphics.find(g => g.at.getX() === 1362 && g.at.getY() === 10271).delay, 60);
  assert.equal(fight.life.hits.fire.get(player), undefined, 'no achievement failure before the flame exists');
  step();
  assert.equal(player.getHitpoints(), 99, 'no damage one tick before arrival');
  step();
  assert.equal(player.getHitpoints(), 74, 'real hit queue applies at tick 102');
  assert.equal(fight.life.hits.fire.get(player), 1);
  for (let i = 0; i < 4; i++) step();
  assert.equal(player.getHitpoints(), 74, 'no burn before its five-tick interval');
  step();
  assert.equal(player.getHitpoints(), 69, 'first burn lands five ticks after the arrival hit');
});

test('the second tracking step waits for all 75 cycles and rechecks the tile', t => {
  const { player, fight, graphics, step, tile } = encounter(t, 1360, 10273);
  fight.trackingFire('NW', player);
  fight.tickFire([player]);
  assert.ok(graphics.some(g => g.delay === 75 && g.at.getX() === 1361));
  player.moveTo(tile(1361, 10273)); // Move onto the second emitted tile before it appears.
  fight.trackers = [];
  step(); step();
  assert.equal(player.getHitpoints(), 99, '75 cycles round up to the third server tick');
  step();
  assert.equal(player.getHitpoints(), 74);
});

test('moving off an emitted target tile avoids its arrival hit', t => {
  const { player, fight, step, tile } = encounter(t);
  fight.trackingFire('NW', player);
  fight.tickFire([player]);
  fight.trackers = [];
  player.moveTo(tile(1350, 10260));
  step(); step(); step();
  assert.equal(player.getHitpoints(), 99);
  assert.equal(fight.life.hits.fire.get(player), undefined);
});

test('leaving the encounter prevents pending fire from catching the old target', t => {
  const { player, fight, step, leave } = encounter(t);
  fight.trackingFire('NW', player);
  fight.tickFire([player]);
  leave();
  step(); step(); step();
  assert.equal(player.getHitpoints(), 99);
  assert.equal(fight.life.hits.fire.get(player), undefined);
});

test('stopping or clearing the encounter cancels pending fire activations', t => {
  const { player, fight, step } = encounter(t);
  fight.trackingFire('NW', player);
  fight.tickFire([player]);
  fight.stop();
  step(); step(); step();
  assert.equal(player.getHitpoints(), 99);
  assert.equal(fight.life.hits.fire.get(player), undefined);
});

test('fire already breathed still arrives across a phase change', t => {
  const { player, fight, step } = encounter(t);
  fight.trackingFire('NW', player);
  fight.tickFire([player]);
  fight.changePhase();
  step();
  assert.equal(player.getHitpoints(), 99);
  step();
  assert.equal(player.getHitpoints(), 74);
});

test('the first 45-cycle tracking tile also waits until its graphic is visible', t => {
  const { player, fight, step } = encounter(t, 1363, 10271);
  fight.trackingFire('NW', player);
  assert.equal(fight.life.hits.fire.get(player), undefined);
  step();
  assert.equal(player.getHitpoints(), 99);
  step();
  assert.equal(player.getHitpoints(), 74);
});

for (const ending of ['dead-hydra', 'unregistered-hydra', 'other-height', 'unblock', 'clear']) {
  test(`pending fire cannot catch after ${ending}`, t => {
    const { player, npc, fight, step, tile } = encounter(t);
    fight.trackingFire('NW', player);
    fight.tickFire([player]);
    fight.trackers = [];
    if (ending === 'dead-hydra') npc.setHitpoints(0);
    else if (ending === 'unregistered-hydra') npc.setRegistered(false);
    else if (ending === 'other-height') player.moveTo(tile(1362, 10271, 1));
    else if (ending === 'unblock') fight.unblock();
    else fight.clear();
    step(); step(); step();
    assert.equal(player.getHitpoints(), 99);
    assert.equal(fight.life.hits.fire.get(player), undefined);
  });
}
