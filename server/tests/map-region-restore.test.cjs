// Run after `yarn build`: node --test tests/map-region-restore.test.cjs
// A plugin's in-memory region replacement: only its owner can hand it back, the native map
// reaches every connected client (one failed send does not stop the rest, and is reported),
// and a region without a native map keeps its replacement rather than diverging.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheMaps } = require('../dist/game/cache/CacheMaps');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapRegionReplacementManager } = require('../dist/game/collision/MapRegionReplacementManager');
const { World } = require('../dist/game/World');
const { readWorldConfig } = require('../dist/game/definition/WorldDefinition');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { reloadSavedMap } = require('../plugins/world/SavedMapReload');
const { commitMapEdit, effectiveFile, regionFiles } = require('../plugins/world/MapEditFiles');

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

test('loads a saved synthetic square and rebuilds clipping even when a client disconnects', (t) => {
  const regionId = Array.from({ length: 100 }, (_, x) => (x << 8) | 199)
    .find((id) => !RegionManager.getRegionid(id) && !CacheMaps.getArchiveIds(id));
  assert.notEqual(regionId, undefined);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-region-'));
  t.after(() => {
    MapRegionReplacementManager.removeMapRegion(regionId);
    RegionManager.regions.delete(regionId);
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  // The first tile has the walking block, the rest are native procedural height.
  const terrain = Buffer.alloc(4 * 64 * 64 * 2 + 2);
  terrain.writeUInt16BE(50);
  MapRegionReplacementManager.replaceMapRegionData(regionId, terrain, Uint8Array.of(0), 'test');
  const pack = MapRegionReplacementManager.getRegionPack(regionId);
  assert.equal(pack.readInt32BE(4), -1);
  assert.equal(pack.readInt32BE(8), -1);
  const data = path.join(scratch, "data");
  const relative = `regions/${regionId}.pack`;
  const saved = path.join(data, relative);
  fs.mkdirSync(path.dirname(saved), { recursive: true });
  fs.writeFileSync(saved, pack);
  const edited = Buffer.from(pack);
  // First encoded tile: block walking and set a fixed elevation.
  const terrainOffset = 28 + pack.readInt32BE(20);
  edited.writeUInt16BE(51, terrainOffset);
  const layer = commitMapEdit(new Map([[relative, edited]]), data);
  assert.deepEqual(fs.readFileSync(saved), pack);
  assert.equal(regionFiles(data).find(({ file }) => file === path.join(layer, relative))?.name, `${regionId}.pack`);
  MapRegionReplacementManager.removeMapRegion(regionId);

  const resolve = path.resolve;
  t.mock.method(path, 'resolve', (...segments) =>
    segments[0] === 'data/regions' && segments[1] === `${regionId}.pack` ? saved : resolve(...segments));
  const disconnected = client(() => { throw new Error('socket closed'); });
  const active = client(() => true);
  connected(t, [null, disconnected.player, active.player]);
  const result = reloadSavedMap({ MapRegionReplacementManager, RegionManager, World }, regionId);
  assert.equal(result.clientsUpdated, 1);
  assert.equal(result.clientsFailed, 1);
  assert.equal(RegionManager.getRegionid(regionId).isLoaded(), true);
  assert.equal(active.sent.length, 1);
  assert.deepEqual(MapRegionReplacementManager.getRegionPack(regionId), edited);

  const restored = commitMapEdit(new Map([[relative, pack]]), data);
  assert.equal(effectiveFile(saved), path.join(restored, relative));
  assert.deepEqual(fs.readFileSync(path.join(layer, relative)), edited);
  reloadSavedMap({ MapRegionReplacementManager, RegionManager, World }, regionId);
  assert.deepEqual(MapRegionReplacementManager.getRegionPack(regionId), pack);

  commitMapEdit(new Map([[relative, null]]), data);
  assert.equal(effectiveFile(saved), null);
  assert.equal(regionFiles(data).some(({ name }) => name === `${regionId}.pack`), false);
  assert.deepEqual(fs.readFileSync(saved), pack);
});

test('map settings layers preserve the rest of the local world configuration', (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'map-world-layer-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  fs.mkdirSync(path.join(data, 'definitions'));
  fs.writeFileSync(path.join(data, 'definitions/world.json'), JSON.stringify({ zones: [], experienceMultiplier: 1 }));
  const local = path.join(data, 'definitions/world.local.json');
  fs.writeFileSync(local, JSON.stringify({ experienceMultiplier: 4, spawn: { x: 3200, y: 3200, z: 0 } }));
  const resolve = path.resolve;
  t.mock.method(path, 'resolve', (...segments) =>
    typeof segments[0] === 'string' && /^data(?:\/|$)/.test(segments[0])
      ? resolve(data, segments[0].slice(5), ...segments.slice(1)) : resolve(...segments));

  const spawn = { x: 4200, y: 4200, z: 0 };
  const zones = [{ minX: 4200, maxX: 4203, minY: 4200, maxY: 4203, z: 0, tags: ['safe'] }];
  commitMapEdit(new Map([['definitions/map-zones.json', JSON.stringify(zones)]]), data);
  commitMapEdit(new Map([['definitions/map-spawn.json', JSON.stringify(spawn)]]), data);
  assert.deepEqual(readWorldConfig().zones, zones);
  assert.deepEqual(readWorldConfig().spawn, spawn);
  assert.equal(readWorldConfig().experienceMultiplier, 4);
  commitMapEdit(new Map([['definitions/map-spawn.json', null]]), data);
  assert.deepEqual(readWorldConfig().spawn, { x: 3200, y: 3200, z: 0 });
  assert.equal(JSON.parse(fs.readFileSync(local)).experienceMultiplier, 4);
});
