// Run after `yarn build`: node --test tests/swamp-cave-markers.test.cjs
//
// Lumbridge Swamp Caves' cave goblin markers (the wall "Symbol" locs) against rsprox.net rec 3182
// (rev 232): Look-at sets cave_goblin_markers:symbol to the marker's model, runs
// toplevel_mainmodal_open [0, 0] and opens the modal, from where the player stands (an approach op).
// On a real Player with its real PacketSender and the cache's collision.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let Misthalin, core;
const hooks = {};

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  Misthalin = require('../plugins/areas/Misthalin.plugin');
  Misthalin.register({
    core,
    persistAttribute: () => {},
    onObjectRoute: (handler) => { hooks.route = handler; },
    onObjectInteraction: (name, actions) => { hooks[name] = { ...(hooks[name] ?? {}), ...actions }; },
    onItemOnObject: () => {},
    onPlayerLogin: () => {},
    emitCustomEvent: () => {},
  });
});

function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(78);
  p.sent = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'isRegistered', () => true);
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendInterfaceRawModel', (uid, model) => { p.sent.push(['model', uid, model]); return sender; });
  t.mock.method(sender, 'sendInterface', (id) => { p.sent.push(['open', id]); return sender; });
  t.mock.method(sender, 'sendInterfaceScript', (id, args) => { p.sent.push(['script', id, args]); return sender; });
  return p;
}

const C = () => core.CacheDefinitions;
const lookAt = (p, gameval) => {
  const event = { player: p, objectId: C().getLocId(gameval), option: 'look-at', clickType: 1, location: { x: 3244, y: 9646, z: 0 }, handled: false };
  const result = hooks.Symbol['Look-at'](event);
  return { event, result };
};

test('the cache has both markers as "Symbol" with a single Look-at, and the modal has its model component', () => {
  for (const gameval of ['swamp_cavewall_northmarker', 'swamp_cavewall_southmarker', 'swamp_cavewall_eastmarker', 'swamp_cavewall_westmarker']) {
    const def = C().getObject(C().getLocId(gameval));
    assert.equal(def.name, 'Symbol');
    assert.equal(def.actions[0], 'Look-at');
  }
  assert.equal(C().getInterfaceId('cave_goblin_markers'), 62);
  assert.equal(C().getComponentId('cave_goblin_markers:symbol') >>> 16, 62);
});

test('each marker shows its own recorded model, then toplevel_mainmodal_open [0, 0] and the modal, as recorded', (t) => {
  const symbol = C().getComponentId('cave_goblin_markers:symbol');
  for (const [gameval, model] of [['swamp_cavewall_northmarker', 6923], ['swamp_cavewall_southmarker', 6924], ['swamp_cavewall_eastmarker', 6922], ['swamp_cavewall_westmarker', 6927]]) {
    const p = realPlayer(t);
    const { event, result } = lookAt(p, gameval);
    assert.equal(result, true);
    assert.equal(event.handled, true);
    assert.deepEqual(p.sent, [['model', symbol, model], ['script', 2524, [0, 0]], ['open', 62]], gameval);
    const face = p.getPositionToFace();
    assert.deepEqual([face.getX(), face.getY()], [3244, 9646], 'turned to the marker');
  }
});

test('other "Symbol" locs are left to their own handlers', (t) => {
  const p = realPlayer(t);
  const { event, result } = lookAt(p, 'sote_symbol');
  assert.equal(result, false);
  assert.equal(event.handled, false);
  assert.deepEqual(p.sent, []);
});

function routeFrom(t, gameval, [lx, ly], [px, py], clickType = 1) {
  const { Location, RegionManager } = core;
  RegionManager.loadMapFiles(lx, ly);
  const p = realPlayer(t);
  p.setLocation(new Location(px, py, 0));
  const event = {
    player: p, objectId: C().getLocId(gameval), clickType,
    object: { getLocation: () => new Location(lx, ly, 0) },
    sourceLocation: { x: px, y: py, z: 0 }, destination: null,
  };
  hooks.route(event);
  return event;
}

test('read where the player stands from the recorded tiles: 2 and 7 tiles off, in sight (rec 3182)', (t) => {
  // South marker 3244,9646 read from 3246,9647 (ticks 2877, 3060); north marker 3251,9619 from 3246,9612 (tick 2669).
  for (const [gameval, loc, at] of [
    ['swamp_cavewall_southmarker', [3244, 9646], [3246, 9647]],
    ['swamp_cavewall_northmarker', [3251, 9619], [3246, 9612]],
    // East marker 3230,9613 read from 3227,9614 (tick 2192).
    ['swamp_cavewall_eastmarker', [3230, 9613], [3227, 9614]],
  ]) {
    const event = routeFrom(t, gameval, loc, at);
    assert.deepEqual(event.destination, { x: at[0], y: at[1], z: 0 }, gameval);
    assert.equal(event.approachRange, undefined);
  }
});

test('out of range: walk until in range (approach op); other locs and options are untouched', (t) => {
  const far = routeFrom(t, 'swamp_cavewall_southmarker', [3244, 9646], [3244 + Misthalin._test.SWAMP_CAVE_MARKER_RANGE + 1, 9646]);
  assert.equal(far.destination, null);
  assert.equal(far.approachRange, Misthalin._test.SWAMP_CAVE_MARKER_RANGE);
  const other = routeFrom(t, 'sote_symbol', [3244, 9646], [3246, 9647]);
  assert.equal(other.destination, null);
  assert.equal(other.approachRange, undefined);
  const examine = routeFrom(t, 'swamp_cavewall_southmarker', [3244, 9646], [3246, 9647], 10);
  assert.equal(examine.destination, null);
});
