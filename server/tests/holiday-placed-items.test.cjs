// Build first: node --test tests/holiday-placed-items.test.cjs
//
// Holiday decorations planted in the house (rev 230 recording 2923: Wintumber tree Plant/Dig-up;
// rev 226 recording 1686: scarecrow refusal), the Snow globe's Shake and Snow (cache seq; rev 223
// recording 1375) and the Cat ears' Chase near Hell-Rats (Wiki).
const assert=require('node:assert/strict'),path=require('node:path');
const {test,before}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {ItemActionPacketListener:Items}=require('../dist/net/packet/impl/ItemActionPacketListener');
let core,c,Instance,Decorations,Data,HouseRewards;
const GARDEN={x:4,y:4,plane:1};

before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));core=PM.getCoreApi();c=core.CacheDefinitions;
 require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
 require('../plugins/world/HolidayRewards.plugin.js').register(PM.createApi('HolidayRewards'));
 require('../plugins/items/HolidayToys.plugin.js').register(PM.createApi('HolidayToys'));
 require('../plugins/skills/Construction.plugin.js').register(PM.createApi('Construction'));
 Instance=require('../plugins/skills/construction/Instance.Construction');
 Decorations=require('../plugins/skills/construction/Decorations.Construction');
 Data=require('../plugins/skills/construction/Data.Construction');
 HouseRewards=require('../plugins/skills/construction/Retrieval.Construction');
});

function player(name='decorqa'){
 const p=new Player(null);p.setUsername(name);p.getSession=()=>({sendClientPacket:()=>true});
 const log={messages:[],typed:[],anims:[],gfx:[]};p.sendMessage=m=>log.messages.push(m);
 p.performAnimation=a=>log.anims.push(a.getId());p.performGraphic=g=>log.gfx.push(g.getId());
 const sender=p.getPacketSender(),typed=sender.sendTypedMessage.bind(sender);
 sender.sendTypedMessage=(type,m,...r)=>{log.typed.push([type,m]);return typed(type,m,...r);};
 const graphic=sender.sendGraphic.bind(sender);sender.sendGraphic=(g,at)=>{log.gfx.push([g.getId(),g.delay,g.height,at.getX(),at.getY()]);return graphic(g,at);};
 return {p,log};
}
function house(owner){
 const save=Instance.createDefaultHouseSave();save.rooms[1][4][4].furnitureByLocation={};
 const h=new Instance.PlayerHouseInstance(save);h.owner=owner;owner.setAttribute('construction:house',save);return h;
}
function enter(p,h,tile){p.setArea(h);p.moveTo(tile);p.setNeedsPlacement(false);}
function ticks(n){for(let i=0;i<n;i++)core.TaskManager.process();}
// A garden tile with a free neighbour to the east, both off every hotspot.
function gardenSpot(h){
 const corner=h.roomCorner(GARDEN),spots=h.hotspotTiles(GARDEN);
 const onHotspot=t=>spots.some(s=>t.getX()>=s.x&&t.getX()<s.x+s.width&&t.getY()>=s.y&&t.getY()<s.y+s.length);
 for(let x=0;x<7;x++)for(let y=0;y<8;y++){
  const stand=corner.transform(x,y),target=corner.transform(x+1,y);
  if(!onHotspot(stand)&&!onHotspot(target))return {stand,target};
 }
 throw new Error('no free garden tile');
}
function plantClick(p,slot=0){
 const id=p.getInventory().getItems()[slot].getId();
 return Items.handleAction(p,c.getComponentId('inventory:items'),id,slot,c.getItem(id).inventoryActions.indexOf('Plant')+1);
}
function objectClick(p,object,clickType){
 const at=object.getLocation();
 return PM.emitObjectInteraction({player:p,object,objectId:object.getId(),clickType,location:{x:at.getX(),y:at.getY(),z:at.getZ()},handled:false});
}
function drawn(h,locName){return h.extraObjects.find(o=>o.getId()===c.getLocId(locName));}

