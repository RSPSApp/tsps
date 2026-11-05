const assert = require('node:assert/strict'), path=require('node:path');
const {before,after,test}=require('node:test');
const root=path.resolve(__dirname,'..');
require(root+'/dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require(root+'/dist/game/cache/CachePipeline');
const {PluginManager:PM}=require(root+'/dist/plugins/PluginManager');
const {Player}=require(root+'/dist/game/entity/impl/player/Player');
const {PlayerSession}=require(root+'/dist/net/PlayerSession');
const {ClientConnection}=require(root+'/dist/net/NetworkBuilder');
let core,House,MaxHouse,Data,next=1450;
before(async()=>{await CachePipeline.initialize(root);PM.loadFromDirectory(root+'/plugins');core=PM.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(3222,3218);PM.emitServerStartup({});House=require(root+'/plugins/skills/construction/House.Construction');MaxHouse=require(root+'/plugins/skills/construction/MaxHouse.Construction');Data=require(root+'/plugins/skills/construction/Data.Construction');});
after(()=>PM.emitServerShutdown({}));
function actor(t){const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};const p=new Player(new PlayerSession(channel));p.setIndex(next++);p.setUsername('olmreview'+next);p.setRegistered(true);p.setLocation(new core.Location(3222,3218,0));p.needsPlacement=false;const c=new ClientConnection(channel);c.player=p;const varbits=[];const sender=p.getPacketSender(),original=sender.sendVarbit.bind(sender);t.mock.method(sender,'sendVarbit',(id,value)=>{varbits.push([id,value]);return original(id,value)});p._reviewVarbits=varbits;const msgs=[];t.mock.method(p.getPacketSender(),'sendMessage',m=>{msgs.push(m);return p.getPacketSender()});p._reviewMessages=msgs;t.after(()=>{House.releaseHouse(p,true);PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());for(const n of [...core.World.getNpcs()])if(n?.getOwner?.()===p)core.World.getNpcs().remove(n);});return{p,c};}
async function send(f,packet){await f.c.dispatch([packet]);f.c.processTurnPackets();for(let i=0;i<15;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}}
async function store(t,obj,bankAway=false,pinBefore=false){const f=actor(t);MaxHouse.maxHouse({player:f.p});House.enterHouse(f.p,false);const h=House.houseFor(f.p);assert.ok(h);const e=h.furnitureEntries().find(e=>e.room.roomKey==='MENAGERIE_INDOORS'&&/HOUSE$/.test(e.furniture.buildableKey));assert.ok(e);const id=Data.BUILDABLE_BY_KEY.get(e.furniture.buildableKey).objectIds[0],object=h.furnitureObjects.find(o=>o.getId()===id&&o.getLocation().equals(e.location));assert.ok(object);f.p.setLocation(e.location.clone().add(bankAway?-2:-1,0));f.p.needsPlacement=false;const itemId=core.CacheDefinitions.getObjId(obj);f.p.getInventory().add(new core.Item(itemId),true);if(pinBefore){const pin=require(root+'/plugins/interface/bankpin/Common.BankPin');f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,'1234'))}const packet={type:'item_on_object',objectId:id,x:e.location.getX(),y:e.location.getY(),itemId,slot:f.p.getInventory().getSlotForItemId(itemId),widgetId:149<<16};if(bankAway){await f.c.dispatch([packet]);f.c.processTurnPackets();f.p.getBank(0).open();core.Bank.deposit(f.p,itemId,f.p.getInventory().getSlotForItemId(itemId),1,false);assert.equal(f.p.getBank(0).getAmount(itemId),1);f.p.getPacketSender().sendInterfaceRemoval();for(let i=0;i<15;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}}else await send(f,packet);console.log(JSON.stringify({obj,at:f.p.getLocation(),privateMatch:f.p.getPrivateArea()===h,placed:f.p.isNeedsPlacement(),busy:f.p.busy(),messages:f.p._reviewMessages,stored:f.p.getAttribute('construction:menagerie')}));return{...f,h,itemId,object};}
test('native base Olmlet store reaches the real menagerie',async t=>{const f=await store(t,'olmpet');assert.equal(f.p.getInventory().getAmount(f.itemId),0);assert.ok((f.p.getAttribute('construction:menagerie')??[]).length);});
test('native alternate Olmlet store retains the form through menu withdrawal',async t=>{const f=await store(t,'dogadilepet');assert.equal(f.p.getInventory().getAmount(f.itemId),0);const enumValues=core.CacheDefinitions.getEnumValues(985),slot=[...enumValues].find(([,id])=>id===core.ItemIdentifiers.OLMLET)[0];assert.ok((f.p.getAttribute('construction:menagerie')??[]).includes(slot));assert.ok(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('dogadile_pet')));assert.ok(f.p._reviewVarbits.some(([id,value])=>id===core.CacheDefinitions.getVarbitId('poh_menagerie_multiform_olmpet')&&value===4));await send(f,{type:'object_option',id:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),action:'View'});assert.equal(f.p.getInterfaceId(),211);await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});assert.equal(f.p.getInventory().getAmount(f.itemId),1);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.OLMLET),0);});

