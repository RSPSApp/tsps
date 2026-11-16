// Run after `yarn build`: node --test tests/temple-of-ikov-lucien-spawns.test.cjs
// Wiki (Temple of Ikov, Flying Horse Inn): the quest starts with Lucien at the Flying Horse Inn in
// East Ardougne; his house, where he takes the staff or is fought, is between Edgeville and the GE.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const register = require('../plugins/quests/quests/TempleOfIkov.Quest');

const INN_LUCIEN = 13608;
const HOUSE_LUCIEN = 13607;
const FLYING_HORSE_INN = { x: 2573, y: 3321, z: 0 };
const NEAR_EDGEVILLE = { x: 3122, y: 3483, z: 0 };

let login;
let quest;
const spawns = [];

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onPlayerLogin: (fn) => { login = fn; },
    spawnNpc: (spec) => { spawns.push(spec); return { id: spec.id }; },
    removeNpc() {},
  }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  register(api);
  quest = getRegisteredQuests().findLast((entry) => entry.key === 'temple_of_ikov');
});

function player() {
  const attributes = new Map(), varps = new Map(), varbits = new Map();
  const sender = new Proxy({
    sendConfig(id, value) { varps.set(id, value); return sender; },
    getVarp: (id) => varps.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
  }, { get: (t, p) => (p in t ? t[p] : () => sender) });
  return {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getUsername: () => 'ikovtester',
    isRegistered: () => true,
    sendMessage() {},
  };
}

const at = (spec) => ({ x: spec.x, y: spec.y, z: spec.z });

test('before the quest, the Lucien who starts it is at the Flying Horse Inn', () => {
  spawns.length = 0;
  login({ player: player() });
  const inn = spawns.filter((spec) => spec.id === INN_LUCIEN);
  assert.equal(inn.length, 1);
  assert.deepEqual(at(inn[0]), FLYING_HORSE_INN);
  assert.equal(spawns.some((spec) => spec.id === HOUSE_LUCIEN), false, 'no house Lucien before the start');
});

test('once started, the attackable Lucien waits at his house near Edgeville', () => {
  spawns.length = 0;
  const p = player();
  quest.setStage(p, 10);
  login({ player: p });
  const house = spawns.filter((spec) => spec.id === HOUSE_LUCIEN);
  assert.equal(house.length, 1);
  assert.deepEqual(at(house[0]), NEAR_EDGEVILLE);
  assert.deepEqual(at(spawns.find((spec) => spec.id === INN_LUCIEN)), FLYING_HORSE_INN);
});

// Qualification only: selected alone in a fresh HF process. This records actual cache
// geometry before choosing entrance coordinates or writing an interaction regression.
test('Ikov house active-cache qualification records its actual entrance geometry', () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { CacheMaps } = require('../dist/game/cache/CacheMaps');
  const { MapRegionReplacementManager } = require('../dist/game/collision/MapRegionReplacementManager');
  const crypto = require('node:crypto');
  const core = PluginManager.getCoreApi();
  const active = CachePipeline.getActive();
  assert.equal(active.name, 'osrs-242_2026-11-03');
  assert.equal(active.revision, 242);
  // No World players/NPCs, items, tasks or object hooks are installed by this case.
  // Refuse an already initialized region registry rather than resetting shared state.
  assert.equal(core.RegionManager.regions.size, 0, 'fresh isolated qualification process');
  core.RegionManager.init();
  const anchor = NEAR_EDGEVILLE, radius = 12;
  const regionId = ((anchor.x >> 6) << 8) | (anchor.y >> 6);
  const bytes = CacheMaps.getRegion(regionId);
  assert.ok(bytes?.terrainData && bytes?.objectData, 'actual active-cache region streams');
  core.RegionManager.loadMapFiles(anchor.x, anchor.y, false);
  assert.equal(core.RegionManager.regions.get(regionId)?.isLoaded(), true, 'real region loader reached');
  const definitions = [102, 11403].map(id => {
    const d = core.CacheDefinitions.getObject(id);
    assert.ok(d, 'actual cache loc definition ' + id);
    return { id, gameval: core.CacheDefinitions.getLocNames().get(id), name: d.name,
      actions: d.actions, models: d.models, sizeX: d.sizeX, sizeY: d.sizeY,
      clipType: d.clipType, clipMask: d.clipMask, blocksProjectile: d.blocksProjectile };
  });
  const objects = [];
  for (const list of core.MapObjects.mapObjects.values()) for (const object of list) {
    const at = object.getLocation();
    if (at.getZ() !== anchor.z || Math.abs(at.getX() - anchor.x) > radius
        || Math.abs(at.getY() - anchor.y) > radius) continue;
    const d = core.CacheDefinitions.getObject(object.getId());
    objects.push({ id: object.getId(), x: at.getX(), y: at.getY(), z: at.getZ(),
      shape: object.getType(), rotation: object.getFace(), gameval: core.CacheDefinitions.getLocNames().get(object.getId()),
      name: d?.name, actions: d?.actions });
    assert.ok(core.MapObjects.mapObjects.get(core.MapObjects.getHash(at.getX(), at.getY(), at.getZ()))?.includes(object),
      'observed exact object pointer remains in its canonical tile list');
  }
  objects.sort((a, b) => a.id - b.id || a.x - b.x || a.y - b.y || a.shape - b.shape || a.rotation - b.rotation);
  assert.ok(objects.length > 0 && objects.length <= 2048, 'bounded actual house surroundings');
  const collision = [];
  for (let x = anchor.x - radius; x <= anchor.x + radius; x++)
    for (let y = anchor.y - radius; y <= anchor.y + radius; y++)
      collision.push([x, y, anchor.z, core.RegionManager.getClipping(x, y, anchor.z, null)]);
  const digest = data => crypto.createHash('sha256').update(data).digest('hex');
  const record = { event: 'ikov-house-active-cache-578', cache: { name: active.name, revision: active.revision },
    anchor, radius, regionId, terrainSHA256: digest(bytes.terrainData), objectSHA256: digest(bytes.objectData),
    hasRegionReplacement: MapRegionReplacementManager.getReplacementMapData(regionId) != null,
    definitions, entranceCandidates: objects.filter(o => o.id === 102 || o.id === 11403), objects, collision,
    scope: 'Canonical cache definitions and production region placement/collision observation only; no Open, path, quest branch, authenticated login or retail transform/timing claim' };
  const encoded = JSON.stringify(record);
  assert.ok(Buffer.byteLength(encoded) <= 196608, 'complete metadata output fits declared bound');
  console.log(encoded);
});
