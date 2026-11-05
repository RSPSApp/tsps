/** Real Player/PacketSender → cache-241 script4029. Run after server build with tsx --test. */
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import {createCacheVm} from '../scripts/cache/cs2-sweep';
const server = path.resolve(__dirname, '../../server');
process.chdir(server);
require(path.join(server,'dist/Server')).Server.installProductionPathResolver();
const {PluginManager: PM} = require(path.join(server,'dist/plugins/PluginManager'));
const {Player} = require(path.join(server,'dist/game/entity/impl/player/Player'));
const {PlayerSession} = require(path.join(server,'dist/net/PlayerSession'));
const {CacheDefinitions: C} = require(path.join(server,'dist/game/cache/CacheDefinitions'));
const Q = require(path.join(server,'plugins/quests/QuestRuntime'));
const {questMetadata} = require(path.join(server,'plugins/quests/QuestList.QuestRuntime'));
const logins: Function[] = [], custom = new Map<string,Function[]>(), emitted: any[] = [], exported: any[] = [];
let vm: any, loading = "";
const npcHandlers = new Map<string, Function>();
// Pinned QH 06da90 phase keys; terminal values independently come from cache DB endstate.
const cases = [
 ['KingsRansom','kings_ransom',[0,5,10,15,20,25,30,35,40,45,50,55,65,70,75,80,85],[0,5,10,15,20,25,30,35,40,45,50,55,65,70,75,80,90]],
 ['LegendsQuest','legends_quest',[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,22,25,30,32,35,40,45,50,55,60,65,70],[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17,18,19,20,22,25,30,32,35,40,45,50,55,60,65,75]],
 ['SwanSong','swan_song',[0,5,10,30,40,55,65,80,90,110,120,130,140,150,190],[0,5,10,30,40,55,65,80,90,110,120,130,140,150,200]],
 ['UndergroundPass','underground_pass',[0,1,2,3,4,5,6,7,8,9,10],[0,1,2,3,4,5,6,7,8,9,11]],
 ['ValeTotems','vale_totems',[0,10,20,30,40,50,60,70],[0,10,20,30,40,50,60,100]],
 ['Watchtower','watchtower',[0,1,2,3,4,5,6,7,8,9,10,11,12,14],[0,1,2,3,4,5,6,7,8,9,10,11,13,14]],
 ['CreatureOfFenkenstrain','creature_of_fenkenstrain',[0,1,2,3,4,5,6,7],[0,1,2,3,4,5,6,9]],
] as const;
before(async()=>{
 await require(path.join(server,'dist/game/cache/CachePipeline')).CachePipeline.initialize(server);
 const base = PM.createApi('NativeQuestStateB');
 const api:any = new Proxy(base,{get(target,key){
  if(key==='withProfileLabel') return ()=>api;
  if(key==='onNpcInteraction') return (fn:Function)=>npcHandlers.set(loading,fn);
  if(key==='onPlayerLogin') return (fn:Function)=>logins.push(fn);
  if(key==='onCustomEvent') return (name:string,fn:Function)=>custom.set(name,[...(custom.get(name)??[]),fn]);
  if(key==='emitCustomEvent') return (name:string,event:any)=>emitted.push({name,event});
  if(typeof key==='string' && (/^on[A-Z]/.test(key)||['persistAttribute','registerArea','registerCommand','log'].includes(key))) return ()=>{};
  return typeof target[key]==='function'?target[key].bind(target):target[key];
 }});
 for(const[file]of cases) { loading=file; require(path.join(server,'plugins/quests/quests',file+'.Quest'))(api); }
 vm=createCacheVm(path.join(server,'caches',fs.readFileSync(path.join(server,'target.txt'),'utf8').trim())).vm;
});
function fixture(t:any,initial:Record<string,any>={}){
 const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const player=new Player(new PlayerSession(channel));
 player.setUsername('nativestateb');
 for(const[k,v]of Object.entries(initial)) player.setAttribute(k,v);
 const sender=player.getPacketSender(),sent=new Map<string,number>();
 const config=sender.sendConfig.bind(sender),bit=sender.sendVarbit.bind(sender);
 t.mock.method(sender,'sendConfig',(id:number,value:number)=>{const result=config(id,value);sent.set('p'+id,value);vm.context.varManager.setVarp(id,sender.getVarp(id));return result;});
 t.mock.method(sender,'sendVarbit',(id:number,value:number)=>{const result=bit(id,value);sent.set('b'+id,value);const def=C.getVarbit(id);vm.context.varManager.setVarp(def.baseVar,sender.getVarp(def.baseVar));return result;});
 return {player,sender,sent};
}
function quest(key:string){return Q.getRegisteredQuests().find((q:any)=>q.key===key);}
function check(q:any,f:any,stage:number,value:number){
 const db=questMetadata(q,C),kind=q.varbitId===undefined?'p':'b',parent=q.varbitId===undefined?q.varpId:C.getVarbit(q.varbitId).baseVar;
 assert.equal(f.sent.get(kind+(q.varbitId??q.varpId)),value,q.key+' wire');
 assert.equal(q.getStage(f.player),stage,'stored stage remains compatible');
 vm.runScriptEvent({args:[4029,db.rowId]});assert.equal(vm.lastError,null);
 const expectedStatus=stage===0?1:stage>=q.completionValue?2:0;
 assert.equal(vm.intStack[0],expectedStatus,q.key+' native status at '+stage);
 if(stage>=q.completionValue) assert.ok(value>=Number(db.endstate[0]),'real cache completion threshold');
 exported.push({key:q.key,rowId:db.rowId,stage,complete:q.completionValue,varpId:q.varpId,varbitId:q.varbitId,value,parentVarp:parent,parentValue:f.sender.getVarp(parent),expectedStatus});
}
for(const[,key,stages,values]of cases){
 test(key+': every stored phase emits its native cache phase with actual Player and stage callbacks',t=>{
  const q=quest(key),f=fixture(t);
  for(let i=0;i<stages.length;i++){
   q.setStage(f.player,stages[i]);check(q,f,stages[i],values[i]);
   assert.equal(emitted.at(-1).name,'quest:stage-changed');assert.equal(emitted.at(-1).event.stage,stages[i]);
  }
 });
 test(key+': completion retains saved stages/rewards and repeated completion is inert',t=>{
  const q=quest(key),f=fixture(t),last=Number(questMetadata(q,C).endstate[0]);
  assert.equal(q.complete(f.player,{scroll:false,announce:false}),true);
  check(q,f,q.completionValue,last);
  assert.equal(f.player.getAttribute('quest.points'),q.questPoints);
  const items=f.player.getInventory().getItems().map((item:any)=>item.clone());
  const xp=PM.getCoreApi().Skill.values().map((skill:any)=>f.player.getSkillManager().getExperience(skill));
  assert.equal(q.complete(f.player,{scroll:false,announce:false}),false);
  assert.equal(f.player.getAttribute('quest.points'),q.questPoints);
  assert.deepEqual(f.player.getInventory().getItems(),items);
  assert.deepEqual(PM.getCoreApi().Skill.values().map((skill:any)=>f.player.getSkillManager().getExperience(skill)),xp);
 });
 test(key+': legacy unstarted/progress/complete saves restore on login and bootstrap without rewards',t=>{
  const q=quest(key);
  for(const i of [0,1,stages.length-1])for(const saved of [stages[i],String(stages[i])]){
   const f=fixture(t,{['quest.'+key+'.stage']:saved,'quest.points':17});
   const before=f.player.getInventory().getItems().map((item:any)=>item.clone());
   for(const replay of [logins.find(fn=>fn===Q.sendQuestVarps),(event:any)=>{for(const fn of custom.get('player:bootstrap-complete')??[])fn(event);}]){
    assert.equal(typeof replay,'function');f.sender.sendConfig(q.varpId,0);replay!({player:f.player});check(q,f,stages[i],values[i]);
    assert.equal(f.player.getAttribute('quest.'+key+'.stage'),saved,'login must not migrate saved stages');
    assert.equal(f.player.getAttribute('quest.points'),17);assert.deepEqual(f.player.getInventory().getItems(),before,'login cannot award items');
   }
  }
 });
}
test('bitfield writes preserve siblings; disguised Arthur and read-scroll checkpoints remain distinct',t=>{
 for(const key of ['kings_ransom','swan_song','vale_totems','creature_of_fenkenstrain']){
  const q=quest(key),f=fixture(t),def=C.getVarbit(q.varbitId),sentinel=1<<30;
  f.sender.sendConfig(def.baseVar,sentinel);q.setStage(f.player,q.completionValue);
  assert.equal(f.sender.getVarp(def.baseVar)&sentinel,sentinel,key+' sibling bit');
  check(q,f,q.completionValue,Number(questMetadata(q,C).endstate[0]));
 }
 const q=quest('kings_ransom'),f=fixture(t,{'quest.kings_ransom.disguise-given':true});
 q.setStage(f.player,80);check(q,f,80,85);
 Q.sendQuestVarps({player:f.player});check(q,f,80,85);
 const watch=quest('watchtower');watch.setStage(f.player,14);check(watch,f,14,14);
});
test('Arthur disguise handoff immediately publishes its native phase without migrating saved stage',t=>{
 const q=quest('kings_ransom'),f=fixture(t),core=PM.getCoreApi();
 q.setStage(f.player,80);
 f.player.getInventory().adds(core.ItemIdentifiers.BRONZE_MED_HELM,1);
 f.player.getInventory().adds(core.ItemIdentifiers.IRON_CHAINBODY,1);
 const event={player:f.player,npcId:4339,clickType:1,definition:{getActions:()=>['Talk-to']},location:new core.Location(1867,4244,0),handled:false};
 const stageEventsBefore=emitted.filter(event=>event.name==='quest:stage-changed').length;
 npcHandlers.get('KingsRansom')!(event);
 assert.equal(emitted.filter(event=>event.name==='quest:stage-changed').length,stageEventsBefore,'flag-only publication cannot synthesize a stage callback');
 assert.equal(event.handled,true);
 assert.equal(f.player.getAttribute('quest.kings_ransom.disguise-given'),true);
 check(q,f,80,85);
 assert.equal(f.player.getInventory().contains(core.ItemIdentifiers.BRONZE_MED_HELM),false);
 assert.equal(f.player.getInventory().contains(core.ItemIdentifiers.IRON_CHAINBODY),false);
});
test('optional external evidence export contains only native state, no account data',()=>{
 if(process.env.NATIVE_STATE_CASES_OUT) fs.writeFileSync(process.env.NATIVE_STATE_CASES_OUT,JSON.stringify(exported,null,2));
});
