const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodeSprite, encodePng } = require('../plugins/tools/worldadmin/ItemIcons.WorldAdmin')._test;
const { botRoutes } = require('../plugins/tools/worldadmin/Bots.WorldAdmin');

function onePixelSprite() {
  return Buffer.from([
    0, 1, 0, 1, 1, // flags and a 2x2 indexed frame
    255, 0, 0, // palette entry 1: red
    0, 2, 0, 2, 1, // canvas width, height, palette size minus one
    0, 0, 0, 0, // x and y offsets
    0, 2, 0, 2, // frame width and height
    0, 1, // frame count
  ]);
}

function request(url) {
  return { method: 'GET', headers: {}, url };
}
function response() {
  return { status: null, body: null, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
}

test('cache sprite decoder produces a transparent indexed icon as PNG', () => {
  const sprite = decodeSprite(onePixelSprite());
  assert.equal(sprite.width, 2);
  assert.equal(sprite.height, 2);
  assert.deepEqual([...sprite.pixels], [1, 0, 1, 1]);
  const png = encodePng(sprite);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8, compressed;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') compressed = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  const rgba = zlib.inflateSync(compressed);
  assert.deepEqual([...rgba], [0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255]);
  assert.equal(decodeSprite(onePixelSprite(), 1), null);
});

test('cache item IDs are not treated as raw sprite archive IDs when no item icon is mapped', async () => {
  const id = 1511;
  const core = {
    CacheDefinitions: { hasDefinition: () => true, getItem: () => ({}) },
    CachePipeline: { getStore: () => ({}) },
    CacheIndexDat2: { fromStore: () => ({ getArchiveId: () => -1, getFile: (archive, file) => archive === id && file === 0 ? { data: onePixelSprite() } : undefined }) },
  };
  const res = response();
  await assert.rejects(
    botRoutes(request(`/api/bots/item-icon?id=${id}`), res, new URL(`http://localhost/api/bots/item-icon?id=${id}`), { core }),
    error => error.status === 404 && /No cached inventory sprite/.test(error.message),
  );
});

test('authenticated bots icon route serves a cache-derived local data URI', async () => {
  const id = 2147483000;
  const spriteData = onePixelSprite();
  const core = {
    CacheDefinitions: { hasDefinition: () => true, getItem: () => ({}) },
    CachePipeline: { getStore: () => ({}) },
    CacheIndexDat2: { fromStore: () => ({ getArchiveId: token => token === `inv,${id}` ? (5 << 16) | 7 : -1, getFile: (archive, file) => archive === 5 && file === 7 ? { data: spriteData } : undefined }) },
  };
  const res = response();
  assert.equal(await botRoutes(request(`/api/bots/item-icon?id=${id}`), res, new URL(`http://localhost/api/bots/item-icon?id=${id}`), { core }), true);
  assert.equal(res.status, 200);
  assert.equal(res.body.id, id);
  assert.match(res.body.src, /^data:image\/png;base64,/);
});
