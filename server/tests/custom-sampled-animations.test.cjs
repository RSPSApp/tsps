const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { crc32, deflateSync } = require("node:zlib");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
const ItemDefinitionLoader = require("../plugins/items/ItemDefinitionLoader.plugin");

const id = 51000;
const source = "sampled-test";
const editorRow = {
  id, name: "editor-test-sequence",
  data: Buffer.from([1, 0, 1, 0, 7, 0, 113, 0, 0, 0]).toString("base64"),
};
const key = "customSampledAnimations";
let active;

before(async () => {
  active = await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function sampledRows(seed, vertexCount = 1) {
  const poses = Buffer.alloc(vertexCount * 6);
  for (let i = 0; i < poses.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    poses[i] = seed >>> 24;
  }
  const compressed = deflateSync(poses);
  let hash = 2166136261;
  for (const byte of compressed) hash = Math.imul(hash ^ byte, 16777619);
  const parts = compressed.toString("base64").match(/.{1,32000}/g);
  return parts.map((data, part) => ({
    id, modelId: 1100000, vertexCount, frameLengths: [3], loop: false,
    part, total: parts.length, hash: (hash >>> 0).toString(16), data,
  }));
}

test("native and editor sequence ids cannot be registered as sampled animations", () => {
  const input = sampledRows(23);
  const nativeId = CacheDefinitions.getSeqId("zgs_special_player");
  assert.ok(nativeId >= 0);
  assert.throws(() => CacheDefinitions.registerSampledAnimations(input.map(row => ({ ...row, id: nativeId })), source), /animation/);

  CacheDefinitions.registerCustomAnimations([editorRow], []);
  try {
    assert.throws(() => CacheDefinitions.registerSampledAnimations(input, source), /already/);
    assert.equal(CacheDefinitions.getSeqId(editorRow.name), id);
    assert.deepEqual(CacheDefinitions.getSeq(id).frameLengths, [7]);
  } finally {
    CacheDefinitions.registerCustomAnimations([], []);
    CacheDefinitions.registerSampledAnimations([], source);
  }
});

test("editor and archived sequences cannot replace a sampled source's id", () => {
  const otherId = id + 1;
  const archive = [{
    id: "sampled-collision",
    targetCache: { name: active.name, game: "oldschool", revision: active.revision },
    sourceCache: { ...active, game: "oldschool", environment: "live", size: 0 },
    definitions: [{
      kind: "seq", id, sourceId: 1, symbol: "archived_sequence",
      dataBase64: "AA==", crc: crc32(Buffer.from([0])),
    }],
  }];
  CacheDefinitions.registerSampledAnimations(sampledRows(19), source);
  try {
    assert.throws(() => CacheDefinitions.registerCustomAnimations([editorRow], []), /sampled/);
    assert.throws(() => CacheDefinitions.getDefinitionArchiveChanges(archive), /sampled/);
    assert.throws(() => CacheDefinitions.registerDefinitionArchives(archive), /sampled/);
    assert.deepEqual(CacheDefinitions.getSeq(id).frameLengths, [3]);
    assert.equal(CacheDefinitions.getSeqId(editorRow.name), null);
    assert.deepEqual(CacheDefinitions.getDefinitionArchiveBundles(), []);

    // Collision checks use actual archived ids, leaving unallocated ids below the archived ceiling free.
    archive[0].definitions[0].id = otherId;
    CacheDefinitions.registerDefinitionArchives(archive);
    CacheDefinitions.registerSampledAnimations(sampledRows(42), source);
    assert.deepEqual(CacheDefinitions.getSeq(id).frameLengths, [3]);
    assert.throws(() => CacheDefinitions.registerSampledAnimations(
      sampledRows(42).map(row => ({ ...row, id: otherId })), source,
    ), /already/);
    assert.deepEqual(CacheDefinitions.getSeq(id).frameLengths, [3], "a rejected update preserves the old source");
  } finally {
    CacheDefinitions.registerCustomAnimations([], []);
    CacheDefinitions.registerDefinitionArchives([]);
    CacheDefinitions.registerSampledAnimations([], source);
  }
});

test("login packs sampled rows together without exceeding the content packet's short length", () => {
  const registered = sampledRows(73, 24000);
  const sent = [];
  let login;
  ItemDefinitionLoader.register({
    log() {},
    registerContentEndpoint() {},
    onPlayerLogin(fn) { login = fn; },
  });
  CacheDefinitions.registerSampledAnimations(registered, source);
  try {
    const player = { getPacketSender: () => ({ sendContentData(packetSource, datasets) {
      if (datasets.some(dataset => dataset.key === key)) {
        const packet = encodeContentData(packetSource, datasets);
        assert.equal(packet.readUInt16BE(1), packet.length - 3);
        sent.push(datasets);
      }
    } }) };
    login({ player });
    const resetAndRows = sent.flat().filter(dataset => dataset.key === key);
    assert.deepEqual(resetAndRows[0].rows, []);
    assert.deepEqual(resetAndRows.slice(1).flatMap(dataset => dataset.rows), registered);
    assert.ok(sent.length > 1 && sent.length < registered.length, "near-limit rows are batched across multiple packets");
  } finally {
    CacheDefinitions.registerSampledAnimations([], source);
  }
});
