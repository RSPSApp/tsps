#!/usr/bin/env node
// Extract native Christmas 2025 definitions from a separately retained Jagex
// cache2392 reference. Never reads test fixtures or writes the active cache.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const server = path.resolve(__dirname, '..');
require('../dist/Server').Server.installProductionPathResolver();
const codec = '../dist/game/cache/codec/rs/';
const {ArchivedDefinitionRegistry} = require(codec+'config/ArchivedDefinitionRegistry');
const {decodeArchivedType} = require(codec+'config/ArchivedTypeLoader');
const {NpcType} = require(codec+'config/npctype/NpcType');
const {LocType} = require(codec+'config/loctype/LocType');
const {ObjType} = require(codec+'config/objtype/ObjType');
const kinds = ['npc','loc','obj'];
const constructors = {npc:NpcType,loc:LocType,obj:ObjType};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function parseSymbols(text) {
  const ids = new Map(), names = new Set();
  for (const match of text.matchAll(/^\/\/ (\d+)\s*\r?\n\[([a-zA-Z_][a-zA-Z0-9_]*)\]/gm)) {
    const id = Number(match[1]), symbol = match[2];
    if (ids.has(id) || names.has(symbol)) throw new Error('Duplicate source symbol/id: '+symbol);
    ids.set(id,symbol); names.add(symbol);
  }
  if (!ids.size) throw new Error('No source symbols found');
  return ids;
}
function verifyFile(file, expected) {
  const bytes = fs.readFileSync(file);
  if (bytes.length !== expected.bytes && bytes.length !== expected.size) throw new Error('Source byte length mismatch: '+path.basename(file));
  if (digest(bytes).toLowerCase() !== expected.sha256.toLowerCase()) throw new Error('Source hash checksum mismatch: '+path.basename(file));
  return bytes;
}
function references(kind,type) {
  if (kind !== 'obj') return (type.transforms || []).filter(id=>id>=0);
  return ['note','noteTemplate','notedId','unnotedId','placeholder','placeholderTemplate']
    .map(field=>type[field]).filter(id=>id>=0)
    .concat((type.countObj || []).filter((id,index)=>type.countCo?.[index]>0));
}
function christmasRoots(symbols) {
  // Cosmetics remain live native items. Only the temporary serving tool was
  // retired; replacing still-live reward/template definitions would be wrong.
  return kinds.flatMap(kind=>[...symbols[kind]].filter(([,name])=>kind==='obj'
    ? name==='xmas25_serving_platter'||name==='placeholder_xmas25_serving_platter'
    : name.startsWith('xmas25_')||(kind==='loc'&&/^xmas22_pub01_rug(?:middle|corner|side)01$/.test(name))).map(([id])=>({kind,id})));
}
function createBundle({id,sourceCache,context,roots,readDefinition,symbolFor,restoreItems=[]}) {
  const restore = new Set(restoreItems);
  for (const item of restore) {
    if (!roots.some(row=>row.kind==='obj'&&row.id===item)) throw new Error('Invalid retired current replacement target: '+item);
  }
  const selected = new Map(), queue = [...roots];
  for (let index=0;index<queue.length;index++) {
    const row=queue[index],key=row.kind+':'+row.id;
    if (selected.has(key)) continue;
    if (!kinds.includes(row.kind)) throw new Error('Unknown archived kind');
    const bytes=readDefinition(row.kind,row.id);
    if (!bytes) throw new Error('Missing source definition '+key);
    const dataBase64=Buffer.from(bytes).toString('base64');
    const type=decodeArchivedType(constructors[row.kind],row.id,{cacheInfo:sourceCache,dataBase64});
    const symbol=symbolFor(row.kind,row.id);
    if (!symbol) throw new Error('Missing original symbolic identity '+key);
    selected.set(key,{kind:row.kind,sourceId:row.id,symbol,dataBase64,crc:zlib.crc32(bytes)});
    for (const dependency of references(row.kind,type)) queue.push({kind:row.kind,id:dependency});
  }
  const next={...context.counts};
  const definitions=[...selected.values()].sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||a.sourceId-b.sourceId)
    .map(row=>{
      const replacing=row.kind==='obj'&&restore.has(row.sourceId);
      if (replacing) {
        const current=context.currentDefinition(row.kind,row.sourceId);
        if (current.name.toLowerCase()!=='null'||!current.data) throw new Error('Current item is not a retired definition: '+row.sourceId);
        return {...row,id:row.sourceId,expectedCurrentCrc:zlib.crc32(current.data)};
      }
      return {...row,id:next[row.kind]++};
    });
  const bundle={id,targetCache:{name:context.cacheInfo.name,game:context.cacheInfo.game,revision:context.cacheInfo.revision},sourceCache,definitions};
  new ArchivedDefinitionRegistry(context).replace([bundle]);
  return bundle;
}

