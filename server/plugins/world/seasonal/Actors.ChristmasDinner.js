"use strict";

const Progress=require('./Progress.ChristmasDinner');
const {actors:spawns}=require('./data/christmas-2025-scene.json');
const GUESTS=['xmas25_sir_prysin','xmas25_aggie','xmas25_jobless_jim'];
let parents=[],enabled=false;
const escorts=new Map();

function live(api,npc){return npc.isRegistered()&&api.core.World.getNpcs().get(npc.getIndex())===npc;}
function owned(record){return (record.npc.getOwner()??null)===(record.owner??null)&&record.npc.getPrivateArea()===record.area&&record.npc.getId()===record.id;}
function remove(api,record){record.npc.setFollowing(null);record.npc.setMobileInteraction(null);api.removeNpc(record.npc);}
function clear(api,{player}){
  const record=escorts.get(player);
  if(!record)return true;
  if(!owned(record))return false;
  remove(api,record);escorts.delete(player);return true;
}
function close(api){
  enabled=false;
  const records=[...parents,...escorts.values()];
  if(records.some(record=>!owned(record)))return {handled:false,error:'A Christmas actor has changed ownership'};
  for(const record of records)remove(api,record);
  parents=[];escorts.clear();return {handled:true};
}
function open(api){
  if(parents.length){
    enabled=parents.length===spawns.length&&parents.every(record=>owned(record)&&live(api,record.npc));
    return enabled?{handled:true}:{handled:false,error:'The previous Christmas actors need cleanup'};
  }
  try{
    for(const row of spawns){
      const id=api.core.CacheDefinitions.getArchivedId('christmas-2025','npc',row.symbol);
      if(id===null)throw new Error('Missing archived actor '+row.symbol);
      const npc=api.spawnNpc({id,x:row.x,y:row.y,z:row.z,wanderRadius:0,face:api.core.Direction[row.face].getId(),unique:'christmas-dinner:'+row.symbol});
      if(!npc)throw new Error('Could not create Christmas actor '+row.symbol);
      npc.__skipDefaultRespawn=true;
      parents.push({npc,id,owner:null,area:null,role:{kind:row.role,table:row.table}});
      if(!live(api,npc))throw new Error('No world capacity for Christmas actors');
    }
    enabled=true;
    for(const player of api.core.World.getPlayers())if(player?.isRegistered())login(api,{player});
    return {handled:true};
  }catch(error){const cleanup=close(api);return {handled:false,error:error.message+(cleanup.handled?'':'; '+cleanup.error)};}
}
function role(api,npc,player){
  const record=parents.find(record=>record.npc===npc)??escorts.get(player);
  return enabled&&record?.npc===npc&&owned(record)&&live(api,npc)?record.role:null;
}
function spawnEscort(api,player,customer,location){
  if(!clear(api,{player}))return null;
  const id=api.core.CacheDefinitions.getArchivedId('christmas-2025','npc',GUESTS[customer]);
  if(id===null)return null;
  const npc=api.spawnNpc({id,x:location.getX(),y:location.getY(),z:location.getZ(),wanderRadius:0,owner:player,ownerOnly:true});
  if(!npc)return null;
  const record={npc,id,owner:player,area:player.getPrivateArea(),role:{kind:'escort'}};
  escorts.set(player,record);if(record.area)npc.setArea(record.area);
  if(!live(api,npc)){clear(api,{player});return null;}
  npc.setScriptedMovement(true);npc.setFollowing(player);npc.setMobileInteraction(player);
  return npc;
}
function escort(api,request){
  const {player,npc,customer,revision}=request,state=Progress.read(player);
  if(!enabled||role(api,npc,player)?.kind!=='queue'||state.phase!=='queue'||state.customer!==customer||state.revision!==revision||
    npc.getCurrentDefinition(player)?.getId()!==api.core.CacheDefinitions.getArchivedId('christmas-2025','npc',GUESTS[customer])||!Progress.held(api,player))return;
  if(!spawnEscort(api,player,customer,npc.getLocation()))return;
  if(!Progress.greet(api,player,revision,customer)){clear(api,{player});return;}
  request.handled=true;
}
function changed(api,{player}){if(Progress.read(player).phase!=='table')clear(api,{player});}
function login(api,{player}){
  if(enabled&&Progress.read(player).phase==='table'&&player.isRegistered()&&player.getHitpoints()>0&&!escorts.has(player))
    spawnEscort(api,player,Progress.read(player).customer,player.getLocation());
}
function hasEscort(api,player){const record=escorts.get(player);return enabled&&!!record&&owned(record)&&live(api,record.npc);}

module.exports={open,close,role,escort,changed,login,clear,hasEscort};
