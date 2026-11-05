const assert=require('node:assert/strict'),path=require('node:path');
const {before,test}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
let core,group,items,bobble;
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();
 require('../plugins/world/HolidayRewards.plugin.js').register(PM.createApi('HolidayRewards'));
 require('../plugins/items/HolidayToys.plugin.js').register(PM.createApi('HolidayToys'));
 group=core.CacheDefinitions.getInterfaceId('rareitems_diango');items=core.CacheDefinitions.getComponentId('rareitems_diango:items');bobble=core.CacheDefinitions.getObjId('win05_hat1');
});
function fixture(){const p=new Player(null);p.setUsername('holidayqa');const packets=[];p.getSession=()=>({sendClientPacket:packet=>{packets.push(Buffer.from(packet));return true;}});const messages=[];p.sendMessage=m=>messages.push(m);return {p,messages,packets};}
function unlock(p,names=['win05_hat1']){const e={player:p,items:names};PM.emitCustomEvent('holiday-rewards:unlock',e);return e;}
function open(p){const npc=core.NPC.create(core.NpcIdentifiers.DIANGO,new core.Location(3081,3247));return PM.emitNpcInteraction({player:p,npc,npcId:npc.getId(),action:'Holiday-items',clickType:4,handled:false});}
function take(p,slot=20,opId=1){return PM.emitInterfaceActionClick({player:p,buttonId:items,slot,opId,action:opId,handled:false});}
test('new account native Diango menu opens but cannot claim locked rewards',()=>{const {p}=fixture();open(p);assert.equal(p.getInterfaceId(),group);take(p);assert.equal(p.getInventory().getAmount(bobble),0);});

test('snow globe native inventory Look at opens its viewer without consuming the toy; stale slots cannot reopen',async()=>{
 const {PlayerSession}=require('../dist/net/PlayerSession');
 const {ClientConnection}=require('../dist/net/NetworkBuilder');
 const packets=[],channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,
  send:packet=>{packets.push(packet);return true;},close(){},onData(){},onError(){},onClose(){}};
 const p=new Player(new PlayerSession(channel)),connection=new ClientConnection(channel);connection.player=p;
 const c=core.CacheDefinitions,id=c.getObjId('xmas16_snowglobe'),viewer=c.getInterfaceId('xmas16_snow_globe');
 assert.equal(c.getItem(id).inventoryActions[0],'Look at');
 p.getInventory().addItem(new core.Item(id,1));
 async function click(){await connection.dispatch([{type:'widget_action',widgetId:149<<16,groupId:149,childId:0,
  slot:0,itemId:id,buttonNum:2}]);connection.processTurnPackets();}
 await click();assert.equal(p.getInterfaceId(),viewer);
 assert.equal(p.getInventory().getAmount(id),1);
 await connection.dispatch([{type:'interface_close'}]);connection.processTurnPackets();
 assert.equal(p.getInterfaceId(),-1,'native IF_CLOSE releases the viewer');
 await click();assert.equal(p.getInterfaceId(),viewer);
 p.getPacketSender().sendInterfaceRemoval();p.getInventory().deleteAtSlot(0,1);await click();
 assert.notEqual(p.getInterfaceId(),viewer,'forged stale inventory click cannot open the viewer');
 assert.ok(packets.length>0);
});
test('unlocked native enum slot gives exactly one item; replay cannot duplicate',()=>{const {p}=fixture();unlock(p);open(p);take(p);take(p);assert.equal(p.getInventory().getAmount(bobble),1);});
test('unlock request validates the whole set before persisting',()=>{const {p}=fixture();unlock(p,['win05_hat1','not-a-holiday-object']);open(p);take(p);assert.equal(p.getInventory().getAmount(bobble),0);});
test('full inventory refuses without losing unlock; capacity restored allows retrieval',()=>{const {p,messages}=fixture();unlock(p);for(let n=0;n<28;n++)p.getInventory().setItem(n,new core.Item(core.ItemIdentifiers.COINS,1));open(p);take(p);assert.ok(messages.includes("You don't have enough inventory space to take that."));p.getInventory().deleteAtSlot(0,1);take(p);assert.equal(p.getInventory().getAmount(bobble),1);});
test('banked or worn reward cannot be reclaimed, even through forged selection',()=>{const {p}=fixture();unlock(p);p.getBank(0).addItem(new core.Item(bobble,1));open(p);take(p);assert.equal(p.getInventory().getAmount(bobble),0);p.getBank(0).resetItems();p.getEquipment().setItem(0,new core.Item(bobble,1));take(p);assert.equal(p.getInventory().getAmount(bobble),0);});
test('Examine, invalid slot and closed/replaced modal cannot award',()=>{const {p}=fixture();unlock(p);open(p);take(p,20,10);take(p,999);p.getPacketSender().sendInterfaceRemoval();take(p);open(p);p.getPacketSender().sendInterface(12);take(p);assert.equal(p.getInventory().getAmount(bobble),0);});