test('the Wintumber tree is refused outside the house and indoors with the recorded line',()=>{
 const {p,log}=player();p.getInventory().setItem(0,new core.Item(c.getObjId('gub_wintumber_tree'),1));
 plantClick(p);
 assert.deepEqual(log.messages.concat(log.typed.map(t=>t[1])),['You can only plant the wintumber tree in the garden of your player-owned house.']);
 const h=house(p);enter(p,h,h.roomCorner({x:4,y:5,plane:1}).transform(3,3));log.typed.length=0;
 plantClick(p);assert.deepEqual(log.typed.map(t=>t[1]),['You can only plant the wintumber tree in the garden of your player-owned house.']);
 assert.equal(p.getInventory().getAmount(c.getObjId('gub_wintumber_tree')),1);
});

test('Plant puts the tree on the faced tile after 3 ticks, removes the item and survives a new house instance',()=>{
 const {p,log}=player(),tree=c.getObjId('gub_wintumber_tree');p.getInventory().setItem(0,new core.Item(tree,1));
 const h=house(p),{stand,target}=gardenSpot(h);enter(p,h,stand);p.setPositionToFace(target);
 plantClick(p);
 assert.deepEqual(log.anims,[c.getSeqId('farming_trowel_dig')]);
 assert.deepEqual(log.typed,[[core.ChatType.SPAM,'You plant the wintumber tree.']]);
 ticks(2);assert.equal(drawn(h,'gub_wintumber_tree_standard'),undefined,'nothing before tick 3');
 ticks(1);
 const object=drawn(h,'gub_wintumber_tree_standard');
 assert.ok(object&&object.getLocation().equals(target),'the tree stands on the faced tile');
 assert.equal(p.getInventory().getAmount(tree),0);assert.equal(log.anims.at(-1),-1);
 assert.ok(core.RegionManager.blocked(target,h),'the tree blocks walking (Wiki 2022 change)');
 const owned={player:p,itemIds:[]};HouseRewards.planted({core},owned);assert.deepEqual(owned.itemIds,[tree],'Diango counts the planted tree as owned');
 assert.ok((p.getAttribute('holiday-rewards:unlocked')??[]).includes('gub_wintumber_tree'),'planting is a use, so Diango can replace it later');
 // A fresh instance (re-entering the house) draws it again from the save.
 const again=new Instance.PlayerHouseInstance(p.getAttribute('construction:house'));again.owner=p;
 Decorations.refresh(again);
 const offset=(house,at)=>[at.getX()-house.roomCorner({x:0,y:0,plane:1}).getX(),at.getY()-house.roomCorner({x:0,y:0,plane:1}).getY()];
 assert.deepEqual(offset(again,drawn(again,'gub_wintumber_tree_standard').getLocation()),offset(h,target));
});

test('no space: a blocked, hotspot or already-planted faced tile gets the recorded refusal and keeps the item',()=>{
 const {p,log}=player(),tree=c.getObjId('gub_wintumber_tree');p.getInventory().setItem(0,new core.Item(tree,1));
 const h=house(p),spots=h.hotspotTiles(GARDEN),corner=h.roomCorner(GARDEN);
 const on=t=>spots.some(s=>t.getX()>=s.x&&t.getX()<s.x+s.width&&t.getY()>=s.y&&t.getY()<s.y+s.length);
 const inGarden=t=>t.getX()>=corner.getX()&&t.getX()<corner.getX()+8&&t.getY()>=corner.getY()&&t.getY()<corner.getY()+8;
 const hotspot=spots.map(s=>new core.Location(s.x,s.y,1)).find(t=>{const w=t.transform(-1,0);return inGarden(w)&&!on(w);});
 enter(p,h,hotspot.transform(-1,0));p.setPositionToFace(hotspot);
 plantClick(p);ticks(4);
 assert.deepEqual(log.typed.map(t=>t[1]),['There is no space to place your tree here. Try a different location.']);
 assert.equal(p.getInventory().getAmount(tree),1);assert.equal(drawn(h,'gub_wintumber_tree_standard'),undefined);
});

