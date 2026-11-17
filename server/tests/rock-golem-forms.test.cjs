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
  const p=new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('golemqa'+next); p.setRegistered(true); p.setLocation(new core.Location(3222,3218,0)); p.needsPlacement=false;
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




const oreCases = [
 ['tin','tin_ore'],['copper','copper_ore'],['iron','iron_ore'],['blurite','blurite_ore'],['silver','silver_ore'],['coal','coal'],['gold','gold_ore'],['mithril','mithril_ore'],['granite','enakh_granite_tiny'],['granite','enakh_granite_small'],['granite','enakh_granite_medium'],['adamantite','adamantite_ore'],['runite','runite_ore'],['amethyst','amethyst'],['lovakite','lovakite_ore'],['elemental','elemental_workshop_ore'],['daeyalt','sang_jas_ore'],['lead','lead_ore'],['rubium','rubium_splinters'],['nickel','nickel_ore']
];
const formItem = key => item(key==='normal'?'skillpetmining':'skillpetmining_'+key);
const formNpc = key => npcId('skillpet_mining_'+(key==='normal'?'default':key));
function give(f, slot, name, amount=1) {const id=item(name);assert.ok(Number.isInteger(id),name+' must exist in the active cache');f.p.getInventory().setItem(slot,new core.Item(id,amount));return id;}
async function useInventory(f, used, target){await send(f,{type:'inventory_use_on',slot:used,itemId:f.p.getInventory().get(used).getId(),target:{kind:'inventory',slot:target}});}
async function useFollower(f,slot,n){n.setLocation(new core.Location(3223,3218,0));await send(f,{type:'inventory_use_on',slot,itemId:f.p.getInventory().get(slot).getId(),target:{kind:'npc',id:n.getIndex()}});}
for(const [key,ore] of oreCases) test('native '+ore+' changes inventory golem to '+key+' and consumes one',async t=>{
 const f=actor(t);give(f,0,'skillpetmining');const id=give(f,1,ore);await useInventory(f,1,0);assert.equal(f.p.getInventory().get(0).getId(),formItem(key));assert.equal(f.p.getInventory().getAmount(id),0);assert.deepEqual(f.p.getAttribute('pets.owned'),[formItem(key)]);const n=await drop(f,formItem(key));assert.equal(n.getId(),formNpc(key));await action(f,n,'Pick-up');assert.equal(f.p.getInventory().getAmount(formItem(key)),1);
});
test('native own follower recolour, reverse inventory use, full pack and rock reset preserve one pet',async t=>{
 const f=actor(t),n=await summon(f);for(let slot=0;slot<28;slot++)give(f,slot,'coins');give(f,1,'iron_ore');await useFollower(f,1,n);assert.equal(n.getId(),formNpc('iron'));assert.equal(f.p.getAttribute('pets:active-item'),formItem('iron'));assert.equal(f.p.getInventory().getAmount(item('iron_ore')),0);await action(f,n,'Pick-up');const petSlot=f.p.getInventory().getSlotForItemId(formItem('iron'));give(f,27,'rock');await useInventory(f,petSlot,27);assert.equal(f.p.getInventory().get(petSlot).getId(),formItem('normal'));assert.equal(f.p.getInventory().getAmount(item('rock')),0);assert.deepEqual(f.p.getAttribute('pets.owned'),[formItem('normal')]);
});
test('physical golem item wins over another form preference and legacy variant during saved login',async t=>{
 const f=actor(t);give(f,0,'skillpetmining_iron');give(f,1,'skillpetmining_gold');f.p.setAttribute('pets.owned',[formItem('gold')]);f.p.setAttribute('pets:variant',{'skill:mining':formNpc('gold')});const n=await drop(f,formItem('iron'));assert.equal(n.getId(),formNpc('iron'));const save=PlayerSave.fromPlayer(f.p);PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);save.applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});assert.equal(g.p.getAttribute('pets:current')?.getId(),formNpc('iron'));assert.equal(g.p.getInventory().getAmount(formItem('gold')),1);await action(g,g.p.getAttribute('pets:current'),'Pick-up');assert.equal(g.p.getInventory().getAmount(formItem('iron')),1);
});
test('foreign follower, same form and noted ore cannot spend ore or recolour',async t=>{
 const f=actor(t),g=actor(t),n=await summon(g);give(f,0,'iron_ore');await useFollower(f,0,n);assert.equal(n.getId(),formNpc('normal'));assert.equal(f.p.getInventory().getAmount(item('iron_ore')),1);give(f,1,'skillpetmining_iron');await useInventory(f,0,1);assert.equal(f.p.getInventory().getAmount(item('iron_ore')),1);give(f,0,'cert_gold_ore');await useInventory(f,0,1);assert.equal(f.p.getInventory().get(1).getId(),formItem('iron'));assert.equal(f.p.getInventory().getAmount(item('cert_gold_ore')),1);
});

test('coloured golem native Talk-to selects its canonical mineral conversation',async t=>{const f=actor(t),n=await summon(f);give(f,1,'iron_ore');await useFollower(f,1,n);await action(f,n,'Talk-to');assert.equal(f.p.getDialogueManager().getCurrent()?.getText?.(),'Truth is, I am Iron Golem.');});