test('queued native item-on-house cannot store a pet moved through real Bank deposit',async t=>{const f=await store(t,'dogadilepet',true);assert.equal(f.p.getBank(0).getAmount(f.itemId),1);assert.deepEqual(f.p.getAttribute('construction:menagerie')??[],[]);assert.equal(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('dogadile_pet')),false)});

function olmSlot(){return [...core.CacheDefinitions.getEnumValues(985)].find(([,id])=>id===core.ItemIdentifiers.OLMLET)[0]}
async function view(f){await send(f,{type:'object_option',id:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),action:'View'});assert.equal(f.p.getInterfaceId(),211)}
async function withdraw(f){await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot:olmSlot(),buttonNum:1})}

test('native View grants Take and Examine on the actual cache-created child slot',async t=>{
  const f=await store(t,'vespulaflyingpet'),flags=[],sender=f.p.getPacketSender(),original=sender.sendInterfaceFlagsRange.bind(sender);
  t.mock.method(sender,'sendInterfaceFlagsRange',(...args)=>{flags.push(args);return original(...args);});
  await view(f);
  assert.ok(flags.some(([uid,start,end,mask])=>uid===((211<<16)|7)&&start<=olmSlot()&&end>=olmSlot()&&(mask&(1<<1))&&(mask&(1<<10))));
});

