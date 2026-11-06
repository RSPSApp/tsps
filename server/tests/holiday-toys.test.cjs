// Build first: node --test tests/holiday-toys.test.cjs
const assert=require('node:assert/strict'),path=require('node:path');
const {test,before}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {ItemActionPacketListener:Items}=require('../dist/net/packet/impl/ItemActionPacketListener');
const toys=require('../plugins/items/data/holiday-toys.json');
let core,c;
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();c=core.CacheDefinitions;
 require('../plugins/world/HolidayRewards.plugin.js').register(PM.createApi('HolidayRewards'));
 require('../plugins/items/HolidayToys.plugin.js').register(PM.createApi('HolidayToys'));
});
function player(symbol,worn=false){
 const p=new Player(null);p.setUsername('toyqa');p.getSession=()=>({sendClientPacket:()=>true});
 const log={messages:[],anims:[],gfx:[],says:[],sounds:[]};p.sendMessage=m=>log.messages.push(m);
 p.performAnimation=a=>log.anims.push(a.getId());p.performGraphic=g=>log.gfx.push(g.getId());p.forceChat=s=>{log.says.push(s);return p;};
 const sender=p.getPacketSender(),sound=sender.sendSound.bind(sender);sender.sendSound=(id,...r)=>{log.sounds.push(id);return sound(id,...r);};
 const container=worn?p.getEquipment():p.getInventory(),id=c.getObjId(symbol);
 const slot=worn?(c.getItem(id).equipSlot ?? core.Equipment.SHIELD_SLOT):0;
 container.setItem(slot,new core.Item(id,1));return {p,container,slot,log};
}
function click(p,container,slot,option,native=true){
 const id=container.getItems()[slot].getId(),def=c.getItem(id),worn=container===p.getEquipment();
 const clickType=worn?2+Array.from({length:5},(_,i)=>def.params?.get?.(451+i)).indexOf(option):def.inventoryActions.indexOf(option)+1;
 assert.ok(clickType>=1,`${def.name} has ${option}`);
 const inv=native?c.getComponentId('inventory:items'):core.Inventory.INTERFACE_ID;
 return Items.handleAction(p,worn?core.Equipment.INVENTORY_INTERFACE_ID:inv,id,slot,clickType);
}
test('a WWF toy plays its recorded sequence and overhead, and its first play unlocks it at Diango',(t)=>{
 let now=1e9;t.mock.method(Date,'now',()=>now);
 const {p,container,slot,log}=player('wwf_toy_tiger');
 click(p,container,slot,'Play-with');now+=600;click(p,container,slot,'Play-with',false);
 assert.deepEqual(log.anims,[c.getSeqId('human_play_wwf_tiger'),c.getSeqId('human_play_wwf_tiger')]);
 assert.deepEqual(log.says,['Grrrr!'],'the overhead waits 6 ticks, as recorded');
 now+=6*600;click(p,container,slot,'Play-with');assert.equal(log.says.length,2);
 assert.deepEqual(p.getAttribute('holiday-rewards:unlocked'),['wwf_toy_tiger']);
 assert.deepEqual(log.messages,["You've unlocked a holiday item: <col=ef1020>Tiger toy</col>"]);
});
test('marionettes play the shared sequence with their own colour spotanim; the yo-yo sends its sound',()=>{
 const blue=player('win05_marionette_complete_blue_alive');click(blue.p,blue.container,blue.slot,'Bow');
 assert.deepEqual(blue.log.anims,[c.getSeqId('human_marionette_bow')]);assert.deepEqual(blue.log.gfx,[c.getSpotanimId('win05_marionette_bow_blue')]);
 assert.equal(blue.p.getAttribute('holiday-rewards:unlocked')?.length ?? 0,0,'Bow is not the first-use option');
 const yoyo=player('xmas_yoyo');click(yoyo.p,yoyo.container,yoyo.slot,'Crazy');
 assert.deepEqual(yoyo.log.anims,[c.getSeqId('yoyo_advanced')]);assert.deepEqual(yoyo.log.sounds,[2264]);
});
test('the gingerbread shield cycles green, red, blue in the inventory and while worn',()=>{
 const {p,container,slot}=player('xmas19_shield_1');const item=container.getItems()[slot];
 for(const next of ['xmas19_shield_2','xmas19_shield_3','xmas19_shield_1']){click(p,container,slot,'Transform');assert.equal(item.getId(),c.getObjId(next));}
 const worn=player('xmas19_shield_1',true);click(worn.p,worn.container,worn.slot,'Transform');
 assert.equal(worn.container.getItems()[worn.slot].getId(),c.getObjId('xmas19_shield_2'));
});
test('Check rank shows the recorded title line for the current hug count varbit',()=>{
 const {p,container,slot}=player('wreath');const shown=[],typed=[];
 const sender=p.getPacketSender(),send=sender.sendTypedMessage.bind(sender);
 sender.sendTypedMessage=(type,m,...r)=>{typed.push([type,m]);return send(type,m,...r);};
 const dm=p.getDialogueManager(),start=dm.startDialogues.bind(dm);
 dm.startDialogues=chain=>{shown.push(require('node:util').inspect(chain,{depth:6}));return start(chain);};
 click(p,container,slot,'Check rank');
 p.getPacketSender().sendVarbit(c.getVarbitId('summer_trees_hugged'),55);click(p,container,slot,'Check rank');
 assert.match(shown[0],/Your tree hugging title is:<br><col=6f0000>What's a tree\?/);
 assert.deepEqual(typed[0],[115,"Your tree hugging title is: <col=6f0000>What's a tree?"]);
 assert.match(shown[1],/Tree Hugger/);
});
test('every data entry resolves in the active cache and names a real option on its item',()=>{
 const has=(sym,opt)=>{const d=c.getItem(c.getObjId(sym));const worn=Array.from({length:5},(_,i)=>d.params?.get?.(451+i));return d.inventoryActions.includes(opt)||worn.includes(opt);};
 for(const e of toys.animations){
  if(e.seq)assert.notEqual(c.getSeqId(e.seq),null,e.seq);if(e.spotanim)assert.notEqual(c.getSpotanimId(e.spotanim),null,e.spotanim);
  for(const i of e.items)assert.ok(has(i,e.option),`${i} ${e.option}`);
 }
 for(const s of toys.swaps)for(const i of s.cycle)assert.ok(has(i,s.option),`${i} ${s.option}`);
 for(const i of toys.ranks.items)assert.ok(toys.ranks.options.some(o=>has(i,o)),i);
});
test('the Giant easter egg dances in safe places, worn or held, and refuses in the Wilderness',()=>{
 const held=player('easter19_giant_egg');held.p.setLocation(new core.Location(3222,3218,0));click(held.p,held.container,held.slot,'Easter dance');
 assert.deepEqual(held.log.anims,[c.getSeqId('easter19_egg_emote_human')]);assert.deepEqual(held.log.gfx,[c.getSpotanimId('easter19_egg_dance_spot')]);
 const wild=player('easter19_giant_egg',true);wild.p.setLocation(new core.Location(3100,3600,0));
 assert.ok(core.Wilderness.levelAt(3100,3600)>0);click(wild.p,wild.container,wild.slot,'Easter dance');
 assert.deepEqual(wild.log.anims,[]);assert.deepEqual(wild.log.messages,['Perhaps you should play with your egg somewhere safer.']);
 const book=player('easter24_reward_book_easter');book.p.setLocation(new core.Location(3222,3218,0));click(book.p,book.container,book.slot,'Preach');
 assert.deepEqual(book.log.anims,[c.getSeqId('easter24_preach_seq')]);assert.match(book.log.says[0],/^All eggs doth shine glory/);
});
