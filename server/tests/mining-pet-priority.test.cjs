const assert = require('node:assert/strict'), path = require('node:path');
const {before, after, test} = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
let core, PlayerSave, next = 1250;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname,'..')); PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi(); ({PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave')); core.RegionManager.init(); core.RegionManager.loadMapFiles(3222,3218); core.RegionManager.loadMapFiles(2611,3295); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
const item = name => core.CacheDefinitions.getObjId(name);
const npcId = name => core.CacheDefinitions.getNpcId(name);
function actor(t) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('golempriority'+next); p.setRegistered(true); p.setLocation(new core.Location(3222,3218,0)); p.needsPlacement=false;
  const c=new ClientConnection(channel); c.player=p;
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());for(const n of [...core.World.getNpcs()])if(n?.getOwner?.()===p)core.World.getNpcs().remove(n);});
  return {p,c};
}
async function drain(f) { for(let i=0;i<10;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();} }
async function send(f, packet) {await f.c.dispatch([packet]);f.c.processTurnPackets();await drain(f);}
async function drop(f,id) {f.p.getPacketSender().sendInterfaceRemoval();await send(f,{type:'inventory_action',slot:f.p.getInventory().getSlotForItemId(id),itemId:id,widgetId:149<<16,option:'Drop',optionIndex:5});return f.p.getAttribute('pets:current');}
async function action(f,n,name) {
  f.p.getPacketSender().sendInterfaceRemoval(); n.setLocation(new core.Location(f.p.getLocation().getX()+1,f.p.getLocation().getY(),0));
  const actions=n.getDefinition().getActions(), index=actions.findIndex(a=>a===name);
  assert.ok(index>=0, 'the active cache definition must expose '+name);
  await send(f,{type:'npc_option',index:n.getIndex(),clickType:index+1});
}
async function summon(f,name='skillpetmining') {const id=item(name);f.p.getInventory().add(new core.Item(id),true);const n=await drop(f,id);assert.ok(n?.isRegistered());return n;}



test('native last-slot priority gives pet before resource when another follower is active',async t=>{
 const f=actor(t),golem=item('skillpetmining');f.p.getInventory().add(new core.Item(core.ItemIdentifiers.OLMLET),true);const other=await drop(f,core.ItemIdentifiers.OLMLET);assert.ok(other?.isRegistered());f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_PICKAXE),true);while(f.p.getInventory().getFreeSlots()>1)f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);
 const rock=new core.GameObject(core.CacheDefinitions.getLocId('copperrock1'),new core.Location(3223,3218,0),10,0,null);core.ObjectManager.register(rock,true);t.after(()=>core.ObjectManager.deregister(rock,true));t.mock.method(Math,'random',()=>0);await send(f,{type:'object_option',id:rock.getId(),x:3223,y:3218,action:'Mine'});for(let i=0;i<20;i++)core.TaskManager.process();
 assert.ok(f.p.getAttribute('pets.owned').includes(golem),'controlled real mining actually wins the pet');assert.equal(f.p.getInventory().getAmount(golem),1,'Wiki pet-priority contract: last slot belongs to pet, not resource');assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE),0,'resource must go to ground');const logs=core.World.getItems().filter(g=>g.getItem().getId()===core.ItemIdentifiers.COPPER_ORE&&g.getOwner()===f.p.getUsername());assert.equal(logs.reduce((n,g)=>n+g.getItem().getAmount(),0),1,'the displaced ore must exist on the real ground');assert.equal(logs[0].getPrivateArea(),f.p.getPrivateArea());t.after(()=>{for(const g of logs)core.ItemOnGroundManager.deregister(g)});
});
async function mineOnce(t,f,random=0,gameval='copperrock1') {
 const rock=new core.GameObject(core.CacheDefinitions.getLocId(gameval),new core.Location(3223,3218,0),10,0,null);
 core.ObjectManager.register(rock,true);t.after(()=>core.ObjectManager.deregister(rock,true));t.mock.method(Math,'random',()=>random);
 const snapshots=[];PM.createApi('PetPriorityObserve'+f.p.getIndex()).onCustomEvent('mining:success',e=>{if(e.player===f.p)snapshots.push({petRolled:e.petRolled,ore:f.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE),pets:f.p.getInventory().getAmount(item('skillpetmining'))});});
 await send(f,{type:'object_option',id:rock.getId(),x:3223,y:3218,action:'Mine'});for(let i=0;i<20;i++)core.TaskManager.process();return snapshots;
}
function pickaxeAndSpace(f,free=1) {f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_PICKAXE),true);while(f.p.getInventory().getFreeSlots()>free)f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);}
async function otherFollower(f) {f.p.getInventory().add(new core.Item(core.ItemIdentifiers.OLMLET),true);return drop(f,core.ItemIdentifiers.OLMLET);}
function groundOre(f) {return core.World.getItems().filter(g=>g.getItem().getId()===core.ItemIdentifiers.COPPER_ORE&&g.getOwner()===f.p.getUsername());}