for (const [obj,npc,form] of [['tektonenragedpet','tekton_enraged_pet',6],['vespulaflyingpet','vespula_flying_pet',7]]) {
  test(`real ${obj} storage retains the icon, roaming form and item through full inventory and save/load`,async t=>{
    const f=await store(t,obj),id=core.CacheDefinitions.getNpcId(npc);
    assert.ok(f.h.getNpcs().some(n=>n.getId()===id));
    assert.ok(f.p._reviewVarbits.some(([key,value])=>key===core.CacheDefinitions.getVarbitId('poh_menagerie_multiform_olmpet')&&value===form));
    while(f.p.getInventory().getFreeSlots())f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);
    await view(f);await withdraw(f);assert.equal(f.p.getInventory().getAmount(f.itemId),0);assert.deepEqual(f.p.getAttribute('construction:menagerie'),[olmSlot()]);
    f.p.getInventory().deleteAtSlot(27);await withdraw(f);await withdraw(f);assert.equal(f.p.getInventory().getAmount(f.itemId),1);
    f.p.getPacketSender().sendInterfaceRemoval();
    await send(f,{type:'item_on_object',objectId:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),itemId:f.itemId,slot:27,widgetId:149<<16});
    assert.equal(f.p.getInventory().getAmount(f.itemId),0);
    House.releaseHouse(f.p,true);
    const g=actor(t),{PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
    PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);House.enterHouse(g.p,false);
    assert.ok(House.houseFor(g.p).getNpcs().some(n=>n.getId()===id));
    const held={player:g.p,itemId:f.itemId,held:false};PM.emitCustomEvent('pets:held-elsewhere',held);assert.equal(held.held,true);
  });
}
test('real PIN native storage resumes with the same physical item',async t=>{const f=await store(t,'vespulaflyingpet',false,true);assert.equal(f.p.getInventory().getAmount(f.itemId),1);assert.deepEqual(f.p.getAttribute('construction:menagerie')??[],[]);await send(f,{type:'dialogue_amount',amount:1234});assert.equal(f.p.getInventory().getAmount(f.itemId),0);assert.deepEqual(f.p.getAttribute('construction:menagerie'),[olmSlot()])});
test('real PIN withdrawal resumes exactly once and retains Flying Vespina',async t=>{const f=await store(t,'vespulaflyingpet');await view(f);const pin=require(root+'/plugins/interface/bankpin/Common.BankPin');f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,'1234'));await withdraw(f);assert.equal(f.p.getInventory().getAmount(f.itemId),0);await send(f,{type:'dialogue_amount',amount:1234});assert.equal(f.p.getInventory().getAmount(f.itemId),1);await withdraw(f);assert.equal(f.p.getInventory().getAmount(f.itemId),1)});
test('closed native211 actions cannot withdraw the stored form',async t=>{const f=await store(t,'tektonenragedpet');await view(f);f.p.getPacketSender().sendInterfaceRemoval();await withdraw(f);assert.equal(f.p.getInventory().getAmount(f.itemId),0);assert.deepEqual(f.p.getAttribute('construction:menagerie'),[olmSlot()])});
test('real PIN delayed withdrawal cannot resume after leaving the house',async t=>{const f=await store(t,'tektonenragedpet');await view(f);const pin=require(root+'/plugins/interface/bankpin/Common.BankPin');f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,'1234'));await withdraw(f);assert.equal(f.p.getInventory().getAmount(f.itemId),0);await f.c.dispatch([{type:'dialogue_amount',amount:1234}]);f.c.processTurnPackets();assert.equal(pin.isUnlocked(f.p),true);House.releaseHouse(f.p,true);for(let i=0;i<3;i++)core.TaskManager.process();assert.equal(f.p.getInventory().getAmount(f.itemId),0);assert.deepEqual(f.p.getAttribute('construction:menagerie'),[olmSlot()])});
test('real PIN delayed storage preserves an item legitimately banked after unlock',async t=>{const f=await store(t,'vespulaflyingpet',false,true),pin=require(root+'/plugins/interface/bankpin/Common.BankPin');await f.c.dispatch([{type:'dialogue_amount',amount:1234}]);f.c.processTurnPackets();assert.equal(pin.isUnlocked(f.p),true);f.p.getBank(0).open();core.Bank.deposit(f.p,f.itemId,f.p.getInventory().getSlotForItemId(f.itemId),1,false);f.p.getPacketSender().sendInterfaceRemoval();for(let i=0;i<3;i++)core.TaskManager.process();assert.equal(f.p.getBank(0).getAmount(f.itemId),1);assert.deepEqual(f.p.getAttribute('construction:menagerie')??[],[])});

for (const obj of ['smokepet','smokepet_old']) test('native menagerie storage/Take retains '+obj,async t=>{
  const f=await store(t,obj),base=core.CacheDefinitions.getObjId('smokepet');
  const slot=[...core.CacheDefinitions.getEnumValues(985)].find(([,id])=>id===base)[0];
  assert.equal(f.p.getInventory().getAmount(f.itemId),0);
  assert.deepEqual(f.p.getAttribute('construction:menagerie'),[slot]);
  await send(f,{type:'object_option',id:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),action:'View'});
  assert.equal(f.p.getInterfaceId(),211);
  await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});
  assert.equal(f.p.getInventory().getAmount(f.itemId),1);assert.deepEqual(f.p.getAttribute('construction:menagerie'),[]);
});

for (const obj of ['snakepet','snakepet_orange','snakepet_blue']) test('native menagerie storage/Take retains '+obj,async t=>{
  const f=await store(t,obj),base=core.CacheDefinitions.getObjId('snakepet');
  const slot=[...core.CacheDefinitions.getEnumValues(985)].find(([,id])=>id===base)[0];
  assert.equal(f.p.getInventory().getAmount(f.itemId),0);
  assert.deepEqual(f.p.getAttribute('construction:menagerie'),[slot]);
  await send(f,{type:'object_option',id:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),action:'View'});
  assert.equal(f.p.getInterfaceId(),211);
  await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});
  assert.equal(f.p.getInventory().getAmount(f.itemId),1);assert.deepEqual(f.p.getAttribute('construction:menagerie'),[]);
});

