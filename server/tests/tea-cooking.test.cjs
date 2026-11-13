const assert = require('node:assert/strict');
const path = require('node:path');
const {before, after, test} = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
const {GameObject} = require('../dist/game/entity/impl/object/GameObject');
const {ObjectDefinition} = require('../dist/game/definition/ObjectDefinition');
let core, House, Instance, portalId, seq = 0;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi(); core.RegionManager.init(); ObjectDefinition.init();
  const errors=[], warnings=[], oldError=console.error, oldWarn=console.warn;
  console.error=(...a)=>errors.push(a); console.warn=(...a)=>{if(String(a[0]).includes('[plugins]')) warnings.push(a); else oldWarn(...a);};
  try { PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); PM.emitServerStartup({}); } finally { console.error=oldError; console.warn=oldWarn; }
  assert.deepEqual(errors,[]);
  // Bots are disabled for this fixture; BountyHunter declares PlayerBots as a dependency.
  assert.deepEqual(warnings,[["[plugins] skipped BountyHunter: unresolved dependsOn [PlayerBots]"]]);
  House = require('../plugins/skills/construction/House.Construction');
  Instance = require('../plugins/skills/construction/Instance.Construction');
  portalId = require('../plugins/skills/construction/Estate.Construction').HOUSE_LOCATIONS.find(x => x.id === 6).portal;
});
after(() => PM.emitServerShutdown({}));
function actor(t, level) {
  const channel = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p = new Player(new PlayerSession(channel)), conn = new ClientConnection(channel); conn.player = p;
  const messages=[]; const send=p.sendMessage.bind(p); t.mock.method(p,'sendMessage',m=>{messages.push(m); return send(m);});
  let house; const errors=[], warnings=[], warn=console.warn.bind(console);
  t.mock.method(console,'error',(...args)=>errors.push(args));
  t.mock.method(console,'warn',(...args)=>{if(String(args[0]).includes('[plugins]')) warnings.push(args); else warn(...args);});
  t.after(()=>{
    const index=p.getIndex();
    try { if(house) core.TaskManager.cancelTasks(house); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(index); PM.emitPlayerLogout({player:p,username:p.getUsername()}); }
    finally { try { House.releaseHouse(p,true); } finally { core.World.getPlayers().remove(p); p.closeInterruptibleInterfaces(); } }
    if(house) { assert.equal(core.TaskManager.hasActiveTask(house),false); assert.equal(house.isDestroyed(),true); }
    assert.equal(core.TaskManager.hasActiveTask(p),false); assert.equal(core.TaskManager.hasActiveTask(index),false);
    assert.equal(House.houseFor(p),null); assert.equal(p.isRegistered(),false); assert.equal(Instance.PlayerHouseInstance.isAllocationLocation(p.getLocation()),false);
    assert.deepEqual(errors,[]); assert.deepEqual(warnings,[]);
  });
  p.setUsername(`teacase${++seq}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  const save = Instance.createDefaultHouseSave(); save.location = 6;
  save.rooms[1][4][6] = {roomKey:'KITCHEN',rotation:0,furniture:{STOVE:'FIREPIT_WITH_HOOK',SHELVES:'WOODEN_SHELVES_1',LARDER:'WOODEN_LARDER',SINK:'PUMP_AND_DRAIN'}};
  p.setAttribute('construction:house', save); assert.equal(core.World.getPlayers().add(p), true);
  for (const [skill, value] of [[core.Skill.CONSTRUCTION,99],[core.Skill.COOKING,level]]) {
    p.getSkillManager().setMaxLevels(skill,value,false).setExperiences(skill,core.SkillManager.getExperienceForLevel(value),false).setCurrentLevel(skill,value,false);
    assert.equal(p.getSkillManager().getMaxLevel(skill),value); assert.equal(p.getSkillManager().getCurrentLevel(skill),value);
  }
  assert.equal(core.WorldDefinition.isMembersWorld(),true);
  p.moveTo(new core.Location(2542,3096,0)); p.setNeedsPlacement(false);
  const portal = new GameObject(portalId,new core.Location(2542,3097,0),10,2,null);
  const definition = ObjectDefinition.forPlayer(portalId,p) ?? ObjectDefinition.forId(portalId);
  assert.equal(PM.emitObjectInteraction({player:p,object:portal,objectId:portalId,definition,clickType:2,location:{x:2542,y:3097,z:0},sourceLocation:{x:2542,y:3096,z:0},handled:false}),true);
  for (let tick=0;tick<3;tick++) core.TaskManager.process(); // Home: the house loads two ticks later
  house=House.houseFor(p); assert.ok(house instanceof Instance.PlayerHouseInstance); assert.equal(house.owner,p); assert.equal(p.getPrivateArea(),house);
  const room=house.save.rooms[1][4][6];
  function object(key) {
    const furniture=Object.values(room.furnitureByLocation).find(f=>f.hotspotKey===key); assert.ok(furniture,key);
    const obj=house.furnitureObjects.find(o=>{const a=o.getLocation();return house.getFurnitureAt({x:a.getX(),y:a.getY(),z:a.getZ()},o.getId(),o.getType())===furniture;});
    assert.ok(obj,key); return obj;
  }

  return {p,conn,house,object,messages};
}
function action(f,key,name) {
  const object=f.object(key), at=object.getLocation(), id=object.getId(); f.p.moveTo(new core.Location(at.getX()-1,at.getY(),at.getZ())); f.p.setNeedsPlacement(false);
  const definition=ObjectDefinition.forPlayer(id,f.p) ?? ObjectDefinition.forId(id), i=definition.getInteractions().findIndex(x=>x?.toLowerCase()===name.toLowerCase()); assert.notEqual(i,-1);
  assert.equal(PM.emitObjectInteraction({player:f.p,object,objectId:id,definition,clickType:i+1,location:{x:at.getX(),y:at.getY(),z:at.getZ()},sourceLocation:{x:at.getX()-1,y:at.getY(),z:at.getZ()},handled:false}),true);
}
async function search(f,key,choice) {
  action(f,key,'Search'); const pending=core.MultiChatboxPrompt.getPending(f.p); assert.ok(pending); assert.equal(f.p.getPacketSender().isChatboxInterface(219),true); assert.equal(f.p.getDialogueManager().isActive(),false); assert.match(pending.title,/select an option/i);
  const i=pending.options.findIndex(x=>x.toLowerCase()===choice.toLowerCase()); assert.notEqual(i,-1);
  await f.conn.dispatch([{type:'dialogue_continue',widgetId:core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,childIndex:i+1}]); f.conn.processTurnPackets();
}
function coherent(f,level) { const sm=f.p.getSkillManager(); assert.equal(sm.getCurrentLevel(core.Skill.COOKING),level); assert.equal(sm.getMaxLevel(core.Skill.COOKING),level); assert.equal(sm.getExperience(core.Skill.COOKING),core.SkillManager.getExperienceForLevel(level)); }
async function pair(f,a,b) {
  const inv=f.p.getInventory(), slot=inv.getSlotForItemId(a), target=inv.getSlotForItemId(b); assert.ok(slot>=0 && target>=0);
  await f.conn.dispatch([{type:'inventory_use_on',slot,itemId:a,target:{kind:'inventory',slot:target}}]); f.conn.processTurnPackets();
}
async function onObject(f,item,key,committed) {
  const obj=f.object(key), at=obj.getLocation(), slot=f.p.getInventory().getSlotForItemId(item); assert.ok(slot>=0);
  f.p.moveTo(new core.Location(at.getX()-1,at.getY(),at.getZ())); f.p.setNeedsPlacement(false);
  await f.conn.dispatch([{type:'inventory_use_on',slot,itemId:item,target:{kind:'loc',id:obj.getId(),x:at.getX(),y:at.getY()}}]); f.conn.processTurnPackets();
  assert.equal(core.TaskManager.hasActiveTask(f.p.getIndex()),true,'decoded object interaction queued');
  // Narrowed World/Player phases: task manager, movement, then walk-to reach check.
  for(let i=0;i<15 && !committed();i++){core.TaskManager.process(); const movement=f.p.getMovementQueue(); movement.beginCycle(); movement.processEntityPursuit(); if(movement.hasPendingWork()) movement.process(); core.TaskManager.processWalkTo(f.p.getIndex());}
  assert.equal(committed(),true,'object interaction committed within bounded phases');
}
async function supplies(f) {
  for(const [name,id] of [['poh_kettle_empty',7688],['poh_kettle_water',7690],['poh_kettle_boiled',7691],['poh_teapot_clay_empty',7702],['poh_teapot_clay_leaves',7700],['poh_teapot_clay_4',7692],['poh_tea_leaves',7738]]) { assert.equal(core.CacheDefinitions.getObjId(name),id); const def=core.ItemDefinition.forId(id); assert.ok(def); assert.equal(def.isNoted(),false); assert.ok(def.getName()); assert.equal(core.CacheDefinitions.getItem(id).isMembers,true); }
  await search(f,'LARDER','Tea'); await search(f,'SHELVES','Teapot'); await search(f,'SHELVES','Kettle');
  const inv=f.p.getInventory(); for(const id of [7738,7702,7688]) assert.equal(inv.getAmount(id),1);
  await onObject(f,7688,'SINK',()=>inv.getAmount(7690)===1); assert.equal(inv.getAmount(7688),0); assert.equal(inv.getAmount(7690),1);
  await onObject(f,7690,'STOVE',()=>inv.getAmount(7690)===0); assert.equal(inv.getAmount(7690),0); assert.equal(core.TaskManager.hasActiveTask(f.house),true); assert.ok(f.object('STOVE'));
  for(let i=0;i<10;i++) core.TaskManager.process(); action(f,'STOVE','Take-kettle'); assert.equal(inv.getAmount(7691),1);
}
test('leaves into empty pot: 20 succeeds before 19 refuses',async t=>{
  const good=actor(t,20); await supplies(good); const g=good.p.getInventory(); coherent(good,20); await pair(good,7738,7702); assert.equal(g.getAmount(7700),1);
  const low=actor(t,19); await supplies(low); const l=low.p.getInventory(); coherent(low,19); const before=l.getItems().map(i=>i && [i.getId(),i.getAmount()]); low.messages.length=0; await pair(low,7738,7702); assert.deepEqual(l.getItems().map(i=>i && [i.getId(),i.getAmount()]),before); assert.ok(!low.messages.includes('You add the leaves to the teapot.')); assert.deepEqual(low.messages,['You need a Cooking level of 20 to make tea.']); assert.equal(l.getAmount(7738),1); assert.equal(l.getAmount(7702),1); assert.equal(l.getAmount(7700),0);
});
test('hot kettle into leaf pot: 20 succeeds before 19 refuses',async t=>{
  const good=actor(t,20); await supplies(good); const g=good.p.getInventory(); coherent(good,20); await pair(good,7738,7702); assert.equal(g.getAmount(7700),1); coherent(good,20); await pair(good,7691,7700); assert.equal(g.getAmount(7692),1);
  const low=actor(t,20); await supplies(low); const l=low.p.getInventory(); await pair(low,7738,7702); assert.equal(l.getAmount(7700),1);
  const sm=low.p.getSkillManager(); sm.setMaxLevels(core.Skill.COOKING,19,false).setExperiences(core.Skill.COOKING,core.SkillManager.getExperienceForLevel(19),false).setCurrentLevel(core.Skill.COOKING,19,false);
  assert.equal(sm.getMaxLevel(core.Skill.COOKING),19); assert.equal(sm.getCurrentLevel(core.Skill.COOKING),19); assert.equal(sm.getExperience(core.Skill.COOKING),core.SkillManager.getExperienceForLevel(19));
  coherent(low,19); const before=l.getItems().map(i=>i && [i.getId(),i.getAmount()]); low.messages.length=0; await pair(low,7691,7700); assert.deepEqual(l.getItems().map(i=>i && [i.getId(),i.getAmount()]),before); assert.ok(!low.messages.includes('You pour the water into the teapot.')); assert.deepEqual(low.messages,['You need a Cooking level of 20 to make tea.']); assert.equal(l.getAmount(7691),1); assert.equal(l.getAmount(7700),1); assert.equal(l.getAmount(7692),0);
});
for (const level of [19,20]) test(`hot kettle on an empty pot preserves missing-leaves behavior at ${level}`,async t=>{
  const f=actor(t,level); await supplies(f); const inv=f.p.getInventory(); coherent(f,level); const before=inv.getItems().map(i=>i && [i.getId(),i.getAmount()]); f.messages.length=0; await pair(f,7691,7702); assert.deepEqual(inv.getItems().map(i=>i && [i.getId(),i.getAmount()]),before); assert.ok(f.messages.includes('You should add tea leaves to the teapot first.'));
  assert.equal(inv.getAmount(7691),1); assert.equal(inv.getAmount(7702),1); assert.equal(inv.getAmount(7692),0);
});
test('pouring the hot water onto the leaves gives 52 Cooking XP, and no other step gives any',async t=>{
  const {GameConstants}=require('../dist/game/GameConstants');
  const f=actor(t,20); await supplies(f); const sm=f.p.getSkillManager(), inv=f.p.getInventory(), start=sm.getExperience(core.Skill.COOKING);
  await pair(f,7738,7702); assert.equal(sm.getExperience(core.Skill.COOKING),start);
  await pair(f,7691,7700); assert.equal(inv.getAmount(7692),1);
  assert.equal(sm.getExperience(core.Skill.COOKING),start+52*GameConstants.EXPERIENCE_MULTIPLIER);
});
