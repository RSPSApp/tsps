const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const { MapRegionReplacementManager } = require("../dist/game/collision/MapRegionReplacementManager");

const REGION_REPLACEMENT = 144;
const REGION_REPLACEMENT_COMPRESSED = 147;
const MAX_PAYLOAD = 0xfffd;

function capture() {
  const frames = [];
  return {
    frames,
    player: {
      getSession: () => ({
        sendClientPacket: (frame) => {
          frames.push(frame);
          return true;
        },
      }),
    },
  };
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  let seed = 123456789;
  for (let index = 0; index < bytes.length; index++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    bytes[index] = seed & 0xff;
  }
  return bytes;
}

// Falador's 12084 is 82,249 raw bytes from the cache alone: it has to be deflated, because
// a raw REGION_REPLACEMENT payload cannot exceed 65,533.
{
  const regionId = 12084;
  const terrain = new Uint8Array(80_000);
  for (let index = 0; index < terrain.length; index++) terrain[index] = index & 0xff;
  const objects = Uint8Array.from([1, 2, 3, 4]);
  assert.doesNotThrow(
    () => MapRegionReplacementManager.replaceMapRegionData(regionId, terrain, objects, "test"),
    "a dense region registers instead of being refused"
  );
  const { frames, player } = capture();
  assert.equal(MapRegionReplacementManager.sendReplacementToPlayer(player, regionId, true), true);
  const frame = frames[0];
  assert.equal(frame[0], REGION_REPLACEMENT_COMPRESSED, "dense regions stream the compressed packet");
  const length = frame.readUInt16BE(1);
  assert.equal(length, frame.length - 3);
  assert.ok(length <= MAX_PAYLOAD, `payload ${length} fits the 64 KiB frame`);
  assert.equal(frame.readUInt16BE(3), regionId);
  assert.equal(frame[5], 1, "allowReload is in the compressed payload too");
  assert.equal(frame.readUInt32BE(6), terrain.length);
  assert.equal(frame.readUInt32BE(10), objects.length);
  const inflated = zlib.inflateSync(frame.subarray(14));
  assert.deepEqual([...inflated.subarray(0, terrain.length)], [...terrain]);
  assert.deepEqual([...inflated.subarray(terrain.length)], [...objects]);
}

// allowReload=false changes only the flag byte, so the traffic stays identical.
{
  const regionId = 12084;
  const { frames, player } = capture();
  assert.equal(MapRegionReplacementManager.sendReplacementToPlayer(player, regionId, false), true);
  assert.equal(frames[0].readUInt16BE(3), regionId);
  assert.equal(frames[0][5], 0);
}

// A region that fits keeps the original uncompressed packet.
{
  const regionId = 12086;
  const terrain = Uint8Array.from([1, 2, 3]);
  const objects = Uint8Array.from([4, 5]);
  MapRegionReplacementManager.replaceMapRegionData(regionId, terrain, objects, "test");
  const { frames, player } = capture();
  assert.equal(MapRegionReplacementManager.sendReplacementToPlayer(player, regionId, true), true);
  const frame = frames[0];
  assert.equal(frame[0], REGION_REPLACEMENT);
  const length = frame.readUInt16BE(1);
  assert.equal(length, frame.length - 3);
  assert.equal(frame.readUInt16BE(3), regionId);
  assert.equal(frame[5], 1);
  assert.equal(frame.readUInt16BE(6), terrain.length);
  assert.equal(frame.readUInt16BE(8), objects.length);
  assert.deepEqual([...frame.subarray(10)], [...terrain, ...objects]);
}

// Data that even deflate cannot shrink is refused at registration, not while sending.
{
  const regionId = 12087;
  assert.throws(
    () => MapRegionReplacementManager.replaceMapRegionData(regionId, randomBytes(80_000), null, "test"),
    /too large to stream/,
    "an unsendable region never enters the replacement list"
  );
  assert.ok(!MapRegionReplacementManager.getRegionIds().includes(regionId));
}

// Even highly compressible data must fit the client's raw output budget.
{
  const regionId = 12088;
  const limit = 16 * 1024 * 1024;
  assert.doesNotThrow(() => MapRegionReplacementManager.replaceMapRegionData(regionId, new Uint8Array(limit), null, "test"));
  const { frames, player } = capture();
  MapRegionReplacementManager.sendReplacementToPlayer(player, regionId, true);
  assert.equal(frames[0].readUInt32BE(6), limit);
  assert.throws(() => MapRegionReplacementManager.replaceMapRegionData(regionId, new Uint8Array(limit), new Uint8Array([0]), "test"), /invalid section lengths/);
  assert.equal(MapRegionReplacementManager.getReplacementMapData(regionId).terrainData.length, limit,
    "an oversized update must leave the previous valid replacement intact");
  assert.throws(() => MapRegionReplacementManager.replaceMapRegionData(regionId, new Uint8Array(), null, "test"), /invalid section lengths/);
}

console.log("Region replacement packet tests passed");
