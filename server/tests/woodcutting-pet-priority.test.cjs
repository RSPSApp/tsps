const assert = require('node:assert/strict'), path = require('node:path');
const {before, after, test} = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
let core, PlayerSave, next = 1250;
const previousPlayerBots = process.env.DISABLE_PLAYER_BOTS;
before(async () => { process.env.DISABLE_PLAYER_BOTS='1'; await CachePipeline.initialize(path.resolve(__dirname,'..')); PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi(); ({PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave')); core.RegionManager.init(); core.RegionManager.loadMapFiles(3222,3218); core.RegionManager.loadMapFiles(2611,3295); PM.emitServerStartup({}); });
after(() => { try { PM.emitServerShutdown({}); } finally { if(previousPlayerBots===undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS=previousPlayerBots; } });
const item = name => core.CacheDefinitions.getObjId(name);
const npcId = name => core.CacheDefinitions.getNpcId(name);
// A nest takes the place of a roll's log, so the fixed draws below let the nest roll miss.
function missNest(value) {return ()=>new Error().stack.includes('maybeDropBirdNest')?0.99:value;}
function actor(t) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('beaverqa'+next); p.setRegistered(true); p.setLocation(new core.Location(3222,3218,0)); p.needsPlacement=false;
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
async function summon(f,name='skillpetwc') {const id=item(name);f.p.getInventory().add(new core.Item(id),true);const n=await drop(f,id);assert.ok(n?.isRegistered());return n;}



test('native last-slot priority gives pet before resource when another follower is active',async t=>{
 const f=actor(t),beaver=item('skillpetwc');f.p.getInventory().add(new core.Item(core.ItemIdentifiers.OLMLET),true);const other=await drop(f,core.ItemIdentifiers.OLMLET);assert.ok(other?.isRegistered());f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_AXE),true);while(f.p.getInventory().getFreeSlots()>1)f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);
 const tree=new core.GameObject(core.ObjectIdentifiers.TREE,new core.Location(3223,3218,0),10,0,null);core.ObjectManager.register(tree,true);t.after(()=>core.ObjectManager.deregister(tree,true));t.mock.method(Math,'random',missNest(0));await send(f,{type:'object_option',id:tree.getId(),x:3223,y:3218,action:'Chop down'});for(let i=0;i<20;i++)core.TaskManager.process();
 assert.ok(f.p.getAttribute('pets.owned').includes(beaver),'controlled real chopping actually wins the pet');assert.equal(f.p.getInventory().getAmount(beaver),1,'Wiki pet-priority contract: last slot belongs to pet, not resource');assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS),0,'resource must go to ground');const logs=core.World.getItems().filter(g=>g.getItem().getId()===core.ItemIdentifiers.LOGS&&g.getOwner()===f.p.getUsername());assert.equal(logs.reduce((n,g)=>n+g.getItem().getAmount(),0),1,'the displaced log must exist on the real ground');assert.equal(logs[0].getPrivateArea(),f.p.getPrivateArea());t.after(()=>{for(const g of logs)core.ItemOnGroundManager.deregister(g)});
});
async function chopOnce(t,f,random=0) {
 const tree=new core.GameObject(core.ObjectIdentifiers.TREE,new core.Location(3223,3218,0),10,0,null);
 core.ObjectManager.register(tree,true);t.after(()=>core.ObjectManager.deregister(tree,true));t.mock.method(Math,'random',missNest(random));
 const snapshots=[];PM.createApi('PetPriorityObserve'+f.p.getIndex()).onCustomEvent('woodcutting:success',e=>{if(e.player===f.p)snapshots.push({petRolled:e.petRolled,logs:f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS),pets:f.p.getInventory().getAmount(item('skillpetwc'))});});
 await send(f,{type:'object_option',id:tree.getId(),x:3223,y:3218,action:'Chop down'});for(let i=0;i<20;i++)core.TaskManager.process();return snapshots;
}
function axeAndSpace(f,free=1) {f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_AXE),true);while(f.p.getInventory().getFreeSlots()>free)f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);}
async function otherFollower(f) {f.p.getInventory().add(new core.Item(core.ItemIdentifiers.OLMLET),true);return drop(f,core.ItemIdentifiers.OLMLET);}
function groundLogs(f) {return core.World.getItems().filter(g=>g.getItem().getId()===core.ItemIdentifiers.LOGS&&g.getOwner()===f.p.getUsername());}

test('a missed pet roll leaves the ordinary last-slot log and postresource success event',async t=>{
 const f=actor(t),other=await otherFollower(f);axeAndSpace(f);const snapshots=await chopOnce(t,f,0.01);
 assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS),1);assert.equal(f.p.getInventory().getAmount(item('skillpetwc')),0);assert.equal(f.p.getAttribute('pets:current'),other);assert.equal(groundLogs(f).length,0);assert.deepEqual(snapshots,[{petRolled:true,logs:1,pets:0}]);
});
test('winning with no follower leaves the last slot for the log and saves only one active pet',async t=>{
 const f=actor(t);axeAndSpace(f);const snapshots=await chopOnce(t,f);assert.ok(f.p.getAttribute('pets:current')?.isRegistered());assert.equal(f.p.getInventory().getAmount(item('skillpetwc')),0);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS),1);assert.equal(groundLogs(f).length,0);assert.deepEqual(snapshots,[{petRolled:true,logs:1,pets:0}]);
 PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});assert.ok(g.p.getAttribute('pets:current')?.isRegistered());assert.equal(g.p.getInventory().getAmount(core.ItemIdentifiers.LOGS),1);assert.equal(g.p.getInventory().getAmount(item('skillpetwc')),0);
});
test('a duplicate family roll cannot consume the last resource slot or roll again on success',async t=>{
 const f=actor(t),other=await otherFollower(f);f.p.setAttribute('pets.owned',[core.ItemIdentifiers.OLMLET,item('skillpetwc')]);axeAndSpace(f);const messages=[];const sender=f.p.getPacketSender(),original=sender.sendMessage.bind(sender);t.mock.method(sender,'sendMessage',m=>{messages.push(m);return original(m)});
 const snapshots=await chopOnce(t,f);assert.equal(f.p.getAttribute('pets:current'),other);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS),1);assert.equal(f.p.getInventory().getAmount(item('skillpetwc')),0);assert.equal(messages.filter(m=>m==='You have a funny feeling like you would have been followed...').length,1);assert.deepEqual(snapshots,[{petRolled:true,logs:1,pets:0}]);
});
test('an actual open log basket retains storage priority with a full pack and another follower',async t=>{
 const f=actor(t),other=await otherFollower(f),basket=new core.Item(core.ItemIdentifiers.OPEN_LOG_BASKET);f.p.getInventory().add(basket,true);axeAndSpace(f,0);await chopOnce(t,f);const contents={player:f.p,item:basket,contents:[],handled:false};PM.emitCustomEvent('storage:contents',contents);assert.equal(contents.handled,true);assert.ok(contents.contents.some(x=>x.id===core.ItemIdentifiers.LOGS&&x.amount>=1));assert.equal(f.p.getAttribute('pets:current'),other);assert.equal(f.p.getInventory().getAmount(item('skillpetwc')),0);assert.ok(f.p.getAttribute('pets.owned').includes(item('skillpetwc')));assert.equal(groundLogs(f).length,0);
});

