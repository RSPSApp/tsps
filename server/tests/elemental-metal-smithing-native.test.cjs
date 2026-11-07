// After yarn build: node --test tests/elemental-metal-smithing-native.test.cjs
// Registered machine setup with preowned materials and nearby placement; decoded target, not a quest playthrough.
const assert=require('node:assert/strict');
const path=require('node:path');
const {before,after,test}=require('node:test');
process.env.DISABLE_PLAYER_BOTS='1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {Inventory}=require('../dist/game/model/container/impl/Inventory');
const {PlayerSession}=require('../dist/net/PlayerSession');
const {ClientConnection}=require('../dist/net/NetworkBuilder');
const {SkillManager}=require('../dist/game/content/skill/SkillManager');
const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
const {ObjectDefinition}=require('../dist/game/definition/ObjectDefinition');
const {MAIN_PROFILE}=require('../dist/game/entity/impl/player/persistence/PlayerProfile');
const {isMembersWorld}=require('../dist/game/definition/WorldDefinition');
const Runtime=require('../plugins/quests/QuestRuntime');
let core,next=9100;
const errors=[],warnings=[],oldError=console.error,oldWarn=console.warn;
console.error=(...args)=>{errors.push(args);
oldError(...args);
};
console.warn=(...args)=>{if(args.some(x=>/hook.*(threw|error)/i.test(String(x)))) warnings.push(args);
oldWarn(...args);
};
before(async()=>{await CachePipeline.initialize(path.resolve(__dirname,'..'));PM.loadFromDirectory(path.resolve(__dirname,'../plugins'));core=PM.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(2720,9888);PM.emitServerStartup({});});
after(()=>{try{PM.emitServerShutdown({});}finally{console.error=oldError;console.warn=oldWarn;assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);}});
function skill(player,type,base,current=base){const s=player.getSkillManager();
s.setMaxLevels(type,base,false).setExperience(type,SkillManager.getExperienceForLevel(base)).setCurrentLevels(type,current,false);
assert.equal(s.getMaxLevel(type),base);
assert.equal(s.getCurrentLevel(type),current);
}
function quest(){const q=Runtime.getRegisteredQuests().findLast(x=>x.key==='elemental_workshop_i');
assert.ok(q);
return q;
}
function otherItems(player){const I=core.ItemIdentifiers,excluded=[I.ELEMENTAL_ORE,I.ELEMENTAL_METAL,I.COAL];
return player.getInventory().getItems().filter(x=>x&&x.getId()>=0&&!excluded.includes(x.getId())).map(x=>[x.getId(),x.getAmount(),JSON.stringify(x.getMeta())]);
}
function item(player,id){const slots=player.getInventory().getItems();
const slot=slots.findIndex(x=>x&&x.getId()===id);
assert.ok(slot>=0,`carried item ${id}`);
return {slot,value:slots[slot]};
}
function object(player,id,x,y){const loc=new core.Location(x,y,0);
const list=MapObjects.getObjectsAt(loc,player.getPrivateArea());
const obj=list.find(o=>o.getId()===id);
assert.ok(obj,`actual map object ${id} at ${x},${y}`);
const def=ObjectDefinition.forPlayer(obj.getId(),player);
assert.ok(def,`visible form for ${id}`);
assert.equal(MapObjects.getPrivateArea(player,def.id,loc),obj);
return {obj,def,loc};
}
function stand(player,obj,def){const loc=obj.getLocation(),type=obj.getType(),rect=[10,11,22].includes(type),footprint=type===22?def:ObjectDefinition.forId(obj.getId());
for(let dx=-2;dx<=5;dx++)for(let dy=-2;dy<=5;dy++){const p=new core.Location(loc.getX()+dx,loc.getY()+dy,loc.getZ());
if(core.RegionManager.blocked(p,player.getPrivateArea()))continue;
player.moveTo(p);
player.setNeedsPlacement(false);
if(core.PathFinder.reachedObject(player,loc.getX(),loc.getY(),rect?footprint.getSizeX():1,rect?footprint.getSizeY():1,obj.getFace(),rect?10:type,rect?def.getBlockingMask():0))return p;
}assert.fail('actual map has no reachable standing tile');
}
function interact(player,id,x,y,option){const {obj,def,loc}=object(player,id,x,y);
stand(player,obj,def);
const action=def.getInteractions().findIndex(x=>String(x).toLowerCase()===option.toLowerCase());
assert.ok(action>=0,`${id} active ${option}`);
assert.equal(PM.emitObjectInteraction({player,object:obj,objectId:obj.getId(),definition:def,location:{x:loc.getX(),y:loc.getY(),z:loc.getZ()},clickType:action+1,handled:false}),true);
}
function useSetup(player,itemId,id,x,y){const {obj,def,loc}=object(player,id,x,y),held=item(player,itemId);
stand(player,obj,def);
assert.equal(PM.emitItemOnObject({player,object:obj,objectId:obj.getId(),item:held.value,itemId,itemSlot:held.slot,interfaceType:Inventory.INTERFACE_ID,location:{x:loc.getX(),y:loc.getY(),z:loc.getZ()},handled:false}),true);
}
function actor(t,base,current=base,options={}){
 const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const player=new Player(new PlayerSession(channel)),name=`ewmetal${next++}`;
let playerSlot=null;
  t.after(() => {
    try {
      try { player.closeInterruptibleInterfaces(); }
      finally {
        core.TaskManager.cancelTasks(player);
        core.TaskManager.cancelTasks(player.getIndex());
      }
    } finally {
      if (player.isRegistered()) core.World.getPlayers().remove(player);
      assert.ok(!player.isRegistered());
      if (playerSlot !== null) assert.notEqual(core.World.getPlayers().get(playerSlot), player);
      assert.equal(core.MultiChatboxPrompt.getPending(player), null);
      assert.ok(player.getDialogueManager().getCurrent() == null);
      assert.equal(core.TaskManager.hasActiveTask(player), false);
      assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, []);
    }
  });
 player.setUsername(name);
