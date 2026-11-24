const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../plugins/world/DistantWorld.plugin');
const point = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
function fixture(rows = [[1, 3250, 3200, 0]]) {
  const sent = [], local = [], npcs = new Map();
  let privateArea, main = true, boat, origin = point(3200, 3200);
  const definitions = rows.map(([id, x, y, plane]) => ({ getId: () => id, getPosition: () => point(x, y, plane), getRadius: () => 4 }));
  const core = {
    NpcSpawnDefinition: { all: () => definitions },
    CacheDefinitions: { getNpc: id => ({ id, name: '<col=red>Guard</col>', modelIds: [2] }) },
    World: { getNpcs: () => npcs }, BoatManager: { getBoatAboard: () => boat }, encodePluginMessage: (_channel, data) => data,
  };
  const player = { getLocation: () => origin, getPrivateArea: () => privateArea,
    getArea: () => ({ countsAsMainWorld: () => main }), getNpcViewDistance: () => 15,
    getPacketSender: () => ({}), getLocalNpcs: () => local, getSession: () => ({ sendClientPacket: data => sent.push(data) }) };
  let request = 0;
  const receive = (data, reset = true) => {
    if (reset) plugin._test.forget({ player });
    const event = { channel: 'distant-world', player, data, handled: false };
    plugin._test.receive({ core }, event); return event;
  };
  const catalog = () => receive({ type: 'catalog', request: ++request, radius: 384 });
  const npc = (index = 4, overrides = {}) => ({ isRegistered: () => true, isVisible: () => true,
    isOwnerOnly: () => false, getOwner: () => null, getPrivateArea: () => null, getArea: () => null,
    getIndex: () => index, getId: () => 1, getContentId: () => 1, getSpawnPosition: () => point(3250, 3200), ...overrides });
  return { core, player, sent, local, npcs, receive, catalog, npc,
    move: (x, y, plane) => { origin = point(x, y, plane); },
    context: (area, isMain = true, aboard) => { privateArea = area; main = isMain; boat = aboard; } };
}

test('bounded public catalog uses server origin, validates input and excludes other planes', () => {
  const f = fixture([[1, 3250, 3200, 0], [2, 3250, 3200, 1], [3, 9000, 9000, 0]]);
  for (const bad of [null, [], {}, { request: -1, type: 'catalog' }, { request: 1.2, type: 'catalog' }]) f.receive(bad);
  assert.equal(f.sent.length, 0);
  f.catalog();
  assert.equal(f.sent[0].spawns.length, 1);
  assert.equal(f.sent[0].spawns[0].name, 'Guard');
  assert.equal(f.sent[0].spawns[0].key, '1:3250:3200:0');
  assert.equal(f.sent[0].spawns[0].radius, 4);
  assert.equal(f.sent[0].viewDistance, 15);
});

test('catalog rate limiting and size caps do not widen authoritative local NPCs', () => {
  const f = fixture(Array.from({ length: plugin._test.MAX_SPAWNS + 100 }, (_, i) => [i + 1, 3300 + i % 30, 3200 + Math.floor(i / 30), 0]));
  f.catalog(); assert.equal(f.sent.flatMap(page => page.spawns).length, plugin._test.MAX_SPAWNS);
  assert.ok(f.sent.every(page => page.truncated === true));
  f.receive({ type: 'catalog', request: 2, radius: 999999 }, false);
  assert.equal(f.sent.length, Math.ceil(plugin._test.MAX_SPAWNS / 32));
  assert.equal(f.local.length, 0); assert.equal(f.npcs.size, 0);
});

test('instances, private areas and boat decks return no overworld proxies', () => {
  for (const context of [[{}, true], [null, false], [null, true, {}]]) {
    const f = fixture(); f.context(...context); f.catalog();
    assert.equal(f.sent[0].supported, false); assert.equal(f.sent[0].spawns.length, 0);
  }
});