test('winning last-slot pet and displaced log survive real save, Bank deposit and native ground pickup',async t=>{
 const f=actor(t);await otherFollower(f);axeAndSpace(f);await chopOnce(t,f);const logs=groundLogs(f);assert.equal(logs.length,1);assert.equal(f.p.getInventory().getAmount(item('skillpetwc')),1);
 PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);g.p.setUsername(f.p.getUsername());PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;assert.ok(g.p.getAttribute('pets:current')?.isRegistered());assert.equal(g.p.getInventory().getAmount(item('skillpetwc')),1);
 g.p.getBank(0).open();core.Bank.deposit(g.p,item('skillpetwc'),g.p.getInventory().getSlotForItemId(item('skillpetwc')),1,false);g.p.getPacketSender().sendInterfaceRemoval();await send(g,{type:'ground_item_action',itemId:core.ItemIdentifiers.LOGS,x:logs[0].getPosition().getX(),y:logs[0].getPosition().getY(),option:'Take',optionIndex:3});
 assert.equal(g.p.getBank(0).getAmount(item('skillpetwc')),1);assert.equal(g.p.getInventory().getAmount(core.ItemIdentifiers.LOGS),1);assert.equal(g.p.getInventory().getAmount(item('skillpetwc')),0);core.ItemOnGroundManager.process();assert.equal(core.World.getItems().includes(logs[0]),false);
});

// Jagex, Forestry: Part Two (25 October 2023): each successful felling chop with a
// ration gives 10% more XP and a 20% no-log chance. A missed log still rolls the pet.
// These are literal outcomes observed around the real native object action, not calls
// to the production ration helper. The existing fixture owns plugin/cache setup.
for (const row of [
  {name:'ordinary axe leaves rations alone', axe:'BRONZE_AXE', ration:'inventory', draw:0, xp:25, logs:1, left:2},
  {name:'felling without rations is an ordinary chop', axe:'BRONZE_FELLING_AXE', ration:'none', draw:0, xp:25, logs:1, left:0},
  {name:'inventory ration is spent on the kept log', axe:'BRONZE_FELLING_AXE', ration:'inventory', draw:0.2, xp:27.5, logs:1, left:1},
  {name:'below the 20 percent boundary gives XP and a pet roll without a log', axe:'BRONZE_FELLING_AXE', ration:'inventory', draw:0.199999, xp:27.5, logs:0, left:1},
  {name:'carried kit supplies the ration', axe:'BRONZE_FELLING_AXE', ration:'kit', draw:0.2, xp:27.5, logs:1, left:1},
  {name:'worn kit supplies the ration for a skipped log', axe:'BRONZE_FELLING_AXE', ration:'worn-kit', draw:0, xp:27.5, logs:0, left:1},
  {name:'free worlds cannot spend a members ration', axe:'BRONZE_FELLING_AXE', ration:'inventory', freeWorld:true, draw:0, xp:25, logs:1, left:2},
  {name:'equal-best carried felling axe takes precedence with rations', axe:'BRONZE_AXE', otherAxe:'BRONZE_FELLING_AXE', ration:'inventory', selected:'BRONZE_FELLING_AXE', draw:0.2, xp:27.5, logs:1, left:1},
  {name:'equal-best felling axe can be carried beside a worn ordinary axe', axe:'BRONZE_AXE', wearAxe:true, otherAxe:'BRONZE_FELLING_AXE', ration:'inventory', selected:'BRONZE_FELLING_AXE', draw:0.2, xp:27.5, logs:1, left:1},
  {name:'a higher ordinary axe prevents a lower felling bonus', axe:'IRON_AXE', otherAxe:'BRONZE_FELLING_AXE', ration:'inventory', selected:'IRON_AXE', draw:0, xp:25, logs:1, left:2},
  {name:'no-ration equal-tier order stays ordinary', axe:'BRONZE_AXE', otherAxe:'BRONZE_FELLING_AXE', ration:'none', selected:'BRONZE_AXE', draw:0, xp:25, logs:1, left:0},
  {name:'an ineligible steel felling axe cannot displace a usable bronze axe', axe:'BRONZE_AXE', otherAxe:'STEEL_FELLING_AXE', ration:'inventory', selected:'BRONZE_AXE', draw:0, xp:25, logs:1, left:2},
  {name:'Infernal priority and burning stay unchanged', axe:'INFERNAL_AXE', otherAxe:'DRAGON_FELLING_AXE', levels:[61,85], ration:'inventory', selected:'INFERNAL_AXE', draw:0, xp:25, logs:0, left:2},
  {name:'a mixed full outfit multiplies the ration XP bonus', axe:'BRONZE_FELLING_AXE', ration:'inventory', outfit:true, draw:0.2, xp:28.1875, logs:1, left:1},
  {name:'failed cutting rolls consume no rations or XP', axe:'BRONZE_FELLING_AXE', ration:'inventory', draw:0, miss:true, xp:null, logs:0, left:2},
]) {
  test('native felling ration: '+row.name, async t => {
    const f=actor(t), ids=core.ItemIdentifiers, ration=ids.FORESTERS_RATION;
    assert.ok(Number.isInteger(ration), 'the generated ration identifier must exist');
    if(row.freeWorld) t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);
    if(row.levels) {
      f.p.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING,row.levels[0]);
      f.p.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING,row.levels[0]);
      f.p.getSkillManager().setMaxLevel(core.Skill.FIREMAKING,row.levels[1]);
      f.p.getSkillManager().setCurrentLevel(core.Skill.FIREMAKING,row.levels[1]);
    }
    if(row.wearAxe) f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT,new core.Item(ids[row.axe]));
    else f.p.getInventory().add(new core.Item(ids[row.axe]),true);
    if(row.otherAxe) f.p.getInventory().add(new core.Item(ids[row.otherAxe]),true);
    if(row.outfit) {
      for(const [slot,name] of [['HEAD_SLOT','LUMBERJACK_HAT'],['BODY_SLOT','FORESTRY_TOP'],['LEG_SLOT','LUMBERJACK_LEGS'],['FEET_SLOT','FORESTRY_BOOTS']])
        f.p.getEquipment().setItem(core.Equipment[slot],new core.Item(ids[name]));
    }
    const heldRation=ration;
    if(row.ration!=='none') f.p.getInventory().add(new core.Item(heldRation,2),true);
    let kit=null;
    if(row.ration==='kit'||row.ration==='worn-kit') {
      kit=new core.Item(ids.FORESTRY_KIT);
      f.p.getInventory().add(kit,true);
      const actions=core.CacheDefinitions.getItem(kit.getId()).inventoryActions;
      const fill=actions.findIndex(a=>a==='Fill');
      assert.ok(fill>=0, 'the actual kit definition exposes Fill');
      await send(f,{type:'inventory_action',slot:f.p.getInventory().getSlotForItemId(kit.getId()),itemId:kit.getId(),widgetId:149<<16,option:'Fill',optionIndex:fill+1});
      assert.equal(f.p.getInventory().getAmount(ration),0,'normal kit Fill must really store the rations');
      if(row.ration==='worn-kit') {
        f.p.getInventory().deleteNumber(kit.getId(),1);
        f.p.getEquipment().setItem(core.Equipment.CAPE_SLOT,kit);
      }
    }
    const xp=[],skills=f.p.getSkillManager(),add=skills.addExperiences.bind(skills);
    t.mock.method(skills,'addExperiences',(skill,amount)=>{
      if(skill===core.Skill.WOODCUTTING) xp.push(amount);
      return add(skill,amount);
    });
    let observing=true,petRolls=0;
    const chosenAxes=[];
    const observer=PM.createApi('FellingRationObserve'+f.p.getIndex());
    observer.onCustomEvent('woodcutting:success',e=>{if(observing&&e.player===f.p)chosenAxes.push(e.axeId);});
    observer.onCustomEvent('pets:skilling-roll',e=>{if(observing&&e.player===f.p)petRolls++;});
    t.after(()=>{observing=false;});
    // Keep nest and pet randomness separate from the tested felling probability.
    // This controls draws only; the real success, XP, storage, pet and delivery paths run.
    t.mock.method(Math,'random',()=>{
      const stack=new Error().stack;
      if(stack.includes('maybeDropBirdNest')) return 0.99;
      if(stack.includes('fellingChop')) return row.draw;
      return row.miss?0.999:0;
    });
    const tree=new core.GameObject(core.ObjectIdentifiers.TREE,new core.Location(3223,3218,0),10,0,null);
    core.ObjectManager.register(tree,true);
    t.after(()=>core.ObjectManager.deregister(tree,true));
    await send(f,{type:'object_option',id:tree.getId(),x:3223,y:3218,action:'Chop down'});
    for(let i=0;i<20;i++) core.TaskManager.process();
    if(row.outfit) {
      assert.equal(xp.length,1);
      assert.ok(Math.abs(xp[0]-28.1875)<1e-10,'literal 25 x1.025 x1.1 outfit/ration oracle');
    } else assert.deepEqual(xp,row.xp===null?[]:[row.xp],'literal per-chop XP before normal server XP scaling');
    if(row.selected) assert.deepEqual(chosenAxes,[ids[row.selected]],'the native chop actually selected the eligible best tool');
    assert.equal(petRolls,row.miss?0:1,'a skipped log preserves the genuine pet opportunity');
    const logs=f.p.getInventory().getAmount(ids.LOGS)+groundLogs(f).reduce((n,g)=>n+g.getItem().getAmount(),0);
    assert.equal(logs,row.logs,'real carried plus owned floor yield');
    if(kit) {
      const request={player:f.p,item:kit,contents:[],handled:false};
      PM.emitCustomEvent('storage:contents',request);
      assert.equal(request.handled,true);
      assert.equal(request.contents.find(x=>x.id===ration)?.amount??0,row.left,'actual persisted kit contents');
    } else assert.equal(f.p.getInventory().getAmount(heldRation),row.left,'actual remaining inventory rations');
  });
}

