"use strict";
const {randomUUID}=require('node:crypto');
const {ChunkedPluginMessageAssembler,encodeChunkedPluginMessage}=require('./Chunks.QuestHelper');
const {tutorialResult}=require('./Tutorial.QuestHelper');
const validSession=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
// Quest Helper settings forwarded to the engine: flat upstream keys with boolean or colour values.
function helperConfig(value){if(!record(value))return undefined;const out={};for(const [key,v] of Object.entries(value).slice(0,64))if(/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)&&(typeof v==='boolean'||Number.isSafeInteger(v)))out[key]=v;return out;}
function lockSection(value){return record(value)&&Number.isSafeInteger(value.section)&&value.section>=0&&value.section<4096&&typeof value.locked==='boolean'?{section:value.section,locked:value.locked}:undefined;}
const status=(q,p)=>q.isComplete(p)?'FINISHED':q.isStarted(p)?'IN_PROGRESS':'NOT_STARTED';
function items(container){return container.getItems().flatMap((item,slot)=>item&&item.getId()>0&&item.getAmount()>0?[{id:item.getId(),quantity:item.getAmount(),slot}]:[]);}
const MAX_EVENTS=1024;
// One round per value the helper discovers, because SnapshotClient.varbit() throws on the first
// missing id: Ernest's six-lever condition tree needs six rounds in a single call. The bound is
// above the largest number of distinct varbits any single helper file reads (55, Mourning's End
// Part II), and it exists only so a bridge that keeps asking cannot spin forever.
const MAX_REQUEST_ROUNDS=64;
// Snapshot sections a browser sends once and then names by digest (client QuestHelperReuse): the
// scene's objects and terrain, the widget tree and the cache definitions. Held per browser session.
const REUSABLE_SECTIONS=['objects','widgets','itemDefinitions','objectDefinitions','npcDefinitions','terrain'];
const TERRAIN_KEYS=['loadedTilesPacked','tileHeightsPacked','tileSettingsPacked'];
const validDigest=d=>typeof d==='string'&&/^[0-9a-f]{1,64}$/.test(d);
/** The full snapshot: sections sent with a digest are kept, sections named by digest are restored. */
function rehydrate(state,raw){
 const {digests,reuse,...snapshot}=raw;
 state.cache??=new Map();
 if(record(digests))for(const section of REUSABLE_SECTIONS){
  const digest=digests[section];if(!validDigest(digest))continue;
  const value=section==='terrain'?(record(snapshot.geometry)?Object.fromEntries(TERRAIN_KEYS.filter(k=>snapshot.geometry[k]!==undefined).map(k=>[k,snapshot.geometry[k]])):undefined):snapshot[section];
  if(value!==undefined)state.cache.set(section,{digest,value});
 }
 if(record(reuse))for(const section of REUSABLE_SECTIONS){
  const digest=reuse[section];if(digest===undefined)continue;
  const held=state.cache.get(section);
  if(!held||held.digest!==digest)throw new Error(`Quest Helper snapshot reuses ${section} the server does not hold`);
  if(section==='terrain')snapshot.geometry={...(record(snapshot.geometry)?snapshot.geometry:{}),...held.value};
  else snapshot[section]=held.value;
 }
 return snapshot;
}
const cachedDigests=state=>Object.fromEntries([...(state.cache??new Map())].map(([section,{digest}])=>[section,digest]));
const validEvents=events=>Array.isArray(events)&&events.length<=MAX_EVENTS&&events.every(event=>record(event)&&typeof event.type==='string'&&event.type.length<=128);

