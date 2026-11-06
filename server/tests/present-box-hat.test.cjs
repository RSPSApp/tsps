const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test,before}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {ItemActionPacketListener:Items}=require('../dist/net/packet/impl/ItemActionPacketListener');
let core,ids,group,clickzones,varp;
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();
 ids=['festive','simple','icy','antisanta'].map(s=>core.CacheDefinitions.getObjId('xmas24_present_hat_'+s));
 group=core.CacheDefinitions.getInterfaceId('item_transmog');clickzones=core.CacheDefinitions.getComponentId('item_transmog:entries_clickzones');varp=core.CacheDefinitions.getVarpId('item_transmog_active_obj');
 const file=path.resolve(__dirname,'../plugins/items/ItemStyles.plugin.js');if(fs.existsSync(file))require(file).register(PM.createApi('ItemStyles'));
});
function player(worn=false){const p=new Player(null);p.setUsername('hatqa');p.getSession=()=>({sendClientPacket:()=>true});const messages=[];p.sendMessage=m=>messages.push(m);const container=worn?p.getEquipment():p.getInventory();container.setItem(0,new core.Item(ids[0],1,{fixture:'preserved'}));return {p,container,messages};}
function open(p,c,slot=0){const id=c.getItems()[slot].getId();return Items.handleAction(p,c===p.getEquipment()?core.Equipment.INVENTORY_INTERFACE_ID:core.Inventory.INTERFACE_ID,id,slot,c===p.getEquipment()?2:3);}
function select(p,slot,opId=1){return PM.emitInterfaceActionClick({player:p,buttonId:clickzones,action:opId,opId,slot,handled:false});}
test('inventory Change opens the native cache chooser without changing the held hat',()=>{
 const {p,container}=player();assert.equal(open(p,container),true);assert.equal(p.getInterfaceId(),group);assert.equal(p.getPacketSender().getVarp(varp),ids[0]);assert.equal(container.getItems()[0].getId(),ids[0]);p.getPacketSender().sendInterfaceRemoval();
});
test('the native inventory widget UID survives ClientConnection decoding into Change',()=>{
 const {ClientConnection}=require('../dist/net/NetworkBuilder');const {p,container}=player();
 const widgetId=core.CacheDefinitions.getComponentId('inventory:items');
 ClientConnection.prototype.inventoryAction.call({player:p},{type:'inventory_action',widgetId,slot:0,itemId:ids[0],optionIndex:3,option:'Change'});
 assert.equal(p.getInterfaceId(),group);assert.equal(container.getItems()[0].getId(),ids[0]);p.getPacketSender().sendInterfaceRemoval();
});
test('native dynamic Select reaches all four styles and preserves the same item and metadata',()=>{
 const {p,container,messages}=player();const item=container.getItems()[0];open(p,container);
 for(const n of [1,2,3,0]){select(p,n);assert.equal(item.getId(),ids[n]);assert.equal(container.getItems()[0],item);assert.deepEqual(item.getMeta(),{fixture:'preserved'});assert.equal(item.getAmount(),1);assert.equal(p.getPacketSender().getVarp(varp),ids[n]);}
 assert.equal(messages.filter(m=>m==='You change the style of your Present box hat.').length,4);p.getPacketSender().sendInterfaceRemoval();
});
test('the worn cache Change option opens the same chooser and updates the equipped hat',()=>{
 const {p,container}=player(true);open(p,container);assert.equal(p.getInterfaceId(),group);select(p,2);assert.equal(container.getItems()[0].getId(),ids[2]);assert.equal(p.getInventory().getAmount(ids[2]),0);p.getPacketSender().sendInterfaceRemoval();
});
test('full inventory and multiple hats change only the clicked slot',()=>{
 const {p,container}=player();container.setItem(1,new core.Item(ids[0]));for(let i=2;i<container.capacity();i++)container.setItem(i,new core.Item(core.ItemIdentifiers.COINS,1));
 assert.equal(container.getFreeSlots(),0);open(p,container,1);select(p,3);assert.equal(container.getItems()[0].getId(),ids[0]);assert.equal(container.getItems()[1].getId(),ids[3]);assert.equal(container.getFreeSlots(),0);p.getPacketSender().sendInterfaceRemoval();
});
test('same style, Examine and invalid dynamic indices cannot mutate or report a change',()=>{
 const {p,container,messages}=player();open(p,container);for(const [index,op]of[[0,1],[1,10],[-1,1],[4,1],[1,2]])select(p,index,op);assert.equal(container.getItems()[0].getId(),ids[0]);assert.equal(messages.length,0);p.getPacketSender().sendInterfaceRemoval();
});
test('closing, replacing the modal and logout discard the selection session',()=>{
 for(const close of[p=>p.getPacketSender().sendInterfaceRemoval(),p=>p.getPacketSender().sendInterface(12),p=>PM.emitPlayerLogout({player:p,username:p.getUsername()})]){
  const {p,container}=player();open(p,container);close(p);select(p,1);assert.equal(container.getItems()[0].getId(),ids[0]);p.getPacketSender().sendInterfaceRemoval();
 }
});
test('a held item moved or replaced during the modal cannot be changed by its stale click',()=>{
 const {p,container}=player();open(p,container);const old=container.getItems()[0];container.deleteAtSlot(0,1,false);container.add(new core.Item(ids[0]),false);select(p,2);assert.equal(container.getItems()[0].getId(),ids[0]);assert.notEqual(container.getItems()[0],old);p.getPacketSender().sendInterfaceRemoval();
});
test('real Bank open/deposit/withdraw closes the old session; a new Change still works',()=>{
 const {p,container,messages}=player();open(p,container);const held=container.getItems()[0];
 p.getPacketSender().sendInterfaceRemoval();p.getBank(0).open();assert.equal(core.Bank.isOpen(p),true);core.Bank.deposit(p,ids[0],0,1,false);
 const bankSlot=p.getBank(0).getSlotForItemId(ids[0]);assert.ok(bankSlot>=0);
 core.Bank.withdraw(p,ids[0],bankSlot,1,0);p.getPacketSender().sendInterfaceRemoval();
 assert.equal(container.getAmount(ids[0]),1);assert.notEqual(container.getItems()[0],held);
 select(p,2);assert.equal(container.getItems()[0].getId(),ids[0]);
 open(p,container);select(p,2);assert.equal(container.getItems()[0].getId(),ids[2]);p.getPacketSender().sendInterfaceRemoval();
});
test('selected style and metadata survive actual PlayerSave JSON round trip without a live chooser',()=>{
 const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
 const {p,container}=player();open(p,container);select(p,3);
 const JsonPersistence=require('../plugins/persistence/JsonPlayerPersistence.plugin');
 JsonPersistence.register(PM.createApi('JsonPlayerPersistence'));
 const codec=new JsonPersistence.JsonPlayerPersistence();
 const saved=JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p),codec.replacer.bind(codec)),codec.reviver.bind(codec));
 const restored=player().p;codec.hydratePlayerSave(saved).applyToPlayer(restored);
 assert.equal(restored.getInventory().getItems()[0].getId(),ids[3]);assert.deepEqual(restored.getInventory().getItems()[0].getMeta(),{fixture:'preserved'});
 select(restored,1);assert.equal(restored.getInventory().getItems()[0].getId(),ids[3]);p.getPacketSender().sendInterfaceRemoval();
});
