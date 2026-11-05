#!/usr/bin/env node
// Extract the 2025 Halloween event (Spook-a-thon) from a separately retained
// Jagex cache2341 reference (29 October 2025, revision 235, inside the event
// window). Never reads test fixtures or writes the active cache.
//
// The event's scenery, reward items and varbits still exist in the active cache.
// Its temporary NPCs were retired (their ids reused) and its three decorations
// retired to Null, so the bundle holds those; every other definition the event
// uses is checked against the active cache instead of being archived.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const server = path.resolve(__dirname, '..');
require('../dist/Server').Server.installProductionPathResolver();
const {createBundle, parseSymbols, verifyFile} = require('./import-seasonal-definitions.cjs');
const codec = '../dist/game/cache/codec/rs/';
const {decodeArchivedType} = require(codec+'config/ArchivedTypeLoader');
const {NpcType} = require(codec+'config/npctype/NpcType');
const {LocType} = require(codec+'config/loctype/LocType');
const {ObjType} = require(codec+'config/objtype/ObjType');

const BUNDLE = 'halloween-2025';
const CACHE = 2341, REVISION = 235, SYMBOL_COMMIT = '66c30c57851c09422bad2b87848a2aa72a142926';
const SOURCE_NAME = 'osrs-235_2025-10-29', SOURCE_TIME = '2025-10-29T11:45:07Z';
// Fred's farm (l49_51) and Groats' farm (l50_51) carry the event scenery.
const MAP_SQUARES = ['l49_51', 'l50_51'];
// Seasonal dressing only: the same squares also differ by unrelated later map
// edits (farm fences, soil, troughs), which must not be reverted by the event.
const SEASONAL_LOC = /^(?:hw\d\d_|holiday_event_icon$|100_osman_autumn_leaves)/;
// Event-only decorations retired to Null in the active cache: restored at their
// own ids (Wiki item ids 31222-31224), as the Christmas serving tool is.
const RETIRED_ITEMS = ['hw25_spooky_painting','hw25_spooky_wall_lamp','hw25_spooky_scarecrow'];
// Reward items, still live (later updates only added tradeable=no): never archived.
const LIVE_ITEMS = ['hw25_chair_obj_reward','placeholder_hw25_chair_obj_reward','hw25_pumpkin_lantern_reward',
  'placeholder_hw25_pumpkin_lantern_reward','hw25_grim_reaper_top','placeholder_hw25_grim_reaper_top',
  'hw25_grim_reaper_bottoms','placeholder_hw25_grim_reaper_bottoms','hw25_grim_reaper_gloves','placeholder_hw25_grim_reaper_gloves'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const layer = shape => shape <= 3 ? 0 : shape <= 8 ? 1 : shape <= 21 ? 2 : 3;

// The reward follower is still live at its source id (later hotfixes changed it),
// so the current definition is the correct one and it is never archived.
const LIVE_NPCS = new Set(['hw25_chair_npc_reward']);

// Loc symbols may start with a digit (100_osman_autumn_leaves), which the shared
// parser's identifier pattern skips; read every loc symbol here.
function parseLocSymbols(text) {
  const ids=new Map();
  for (const match of text.matchAll(/^\/\/ (\d+)\s*\r?\n\[([a-zA-Z0-9_]+)\]/gm)) {
    if (ids.has(Number(match[1]))) throw new Error('Duplicate source loc id '+match[1]);
    ids.set(Number(match[1]),match[2]);
  }
  if (!ids.size) throw new Error('No source loc symbols found');
  return ids;
}

function halloweenRoots(symbols, currentName) {
  // Retired event actors: their source ids now name unrelated current NPCs.
  const npcs=[...symbols.npc].filter(([id,name]) => name.startsWith('hw25_') && !LIVE_NPCS.has(name) && currentName(id) !== name)
    .map(([id]) => ({kind:'npc', id}));
  const objs=[...symbols.obj].filter(([,name]) => RETIRED_ITEMS.includes(name)).map(([id]) => ({kind:'obj', id}));
  return [...npcs,...objs];
}

async function extractHalloween(reference) {
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
  assert.equal(source.commit,SYMBOL_COMMIT);
  assert.equal(source.revision,REVISION);
  assert.equal(groups.revision,REVISION);
  assert.equal(groups.cache,CACHE);
  const verified=new Map();
  for (const row of groups.files) {
    const file=path.join(reference,'archives',row.file);
    if (path.dirname(path.resolve(file))!==path.resolve(reference,'archives')) throw new Error('Invalid source filename');
    verified.set(row.file,verifyFile(file,row));
  }
  const symbols={};
  for (const kind of ['npc','loc','obj','varbit','seq']) {
    const name='dump.'+kind,row=source.files.find(row=>row.name===name);
    assert.ok(row,'Missing source symbols '+kind);
    const text=verifyFile(path.join(reference,name),row).toString('utf8');
    symbols[kind]=kind==='loc'?parseLocSymbols(text):parseSymbols(text);
  }
  const ids=kind=>new Map([...symbols[kind]].map(([id,name])=>[name,id]));
  const raw=name=>{const data=verified.get(name);if(!data)throw new Error('Missing verified archive '+name);return new Int8Array(data);};
  const container=(name,key)=>Container.decode(new ByteBuffer(raw(name)),key);
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
  const currentBytes=(kind,id)=>natives[kind].archive.getFile(id)?.data;
  const context={cacheInfo,counts:Object.fromEntries(['npc','loc','obj'].map(kind=>[kind,natives[kind].getCount()])),
    currentDefinition:(kind,id)=>({name:natives[kind].load(id).name,data:currentBytes(kind,id)})};
  const sourceCache={...cacheInfo,name:SOURCE_NAME,revision:REVISION,timestamp:SOURCE_TIME};
  // Original event placements, decoded from the event-window map squares.
  const keys=JSON.parse(Buffer.from(raw('keys.json')).toString('utf8'));
  const mapTable=ReferenceTable.decode(new ByteBuffer(container('255-5.dat').data));
  const placements=[],locIds=new Set(),eventMap=new Set();
  for (const name of MAP_SQUARES) {
    const key=keys.find(row=>row.name===name);assert.ok(key,'Missing original map '+name);
    const file=`5-${key.group}.dat`,ref=mapTable.getArchiveReference(key.group);
    assert.equal(zlib.crc32(raw(file)),ref.crc>>>0,'Original map CRC '+name);
    const buffer=new ByteBuffer(container(file,key.key).data);let id=-1,delta;
    while ((delta=buffer.readSmart3())!==0) {
      id+=delta;let position=0,change;
      while ((change=buffer.readUnsignedSmart())!==0) {
        position+=change-1;const flags=buffer.readUnsignedByte(),symbol=symbols.loc.get(id);
        const row={symbol,sourceId:id,x:(key.mapsquare>>8)*64+((position>>6)&63),y:(key.mapsquare&255)*64+(position&63),z:position>>12,shape:flags>>2,rotation:flags&3};
        eventMap.add([id,row.x,row.y,row.z,row.shape,row.rotation].join());
        if (!symbol||!SEASONAL_LOC.test(symbol)) continue;
        locIds.add(id);
        placements.push(row);
      }
    }
    assert.equal(buffer.remaining,0,'Trailing original map bytes');
  }
  placements.sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y||a.shape-b.shape||a.sourceId-b.sourceId);
  assert.equal(placements.filter(row=>row.symbol.startsWith('hw25_')).length,4,'Original Spook-a-thon decoration placements');
  // hw25_loc_decoration shows these multiloc targets once Fred has the decorations.
  for (const name of ['hw25_scarecrow_vis','hw25_spooky_painting_vis','hw25_spooky_lamp_vis']) locIds.add(ids('loc').get(name));

  // A definition is live only if its bytes are unchanged since the event; a changed
  // one (e.g. the holiday map icon) is archived as an appended copy instead.
  // Compare decoded fields, not bytes: rev241 re-encodes unchanged rev235 types.
  const constructors={npc:NpcType,loc:LocType,obj:ObjType};
  const fields=type=>JSON.stringify(type,(key,value)=>['id','cacheInfo'].includes(key)?undefined:
    ArrayBuffer.isView(value)?Array.from(value):value);
  const unchanged=(kind,id)=>{
    const then=original[kind].getFile(id)?.data,now=currentBytes(kind,id);
    assert.ok(then,`Missing source ${kind} ${id}`);
    if (!now) return false;
    const before=decodeArchivedType(constructors[kind],id,{cacheInfo:sourceCache,dataBase64:Buffer.from(then).toString('base64')});
    return fields(before)===fields(natives[kind].load(id));
  };
  const npcRoots=halloweenRoots(symbols,id=>unchanged('npc',id)?symbols.npc.get(id):null);
  const locRoots=[...locIds].filter(id=>!unchanged('loc',id)).map(id=>({kind:'loc',id}));
  const roots=[...npcRoots,...locRoots];
  const bundle=createBundle({id:BUNDLE,sourceCache,context,roots,readDefinition:(kind,id)=>original[kind].getFile(id)?.data,
    symbolFor:(kind,id)=>symbols[kind].get(id),restoreItems:roots.filter(row=>row.kind==='obj').map(row=>row.id)});
  const archived=new Set(bundle.definitions.filter(row=>row.kind==='loc').map(row=>row.sourceId));
  assert.deepEqual(bundle.definitions.filter(row=>row.kind!=='loc').map(row=>row.symbol),['hw25_chair_npc_event','hw25_chair_seth','hw25_chair_npc_cs',
    'hw25_straydog_wander','hw25_straydog_nomove','hw25_deadth_cs','hw25_seth_groats_cs','hw25_fred_the_farmer_cs',
    ...RETIRED_ITEMS],'Retired event definitions');
  for (const row of placements) row.archived=archived.has(row.sourceId);
  const locs=[...locIds].filter(id=>!archived.has(id)).sort((a,b)=>a-b)
    .map(id=>({symbol:symbols.loc.get(id),id,crc:zlib.crc32(Buffer.from(currentBytes('loc',id)))}));
  for (const name of ['hw25_scarecrow','hw25_spooky_painting','hw25_spooky_lamp','hw25_scarecrow_vis','hw25_spooky_painting_vis','hw25_spooky_lamp_vis']) {
    assert.ok(!archived.has(ids('loc').get(name)),'Decoration multiloc must stay live for hw25_loc_decoration: '+name);
  }
  const items=LIVE_ITEMS.map(name=>{
    const id=ids('obj').get(name),now=currentBytes('obj',id);
    assert.ok(now,'Missing live reward item '+name);
    assert.notEqual(natives.obj.load(id).name,'Null','Retired reward item '+name);
    return {symbol:name,id,crc:zlib.crc32(Buffer.from(now))};
  });
  const liveNpcs=[...LIVE_NPCS].map(name=>{
    const id=ids('npc').get(name),now=currentBytes('npc',id);
    assert.ok(now,'Missing live event NPC '+name);
    return {symbol:name,id,crc:zlib.crc32(Buffer.from(now))};
  });

  // Current map objects in the same tile layer are displaced while the scene shows.
  const {PluginManager:PM}=require('../dist/plugins/PluginManager');
  PM.loadFromDirectory(path.join(server,'plugins'));
  const core=PM.getCoreApi();core.RegionManager.init();
  const displaced=[];
  for (const row of placements) {
    core.RegionManager.loadMapFiles(row.x,row.y,false);
    for (const object of core.MapObjects.mapObjects.get(core.MapObjects.getHash(row.x,row.y,row.z))??[]) {
      const p=object.getLocation();
      if (!object.isMapOriginal()||p.getX()!==row.x||p.getY()!==row.y||layer(object.getType())!==layer(row.shape)) continue;
      if (object.getId()===row.sourceId&&object.getType()===row.shape&&object.getFace()===row.rotation) throw new Error('Event placement already in the current map');
      // Only scenery the event map itself lacked was removed for the event.
      if (eventMap.has([object.getId(),row.x,row.y,row.z,object.getType(),object.getFace()].join())) continue;
      if (displaced.some(other=>other.id===object.getId()&&other.x===row.x&&other.y===row.y&&other.z===row.z&&other.shape===object.getType())) continue;
      displaced.push({id:object.getId(),x:row.x,y:row.y,z:row.z,shape:object.getType(),rotation:object.getFace()});
    }
  }
  PM.emitServerShutdown({});

  const varbits=[],oldBits=archive(14),oldSeq=archive(12),sequences=new Set(),modelIds=new Set();
  for (const [id,symbol] of symbols.varbit) if (/^hw25_/.test(symbol)) {
    const before=new VarBitType(id,sourceCache),after=new VarBitType(id,cacheInfo);
    before.decode(oldBits.getFile(id).getDataAsBuffer());after.decode(configs.getFile(14,id).getDataAsBuffer());
    const fields=type=>[type.baseVar,type.startBit,type.endBit];
    assert.deepEqual(fields(after),fields(before),'Gameplay varbit layout '+symbol);
    varbits.push({symbol,id,baseVar:before.baseVar,startBit:before.startBit,endBit:before.endBit});
  }
  assert.equal(varbits.length,12,'hw25 varbit count');
  for (const row of bundle.definitions.filter(row=>row.kind==='npc')) {
    const type=decodeArchivedType(NpcType,row.sourceId,{cacheInfo:sourceCache,dataBase64:row.dataBase64});
    for (const [field,id] of Object.entries(type)) if ((field==='seqId'||field.endsWith('SeqId')||field.endsWith('Anim'))&&Number.isInteger(id)&&id>=0) sequences.add(id);
    for (const id of [type.modelIds??type.models??[],type.chatheadModelIds??[]].flat(Infinity)) if(Number.isInteger(id)&&id>=0)modelIds.add(id);
  }
  const sequenceChecks=[...sequences].sort((a,b)=>a-b).map(id=>{
    const before=oldSeq.getFile(id)?.data,after=configs.getFile(12,id)?.data;
    assert.ok(before&&after,'Missing sequence '+id);
    // The client plays the live animation; a changed one is recorded, not archived.
    return {id,symbol:symbols.seq.get(id),sha256:digest(before),changed:!Buffer.from(after).equals(Buffer.from(before))};
  });
  const oldModels=ReferenceTable.decode(new ByteBuffer(container('255-7.dat').data));
  const currentModels=CacheIndexDat2.fromStore(7,CachePipeline.getStore());
  const modelChecks=[...modelIds].sort((a,b)=>a-b).map(id=>{
    const before=oldModels.getArchiveReference(id),after=currentModels.getArchiveReference(id);
    assert.ok(before&&after,'Missing native model '+id);
    return {id,sourceCrc:before.crc>>>0,currentCrc:after.crc>>>0};
  });
  return {source:{url:source.openrs2,revision:REVISION,symbolCommit:SYMBOL_COMMIT,symbolFiles:source.files,
      files:[...verified].map(([file,bytes])=>({file,bytes:bytes.length,sha256:digest(bytes)}))},
    bundle,items,npcs:liveNpcs,locs,placements,displaced,varbits,sequences:sequenceChecks,models:modelChecks};
}

async function main(args) {
  let reference,output,check=false;
  for (let index=0;index<args.length;index++) {
    if (args[index]==='--reference')reference=args[++index];
    else if (args[index]==='--output')output=args[++index];
    else if (args[index]==='--check')check=true;
    else throw new Error('Unknown argument '+args[index]);
  }
  if (!reference||!output)throw new Error('Usage: node scripts/import-halloween-definitions.cjs --reference <historical reference directory> --output <file> [--check]');
  const result=await extractHalloween(path.resolve(reference)),bytes=JSON.stringify(result,null,2)+'\n';
  const target=path.resolve(output);
  if (check)assert.equal(fs.readFileSync(target,'utf8'),bytes,'Generated archive differs');
  else {const temporary=target+'.'+process.pid+'.tmp';try {fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,target);} finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
  console.log(JSON.stringify({definitions:result.bundle.definitions.length,placements:result.placements.length,displaced:result.displaced.length,locs:result.locs.length,varbits:result.varbits.length,sequences:result.sequences.length,models:result.models.length,sha256:digest(bytes),checked:check}));
  process.exit(0);
}
module.exports={extractHalloween,halloweenRoots,SEASONAL_LOC};
if (require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error);process.exit(1);});