test('a missed pet roll leaves the ordinary last-slot ore and postresource success event',async t=>{
 const f=actor(t),other=await otherFollower(f);pickaxeAndSpace(f);const snapshots=await mineOnce(t,f,0.01);
 assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE),1);assert.equal(f.p.getInventory().getAmount(item('skillpetmining')),0);assert.equal(f.p.getAttribute('pets:current'),other);assert.equal(groundOre(f).length,0);assert.deepEqual(snapshots,[{petRolled:true,ore:1,pets:0}]);
});
test('winning with no follower leaves the last slot for the ore and saves only one active pet',async t=>{
 const f=actor(t);pickaxeAndSpace(f);const snapshots=await mineOnce(t,f);assert.ok(f.p.getAttribute('pets:current')?.isRegistered());assert.equal(f.p.getInventory().getAmount(item('skillpetmining')),0);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE),1);assert.equal(groundOre(f).length,0);assert.deepEqual(snapshots,[{petRolled:true,ore:1,pets:0}]);
 PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});assert.ok(g.p.getAttribute('pets:current')?.isRegistered());assert.equal(g.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE),1);assert.equal(g.p.getInventory().getAmount(item('skillpetmining')),0);
});
test('a duplicate family roll cannot consume the last resource slot or roll again on success',async t=>{
 const f=actor(t),other=await otherFollower(f);f.p.setAttribute('pets.owned',[core.ItemIdentifiers.OLMLET,item('skillpetmining')]);pickaxeAndSpace(f);const messages=[];const sender=f.p.getPacketSender(),original=sender.sendMessage.bind(sender);t.mock.method(sender,'sendMessage',m=>{messages.push(m);return original(m)});
 const snapshots=await mineOnce(t,f);assert.equal(f.p.getAttribute('pets:current'),other);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE),1);assert.equal(f.p.getInventory().getAmount(item('skillpetmining')),0);assert.equal(messages.filter(m=>m==='You have a funny feeling like you would have been followed...').length,1);assert.deepEqual(snapshots,[{petRolled:true,ore:1,pets:0}]);
});
test('an actual open coal bag retains storage priority with a full pack and another follower',async t=>{
 const f=actor(t),other=await otherFollower(f),bag=new core.Item(core.ItemIdentifiers.OPEN_COAL_BAG);f.p.getInventory().add(bag,true);pickaxeAndSpace(f,0);f.p.getSkillManager().setCurrentLevel(core.Skill.MINING,99);f.p.getSkillManager().setMaxLevel(core.Skill.MINING,99);await mineOnce(t,f,0,'coalrock1');const contents={player:f.p,item:bag,contents:[],handled:false};PM.emitCustomEvent('storage:contents',contents);assert.equal(contents.handled,true);assert.ok(contents.contents.some(x=>x.id===core.ItemIdentifiers.COAL&&x.amount>=1));assert.equal(f.p.getAttribute('pets:current'),other);assert.equal(f.p.getInventory().getAmount(item('skillpetmining')),0);assert.ok(f.p.getAttribute('pets.owned').includes(item('skillpetmining')));assert.equal(groundOre(f).length,0);
});

