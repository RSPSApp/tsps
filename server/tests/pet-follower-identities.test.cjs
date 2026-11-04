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




const followerCases=[["WISP","whisperer_pet","poh_whisperer_pet"],["BUTCH","vardorvis_pet","poh_vardorvis_pet"],["BARON","duke_sucellus_pet","poh_duke_sucellus_pet"],["LILVIATHAN","leviathan_pet","poh_leviathan_pet"],["SCURRY","scurrius_pet","poh_scurrius_pet"],["NEXLING","nex_pet","poh_nex_pet"],["VORKI","vorkath_pet","poh_vorkath_pet"],["HERBI","herbiboar_pet","poh_herbiboar_pet"],["HELLPUPPY","hellpet","poh_hellpet"],["SKOTOS","skotizo_pet","poh_skotizo_pet"],["QUETZIN","quetzal_pet","poh_quetzal_pet"],["PET_PENANCE_QUEEN","penance_pet","poh_penance_pet"],["ORION","ocellus_pet","poh_ocellus_pet"],["ORION_3","ocellus_pet_variant_1","poh_ocellus_pet_variant_1"]];

for(const [key,world,house]of followerCases)test('native '+key+' Drop/Pick-up uses the world follower definition',async t=>{
 const f=actor(t),id=core.ItemIdentifiers[key];f.p.getInventory().add(new core.Item(id),true);const n=await drop(f,id);assert.ok(n?.isRegistered());assert.equal(n.getId(),npcId(world));assert.equal(n.getOwner(),f.p);await action(f,n,'Pick-up');await action(f,n,'Pick-up');assert.equal(f.p.getInventory().getAmount(id),1);assert.equal(f.p.getAttribute('pets:current'),null);
});
for(const [key,world,house]of followerCases)test('legacy '+key+' house variant restores only the matching world follower',async t=>{
 const f=actor(t),id=core.ItemIdentifiers[key];f.p.setAttribute('pets.owned',[id]);f.p.setAttribute('pets:active-item',id);f.p.setAttribute('pets:variant',{['item:'+id]:npcId(house)});const g=actor(t);PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});const n=g.p.getAttribute('pets:current');assert.equal(n?.getId(),npcId(world));assert.equal(g.p.getAttribute('pets:active-item'),id);assert.equal(g.p.getInventory().getAmount(id),0);await action(g,n,'Pick-up');assert.equal(g.p.getInventory().getAmount(id),1);
});

test('a foreign legacy house variant cannot change the insured pet family',async t=>{
 const f=actor(t),id=core.ItemIdentifiers.WISP;f.p.setAttribute('pets.owned',[id]);f.p.setAttribute('pets:active-item',id);f.p.setAttribute('pets:variant',{['item:'+id]:npcId('poh_vardorvis_pet')});PM.emitPlayerLogin({player:f.p,username:f.p.getUsername(),isNewAccount:false});assert.equal(f.p.getAttribute('pets:current')?.getId(),npcId('whisperer_pet'));assert.deepEqual(f.p.getAttribute('pets.owned'),[id]);
});
test('correct world follower refuses full/foreign pickup and survives a real Bank round trip',async t=>{
 const f=actor(t),other=actor(t),id=core.ItemIdentifiers.WISP;f.p.getInventory().add(new core.Item(id),true);const n=await drop(f,id);while(f.p.getInventory().getFreeSlots())f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);await action(f,n,'Pick-up');assert.equal(f.p.getAttribute('pets:current'),n);await action(other,n,'Pick-up');assert.equal(other.p.getInventory().getAmount(id),0);assert.equal(f.p.getAttribute('pets:current'),n);
 f.p.getBank(0).open();core.Bank.deposit(f.p,core.ItemIdentifiers.RAKE,27,1,false);f.p.getPacketSender().sendInterfaceRemoval();await action(f,n,'Pick-up');assert.equal(f.p.getInventory().getAmount(id),1);f.p.getBank(0).open();core.Bank.deposit(f.p,id,f.p.getInventory().getSlotForItemId(id),1,false);core.Bank.withdraw(f.p,id,f.p.getBank(0).getSlotForItemId(id),1,0);const returned=await drop(f,id);assert.equal(returned.getId(),npcId('whisperer_pet'));assert.equal(returned.getOwner(),f.p);
});
