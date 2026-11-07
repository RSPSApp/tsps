// Decoded initial ingress with seeded direct prerequisites, 107 QP, stage and sketch.
// This abstract checkpoint is not a transitive quest/skill history or natural sketch journey.
process.env.DISABLE_PLAYER_BOTS='1';
const assert=require('node:assert/strict'),path=require('node:path');const {before,after,test}=require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline'),{PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player'),{PlayerSession}=require('../dist/net/PlayerSession'),{ClientConnection}=require('../dist/net/NetworkBuilder');
const {MAIN_PROFILE}=require('../dist/game/entity/impl/player/persistence/PlayerProfile');
let core,quest,anvil;const errors=[],oldError=console.error,oldWarn=console.warn;
before(async()=>{
 console.error=(...a)=>{errors.push(a.map(String).join(' '));oldError(...a);};console.warn=(...a)=>{if(String(a[0]).includes('hook threw'))errors.push(a.map(String).join(' '));oldWarn(...a);};
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();core.ObjectDefinition.init();PM.loadFromDirectory(path.resolve(__dirname,'../plugins'));core.RegionManager.init();core.RegionManager.loadMapFiles(3187,3425);core.RegionManager.loadMapFiles(3205,3205);PM.emitServerStartup({});
 quest=require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q=>q.key==='legends_quest');assert.ok(quest);assert.equal(core.WorldDefinition.isMembersWorld(),true);
 const specials=['chasm_anvil','ds2_ac_forge_anvil'].map(name=>core.CacheDefinitions.getLocId(name));assert.ok(specials.every(Number.isInteger));assert.equal(new Set(specials).size,2);for(const id of specials){const def=core.ObjectDefinition.forId(id);assert.ok(def);assert.equal(def.getName(),'Anvil');}console.log('SPECIAL_ANVIL_IDS '+JSON.stringify(specials));
 const found=[];for(let x=3180;x<=3200;x++)for(let y=3410;y<=3435;y++)for(const o of core.MapObjects.getObjectsAt(new core.Location(x,y,0),null)){const d=core.ObjectDefinition.forId(o.getId());if(d?.getName()==='Anvil')found.push(o);}
 assert.ok(found.length,'cache/map ordinary anvil');anvil=found[0];console.log('ANVIL '+JSON.stringify({id:anvil.getId(),x:anvil.getLocation().getX(),y:anvil.getLocation().getY()}));
});
after(()=>{try{PM.emitServerShutdown({});assert.deepEqual(errors,[]);}finally{console.error=oldError;console.warn=oldWarn;}});
function actor(t,index,loc,bar=core.ItemIdentifiers.GOLD_BAR){
 const ch={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const p=new Player(new PlayerSession(ch)),c=new ClientConnection(ch);c.player=p;p.getSession().setPlayer(p);p.getSession().setTurnPacketProcessor(()=>c.processTurnPackets());
 p.setUsername('bowl'+index);p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));assert.notEqual(p.getLongUsername(),0n);p.setAttribute('bot-skip-persistence',true);assert.equal(core.World.getPlayers().add(p),true);const originalIndex=p.getIndex();
 t.after(()=>{try{PM.emitPlayerDisconnect({player:p,username:p.getUsername()});}finally{try{PM.emitPlayerLogout({player:p,username:p.getUsername()});}finally{try{p.closeInterruptibleInterfaces();}finally{p.getMovementQueue().reset();p.getMovementQueue().walkToReset();core.TaskManager.cancelTasks(p);core.TaskManager.cancelTasks(originalIndex);core.World.getPlayers().remove(p);}}}assert.equal(p.isRegistered(),false);assert.equal(p.getMovementQueue().hasPendingWork(),false);assert.equal(core.TaskManager.hasActiveTask(p),false);assert.equal(core.TaskManager.hasActiveTask(originalIndex),false);});
 p.moveTo(loc);p.setNeedsPlacement(false);assert.ok(p.getHitpoints()>0);assert.equal(p.busy(),false);assert.equal(p.getProfile(),MAIN_PROFILE);assert.equal(p.getPrivateArea(),null);
 const league={player:p,league:Symbol('unanswered')};PM.emitCustomEvent('league:profile',league);assert.equal(league.league,null);
 const skills=p.getSkillManager();for(const [skill,level] of [[core.Skill.AGILITY,50],[core.Skill.CRAFTING,50],[core.Skill.HERBLORE,45],[core.Skill.MAGIC,56],[core.Skill.MINING,52],[core.Skill.PRAYER,42],[core.Skill.SMITHING,50],[core.Skill.STRENGTH,50],[core.Skill.THIEVING,50],[core.Skill.WOODCUTTING,50]]){skills.setMaxLevels(skill,level,false).setExperiences(skill,core.SkillManager.getExperienceForLevel(level),false).setCurrentLevel(skill,level,false);assert.equal(skills.getMaxLevel(skill),level);assert.equal(skills.getCurrentLevel(skill),level);assert.equal(skills.getExperience(skill),core.SkillManager.getExperienceForLevel(level));}
 for(const key of ['family_crest','heroes_quest','shilo_village','underground_pass','waterfall_quest']){const q=require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q=>q.key===key);assert.ok(q,key);q.setStage(p,q.completionValue);assert.equal(q.isComplete(p),true,key);}p.setAttribute('quest.points',107);assert.equal(p.getAttribute('quest.points'),107);quest.setStage(p,8);assert.equal(quest.getStage(p),8);
 const inv=p.getInventory(),I=core.ItemIdentifiers;for(const [id,n] of [[I.SKETCH,1],[I.HAMMER,1],[bar,2]]){const def=core.ItemDefinition.forId(id);assert.ok(def.getName());assert.equal(def.isNoted(),false);inv.add(new core.Item(id,n),false);assert.equal(inv.getAmount(id),n);}assert.equal(inv.getAmount(I.GOLD_BOWL),0);
 return {p,c,inv,I};
}
function observe(t,f,arrayName,handlerName,match,plugin='Quests',profile='Quests/LegendsQuest'){
 const list=PM[arrayName].filter(h=>h.pluginName===plugin&&h.profileName===profile&&h.handlerName===handlerName);assert.equal(list.length,1);const hook=list[0],original=hook.handler,seen=[];
 t.mock.method(hook,'handler',function(event){const before=event.handled,result=original.call(this,event);if(event.player===f.p&&match(event))seen.push({before,after:event.handled});return result;});return seen;
}
function turn(f){f.p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;core.TaskManager.process();f.c.processTurnPackets();const q=f.p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(f.p.getIndex());}
async function send(f,packet,done){await f.c.dispatch([packet]);for(let i=0;i<40;i++){turn(f);if(done()&&!f.p.getMovementQueue().hasPendingWork())return;}assert.fail('decoded action did not settle');}
function anvilPacket(f,id){const pos=anvil.getLocation();const visible=core.ObjectDefinition.forPlayer(anvil.getId(),f.p);assert.ok(visible);assert.equal(visible.getName(),'Anvil');assert.ok(core.MapObjects.getPrivateArea(f.p,anvil.getId(),pos));return {type:'inventory_use_on',slot:f.inv.getSlotForItemId(id),itemId:id,target:{kind:'loc',id:anvil.getId(),x:pos.getX(),y:pos.getY()}};}
function remoteClear(f){const bounds={minX:3200,maxX:3215,minY:3200,maxY:3215,z:0};for(let x=bounds.minX;x<=bounds.maxX;x++)for(let y=bounds.minY;y<=bounds.maxY;y++)for(const o of core.MapObjects.getObjectsAt(new core.Location(x,y,0),null)){const d=core.ObjectDefinition.forPlayer(o.getId(),f.p);assert.ok(d,`unresolved object ${o.getId()}`);assert.ok(!/anvil/i.test(d.getName()));}assert.equal(core.MapObjects.ownerObjectsInScene(f.p,bounds.minX,bounds.minY,16).length,0);const pos=f.p.getLocation();assert.ok(pos.getX()>=bounds.minX&&pos.getX()<=bounds.maxX&&pos.getY()>=bounds.minY&&pos.getY()<=bounds.maxY);assert.equal(pos.getZ(),bounds.z);assert.equal(f.p.getPrivateArea(),null);console.log('REMOTE_BOUNDS '+JSON.stringify({bounds,actor:[pos.getX(),pos.getY(),pos.getZ()]}));}
test('ordinary bar reaches an actual anvil dispatcher',async t=>{
 const a=anvil.getLocation(),f=actor(t,1401,new core.Location(a.getX()-1,a.getY(),0),core.ItemIdentifiers.BRONZE_BAR);const seen=observe(t,f,'itemOnObjectHooks','useItemOnObject',e=>e.itemId===f.I.BRONZE_BAR&&e.objectId===anvil.getId(),'Smithing','Smithing');await send(f,anvilPacket(f,f.I.BRONZE_BAR),()=>seen.length>0);assert.equal(seen.length,1);assert.equal(seen[0].before,false);assert.equal(seen[0].after,true);assert.equal(f.p.getInterfaceId(),core.CacheDefinitions.getInterfaceId('smithing'));console.log('ANVIL_FINAL_POS '+JSON.stringify([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()]));
});
test('gold bar on an anvil reaches the Legends attempt',async t=>{
 const a=anvil.getLocation(),f=actor(t,1402,new core.Location(a.getX()-1,a.getY(),0));const seen=observe(t,f,'itemOnObjectHooks','handleItemOnObject',e=>e.itemId===f.I.GOLD_BAR&&e.objectId===anvil.getId());await send(f,anvilPacket(f,f.I.GOLD_BAR),()=>seen.length>0);assert.equal(seen.length,1);assert.equal(seen[0].before,false,'no earlier handler suppresses quest');assert.equal(seen[0].after,true,'quest recognizes actual anvil attempt');
 // Existing deterministic TSPS outcome only; retail failure probability is not asserted.
 assert.equal(f.inv.getAmount(f.I.GOLD_BOWL),1);assert.equal(f.inv.getAmount(f.I.GOLD_BAR),0);assert.equal(f.inv.getAmount(f.I.SKETCH),1);assert.equal(f.inv.getAmount(f.I.HAMMER),1);assert.equal(quest.getStage(f.p),8);
});
test('sketch on gold away from anvils does not forge',async t=>{
 const f=actor(t,1403,new core.Location(3205,3205,0));remoteClear(f);const seen=observe(t,f,'itemOnItemHooks','handleItemOnItem',e=>[e.usedItemId,e.usedWithItemId].includes(f.I.SKETCH)&&[e.usedItemId,e.usedWithItemId].includes(f.I.GOLD_BAR));const slot=f.inv.getSlotForItemId(f.I.SKETCH),target=f.inv.getSlotForItemId(f.I.GOLD_BAR);await send(f,{type:'inventory_use_on',slot,itemId:f.I.SKETCH,target:{kind:'inventory',slot:target,itemId:f.I.GOLD_BAR}},()=>seen.length>0);console.log('REMOTE_PAIR_OBSERVATION '+JSON.stringify({seen,bowl:f.inv.getAmount(f.I.GOLD_BOWL),bars:f.inv.getAmount(f.I.GOLD_BAR)}));assert.equal(seen[0].before,false);assert.equal(f.inv.getAmount(f.I.GOLD_BOWL),0);assert.equal(f.inv.getAmount(f.I.GOLD_BAR),2);
});

