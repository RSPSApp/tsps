const assert=require('node:assert/strict'),path=require('node:path');
const {before,after,test}=require('node:test');
process.env.DISABLE_PLAYER_BOTS='1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const {ClientConnection}=require('../dist/net/NetworkBuilder');
let core,index=4400;
before(async()=>{await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();PM.loadFromDirectory(path.resolve(__dirname,'../plugins'));core.RegionManager.init();core.RegionManager.loadMapFiles(3200,3200);core.RegionManager.loadMapFiles(2796,2798);PM.emitServerStartup({});});
after(()=>PM.emitServerShutdown({}));
function actor(t,{rescues=0,full=false,level=64,banana=true}={}) {
 const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername('apegate'+index);p.setRegistered(true);p.setLocation(new core.Location(3200,3200,0));p.needsPlacement=false;p.setAttribute('bot-skip-persistence',true);
 const conn=new ClientConnection(channel);conn.player=p;
 t.after(()=>{const fishier=require('../plugins/skills/sailing/charting/FishierStout.Charting'),area=fishier.scenes.get(p)?.area;PM.emitPlayerLogout({player:p,username:p.getUsername()});p.closeInterruptibleInterfaces();p.setRegistered(false);core.TaskManager.cancelTasks(p);core.TaskManager.cancelTasks(p.getIndex());for(const npc of [...core.World.getNpcs()])if(npc?.getOwner?.()===p)PM.removeNpc(npc);assert.equal([...core.World.getNpcs()].some(npc=>npc?.getOwner?.()===p),false);assert.equal(fishier.scenes.has(p),false);if(area)assert.equal(area.isDestroyed(),true);});
 p.setSpellbook(core.MagicSpellbook.NORMAL);p.getSkillManager().setMaxLevels(core.Skill.MAGIC,level,false);p.getSkillManager().setExperience(core.Skill.MAGIC,core.SkillManager.getExperienceForLevel(level));p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,level,false);
 p.setAttribute('recipe-for-disaster:rescues',rescues);
 const q=require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(x=>x.key==='recipe_for_disaster');assert.ok(q);q.setStage(p,full?q.completionValue:4);
 for(const [id,n] of [[563,2],[555,2],[554,2],...(banana?[[1963,1]]:[])])p.getInventory().add(new core.Item(id,n),false);
 assert.equal(core.WorldDefinition.isMembersWorld(),true);assert.equal(p.getSpellbook(),core.MagicSpellbook.NORMAL);assert.equal(p.getSkillManager().getMaxLevel(core.Skill.MAGIC),level);assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.MAGIC),level);assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC),core.SkillManager.getExperienceForLevel(level));assert.equal(p.busy(),false);assert.equal(p.getMovementQueue().isMovementBlocked(),false);assert.equal(p.isTeleporting,false);assert.deepEqual([563,555,554,1963].map(id=>p.getInventory().getAmount(id)),[2,2,2,banana?1:0]);assert.equal(q.isComplete(p),full);
 return {p,conn,q};
}
function rescue(f,expected) {const query={player:f.p,rescue:'king-awowogei',complete:false};PM.emitCustomEvent('recipe-for-disaster:rescue-status',query);assert.equal(query.complete,expected);}
function inventory(f){return [563,555,554,1963].map(id=>f.p.getInventory().getAmount(id));}
async function cast(f,name='Ape Atoll Teleport'){
 const spell=core.CacheDefinitions.getSpellByName(name);assert.ok(spell,`cache spell ${name}`);assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId,-1).toLowerCase(),name.toLowerCase());
 if(name==='Ape Atoll Teleport') {assert.equal(spell.itemId,7619);assert.equal(spell.widgetId,(218<<16)|60);assert.equal(core.CacheDefinitions.getSpellName((218<<16)|170,20427),'Ape Atoll Teleport');assert.equal(core.CacheDefinitions.getSpellRequirements(name).level,64);}
 const widgetId=spell.widgetId;await f.conn.dispatch([{type:'widget_action',widgetId,groupId:widgetId>>>16,childId:widgetId&65535,slot:-1,buttonNum:1}]);f.conn.processTurnPackets();
}
function tick(){core.TaskManager.process();}
function arrive(f){for(let i=0;i<8;i++)tick();const at=f.p.getLocation();assert.ok(Math.abs(at.getX()-2796)<=2 && Math.abs(at.getY()-2798)<=2 && at.getZ()===0,'actual normal teleport arrival');assert.equal(f.p.isTeleporting,false);}
test('incomplete Awowogei cannot cast despite seeded client varbit, without spending resources',async t=>{
 const f=actor(t);rescue(f,false);f.p.getPacketSender().sendVarbit(1914,50);assert.equal(f.p.getPacketSender().getVarbit(1914),50);const messages=[],send=f.p.sendMessage.bind(f.p);t.mock.method(f.p,'sendMessage',(...args)=>{messages.push(args[0]);return send(...args);});const before=inventory(f);await cast(f);assert.equal(messages.filter(text=>text==='You must free King Awowogei before casting this spell.').length,1,'the server sends its fallback refusal');for(let i=0;i<8;i++)tick();assert.deepEqual(inventory(f),before);assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200]);assert.equal(f.p.isTeleporting,false);
});
test('saved Awowogei rescue unlocks the normal spell without completing full RFD',async t=>{
 const f=actor(t,{rescues:128});rescue(f,true);assert.equal(f.q.isComplete(f.p),false);const messages=[],send=f.p.sendMessage.bind(f.p);t.mock.method(f.p,'sendMessage',(...args)=>{messages.push(args[0]);return send(...args);});await cast(f);assert.equal(messages.includes('You must free King Awowogei before casting this spell.'),false,'the completed rescue does not receive the refusal');assert.deepEqual(inventory(f),[0,0,0,0]);arrive(f);
});
test('full RFD completion remains eligible on a legacy save without rescue bits',async t=>{
 const f=actor(t,{full:true});rescue(f,false);await cast(f);assert.deepEqual(inventory(f),[0,0,0,0]);arrive(f);
});
test('completed rescue still requires Magic level 64',async t=>{
 const f=actor(t,{rescues:128,level:63});rescue(f,true);const before=inventory(f);await cast(f);for(let i=0;i<8;i++)tick();assert.deepEqual(inventory(f),before);assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200]);
});
test('completed rescue still requires the banana',async t=>{
 const f=actor(t,{rescues:128,banana:false});rescue(f,true);const before=inventory(f);await cast(f);for(let i=0;i<8;i++)tick();assert.deepEqual(inventory(f),before);assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200]);
});

