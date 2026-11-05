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
let vm: any, api: any, loading = "";
const npcHandlers = new Map<string, Function>();
// Pinned QH 06da90 phase keys; terminal values independently come from cache DB endstate.
const cases = [
 ['LostTribe','the_lost_tribe',[0,1,2,3,4,5,6,7,8,9,10,11,12],[0,1,2,3,4,4,5,5,6,8,10,10,11]],
 ['RecruitmentDrive','recruitment_drive',[0,1,2,3,4],[0,1,1,1,2]],
 ['ShieldOfArrav','shield_of_arrav',[0,1,2,3,4,6,7],[0,1,1,1,1,1,2]],
] as const;
before(async()=>{
 await require(path.join(server,'dist/game/cache/CachePipeline')).CachePipeline.initialize(server);
 const base = PM.createApi('NativeQuestStateC');
 api = new Proxy(base,{get(target,key){
  if(key==='withProfileLabel') return ()=>api;
  if(key==='onNpcInteraction') return (fn:Function)=>npcHandlers.set(loading,fn);
  if(key==='onPlayerLogin') return (fn:Function)=>logins.push(fn);
  if(key==='onCustomEvent') return (name:string,fn:Function)=>custom.set(name,[...(custom.get(name)??[]),fn]);
  if(key==='emitCustomEvent') return (name:string,event:any)=>{emitted.push({name,event});for(const fn of custom.get(name)??[])fn(event);};
  if(typeof key==='string' && (/^on[A-Z]/.test(key)||['persistAttribute','registerArea','registerCommand','log'].includes(key))) return ()=>{};
  return typeof target[key]==='function'?target[key].bind(target):target[key];
 }});
 for(const[file]of cases) { loading=file; require(path.join(server,'plugins/quests/quests',file+'.Quest'))(api); }
 vm=createCacheVm(path.join(server,'caches',fs.readFileSync(path.join(server,'target.txt'),'utf8').trim())).vm;
});
function fixture(t:any,initial:Record<string,any>={}){
 const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const player=new Player(new PlayerSession(channel));
 player.setUsername('nativestatec');
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
test('native progress stays incomplete through both quests final return checkpoints',t=>{
 for(const[key,stage,value]of [['the_lost_tribe',11,10],['recruitment_drive',2,1],['recruitment_drive',3,1]]as const){
  const q=quest(key),f=fixture(t);q.setStage(f.player,stage);check(q,f,stage,value);
  assert.equal(q.isComplete(f.player),false);
 }
 const tribe=quest('the_lost_tribe'),floor=fixture(t),morph=C.getObject(6900);
 tribe.setStage(floor.player,11);
 assert.equal(morph.transforms[floor.sender.getVarbit(532)],6902,'native10 retains cellar rubble until the final treaty reward');
 tribe.setStage(floor.player,12);
 assert.equal(morph.transforms[floor.sender.getVarbit(532)],-1,'native11 removes the completed quest rubble');
 const q=quest('recruitment_drive'),f=fixture(t);
 f.sender.sendVarbit(658,12);q.setStage(f.player,3);
 assert.equal(f.sender.getVarbit(658),12,'native main phase must preserve statue-layout sibling');
});
function action(name:string,event:any){for(const fn of custom.get(name)??[])fn(event);}
test('generals actual message teaches emotes at saved8 without changing saved stage or stage callbacks',t=>{
 const q=quest('the_lost_tribe'),f=fixture(t);q.setStage(f.player,8);check(q,f,8,6);
 const transcript=JSON.parse(fs.readFileSync(path.join(server,'data/definitions/npc-dialogues.json'),'utf8'))['The Lost Tribe'].variants['investigation-the-goblin-generals'];
 const find=(node:any):any=>Array.isArray(node)?node.map(find).find(Boolean):node&&typeof node==='object'?(node.id==='msb9X3'?node:Object.values(node).map(find).find(Boolean)):undefined;
 const step=find(transcript);assert.equal(step.type,'message');assert.equal(step.text,'The goblins show you the Goblin Victory Salute and Goblin Bow.');
 const base={player:f.player,npcId:669,step,stepId:step.id,kind:'message'};
 for(const bad of [{...base,npcId:815},{...base,kind:'action'},{...base,stepId:'not-the-lesson'}])action('npc-dialogue:action',bad);
 assert.equal(f.player.getAttribute('lost-tribe:emotes-taught'),undefined);
 const events=emitted.filter(e=>e.name==='quest:stage-changed').length;
 require(path.join(server,'plugins/npcs/NpcDialogues.plugin')).startDialogue(api,{player:f.player,npcId:669,definition:PM.getCoreApi().NpcDefinition.forId(669)},[step]);
 assert.equal(f.player.getAttribute('lost-tribe:emotes-taught'),true);check(q,f,8,7);
 assert.equal(emitted.filter(e=>e.name==='quest:stage-changed').length,events);
 const locks=require(path.join(server,'plugins/interface/data/emotes.json')).locks;
 assert.equal(locks[22].varbit,'lost_tribe_quest');assert.equal(locks[23].varbit,'lost_tribe_quest');
 assert.ok(f.sender.getVarbit(532)>=locks[22].min,'native7 unlocks Goblin Bow');
 assert.ok(f.sender.getVarbit(532)>=locks[23].min,'native7 unlocks Goblin Salute');
 const restored=fixture(t,{'quest.the_lost_tribe.stage':8,'lost-tribe:emotes-taught':true});
 Q.sendQuestVarps({player:restored.player});check(q,restored,8,7);
 action('player:bootstrap-complete',{player:restored.player});check(q,restored,8,7);
 q.setStage(restored.player,7);restored.player.setAttribute('lost-tribe:emotes-taught',false);
 action('npc-dialogue:action',{...base,player:restored.player});
 assert.equal(restored.player.getAttribute('lost-tribe:emotes-taught'),false,'lesson cannot skip the book stage');
});
test('Lost Tribe side progress and direct side publication preserve native phases and sibling bits',t=>{
 const q=quest('the_lost_tribe');
 for(const attrs of [{'quest.the_lost_tribe.bits':2},{'quest.the_lost_tribe.contact':1}]){
  const f=fixture(t,attrs);q.setStage(f.player,8);check(q,f,8,7);
  action('player:bootstrap-complete',{player:f.player});check(q,f,8,7);
 }
 const f=fixture(t,{'quest.the_lost_tribe.contact':1});
 f.sender.sendConfig(465,1<<30);q.setStage(f.player,9);check(q,f,9,8);
 // The Duke's existing silverware line records contact2 and must immediately publish phase9.
 const source=fs.readFileSync(path.join(server,'plugins/quests/quests/LostTribe.Quest.js'),'utf8');
 const line=source.match(/const DUKE_SILVERWARE_LINE = ["']([^"']+)["']/);
 assert.ok(line,'existing authoritative contact cue');
 action('npc-dialogue:line',{player:f.player,npcId:815,text:line[1]});
 check(q,f,9,9);assert.equal(f.sender.getVarp(465)&(1<<30),1<<30);
 q.setStage(f.player,11);action('player:bootstrap-complete',{player:f.player});check(q,f,11,10);
});
test('Shield canonical header binding preserves Phoenix/Black Arm world progress through login/bootstrap',t=>{
 const q=quest('shield_of_arrav');assert.equal(q.varbitId,13716,'header must read the same selector as native4029');
 const login=logins.at(-1)!;assert.equal(login.name,'handleLogin');
 for(const[gang,stage,phoenix,blackarm]of [[1,4,9,0],[2,4,2,3],[1,7,10,0],[2,7,2,4]]){
  const f=fixture(t,{'shield-of-arrav.gang':gang});f.sender.sendVarbit(13715,9);
  q.setStage(f.player,stage);
  const expected=stage>=7?2:1;
  for(const replay of [()=>{},()=>login({player:f.player}),()=>Q.sendQuestVarps({player:f.player}),()=>action('player:bootstrap-complete',{player:f.player})]){
   replay();check(q,f,stage,expected);
   assert.equal(f.sender.getVarp(145),phoenix,'Phoenix world/morph state stays separate');
   assert.equal(f.sender.getVarp(146),blackarm,'Black Arm world/morph state stays separate');
   assert.equal(f.sender.getVarbit(13715),9,'Shield state preserves Creature sibling');
   const boundValue=q.varbitId===undefined?f.sender.getVarp(q.varpId):f.sender.getVarbit(q.varbitId);
   const headerComplete=boundValue>=Number(questMetadata(q,C).endstate[0]);
   assert.equal(headerComplete,stage>=7,'registration binding must agree with native4029');
   assert.equal(f.player.getAttribute('shield-of-arrav.gang'),gang);
   assert.equal(f.player.getAttribute('quest.points'),undefined,'state replay cannot grant rewards');
  }
 }
});
test('optional external evidence export contains only native state, no account data',()=>{
 if(process.env.NATIVE_STATE_CASES_OUT) fs.writeFileSync(process.env.NATIVE_STATE_CASES_OUT,JSON.stringify(exported,null,2));
});