// Canonical admission controls: seeded stage 8, no inference about retail failure probability.
test('anvil attempt preserves items when a prerequisite is missing',async t=>{
 for(const [name,index] of [['sketch',1411],['smithing',1412],['hammer',1413],['bars',1414]]) await t.test(name,async t=>{
  const a=anvil.getLocation(),f=actor(t,index,new core.Location(a.getX()-1,a.getY(),0));
  if(name==='sketch') f.inv.deleteNumber(f.I.SKETCH,1);
  if(name==='smithing') f.p.getSkillManager().setCurrentLevel(core.Skill.SMITHING,49,false);
  if(name==='hammer') f.inv.deleteNumber(f.I.HAMMER,1);
  if(name==='bars') f.inv.deleteNumber(f.I.GOLD_BAR,1);
  const before=[f.inv.getAmount(f.I.SKETCH),f.inv.getAmount(f.I.HAMMER),f.inv.getAmount(f.I.GOLD_BAR),f.inv.getAmount(f.I.GOLD_BOWL)],xp=f.p.getSkillManager().getExperience(core.Skill.SMITHING);
  const seen=observe(t,f,'itemOnObjectHooks','handleItemOnObject',e=>e.itemId===f.I.GOLD_BAR&&e.objectId===anvil.getId());
  await send(f,anvilPacket(f,f.I.GOLD_BAR),()=>seen.length>0);
  assert.equal(seen.length,1);assert.equal(seen[0].before,false);assert.equal(seen[0].after,true);
  assert.deepEqual([f.inv.getAmount(f.I.SKETCH),f.inv.getAmount(f.I.HAMMER),f.inv.getAmount(f.I.GOLD_BAR),f.inv.getAmount(f.I.GOLD_BOWL)],before);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.SMITHING),xp);assert.equal(quest.getStage(f.p),8);
 });
});
test('boosted Smithing level reaches the canonical attempt',async t=>{
 const a=anvil.getLocation(),f=actor(t,1415,new core.Location(a.getX()-1,a.getY(),0)),skills=f.p.getSkillManager();
 skills.setMaxLevels(core.Skill.SMITHING,50,false).setExperiences(core.Skill.SMITHING,core.SkillManager.getExperienceForLevel(50),false).setCurrentLevel(core.Skill.SMITHING,51,false);
 assert.equal(skills.getMaxLevel(core.Skill.SMITHING),50);assert.equal(skills.getCurrentLevel(core.Skill.SMITHING),51);assert.equal(skills.getExperience(core.Skill.SMITHING),core.SkillManager.getExperienceForLevel(50));
 const seen=observe(t,f,'itemOnObjectHooks','handleItemOnObject',e=>e.itemId===f.I.GOLD_BAR&&e.objectId===anvil.getId());await send(f,anvilPacket(f,f.I.GOLD_BAR),()=>seen.length>0);assert.equal(seen.length,1);assert.equal(seen[0].before,false);assert.equal(seen[0].after,true);assert.equal(f.inv.getAmount(f.I.GOLD_BOWL),1);assert.equal(f.inv.getAmount(f.I.GOLD_BAR),0);assert.equal(f.inv.getAmount(f.I.SKETCH),1);assert.equal(f.inv.getAmount(f.I.HAMMER),1);assert.equal(quest.getStage(f.p),8);
});