test('alternate cache transmog styles in bank prevent default-form duplicate claims',()=>{
 const {p}=fixture(),c=core.CacheDefinitions,id=c.getObjId('xmas24_present_hat_festive'),alternate=c.getObjId('xmas24_present_hat_icy');
 const slot=[...c.getEnumValues(708)].find(([,obj])=>obj===id)[0];
 unlock(p,['xmas24_present_hat_festive']);p.getBank(0).addItem(new core.Item(alternate,1));open(p);take(p,slot);assert.equal(p.getInventory().getAmount(id),0);
});

test('actual bank round trip suppresses reclaim and permits a real loss/reclaim afterwards',()=>{
 const {p}=fixture();unlock(p);open(p);take(p);p.getPacketSender().sendInterfaceRemoval();
 const {Bank}=require('../dist/game/model/container/impl/Bank');p.getBank(0).open();
 Bank.deposit(p,bobble,p.getInventory().getSlotForItemId(bobble),1,false);
 p.getPacketSender().sendInterfaceRemoval();open(p);take(p);assert.equal(p.getInventory().getAmount(bobble),0);
 p.getPacketSender().sendInterfaceRemoval();p.getBank(0).open();Bank.withdraw(p,bobble,p.getBank(0).getSlotForItemId(bobble),1,0);
 p.getPacketSender().sendInterfaceRemoval();open(p);take(p);assert.equal(p.getInventory().getAmount(bobble),1);
 p.getInventory().deleteAtSlot(p.getInventory().getSlotForItemId(bobble),1);take(p);assert.equal(p.getInventory().getAmount(bobble),1);
});

test('actual costume-room deposit then outside-house retrieval transfers rather than copies',()=>{
 const api=PM.createApi('Construction');require('../plugins/skills/construction/Core.Construction').init(api);
 const {PlayerHouseInstance,createDefaultHouseSave}=require('../plugins/skills/construction/Instance.Construction');
 const Storage=require('../plugins/skills/construction/Storage.Construction');
 const {p}=fixture(),save=createDefaultHouseSave();
 const furniture={hotspotKey:'TOY_BOX',buildableKey:'OAK_TOY_BOX',storage:{}};
 save.rooms[1][4][4].furnitureByLocation={fixture:furniture};
 const house=new PlayerHouseInstance(save);house.owner=p;
 save.rooms[1][4][4].furnitureByLocation={fixture:furniture};
 p.setArea(house);p.setAttribute('construction:house',save);p.getInventory().setItem(0,new core.Item(bobble,1));
 assert.equal(Storage.depositHouseItem(p,house,furniture,0),true);assert.equal(furniture.storage[bobble],1);
 p.setArea(null);unlock(p);open(p);take(p);assert.equal(p.getInventory().getAmount(bobble),1);assert.equal(furniture.storage[bobble],undefined);
 take(p);assert.equal(p.getInventory().getAmount(bobble),1);
});

