"use strict";

const Progress=require('./Progress.ChristmasDinner');
const Scene=require('./Scene.ChristmasDinner');
const Dialogue=require('./Dialogue.ChristmasDinner');
const Rewards=require('./Rewards.ChristmasDinner');
const Music=require('./Music.ChristmasDinner');
const Presentation=require('./Presentation.ChristmasDinner');
const {actors,cutsceneActors}=require('./data/christmas-2025-scene.json');
const sessions=new Map();
// The source establishes this sequence, not its exact walk/camera or emote ticks.
// These provisional presentation timings still need video calibration before release.
const MAX_SCENE_TICKS=80,EMOTE_TICKS=4;

function live(api,record){
  const {player,area,revision}=record,state=Progress.read(player);
  return sessions.get(player)===record&&Scene.active()&&Dialogue.active()&&player.isRegistered()&&
    player.getHitpoints()>0&&player.getPrivateArea()===area&&!area.isDestroyed()&&
    state.phase==='ready'&&state.revision===revision&&Progress.held(api,player)&&
    record.npcs.every(npc=>npc.isRegistered()&&api.core.World.getNpcs().get(npc.getIndex())===npc&&npc.getOwner()===player&&npc.getPrivateArea()===area);
}
function clear(api,{player,keepFade=false},leaving=false){
  if(!keepFade)Presentation.cancel(api,{player});
  const record=sessions.get(player);if(!record)return;
  sessions.delete(player);api.core.TaskManager.cancelTasks(record);
  if(!keepFade)Presentation.closeFade(record);
  Dialogue.clear({player,completion:record});
  const owned=player.getPrivateArea()===record.area;
  // Detach actors before the last player leaves: PrivateArea.postLeave destroys
  // an empty instance and would otherwise queue even a transferred NPC.
  for(const npc of record.npcs){
    const ours=npc.getOwner()===player&&npc.getPrivateArea()===record.area;
    if(npc.getPrivateArea()===record.area)record.area.leave(npc,false);
    if(ours)api.removeNpc(npc);
  }
  if(owned){
    Presentation.clear(api,record);
    player.getMovementQueue().reset().setBlockMovement(record.blocked);
    player.setUntargetable(record.untargetable);
    player.performAnimation(api.core.Animation.DEFAULT_RESET_ANIMATION);
    if(!leaving){player.setLocation(record.returnLocation);record.area.leave(player,false);}
  }
  if(!record.area.isDestroyed())record.area.destroy();
}
function cancelAll(api){for(const player of [...sessions.keys()])clear(api,{player});Presentation.cancelAll(api);}
function spawn(api,record,row){
  const c=api.core,id=c.CacheDefinitions.getArchivedId('christmas-2025','npc',row.symbol);
  if(id===null)throw new Error('Missing Christmas cutscene actor '+row.symbol);
  const npc=api.spawnNpc({id,x:row.x,y:row.y,z:row.z,wanderRadius:0,owner:record.player,ownerOnly:true,
    ...(row.face?{face:c.Direction[row.face].getId()}:{})});
  if(!npc)throw new Error('Could not create Christmas cutscene actor '+row.symbol);
  record.npcs.push(npc);record.area.enter(npc);
  if(!npc.isRegistered())throw new Error('No world capacity for Christmas cutscene actor '+row.symbol);
  npc.setScriptedMovement(true);
  if(row.animation)npc.performAnimation(new c.Animation(c.CacheDefinitions.getSeqId(row.animation)));
  return npc;
}
function emote(api,{player}){
  const record=sessions.get(player);
  if(!record||record.phase!=='speech'||!live(api,record))return;
  player.performAnimation(new api.core.Animation(api.core.CacheDefinitions.getSeqId('emote_jump_with_joy')));
  record.cook.performAnimation(new api.core.Animation(api.core.CacheDefinitions.getSeqId('emote_laugh')));
  record.phase='emote';record.wait=EMOTE_TICKS;
}
function tick(api,record){
  if(!live(api,record)||++record.ticks>MAX_SCENE_TICKS){clear(api,record);return;}
  if(record.phase==='walk'){
    if(!record.cook.getLocation().equals(record.target))return;
    record.cook.setPositionToFace(record.player.getLocation());
    record.player.setPositionToFace(record.cook.getLocation());
    Presentation.delivery(api,record);
    record.phase='speech';
    if(!Dialogue.start(api,{player:record.player,npc:record.cook,
      variant:'completing-the-event-sitting-at-the-table',completion:record,
      guard:()=>live(api,record),select:steps=>steps.find(step=>step.id==='uSR1LP').steps.slice(1)}))clear(api,record);
  }else if(record.phase==='emote'&&--record.wait<=0){
    if(!Presentation.fadeOut(api,record)){clear(api,record);return;}
    record.phase='fade-out';record.wait=Presentation.FADE_TICKS;
  }else if(record.phase==='fade-out'){
    if(!Presentation.ownsFade(record)){clear(api,record);return;}
    if(--record.wait>0)return;
    // Re-plan on the live inventory at the commit point: neither sitting nor
    // earlier capacity checks authorize a later grant on changed state.
    if(!Rewards.claim(api,record.player,record.revision)){clear(api,record);return;}
    clear(api,{player:record.player,keepFade:true});
    Presentation.reveal(api,record);
    Rewards.show(api,record.player);
  }
}
function start(api,request){
  const {player,table,object,revision}=request,state=Progress.read(player),c=api.core;
  const placement=actors.find(row=>row.role==='seat'&&row.table===table);
  if(!placement||sessions.has(player)||!Scene.active()||!Dialogue.active()||!player.isRegistered()||
    player.getHitpoints()<=0||player.getPrivateArea()||state.phase!=='ready'||state.revision!==revision||
    state.seats.includes(table)||!Rewards.plan(api,player,revision)||
    !Scene.objects().some(row=>row.object===object&&row.symbol===`xmas25_table_${table+1}`)||!c.World.getObjects().includes(object))return;
  let record;
  class DinnerArea extends c.PrivateArea{
    getMusicTrack(){return Music.track(api);}
    process(character){if(character===player&&record&&!live(api,record))clear(api,{player});}
    postLeave(character,logout){if(character===player)clear(api,{player},true);super.postLeave(character,logout);}
    canAttack(){return false;}
    canTeleport(){return false;}
    canTrade(){return false;}
  }
  const area=new DinnerArea([new c.Boundary(3210,3245,3388,3420,0)]);
  if(!Scene.copyToPrivateArea(api,area).handled){area.destroy();return;}
  record={player,area,revision,table,npcs:[],ticks:0,phase:'walk',returnLocation:player.getLocation().clone(),
    blocked:player.getMovementQueue().isMovementBlocked(),untargetable:player.isUntargetable()};
  sessions.set(player,record);
  try{
    area.enter(player);player.getMovementQueue().reset().setBlockMovement(true);player.setUntargetable(true);
    player.setLocation(new c.Location(placement.x,placement.y,placement.z));
    // Source video shows the chef walking in with the plate. Exact route and
    // background cast positions are still open evidence gaps, not RSProx facts.
    const cook=spawn(api,record,{symbol:'xmas25_cutscene_chef_with_plate',x:3225,y:3395,z:0});record.cook=cook;
    // Private-area visibility intentionally excludes the public actors. Copy
    // the real morph parents so all three saved guests keep their own seats.
    for(const row of actors)if(row.role!=='queue')spawn(api,record,row);
    for(const row of cutsceneActors)spawn(api,record,row);
    record.target=new c.Location(3222,object.getLocation().getY(),placement.z);
    cook.getMovementQueue().addSteps(record.target);
    Presentation.start(api,record);
    class DinnerTask extends c.Task{constructor(){super(1,record);}execute(){tick(api,record);}}
    c.TaskManager.submit(new DinnerTask());request.handled=true;
  }catch(error){clear(api,{player});api.log('Christmas completion: '+error.message);}
}

function delivered(api,{player}){
  const record=sessions.get(player);if(!record||record.phase!=='speech'||!live(api,record))return;
  const id=api.core.CacheDefinitions.getArchivedId('christmas-2025','npc','xmas25_cutscene_chef_no_plate');
  if(id!==null)record.cook.setNpcTransformationId(id);
}

module.exports={start,emote,delivered,clear,cancelAll};
