const assert = require('node:assert/strict'), path=require('node:path');
const {before,after,test}=require('node:test');
const root=path.resolve(__dirname,'..');
require(root+'/dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require(root+'/dist/game/cache/CachePipeline');
const {PluginManager:PM}=require(root+'/dist/plugins/PluginManager');
const {Player}=require(root+'/dist/game/entity/impl/player/Player');
const {PlayerSession}=require(root+'/dist/net/PlayerSession');
const {ClientConnection}=require(root+'/dist/net/NetworkBuilder');
let core,House,MaxHouse,Data,next=1650;
before(async()=>{await CachePipeline.initialize(root);PM.loadFromDirectory(root+'/plugins');core=PM.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(3222,3218);PM.emitServerStartup({});House=require(root+'/plugins/skills/construction/House.Construction');MaxHouse=require(root+'/plugins/skills/construction/MaxHouse.Construction');Data=require(root+'/plugins/skills/construction/Data.Construction');});
after(()=>PM.emitServerShutdown({}));
function actor(t){const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};const p=new Player(new PlayerSession(channel));p.setIndex(next++);p.setUsername('menagpick'+next);p.setRegistered(true);p.setLocation(new core.Location(3222,3218,0));p.needsPlacement=false;const c=new ClientConnection(channel);c.player=p;const varbits=[];const sender=p.getPacketSender(),original=sender.sendVarbit.bind(sender);t.mock.method(sender,'sendVarbit',(id,value)=>{varbits.push([id,value]);return original(id,value)});p._reviewVarbits=varbits;const msgs=[];t.mock.method(p.getPacketSender(),'sendMessage',m=>{msgs.push(m);return p.getPacketSender()});p._reviewMessages=msgs;t.after(()=>{House.releaseHouse(p,true);PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());for(const n of [...core.World.getNpcs()])if(n?.getOwner?.()===p)core.World.getNpcs().remove(n);});return{p,c};}
async function send(f,packet){await f.c.dispatch([packet]);f.c.processTurnPackets();for(let i=0;i<15;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}}
async function store(t,obj,bankAway=false,pinBefore=false){const f=actor(t);MaxHouse.maxHouse({player:f.p});House.enterHouse(f.p,false);const h=House.houseFor(f.p);assert.ok(h);const e=h.furnitureEntries().find(e=>e.room.roomKey==='MENAGERIE_INDOORS'&&/HOUSE$/.test(e.furniture.buildableKey));assert.ok(e);const id=Data.BUILDABLE_BY_KEY.get(e.furniture.buildableKey).objectIds[0],object=h.furnitureObjects.find(o=>o.getId()===id&&o.getLocation().equals(e.location));assert.ok(object);f.p.setLocation(e.location.clone().add(bankAway?-2:-1,0));f.p.needsPlacement=false;const itemId=core.CacheDefinitions.getObjId(obj);f.p.getInventory().add(new core.Item(itemId),true);if(pinBefore){const pin=require(root+'/plugins/interface/bankpin/Common.BankPin');f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,'1234'))}const packet={type:'item_on_object',objectId:id,x:e.location.getX(),y:e.location.getY(),itemId,slot:f.p.getInventory().getSlotForItemId(itemId),widgetId:149<<16};if(bankAway){await f.c.dispatch([packet]);f.c.processTurnPackets();f.p.getBank(0).open();core.Bank.deposit(f.p,itemId,f.p.getInventory().getSlotForItemId(itemId),1,false);assert.equal(f.p.getBank(0).getAmount(itemId),1);f.p.getPacketSender().sendInterfaceRemoval();for(let i=0;i<15;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}}else await send(f,packet);console.log(JSON.stringify({obj,at:f.p.getLocation(),privateMatch:f.p.getPrivateArea()===h,placed:f.p.isNeedsPlacement(),busy:f.p.busy(),messages:f.p._reviewMessages,stored:f.p.getAttribute('construction:menagerie')}));return{...f,h,itemId,object};}