test("Doric's restricted anvil still denies an unfinished player",async t=>{
 // Test-owned Doric loc exercises the real access hook; no natural hut or travel claim.
 const id=core.CacheDefinitions.getLocId('dorics_anvil');assert.equal(id,2031,'Doric access hook identity');const f=actor(t,1416,new core.Location(3222,3218,0));
 const doric=require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q=>q.key==='dorics_quest');assert.ok(doric);doric.setStage(f.p,0);assert.equal(doric.isComplete(f.p),false);
 const definition=core.ObjectDefinition.forPlayer(id,f.p);assert.equal(definition.getName(),'Anvil');const {object:station,loc:a}=ownedStation(t,f,id);
 const seen=observe(t,f,'itemOnObjectHooks','handleItemOnObject',e=>e.itemId===f.I.GOLD_BAR&&e.objectId===station.getId());
 const access=[],emit=PM.emitCustomEvent.bind(PM);t.mock.method(PM,'emitCustomEvent',(name,event)=>{const result=emit(name,event);if(name==='smithing:anvil-access'&&event.player===f.p&&event.object?.getId()===station.getId())access.push({denied:event.denied});return result;});
 const before=[f.inv.getAmount(f.I.SKETCH),f.inv.getAmount(f.I.HAMMER),f.inv.getAmount(f.I.GOLD_BAR),f.inv.getAmount(f.I.GOLD_BOWL)],xp=f.p.getSkillManager().getExperience(core.Skill.SMITHING),slot=f.inv.getSlotForItemId(f.I.GOLD_BAR);
 await send(f,{type:'inventory_use_on',slot,itemId:f.I.GOLD_BAR,target:{kind:'loc',id:station.getId(),x:a.getX(),y:a.getY()}},()=>seen.length>0);
 assert.equal(seen.length,1);assert.equal(seen[0].before,false);assert.equal(seen[0].after,true);assert.deepEqual(access,[{denied:true}]);assert.deepEqual([f.inv.getAmount(f.I.SKETCH),f.inv.getAmount(f.I.HAMMER),f.inv.getAmount(f.I.GOLD_BAR),f.inv.getAmount(f.I.GOLD_BOWL)],before);assert.equal(f.p.getSkillManager().getExperience(core.Skill.SMITHING),xp);assert.equal(quest.getStage(f.p),8);
});