test('resolving requires a previously advertised key and a unique, still-visible local object', () => {
  const f = fixture(), npc = f.npc(); f.local.push(npc); f.npcs.set(4, npc);
  f.catalog(); const key = f.sent[0].spawns[0].key;
  assert.deepEqual(f.sent[0].links, [{ key, index: 4 }]);
  f.receive({ type: 'resolve', request: 2, key: '1:9999:9999:0' }, false); assert.equal(f.sent.length, 1);
  // Each case uses a fresh subscription to avoid intentionally tripping the rate limit.
  for (const override of [{}, { isVisible: () => false }, { getOwner: () => ({}) }, { isOwnerOnly: () => true }, { getPrivateArea: () => ({}) }]) {
    const g = fixture(), n = g.npc(4, override); g.local.push(n); g.npcs.set(4, n); g.catalog();
    g.receive({ type: 'resolve', request: 3, key }, false);
    assert.equal(g.sent[1].index, Object.keys(override).length ? -1 : 4);
  }
  const g = fixture(), a = g.npc(), b = g.npc(5);
  g.local.push(a, b); g.npcs.set(4, a); g.npcs.set(5, b); g.catalog();
  g.receive({ type: 'resolve', request: 2, key }, false); assert.equal(g.sent[1].index, -1);
  const h = fixture(), stale = h.npc(); h.local.push(stale); h.npcs.set(4, h.npc()); h.catalog();
  h.receive({ type: 'resolve', request: 2, key }, false); assert.equal(h.sent[1].index, -1, 'index reuse is not a matching object');
});

test('player-specific transforms hide absent variants and advertise visible cache ids', () => {
  const f = fixture([[1, 3250, 3200, 0], [2, 3251, 3200, 0]]);
  f.core.CacheDefinitions.getNpc = id => ({ id, transforms: [3] });
  f.core.CacheDefinitions.resolveNpc = id => id === 1 ? { id: 3, name: 'Guard', modelIds: [4] } : undefined;
  f.catalog(); assert.deepEqual(f.sent[0].spawns.map(s => s.typeId), [3]);
});

test('spawn radii and facing preserve stationary NPCs and the canonical default for walkers', () => {
  const f = fixture([[1, 3250, 3200, 0], [2, 3251, 3200, 0]]);
  const rows = f.core.NpcSpawnDefinition.all();
  rows[0].getRadius = () => 0; rows[0].getFacing = () => point(0, 1);
  rows[1].getRadius = () => null;
  f.catalog();
  assert.equal(f.sent[0].spawns[0].radius, 0);
  assert.equal(f.sent[0].spawns[0].rotation, 1024);
  assert.equal(f.sent[0].spawns[1].radius, 5);
});

test('visible map squares take priority over nearer off-screen populations without widening the allowed radius', () => {
  const rows = Array.from({ length: plugin._test.MAX_SPAWNS + 20 }, (_, i) => [i + 1, 3230 + i % 20, 3200 + Math.floor(i / 20), 0]);
  const f = fixture([...rows, [5000, 3500, 3200, 0], [5001, 3900, 3200, 0]]);
  const map = (3500 >> 6) << 8 | (3200 >> 6);
  f.receive({ type: 'catalog', request: 1, radius: 384, maps: [map] });
  const spawns = f.sent.flatMap(page => page.spawns);
  assert.equal(spawns[0].typeId, 5000);
  assert.equal(spawns.some(s => s.typeId === 5001), false);
  assert.equal(f.local.length, 0);
  const bad = fixture(); bad.receive({ type: 'catalog', request: 1, maps: [NaN] });
  assert.equal(bad.sent.length, 0);
});

test('every catalog page fits the real 16 KiB UTF-8 plugin-message envelope', () => {
  const f = fixture(Array.from({ length: plugin._test.MAX_SPAWNS }, (_, i) => [i + 1, 3300 + i % 30, 3200 + Math.floor(i / 30), 0]));
  f.core.CacheDefinitions.getNpc = id => ({ id, name: '界'.repeat(80), modelIds: [1] });
  f.core.encodePluginMessage = (channel, data) => {
    assert.ok(Buffer.byteLength(JSON.stringify({ channel, data })) <= 16384);
    return data;
  };
  for (let i = 0; i < 255; i++) {
    const n = f.npc(i + 1, { getId: () => i + 1, getSpawnPosition: () => point(3300 + i % 30, 3200 + Math.floor(i / 30)) });
    f.local.push(n); f.npcs.set(i + 1, n);
  }
  f.catalog();
  assert.equal(f.sent.length, Math.ceil(plugin._test.MAX_SPAWNS / 32));
  assert.equal(f.sent.flatMap(page => page.spawns).length, plugin._test.MAX_SPAWNS);
  assert.ok(f.sent.every((page, i) => page.part === i && page.parts === f.sent.length && page.truncated === false));
});

