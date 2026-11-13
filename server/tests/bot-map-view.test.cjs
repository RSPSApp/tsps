const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRequestHandler } = require('../plugins/tools/worldadmin/Http.WorldAdmin');
const { tileUrl, visibleRegions, screenPoint, regionImageBounds, trailSegments, botsWithLocation, botsOnPlane, botColor } = require('../plugins/tools/worldadmin/panel/bot-map-view');

function mapRequestHandler() {
  return createRequestHandler({ token: 'm'.repeat(32), loopback: true, port: () => 43601 }, { catalog: () => ({ status: 200, body: {} }) }, []);
}

test('overhead map requests the same cache-backed minimap tiles as Host Local', () => {
  assert.equal(tileUrl(50, 50, 0), 'https://rsps.app/api/rsps/minimap?x=3232&y=3232&z=0&zoom=4&size=256');
  assert.equal(tileUrl(1, 2, 3, '/api/rsps/minimap'), '/api/rsps/minimap?x=96&y=160&z=3&zoom=4&size=256');
  assert.throws(() => tileUrl(100, 0, 0), /region X/);
  assert.throws(() => tileUrl(1, 2, 4), /plane/);
});

test('visible regions are nearest-first, clipped to the world and bounded', () => {
  const center = { x: 3232, y: 3232 };
  const visible = visibleRegions(center, 1024, 512, 8, 6);
  assert.equal(visible.length, 6);
  assert.deepEqual(visible[0], { regionX: 50, regionY: 50, distance: 0 });
  assert.ok(visible.every(region => region.regionX >= 0 && region.regionX <= 99 && region.regionY >= 0 && region.regionY <= 255));
  assert.deepEqual(visibleRegions({ x: -900, y: -500 }, 500, 500, 1), []);
  assert.deepEqual(visibleRegions(center, 0, 500, 1), []);
});

test('world tiles and map regions project north-up into the overhead viewport', () => {
  assert.deepEqual(screenPoint({ x: 3200, y: 3210 }, { x: 3200, y: 3210 }, 4, 800, 400), { x: 400, y: 200 });
  assert.deepEqual(regionImageBounds(50, 50, { x: 3200, y: 3200 }, 2, 800, 400), {
    left: 400, top: 72, width: 128, height: 128,
  });
});

test('overhead bot roster matches plane markers and uses stable marker colors', () => {
  const bots = [
    { username: 'zeta', location: { x: 3200, y: 3200, z: 0 } },
    { username: 'alpha', location: { x: 3201, y: 3200, z: 0 } },
    { username: 'upstairs', location: { x: 3200, y: 3200, z: 1 } },
  ];
  assert.deepEqual(botsWithLocation(bots).map(bot => bot.username), ['alpha', 'upstairs', 'zeta']);
  assert.deepEqual(botsOnPlane(bots, 0).map(bot => bot.username), ['alpha', 'zeta']);
  assert.equal(botColor(bots, 'alpha', 0), '#e7c66e');
  assert.equal(botColor([...bots].reverse(), 'zeta', 0), '#7fc5a1');
  assert.equal(botColor(bots, 'upstairs', 0), '#e7c66e');
});

test('trails split at plane changes, teleports and stale sample gaps', () => {
  const points = [
    { x: 3200, y: 3200, z: 0, at: 0 }, { x: 3201, y: 3200, z: 0, at: 1000 },
    { x: 3202, y: 3200, z: 0, at: 40000 }, { x: 3300, y: 3200, z: 0, at: 41000 },
    { x: 3301, y: 3200, z: 1, at: 42000 },
  ];
  assert.deepEqual(trailSegments(points, 0).map(segment => segment.length), [2, 1, 1]);
  assert.deepEqual(trailSegments(points, 1).map(segment => segment.length), [1]);
});

test('the authenticated local panel serves the overhead map module as an approved asset', async () => {
  const token = 'm'.repeat(32);
  const route = mapRequestHandler();
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = '/panel/bot-map-view.js';
  req.headers = { host: 'localhost:43601', authorization: `Bearer ${token}` };
  const res = { status: null, headers: null, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = String(body); } };
  await route(req, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'application/javascript; charset=utf-8');
  assert.match(res.body, /LocalBotMapView/);
});