test('winning last-slot pet and displaced ore survive real save, Bank deposit and native ground pickup',async t=>{
 const f=actor(t);await otherFollower(f);pickaxeAndSpace(f);await mineOnce(t,f);const logs=groundOre(f);assert.equal(logs.length,1);assert.equal(f.p.getInventory().getAmount(item('skillpetmining')),1);
 PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);g.p.setUsername(f.p.getUsername());PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;assert.ok(g.p.getAttribute('pets:current')?.isRegistered());assert.equal(g.p.getInventory().getAmount(item('skillpetmining')),1);
 g.p.getBank(0).open();core.Bank.deposit(g.p,item('skillpetmining'),g.p.getInventory().getSlotForItemId(item('skillpetmining')),1,false);g.p.getPacketSender().sendInterfaceRemoval();await send(g,{type:'ground_item_action',itemId:core.ItemIdentifiers.COPPER_ORE,x:logs[0].getPosition().getX(),y:logs[0].getPosition().getY(),option:'Take',optionIndex:3});
 assert.equal(g.p.getBank(0).getAmount(item('skillpetmining')),1);assert.equal(g.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE),1);assert.equal(g.p.getInventory().getAmount(item('skillpetmining')),0);core.ItemOnGroundManager.process();assert.equal(core.World.getItems().includes(logs[0]),false);
});

for(const [name,meta,combust]of [['INFERNAL_PICKAXE','infernal-pickaxe',true],['CRYSTAL_PICKAXE','crystal-pickaxe',false]])test('actual '+name+' charge and XP survive winning last-slot pet priority',async t=>{const f=actor(t);await otherFollower(f);f.p.getSkillManager().setCurrentLevel(core.Skill.MINING,99);f.p.getSkillManager().setMaxLevel(core.Skill.MINING,99);const pickaxe=new core.Item(core.ItemIdentifiers[name]);pickaxe.setMetaValue(meta,{charges:2});f.p.getInventory().add(pickaxe,true);while(f.p.getInventory().getFreeSlots()>1)f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);const xp=f.p.getSkillManager().getExperience(core.Skill.MINING),smith=f.p.getSkillManager().getExperience(core.Skill.SMITHING);await mineOnce(t,f);assert.equal(f.p.getInventory().getItems().find(i=>i.getId()===core.ItemIdentifiers[name]).getMetaValue(meta).charges,1);assert.ok(f.p.getSkillManager().getExperience(core.Skill.MINING)>xp);assert.equal(f.p.getInventory().getAmount(item('skillpetmining')),1);assert.equal(groundOre(f).reduce((n,g)=>n+g.getItem().getAmount(),0),combust?0:1);if(combust)assert.ok(f.p.getSkillManager().getExperience(core.Skill.SMITHING)>smith);});

// Selected native phases: observe a turn's updates before the next real reset.
function miningCancellationTurn(f) {
  f.p.resetUpdating();
  core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;
  core.TaskManager.process();
  f.c.processTurnPackets();
  const movement=f.p.getMovementQueue();
  movement.beginCycle();
  movement.processEntityPursuit();
  if(movement.hasPendingWork())movement.process();
  core.TaskManager.processWalkTo(f.p.getIndex());
}