test('unchanged Varrock spawn rows use one small link refresh with the shipped spawn data', t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const rows = require('../data/definitions/npc-spawns.json').map(({ id, x, y, level }) => [id, x, y, level]);
  const f = fixture(rows);
  f.move(3210, 3424);
  let typeLookups = 0;
  const getNpc = f.core.CacheDefinitions.getNpc;
  f.core.CacheDefinitions.getNpc = id => { typeLookups++; return getNpc(id); };
  const bytes = pages => pages.reduce((total, data) => total + Buffer.byteLength(JSON.stringify({ channel: 'distant-world', data })), 0);
  f.receive({ type: 'catalog', request: 1, radius: 384 });
  const full = f.sent.splice(0), fullBytes = bytes(full);
  assert.ok(fullBytes > 100000 && full.length === 32);
  const { revision } = full[0], staticLookups = typeLookups;
  const { key, x, y } = full[0].spawns[0];
  const [id] = key.split(':').map(Number);
  const npc = f.npc(4, { getId: () => id, getSpawnPosition: () => point(x, y) });
  f.local.push(npc); f.npcs.set(4, npc);
  now = 3000;
  f.receive({ type: 'catalog', request: 2, radius: 384, revision }, false);
  assert.deepEqual(f.sent, [{ type: 'links', request: 2, revision, viewDistance: 15, links: [{ key, index: 4 }] }]);
  const linkedBytes = bytes(f.sent.splice(0));
  assert.ok(linkedBytes < 200);
  f.local.length = 0;
  now += 3000;
  f.receive({ type: 'catalog', request: 3, radius: 384, revision }, false);
  assert.deepEqual(f.sent, [{ type: 'links', request: 3, revision, viewDistance: 15, links: [] }]);
  assert.ok(bytes(f.sent) < 120);
  assert.equal(typeLookups, staticLookups, 'static rows reuse their cached NPC types');
  t.diagnostic(`Full catalog ${fullBytes} bytes, single-link refresh ${linkedBytes} bytes, empty refresh ${bytes(f.sent)} bytes`);
});

test('catalog refreshes on square, radius and visible variant changes, with bounded full retransmits', t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const f = fixture([[1, 3260, 3200, 0], [2, 3328, 3200, 0], [3, 3200, 3200, 1]]);
  let variant = 10;
  const getNpc = f.core.CacheDefinitions.getNpc;
  f.core.CacheDefinitions.getNpc = id => id === 1 ? { id, transforms: [10, 11] } : getNpc(id);
  f.core.CacheDefinitions.resolveNpc = () => variant && getNpc(variant);
  const request = (time, radius, revision) => {
    now = time;
    f.receive({ type: 'catalog', request: time, radius, revision }, false);
    return f.sent.splice(0);
  };
  const full = (pages, ids) => {
    assert.equal(pages[0]?.type, 'catalog');
    assert.deepEqual(pages.flatMap(page => page.spawns.map(spawn => spawn.typeId)).sort((a, b) => a - b), ids);
    return pages[0].revision;
  };
  const links = (pages, revision) => assert.deepEqual(pages.map(page => [page.type, page.revision]), [['links', revision]]);
  let revision = full(request(0, 32), [10]);
  assert.deepEqual(request(750, 32), [], 'the old request rate can no longer trigger responses');
  f.move(3263, 3200);
  links(request(3000, 32, revision), revision);
  f.move(3264, 3200);
  revision = full(request(6000, 32, revision), [2, 10]);
  links(request(9000, 32, revision), revision);
  const wider = full(request(12000, 64, revision), [2, 10]);
  assert.notEqual(wider, revision, 'radius changes invalidate the catalog even with the same rows');
  variant = 11;
  links(request(15000, 64, wider), wider);
  revision = full(request(18000, 64, wider), [2, 11]);
  assert.notEqual(revision, wider);
  assert.deepEqual(request(21000, 1024), [], 'a missing acknowledgement cannot force a full catalog during cooldown');
  assert.equal(full(request(24000, 64), [2, 11]), revision, 'a missed page can recover the same revision');
  variant = undefined;
  links(request(27000, 64, revision), revision);
  revision = full(request(30000, 64, revision), [2]);
  f.move(3264, 3200, 1);
  links(request(33000, 64, revision), revision);
  assert.notEqual(full(request(36000, 64, revision), [3]), revision);
});