// The duplicate generated name is a cache placeholder, not a legitimate noted ration.
// Check definitions without manufacturing a placeholder in an ordinary inventory.
test('the real ration is non-noteable and its duplicate identifier is its placeholder', () => {
  const ids=core.ItemIdentifiers;
  const ration=core.CacheDefinitions.getItem(ids.FORESTERS_RATION);
  const placeholder=core.CacheDefinitions.getItem(ids.FORESTERS_RATION_2);
  assert.equal(ration.noteTemplate,-1);
  assert.equal(ration.note,-1);
  assert.equal(ration.placeholder,ids.FORESTERS_RATION_2);
  assert.equal(ration.placeholderTemplate,-1);
  assert.equal(placeholder.placeholder,ids.FORESTERS_RATION);
  assert.ok(placeholder.placeholderTemplate>=0);
  assert.equal(placeholder.noteTemplate,-1);
});

// World runs the global task pass before the player's input and movement.
// Keep that order here: draining a one-step route before the next global pass is
// the cancellation boundary under investigation, not a synthetic success hook.
function woodcutCancellationTurn(f) {
  // Defer the prior turn's post-sync reset until callers have inspected its updates.
  f.p.resetUpdating();
  // Mirror World.process's epoch prefix before its global task pass.
  core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process();
  f.c.processTurnPackets();
  const movement=f.p.getMovementQueue();
  movement.beginCycle();
  movement.processEntityPursuit();
  if(movement.hasPendingWork()) movement.process();
  core.TaskManager.processWalkTo(f.p.getIndex());
}

for (const cancel of [false,true]) {
  test('native plain woodcut: '+(cancel?'one-step movement before the first roll leaves no delayed XP or log':'normal completion control grants one XP drop and log'), async t=>{
    const f=actor(t),ids=core.ItemIdentifiers;
    const start=[3222,3218,0],destination=[3221,3218,0];
    const position=()=>[f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()];
    const yieldCount=()=>f.p.getInventory().getAmount(ids.LOGS)+groundLogs(f).reduce((sum,g)=>sum+g.getItem().getAmount(),0);
    const gains=[],skills=f.p.getSkillManager(),original=skills.addExperiences.bind(skills);
    t.mock.method(skills,'addExperiences',(skill,amount)=>{
      if(skill===core.Skill.WOODCUTTING) gains.push(amount);
      return original(skill,amount);
    });
    // A real successful cut is deterministic; a nest must not replace its resource.
    t.mock.method(Math,'random',missNest(0.01));
    f.p.getInventory().add(new core.Item(ids.BRONZE_AXE),true);
    t.after(()=>{for(const g of groundLogs(f))core.ItemOnGroundManager.deregister(g);});
    const tree=new core.GameObject(core.ObjectIdentifiers.TREE,new core.Location(3223,3218,0),10,0,null);
    core.ObjectManager.register(tree,true);
    t.after(()=>core.ObjectManager.deregister(tree,true));
    const definition=core.ObjectDefinition.forPlayer(tree.getId(),f.p);
    assert.ok(definition,'the actual normal-tree definition must exist');
    assert.equal(definition.getName(),'Tree');
    assert.ok(definition.getActions()?.includes('Chop down'),'the actual definition must expose native chopping');
    assert.deepEqual(position(),start,'the fixture must start at the declared reachable tile');
    assert.deepEqual(gains,[]);
    assert.equal(yieldCount(),0);

    await f.c.dispatch([{type:'object_option',id:tree.getId(),x:3223,y:3218,action:'Chop down'}]);
    for(let tick=0;tick<8&&f.p.getAnimation()?.getId()!==879;tick++) woodcutCancellationTurn(f);
    assert.equal(f.p.getAnimation()?.getId(),879,'native object reach must start the ordinary bronze-axe swing');
    assert.deepEqual(position(),start,'the start must be reached without changing the declared adjacent tile');
    assert.deepEqual(gains,[],'cancellation must be armed before any successful roll');
    assert.equal(yieldCount(),0,'no log may precede the first-roll cancellation point');

    if(cancel) {
      await f.c.dispatch([{type:'move',worldX:destination[0],worldY:destination[1],modifierFlags:0,run:false}]);
      assert.deepEqual(position(),start,'ordinary input must remain queued until the native turn');
      woodcutCancellationTurn(f);
      assert.deepEqual(position(),destination,'the real one-step walk must actually complete; a blocked route is setup failure');
      assert.equal(f.p.getMovementQueue().size(),0,'this diagnostic requires the one-step route to be drained');
      assert.deepEqual(gains,[],'the walk must finish before the first resource roll');
      assert.equal(yieldCount(),0);
    }

    // Cover the original first-roll point and subsequent ordinary action intervals.
    // Observe real effects only; never call stopWoodcutting or manufacture success.
    for(let tick=0;tick<8;tick++) woodcutCancellationTurn(f);
    const observed=JSON.stringify({cancel,position:position(),gains,logs:yieldCount(),animation:f.p.getAnimation()?.getId()});
    assert.deepEqual(gains,cancel?[]:[25],'literal plain-tree XP after the completion/cancellation window: '+observed);
    assert.equal(yieldCount(),cancel?0:1,'carried plus owned floor yield after the same window: '+observed);
  });
}