player.setLongUsername(core.Misc.stringToLongBigInt(name));
assert.notEqual(player.getLongUsername(),0n);
player.setAttribute('bot-skip-persistence',true);
assert.equal(core.World.getPlayers().add(player),true);
playerSlot=player.getIndex();
assert.equal(core.World.getPlayers().get(playerSlot),player);
const initial=object(player,core.ObjectIdentifiers.ODD_LOOKING_WALL_8,2709,3495);
stand(player,initial.obj,initial.def);
assert.ok(player.getHitpoints()>0);
assert.equal(player.busy(),false);
 skill(player,core.Skill.SMITHING,base,current);
skill(player,core.Skill.CRAFTING,20);
skill(player,core.Skill.MINING,20);
 assert.equal(isMembersWorld(),true);
assert.equal(player.getProfile(),MAIN_PROFILE);
const league=require('../plugins/modes/league/Common.LeagueMode'),sentinel=Symbol('unanswered'),query={player,league:sentinel};
assert.equal(league.worldLeague(),null);
PM.emitCustomEvent('league:profile',query);
assert.equal(query.league,null);
 const I=core.ItemIdentifiers,inv=player.getInventory();
for(const id of [I.BATTERED_BOOK,I.KNIFE,I.NEEDLE,I.THREAD,I.LEATHER,I.A_STONE_BOWL,I.ELEMENTAL_ORE])inv.adds(id,1);
inv.adds(I.COAL,options.coal??4);
 assert.equal(quest().getStage(player),0);
const book=item(player,I.BATTERED_BOOK),actions=core.CacheDefinitions.getItem(I.BATTERED_BOOK).inventoryActions,read=actions.findIndex(x=>String(x).toLowerCase()==='read');
assert.ok(read>=0);
assert.equal(PM.emitItemAction({player,item:book.value,slot:book.slot,itemId:I.BATTERED_BOOK,interfaceId:Inventory.INTERFACE_ID,clickType:read+1,option:'Read',handled:false}),true);
assert.equal(quest().getStage(player)&2,2);
 const knife=item(player,I.KNIFE);
assert.equal(PM.emitItemOnItem({player,usedItem:knife.value,usedWithItem:book.value,usedItemId:I.KNIFE,usedWithItemId:I.BATTERED_BOOK,usedItemSlot:knife.slot,usedWithItemSlot:book.slot,handled:false}),true);
assert.ok(inv.getAmount(I.BATTERED_KEY)>0);
assert.ok(inv.getAmount(I.SLASHED_BOOK)>0);
 interact(player,core.ObjectIdentifiers.ODD_LOOKING_WALL_8,2709,3495,'Open');
interact(player,core.ObjectIdentifiers.STAIRCASE_10,2710,3497,'Climb-down');
assert.ok((quest().getStage(player)&(1<<13))!==0);
 interact(player,3403,2726,9908,'Turn');
interact(player,3404,2713,9908,'Turn');
interact(player,3406,2722,9906,'Pull');
interact(player,3407,2734,9882,'Fix');
interact(player,3409,2734,9887,'Pull');
if(options.unpowered)interact(player,3409,2734,9887,'Pull');
 if(!options.cold){useSetup(player,I.A_STONE_BOWL,18519,2718,9871);
useSetup(player,I.A_STONE_BOWL_2,3410,2725,9874);
}
 const stage=quest().getStage(player);
assert.equal(stage&(1<<5),1<<5);
assert.equal(stage&(1<<6),1<<6);
assert.equal(Boolean(stage&(1<<7)),!options.cold);
assert.equal(Boolean(stage&(1<<9)),!options.unpowered);
assert.equal(quest().isComplete(player),false);
 for(const [id,name] of [[I.ELEMENTAL_ORE,'elemental ore'],[I.COAL,'coal'],[I.ELEMENTAL_METAL,'elemental metal']]){const def=core.ItemDefinition.forId(id);
assert.equal(def.isNoted(),false);
assert.equal(def.getName().toLowerCase(),name);
}
 const furnace=object(player,3410,2725,9874);
