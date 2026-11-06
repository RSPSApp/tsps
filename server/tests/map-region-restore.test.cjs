// Run after `yarn build`: node --test tests/map-region-restore.test.cjs
// A plugin's in-memory region replacement: only its owner can hand it back, the native map
// reaches every connected client (one failed send does not stop the rest, and is reported),
// and a region without a native map keeps its replacement rather than diverging.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheMaps } = require('../dist/game/cache/CacheMaps');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapRegionReplacementManager } = require('../dist/game/collision/MapRegionReplacementManager');
const { World } = require('../dist/game/World');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');

const LUMBRIDGE = (50 << 8) | 50;
let owner, other;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  owner = PM.createApi('RestoreOwner');
  other = PM.createApi('RestoreOther');
});
function client(send) {
  const sent = [];
  return { sent, player: { getSession: () => ({ sendClientPacket: packet => { sent.push(packet); return send(packet); } }) } };
}
function connected(t, players) {
  t.mock.method(World, 'getPlayers', () => players);
  t.mock.method(World, 'isPlayerSessionConnected', () => true);
}

test('only the owner hands a region back, and every connected client gets the native map', (t) => {
  const native = CacheMaps.getRegion(LUMBRIDGE);
  const good = client(() => true), broken = client(() => { throw new Error('socket gone'); }), late = client(() => true);
  connected(t, [good.player, broken.player, late.player]);
  assert.equal(owner.replaceMapRegionData(LUMBRIDGE, native.terrainData, native.objectData ?? null), true);
  assert.equal(MapRegionReplacementManager.getSource(LUMBRIDGE), 'RestoreOwner');
  assert.equal(other.replaceMapRegionData(LUMBRIDGE, native.terrainData, null), false, 'no stacking over another owner');
  assert.equal(other.restoreMapRegion(LUMBRIDGE), false, 'another plugin cannot hand it back');
  assert.ok(MapRegionReplacementManager.getRegionIds().includes(LUMBRIDGE));
  for (const c of [good, broken, late]) c.sent.length = 0;
  assert.equal(owner.restoreMapRegion(LUMBRIDGE), false, 'a client that missed the native map is reported');
  assert.equal(MapRegionReplacementManager.getRegionIds().includes(LUMBRIDGE), false, 'the server side is restored');
  assert.equal(good.sent.length, 1);
  assert.equal(late.sent.length, 1, 'one failed send does not stop the rest');
  assert.equal(owner.restoreMapRegion(LUMBRIDGE), false, 'nothing left to restore');
});

test('all clients served: restore reports success', (t) => {
  const native = CacheMaps.getRegion(LUMBRIDGE), a = client(() => true);
  connected(t, [a.player]);
  owner.replaceMapRegionData(LUMBRIDGE, native.terrainData, native.objectData ?? null);
  a.sent.length = 0;
  assert.equal(owner.restoreMapRegion(LUMBRIDGE), true);
  assert.equal(a.sent.length, 1);
});

test('a region with no native map keeps its replacement instead of diverging from clients', (t) => {
  const empty = [...Array(256).keys()].map(x => (x << 8) | 255).find(id => !CacheMaps.getRegion(id));
  assert.ok(empty !== undefined, 'a region the cache has no map for');
  const native = CacheMaps.getRegion(LUMBRIDGE), a = client(() => true);
  connected(t, [a.player]);
  assert.equal(owner.replaceMapRegionData(empty, native.terrainData, null), true);
  a.sent.length = 0;
  assert.equal(owner.restoreMapRegion(empty), false);
  assert.ok(MapRegionReplacementManager.getRegionIds().includes(empty), 'still replaced');
  assert.equal(a.sent.length, 0);
  MapRegionReplacementManager.removeMapRegion(empty);
});