test('native plain woodcut: an outside-range approach settles before starting and completes normally',async t=>{
  const f=actor(t),ids=core.ItemIdentifiers,start=[3218,3218,0];
  f.p.setLocation(new core.Location(...start));
  const position=()=>[f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()];
  const yieldCount=()=>f.p.getInventory().getAmount(ids.LOGS)+groundLogs(f).reduce((sum,g)=>sum+g.getItem().getAmount(),0);
  const gains=[],skills=f.p.getSkillManager(),original=skills.addExperiences.bind(skills);
  t.mock.method(skills,'addExperiences',(skill,amount)=>{
    if(skill===core.Skill.WOODCUTTING) gains.push(amount);
    return original(skill,amount);
  });
  t.mock.method(Math,'random',missNest(0.01));
  f.p.getInventory().add(new core.Item(ids.BRONZE_AXE),true);
  t.after(()=>{for(const g of groundLogs(f))core.ItemOnGroundManager.deregister(g);});
  const tree=new core.GameObject(core.ObjectIdentifiers.TREE,new core.Location(3223,3218,0),10,0,null);
  core.ObjectManager.register(tree,true);
  t.after(()=>core.ObjectManager.deregister(tree,true));
  const definition=core.ObjectDefinition.forPlayer(tree.getId(),f.p);
  assert.ok(definition,'the actual approach tree definition must exist');
  assert.equal(definition.getName(),'Tree');
  assert.ok(definition.getActions()?.includes('Chop down'));
  assert.deepEqual(position(),start);
  assert.equal(tree.isWithinInteractionDistance(f.p.getLocation()),false,'the approach must really begin outside the continuation radius');
  assert.deepEqual(gains,[]);
  assert.equal(yieldCount(),0);

  await f.c.dispatch([{type:'object_option',id:tree.getId(),x:3223,y:3218,action:'Chop down'}]);
  let sawMovement=false;
  for(let tick=0;tick<16&&f.p.getAnimation()?.getId()!==879;tick++) {
    woodcutCancellationTurn(f);
    if(f.p.getMovementQueue().didMoveThisCycle()) {
      sawMovement=true;
      assert.notEqual(f.p.getAnimation()?.getId(),879,'reach must wait for the movement cycle to settle');
    }
  }
  assert.equal(sawMovement,true,'the native object route must actually walk from outside range');
  assert.notDeepEqual(position(),start);
  assert.equal(f.p.getAnimation()?.getId(),879,'the settled native reach callback must start chopping');
  assert.equal(tree.isWithinInteractionDistance(f.p.getLocation()),true);
  assert.equal(f.p.getMovementQueue().size(),0);
  assert.equal(f.p.getMovementQueue().isMovings(),false,'previous approach movement must be cleared before the new action starts');
  assert.deepEqual(gains,[],'the approach must not include a completed resource roll');
  assert.equal(yieldCount(),0);
  for(let tick=0;tick<8;tick++) woodcutCancellationTurn(f);
  assert.deepEqual(gains,[25],'the movement guard must preserve a newly valid settled action');
  assert.equal(yieldCount(),1);
});