test('unlock survives actual PlayerSave codec and hydration, chooser session does not',()=>{
 const Json=require('../plugins/persistence/JsonPlayerPersistence.plugin');Json.register(PM.createApi('JsonPlayerPersistence'));
 const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave'),codec=new Json.JsonPlayerPersistence();
 const {p}=fixture();unlock(p);open(p);
 const raw=JSON.stringify(PlayerSave.fromPlayer(p),codec.replacer.bind(codec));
 const save=JSON.parse(raw,codec.reviver.bind(codec)),restored=fixture().p;
 codec.hydratePlayerSave(save).applyToPlayer(restored);take(restored);assert.equal(restored.getInventory().getAmount(bobble),0);
 open(restored);take(restored);assert.equal(restored.getInventory().getAmount(bobble),1);
});

test('logout and disconnect invalidate a chooser even when its old modal id is retained',()=>{
 for(const disconnect of [false,true]){const {p}=fixture();unlock(p);open(p);
 if(disconnect)PM.emitPlayerDisconnect({player:p,username:p.getUsername()});else PM.emitPlayerLogout({player:p,username:p.getUsername()});
 take(p);assert.equal(p.getInventory().getAmount(bobble),0);}
});

test('house retrieval respects real PIN keypad and reopens for a fresh validated selection',()=>{
 require('../plugins/interface/BankPin.plugin').register(PM.createApi('BankPin'));
 const Common=require('../plugins/interface/bankpin/Common.BankPin');
 const {p}=fixture(),stored={[bobble]:1},house={rooms:[[[{furnitureByLocation:{toy:{hotspotKey:'TOY_BOX',storage:stored}}}]]]};
 p.setAttribute('construction:house',house);Common.set(p,'hash',Common.hash(p,'1234'));unlock(p);open(p);take(p);
 assert.equal(p.getInterfaceId(),Common.ids.groups.keypad);assert.equal(stored[bobble],1);assert.equal(p.getInventory().getAmount(bobble),0);
 const action=p.getEnteredAmountAction();assert.ok(action);action.execute(1234);
 core.TaskManager.process();core.TaskManager.process();
 assert.equal(p.getInterfaceId(),group);assert.equal(p.getInventory().getAmount(bobble),0);
 take(p);assert.equal(p.getInventory().getAmount(bobble),1);assert.equal(stored[bobble],undefined);
});

test('stale bank search results are not physical ownership after normal withdrawal and loss',()=>{
 const {Bank}=require('../dist/game/model/container/impl/Bank');const {p}=fixture();unlock(p);
 p.getInventory().addItem(new core.Item(bobble,1));p.getBank(0).open();Bank.deposit(p,bobble,0,1,false);
 Bank.search(p,'bobble');assert.equal(p.getBank(Bank.BANK_SEARCH_TAB_INDEX).getAmount(bobble),1);
 p.getPacketSender().sendInterfaceRemoval();p.getBank(0).open();Bank.withdraw(p,bobble,p.getBank(0).getSlotForItemId(bobble),1,0);
 p.getPacketSender().sendInterfaceRemoval();p.getInventory().deleteAtSlot(p.getInventory().getSlotForItemId(bobble),1);
 assert.equal(p.getBank(0).getAmount(bobble),0);assert.equal(p.getBank(Bank.BANK_SEARCH_TAB_INDEX).getAmount(bobble),1);
 open(p);take(p);assert.equal(p.getInventory().getAmount(bobble),1);
});

test('F2P-only registration preserves house storage through real saved-player hydration',()=>{
 const Json=require('../plugins/persistence/JsonPlayerPersistence.plugin'),codec=new Json.JsonPlayerPersistence();
 const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
 const {p}=fixture();unlock(p);p.setAttribute('construction:house',{owned:true,rooms:[[[{furnitureByLocation:{toy:{hotspotKey:'TOY_BOX',storage:{[bobble]:1}}}}]]]});
 const saved=JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p),codec.replacer.bind(codec)),codec.reviver.bind(codec));
 const restored=fixture().p;codec.hydratePlayerSave(saved).applyToPlayer(restored);
 assert.equal(restored.getAttribute('construction:house').rooms[0][0][0].furnitureByLocation.toy.storage[bobble],1);
 open(restored);take(restored);assert.equal(restored.getInventory().getAmount(bobble),1);
 assert.equal(restored.getAttribute('construction:house').rooms[0][0][0].furnitureByLocation.toy.storage[bobble],undefined);
 const again=PlayerSave.fromPlayer(restored);assert.ok(again.attributes['construction:house']);
});