for(const cancel of [false,true]) {
  test('native plain mining: '+(cancel?'one-step movement before the first roll leaves no delayed XP or copper ore':'normal completion control grants one XP drop and copper ore'),async t=>{
    const f=actor(t),ids=core.ItemIdentifiers,start=[3222,3218,0],destination=[3221,3218,0];
    const position=()=>[f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()];
    const ownedOre=()=>core.World.getItems().filter(g=>!g.isPendingRemoval()&&g.getItem().getId()===ids.COPPER_ORE&&g.getOwner()===f.p.getUsername()&&g.getPrivateArea()===f.p.getPrivateArea());
    const oreTotal=()=>f.p.getInventory().getAmount(ids.COPPER_ORE)+f.p.getEquipment().getAmount(ids.COPPER_ORE)+ownedOre().reduce((n,g)=>n+g.getItem().getAmount(),0);
    const gains=[],skills=f.p.getSkillManager(),addExperiences=skills.addExperiences.bind(skills);
    t.mock.method(skills,'addExperiences',(skill,amount)=>{
      if(skill===core.Skill.MINING)gains.push(amount);
      return addExperiences(skill,amount);
    });
    t.after(()=>{for(const g of ownedOre())core.ItemOnGroundManager.deregister(g);});
    f.p.getInventory().add(new core.Item(ids.BRONZE_PICKAXE),true);
    assert.equal(f.p.getInventory().getAmount(ids.BRONZE_PICKAXE),1);
    assert.equal(f.p.getEquipment().getItems().some(i=>i&&i.getId()>0),false);
    const rockId=core.CacheDefinitions.getLocId('copperrock1');
    assert.ok(rockId>=0);
    const rock=new core.GameObject(rockId,new core.Location(3223,3218,0),10,0,null);
    core.ObjectManager.register(rock,true);t.after(()=>core.ObjectManager.deregister(rock,true));
    const definition=core.ObjectDefinition.forPlayer(rockId,f.p);
    assert.ok(definition);
    assert.equal(definition.getName(),'Copper rocks');
    assert.ok(definition.getActions()?.includes('Mine'));
    assert.deepEqual(position(),start);
    // Fixed draws miss the upper-face gem pre-roll and the rare pet roll, and land copper.
    t.mock.method(Math,'random',()=>0.01);
    let turns=0,swingCalls=0;
    const swings=[],animate=f.p.performAnimation.bind(f.p);
    t.mock.method(f.p,'performAnimation',(...args)=>{
      const generation=f.p.getAnimationGeneration(),result=animate(...args);
      if(args[0]?.getId()===625) {
        swingCalls++;
        if(swings.length<4)swings.push({turn:turns,epoch:core.World.getProcessCycle(),position:position(),generationBefore:generation,generationAfter:f.p.getAnimationGeneration(),actual:f.p.getAnimation()?.getId()??null,gains:[...gains],ore:oreTotal()});
      }
      return result;
    });
    const step=()=>{assert.ok(turns<12,'fixed mining case exceeded12 selected turns');turns++;miningCancellationTurn(f);};
    const state=()=>JSON.stringify({cancel,turns,epoch:core.World.getProcessCycle(),position:position(),queue:f.p.getMovementQueue().size(),moving:f.p.getMovementQueue().isMovings(),didMove:f.p.getMovementQueue().didMoveThisCycle(),animation:f.p.getAnimation()?.getId()??null,gains,ore:oreTotal(),swings,swingCalls});
    const noYield=()=>{assert.deepEqual(gains,[],'no Mining XP before the first-roll boundary: '+state());assert.equal(oreTotal(),0,'no copper before the first-roll boundary: '+state());};
    await f.c.dispatch([{type:'object_option',id:rockId,x:3223,y:3218,action:'Mine'}]);
    step(); // The real object reach admits the session; do not wait for its delayed swing.
    assert.deepEqual(position(),start);
    assert.equal(f.p.getMovementQueue().size(),0);
    noYield();
    if(cancel)await f.c.dispatch([{type:'move',worldX:destination[0],worldY:destination[1],modifierFlags:0,run:false}]);
    step(); // Global MiningTask's first swing precedes this turn's queued walk.
    assert.equal(swings.length,1,'one real native mining swing must precede the first roll: '+state());
    assert.equal(swings[0].turn,2);
    assert.deepEqual(swings[0].position,start,'the real swing must precede the walk');
    assert.equal(swings[0].actual,625,'the actual bronze swing must be accepted');
    assert.ok(swings[0].generationAfter>swings[0].generationBefore);
    assert.deepEqual(swings[0].gains,[]);
    assert.equal(swings[0].ore,0);
    assert.deepEqual(position(),cancel?destination:start,'the declared real walk/control position must be reached');
    assert.equal(f.p.getMovementQueue().size(),0,'the one-step route must be drained before the next global pass');
    assert.equal(f.p.getMovementQueue().didMoveThisCycle(),cancel);
    assert.equal(rock.isWithinInteractionDistance(f.p.getLocation()),true,'distance refusal must not substitute for movement cancellation');
    noYield();
    for(let tick=0;tick<8;tick++)step();
    assert.deepEqual(gains,cancel?[]:[17.5],'literal copper XP after the completion/cancellation window: '+state());
    assert.equal(oreTotal(),cancel?0:1,'carried plus owned floor copper after the same window: '+state());
    assert.equal(f.p.getInventory().getAmount(ids.BRONZE_PICKAXE),1);
  });
}