// These fixed cases reuse the native epoch/task/input/movement seam above.
// Fifty selected turns is a hard per-case bound, not a new wall-clock budget.
function plainCancellationScene(t) {
  const f=actor(t),ids=core.ItemIdentifiers,gains=[];
  const skills=f.p.getSkillManager(),addExperiences=skills.addExperiences.bind(skills);
  t.mock.method(skills,'addExperiences',(skill,amount)=>{
    if(skill===core.Skill.WOODCUTTING) gains.push(amount);
    return addExperiences(skill,amount);
  });
  t.mock.method(Math,'random',missNest(0.01));
  f.p.getInventory().add(new core.Item(ids.BRONZE_AXE),true);
  const held=container=>container.getItems().filter(i=>i&&i.getId()>0&&i.getAmount()>0).map(i=>[i.getId(),i.getAmount()]);
  assert.deepEqual(held(f.p.getInventory()),[[ids.BRONZE_AXE,1]],'the plain actor must carry only its declared axe');
  assert.deepEqual(held(f.p.getEquipment()),[],'no hidden equipped tool or outfit may change the control');
  const ownedGround=id=>core.World.getItems().filter(g=>
    !g.isPendingRemoval()&&g.getOwner()===f.p.getUsername()&&
    g.getPrivateArea()===f.p.getPrivateArea()&&(id==null||g.getItem().getId()===id));
  const floor=id=>ownedGround(id).reduce((n,g)=>n+g.getItem().getAmount(),0);
  const carried=id=>f.p.getInventory().getAmount(id)+f.p.getEquipment().getAmount(id);
  const total=id=>carried(id)+floor(id);
  t.after(()=>{for(const g of ownedGround())core.ItemOnGroundManager.deregister(g);});
  const tree=new core.GameObject(core.ObjectIdentifiers.TREE,new core.Location(3223,3218,0),10,0,null);
  core.ObjectManager.register(tree,true);
  t.after(()=>core.ObjectManager.deregister(tree,true));
  const definition=core.ObjectDefinition.forPlayer(tree.getId(),f.p);
  assert.ok(definition,'the actual normal-tree definition must exist');
  assert.equal(definition.getName(),'Tree');
  assert.ok(definition.getActions()?.includes('Chop down'));
  assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],[3222,3218,0]);
  let turns=0;
  const step=()=>{assert.ok(turns<50,'fixed cancellation case exceeded50 selected turns');turns++;woodcutCancellationTurn(f);};
  const observe=n=>{for(let i=0;i<n;i++)step();};
  const state=()=>JSON.stringify({turns,tile:[f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],gains,logs:total(ids.LOGS)});
  const noYield=()=>{assert.deepEqual(gains,[],'no delayed actual XP: '+state());assert.equal(total(ids.LOGS),0,'no delayed owned log: '+state());};
  const start=async(animation=879)=>{
    assert.notEqual(f.p.getAnimation()?.getId(),animation,'a new click must not be mistaken for an old active swing');
    await f.c.dispatch([{type:'object_option',id:tree.getId(),x:3223,y:3218,action:'Chop down'}]);
    step(); // Always process the fresh real packet, even if an old animation survives.
    for(let i=1;i<8&&f.p.getAnimation()?.getId()!==animation;i++)step();
    assert.equal(f.p.getAnimation()?.getId(),animation,'the fresh native click must really start the declared axe');
    assert.equal(f.p.getMovementQueue().size(),0);
    assert.equal(f.p.getMovementQueue().isMovings(),false);
    noYield();
  };
  const dropBronze=async()=>{
    await f.c.dispatch([{type:'inventory_action',slot:f.p.getInventory().getSlotForItemId(ids.BRONZE_AXE),itemId:ids.BRONZE_AXE,widgetId:149<<16,option:'Drop',optionIndex:5}]);
    step();
    assert.equal(carried(ids.BRONZE_AXE),0,'the ordinary Drop packet must remove the only carried axe');
    assert.equal(floor(ids.BRONZE_AXE),1,'the same axe must exist on its real owned ground stack');
    noYield();
    step(); // The real woodcut task gets a pass with no usable carried axe.
    noYield();
  };
  assert.equal(carried(ids.BRONZE_AXE),1);
  assert.equal(total(ids.LOGS),0);
  return {f,ids,gains,ownedGround,floor,carried,total,step,observe,start,dropBronze,noYield,state};
}

test('native woodcut cancellation: dropping the only axe leaves no delayed award or duplicated tool',async t=>{
  const s=plainCancellationScene(t);
  await s.start();
  await s.dropBronze();
  s.observe(8);
  s.noYield();
  assert.equal(s.carried(s.ids.BRONZE_AXE),0);
  assert.equal(s.floor(s.ids.BRONZE_AXE),1);
  assert.equal(s.total(s.ids.BRONZE_AXE),1,'actual Drop must conserve the single owned axe');
});

test('native woodcut cancellation: a stopped no-tool session cannot resume when a replacement is picked up',async t=>{
  const s=plainCancellationScene(t),iron=s.ids.IRON_AXE;
  // Owned scene input; delivery into inventory must still use the native Take packet.
  core.ItemOnGroundManager.registers(s.f.p,new core.Item(iron));
  assert.equal(s.carried(iron),0);
  assert.equal(s.floor(iron),1);
  await s.start();
  await s.dropBronze();
  s.observe(4);
  s.noYield();
  assert.equal(s.f.p.getLastItemPickup().elapsedTime(300),true,'native pickup cooldown must already be eligible; never reset it for the fixture');
  const at=s.f.p.getLocation();
  await s.f.c.dispatch([{type:'ground_item_action',itemId:iron,x:at.getX(),y:at.getY(),option:'Take',optionIndex:3}]);
  s.step();
  for(let i=1;i<4&&s.carried(iron)!==1;i++)s.step();
  assert.equal(s.f.p.getInventory().getAmount(iron),1,'the real Take packet must credit the replacement');
  assert.equal(s.floor(iron),0);
  assert.equal(s.total(iron),1);
  s.observe(8);
  s.noYield(); // A fresh usable axe is not permission to revive the old stopped session.
  await s.start(877);
  s.observe(8);
  assert.deepEqual(s.gains,[25],'only the fresh native iron-axe action may award actual XP');
  assert.equal(s.total(s.ids.LOGS),1);
  assert.equal(s.total(iron),1);
  assert.equal(s.total(s.ids.BRONZE_AXE),1);
});

test('native woodcut cancellation: walk-cancel-restart grants one owned award and leaves a second actor untouched',async t=>{
  const s=plainCancellationScene(t),other=actor(t),otherGains=[];
  const skills=other.p.getSkillManager(),addExperiences=skills.addExperiences.bind(skills);
  t.mock.method(skills,'addExperiences',(skill,amount)=>{
    if(skill===core.Skill.WOODCUTTING)otherGains.push(amount);
    return addExperiences(skill,amount);
  });
  t.after(()=>{for(const g of [...core.World.getItems()])if(g.getOwner()===other.p.getUsername()&&!g.isPendingRemoval())core.ItemOnGroundManager.deregister(g);});
  await s.start();
  await s.f.c.dispatch([{type:'move',worldX:3221,worldY:3218,modifierFlags:0,run:false}]);
  s.step();
  assert.deepEqual([s.f.p.getLocation().getX(),s.f.p.getLocation().getY(),s.f.p.getLocation().getZ()],[3221,3218,0]);
  assert.equal(s.f.p.getMovementQueue().size(),0);
  s.noYield();
  s.observe(8);
  s.noYield();
  await s.start();
  s.observe(8);
  assert.deepEqual(s.gains,[25],'cancelled and restarted generations must not both award XP');
  assert.equal(s.total(s.ids.LOGS),1,'one restarted action must produce exactly one owned resource');
  assert.deepEqual(otherGains,[],'the untouched owned control actor must receive no XP');
  assert.equal(other.p.getInventory().getAmount(s.ids.LOGS)+other.p.getEquipment().getAmount(s.ids.LOGS),0);
  const foreign=core.World.getItems().filter(g=>!g.isPendingRemoval()&&g.getOwner()===other.p.getUsername()&&g.getItem().getId()===s.ids.LOGS);
  assert.equal(foreign.reduce((n,g)=>n+g.getItem().getAmount(),0),0,'no award may leak to the other actor');
  assert.equal(s.total(s.ids.BRONZE_AXE),1);
});

