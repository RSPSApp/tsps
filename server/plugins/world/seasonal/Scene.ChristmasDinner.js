"use strict";

const source=require('./data/christmas-2025-archive.json');
const {vacantSceneryTiles}=require('./data/christmas-2025-scene.json');
const Actors=require('./Actors.ChristmasDinner');
const BUNDLE='christmas-2025';
let scene=null;

function sameTile(object,row){const p=object.getLocation();return p.getX()===row.x&&p.getY()===row.y&&p.getZ()===row.z&&object.getType()===row.shape;}
function globalObject(object){return !object.getPrivateArea()&&!object.getOwner();}
function foreignOnTile(core,row,owned){return core.ObjectManager.objectsAt(new core.Location(row.x,row.y,row.z)).some(object=>globalObject(object)&&sameTile(object,row)&&!owned.has(object));}
function install(api,bundles){
  const request={bundles};api.emitCustomEvent('definition-archives:install',request);
  if(!request.handled)throw new Error(request.error||'Christmas definition archive installation was refused');
}
function bounds(object){
  const p=object.getLocation(),definition=object.getDefinition();
  let width=definition?.getSizeX()??1,height=definition?.getSizeY()??1;
  if((object.getFace()&1)!==0)[width,height]=[height,width];
  if(object.getType()<=3)return {x:p.getX()-1,y:p.getY()-1,maxX:p.getX()+1,maxY:p.getY()+1,z:p.getZ()};
  return {x:p.getX(),y:p.getY(),maxX:p.getX()+width-1,maxY:p.getY()+height-1,z:p.getZ()};
}
function repairClipping(core,rows){
  if(!rows.length)return;
  const affected=rows.flatMap(row=>[row.object,...row.normal]).filter(Boolean).map(bounds);
  // Clip masks are shared OR bits, not per-object reference counts: removing
  // one footprint may clear a neighbouring object's bit. Reapply only standing
  // geometry overlapping the changed footprints, never a saved clip snapshot
  // that would undo legitimate world changes made during the activity.
  for(const objects of core.MapObjects.mapObjects.values())for(const object of objects){
    if(!globalObject(object))continue;
    const box=bounds(object);
    if(affected.some(r=>box.z===r.z&&box.x<=r.maxX&&box.maxX>=r.x&&box.y<=r.maxY&&box.maxY>=r.y))core.RegionManager.addObjectClipping(object);
  }
}
function bundleFor(core){
  const counts=core.CacheDefinitions.getCounts(),next={npc:counts.npcs,loc:counts.objects,obj:counts.items};
  const bundle=JSON.parse(JSON.stringify(source.bundle));
  // Other activities may already occupy appended IDs. Keep original IDs as
  // provenance; the registry remaps their closed reference graph atomically.
  for(const row of bundle.definitions)if(row.expectedCurrentCrc===undefined)row.id=next[row.kind]++;
  return bundle;
}
function open(api){
  const c=api.core;
  if(scene){
    const owned=new Set(scene.rows.map(row=>row.object));
    return scene.ready&&scene.rows.length===source.placements.length+vacantSceneryTiles.length&&scene.rows.every(row=>(!row.object||c.World.getObjects().includes(row.object))&&!foreignOnTile(c,row,owned))&&Actors.open(api).handled
      ? {handled:true}:{handled:false,error:'The previous Christmas scene needs cleanup before reopening'};
  }
  try{
    const existing=[...c.CacheDefinitions.getDefinitionArchiveBundles()];
    if(existing.some(bundle=>bundle.id===BUNDLE))throw new Error('Another owner has installed the Christmas archive');
    const placements=[...source.placements,...vacantSceneryTiles.map(row=>({...row,removeOnly:true}))];
    const plan=placements.map(row=>{
      const location=new c.Location(row.x,row.y,row.z);
      c.RegionManager.loadMapFiles(row.x,row.y,false);
      const region=c.RegionManager.getRegionid(c.RegionManager.regionIdForTile(row.x,row.y));
      if(!region?.isLoaded())throw new Error('Original Christmas scene region is not loaded');
      if(foreignOnTile(c,row,new Set()))throw new Error('Runtime scenery occupies an original Christmas tile');
      if(c.World.getRemovedObjects().some(object=>globalObject(object)&&sameTile(object,row)))throw new Error('Another owner has removed scenery on an original Christmas tile');
      const normal=[...(c.MapObjects.mapObjects.get(c.MapObjects.getHash(row.x,row.y,row.z))??[])]
        .filter(object=>globalObject(object)&&sameTile(object,row));
      if(normal.some(object=>!object.isMapOriginal()))throw new Error('Non-original scenery occupies a Christmas tile');
      if(row.removeOnly&&(normal.length!==1||normal[0].getId()!==c.CacheDefinitions.getLocId(row.symbol)||normal[0].getFace()!==row.rotation))throw new Error('Native scenery differs at a vacant Christmas tile');
      return {...row,location,normal};
    });
    const bundle=bundleFor(c);
    // Validate the actual target and the complete reference graph before any
    // world mutation. The install service also preflights the content packet.
    c.CacheDefinitions.getDefinitionArchiveChanges([...existing,bundle]);
    install(api,[...existing,bundle]);
    scene={bundle,rows:[],ready:false};
    for(const row of plan){
      const id=row.removeOnly?null:c.CacheDefinitions.getArchivedId(BUNDLE,'loc',row.symbol);
      if(id===null&&!row.removeOnly)throw new Error('Missing archived scene symbol '+row.symbol);
      const object=row.removeOnly?null:new c.GameObject(id,row.location,row.shape,row.rotation,null);
      const entry={...row,object};scene.rows.push(entry);
      for(const original of row.normal)c.ObjectManager.deregister(original,true);
      if(object)c.ObjectManager.register(object,true);
    }
    repairClipping(c,scene.rows);
    const actors=Actors.open(api);if(!actors.handled)throw new Error(actors.error);
    scene.ready=true;
    return {handled:true};
  }catch(error){
    if(scene){const cleanup=close(api);if(!cleanup.handled)return {handled:false,error:error.message+'; cleanup: '+cleanup.error};}
    return {handled:false,error:error.message};
  }
}
function close(api){
  if(!scene)return {handled:true};
  const c=api.core,owned=new Set(scene.rows.map(row=>row.object));
  try{
    const installed=c.CacheDefinitions.getDefinitionArchiveBundles().find(bundle=>bundle.id===BUNDLE);
    if(JSON.stringify(installed)!==JSON.stringify(scene.bundle))throw new Error('Christmas archive has changed ownership');
    for(const row of scene.rows)if(foreignOnTile(c,row,owned))throw new Error('A different runtime owner now occupies a Christmas tile');
    const actors=Actors.close(api);if(!actors.handled)throw new Error(actors.error);
    scene.ready=false;
    // Deregister while the old archived types still exist: collision removal
    // reads their old footprints. Then put back the exact original map objects.
    for(const row of scene.rows)if(row.object&&c.World.getObjects().includes(row.object))c.ObjectManager.deregister(row.object,true);
    for(const row of scene.rows)for(const original of row.normal){
      if(c.MapObjects.get(original.getId(),original.getLocation(),null)!==original)c.ObjectManager.register(original,true);
    }
    repairClipping(c,scene.rows);
    install(api,c.CacheDefinitions.getDefinitionArchiveBundles().filter(bundle=>bundle.id!==BUNDLE));
    scene=null;return {handled:true};
  }catch(error){return {handled:false,error:error.message};}
}
function replay(api,{regionId}){
  if(!scene||!scene.ready)return {handled:true};
  const c=api.core,rows=scene.rows.filter(row=>c.RegionManager.regionIdForTile(row.x,row.y)===regionId);
  const owned=new Set(scene.rows.map(row=>row.object));
  for(const row of rows){
    if(foreignOnTile(c,row,owned))return {handled:false,error:'A runtime owner conflicts with the reloaded Christmas scene'};
    const standing=[...(c.MapObjects.mapObjects.get(c.MapObjects.getHash(row.x,row.y,row.z))??[])]
      .filter(object=>sameTile(object,row)&&object!==row.object);
    if(standing.some(object=>!object.isMapOriginal()||!row.normal.some(original=>original.getId()===object.getId()&&original.getFace()===object.getFace())))return {handled:false,error:'Reloaded native scenery differs from the Christmas snapshot'};
  }
  // The region loader recreates native objects before replaying runtime ones.
  // Remove our known native counterparts through their ordinary owner, then
  // replay our registered replacements; native actions cannot remain hidden
  // underneath the seasonal client model after a reload.
  for(const row of rows){
    const standing=[...(c.MapObjects.mapObjects.get(c.MapObjects.getHash(row.x,row.y,row.z))??[])]
      .filter(object=>sameTile(object,row)&&object!==row.object);
    for(const original of standing)c.ObjectManager.deregister(original,true);
    if(row.object)c.ObjectManager.register(row.object,true);
  }
  repairClipping(c,rows);return {handled:true};
}
function objects(){return scene?scene.rows.filter(row=>row.object).map(row=>({symbol:row.symbol,object:row.object})):[];}
function active(){return scene?.ready===true;}

function copyToPrivateArea(api,area){
  const c=api.core;
  if(!active()||!(area instanceof c.PrivateArea)||area.isDestroyed()||
    area.getPlayers().length||area.getNpcs().length||area.getObjects().length)
    return {handled:false,error:'Christmas cutscene requires a new empty private area'};
  try{
    // Keep the original-map removals instance-owned too: a private scene rebuild
    // must not reveal the native rug/chairs underneath these replacements.
    for(const row of scene.rows)for(const original of row.normal){
      const hidden=new c.GameObject(original.getId(),original.getLocation().clone(),original.getType(),original.getFace(),area);
      c.ObjectManager.deregister(hidden,true);
    }
    for(const row of scene.rows)if(row.object){
      const original=row.object;
      const copy=new c.GameObject(original.getId(),original.getLocation().clone(),original.getType(),original.getFace(),area);
      c.ObjectManager.register(copy,true);
    }
    return {handled:true};
  }catch(error){area.destroy();return {handled:false,error:error.message};}
}

module.exports={open,close,objects,active,replay,copyToPrivateArea};