test('native plain mining: an outside-range approach settles before starting and completes normally',async t=>{
  const f=actor(t),ids=core.ItemIdentifiers,start=[3218,3218,0];
  f.p.setLocation(new core.Location(...start));
  const position=()=>[f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()];
  const movement=f.p.getMovementQueue();
  const ownedOre=()=>core.World.getItems().filter(g=>!g.isPendingRemoval()&&g.getItem().getId()===ids.COPPER_ORE&&g.getOwner()===f.p.getUsername()&&g.getPrivateArea()===f.p.getPrivateArea());
  const oreTotal=()=>f.p.getInventory().getAmount(ids.COPPER_ORE)+f.p.getEquipment().getAmount(ids.COPPER_ORE)+ownedOre().reduce((n,g)=>n+g.getItem().getAmount(),0);
  const gains=[],skills=f.p.getSkillManager(),addExperiences=skills.addExperiences.bind(skills);
  t.mock.method(skills,'addExperiences',(skill,amount)=>{if(skill===core.Skill.MINING)gains.push(amount);return addExperiences(skill,amount);});
  t.after(()=>{for(const g of ownedOre())core.ItemOnGroundManager.deregister(g);});
  f.p.getInventory().add(new core.Item(ids.BRONZE_PICKAXE),true);
  assert.equal(f.p.getInventory().getAmount(ids.BRONZE_PICKAXE),1);
  assert.equal(f.p.getEquipment().getItems().some(i=>i&&i.getId()>0),false);
  const rockId=core.CacheDefinitions.getLocId('copperrock1');
  assert.ok(rockId>=0);
  const rock=new core.GameObject(rockId,new core.Location(3223,3218,0),10,0,null);
  core.ObjectManager.register(rock,true);t.after(()=>core.ObjectManager.deregister(rock,true));
  const definition=core.ObjectDefinition.forPlayer(rockId,f.p);
  assert.ok(definition);assert.equal(definition.getName(),'Copper rocks');assert.ok(definition.getActions()?.includes('Mine'));
  assert.deepEqual(position(),start);
  assert.equal(rock.isWithinInteractionDistance(f.p.getLocation()),false,'the native route must begin outside continuation range');
  assert.deepEqual(gains,[]);assert.equal(oreTotal(),0);
  t.mock.method(Math,'random',()=>0.01);
  let turns=0,sawMovement=false,swingCalls=0;
  const swings=[],animate=f.p.performAnimation.bind(f.p);
  t.mock.method(f.p,'performAnimation',(...args)=>{
    const generation=f.p.getAnimationGeneration(),result=animate(...args);
    if(args[0]?.getId()===625) {
      swingCalls++;
      if(swings.length<4)swings.push({turn:turns,epoch:core.World.getProcessCycle(),position:position(),queue:movement.size(),moving:movement.isMovings(),didMove:movement.didMoveThisCycle(),generationBefore:generation,generationAfter:f.p.getAnimationGeneration(),actual:f.p.getAnimation()?.getId()??null,gains:[...gains],ore:oreTotal()});
    }
    return result;
  });
  const step=()=>{assert.ok(turns<24,'fixed mining approach exceeded24 selected turns');turns++;miningCancellationTurn(f);};
  const state=()=>JSON.stringify({turns,sawMovement,position:position(),queue:movement.size(),moving:movement.isMovings(),didMove:movement.didMoveThisCycle(),animation:f.p.getAnimation()?.getId()??null,gains,ore:oreTotal(),swings,swingCalls});
  await f.c.dispatch([{type:'object_option',id:rockId,x:3223,y:3218,action:'Mine'}]);
  for(let tick=0;tick<16&&swings.length===0;tick++) {
    step();
    if(movement.didMoveThisCycle())sawMovement=true;
  }
  assert.equal(sawMovement,true,'the real object route must actually walk: '+state());
  assert.equal(swings.length,1,'the settled approach must actually reach the first mining swing: '+state());
  assert.equal(swings[0].actual,625,'the first bronze swing must really be accepted: '+state());
  assert.ok(swings[0].generationAfter>swings[0].generationBefore,'the accepted swing must advance generation: '+state());
  assert.equal(swings[0].queue,0,'the new action must start after its route drains: '+state());
  assert.equal(swings[0].moving,false,'retained approach movement must settle before the new action: '+state());
  assert.equal(swings[0].didMove,false);
  assert.deepEqual(swings[0].gains,[]);assert.equal(swings[0].ore,0);
  assert.notDeepEqual(position(),start);
  assert.equal(rock.isWithinInteractionDistance(f.p.getLocation()),true);
  assert.equal(movement.size(),0);assert.equal(movement.isMovings(),false);
  assert.deepEqual(gains,[],'no resource roll may precede settled admission: '+state());assert.equal(oreTotal(),0);
  for(let tick=0;tick<8;tick++)step();
  assert.deepEqual(gains,[17.5],'ordinary approach must retain the literal copper XP: '+state());
  assert.equal(oreTotal(),1,'ordinary approach must retain one owned copper ore: '+state());
  assert.equal(f.p.getInventory().getAmount(ids.BRONZE_PICKAXE),1);
});