for (const [name, objectName, logName, tile] of [
  ['scrapey', 'SCRAPEY_TREE', 'SCRAPEY_TREE_LOGS', [3784, 2956]],
  ['jungle', 'JUNGLE_TREE_7', 'LOGS', [3778, 2953]],
]) {
  test(`Trouble Brewing ${name} uses the real timed, axe-gated Woodcutting action`, t => {
    const f = actor(t), Game = require('../plugins/minigames/troublebrewing/Game.TroubleBrewing');
    const Woodcutting = require('../plugins/skills/Woodcutting.plugin');
    const game = Game.startNew({red:[f.p], blue:[]});
    t.after(() => game.finish());
    core.RegionManager.loadMapFiles(...tile);
    f.p.setLocation(new core.Location(tile[0]-1,tile[1],0));
    f.p.getMovementQueue().reset();
    const tree = new core.GameObject(core.ObjectIdentifiers[objectName],new core.Location(...tile,0),10,0,null);
    core.ObjectManager.register(tree,true);
    t.after(() => core.ObjectManager.deregister(tree,true));
    const chop = () => PM.emitObjectInteraction({player:f.p,object:tree,objectId:tree.getId(),location:tree.getLocation(),clickType:1,option:'Cut-Down',handled:false});
    const xp=[], skills=f.p.getSkillManager(), add=skills.addExperiences.bind(skills);
    t.mock.method(skills,'addExperiences',(skill,amount) => {if(skill===core.Skill.WOODCUTTING)xp.push(amount);return add(skill,amount);});
    t.mock.method(Math,'random',() => {
      const stack=new Error().stack;
      return stack.includes('maybeDropBirdNest') || stack.includes('shouldDepleteTree') || stack.includes('skillingPet') ? 0.99 : 0;
    });
    for(let i=0;i<100;i++) chop();
    assert.equal(Woodcutting.isWoodcuttingActive(f.p),false,'no axe cannot start chopping');
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers[logName]),0);
    assert.equal(xp.length,0);
    f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_AXE),true);
    for(let i=0;i<100;i++) chop();
    assert.equal(Woodcutting.isWoodcuttingActive(f.p),true);
    assert.equal(xp.length,0,'clicks do not pay XP before a tick');
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers[logName]),0);
    for(let i=0;i<3;i++)core.TaskManager.process();
    assert.equal(xp.length,1,'only one roll has run');
    assert.equal(xp[0],25);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers[logName]),1);
    game.left(f.p);
    core.TaskManager.process();
    assert.equal(Woodcutting.isWoodcuttingActive(f.p),false,'leaving the game stops the active gathering session');
  });
}

test('Scrapey tree retains its original depletion and Wiki success chart', () => {
  const Woodcutting=require('../plugins/skills/Woodcutting.plugin');
  const tree=Woodcutting.TREES.find(tree=>tree.logId===core.ItemIdentifiers.SCRAPEY_TREE_LOGS);
  assert.equal(tree.respawnTicks,24);
  assert.equal(tree.depleteChance,8);
  assert.equal(tree.despawnTicks,undefined,'Forestry timers do not apply');
  assert.equal(Woodcutting.calculateCutChance(1,tree,{tier:0}),23/256);
  assert.equal(Woodcutting.calculateCutChance(99,tree,{tier:0}),75/256);
  assert.equal(Woodcutting.calculateCutChance(50,tree,{tier:0}),49/256);
});


