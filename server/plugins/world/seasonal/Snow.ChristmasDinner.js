"use strict";

const Scene=require('./Scene.ChristmasDinner');
const sessions=new Map();
const BATCH=3,FIRST_TICKS=2,REPEAT_TICKS=4;

// Wiki Snow's technical schedule, corroborated by a 2025 collector's corrected
// measurement (reddit1pjk2bl, Dec12). Snowball's3/5 text conflicts; no
// RSProx pickup action was available. Animation identity comes from the cache.
function reachable(api,player,object){
  if(player.getPrivateArea()!==object.getPrivateArea()||player.getLocation().getZ()!==object.getLocation().getZ())return false;
  const p=object.getLocation(),d=object.getDefinition();
  return api.core.PathFinder.reachedObject(player,p.getX(),p.getY(),d.getSizeX(),d.getSizeY(),object.getFace(),10,d.getBlockingMask());
}
function owned(api,object){
  return !object.getOwner()&&!object.getPrivateArea()&&Scene.active()&&Scene.objects().some(row=>row.symbol==='xmas25_snowball_pile'&&row.object===object)&&
    api.core.World.getObjects().includes(object);
}
function clear({player}){sessions.get(player)?.stop();}
function cancelAll(){for(const task of [...sessions.values()])task.stop();}
function take(api,{player,object}){
  if(!owned(api,object))return false;
  if(!player.isRegistered()||player.getHitpoints()<=0||player.busy()||!reachable(api,player,object))return true;
  clear({player});
  const c=api.core,id=c.CacheDefinitions.getObjId('gublinch_snowball'),seq=c.CacheDefinitions.getSeqId('gub_xmas_human_snowball_making');
  if(id===null||seq===null)return true;
  let tick=0,animation;
  function animate(){animation=new c.Animation(seq);player.performAnimation(animation);}
  const task=new(class extends c.Task{
    constructor(){super(1,player.getIndex(),false);}
    execute(){
      if(sessions.get(player)!==this||!player.isRegistered()||player.getHitpoints()<=0||player.busy()||!owned(api,object)||!reachable(api,player,object))return this.stop();
      ++tick;
      if(tick>=FIRST_TICKS&&(tick-FIRST_TICKS)%REPEAT_TICKS===0){
        const batch=new c.Item(id,BATCH),inventory=player.getInventory();
        if(inventory.getAddableAmount(batch)<BATCH){inventory.full(id);return this.stop();}
        inventory.addItem(batch);
      }
      if(tick%REPEAT_TICKS===0)animate();
    }
    stop(){
      super.stop();
      if(sessions.get(player)!==this)return;
      sessions.delete(player);
      if(player.getAnimation()===animation)player.performAnimation(c.Animation.DEFAULT_RESET_ANIMATION);
    }
  })();
  sessions.set(player,task);animate();c.TaskManager.submit(task);
  return true;
}

module.exports={take,clear,cancelAll};