assert.equal(furnace.def.id,options.cold?18525:18526);
const connection=new ClientConnection(channel);
connection.player=player;
player.getSession().setPlayer(player);
player.getSession().setTurnPacketProcessor(()=>connection.processTurnPackets());
 return {player,connection,furnace,base,current,smithXP:player.getSkillManager().getExperience(core.Skill.SMITHING),denied:(current<20||options.cold||options.unpowered||(options.coal??4)<4),stage,points:Number(player.getAttribute('quest.points'))||0};
}
async function smelt(f){const {player,connection}=f,I=core.ItemIdentifiers,loc=f.furnace.loc;
stand(player,f.furnace.obj,f.furnace.def);
assert.ok(player.getHitpoints()>0);
assert.equal(player.busy(),false);
assert.equal(player.getSkillManager().getExperience(core.Skill.SMITHING),f.smithXP);
const held=item(player,I.ELEMENTAL_ORE),beforeOthers=otherItems(player);
let calls=0,handled=false;
const original=PM.emitItemOnObject;
PM.emitItemOnObject=function(event){const selected=event.player===player&&event.itemId===I.ELEMENTAL_ORE;
if(selected){calls++;
assert.equal(event.object,f.furnace.obj);
assert.equal(event.objectId,3410);
assert.equal(event.itemSlot,held.slot);
}const result=original.call(this,event);
if(selected)handled=result;
return result;
};
try{await connection.dispatch([{type:'item_on_object',widgetId:Inventory.INTERFACE_ID,objectId:f.furnace.def.id,itemId:I.ELEMENTAL_ORE,slot:held.slot,x:loc.getX(),y:loc.getY()}]);
for(let i=0;i<20&&calls===0;i++)core.World.process();
assert.equal(calls,1,'decoded target reached registered consumer');
assert.equal(handled,true,'registered consumer handled actual furnace');
}finally{PM.emitItemOnObject=original;
}assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.SMITHING),f.current);
assert.equal(player.getSkillManager().getMaxLevel(core.Skill.SMITHING),f.base);
if(f.denied)assert.equal(player.getSkillManager().getExperience(core.Skill.SMITHING),f.smithXP);
assert.deepEqual(otherItems(player),beforeOthers);
assert.equal(quest().getStage(player),f.stage);
assert.equal(Number(player.getAttribute('quest.points'))||0,f.points);
}
test('ordinary Smithing 20 smelts elemental metal',async t=>{const f=actor(t,20);await smelt(f);const i=f.player.getInventory(),I=core.ItemIdentifiers;assert.equal(i.getAmount(I.ELEMENTAL_ORE),0);assert.equal(i.getAmount(I.COAL),0);assert.equal(i.getAmount(I.ELEMENTAL_METAL),1);});
test('Smithing 19 cannot smelt elemental metal',async t=>{const f=actor(t,19);await smelt(f);const i=f.player.getInventory(),I=core.ItemIdentifiers;assert.equal(i.getAmount(I.ELEMENTAL_ORE),1);assert.equal(i.getAmount(I.COAL),4);assert.equal(i.getAmount(I.ELEMENTAL_METAL),0);});
test('boosted Smithing 19 to 20 smelts elemental metal',async t=>{const f=actor(t,19,20);await smelt(f);const i=f.player.getInventory(),I=core.ItemIdentifiers;assert.equal(i.getAmount(I.ELEMENTAL_ORE),0);assert.equal(i.getAmount(I.COAL),0);assert.equal(i.getAmount(I.ELEMENTAL_METAL),1);});
test('cold furnace preserves the inputs',async t=>{const f=actor(t,20,20,{cold:true});await smelt(f);const i=f.player.getInventory(),I=core.ItemIdentifiers;assert.equal(i.getAmount(I.ELEMENTAL_ORE),1);assert.equal(i.getAmount(I.COAL),4);assert.equal(i.getAmount(I.ELEMENTAL_METAL),0);});
test('insufficient coal preserves the inputs',async t=>{const f=actor(t,20,20,{coal:3});await smelt(f);const i=f.player.getInventory(),I=core.ItemIdentifiers;assert.equal(i.getAmount(I.ELEMENTAL_ORE),1);assert.equal(i.getAmount(I.COAL),3);assert.equal(i.getAmount(I.ELEMENTAL_METAL),0);});
test('unpowered bellows preserve the inputs',async t=>{const f=actor(t,20,20,{unpowered:true});await smelt(f);const i=f.player.getInventory(),I=core.ItemIdentifiers;assert.equal(i.getAmount(I.ELEMENTAL_ORE),1);assert.equal(i.getAmount(I.COAL),4);assert.equal(i.getAmount(I.ELEMENTAL_METAL),0);});