// rsprox captures 2779-2784 (rev 229): Pick-up on a roaming menagerie pet removes the NPC,
// gives the pet item and clears its menagerie varbit on the tick the owner reaches it.
const Ids=()=>require(root+'/plugins/skills/construction/Ids.Construction');
function slotOf(obj){const id=core.CacheDefinitions.getObjId(obj);return [...core.CacheDefinitions.getEnumValues(985)].find(([,v])=>v===id)[0]}
async function storeMore(f,obj){const itemId=core.CacheDefinitions.getObjId(obj);f.p.getInventory().add(new core.Item(itemId),true);await send(f,{type:'item_on_object',objectId:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),itemId,slot:f.p.getInventory().getSlotForItemId(itemId),widgetId:149<<16});assert.equal(f.p.getInventory().getAmount(itemId),0);return itemId}
function petNpcs(f){return f.h.getNpcs().filter(n=>n.isRegistered()&&(n.getCurrentDefinition?.(f.p)??n.getDefinition?.())?.getActions?.()?.includes('Pick-up'))}
async function pickUp(f,npc){const actions=(npc.getCurrentDefinition?.(f.p)??npc.getDefinition()).getActions();await send(f,{type:'npc_option',index:npc.getIndex(),clickType:actions.indexOf('Pick-up')+1})}

test('Pick-up on a roaming pet takes it back and leaves the other pets where they roam',async t=>{
  const f=await store(t,'supremepet'),other=await storeMore(f,'zamorakpet');
  const pets=petNpcs(f);assert.equal(pets.length,2);
  const target=pets.find(n=>n.getId()!==core.CacheDefinitions.getNpcId('poh_zamorak_pet')&&n.getId()!==core.CacheDefinitions.getNpcId('zamorak_pet'));assert.ok(target,'supreme roams');
  const stay=pets.find(n=>n!==target);
  const configs=[],sender=f.p.getPacketSender(),original=sender.sendConfig.bind(sender);
  t.mock.method(sender,'sendConfig',(id,value)=>{configs.push([id,value]);return original(id,value)});
  await pickUp(f,target);
  assert.equal(f.p.getInventory().getAmount(f.itemId),1);
  assert.deepEqual(f.p.getAttribute('construction:menagerie'),[slotOf('zamorakpet')]);
  assert.equal(target.isRegistered(),false);
  assert.equal(stay.isRegistered(),true,'the other pet is not respawned');
  assert.deepEqual(petNpcs(f),[stay]);
  // The pet's bit of the first stored-pets varp (gameval prayer20) clears; the other's stays.
  const varp=Ids().varp('prayer20'),last=configs.filter(([id])=>id===varp).at(-1);
  assert.ok(last,'stored varp resent');
  assert.equal(last[1]&(1<<slotOf('supremepet')),0);
  assert.notEqual(last[1]&(1<<slotOf('zamorakpet')),0);
  // A second click on the queued NPC cannot mint another copy.
  await pickUp(f,target);
  assert.equal(f.p.getInventory().getAmount(f.itemId),1);
  assert.equal(f.p.getInventory().getAmount(other),0);
});

test('Pick-up with a full backpack leaves the pet stored and roaming',async t=>{
  const f=await store(t,'supremepet');const [npc]=petNpcs(f);assert.ok(npc);
  while(f.p.getInventory().getFreeSlots())f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);
  await pickUp(f,npc);
  assert.equal(f.p.getInventory().getAmount(f.itemId),0);
  assert.deepEqual(f.p.getAttribute('construction:menagerie'),[slotOf('supremepet')]);
  assert.equal(npc.isRegistered(),true);
  assert.ok(f.p._reviewMessages.includes("You don't have enough inventory space."));
});

test('Pick-up through a bank PIN resumes once after the PIN',async t=>{
  const f=await store(t,'supremepet');const [npc]=petNpcs(f);
  const pin=require(root+'/plugins/interface/bankpin/Common.BankPin');f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,'1234'));
  await pickUp(f,npc);
  assert.equal(f.p.getInventory().getAmount(f.itemId),0);
  await send(f,{type:'dialogue_amount',amount:1234});
  assert.equal(f.p.getInventory().getAmount(f.itemId),1);
  assert.deepEqual(f.p.getAttribute('construction:menagerie'),[]);
  assert.equal(npc.isRegistered(),false);
});
