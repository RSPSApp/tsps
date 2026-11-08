const assert=require("node:assert/strict"),path=require("node:path");
const {before,after,test}=require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline}=require("../dist/game/cache/CachePipeline");
const {NpcDefinitionLoader}=require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const {PluginManager:PM}=require("../dist/plugins/PluginManager");
const {Player}=require("../dist/game/entity/impl/player/Player");
const {PlayerSession}=require("../dist/net/PlayerSession");
const {NPC}=require("../dist/game/entity/impl/npc/NPC");
const {AccuracyFormulasDpsCalc:A}=require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const {CombatFactory:CF}=require("../dist/game/content/combat/CombatFactory");
const {BonusManager}=require("../dist/game/model/equipment/BonusManager");
const Rev=require("../plugins/items/RevenantWeapons.plugin")._test;
let core,rolled,index=1550;
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,".."));new NpcDefinitionLoader().load();
 PM.loadFromDirectory(path.resolve(__dirname,"../plugins"));core=PM.getCoreApi();PM.emitServerStartup({});
 PM.createApi("RevenantStackingTest").onCustomEvent("combat:hit-rolled",e=>{rolled=e.maximum;});
});
after(()=>PM.emitServerShutdown({}));
function fixture(t,id=22550,magic=false){
 const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("revstack"+index);p.setLocation(new core.Location(3100,3600,0));
 for(const s of [core.Skill.ATTACK,core.Skill.STRENGTH,core.Skill.RANGED,core.Skill.MAGIC])p.getSkillManager().setMaxLevel(s,99).setCurrentLevel(s,99,false);
 const target=new NPC(70,new core.Location(3101,3600,0));assert.equal(target.getCurrentDefinition().hasAttribute("undead"),true);
 p.getCombat().setTarget(target);const item=new core.Item(id);p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]=item;
 const sceptre=require("../plugins/items/AccursedSceptre.plugin")._test;
 item.setMetaValue(magic?sceptre.CHARGES_KEY:Rev.CHARGES_META,100);if(!magic)item.setMetaValue(Rev.DEPOSIT_META,true);
 if(magic)p.getCombat().setCastSpell(sceptre.sceptre.spellFor(p));
 BonusManager.update(p);
 t.after(()=>core.TaskManager.cancelTasks(p.getIndex()));
 return {p,item,target};
}
function equip(f,slot,id){f.p.getEquipment().getItems()[slot]=new core.Item(id);BonusManager.update(f.p);}
function sample(f,type,wild=true){
 f.target.setLocation(new core.Location(3101,wild?3600:3490,0));A.clearRollCache(f.p);
 const attack=A.specialRolls(f.p,f.target,type).attack,old=Math.random;
 try{Math.random=()=>0;CF.rollHitDamage(f.p,f.target,type,true,undefined,false,false);}finally{Math.random=old;}
 return {attack,max:rolled};
}
function task(f,on){
 const data=require("../plugins/skills/slayer/Data.Slayer"),id=[...data.get().taskById.keys()].find(id=>data.npcCountsFor(id,70,"Skeleton"));
 assert.notEqual(id,undefined);
 for(const [name,val]of [["slayer_target",id],["slayer_count",on?10:0],["slayer_count_original",10]])f.p.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId(name),val);
 const q={player:f.p,npc:f.target,onTask:false};PM.emitCustomEvent("slayer:on-task",q);assert.equal(q.onTask,on);
}
test("four real equipped weapons multiply each supported Salve boost and retain outside/non-undead controls",t=>{
 for(const [id,type]of [[22545,"MELEE"],[27660,"MELEE"],[22550,"RANGED"],[22555,"MAGIC"]]){
  const f=fixture(t,id,type==="MAGIC"),ct=core.CombatType[type],base=sample(f,ct,false);
  for(const [amulet,num,den]of [[4081,7,6],[10588,6,5],[12017,type==="MAGIC"?115:7,type==="MAGIC"?100:6],[12018,6,5]]){
   equip(f,core.Equipment.AMULET_SLOT,amulet);
   const supported=type==="MELEE"||amulet===12017||amulet===12018;
   const outside=sample(f,ct,false),wild=sample(f,ct,true);
   assert.deepEqual(outside,{attack:supported?Math.floor(base.attack*num/den):base.attack,max:supported?Math.floor(base.max*num/den):base.max},String(id)+"/"+amulet);
   assert.deepEqual(wild,{attack:Math.floor(outside.attack*3/2),max:Math.floor(outside.max*3/2)});
   const live=f.target;f.target=new NPC(1,new core.Location(3101,3600,0));assert.equal(f.target.getCurrentDefinition().hasAttribute("undead"),false);f.p.getCombat().setTarget(f.target);
   assert.deepEqual(sample(f,ct,false),base,"Salve never boosts non-undead");
   f.target=live;f.p.getCombat().setTarget(live);
  }
 }
});
test("Craw damage adds50% to the imbued task15%; accuracy remains multiplicative",t=>{
 const f=fixture(t);equip(f,core.Equipment.HEAD_SLOT,core.ItemIdentifiers.SLAYER_HELMET_I_);
 const base=sample(f,core.CombatType.RANGED,false);task(f,true);
 const outside=sample(f,core.CombatType.RANGED,false),wild=sample(f,core.CombatType.RANGED,true);
 assert.equal(outside.max,Math.floor(base.max*23/20));
 assert.equal(wild.max,Math.floor(base.max*33/20),"Wiki DPS701b2dac: needRevWeaponBonus adds10/20 once");
 assert.equal(wild.attack,Math.floor(Math.floor(base.attack*23/20)*3/2),"accuracy is not the additive damage rule");
 f.item.setMetaValue(Rev.CHARGES_META,1);assert.equal(Rev.decrementAmmo(f.p),true);assert.equal(Rev.chargesOf(f.item),0);
 assert.equal(sample(f,core.CombatType.RANGED,true).max,wild.max,"last paid charge still supplies the additive damage boost");
 const cycle=core.World.getProcessCycle();t.mock.method(core.World,"getProcessCycle",()=>cycle+1);
 assert.equal(sample(f,core.CombatType.RANGED,true).max,outside.max,"without a charge next cycle, only Slayer applies");
});
test("Salve ranged variants suppress task stacking; plain variants leave the task bonus applicable",t=>{
 const f=fixture(t);equip(f,core.Equipment.HEAD_SLOT,core.ItemIdentifiers.SLAYER_HELMET_I_);
 for(const amulet of [4081,10588,12017,12018]){
  equip(f,core.Equipment.AMULET_SLOT,amulet);task(f,false);const base=sample(f,core.CombatType.RANGED,false),off=sample(f,core.CombatType.RANGED,true);task(f,true);const on=sample(f,core.CombatType.RANGED,true);
  if(amulet===12017||amulet===12018)assert.deepEqual(on,off,"Salve wins instead of combining with Slayer");
  else assert.equal(on.max,Math.floor(base.max*33/20),"melee-only Salve does not suppress ranged Slayer");
 }
});