const followerHouseCases=[["WISP","whisperer_pet","poh_whisperer_pet"],["BUTCH","vardorvis_pet","poh_vardorvis_pet"],["BARON","duke_sucellus_pet","poh_duke_sucellus_pet"],["LILVIATHAN","leviathan_pet","poh_leviathan_pet"],["SCURRY","scurrius_pet","poh_scurrius_pet"],["NEXLING","nex_pet","poh_nex_pet"],["VORKI","vorkath_pet","poh_vorkath_pet"],["HERBI","herbiboar_pet","poh_herbiboar_pet"],["HELLPUPPY","hellpet","poh_hellpet"],["SKOTOS","skotizo_pet","poh_skotizo_pet"],["QUETZIN","quetzal_pet","poh_quetzal_pet"],["PET_PENANCE_QUEEN","penance_pet","poh_penance_pet"]];

for(const [key,world,house]of followerHouseCases)test('native '+key+' menagerie uses its house definition and Take keeps its item',async t=>{
 const id=core.ItemIdentifiers[key],f=await store(t,core.CacheDefinitions.getObjNames().get(id));assert.equal(f.p.getInventory().getAmount(id),0);const slot=[...core.CacheDefinitions.getEnumValues(985)].find(([,itemId])=>itemId===id)[0];assert.ok(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId(house)));await send(f,{type:'object_option',id:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),action:'View'});assert.equal(f.p.getInterfaceId(),211);await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});assert.equal(f.p.getInventory().getAmount(id),1);
});

test('base Rock Golem house storage uses the normal POH definition and native Take preserves base item',async t=>{const f=await store(t,'skillpetmining');assert.ok(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('poh_skillpet_mining_default')));assert.equal(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('skillpet_mining_default')),false);await view(f);const slot=[...core.CacheDefinitions.getEnumValues(985)].find(([,id])=>id===f.itemId)[0];await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});assert.equal(f.p.getInventory().getAmount(f.itemId),1);});

test('base Giant squirrel house storage uses the normal POH definition and native Take preserves base item',async t=>{const f=await store(t,'skillpetagility');assert.ok(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('poh_skillpet_agility')));assert.equal(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('skillpet_agility')),false);await view(f);const slot=[...core.CacheDefinitions.getEnumValues(985)].find(([,id])=>id===f.itemId)[0];await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});assert.equal(f.p.getInventory().getAmount(f.itemId),1);});

test('base Tangleroot house storage uses the normal POH definition and native Take preserves base item',async t=>{const f=await store(t,'skillpetfarming');assert.ok(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('poh_skillpet_farming')));assert.equal(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('skillpet_farming')),false);await view(f);const slot=[...core.CacheDefinitions.getEnumValues(985)].find(([,id])=>id===f.itemId)[0];await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});assert.equal(f.p.getInventory().getAmount(f.itemId),1);});

test('native Pet rock ground pickup credits only inside the owned non-building menagerie', async t => {
  const f = actor(t);
  MaxHouse.maxHouse({ player: f.p });
  House.enterHouse(f.p, false);
  const house = House.houseFor(f.p);
  const entry = house.furnitureEntries().find(e => e.room.roomKey === 'MENAGERIE_INDOORS');
  assert.ok(entry);
  f.p.setLocation(entry.location.clone());
  f.p.needsPlacement = false;
  f.p.setAttribute('quest.fremennik_trials.stage', 1);
  const task = 'pick-up-your-pet-rock-from-your-poh-menagerie';
  const credited = () => (f.p.getAttribute('achievement-diaries:tasks')?.fremennik ?? []).includes(task);
  const take = () => {
    const pile = core.ItemOnGroundManager.registers(f.p, new core.Item(core.ItemIdentifiers.PET_ROCK));
    core.ItemOnGroundManager.pickup(f.p, pile);
  };
  house.buildingMode = true;
  take();
  assert.equal(credited(), false);
  house.buildingMode = false;
  const room = house.getRoom(house.getRoomPositionAt(f.p.getLocation()));
  const roomKey = room.roomKey;
  room.roomKey = 'GARDEN';
  take();
  assert.equal(credited(), false);
  room.roomKey = roomKey;
  take();
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.PET_ROCK), 3);
  assert.equal(credited(), true);
});
