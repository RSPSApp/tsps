#!/usr/bin/env node
// Extract the native 25th Anniversary event (2026 birthday) content from a
// separately retained Jagex cache2468 (rev236, 25 February 2026) reference.
// Never reads test fixtures or writes the active cache. See
// docs/anniversary-2026-source.md for the reference layout and what is excluded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const server = path.resolve(__dirname, '..');
require('../dist/Server').Server.installProductionPathResolver();
const codec = '../dist/game/cache/codec/rs/';
const {ArchivedDefinitionRegistry} = require(codec+'config/ArchivedDefinitionRegistry');
const {decodeArchivedType, archivedSeqFields} = require(codec+'config/ArchivedTypeLoader');
const {NpcType} = require(codec+'config/npctype/NpcType');
const {LocType} = require(codec+'config/loctype/LocType');
const {SeqType} = require(codec+'config/seqtype/SeqType');
const {ObjType} = require(codec+'config/objtype/ObjType');
const {VarBitType} = require(codec+'config/vartype/bit/VarBitType');
const {FileStore} = require(codec+'cache/store/FileStore');
const {CacheIndexDat2} = require(codec+'cache/CacheIndex');
const {ByteBuffer} = require(codec+'io/ByteBuffer');
const {ArchiveTypeLoader} = require(codec+'config/TypeLoader');

const BUNDLE = 'anniversary-2026';
const REVISION = 236, CACHE = 2468, COMMIT = '7d9e9efe62d91d32345a0ccb0c4da396ea329f8e';
const kinds = ['npc','loc','seq'];
const constructors = {npc:NpcType, loc:LocType, seq:SeqType};
const groups = {npc:9, loc:6, seq:12};
// Realm of Memories map squares (plane 2): blank in rev241, so terrain and locs return wholesale.
const REALM = [[28,96],[28,97],[29,96],[29,97]].map(([x,y]) => (x<<8)|y);
// Event-window additions are placed only in their original live map squares.
const EVENT_LOC = /^(25th_|birthday|osb10_bunting|holiday_event_icon$)/;
// Old-model Realm creatures and Big Mo use models and frame groups that rev241
// recycled for unrelated content. Their bytes cannot be shown faithfully with
// definitions alone, so they are excluded rather than drawn with wrong assets.
const EXCLUDED_NPC = /^25th_anniversary_(dragon_|demon_|scorpion|kingscorpion|orc|lizardman|troll|cave_bug_|kalphite_queen_|fire_giant|hill_giant|goblin|bigmo)/;
// Live in rev241 under the same identity: the post-event cat stays a native NPC.
const NATIVE_NPC = new Set(['25th_cat']);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function parseSymbols(text) {
  // Cache gamevals may start with a digit (25th_host_model).
  const ids = new Map(), names = new Set();
  for (const match of text.matchAll(/^\/\/ (\d+)\s*\r?\n\[([a-zA-Z0-9_]+)\]/gm)) {
    const id = Number(match[1]), symbol = match[2];
    if (ids.has(id) || names.has(symbol)) throw new Error('Duplicate source symbol/id: '+symbol);
    ids.set(id, symbol); names.add(symbol);
  }
  if (!ids.size) throw new Error('No source symbols found');
  return ids;
}
function verifyFile(file, expected) {
  const bytes = fs.readFileSync(file);
  if (bytes.length !== expected.size) throw new Error('Source byte length mismatch: '+expected.name);
  if (digest(bytes).toLowerCase() !== expected.sha256.toLowerCase()) throw new Error('Source hash checksum mismatch: '+expected.name);
  return bytes;
}
function rawGroup(store, index, group) {
  try {
    const data = store.read(index, group);
    if (!data || !data.length) return null;
    const bytes = Buffer.from(data);
    // A stored container carries a trailing two-byte version; compare payloads only.
    return bytes.subarray(0, bytes.length - 2);
  } catch { return null; }
}
function decodeLocs(data) {
  const rows = [], buffer = new ByteBuffer(data);
  let id = -1, delta;
  while ((delta = buffer.readSmart3()) !== 0) {
    id += delta;
    let position = 0, change;
    while ((change = buffer.readUnsignedSmart()) !== 0) {
      position += change - 1;
      rows.push({id, position, flags: buffer.readUnsignedByte()});
    }
  }
  assert.equal(buffer.remaining, 0, 'Trailing original map bytes');
  return rows;
}
function seqFrameGroups(type) {
  return [...new Set([...(type.frameIds ?? []), ...(type.chatFrameIds ?? [])].map(id => id >>> 16))];
}