test('a guest cannot dig up the owner\'s tree; the owner digs it up after 2 ticks and gets it back',()=>{
 const owner=player('owner'),tree=c.getObjId('gub_wintumber_tree');owner.p.getInventory().setItem(0,new core.Item(tree,1));
 const h=house(owner.p),{stand,target}=gardenSpot(h);enter(owner.p,h,stand);owner.p.setPositionToFace(target);
 plantClick(owner.p);ticks(3);const object=drawn(h,'gub_wintumber_tree_standard');assert.ok(object);
 const guest=player('guest');enter(guest.p,h,stand);
 objectClick(guest.p,object,1);
 assert.deepEqual(guest.log.typed.map(t=>t[1]),["You can't dig up the owner's wintumber tree! How unfestive!"]);
 objectClick(owner.p,object,1);
 assert.equal(owner.log.anims.at(-1),c.getSeqId('human_pickupfloor'));
 assert.deepEqual(owner.log.typed.at(-1),[core.ChatType.SPAM,'You dig up the wintumber tree.']);
 ticks(1);assert.ok(drawn(h,'gub_wintumber_tree_standard'),'still there before tick 2');
 ticks(1);
 assert.equal(drawn(h,'gub_wintumber_tree_standard'),undefined);assert.equal(owner.p.getInventory().getAmount(tree),1);
 assert.equal(core.RegionManager.blocked(target,h),false,'its clipping is removed exactly');
 assert.deepEqual(owner.p.getAttribute('construction:holiday-decorations'),{});
});

test('the scarecrow plants like the tree with only its recorded refusal, and rotates both ways',()=>{
 const {p,log}=player(),item=c.getObjId('hw24_scarecrow');p.getInventory().setItem(0,new core.Item(item,1));
 plantClick(p);assert.deepEqual(log.typed.map(t=>t[1]),['You can only plant the scarecrow in the garden of your player-owned house.']);
 const h=house(p),{stand,target}=gardenSpot(h);enter(p,h,stand);p.setPositionToFace(target);log.typed.length=0;
 plantClick(p);ticks(3);
 let object=drawn(h,'hw24_scarecrow_beige_ew_poh');assert.ok(object.getLocation().equals(target));assert.deepEqual(log.typed,[]);
 const face=object.getFace();
 objectClick(p,object,3);object=drawn(h,'hw24_scarecrow_beige_ew_poh');assert.equal(object.getFace(),(face+1)&3);
 objectClick(p,object,4);objectClick(p,drawn(h,'hw24_scarecrow_beige_ew_poh'),4);
 assert.equal(drawn(h,'hw24_scarecrow_beige_ew_poh').getFace(),(face+3)&3);
 assert.equal(h.extraObjects.length,1,'rotating replaces the object instead of stacking another');
});

test('a decoration whose garden was removed is forgotten on rebuild instead of standing in nothing',()=>{
 const {p}=player(),tree=c.getObjId('gub_wintumber_tree');p.getInventory().setItem(0,new core.Item(tree,1));
 const h=house(p),{stand,target}=gardenSpot(h);enter(p,h,stand);p.setPositionToFace(target);plantClick(p);ticks(3);
 const save=p.getAttribute('construction:house');save.rooms[1][4][4]=null;
 const again=new Instance.PlayerHouseInstance(save);again.owner=p;Decorations.refresh(again);
 assert.equal(again.extraObjects.length,0);assert.deepEqual(p.getAttribute('construction:holiday-decorations'),{});
});

test('Snow globe Shake plays the cache sequence; Snow sends the recorded tile spotanim twice',()=>{
 const {p,log}=player(),id=c.getObjId('xmas16_snowglobe');p.getInventory().setItem(0,new core.Item(id,1));
 p.moveTo(new core.Location(3222,3222,0));
 const click=option=>Items.handleAction(p,c.getComponentId('inventory:items'),id,0,c.getItem(id).inventoryActions.indexOf(option)+1);
 click('Shake');assert.deepEqual(log.anims,[c.getSeqId('xmas16_snowglobe_shake')]);
 const shown=[];const original=core.World.forEachNetworkPlayer;core.World.forEachNetworkPlayer=fn=>fn(p);
 try{
  click('Snow');const spot=c.getSpotanimId('druidicspirit_bloom_spotanim');
  assert.deepEqual(log.gfx,[[spot,30,150,3222,3222]]);ticks(1);
  assert.deepEqual(log.gfx,[[spot,30,150,3222,3222],[spot,15,150,3222,3222]]);
 }finally{core.World.forEachNetworkPlayer=original;}
 assert.equal(p.getInventory().getAmount(id),1);assert.deepEqual(log.messages,[]);
});

