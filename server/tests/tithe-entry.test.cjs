// Registered Tithe seed-table and door entry regression; flagged actors, decoded actions, not a full login.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, Data, Tithe, door, table; const errors=[]; const originalError=console.error;
before(async()=>{
  console.error=(...args)=>{errors.push(args.map(String).join(' ')); originalError(...args);};
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  PM.getCoreApi().ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(1802,3502);
  Data=require('../plugins/skills/farming/Data.Farming'); Tithe=require('../plugins/skills/farming/Tithe.Farming'); PM.emitServerStartup({});
  assert.equal(core.WorldDefinition.isMembersWorld(),true);
  const found=[];
  for(let x=1799;x<=1808;x++) for(let y=3496;y<=3506;y++) {
    const object=core.MapObjects.get(core.ObjectIdentifiers.FARM_DOOR,new core.Location(x,y,0));
    if(object) found.push(object);
  }
  assert.equal(found.length,1,'one actual farm door in entry area'); door=found[0];
  table=core.MapObjects.get(core.ObjectIdentifiers.SEED_TABLE,new core.Location(1802,3503,0)); assert.ok(table,'actual seed table');
  const tableDef=core.ObjectDefinition.forId(table.getId()); assert.ok(tableDef); assert.ok(tableDef.getActions()?.includes('Search'));
  const def=core.ObjectDefinition.forId(door.getId()); assert.ok(def); assert.equal(def.getName().toLowerCase(),'farm door');
  assert.ok(def.getActions().some(a=>a&&/^(open|enter)$/i.test(a)));
});
after(()=>{try{PM.emitServerShutdown({}); assert.deepEqual(errors,[]);}finally{console.error=originalError;}});
function actor(t,index,base){
  const ch={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(ch)); p.setIndex(index); p.setUsername('tithe'+index); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  assert.notEqual(p.getLongUsername(),0n); p.setRegistered(true); p.setAttribute('bot-skip-persistence',true); p.setLocation(new core.Location(1802,3502,0)); p.needsPlacement=false;
  const skills=p.getSkillManager(); skills.setMaxLevels(core.Skill.FARMING,base,false).setExperience(core.Skill.FARMING,core.SkillManager.getExperienceForLevel(base)).setCurrentLevel(core.Skill.FARMING,34,false);
  assert.ok(p.getHitpoints()>0); assert.equal(p.busy(),false); assert.equal(p.getInventory().getValidItems().length,0);
  const c=new ClientConnection(ch); c.player=p;
  t.after(()=>{const area=p.getArea(); try { PM.emitPlayerDisconnect({player:p,username:p.getUsername()}); PM.emitPlayerLogout({player:p,username:p.getUsername()}); if(area instanceof core.PrivateArea){assert.equal(area.isDestroyed(),true); assert.equal(area.getPlayers().includes(p),false);} } finally {core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.getMovementQueue().reset(); p.setRegistered(false);} });
  return {p,c,skills};
}
function turn(f){
  f.p.resetUpdating(); core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;
  core.TaskManager.process(); f.c.processTurnPackets(); const q=f.p.getMovementQueue();
  q.beginCycle(); q.processEntityPursuit(); if(q.hasPendingWork()) q.process(); core.TaskManager.processWalkTo(f.p.getIndex());
}
async function input(f,packet,done){
  await f.c.dispatch([packet]);
  for(let i=0;i<30;i++){turn(f); if(done() && !f.p.getMovementQueue().hasPendingWork()) return;}
  assert.fail('action did not reach bounded settled state');
}
function menu(f,labels){
  const current=f.p.getDialogueManager().getCurrent(); assert.ok(current instanceof core.OptionDialogue);
  assert.equal(f.p.getPacketSender().getChatboxGroupId(),219); assert.deepEqual(current.getOptions(),labels); return current;
}
async function acquire(f){
  const td=core.ObjectDefinition.forPlayer(table.getId(),f.p); assert.ok(td.getActions()?.includes('Search'));
  await input(f,{type:'object_option',id:table.getId(),x:1802,y:3503,action:'Search'},()=>!!f.p.getDialogueManager().getCurrent());
  const first=menu(f,['Golovanova seeds (level 34)','Bologano seeds (level 54)','Logavano seeds (level 74)']);
  await input(f,{type:'dialogue_continue',widgetId:core.OptionDialogue.OPTIONS_WIDGET_ID,childIndex:1},()=>f.p.getDialogueManager().getCurrent()!==first);
  menu(f,['Take 100','Take 1000','Take 10000']);
  const id=Data.itemId('Golovanova seed'), def=core.ItemDefinition.forId(id); assert.match(def.getName(),/^Golovanova seed$/i); assert.equal(def.isNoted(),false);
  await input(f,{type:'dialogue_continue',widgetId:core.OptionDialogue.OPTIONS_WIDGET_ID,childIndex:1},()=>f.p.getInventory().getAmount(id)===100);
  assert.equal(f.p.getInventory().getAmount(id),100);
}
async function enter(f,t){
  const pos=door.getLocation(), def=core.ObjectDefinition.forPlayer(door.getId(),f.p);
  const action=def.getActions().find(a=>a&&/^(open|enter)$/i.test(a));
  const original=Tithe.titheObject, seen=[];
  t.mock.method(Tithe,'titheObject',event=>{const result=original(event); if(event.player===f.p && event.object?.getId()===door.getId() && event.object.getLocation().equals(pos)) seen.push({handled:event.handled,object:event.object}); return result;});
  await input(f,{type:'object_option',id:door.getId(),x:pos.getX(),y:pos.getY(),action},()=>seen.length===1);
  assert.equal(seen.length,1); assert.equal(seen[0].handled,true); assert.equal(seen[0].object.getId(),door.getId());
}
test('Tithe Farm entry requires unboosted Farming 34',async t=>{
  for(const [name,index,base,current,allowed] of [['base 34',1201,34,34,true],['boosted 33',1202,33,34,false],['decayed 33',1203,33,33,false]]) await t.test(name,async t=>{
    const f=actor(t,index,base); await acquire(f); f.skills.setCurrentLevel(core.Skill.FARMING,current,false);
    assert.equal(f.skills.getMaxLevel(core.Skill.FARMING),base); assert.equal(f.skills.getCurrentLevel(core.Skill.FARMING),current);
    assert.equal(f.skills.getExperience(core.Skill.FARMING),core.SkillManager.getExperienceForLevel(base));
    const area=f.p.getArea(); assert.ok(f.p.getLocation().getX()<=1805); await enter(f,t);
    assert.equal(f.p.getInventory().getAmount(Data.itemId('Golovanova seed')),100);
    if(allowed){assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],[1806,3501,0]); assert.ok(f.p.getArea() instanceof core.PrivateArea); assert.ok(f.p.getArea().getPlayers().includes(f.p));}
    else {assert.ok(f.p.getLocation().getX()<=1805); assert.equal(f.p.getArea(),area);}
  });
});
