// Build first: node --test tests/item-styles.test.cjs
const assert=require('node:assert/strict'),path=require('node:path');
const {test,before}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {ItemActionPacketListener:Items}=require('../dist/net/packet/impl/ItemActionPacketListener');
let core,c,chooser,clickzones,scripts=[];
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();c=core.CacheDefinitions;
 require('../plugins/items/ItemStyles.plugin.js').register(PM.createApi('ItemStyles'));
 chooser=c.getInterfaceId('item_transmog');clickzones=c.getComponentId('item_transmog:entries_clickzones');
});
const obj=n=>typeof n==='number'?n:c.getObjId(n);
function player(name,worn=false){
 const p=new Player(null);p.setUsername('styleqa');p.getSession=()=>({sendClientPacket:()=>true});
 const messages=[];p.sendMessage=m=>messages.push(m);
 const sender=p.getPacketSender(),send=sender.sendClientScript.bind(sender);
 sender.sendClientScript=(id,...args)=>{scripts.push([id,...args]);return send(id,...args);};
 const container=worn?p.getEquipment():p.getInventory();
 const slot=worn?c.getItem(obj(name)).equipSlot ?? 0:0;
 container.setItem(slot,new core.Item(obj(name),1));return {p,container,slot,messages};
}
function op(p,container,slot,option){
 const id=container.getItems()[slot].getId(),def=c.getItem(id),worn=container===p.getEquipment();
 const clickType=worn?2+Array.from({length:5},(_,i)=>def.params?.get?.(451+i)).indexOf(option):def.inventoryActions.indexOf(option)+1;
 scripts=[];
 Items.handleAction(p,worn?core.Equipment.INVENTORY_INTERFACE_ID:core.Inventory.INTERFACE_ID,id,slot,clickType);
 return scripts.find(s=>s[0]===6857)?.[1];
}
const select=(p,slot)=>PM.emitInterfaceActionClick({player:p,buttonId:clickzones,action:1,opId:1,slot,handled:false});
test('a pumpkin Colour opens its colour group and Carve its face group, as recorded',()=>{
 const {p,container,slot,messages}=player('hw24_reward_pumpkin_beige_ew');
 assert.equal(op(p,container,slot,'Colour'),9);assert.equal(p.getInterfaceId(),chooser);
 select(p,5);assert.equal(container.getItems()[slot].getId(),obj('hw24_reward_pumpkin_darkgreen_ew'));
 assert.deepEqual(messages,['You change the style of your Beige pumpkin (disgusted).']);
 p.getPacketSender().sendInterfaceRemoval();
 assert.equal(op(p,container,slot,'Carve'),23);select(p,7);
 assert.equal(container.getItems()[slot].getId(),obj('hw24_reward_pumpkin_darkgreen_woo'));
 assert.equal(messages[1],'You change the style of your Dark green pumpkin (disgusted).');
});
test('a worn Rainbow scarf opens the chooser from its worn option and updates the worn item',()=>{
 const def=c.getItem(obj('pride17_scarf'));const worn=Array.from({length:5},(_,i)=>def.params?.get?.(451+i));
 assert.ok(worn.includes('Change-style'),'cache worn op');
 const {p,container,slot}=player('pride17_scarf',true);
 assert.equal(op(p,container,slot,'Change-style'),4);select(p,1);
 assert.equal(container.getItems()[slot].getId(),obj('pride23_scarf_bisexual'));assert.equal(p.getInventory().getFreeSlots(),28);
});
test('cauldron and spider hat rows locked by their event rewards cannot be chosen until unlocked',()=>{
 const {p,container,slot,messages}=player('hw22_treat_cauldron_0');
 op(p,container,slot,'Change');for(const n of [1,2,3,4])select(p,n);
 assert.equal(container.getItems()[slot].getId(),obj('hw22_treat_cauldron_0'));assert.equal(messages.length,0);
 p.getPacketSender().sendInterfaceRemoval();
 const hat=player('hw23_reward_spiderhat');op(hat.p,hat.container,hat.slot,'Change');select(hat.p,2);
 assert.equal(hat.container.getItems()[hat.slot].getId(),obj('hw23_reward_spiderhat'));
 hat.p.getPacketSender().sendVarbit(c.getVarbitId('hw23_reward_received_5'),1);
 select(hat.p,2);assert.equal(hat.container.getItems()[hat.slot].getId(),obj('hw23_reward_spiderhat03'));
});
test('Archibald Paint opens his group; greenman masks are left to their own unlocks',()=>{
 const egg=player('easter26_egg_companion');assert.equal(op(egg.p,egg.container,egg.slot,'Paint'),27);
 select(egg.p,6);assert.equal(egg.container.getItems()[egg.slot].getId(),obj('easter26_egg_companion07'));
 const mask=player('greenman_mask');assert.equal(op(mask.p,mask.container,mask.slot,'Change-style'),undefined);
 assert.notEqual(mask.p.getInterfaceId(),chooser);
});
test('every holiday style group the plugin opens is reachable from its first member',()=>{
 const table=c.getDbTableId('item_transmog'),gc=c.getDbColumn(table,'group'),oc=c.getDbColumn(table,'namedobj');
 const firsts=new Map();for(const row of c.getDbTableRows(table)){const g=row.int(gc);if(!firsts.has(g))firsts.set(g,row.int(oc));}
 let opened=0;
 for(const [group,id] of firsts){
  if([26,28].includes(group))continue;
  const def=c.getItem(id);const opt=def.inventoryActions.find(o=>['Change','Change-style','Colour','Carve','Paint'].includes(o));
  if(!opt)continue;const {p,container,slot}=player(id);
  assert.notEqual(op(p,container,slot,opt),undefined,`group ${group} via ${def.name}`);opened++;
 }
 assert.ok(opened>=20,`opened ${opened}`);
});
test('Carve clicked while the Colour chooser is open reopens on the face group',()=>{
 const {p,container,slot}=player('hw24_reward_pumpkin_beige_ew');
 assert.equal(op(p,container,slot,'Colour'),9);assert.equal(p.getInterfaceId(),chooser);
 assert.equal(op(p,container,slot,'Carve'),18);assert.equal(p.getInterfaceId(),chooser);
 select(p,1);assert.equal(container.getItems()[slot].getId(),obj('hw24_reward_pumpkin_beige_derp'));
});