test('canonical held reward retains entitlement mask for native inventory-transmit loss updates',()=>{
 const {encodeRunClientScript}=require('../dist/net/protocol/ClientProtocol');
 const {p,packets}=fixture();unlock(p);p.getInventory().addItem(new core.Item(bobble,1));open(p);
 const expected=encodeRunClientScript(450,["Diango's Holiday Item Retrieval",1<<20,0,0,0,0,0,0,0]);
 assert.ok(packets.some(packet=>packet.equals(expected)),'script450 receives the unlocked bit even while its own inventory check hides the item');
 take(p);assert.equal(p.getInventory().getAmount(bobble),1);
});

test('successful native Take leaves script474 to hide in place, without rebuilding the list',()=>{
 const {encodeRunClientScript}=require('../dist/net/protocol/ClientProtocol');
 const {p,packets}=fixture();unlock(p);open(p);packets.length=0;take(p);
 const prefix=encodeRunClientScript(450,[]).subarray(0,1);
 assert.ok(packets.every(packet=>!packet.subarray(0,1).equals(prefix)),'take emits no fresh client initialization script');
 assert.equal(p.getInventory().getAmount(bobble),1);
});

test('wearing a never-unlocked holiday item registers it with Diango once, with the recorded message',()=>{
 const {EquipPacketListener}=require('../dist/net/packet/impl/EquipPacketListener');
 const {p,messages}=fixture();const wreath=core.CacheDefinitions.getObjId('wreath');
 p.getInventory().setItem(0,new core.Item(wreath,1));
 assert.equal(PM.emitItemAction({player:p,interfaceId:core.Inventory.INTERFACE_ID,item:p.getInventory().getItems()[0],itemId:wreath,slot:0,clickType:3,option:'Check rank',handled:false})||true,true);
 assert.deepEqual(p.getAttribute('holiday-rewards:unlocked')??[],[],'Check rank does not unlock');
 EquipPacketListener.equip(p,wreath,0,core.Inventory.INTERFACE_ID);
 assert.deepEqual(p.getAttribute('holiday-rewards:unlocked'),['wreath']);
 assert.deepEqual(messages.filter(m=>m.startsWith("You've unlocked")),["You've unlocked a holiday item: <col=ef1020>Druidic wreath</col>"]);
 EquipPacketListener.unequip(p,core.CacheDefinitions.getItem(wreath).equipSlot ?? 0);
 EquipPacketListener.equip(p,wreath,p.getInventory().getSlotForItemId(wreath),core.Inventory.INTERFACE_ID);
 assert.equal(messages.filter(m=>m.startsWith("You've unlocked")).length,1,'no repeat message');
});
test('holiday-rewards:used unlocks catalogue items only and the retrieval menu then offers them',()=>{
 const {p,messages}=fixture();
 PM.emitCustomEvent('holiday-rewards:used',{player:p,itemId:core.ItemIdentifiers.COINS});
 assert.deepEqual(p.getAttribute('holiday-rewards:unlocked')??[],[]);
 PM.emitCustomEvent('holiday-rewards:used',{player:p,itemId:bobble});
 assert.deepEqual(p.getAttribute('holiday-rewards:unlocked'),['win05_hat1']);assert.equal(messages.length,1);
 open(p);take(p);assert.equal(p.getInventory().getAmount(bobble),1);
});
test('an item that is its own Diango entry unlocks itself, not a family neighbour',()=>{
 const {EquipPacketListener}=require('../dist/net/packet/impl/EquipPacketListener');
 const c=core.CacheDefinitions,skeleton=c.getObjId('25th_anniversary_tabard_2');
 const {p,messages}=fixture();p.getInventory().setItem(0,new core.Item(skeleton,1));
 EquipPacketListener.equip(p,skeleton,0,core.Inventory.INTERFACE_ID);
 assert.deepEqual(p.getAttribute('holiday-rewards:unlocked'),['25th_anniversary_tabard_2']);
 assert.match(messages.join('\n'),/25th anniversary skeleton tabard/);
});