test('Cat ears Chase needs a Hell-Rat nearby, works worn and held, and Revert turns them back',()=>{
 const ears=c.getObjId('osb7_reward_cat_ears'),hell=c.getObjId('osb7_reward_hellcat_ears');
 const {p}=player();p.moveTo(new core.Location(3075,9870,0));
 p.getEquipment().setItem(core.Equipment.HEAD_SLOT,new core.Item(ears,1));
 const worn=option=>Items.handleAction(p,core.Equipment.INVENTORY_INTERFACE_ID,p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(),core.Equipment.HEAD_SLOT,
  2+Array.from({length:5},(_,i)=>c.getItem(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId()).params?.get?.(451+i)).indexOf(option));
 worn('Chase');assert.equal(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(),ears,'no Hell-Rat: nothing happens');
 // The real World NPC index: a registered Hell-Rat 10 tiles north.
 const rat=core.NPC.create(c.getNpcId('hundred_dave_hellrat'),new core.Location(3075,9880,0));
 rat.isRegistered=()=>true;core.World.registerNpcPosition(rat);
 try{
  worn('Chase');assert.equal(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(),hell);
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT,null);p.getInventory().setItem(0,new core.Item(hell,1));
  Items.handleAction(p,c.getComponentId('inventory:items'),hell,0,c.getItem(hell).inventoryActions.indexOf('Revert')+1);
  assert.equal(p.getInventory().getItems()[0].getId(),ears);
  p.moveTo(new core.Location(3075,9850,0));
  Items.handleAction(p,c.getComponentId('inventory:items'),ears,0,c.getItem(ears).inventoryActions.indexOf('Chase')+1);
  assert.equal(p.getInventory().getItems()[0].getId(),ears,'30 tiles away is not near');
  p.moveTo(new core.Location(3075,9870,0));
  Items.handleAction(p,c.getComponentId('inventory:items'),ears,0,c.getItem(ears).inventoryActions.indexOf('Chase')+1);
  assert.equal(p.getInventory().getItems()[0].getId(),hell);
 }finally{core.World.unregisterNpcPosition(rat);}
});

test('walking away during Plant cancels it without leaving the player stuck (reviewer reproduction)',()=>{
 const {p,log}=player(),tree=c.getObjId('gub_wintumber_tree');p.getInventory().setItem(0,new core.Item(tree,1));
 p.getIndex=()=>42;
 const h=house(p),{stand,target}=gardenSpot(h);enter(p,h,stand);p.setPositionToFace(target);
 plantClick(p);p.getMovementQueue().walkToReset();ticks(5);
 assert.equal(drawn(h,'gub_wintumber_tree_standard'),undefined);assert.equal(p.getInventory().getAmount(tree),1);
 log.anims.length=0;plantClick(p);assert.deepEqual(log.anims,[c.getSeqId('farming_trowel_dig')],'a new Plant starts');
 ticks(3);assert.ok(drawn(h,'gub_wintumber_tree_standard'));
});

test('a room moved, removed or rebuilt indoors under a drawn decoration is noticed by rebuild on the same instance (reviewer reproduction)',()=>{
 // Where the garden goes: another cell, nowhere, or its cell rebuilt as an indoor room.
 const edits={
  moved:(h,garden)=>{h.save.rooms[1][5][4]=garden;},
  removed:()=>{},
  indoors:h=>{h.save.rooms[1][4][4]={roomKey:'PARLOUR',rotation:0,furniture:{}};},
 };
 for(const [name,edit] of Object.entries(edits)){
  const {p}=player(`decor${name}`),tree=c.getObjId('gub_wintumber_tree');p.getInventory().setItem(0,new core.Item(tree,1));
  const h=house(p),{stand,target}=gardenSpot(h);enter(p,h,stand);p.setPositionToFace(target);plantClick(p);ticks(3);
  assert.ok(drawn(h,'gub_wintumber_tree_standard'),name);
  const garden=h.save.rooms[1][4][4];h.save.rooms[1][4][4]=null;edit(h,garden);
  h.rebuild(p,false);
  assert.equal(drawn(h,'gub_wintumber_tree_standard'),undefined,`${name}: the tree no longer stands there`);
  assert.equal(core.RegionManager.blocked(target,h),false,`${name}: its clipping is gone`);
  assert.deepEqual(p.getAttribute('construction:holiday-decorations'),{},`${name}: forgotten, so Diango replaces it`);
  const owned={player:p,itemIds:[]};HouseRewards.planted({core},owned);assert.deepEqual(owned.itemIds,[],name);
 }
});
