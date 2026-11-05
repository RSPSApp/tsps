// Archived animation definitions: retired event sequences whose ids the
// current cache recycled must travel with their NPC/loc bundle and be rebound.
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { ArchivedDefinitionRegistry } = require('../dist/game/cache/codec/rs/config/ArchivedDefinitionRegistry');
const { ArchivedTypeLoader } = require('../dist/game/cache/codec/rs/config/ArchivedTypeLoader');
const { ArchiveTypeLoader } = require('../dist/game/cache/codec/rs/config/TypeLoader');
const { CacheIndexDat2 } = require('../dist/game/cache/codec/rs/cache/CacheIndex');
const { ArchiveNpcTypeLoader } = require('../dist/game/cache/codec/rs/config/npctype/NpcTypeLoader');
const { ArchiveLocTypeLoader } = require('../dist/game/cache/codec/rs/config/loctype/LocTypeLoader');
const { ArchiveObjTypeLoader } = require('../dist/game/cache/codec/rs/config/objtype/ObjTypeLoader');
const { NpcType } = require('../dist/game/cache/codec/rs/config/npctype/NpcType');
const { LocType } = require('../dist/game/cache/codec/rs/config/loctype/LocType');
const { SeqType } = require('../dist/game/cache/codec/rs/config/seqtype/SeqType');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const raw = require('./fixtures/archived-anniversary-sequences.json');

let info, natives, archives, counts;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const active = CachePipeline.getActive();
  info = { name: active.name, game: 'oldschool', environment: 'live', revision: active.revision, timestamp: active.timestamp, size: 0 };
  const configs = CacheIndexDat2.fromStore(2, CachePipeline.getStore());
  archives = { npc: configs.getArchive(9), loc: configs.getArchive(6), obj: configs.getArchive(10), seq: configs.getArchive(12) };
  natives = {
    npc: new ArchiveNpcTypeLoader(info, archives.npc), loc: new ArchiveLocTypeLoader(info, archives.loc),
    obj: new ArchiveObjTypeLoader(info, archives.obj), seq: new ArchiveTypeLoader(SeqType, info, archives.seq),
  };
  counts = Object.fromEntries(Object.entries(natives).map(([kind, loader]) => [kind, loader.getCount()]));
});
function context(withSeq = true) {
  const { seq, ...rest } = counts;
  return {
    cacheInfo: info,
    counts: withSeq ? { ...rest, seq } : rest,
    currentDefinition: (kind, id) => ({ name: kind === 'seq' ? '' : natives[kind].load(id).name, data: archives[kind].getFile(id)?.data }),
  };
}
function bundle(rows = raw.definitions) {
  const next = { ...counts };
  return {
    id: 'anniversary-2026',
    targetCache: { name: info.name, game: info.game, revision: info.revision },
    sourceCache: { ...info, name: 'osrs-236_2026-02-25', revision: 236, timestamp: '2026-02-25T11:45:19Z' },
    definitions: rows.map(row => ({
      kind: row.kind, symbol: row.symbol, sourceId: row.id, id: next[row.kind]++,
      dataBase64: row.sourceBytes, crc: zlib.crc32(Buffer.from(row.sourceBytes, 'base64')),
    })),
  };
}
function view(registry, kind, Constructor) {
  return new ArchivedTypeLoader(natives[kind], Constructor, id => registry.getSource(kind, id), () => registry.getCount(kind));
}

test('a recycled sequence id is rebound to the bundled original, not the current animation', () => {
  const registry = new ArchivedDefinitionRegistry(context());
  registry.replace([bundle()]);
  const npc = view(registry, 'npc', NpcType), loc = view(registry, 'loc', LocType), seq = view(registry, 'seq', SeqType);
  const swirl = registry.resolve('anniversary-2026', 'seq', '25th_portal_swirl');
  const pulse = registry.resolve('anniversary-2026', 'seq', '25th_spotlight_pulsate_1');
  assert.equal(swirl, counts.seq);
  assert.equal(registry.getCount('seq'), counts.seq + 2);
  const portal = npc.load(registry.resolve('anniversary-2026', 'npc', '25th_portal_model'));
  assert.equal(portal.name, '<col=00ffff>Portal</col>');
  assert.equal(portal.idleSeqId, swirl);
  assert.equal(portal.walkSeqId, swirl);
  assert.equal(loc.load(registry.resolve('anniversary-2026', 'loc', '25th_spotlight_1')).seqId, pulse);
  // The original swirl plays frame group 13371, which rev241 still holds unchanged;
  // the recycled native id 13719 now names a different (transmutation) animation.
  assert.deepEqual([...new Set(seq.load(swirl).frameIds.map(id => id >>> 16))], [13371]);
  assert.notDeepEqual(natives.seq.load(13719).frameIds, seq.load(swirl).frameIds);
  assert.equal(seq.load(13719), natives.seq.load(13719));
});

test('animations the bundle does not carry stay on their current native ids', () => {
  const registry = new ArchivedDefinitionRegistry(context());
  registry.replace([bundle()]);
  const gary = view(registry, 'npc', NpcType).load(registry.resolve('anniversary-2026', 'npc', '25th_host_model'));
  assert.equal(gary.name, 'Gary');
  assert.equal(gary.idleSeqId, CacheDefinitions.getSeqId('human_staffready'));
  assert.equal(gary.walkSeqId, CacheDefinitions.getSeqId('human_halberdwalk_f'));
});

test('a portal bundled without its swirl keeps the native id instead of failing or guessing', () => {
  const registry = new ArchivedDefinitionRegistry(context());
  registry.replace([bundle(raw.definitions.filter(row => row.kind !== 'seq'))]);
  const portal = view(registry, 'npc', NpcType).load(registry.resolve('anniversary-2026', 'npc', '25th_portal_model'));
  assert.equal(portal.idleSeqId, 13719);
});

test('a context without a native sequence count rejects archived sequences atomically', () => {
  const registry = new ArchivedDefinitionRegistry(context(false));
  assert.throws(() => registry.replace([bundle()]), /native sequence count/);
  assert.equal(registry.getBundles().length, 0);
  registry.replace([bundle(raw.definitions.filter(row => row.kind !== 'seq'))]);
  assert.equal(registry.getCount('seq'), 0);
});

test('digit-leading cache symbols are accepted; malformed symbols are not', () => {
  const registry = new ArchivedDefinitionRegistry(context());
  registry.replace([bundle()]);
  assert.notEqual(registry.resolve('anniversary-2026', 'npc', '25th_host_model'), null);
  for (const symbol of ['', '25th-host', '25th host', 'a.b']) {
    const candidate = bundle();
    candidate.definitions[0].symbol = symbol;
    assert.throws(() => new ArchivedDefinitionRegistry(context()).replace([candidate]), /symbol/);
  }
});

test('the production server registry appends archived sequences after the native table', () => {
  const before = CacheDefinitions.getCounts().seqs;
  assert.equal(before, counts.seq);
  const changes = CacheDefinitions.getDefinitionArchiveChanges([bundle()]);
  assert.deepEqual(changes.seq, [counts.seq, counts.seq + 1]);
  assert.equal(CacheDefinitions.getCounts().seqs, before);
});