async function extractChristmas(reference) {
  const {CachePipeline}=require('../dist/game/cache/CachePipeline');
  const {ByteBuffer}=require(codec+'io/ByteBuffer');
  const {Container}=require(codec+'cache/Container');
  const {ReferenceTable}=require(codec+'cache/ref/ReferenceTable');
  const {Archive}=require(codec+'cache/Archive');
  const {CacheIndexDat2}=require(codec+'cache/CacheIndex');
  const {ArchiveNpcTypeLoader}=require(codec+'config/npctype/NpcTypeLoader');
  const {ArchiveLocTypeLoader}=require(codec+'config/loctype/LocTypeLoader');
  const {ArchiveObjTypeLoader}=require(codec+'config/objtype/ObjTypeLoader');
  const {VarBitType}=require(codec+'config/vartype/bit/VarBitType');
  const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const source=readJson(path.join(reference,'SOURCE.json'));
  const groups=readJson(path.join(reference,'archives/SOURCE.json'));
  const maps=readJson(path.join(reference,'archives/SOURCE.maps.json'));
  const seq=readJson(path.join(reference,'archives/SOURCE.sequences.json'));
  assert.equal(source.commit,'6f75a611629a4fd7d294650f3842b0358172d7f2');
  for (const manifest of [source,groups,seq]) assert.equal(manifest.revision,235);
  for (const manifest of [groups,maps,seq]) assert.equal(manifest.cache,2392);
  const verified = new Map();
  for (const manifest of [groups,maps,seq]) for (const row of manifest.files) {
    const file=path.join(reference,'archives',row.file);
    if (path.dirname(path.resolve(file))!==path.resolve(reference,'archives')) throw new Error('Invalid source filename');
    const bytes=verifyFile(file,row);
    if (verified.has(row.file)&&!verified.get(row.file).equals(bytes)) throw new Error('Conflicting source bytes');
    verified.set(row.file,bytes);
  }
  const symbols={};
  for (const kind of [...kinds,'varbit']) {
    const name='dump.'+kind,row=source.files.find(row=>row.name===name);
    assert.ok(row,'Missing source symbols '+kind);
    symbols[kind]=parseSymbols(verifyFile(path.join(reference,name),row).toString('utf8'));
  }
  const raw=name=>{const data=verified.get(name);if(!data)throw new Error('Missing verified archive '+name);return new Int8Array(data);};
  const container=(name,key)=>Container.decode(new ByteBuffer(raw(name)),key);
  // Pinned public reference-table CRC binds the child CRCs used below.
  assert.equal(zlib.crc32(raw('255-2.dat')),601061141);
  const configTable=ReferenceTable.decode(new ByteBuffer(container('255-2.dat').data));
  const archive=group=>{
    const ref=configTable.getArchiveReference(group),name=`2-${group}.dat`;
    assert.equal(zlib.crc32(raw(name)),ref.crc>>>0,'Source config CRC '+group);
    return Archive.decode(group,ref.lastFileId,ref.fileCount,ref.fileIds,ref.fileNameHashes,new ByteBuffer(container(name).data));
  };
  const original={npc:archive(9),loc:archive(6),obj:archive(10)};
  await CachePipeline.initialize(server);
  const active=CachePipeline.getActive();
  const cacheInfo={name:active.name,game:'oldschool',environment:'live',revision:active.revision,timestamp:active.timestamp,size:0};
  const configs=CacheIndexDat2.fromStore(2,CachePipeline.getStore());
  const natives={npc:new ArchiveNpcTypeLoader(cacheInfo,configs.getArchive(9)),loc:new ArchiveLocTypeLoader(cacheInfo,configs.getArchive(6)),obj:new ArchiveObjTypeLoader(cacheInfo,configs.getArchive(10))};
  const context={cacheInfo,counts:Object.fromEntries(kinds.map(kind=>[kind,natives[kind].getCount()])),currentDefinition:(kind,id)=>({name:natives[kind].load(id).name,data:natives[kind].archive.getFile(id)?.data})};
  const roots=christmasRoots(symbols);
  const sourceCache={...cacheInfo,name:'osrs-235_2025-12-17',revision:235,timestamp:'2025-12-17T11:45:07Z'};
  const bundle=createBundle({id:'christmas-2025',sourceCache,context,roots,readDefinition:(kind,id)=>original[kind].getFile(id)?.data,symbolFor:(kind,id)=>symbols[kind].get(id),restoreItems:roots.filter(r=>r.kind==='obj').map(r=>r.id)});
  const varbits=[],oldBits=archive(14),oldSeq=archive(12),sequences=new Set(),modelIds=new Set();
  for (const row of bundle.definitions) {
    const type=decodeArchivedType(constructors[row.kind],row.sourceId,{cacheInfo:sourceCache,dataBase64:row.dataBase64});
    for (const [field,id] of Object.entries(type)) if ((field==='seqId'||field.endsWith('SeqId'))&&Number.isInteger(id)&&id>=0) sequences.add(id);
    for (const id of [type.modelIds??type.models??type.model??[],type.chatheadModelIds??[]].flat(Infinity)) if(Number.isInteger(id)&&id>=0)modelIds.add(id);
  }
  for (const [id,symbol] of symbols.varbit) if (/^xmas_?25_/.test(symbol)) {
    const before=new VarBitType(id,sourceCache),after=new VarBitType(id,cacheInfo);
    before.decode(oldBits.getFile(id).getDataAsBuffer());after.decode(configs.getFile(14,id).getDataAsBuffer());
    const layout=type=>[type.baseVar,type.startBit,type.endBit];
    assert.deepEqual(layout(after),layout(before),'Gameplay varbit layout '+symbol);
    varbits.push({symbol,id,baseVar:before.baseVar,startBit:before.startBit,endBit:before.endBit});
  }
  const sequenceChecks=[...sequences].sort((a,b)=>a-b).map(id=>{
    const before=oldSeq.getFile(id)?.data,after=configs.getFile(12,id)?.data;
    assert.ok(before&&after,'Missing sequence '+id);
    assert.deepEqual(Buffer.from(after),Buffer.from(before),'Changed animation definition '+id);
    return {id,sha256:digest(before)};
  });
  assert.equal(zlib.crc32(raw('255-7.dat')),(-1308188626)>>>0,'Source model reference CRC');
  const oldModels=ReferenceTable.decode(new ByteBuffer(container('255-7.dat').data));
  const currentModels=CacheIndexDat2.fromStore(7,CachePipeline.getStore());
  const modelChecks=[...modelIds].sort((a,b)=>a-b).map(id=>{
    const before=oldModels.getArchiveReference(id),after=currentModels.getArchiveReference(id);
    assert.ok(before&&after,'Missing native model '+id);
    const result={id,sourceCrc:before.crc>>>0,currentCrc:after.crc>>>0};
    if(result.sourceCrc!==result.currentCrc) {
      const name=`7-${id}.dat`;assert.equal(zlib.crc32(raw(name)),result.sourceCrc,'Source model CRC '+id);
      result.sourceSha256=digest(container(name).data);
      result.currentSha256=digest(currentModels.getArchive(id).getFile(0).data);
    }
    return result;
  });
  const mapTable=ReferenceTable.decode(new ByteBuffer(container('255-5.dat').data));
  const keys=JSON.parse(Buffer.from(raw('keys.json')).toString('utf8'));
  const locs=new Map(bundle.definitions.filter(r=>r.kind==='loc').map(r=>[r.sourceId,r]));
  const placements=[];
  for (const name of ['l50_53','l50_153']) {
    const key=keys.find(row=>row.name===name);assert.ok(key,'Missing original map '+name);
    const file=`5-${key.group}.dat`,ref=mapTable.getArchiveReference(key.group);
    assert.equal(zlib.crc32(raw(file)),ref.crc>>>0,'Original map CRC '+name);
    const buffer=new ByteBuffer(container(file,key.key).data);let id=-1,delta;
    while ((delta=buffer.readSmart3())!==0) {
      id+=delta;let position=0,change;
      while ((change=buffer.readUnsignedSmart())!==0) {
        position+=change-1;const flags=buffer.readUnsignedByte(),row=locs.get(id);
        if (row) placements.push({symbol:row.symbol,sourceId:id,x:(key.mapsquare>>8)*64+((position>>6)&63),y:(key.mapsquare&255)*64+(position&63),z:position>>12,shape:flags>>2,rotation:flags&3});
      }
    }
    assert.equal(buffer.remaining,0,'Trailing original map bytes');
  }
  // The 2025 map reuses the 2022 pub rug; an xmas25-only name filter misses
  // its red floor decorations and leaves the ordinary blue carpet visible.
  assert.equal(placements.filter(row=>row.symbol.startsWith('xmas25_')).length,24,'Original event scene placement count');
  const rugs=placements.filter(row=>row.symbol.startsWith('xmas22_pub01_rug'));
  assert.equal(rugs.filter(row=>row.z===0).length,54,'Original ground-floor pub rug placement count');
  assert.equal(rugs.filter(row=>row.z===1).length,47,'Original upstairs pub rug placement count');
  assert.equal(rugs.length,101,'Original reused pub rug placement count');
  return {source:{url:source.openrs2,revision:235,symbolCommit:source.commit,symbolFiles:source.files,files:[...verified].map(([file,bytes])=>({file,bytes:bytes.length,sha256:digest(bytes)}))},bundle,placements,varbits,sequences:sequenceChecks,models:modelChecks};
}
const EASTER_2026_REFERENCE_CRCS=Object.freeze({"config":3112025756,"maps":2365706529,"models":3053242090});
// 2026 Easter ("The brave chocolate egg"). Its scenery, items and varbits are still
// live in the active cache. Only four NPCs were retired and their ids reused, and the
// event's egg box lock dataset row was reused too. The map squares reverted after the
// event, so the original placements are read from the event-active cache 2509.
const EASTER_2026_NPCS=Object.freeze(['easter26_easter_bunny','easter26_egg_last_spot','easter26_egg_last_spot_found','easter26_egg_church_cutscene']);
const EASTER_2026_MAPS=Object.freeze([12597,12852,12853,12854]);
const EASTER_2026_LOCK='combination_lock_dataset_alphabetic_easter26';
const easterSceneSymbol=symbol=>/^easter2[36]_/.test(symbol)||/_easter26$/.test(symbol);
// OSRS loc slots: walls 0-3, wall decorations 4-8, scenery 9-21, ground decoration 22.
const slotOf=shape=>shape<=3?0:shape<=8?1:shape<=21?2:3;
function readLocs(ByteBuffer,bytes){
  const buffer=new ByteBuffer(bytes),rows=[];let id=-1,delta;
  while((delta=buffer.readSmart3())!==0){
    id+=delta;let position=0,change;
    while((change=buffer.readUnsignedSmart())!==0){
      position+=change-1;const flags=buffer.readUnsignedByte();
      rows.push({id,lx:(position>>6)&63,ly:position&63,z:position>>12,shape:flags>>2,rotation:flags&3});
    }
  }
  assert.equal(buffer.remaining,0,'Trailing map bytes');
  return rows;
}
async function extractEaster2026(reference) {
  const {CachePipeline}=require('../dist/game/cache/CachePipeline');
  const {CacheMaps}=require('../dist/game/cache/CacheMaps');
  const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
  const {ByteBuffer}=require(codec+'io/ByteBuffer');
  const {Container}=require(codec+'cache/Container');
  const {ReferenceTable}=require(codec+'cache/ref/ReferenceTable');
  const {Archive}=require(codec+'cache/Archive');
  const {CacheIndexDat2}=require(codec+'cache/CacheIndex');
  const {ArchiveNpcTypeLoader}=require(codec+'config/npctype/NpcTypeLoader');
  const {ArchiveLocTypeLoader}=require(codec+'config/loctype/LocTypeLoader');
  const {ArchiveObjTypeLoader}=require(codec+'config/objtype/ObjTypeLoader');
  const {VarBitType}=require(codec+'config/vartype/bit/VarBitType');
  const {DbRowType}=require(codec+'config/dbrow/DbRowType');
  const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const source=readJson(path.join(reference,'SOURCE.json'));
  const groups=readJson(path.join(reference,'archives/SOURCE.json'));
  assert.equal(source.commit,'9b30ba07a0580fac3f76299f9e9eef2b646caa61');
  assert.equal(source.revision,237);assert.equal(groups.revision,237);assert.equal(groups.cache,2509);
  const verified=new Map();
  for(const row of groups.files){
    const file=path.join(reference,'archives',row.file);
    if(path.dirname(path.resolve(file))!==path.resolve(reference,'archives'))throw new Error('Invalid source filename');
    verified.set(row.file,verifyFile(file,row));
  }
  const symbols={};
  for(const kind of [...kinds,'varbit','dbrow']){
    const name='dump.'+kind,row=source.files.find(row=>row.name===name);
    assert.ok(row,'Missing source symbols '+kind);
    symbols[kind]=parseSymbols(verifyFile(path.join(reference,name),row).toString('utf8'));
  }
  const byName=kind=>new Map([...symbols[kind]].map(([id,name])=>[name,id]));
  const raw=name=>{const data=verified.get(name);if(!data)throw new Error('Missing verified archive '+name);return new Int8Array(data);};
  const container=name=>Container.decode(new ByteBuffer(raw(name)));
  // Pinned public reference-table CRCs bind the child CRCs used below.
  assert.equal(zlib.crc32(raw('255-2.dat')),EASTER_2026_REFERENCE_CRCS.config,'Source config reference CRC');
  assert.equal(zlib.crc32(raw('255-5.dat')),EASTER_2026_REFERENCE_CRCS.maps,'Source map reference CRC');
  assert.equal(zlib.crc32(raw('255-7.dat')),EASTER_2026_REFERENCE_CRCS.models,'Source model reference CRC');
  const configTable=ReferenceTable.decode(new ByteBuffer(container('255-2.dat').data));
  const archive=(index,table,group)=>{
    const ref=table.getArchiveReference(group),name=`${index}-${group}.dat`;
    assert.ok(ref,'Missing source group '+name);
    assert.equal(zlib.crc32(raw(name)),ref.crc>>>0,'Source CRC '+name);
    return Archive.decode(group,ref.lastFileId,ref.fileCount,ref.fileIds,ref.fileNameHashes,new ByteBuffer(container(name).data));
  };
  const original={npc:archive(2,configTable,9),loc:archive(2,configTable,6),obj:archive(2,configTable,10)};
  await CachePipeline.initialize(server);
  const active=CachePipeline.getActive();
  const cacheInfo={name:active.name,game:'oldschool',environment:'live',revision:active.revision,timestamp:active.timestamp,size:0};
  const configs=CacheIndexDat2.fromStore(2,CachePipeline.getStore());
  const natives={npc:new ArchiveNpcTypeLoader(cacheInfo,configs.getArchive(9)),loc:new ArchiveLocTypeLoader(cacheInfo,configs.getArchive(6)),obj:new ArchiveObjTypeLoader(cacheInfo,configs.getArchive(10))};
  const context={cacheInfo,counts:Object.fromEntries(kinds.map(kind=>[kind,natives[kind].getCount()])),currentDefinition:(kind,id)=>({name:natives[kind].load(id).name,data:natives[kind].archive.getFile(id)?.data})};
  const current={npc:CacheDefinitions.getNpcNames(),loc:CacheDefinitions.getLocNames(),obj:CacheDefinitions.getObjNames()};
  // Every 2026 Easter loc/obj must still be the identical live definition at its id;
  // only the named NPCs may need an archive, and only because their ids were reused.
  const live={};
  for(const kind of ['loc','obj']){
    live[kind]=[];
    for(const [id,symbol] of symbols[kind])if(/easter26/.test(symbol)){
      assert.equal(current[kind].get(id),symbol,'Retired '+kind+' '+symbol);
      const before=original[kind].getFile(id)?.data,after=configs.getFile(kind==='loc'?6:10,id)?.data;
      assert.ok(before&&after,'Missing '+kind+' '+symbol);
      // A later revision may retune a live definition; record it rather than roll it back.
      const same=Buffer.from(after).equals(Buffer.from(before));
      live[kind].push({symbol,id,sourceCrc:zlib.crc32(Buffer.from(before)),...(same?{}:{currentCrc:zlib.crc32(Buffer.from(after))})});
    }
  }
  const retired=[...symbols.npc].filter(([id,symbol])=>/^easter26_/.test(symbol)&&current.npc.get(id)!==symbol).map(([,symbol])=>symbol).sort();
  assert.deepEqual(retired,[...EASTER_2026_NPCS].sort(),'Retired 2026 Easter NPC set');
  const npcIds=byName('npc'),roots=EASTER_2026_NPCS.map(symbol=>({kind:'npc',id:npcIds.get(symbol)}));
  const sourceCache={...cacheInfo,name:'osrs-237_2026-04-01',revision:237,timestamp:'2026-04-01T10:45:07Z'};
  const bundle=createBundle({id:'easter-2026',sourceCache,context,roots,readDefinition:(kind,id)=>original[kind].getFile(id)?.data,symbolFor:(kind,id)=>symbols[kind].get(id)});
  assert.deepEqual(bundle.definitions.map(row=>row.symbol).sort(),[...EASTER_2026_NPCS].sort(),'Closed 2026 Easter NPC bundle');
  const oldBits=archive(2,configTable,14),oldSeq=archive(2,configTable,12),sequences=new Set(),modelIds=new Set(),varbits=[];
  for(const row of bundle.definitions){
    const type=decodeArchivedType(constructors[row.kind],row.sourceId,{cacheInfo:sourceCache,dataBase64:row.dataBase64});
    for(const [field,id] of Object.entries(type))if((field==='seqId'||field.endsWith('SeqId'))&&Number.isInteger(id)&&id>=0)sequences.add(id);
    for(const id of [type.modelIds??type.models??type.model??[],type.chatheadModelIds??[]].flat(Infinity))if(Number.isInteger(id)&&id>=0)modelIds.add(id);
  }
  for(const [id,symbol] of symbols.varbit)if(/^easter26_/.test(symbol)){
    const before=new VarBitType(id,sourceCache),after=new VarBitType(id,cacheInfo);
    before.decode(oldBits.getFile(id).getDataAsBuffer());after.decode(configs.getFile(14,id).getDataAsBuffer());
    const layout=type=>[type.baseVar,type.startBit,type.endBit];
    assert.deepEqual(layout(after),layout(before),'Gameplay varbit layout '+symbol);
    varbits.push({symbol,id,baseVar:before.baseVar,startBit:before.startBit,endBit:before.endBit});
  }
  const sequenceChecks=[...sequences].sort((a,b)=>a-b).map(id=>{
    const before=oldSeq.getFile(id)?.data,after=configs.getFile(12,id)?.data;
    assert.ok(before&&after,'Missing sequence '+id);
    assert.deepEqual(Buffer.from(after),Buffer.from(before),'Changed animation definition '+id);
    return {id,sha256:digest(before)};
  });
  const oldModels=ReferenceTable.decode(new ByteBuffer(container('255-7.dat').data));
  const currentModels=CacheIndexDat2.fromStore(7,CachePipeline.getStore());
  const modelChecks=[...modelIds].sort((a,b)=>a-b).map(id=>{
    const before=oldModels.getArchiveReference(id),after=currentModels.getArchiveReference(id);
    assert.ok(before&&after,'Missing native model '+id);
    assert.equal(after.crc>>>0,before.crc>>>0,'Changed model '+id);
    return {id,crc:before.crc>>>0};
  });
  // The lock row's id was reused after the event. Its dial rows are still live.
  const oldRows=archive(2,configTable,38),lockId=byName('dbrow').get(EASTER_2026_LOCK);
  assert.ok(Number.isInteger(lockId),'Missing source lock row');
  const lock=DbRowType.decode(lockId,oldRows.getFile(lockId).data);
  assert.equal(lock.tableId,CacheDefinitions.getDbTableId('combination_lock_dataset'),'Lock dataset table');
  const valueColumn=CacheDefinitions.getDbColumn(lock.tableId,'values');
  const dialRows=lock.column(valueColumn);
  assert.deepEqual(dialRows.map(id=>symbols.dbrow.get(id)),['combination_lock_values_alphabetic_4','combination_lock_values_alphabetic_2','combination_lock_values_alphabetic_1','combination_lock_values_alphabetic_3'],'Lock dial rows');
  for(const id of dialRows){
    assert.equal(CacheDefinitions.getDbRowName(id),symbols.dbrow.get(id),'Retired lock values row '+id);
    assert.deepEqual(Buffer.from(configs.getFile(38,id).data),Buffer.from(oldRows.getFile(id).data),'Changed lock values row '+id);
  }
  const lockRow={symbol:EASTER_2026_LOCK,sourceId:lockId,tableId:lock.tableId,
    columns:Object.fromEntries([...lock.columns].map(([column,list])=>[String(column),list])),crc:zlib.crc32(Buffer.from(oldRows.getFile(lockId).data))};
  const mapTable=ReferenceTable.decode(new ByteBuffer(container('255-5.dat').data));
  assert.equal(mapTable.named,false,'Unnamed source maps');
  const placements=[];
  for(const group of EASTER_2026_MAPS){
    const old=archive(5,mapTable,group).getFile(1).data,now=CacheMaps.getRegion(group)?.objectData;
    assert.ok(now,'Missing current map '+group);
    const key=row=>[row.id,row.lx,row.ly,row.z,row.shape,row.rotation].join(':');
    const before=readLocs(ByteBuffer,old),after=readLocs(ByteBuffer,new Int8Array(now));
    const beforeKeys=new Set(before.map(key)),afterKeys=new Set(after.map(key));
    const afterOnly=after.filter(row=>!beforeKeys.has(key(row)));
    for(const row of before.filter(row=>!afterKeys.has(key(row)))){
      const symbol=symbols.loc.get(row.id);
      if(!symbol||!easterSceneSymbol(symbol))continue;
      assert.equal(current.loc.get(row.id),symbol,'Event scene loc is not live '+symbol);
      // The event row took the slot of whichever ordinary row now stands there.
      const replaced=afterOnly.filter(other=>other.lx===row.lx&&other.ly===row.ly&&other.z===row.z&&slotOf(other.shape)===slotOf(row.shape));
      placements.push({symbol,id:row.id,x:(group>>8)*64+row.lx,y:(group&255)*64+row.ly,z:row.z,shape:row.shape,rotation:row.rotation,
        replaces:replaced.map(other=>({symbol:current.loc.get(other.id),id:other.id,shape:other.shape,rotation:other.rotation}))});
    }
  }
  placements.sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y||a.shape-b.shape||a.id-b.id);
  assert.equal(placements.filter(row=>/easter26/.test(row.symbol)).length,8,'Original 2026 hunt scenery placement count');
  return {source:{url:source.openrs2,revision:237,symbolCommit:source.commit,symbolFiles:source.files,files:[...verified].map(([file,bytes])=>({file,bytes:bytes.length,sha256:digest(bytes)}))},
    bundle,placements,lockRow,live,varbits,sequences:sequenceChecks,models:modelChecks};
}
async function main(args) {
  let reference,output,check=false,event='christmas-2025';
  for(let index=0;index<args.length;index++) {
    if(args[index]==='--reference')reference=args[++index];
    else if(args[index]==='--event')event=args[++index];
    else if(args[index]==='--output')output=args[++index];
    else if(args[index]==='--check')check=true;
    else throw new Error('Unknown argument '+args[index]);
  }
  if(!reference||!output)throw new Error('Usage: node scripts/import-seasonal-definitions.cjs [--event christmas-2025|easter-2026] --reference <historical reference directory> --output <file> [--check]');
  const extract={'christmas-2025':extractChristmas,'easter-2026':extractEaster2026}[event];
  if(!extract)throw new Error('Unknown seasonal event '+event);
  const result=await extract(path.resolve(reference)),bytes=JSON.stringify(result,null,2)+'\n';
  const target=path.resolve(output);
  if(check)assert.equal(fs.readFileSync(target,'utf8'),bytes,'Generated archive differs');
  else {const temporary=target+'.'+process.pid+'.tmp';try {fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,target);} finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
  console.log(JSON.stringify({event,definitions:result.bundle.definitions.length,placements:result.placements.length,varbits:result.varbits.length,sequences:result.sequences.length,sha256:digest(bytes),checked:check}));
}
module.exports={createBundle,parseSymbols,verifyFile,extractChristmas,christmasRoots,extractEaster2026,readLocs};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error);process.exitCode=1;});
