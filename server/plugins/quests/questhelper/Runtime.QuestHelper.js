"use strict";
const {randomUUID}=require('node:crypto');
const {ChunkedPluginMessageAssembler,encodeChunkedPluginMessage}=require('./Chunks.QuestHelper');
const {tutorialResult}=require('./Tutorial.QuestHelper');
const validSession=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const status=(q,p)=>q.isComplete(p)?'FINISHED':q.isStarted(p)?'IN_PROGRESS':'NOT_STARTED';
function items(container){return container.getItems().flatMap((item,slot)=>item&&item.getId()>0&&item.getAmount()>0?[{id:item.getId(),quantity:item.getAmount(),slot}]:[]);}

class QuestHelperRuntime {
 constructor({getQuests,bridge,send,nativeResult,projectState,varbitDefinition}){this.getQuests=getQuests;this.bridge=bridge;this.send=send;this.nativeResult=nativeResult;this.projectState=projectState;this.varbitDefinition=varbitDefinition;this.players=new Map();this.catalogData=null;}
 emit(player,data){for(const frame of encodeChunkedPluginMessage(data))this.send(player,frame);}
 async close(player){const state=this.players.get(player);if(!state)return;this.players.delete(player);state.active=false;state.assembler.clear();await this.bridge.close(state.engineSession).catch(()=>{});}
 async shutdown(){await Promise.all([...this.players.keys()].map(p=>this.close(p)));}
 async receive(player,frame){
  if(!record(frame)||!validSession(frame.session)||frame.protocol!==1)return;
  let state=this.players.get(player);
  if(state&&state.session!==frame.session){await this.close(player);state=null;}
  if(!state){state={session:frame.session,engineSession:randomUUID(),assembler:new ChunkedPluginMessageAssembler(frame.session),active:true,sequence:0,busy:false,questKey:null};this.players.set(player,state);}
  try{
   const data=state.assembler.accept(frame);if(!data)return;
   if(data.type==='close'){await this.close(player);return;}
   if(data.type==='catalog'){
    this.catalogPromise=this.bridge.catalog();const catalog=await this.catalogPromise;if(this.players.get(player)!==state)return;this.catalogData=catalog;
    const mapped=new Map(catalog.quests.map(q=>[q.questKey,q]));
    this.emit(player,{...catalog,type:'catalog',protocol:1,session:state.session,quests:this.getQuests().map(q=>({...mapped.get(q.key),questKey:q.key,name:q.name,supported:mapped.get(q.key)?.supported===true,status:status(q,player),stage:q.getStage(player)}))});return;
   }
   const quest=this.getQuests().find(q=>q.key===data.questKey);
   if(!quest)throw new Error('Unknown quest');
   if(data.type==='select'){
    const mapping=this.catalogData?.quests.find(q=>q.questKey===quest.key);
    if(data.helperVariant!==undefined&&mapping&&![mapping.helperVariant,...(mapping.variants||[]).map(v=>v.helperVariant)].includes(data.helperVariant))throw new Error('Unknown helper variant');
    const old=state.engineSession;state.engineSession=randomUUID();state.questKey=quest.key;state.helperVariant=data.helperVariant;state.sequence=0;state.generation=(state.generation||0)+1;state.busy=false;
    await this.bridge.close(old).catch(()=>{});return;
   }
   if(data.type!=='evaluate'||quest.key!==state.questKey)throw new Error('Select a quest before evaluating');
   if(!Number.isSafeInteger(data.sequence)||data.sequence<=state.sequence||state.busy)return;
   if(data.helperVariant!==state.helperVariant)throw new Error('Helper variant changed without selecting');
   if(!record(data.snapshot)||!Array.isArray(data.events)||data.events.length>1024||!data.events.every(e=>record(e)&&typeof e.type==='string'&&e.type.length<=128))throw new Error('Invalid helper snapshot/events');
   state.sequence=data.sequence;state.busy=true;const generation=state.generation;
   try {
    if(this.catalogPromise)this.catalogData=await this.catalogPromise;
    if(this.players.get(player)!==state||state.generation!==generation)return;
    const mapping=this.catalogData?.quests.find(q=>q.questKey===quest.key);
    if(data.helperVariant!==undefined&&(!mapping||![mapping.helperVariant,...(mapping.variants||[]).map(v=>v.helperVariant)].includes(data.helperVariant)))throw new Error('Unknown helper variant');
    const snapshot=this.authoritative(player,data.snapshot,quest.key);
    const request={protocol:1,session:state.engineSession,sequence:data.sequence,questKey:quest.key,helperVariant:data.helperVariant,snapshot,events:data.events};
    const response=quest.key==='learning_the_ropes'?tutorialResult(request,quest.getStage(player)):(this.nativeResult?.(request,player)??await this.bridge.evaluate(request));
    if(this.players.get(player)!==state||!state.active||state.generation!==generation)return;
    this.emit(player,{...response,type:'result',protocol:1,session:state.session,sequence:data.sequence,questKey:quest.key});
   }finally{if(state.generation===generation)state.busy=false;}
  }catch(error){if(this.players.get(player)===state)this.emit(player,{type:'error',protocol:1,session:state.session,code:'QUEST_HELPER_UNAVAILABLE',message:String(error.message).slice(0,1024)});}
 }
 authoritative(player,raw,questKey){
  const snapshot={...raw,varps:record(raw.varps)?{...raw.varps}:{},varbits:record(raw.varbits)?{...raw.varbits}:{},questStates:{}};
  for(const q of this.getQuests()){
   const stage=q.getStage(player);snapshot.questStates[q.key]=status(q,player);
   const mapping=this.catalogData?.quests.find(entry=>entry.questKey===q.key);
   for(const entry of [mapping,...(mapping?.variants||[])])if(Number.isInteger(entry?.questId))snapshot.questStates[entry.questId]=status(q,player);
   if(q.varbitId!==undefined)snapshot.varbits[q.varbitId]=q.varbitValue(stage,player);
   else if(q.varpId!==undefined)snapshot.varps[q.varpId]=q.varpValue(stage,player);
  }
  Object.assign(snapshot.varbits,this.projectState?.(player)?.varbits||{});
  snapshot.varbitDefinitions={...(record(raw.varbitDefinitions)?raw.varbitDefinitions:{})};
  for(const [id,value] of Object.entries(snapshot.varbits)){
   const definition=this.varbitDefinition?.(Number(id));if(!definition)continue;
   const {baseVar,startBit,endBit}=definition;
   if(!Number.isInteger(baseVar)||!Number.isInteger(startBit)||!Number.isInteger(endBit)||startBit<0||endBit<startBit||endBit>31)throw new Error('Invalid native quest varbit definition');
   const mask=(2**(endBit-startBit+1)-1)>>>0;
   snapshot.varps[baseVar]=((snapshot.varps[baseVar]||0)&~(mask<<startBit))|((value&mask)<<startBit);
   snapshot.varbitDefinitions[id]={varp:baseVar,lsb:startBit,msb:endBit};
  }
  snapshot.inventory=items(player.getInventory());snapshot.equipment=items(player.getEquipment());
  const location=player.getLocation();snapshot.localPlayer={...raw.localPlayer,name:player.getUsername(),x:location.getX(),y:location.getY(),plane:location.getZ()};snapshot.plane=location.getZ();
  const delivered=Number(player.getAttribute('cooks-assistant:delivered-ingredients'))||0;
  snapshot.dialogueHistory=questKey==='cooks_assistant'?["Here's a bucket of milk.","Here's a fresh egg.","Here's a pot of flour."].filter((_,bit)=>(delivered&(1<<bit))!==0):[];
  return snapshot;
 }
}
module.exports={QuestHelperRuntime};
