// Build first: node --test tests/mastering-mixology-outfit.test.cjs
const assert=require('node:assert/strict'),path=require('node:path');
const {test,before}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {ItemActionPacketListener:Items}=require('../dist/net/packet/impl/ItemActionPacketListener');
let core,c;
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();c=core.CacheDefinitions;
 require('../plugins/items/ItemStyles.plugin.js').register(PM.createApi('ItemStyles'));
 require('../plugins/minigames/MasteringMixology.plugin.js').register(PM.createApi('MasteringMixology'));
});
const obj=n=>c.getObjId(n);
function player(names){
 const p=new Player(null);p.setUsername('mixqa');p.getSession=()=>({sendClientPacket:()=>true});
 const messages=[],sounds=[];p.sendMessage=m=>messages.push(m);
 const sender=p.getPacketSender();sender.sendSound=(id,...rest)=>{sounds.push(id);return sender;};
 names.forEach((n,i)=>p.getInventory().setItem(i,new core.Item(obj(n),1)));
 return {p,messages,sounds};
}
function change(p,slot){
 const id=p.getInventory().getItems()[slot].getId();
 Items.handleAction(p,core.Inventory.INTERFACE_ID,id,slot,c.getItem(id).inventoryActions.indexOf('Change')+1);
}
const PAIRS=[['mm_alchemist_hat','mm_alchemist_hat_alt','Prescription goggles'],
 ['mm_alchemist_body','mm_alchemist_body_alt','Alchemist labcoat'],
 ['mm_alchemist_legs','mm_alchemist_legs_alt','Alchemist pants']];
test('Change swaps each outfit piece for its other look and back, as recorded (rec 4210)',()=>{
 for(const [base,alt,name] of PAIRS){
  const {p,messages,sounds}=player(['coins',base]);
  change(p,1);assert.equal(p.getInventory().getItems()[1].getId(),obj(alt),base);
  change(p,1);assert.equal(p.getInventory().getItems()[1].getId(),obj(base),alt);
  assert.deepEqual(messages,[`You adjust the style of your ${name}.`,`You adjust the style of your ${name}.`]);
  assert.deepEqual(sounds,[2238,2238]);
  assert.equal(p.getInventory().getItems()[0].getId(),obj('coins'));
  assert.equal(p.getInventory().getFreeSlots(),26);
 }
});
test('the gloves have no Change option, and the outfit is not on the holiday style chooser',()=>{
 assert.ok(!c.getItem(obj('mm_alchemist_gloves')).inventoryActions.includes('Change'));
 const {p}=player(['mm_alchemist_body']);change(p,0);
 assert.notEqual(p.getInterfaceId(),c.getInterfaceId('item_transmog'));
});
