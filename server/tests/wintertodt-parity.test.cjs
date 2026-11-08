// Real registered plugins, Player/Inventory, Food action and CountdownTask; no runtime server.
const assert = require("node:assert/strict");
const path = require("node:path");
const {before,after,test}=require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline}=require("../dist/game/cache/CachePipeline");
const {PluginManager:PM}=require("../dist/plugins/PluginManager");
const {Player}=require("../dist/game/entity/impl/player/Player");
const {PlayerSession}=require("../dist/net/PlayerSession");
const {MagicOnItemPacketListener}=require("../dist/net/packet/impl/MagicOnItemPacketListener");
const Shared=require("../plugins/minigames/wintertodt/Shared.Wintertodt");
const Round=require("../plugins/minigames/wintertodt/Round.Wintertodt");
const Corners=require("../plugins/minigames/wintertodt/Corners.Wintertodt");
const Warmth=require("../plugins/minigames/wintertodt/Warmth.Wintertodt");
const Braziers=require("../plugins/minigames/wintertodt/Braziers.Wintertodt");
const {getRegisteredQuests}=require("../plugins/quests/QuestRuntime");
let core,I,next=1500;
const bites=new WeakMap(),delayed=new WeakMap();
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,".."));
 require("../dist/game/collision/RegionManager").RegionManager.init();
 PM.loadFromDirectory(path.resolve(__dirname,"../plugins"));core=PM.getCoreApi();I=core.ItemIdentifiers;
 PM.emitServerStartup({});
 const api=PM.createApi("WintertodtParityAssertions");
 api.onCustomEvent("food:eaten",event=>bites.set(event.player,(bites.get(event.player)||0)+1));
 api.onCustomEvent("food:delayed-heal",event=>delayed.set(event.player,[...(delayed.get(event.player)||[]),event]));
});
after(()=>{Round._round.active=false;PM.emitServerShutdown({});});
function actor(t,inside=true){
 const transport={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const p=new Player(new PlayerSession(transport));p.setIndex(next++);p.setUsername("WtParity"+next);p.setRegistered(true);p.setAttribute("bot-skip-persistence",true);
 p.setLocation(new core.Location(inside?1620:1630,inside?3996:3959,0));
 for(const skill of core.Skill.values()){
  p.getSkillManager().setMaxLevels(skill,99,false).setCurrentLevels(skill,99,false)
   .setExperiences(skill,core.SkillManager.getExperienceForLevel(99),false);
 }
 p.getInventory().resetItems();const messages=[];
 t.mock.method(p,"sendMessage",message=>{messages.push(message);});
 t.after(()=>{p.setRegistered(false);Round._round.active=false;});
 return{p,messages};
}
function tasks(t){
 const out=[];t.mock.method(core.TaskManager,"submit",task=>{task.setRunning(true);out.push(task);});
 return{out,tick(count){for(let n=0;n<count;n++)for(const task of [...out])if(task.isRunning())task.tick();}};
}
function eat(p,id,slot=0){
 p.getTimers().cancel(core.TimerKey.FOOD);p.getTimers().cancel(core.TimerKey.KARAMBWAN);
 const item=new core.Item(id,1);p.getInventory().setItem(slot,item);
 return PM.emitItemAction({player:p,item,itemId:id,slot,interfaceId:core.CacheDefinitions.getComponentId("inventory:items"),
 clickType:core.CacheDefinitions.getItem(id).inventoryActions.indexOf("Eat")+1,handled:false});
}
test("full-HP food uses potential restoration, while low-heal/excluded foods stay unchanged",t=>{
 const {p}=actor(t);Warmth.setWarmth(p,100);
 assert.equal(eat(p,I.SHARK),true);assert.equal(p.getHitpoints(),99);assert.equal(Warmth.warmthOf(p),450);
 eat(p,I.SHRIMPS);assert.equal(Warmth.warmthOf(p),450);
 eat(p,I.TRIANGLE_SANDWICH);assert.equal(Warmth.warmthOf(p),450);
});
test("capped Anglerfish and a nominal kebab heal can warm without actual HP gain",t=>{
 const {p}=actor(t);p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS,121);
 Warmth.setWarmth(p,100);eat(p,I.ANGLERFISH);assert.equal(p.getHitpoints(),121);assert.equal(Warmth.warmthOf(p),450);
 p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS,99);
 t.mock.method(Math,"random",()=>0.5);eat(p,I.KEBAB);assert.equal(p.getHitpoints(),99);assert.equal(Warmth.warmthOf(p),800);
});
test("hunter meat warms twice at the original seven-tick callback, but counts only one bite",t=>{
 const {p}=actor(t),clock=tasks(t);Warmth.setWarmth(p,100);eat(p,I.COOKED_GRAAHK);
 assert.equal(Warmth.warmthOf(p),450);assert.equal(bites.get(p),1);
 clock.tick(6);assert.equal(Warmth.warmthOf(p),450);
 clock.tick(1);assert.equal(Warmth.warmthOf(p),800);assert.equal(p.getHitpoints(),99);
 assert.equal(bites.get(p),1);assert.equal(p.getAttribute("food:eaten"),1);assert.equal(delayed.get(p).length,1);
 assert.equal(delayed.get(p)[0].heal,0);assert.equal(delayed.get(p)[0].restores,6);
});
test("replaced hunter healing only publishes its surviving callback and ignores a player outside",t=>{
 const {p}=actor(t),clock=tasks(t);Warmth.setWarmth(p,0);
 eat(p,I.COOKED_WILD_KEBBIT);clock.tick(3);eat(p,I.COOKED_GRAAHK,1);
 clock.tick(4);assert.equal(Warmth.warmthOf(p),700);assert.equal(delayed.get(p),undefined);
 p.setLocation(new core.Location(1630,3959,0));clock.tick(3);
 assert.equal(Warmth.warmthOf(p),700);assert.equal(delayed.get(p).length,1);assert.equal(bites.get(p),2);
});
test("ordinary food still heals outside the prison and a dead delayed target gets no extra pulse",t=>{
 const {p}=actor(t,false),clock=tasks(t);p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS,50);
 Warmth.setWarmth(p,100);eat(p,I.SHARK);assert.equal(p.getHitpoints(),70);assert.equal(Warmth.warmthOf(p),100);
 eat(p,I.COOKED_GRAAHK,1);p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS,0);clock.tick(7);
 assert.equal(delayed.get(p),undefined);
});
for(const [label,idKey,equipped]of[
 ["plain","HAMMER",false],["main-hand carried","IMCANDO_HAMMER",false],
 ["off-hand carried","IMCANDO_HAMMER_OFF_HAND_",false],["main-hand worn","IMCANDO_HAMMER",true],
 ["off-hand worn","IMCANDO_HAMMER_OFF_HAND_",true],
])test("brazier Fix accepts "+label+" hammer without changing its three-tick action",t=>{
 const {p}=actor(t),clock=tasks(t),id=I[idKey];assert.ok(Number.isInteger(id));Round._round.active=true;
 Corners.corner(0).brazier=Shared.BRAZIER.BROKEN;
 if(equipped)p.getEquipment().setItem(idKey==="IMCANDO_HAMMER"?core.Equipment.WEAPON_SLOT:core.Equipment.SHIELD_SLOT,new core.Item(id));
 else p.getInventory().setItem(0,new core.Item(id));
 const object=new core.GameObject(Shared.OBJECT.BRAZIER_BROKEN,new core.Location(1620,3997,0),10,0);
 if(equipped)Braziers.fix({player:p,object});
 else assert.equal(PM.emitItemOnObject({player:p,object,objectId:object.getId(),item:p.getInventory().getItems()[0],itemId:id,itemSlot:0,interfaceType:0,location:{x:1620,y:3997,z:0},handled:false}),true);
 clock.tick(2);assert.equal(Corners.corner(0).brazier,Shared.BRAZIER.BROKEN);
 clock.tick(1);assert.equal(Corners.corner(0).brazier,Shared.BRAZIER.UNLIT);
});
test("broken Imcando and missing hammers retain the existing refusal",t=>{
 const {p,messages}=actor(t),clock=tasks(t);Round._round.active=true;Corners.corner(0).brazier=Shared.BRAZIER.BROKEN;
 p.getInventory().setItem(0,new core.Item(I.IMCANDO_HAMMER_BROKEN_));
 const object=new core.GameObject(Shared.OBJECT.BRAZIER_BROKEN,new core.Location(1620,3997,0),10,0);
 Braziers.fix({player:p,object});assert.equal(messages.at(-1),"You need a hammer to fix this brazier.");assert.equal(clock.out.length,0);
});
test("High Alchemy is rejected before payment only in the active prison; Low Alchemy/camp/waiting remain allowed",t=>{
 const {p,messages}=actor(t);Round._round.active=true;
 const high=core.EffectSpells.HIGH_ALCHEMY,low=core.EffectSpells.LOW_ALCHEMY;
 p.getInventory().setItem(0,new core.Item(I.BRONZE_DAGGER));p.getInventory().setItem(1,new core.Item(I.NATURE_RUNE,2));p.getInventory().setItem(2,new core.Item(I.FIRE_RUNE,10));
 const xp=p.getSkillManager().getExperience(core.Skill.MAGIC);
 new MagicOnItemPacketListener().castAlchemy(p,high.spellId(),0,I.BRONZE_DAGGER);
 assert.equal(messages.at(-1),"That magic would interfere with the pyromancer's and is not permitted here.");
 assert.equal(p.getInventory().getAmount(I.BRONZE_DAGGER),1);assert.equal(p.getInventory().getAmount(I.NATURE_RUNE),2);
 assert.equal(p.getInventory().getAmount(I.COINS),0);assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC),xp);
 assert.notEqual(PM.emitSpellDisabled(p,core.MagicSpellbook.NORMAL,low.spellId(),low),true);
 p.setLocation(new core.Location(1630,3959,0));assert.notEqual(PM.emitSpellDisabled(p,core.MagicSpellbook.NORMAL,high.spellId(),high),true);
 p.setLocation(new core.Location(1620,3996,0));Round._round.active=false;assert.notEqual(PM.emitSpellDisabled(p,core.MagicSpellbook.NORMAL,high.spellId(),high),true);
});
function ingredients(p){
 p.getInventory().setItem(0,new core.Item(Shared.ITEM.BRUMA_HERB));
 p.getInventory().setItem(1,new core.Item(Shared.ITEM.REJUVENATION_UNF));
}
function mix(p){return PM.emitItemOnItem({player:p,usedItem:p.getInventory().getItems()[0],usedItemId:Shared.ITEM.BRUMA_HERB,usedItemSlot:0,
 usedWithItem:p.getInventory().getItems()[1],usedWithItemId:Shared.ITEM.REJUVENATION_UNF,usedWithItemSlot:1,handled:false});}