// Native ordinary-axe ration controls. The tree is cache-defined but placed at
// a fixture coordinate; it is not evidence of a natural map spawn.
for (const [rowIndex,row] of [
  {name:'zero energy restores a fixed twenty points',energy:0,rations:2,roll:0.1,restore:true},
  {name:'low energy restores twenty points',energy:5000,rations:2,roll:0.1,restore:true},
  {name:'8999 units is eligible and capped',energy:8999,rations:2,roll:0.1,restore:true},
  {name:'9000 units is not eligible',energy:9000,rations:2,roll:0.1,restore:false},
  {name:'the 0.30 boundary misses',energy:5000,rations:2,roll:0.3,restore:false},
  {name:'no ration leaves energy unchanged apart from recovery',energy:5000,rations:0,roll:0.1,restore:false},
  {name:'carried Forestry kit supplies a ration',energy:5000,rations:2,roll:0.1,restore:true,kit:'carried'},
  {name:'worn Forestry kit supplies a ration',energy:5000,rations:2,roll:0.1,restore:true,kit:'worn'},
  {name:'failed chop does not consume a ration',energy:5000,rations:2,roll:0.1,restore:false,chopMiss:true},
  {name:'existing felling ration path is preserved',energy:0,rations:2,roll:0.1,restore:false,felling:true},
  {name:'league bare hands do not count as a held axe',energy:0,rations:2,roll:0.1,restore:false,bare:true},
].entries()) {
  test('native ordinary axe ration energy: '+row.name, async t => {
    const I=core.ItemIdentifiers, World=core.World, priorRandom=Math.random;
    const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const player=new Player(new PlayerSession(channel));
    player.setUsername('frenergy'+next++); player.setAttribute('bot-skip-persistence',true);
    // Keep each case away from earlier tests' pending respawns and from other
    // ration cases while staying within the already loaded map region.
    const treeX=3231+rowIndex*2, treeY=3218;
    player.setLocation(new core.Location(treeX-1,treeY,0));
    const client=new ClientConnection(channel); client.player=player;
    const createdTasks=new Set(), submit=core.TaskManager.submit;
    core.TaskManager.submit=function(...args){if(args[0])createdTasks.add(args[0]);return submit.apply(this,args);};
    let tree=null,replaced=[], observing=true;
    const groundBefore=new Set(World.getItems());
    const errors=[], oldError=console.error;
    console.error=function(...args){errors.push(args.map(String).join(' '));return oldError.apply(this,args);};
    t.after(()=>{
      Math.random=priorRandom; observing=false; console.error=oldError;
      try {
        const respawns=[];
        if(tree){
          for(const task of createdTasks){
            if(task.originalTreeObject!==tree) continue;
            respawns.push(task); task.stop(); if(task.stumpObject) core.ObjectManager.deregister(task.stumpObject,true);
          }
          core.ObjectManager.deregister(tree,true);
          for(const previous of replaced) core.ObjectManager.register(previous,true);
        }
        for(const ground of [...World.getItems()]) if(!groundBefore.has(ground)&&ground.getOwner()===player.getUsername()) core.ItemOnGroundManager.deregister(ground);
        core.ItemOnGroundManager.process();
        PM.emitPlayerLogout({player,username:player.getUsername()});
        core.TaskManager.cancelTasks(player.getIndex()); core.TaskManager.cancelTasks(player);
        if(player.isRegistered()) World.getPlayers().removes(player);
        for(const task of respawns) assert.equal(task.isRunning(),false,'fixture tree respawn stopped');
        for(const previous of replaced) assert.ok(core.ObjectManager.objectsAt(previous.getLocation()).includes(previous) || core.MapObjects.get(previous.getId(),previous.getLocation(),previous.getPrivateArea())===previous,'replaced scene object restored');
        assert.equal(World.getItems().some(g=>!groundBefore.has(g)&&g.getOwner()===player.getUsername()),false,'fixture ground items removed');
      } finally {core.TaskManager.submit=submit;}
    });
    assert.equal(World.getPlayers().add(player),true); player.needsPlacement=false;
    assert.equal(core.WorldDefinition.isMembersWorld(),true,'control: rations operate on a members world');
    const inventory=player.getInventory(), axeId=row.bare?null:row.felling?I.BRONZE_FELLING_AXE:I.BRONZE_AXE;
    if(!row.bare && !row.felling) assert.equal(core.ItemDefinition.forId(axeId).isDoubleHanded(),false,'control: selected physical axe is one-handed');
    if(row.bare){
      player.setProfile('league'); player.setAttribute('league:type',6);
      const unlock=require('../plugins/modes/leaguerelics/Unlock.LeagueRelics');
      assert.equal(unlock.unlock(player,0,2,{bankOpen:true}),true,'actual tier-one relic producer grants Barbarian Gathering');
      const tools={player,axes:require('../plugins/skills/Woodcutting.plugin').AXES,axe:null};
      PM.emitCustomEvent('woodcutting:tool',tools); assert.equal(tools.axe?.id,null,'actual relic produces bare hands');
    } else inventory.add(new core.Item(axeId),true);
    if(row.rations) inventory.add(new core.Item(I.FORESTERS_RATION,row.rations),true);
    let kit=null;
    if(row.kit){
      kit=new core.Item(I.FORESTRY_KIT); inventory.add(kit,true);
      const fill=core.CacheDefinitions.getItem(kit.getId()).inventoryActions.findIndex(a=>a==='Fill');
      assert.ok(fill>=0);
      await client.dispatch([{type:'inventory_action',slot:inventory.getSlotForItemId(kit.getId()),itemId:kit.getId(),widgetId:149<<16,option:'Fill',optionIndex:fill+1}]);
      client.processTurnPackets(); World.process();
      assert.equal(inventory.getAmount(I.FORESTERS_RATION),0,'actual Fill stores ration');
      if(row.kit==='worn'){inventory.deleteNumber(kit.getId(),1);player.getEquipment().setItem(core.Equipment.CAPE_SLOT,kit);}
    }
    const rationCount=()=>{
      if(!kit)return inventory.getAmount(I.FORESTERS_RATION);
      const request={player,item:kit,contents:[],handled:false};PM.emitCustomEvent('storage:contents',request);
      assert.equal(request.handled,true);return request.contents.find(x=>x.id===I.FORESTERS_RATION)?.amount??0;
    };
    assert.equal(rationCount(),row.rations);
    const location=new core.Location(treeX,treeY,0);
    tree=new core.GameObject(core.ObjectIdentifiers.TREE,location,10,0,null);
    replaced=core.ObjectManager.objectsAt(location).filter(o=>o.getType()===tree.getType()&&o.getPrivateArea()===tree.getPrivateArea()&&o.getOwner()===tree.getOwner());
    core.ObjectManager.register(tree,true);
    const xp=player.getSkillManager().getExperience(core.Skill.WOODCUTTING);
    const successes=[], phases=[];const observer=PM.createApi('ForesterEnergyObserve'+player.getIndex());
    const sender=player.getPacketSender(), sendEnergy=sender.sendRunEnergy.bind(sender);let energyPackets=0;
    t.mock.method(sender,'sendRunEnergy',(...args)=>{energyPackets++;return sendEnergy(...args);});
    // Real attempt is after the success roll and before the ration consumer.
    // Seed energy at that actual phase so queued ticks cannot cross 90% first.
    observer.onCustomEvent('woodcutting:attempt',e=>{if(observing&&e.player===player){player.setRunEnergyUnits(row.energy);phases.push({energy:player.getRunEnergyUnits(),packets:energyPackets,success:e.success,object:e.object});}});
    observer.onCustomEvent('woodcutting:success',e=>{if(observing&&e.player===player)successes.push({axeId:e.axeId,energy:player.getRunEnergyUnits(),packets:energyPackets});});
    Math.random=()=>{
      const caller=(new Error().stack.split('\n')[2]??'');
      if(caller.includes('rollLog')&&caller.includes('Woodcutting.plugin'))return row.chopMiss?0.999999:0.01;
      if(caller.includes('maybeDropBirdNest')&&caller.includes('Woodcutting.plugin'))return 0.99;
      if(caller.includes('rollForesterRationEnergy')&&caller.includes('Woodcutting.plugin'))return row.roll;
      if(caller.includes('fellingChop')&&caller.includes('Woodcutting.plugin'))return 0.5;
      return priorRandom();
    };
    await client.dispatch([{type:'object_option',id:tree.getId(),x:treeX,y:treeY,action:'Chop down'}]); client.processTurnPackets();
    let energyAfter=null, natural=0;
    const {MovementQueue}=require('../dist/game/model/movement/MovementQueue');
    for(let i=0;i<20;i++){
      natural=MovementQueue.runEnergyRestoreUnits(player);
      World.process();
      if(successes.length || (row.chopMiss && phases.length)){energyAfter=player.getRunEnergyUnits();break;}
    }
    assert.equal(errors.length,0,'real World/task/plugin execution reports no error');
    if(row.chopMiss){
      assert.equal(successes.length,0,'failed rolls do not report a successful chop');
      assert.equal(phases.length,1); assert.equal(phases[0].object,tree,'the actual attempt uses the fixture tree'); assert.equal(phases[0].success,false); assert.equal(phases[0].energy,row.energy);
      assert.equal(inventory.getAmount(I.LOGS),0); assert.equal(player.getSkillManager().getExperience(core.Skill.WOODCUTTING),xp);
      assert.equal(energyAfter,Math.min(10000,row.energy+natural),'failed chop retains only ordinary recovery');
      assert.equal(rationCount(),row.rations); return;
    }
    assert.equal(successes.length,1,'control: registered action completed exactly one successful chop');
    assert.equal(successes[0].axeId,axeId,'control: the actual selected physical axe is correct');
    assert.equal(inventory.getAmount(I.LOGS),1,'control: genuine log landed');
    assert.ok(player.getSkillManager().getExperience(core.Skill.WOODCUTTING)>xp,'control: genuine Woodcutting XP');
    assert.equal(phases.length,1); assert.equal(phases[0].object,tree,'the actual attempt uses the fixture tree'); assert.equal(phases[0].success,true); assert.equal(phases[0].energy,row.energy,'the real successful-attempt phase had the requested energy');
    const expectedAtSuccess=Math.min(10000,row.energy+(row.restore?2000:0));
    assert.equal(successes[0].energy,expectedAtSuccess,'a ration proc changes actual energy by twenty points');
    if(row.restore) assert.ok(successes[0].packets>phases[0].packets,'a ration proc sends the real energy packet before the next player phase');
    assert.equal(energyAfter,Math.min(10000,expectedAtSuccess+natural),'the real player phase still applies natural recovery');
    assert.equal(rationCount(),row.rations-(row.felling?1:row.restore?1:0),'actual ration consumption matches the scoped action');
  });
}