async function extractAnniversary(reference) {
  const {CachePipeline} = require('../dist/game/cache/CachePipeline');
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const source = readJson(path.join(reference, 'SOURCE.json'));
  assert.equal(source.commit, COMMIT);
  assert.equal(source.revision, REVISION);
  assert.equal(source.openrs2Id, CACHE);
  const symbols = {};
  for (const kind of ['npc','loc','obj','varbit','seq']) {
    const row = source.files.find(row => row.name === 'dump.'+kind);
    assert.ok(row, 'Missing source symbols '+kind);
    symbols[kind] = parseSymbols(verifyFile(path.join(reference, row.name), row).toString('utf8'));
  }
  for (const row of source.cacheFiles) verifyFile(path.join(reference, 'full', row.name), row);
  const keys = readJson(path.join(reference, 'full/keys.json'));
  const oldStore = new FileStore(path.join(reference, 'full/cache'));
  const oldConfigs = CacheIndexDat2.fromStore(2, oldStore), oldMaps = CacheIndexDat2.fromStore(5, oldStore);
  const old = Object.fromEntries(kinds.map(kind => [kind, oldConfigs.getArchive(groups[kind])]));

  await CachePipeline.initialize(server);
  const active = CachePipeline.getActive(), store = CachePipeline.getStore();
  const cacheInfo = {name:active.name, game:'oldschool', environment:'live', revision:active.revision, timestamp:active.timestamp, size:0};
  const configs = CacheIndexDat2.fromStore(2, store);
  const current = Object.fromEntries(kinds.map(kind => [kind, configs.getArchive(groups[kind])]));
  const natives = Object.fromEntries(kinds.map(kind => [kind, new ArchiveTypeLoader(constructors[kind], cacheInfo, current[kind])]));
  // This bundle carries no items (the rewards are live); the obj count only bounds validation.
  const objCount = new ArchiveTypeLoader(ObjType, cacheInfo, configs.getArchive(10)).getCount();
  const context = {cacheInfo, counts:{npc:natives.npc.getCount(), loc:natives.loc.getCount(), obj:objCount, seq:natives.seq.getCount()},
    currentDefinition:(kind,id) => ({name: kind === 'seq' ? '' : natives[kind].load(id).name, data: current[kind].getFile(id)?.data})};
  const sourceCache = {...cacheInfo, name:'osrs-236_2026-02-25', revision:REVISION, timestamp:source.cacheTimestamp};
  const oldBytes = (kind, id) => old[kind].getFile(id)?.data;
  const sameAsCurrent = (kind, id) => {
    const a = oldBytes(kind, id), b = current[kind].getFile(id)?.data;
    return !!a && !!b && Buffer.from(a).equals(Buffer.from(b));
  };
  const decodeOld = (kind, id) => decodeArchivedType(constructors[kind], id, {cacheInfo:sourceCache, dataBase64:Buffer.from(oldBytes(kind, id)).toString('base64')});

  // Map placements: every event-window loc in live squares, and the Realm wholesale.
  const locSymbol = id => symbols.loc.get(id);
  const currentKeys = readJson(path.join(active.directory, 'keys.json'));
  const currentMaps = CacheIndexDat2.fromStore(5, store);
  const placements = [], realm = [];
  for (const key of keys) {
    if (!key.name.startsWith('l')) continue;
    const region = key.mapsquare, x = region >> 8, y = region & 255;
    const rows = decodeLocs(oldMaps.getArchive(key.group, key.key).getFile(0).data);
    if (REALM.includes(region)) {
      const terrain = Buffer.from(oldMaps.getArchive(oldMaps.getArchiveId('m'+x+'_'+y)).getFile(0).data);
      realm.push({region, terrain, rows});
      continue;
    }
    const hits = rows.filter(row => EVENT_LOC.test(locSymbol(row.id) ?? ''));
    if (!hits.length) continue;
    let live = [];
    try { live = decodeLocs(currentMaps.getArchive(region, currentKeys[region] ?? [0,0,0,0]).getFile(1).data); } catch {}
    const present = new Set(live.map(row => `${row.id}@${row.position}:${row.flags}`));
    for (const row of hits) {
      // Same id in the same place is the live map's own object unless the id was recycled.
      if (sameAsCurrent('loc', row.id) && present.has(`${row.id}@${row.position}:${row.flags}`)) continue;
      placements.push({symbol:locSymbol(row.id), sourceId:row.id, x:x*64+((row.position>>6)&63), y:y*64+(row.position&63), z:row.position>>12, shape:row.flags>>2, rotation:row.flags&3});
    }
  }
  assert.deepEqual(realm.map(row => row.region).sort(), [...REALM].sort(), 'Original Realm of Memories squares');

  // Definition roots: event NPCs/locs, recycled decoration locs and changed Realm locs.
  const roots = [], excluded = [];
  // Native actors that the event re-wired onto its own varbits (BigRedJapan only gains
  // Talk-to from 25th_progress 5): their event-era definitions travel with the bundle.
  for (const kind of ['npc','loc']) {
    const text = fs.readFileSync(path.join(reference, 'dump.'+kind), 'utf8');
    for (const block of text.split(/^(?=\/\/ \d+\s*$)/m)) {
      const head = /^\/\/ (\d+)\s*\r?\n\[([a-zA-Z0-9_]+)\]/.exec(block);
      if (head && !head[2].startsWith('25th_') && /^multivar=25th_/m.test(block)) roots.push({kind, id:Number(head[1])});
    }
  }
  for (const [id, symbol] of symbols.npc) {
    if (!symbol.startsWith('25th_')) continue;
    if (NATIVE_NPC.has(symbol)) { assert.equal(natives.npc.load(id).name, 'Sookie', 'Native post-event cat'); continue; }
    if (EXCLUDED_NPC.test(symbol)) { excluded.push({kind:'npc', symbol, reason:'models/frames recycled by rev241'}); continue; }
    roots.push({kind:'npc', id});
  }
  const locIds = new Set([...placements.map(row => row.sourceId), ...realm.flatMap(square => square.rows.map(row => row.id))]);
  for (const [id, symbol] of symbols.loc) if (symbol.startsWith('25th_')) locIds.add(id);
  for (const id of locIds) if (!sameAsCurrent('loc', id)) roots.push({kind:'loc', id});

  const selected = new Map(), queue = [...roots], modelIds = new Set(), currentAssets = new Set(), seqChecks = [];
  for (let index = 0; index < queue.length; index++) {
    const row = queue[index], key = row.kind+':'+row.id;
    if (selected.has(key)) continue;
    const bytes = oldBytes(row.kind, row.id);
    if (!bytes) throw new Error('Missing source definition '+key);
    const symbol = symbols[row.kind].get(row.id);
    if (!symbol) throw new Error('Missing original symbolic identity '+key);
    if (row.kind === 'npc' && EXCLUDED_NPC.test(symbol)) throw new Error('Excluded actor is referenced by '+key);
    const type = decodeOld(row.kind, row.id);
    selected.set(key, {kind:row.kind, sourceId:row.id, symbol, dataBase64:Buffer.from(bytes).toString('base64'), crc:zlib.crc32(bytes)});
    if (row.kind === 'seq') {
      // Archived sequences only travel when their frames are still the originals.
      for (const group of seqFrameGroups(type)) {
        const a = rawGroup(oldStore, 0, group), b = rawGroup(store, 0, group);
        if (!a || !b || !a.equals(b)) throw new Error(`Sequence ${symbol} frame group ${group} changed`);
      }
      if (type.skeletalId >= 0) throw new Error('Skeletal archived sequence '+symbol+' is unsupported');
      seqChecks.push({symbol, sourceId:row.id, frameGroups:seqFrameGroups(type)});
      continue;
    }
    for (const id of (type.transforms ?? []).filter(id => id >= 0)) queue.push({kind:row.kind, id});
    const native = type;
    for (const field of archivedSeqFields(row.kind)) {
      const id = native[field];
      if (id >= 0 && !sameAsCurrent('seq', id)) queue.push({kind:'seq', id});
    }
    for (const id of [type.modelIds ?? type.models ?? [], type.chatheadModelIds ?? []].flat(Infinity)) if (Number.isInteger(id) && id >= 0) modelIds.add(id);
    // A live native the event re-wired keeps its current look: its models are current assets.
    if (row.id < natives[row.kind].getCount() && !symbol.startsWith('25th_')) {
      const live = natives[row.kind].load(row.id);
      for (const id of [live.modelIds ?? live.models ?? [], live.chatheadModelIds ?? []].flat(Infinity)) if (Number.isInteger(id) && id >= 0) currentAssets.add(id);
    }
  }
  const models = [...modelIds].sort((a, b) => a - b).map(id => {
    const a = rawGroup(oldStore, 7, id), b = rawGroup(store, 7, id);
    if (a && b && a.equals(b)) return {id, current:false};
    if (b && currentAssets.has(id)) return {id, current:true};
    throw new Error('Archived model '+id+' differs from rev241');
  });

  const next = {...context.counts};
  const definitions = [...selected.values()]
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.sourceId - b.sourceId)
    .map(row => ({...row, id: next[row.kind]++}));
  const bundle = {id:BUNDLE, targetCache:{name:cacheInfo.name, game:cacheInfo.game, revision:cacheInfo.revision}, sourceCache, definitions};
  new ArchivedDefinitionRegistry(context).replace([bundle]);

  // Live placements carry archived symbols for recycled/retired types, native ids otherwise.
  const archived = new Map(definitions.filter(row => row.kind === 'loc').map(row => [row.sourceId, row.symbol]));
  const placementGroups = {};
  for (const row of placements) {
    const name = archived.has(row.sourceId) ? 'archived:'+row.symbol : 'native:'+row.sourceId;
    (placementGroups[name] ??= []).push([row.x, row.y, row.z, row.shape, row.rotation]);
  }
  const realmRegions = realm.sort((a, b) => a.region - b.region).map(square => ({
    region: square.region,
    terrainGzipBase64: zlib.gzipSync(square.terrain, {level:9}).toString('base64'),
    terrainSha256: digest(square.terrain),
    // [archived symbol or native id, packed position, shape/rotation flags]
    locs: square.rows.map(row => [archived.has(row.id) ? archived.get(row.id) : row.id, row.position, row.flags]),
  }));
  const varbits = [];
  const oldBits = oldConfigs.getArchive(14);
  for (const [id, symbol] of symbols.varbit) if (symbol.startsWith('25th_')) {
    const before = new VarBitType(id, sourceCache), after = new VarBitType(id, cacheInfo);
    before.decode(oldBits.getFile(id).getDataAsBuffer()); after.decode(configs.getFile(14, id).getDataAsBuffer());
    const layout = type => [type.baseVar, type.startBit, type.endBit];
    assert.deepEqual(layout(after), layout(before), 'Gameplay varbit layout '+symbol);
    varbits.push({symbol, id, baseVar:before.baseVar, startBit:before.startBit, endBit:before.endBit});
  }
  return {
    source:{url:source.openrs2, revision:REVISION, cacheTimestamp:source.cacheTimestamp, symbolCommit:source.commit,
      symbolFiles:source.files, cacheFiles:source.cacheFiles},
    bundle, placements:placementGroups, realm:realmRegions, varbits, sequences:seqChecks, models, excluded,
  };
}

async function main(args) {
  let reference, output, check = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--reference') reference = args[++index];
    else if (args[index] === '--output') output = args[++index];
    else if (args[index] === '--check') check = true;
    else throw new Error('Unknown argument '+args[index]);
  }
  if (!reference || !output) throw new Error('Usage: node scripts/import-anniversary-definitions.cjs --reference <historical reference directory> --output <file> [--check]');
  const result = await extractAnniversary(path.resolve(reference));
  const bytes = JSON.stringify(result)+'\n';
  const target = path.resolve(output);
  if (check) assert.equal(fs.readFileSync(target, 'utf8'), bytes, 'Generated archive differs');
  else {
    const temporary = target+'.'+process.pid+'.tmp';
    try { fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  const count = kind => result.bundle.definitions.filter(row => row.kind === kind).length;
  console.log(JSON.stringify({npc:count('npc'), loc:count('loc'), seq:count('seq'), placements:Object.values(result.placements).reduce((n, rows) => n + rows.length, 0),
    realmLocs:result.realm.reduce((n, square) => n + square.locs.length, 0), excluded:result.excluded.length, bytes:bytes.length, sha256:digest(bytes), checked:check}));
}
module.exports = {extractAnniversary, parseSymbols, decodeLocs, BUNDLE};
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