test("own rejuvenation mixing uses the real Druidic Ritual gate without consuming items or XP",t=>{
 const {p,messages}=actor(t);ingredients(p);
 const q=getRegisteredQuests().find(q=>q.key==="druidic_ritual");assert.ok(q);assert.equal(q.isComplete(p),false);
 const xp=p.getSkillManager().getExperience(core.Skill.HERBLORE);assert.equal(mix(p),true);
 assert.match(messages.at(-1),/complete the Druidic Ritual/);assert.equal(p.getInventory().getAmount(Shared.ITEM.BRUMA_HERB),1);
 assert.equal(p.getInventory().getAmount(Shared.ITEM.REJUVENATION_UNF),1);assert.equal(p.getSkillManager().getExperience(core.Skill.HERBLORE),xp);
});
test("Brew'ma mixes both without and with Druidic Ritual for zero XP; own unlocked mixing retains XP",t=>{
 const {p}=actor(t),clock=tasks(t),q=getRegisteredQuests().find(q=>q.key==="druidic_ritual");
 const npc=new core.NPC(core.NpcIdentifiers.BREWMA,new core.Location(1631,3980,0));
 for(const complete of[false,true]){
  if(complete)q.setStage(p,q.completionValue);
  ingredients(p);const xp=p.getSkillManager().getExperience(core.Skill.HERBLORE);
  PM.emitItemOnNpc({player:p,target:npc,npcId:npc.getId(),targetIndex:0,item:p.getInventory().getItems()[0],itemId:Shared.ITEM.BRUMA_HERB,slot:0,interfaceId:0,handled:false});
  assert.equal(p.getInventory().getAmount(Shared.ITEM.REJUVENATION_4),1);assert.equal(p.getSkillManager().getExperience(core.Skill.HERBLORE),xp);
  p.getInventory().resetItems();
 }
 ingredients(p);const xp=p.getSkillManager().getExperience(core.Skill.HERBLORE);assert.equal(mix(p),true);
 assert.equal(p.getInventory().getAmount(Shared.ITEM.REJUVENATION_4),1);assert.ok(p.getSkillManager().getExperience(core.Skill.HERBLORE)>xp);
});