test('legacy registered interface path also refuses the incomplete rescue',t=>{
 const f=actor(t);rescue(f,false);const before=inventory(f),spell=core.CacheDefinitions.getSpellByName('Ape Atoll Teleport');assert.ok(spell);
 const event={player:f.p,buttonId:spell.widgetId,groupId:spell.widgetId>>>16,childId:spell.widgetId&65535,action:1,itemId:-1,handled:false};
 assert.equal(PM.emitInterfaceActionClick(event),true);for(let i=0;i<8;i++)tick();assert.deepEqual(inventory(f),before);assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200]);
});
test('a real area that allows teleport cannot bypass the unfinished rescue gate',async t=>{
 const f=actor(t),fishier=require('../plugins/skills/sailing/charting/FishierStout.Charting');rescue(f,false);fishier.start(f.p);
 for(let i=0;i<12;i++){tick();if(f.p.getArea() && !f.p.getMovementQueue().isMovementBlocked())break;}
 const area=f.p.getArea();assert.ok(area,'the real Fishier Stout arena is active');f.p.setNeedsPlacement(false);assert.equal(f.p.needsPlacement,false,'complete the native fixture placement phase');assert.equal(PM.callArea(area,'canTeleport',f.p,20,new core.Location(2796,2798)),true);assert.equal(f.p.getMovementQueue().isMovementBlocked(),false);assert.equal(f.p.busy(),false);
 const at=f.p.getLocation().clone(),before=inventory(f);await cast(f);for(let i=0;i<8;i++)tick();assert.deepEqual(inventory(f),before);assert.equal(f.p.isTeleporting,false);assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[at.getX(),at.getY()]);
});

test('completed rescue does not bypass ordinary movement restriction',async t=>{
 const f=actor(t,{rescues:128});rescue(f,true);f.p.getMovementQueue().setBlockMovement(true);assert.equal(f.p.getMovementQueue().isMovementBlocked(),true);const before=inventory(f);await cast(f);for(let i=0;i<8;i++)tick();assert.deepEqual(inventory(f),before);assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200]);
});
test('an unrelated standard teleport remains available without the rescue',async t=>{
 const f=actor(t);rescue(f,false);f.p.getInventory().add(new core.Item(556,3),false);await cast(f,'Varrock Teleport');for(let i=0;i<8;i++)tick();const at=f.p.getLocation();assert.ok(Math.abs(at.getX()-3213)<=2 && Math.abs(at.getY()-3424)<=2);assert.deepEqual(inventory(f),[1,2,1,1]);
});

test('the registered Awowogei rescue producer sets the completion used by the spell',async t=>{
 const f=actor(t),skills=f.p.getSkillManager();rescue(f,false);
 for(const [skill,level] of [[core.Skill.COOKING,99],[core.Skill.AGILITY,99]]) {skills.setMaxLevels(skill,level,false);skills.setExperience(skill,core.SkillManager.getExperienceForLevel(level));skills.setCurrentLevel(skill,level,false);}
 const monkey=require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q=>q.key==='monkey_madness_i');assert.ok(monkey);monkey.setStage(f.p,monkey.completionValue);
 f.p.getInventory().add(new core.Item(core.ItemIdentifiers.MSPEAK_AMULET),false);f.p.getInventory().add(new core.Item(core.ItemIdentifiers.STUFFED_SNAKE),false);
 const slot=f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.STUFFED_SNAKE);const item=f.p.getInventory().get(slot);assert.ok(item);const target=PM.spawnNpc({id:core.NpcIdentifiers.AWOWOGEI,x:3201,y:3200,z:0,owner:f.p,ownerOnly:true},'ApeGateTest');assert.ok(target);assert.equal(core.World.getNpcs().get(target.getIndex()),target);
 const event={player:f.p,target,definition:target.getCurrentDefinition(f.p),npcId:target.getContentId(f.p),targetIndex:target.getIndex(),interfaceId:149<<16,item,itemId:item.getId(),slot,handled:false};assert.equal(PM.emitItemOnNpc(event),true);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.STUFFED_SNAKE),0);rescue(f,true);assert.equal(f.q.isComplete(f.p),false);f.p.closeInterruptibleInterfaces();assert.equal(skills.getCurrentLevel(core.Skill.MAGIC),64);assert.equal(f.p.busy(),false);await cast(f);assert.deepEqual(inventory(f),[0,0,0,0]);arrive(f);
});

test('completed rescue still requires the law runes',async t=>{
 const f=actor(t,{rescues:128});rescue(f,true);f.p.getInventory().deleteNumber(563,2);assert.equal(f.p.getInventory().getAmount(563),0);const before=inventory(f);await cast(f);for(let i=0;i<8;i++)tick();assert.deepEqual(inventory(f),before);assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY()],[3200,3200]);
});