// Search uses decoded inventory input. Only the actual seed-roll frame is fixed;
// the original RNG is restored before any global task pass.
test('native seed nests conserve their rolled contents at stack capacity', async t => {
  const I = core.ItemIdentifiers, MAX = 0x7fffffff;
  assert.equal(I.ACORN, 5312);
  assert.equal(I.BIRD_NEST_10, 22798);
  assert.equal(I.BIRD_NEST_4, 5073);
  assert.equal(I.BIRD_NEST_6, 5075);
  assert.equal(core.ItemDefinition.forId(I.ACORN).isStackable(), true);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);

  const cases = [
    { name: 'room', nest: I.BIRD_NEST_10, acorns: 50 },
    { name: 'last stack space', nest: I.BIRD_NEST_10, acorns: MAX - 1 },
    { name: 'capped current nest', nest: I.BIRD_NEST_10, acorns: MAX - 1, pickup: true },
    { name: 'capped legacy nest', nest: I.BIRD_NEST_4, acorns: MAX - 1, pickup: true },
    { name: 'full pack refusal', nest: I.BIRD_NEST_10, acorns: 50, full: true },
  ];
  for (const row of cases) await t.test(row.name, async t => {
    const f = actor(t), player = f.p, inventory = player.getInventory();
    player.setAttribute('bot-skip-persistence', true);
    inventory.setItem(0, new core.Item(I.ACORN, row.acorns));
    inventory.setItem(1, new core.Item(row.nest));
    if (row.full) while (inventory.getFreeSlots() > 0) inventory.add(new core.Item(I.RAKE), false);
    inventory.refreshItems();

    const ground = id => core.World.getItems().filter(value =>
      !value.isPendingRemoval() && value.getOwner() === player.getUsername() &&
      value.getPrivateArea() === player.getPrivateArea() && value.getItem().getId() === id);
    const stores = id => ({
      inventory: inventory.getAmount(id),
      equipment: player.getEquipment().getAmount(id),
      bank: player.getBanks().reduce((sum, tab, index) => sum +
        (tab && index !== core.Bank.BANK_SEARCH_TAB_INDEX ? tab.getAmount(id) : 0), 0),
      floor: ground(id).reduce((sum, value) => sum + value.getItem().getAmount(), 0),
    });
    const owned = id => Object.values(stores(id)).reduce((sum, amount) => sum + amount, 0);
    t.after(() => {
      for (const value of [...core.World.getItems()]) {
        if (value.getOwner() === player.getUsername()) core.ItemOnGroundManager.deregister(value);
      }
    });

    const skills = player.getSkillManager(), gains = [];
    const xp = () => core.Skill.values().map(skill => skills.getExperience(skill));
    const addExperience = skills.addExperience.bind(skills);
    t.mock.method(skills, 'addExperience', (...args) => {
      gains.push(args[1]);
      return addExperience(...args);
    });
    if (row.pickup) {
      const at = player.getLocation();
      core.ItemOnGroundManager.registerLocation(player, new core.Item(I.ACORN), at.clone());
      assert.equal(ground(I.ACORN).reduce((sum, value) => sum + value.getItem().getAmount(), 0), 1);
      assert.equal(player.getLastItemPickup().elapsedTime(300), true, 'the real first-pickup cooldown permits Take');
      await f.c.dispatch([{
        type: 'ground_item_action', itemId: I.ACORN,
        x: at.getX(), y: at.getY(), option: 'Take', optionIndex: 3,
      }]);
      f.c.processTurnPackets();
      assert.equal(inventory.getAmount(I.ACORN), MAX, 'native Take fills the ordinary seed stack');
      assert.equal(ground(I.ACORN).length, 0, 'no pickup remainder can hide missing output');
    }

    const options = core.CacheDefinitions.getItem(row.nest).inventoryActions;
    const searchIndex = options.findIndex(option => option?.toLowerCase() === 'search');
    assert.equal(searchIndex, 0, 'the actual nest exposes Search as its first action');
    const slot = inventory.getSlotForItemId(row.nest), clicked = inventory.getItems()[slot];
    assert.equal(clicked.getId(), row.nest);
    assert.equal(clicked.getAmount(), 1);
    assert.equal(inventory.getAddableAmount(new core.Item(I.ACORN)), row.pickup ? 0 : 1);
    assert.equal(inventory.getFreeSlots(), row.full ? 0 : 26);
    assert.deepEqual(gains, []);
    const initialXp = xp();
    const entitlement = owned(I.ACORN) + owned(row.nest);
    const containers = owned(I.BIRD_NEST_6) + owned(row.nest);
    const actions = [], emitItemAction = PM.emitItemAction.bind(PM);
    t.mock.method(PM, 'emitItemAction', event => {
      const result = emitItemAction(event);
      if (event.player === player && event.itemId === row.nest) actions.push({
        slot: event.slot, first: event.clickType === 1,
        selected: event.item === clicked, handled: event.handled, result,
      });
      return result;
    });

    await f.c.dispatch([{
      type: 'inventory_action', slot, itemId: row.nest,
      widgetId: 149 << 16, option: 'Search', optionIndex: searchIndex + 1,
    }]);
    let seedDraws = 0;
    const originalRandom = Math.random;
    Math.random = () => {
      if (new Error().stack.includes('rollNestSeed')) {
        seedDraws++;
        return 0; // A legal draw selecting the table's first entry, one Acorn.
      }
      return originalRandom();
    };
    try { f.c.processTurnPackets(); } finally { Math.random = originalRandom; }
    assert.deepEqual(actions, [{ slot, first: true, selected: true, handled: true, result: true }],
      'the decoded cached action must reach the real selected-item consumer');
    const consumed = inventory.getAmount(row.nest) === 0;
    if (consumed) assert.equal(seedDraws, 1, 'a consumed nest must have used the actual controlled seed roll');
    else assert.ok(seedDraws <= 1, 'a valid capacity refusal need not draw a seed');
    const observation = JSON.stringify({
      mode: row.name, acorns: stores(I.ACORN), nests: owned(row.nest),
      emptyNests: owned(I.BIRD_NEST_6), seedDraws, free: inventory.getFreeSlots(), gains,
    });
    assert.equal(owned(I.ACORN) + owned(row.nest), entitlement,
      'the selected seed or its unsearched nest remains owned: ' + observation);
    assert.equal(owned(I.BIRD_NEST_6) + owned(row.nest), containers,
      'every consumed nest leaves its empty container');
    if (!row.pickup && !row.full) {
      assert.equal(consumed, true, 'room and exact-space controls must really search');
      assert.equal(inventory.getAmount(I.ACORN), row.acorns + 1);
      assert.equal(owned(I.BIRD_NEST_6), 1);
    }
    if (row.full) {
      assert.equal(consumed, false, 'the existing full-pack refusal preserves the nest');
      assert.equal(seedDraws, 0);
      assert.equal(owned(I.BIRD_NEST_6), 0);
    }
    assert.deepEqual(gains, [], 'Search awards no XP');
    assert.deepEqual(xp(), initialXp, 'stored skill XP is unchanged');
  });
});