function ownedStation(t,f,id){
  // Choose an unoccupied bounded tile; registration must not replace shared or removed records.
  let loc;for(let x=3223;x<=3227&&!loc;x++)for(let y=3216;y<=3220&&!loc;y++){const candidate=new core.Location(x,y,0);if(core.MapObjects.getObjectsAt(candidate,null).length===0&&core.ObjectManager.objectsAt(candidate).length===0&&!core.World.getRemovedObjects().some(o=>o.getLocation().equals(candidate)&&o.getType()===10))loc=candidate;}
  assert.ok(loc,'clear owned placement tile');const baseBefore=[...core.MapObjects.getObjectsAt(loc,null)],runtimeBefore=[...core.ObjectManager.objectsAt(loc)],removedBefore=core.World.getRemovedObjects().filter(o=>o.getLocation().equals(loc)&&o.getType()===10);
  const object=new core.GameObject(id,loc,10,0,null).setOwner(f.p);assert.equal(object.getOwner(),f.p);let registrationAttempted=false;
  t.after(()=>{try{if(registrationAttempted)core.ObjectManager.deregister(object,true);}finally{assert.equal(core.ObjectManager.objectsAt(loc).includes(object),false);assert.equal(core.World.getObjects().includes(object),false);assert.equal(core.MapObjects.ownerObjectsInScene(f.p,loc.getX(),loc.getY(),1).includes(object),false);assert.deepEqual([...core.MapObjects.getObjectsAt(loc,null)],baseBefore);assert.deepEqual([...core.ObjectManager.objectsAt(loc)],runtimeBefore);assert.deepEqual(core.World.getRemovedObjects().filter(o=>o.getLocation().equals(loc)&&o.getType()===10),removedBefore);}});
  registrationAttempted=true;core.ObjectManager.register(object,true);assert.equal(core.MapObjects.getPrivateArea(f.p,id,loc),object);
  return {object,loc};
}
// Owned registered placements exercise real map resolution, not natural station location or access.
test('special-purpose anvils do not claim a gold bowl attempt',async t=>{
 for(const [name,index] of [['chasm_anvil',1421],['ds2_ac_forge_anvil',1422]]) await t.test(name,async t=>{
  const id=core.CacheDefinitions.getLocId(name);assert.ok(Number.isInteger(id));const f=actor(t,index,new core.Location(3222,3218,0));
  const def=core.ObjectDefinition.forPlayer(id,f.p);assert.ok(def);assert.equal(def.getName(),'Anvil');assert.equal(def.id,id);
  const {object,loc}=ownedStation(t,f,id);
  const before=[f.inv.getAmount(f.I.SKETCH),f.inv.getAmount(f.I.HAMMER),f.inv.getAmount(f.I.GOLD_BAR),f.inv.getAmount(f.I.GOLD_BOWL)],xp=f.p.getSkillManager().getExperience(core.Skill.SMITHING);
  const seen=observe(t,f,'itemOnObjectHooks','handleItemOnObject',e=>e.itemId===f.I.GOLD_BAR&&e.objectId===id),slot=f.inv.getSlotForItemId(f.I.GOLD_BAR);
  await send(f,{type:'inventory_use_on',slot,itemId:f.I.GOLD_BAR,target:{kind:'loc',id,x:loc.getX(),y:loc.getY()}},()=>seen.length>0);
  assert.equal(seen.length,1);assert.equal(seen[0].before,false);assert.equal(seen[0].after,false,'quest leaves specialist station unclaimed');
  assert.deepEqual([f.inv.getAmount(f.I.SKETCH),f.inv.getAmount(f.I.HAMMER),f.inv.getAmount(f.I.GOLD_BAR),f.inv.getAmount(f.I.GOLD_BOWL)],before);assert.equal(f.p.getSkillManager().getExperience(core.Skill.SMITHING),xp);assert.equal(quest.getStage(f.p),8);
 });
});