class QuestHelperRuntime {
 constructor({getQuests,bridge,send,nativeResult,projectState,varbitDefinition,eligibility,contract,fillRequests}){this.getQuests=getQuests;this.bridge=bridge;this.send=send;this.nativeResult=nativeResult;this.projectState=projectState;this.varbitDefinition=varbitDefinition;this.eligibility=eligibility;this.contract=contract;this.fillRequests=fillRequests;this.players=new Map();this.agents=new Map();this.catalogData=null;}
 progress(player){const eligibility=this.eligibility?.(player);return this.getQuests().map(q=>({questKey:q.key,status:status(q,player),stage:q.getStage(player),...(eligibility?{eligibility:eligibility.get(q.key)}:{})}));}
 quests(){return this.getQuests().map(q=>({key:q.key,name:q.name}));}
 describe(player,questKey){const quest=this.getQuests().find(q=>q.key===questKey);if(!quest)return null;const wire=this.wire(player,quest),complete=quest.isComplete(player);return {questKey:quest.key,name:quest.name,status:status(quest,player),stage:quest.getStage(player),complete,wire,contract:this.contract?.(quest.name,wire,complete)??null};}
 /** The progress varp/varbit a quest mirrors its stage to, plus the value the client would hold. */
 wire(player,quest){const stage=quest.getStage(player);if(quest.varbitId!==undefined){const definition=this.varbitDefinition?.(quest.varbitId);return {kind:'varbit',id:quest.varbitId,value:quest.varbitValue(stage,player),...(definition?{varp:definition.baseVar,lsb:definition.startBit,msb:definition.endBit}:{})};}if(quest.varpId!==undefined)return {kind:'varp',id:quest.varpId,value:quest.varpValue(stage,player)};return null;}
 emit(player,data){for(const frame of encodeChunkedPluginMessage(data))this.send(player,frame);}
 async catalog(){if(!this.catalogPromise)this.catalogPromise=this.bridge.catalog().catch(error=>{this.catalogPromise=null;throw error;});this.catalogData=await this.catalogPromise;return this.catalogData;}
 helperVariants(questKey){const mapping=this.catalogData?.quests.find(q=>q.questKey===questKey);return mapping?[mapping.helperVariant,...(mapping.variants||[]).map(v=>v.helperVariant)].filter(v=>typeof v==='string'):[];}
 /** Select-time checks tolerate a catalog that has not loaded yet; evaluation does not. */
 checkVariant(questKey,variant,strict){if(variant===undefined)return;const mapping=this.catalogData?.quests.find(q=>q.questKey===questKey);if(!mapping){if(strict)throw new Error('Unknown helper variant');return;}if(!this.helperVariants(questKey).includes(variant))throw new Error('Unknown helper variant');}
 async close(player){const state=this.players.get(player);if(!state)return;this.players.delete(player);state.active=false;state.assembler.clear();await this.bridge.close(state.engineSession).catch(()=>{});}
 async closeAgent(player){const state=this.agents.get(player);if(!state)return;this.agents.delete(player);await this.bridge.close(state.engineSession).catch(()=>{});}
 async closePlayer(player){await this.close(player);await this.closeAgent(player);}
 async shutdown(){const players=new Set([...this.players.keys(),...this.agents.keys()]);await Promise.all([...players].map(p=>this.closePlayer(p)));}
 /** The last result a connected client received, or the last headless one. Read by the agent MCP. */
 lastResult(player){return this.players.get(player)?.lastResult??null;}
 lastAgentResult(player){return this.agents.get(player)?.lastResult??null;}
 /** One evaluation's request, shared by the client path and the headless one. */
 requestFor(player,state,data){
  const quest=this.getQuests().find(q=>q.key===data.questKey);
  if(!quest)throw new Error('Unknown quest');
  const snapshot=this.authoritative(player,data.snapshot,quest.key);
  return {quest,request:{protocol:1,session:state.engineSession,sequence:data.sequence,questKey:quest.key,helperVariant:data.helperVariant,snapshot,events:data.events,config:helperConfig(data.config),lockSection:lockSection(data.lockSection),...(data.bankTab===true?{bankTab:true}:{})}};
 }
 /** The server's own renderers, or null when only the Java bridge can answer. */
 nativeOf(quest,request,player){return quest.key==='learning_the_ropes'?tutorialResult(request,quest.getStage(player)):(this.nativeResult?.(request,player)??null);}
 async compute(player,state,data){
  const {quest,request}=this.requestFor(player,state,data);
  return this.nativeOf(quest,request,player)??await this.bridge.evaluate(request);
 }
 /**
  * Evaluate a quest for an agent with no client attached. `snapshot` is built from server state;
  * authoritative() then replaces every var, quest state, item, skill and position with the
  * server's own. Sessions are per player and separate from a browser's, so a live client keeps
  * its own helper engine and neither call sees the other's sequence.
  */
 async evaluateHeadless(player,options){
  if(!record(options))throw new Error('Invalid Quest Helper request');
  const quest=this.getQuests().find(q=>q.key===options.questKey);
  if(!quest)throw new Error(`Unknown quest ${String(options.questKey)}`);
  if(!record(options.snapshot))throw new Error('Invalid helper snapshot');
  if(options.events!==undefined&&!validEvents(options.events))throw new Error('Invalid helper events');
  const variant=options.helperVariant;
  let state=this.agents.get(player);
  if(state&&(state.questKey!==quest.key||state.helperVariant!==variant||options.fresh===true)){await this.closeAgent(player);state=null;}
  if(!state){state={session:'agent',engineSession:randomUUID(),questKey:quest.key,helperVariant:variant,sequence:0,busy:false};this.agents.set(player,state);}
  if(state.busy)throw new Error('Quest Helper is still evaluating the previous headless call');
  state.busy=true;
  try {
   let snapshot=options.snapshot,response=null,rounds=0,unresolved=[],lastRequests='';
   // Values already discovered for this route, refreshed from the server on every call: the chain
   // is walked once, not once per tool call.
   state.requested??=new Set();
   if(state.requested.size&&this.fillRequests){
    const seeded=this.fillRequests(player,[...state.requested].map(id=>({kind:'varbit',id})),snapshot);
    if(seeded)snapshot=seeded.snapshot;
   }
   for(;;){
    const data={questKey:quest.key,helperVariant:variant,snapshot,events:options.events??[],config:options.config,lockSection:options.lockSection,bankTab:options.bankTab,sequence:state.sequence+1};
    state.sequence=data.sequence;
    // The native routes never touch the bridge, so they must not depend on it having started.
    response=this.nativeOf(quest,this.requestFor(player,state,data).request,player);
    if(response===null){
     const catalogError=await this.catalog().then(()=>null,error=>error);
     this.checkVariant(quest.key,data.helperVariant,true);
     // rebuilt: authoritative() writes the catalogue's numeric quest ids into questStates.
     const request=this.requestFor(player,state,data).request;
     response=await this.bridge.evaluate(request).catch(error=>{throw catalogError??error;});
    }
    if(this.agents.get(player)!==state)throw new Error('Quest Helper session was closed while evaluating');
    // A step that reads state the snapshot omits asks for it instead of failing. Answer from the
    // server and ask again, bounded: the browser does the same between two snapshots.
    const requests=Array.isArray(response.requests)?response.requests:[];
    const signature=JSON.stringify(requests);
    const filled=requests.length&&this.fillRequests&&rounds<MAX_REQUEST_ROUNDS?this.fillRequests(player,requests,snapshot):null;
    // No new value to learn and the same ask again: the chain is stuck, report it rather than spin.
    if(!filled||(signature===lastRequests&&!filled.ids.some(id=>!state.requested.has(id)))){unresolved=requests;break;}
    for(const id of filled.ids)state.requested.add(id);
    snapshot=filled.snapshot;unresolved=filled.unsupported;rounds+=1;lastRequests=signature;
   }
   if(this.agents.get(player)!==state)throw new Error('Quest Helper session was closed while evaluating');
   const result={...response,type:'result',protocol:1,session:state.session,sequence:state.sequence,questKey:quest.key,questProgress:this.progress(player),...(rounds?{requestsFilled:rounds}:{}),...(unresolved.length?{requestsUnresolved:unresolved}:{})};
   state.lastResult={at:Date.now(),result};
   return result;
  }finally{state.busy=false;}
 }
 async receive(player,frame){
  if(!record(frame)||!validSession(frame.session)||frame.protocol!==1)return;
  let state=this.players.get(player);
  if(state&&state.session!==frame.session){await this.close(player);state=null;}
  if(!state){state={session:frame.session,engineSession:randomUUID(),assembler:new ChunkedPluginMessageAssembler(frame.session),active:true,sequence:0,busy:false,questKey:null};this.players.set(player,state);}
  try{
   let data=state.assembler.accept(frame);if(!data)return;
   if(data.type==='close'){await this.close(player);return;}
   if(data.type==='catalog'){
    if(!this.catalogPromise)this.catalogPromise=this.bridge.catalog().catch(error=>{this.catalogPromise=null;throw error;});const catalog=await this.catalogPromise;if(this.players.get(player)!==state)return;this.catalogData=catalog;
    const mapped=new Map(catalog.quests.map(q=>[q.questKey,q]));
    const progress=new Map(this.progress(player).map(q=>[q.questKey,q]));
    this.emit(player,{...catalog,type:'catalog',protocol:1,session:state.session,quests:this.getQuests().map(q=>({...mapped.get(q.key),questKey:q.key,name:q.name,supported:mapped.get(q.key)?.supported===true,...progress.get(q.key)}))});return;
   }
   const quest=this.getQuests().find(q=>q.key===data.questKey);
   if(!quest)throw new Error('Unknown quest');
   if(data.type==='select'){
    this.checkVariant(quest.key,data.helperVariant,false);
    const old=state.engineSession;state.engineSession=randomUUID();state.questKey=quest.key;state.helperVariant=data.helperVariant;state.sequence=0;state.generation=(state.generation||0)+1;state.busy=false;
    await this.bridge.close(old).catch(()=>{});return;
   }
   if(data.type!=='evaluate'||quest.key!==state.questKey)throw new Error('Select a quest before evaluating');
   if(!Number.isSafeInteger(data.sequence)||data.sequence<=state.sequence||state.busy)return;
   if(data.helperVariant!==state.helperVariant)throw new Error('Helper variant changed without selecting');
   if(!record(data.snapshot)||!validEvents(data.events))throw new Error('Invalid helper snapshot/events');
   data={...data,snapshot:rehydrate(state,data.snapshot)};
   state.sequence=data.sequence;state.busy=true;const generation=state.generation;
   try {
    if(this.catalogPromise)this.catalogData=await this.catalogPromise;
    if(this.players.get(player)!==state||state.generation!==generation)return;
    this.checkVariant(quest.key,data.helperVariant,true);
    const response=await this.compute(player,state,data);
    if(this.players.get(player)!==state||!state.active||state.generation!==generation)return;
    const result={...response,type:'result',protocol:1,session:state.session,sequence:data.sequence,questKey:quest.key,questProgress:this.progress(player),cached:cachedDigests(state)};
    // Kept for the agent MCP's conformance check: what a real client was just told.
    state.lastResult={at:Date.now(),result};
    this.emit(player,result);
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
module.exports={QuestHelperRuntime,helperConfig,lockSection,MAX_REQUEST_ROUNDS};
