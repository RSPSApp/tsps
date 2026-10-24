const assert=require('node:assert/strict');
const {before,test}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {AccuracyFormulasDpsCalc}=require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const Common=require('../plugins/items/elementaltomes/Common.ElementalTomes');
const core=PluginManager.getCoreApi(),PROBE='standard-bindings-test:accurate';
before(async()=>{
 await CachePipeline.initialize(process.cwd());
 require('../plugins/items/ElementalTomes.plugin').register(PluginManager.createApi('BindingTomeTest'));
 require('../plugins/combat/StandardCurses.plugin').register(PluginManager.createApi('BindingCurseTest'));
 require('../plugins/combat/StandardBindings.plugin').register(PluginManager.createApi('StandardBindingTest'));
 PluginManager.createApi('BindingProbe').onCombatHitRoll(event=>{if(event.attacker.getAttribute?.(PROBE))event.forceAccurate=true;});
});
function fixture(t,name='BIND',pvp=false){
 let tick=10;t.mock.method(core.World,'getProcessCycle',()=>tick);t.mock.method(Date,'now',()=>tick*600);t.mock.method(core.Sounds,'sendSound',()=>{});
 const p=new Player(null),messages=[];t.mock.method(p,'getSession',()=>({sendClientPacket:()=>true}));t.mock.method(p,'sendMessage',m=>messages.push(m));
 p.setAttribute(PROBE,true);p.getSkillManager().setMaxLevel(core.Skill.MAGIC,99);p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,99,false);
 const target=pvp?new Player(null):new core.NPC(core.NpcIdentifiers.MAN,new core.Location(3200,3200));
 if(pvp){t.mock.method(target,'getSession',()=>({sendClientPacket:()=>true}));t.mock.method(target,'sendMessage',()=>{});}
 t.mock.method(target,'getHitpoints',()=>200);
 t.mock.method(target,'getSize',()=>1);t.mock.method(p.getCombat(),'getTarget',()=>target);
 const spell=core.CombatSpells[name];p.getCombat().setCastSpell(spell);
 for(const rune of spell.itemsRequired(p))p.getInventory().add(new core.Item(rune.getId(),rune.getAmount()*10));
 return{p,target,spell,messages,next(){tick++;},commit(){return spell.canCast(p,true);},hit(){return new core.MagicCombatMethod().hits(p,target)[0];},impact(hit){new core.MagicCombatMethod().handleAfterHitEffects(hit);}};
}
function armour(f,count){
 const I=core.ItemIdentifiers,E=core.Equipment;
 for(const [index,[slot,id]]of [[E.HEAD_SLOT,I.SWAMPBARK_HELM],[E.BODY_SLOT,I.SWAMPBARK_BODY],[E.LEG_SLOT,I.SWAMPBARK_LEGS]].entries()){
  f.p.getEquipment().getItems()[slot]=new core.Item(index<count?id:-1);
 }
}
test('Snare is free-to-play and pays four Water, four Earth and three Nature runes',t=>{
 const f=fixture(t,'SNARE'),I=core.ItemIdentifiers;
 assert.equal(f.spell.isMembers(),false);assert.equal(core.CombatSpells.ENTANGLE.isMembers(),true);
 for(const [id,count]of [[I.WATER_RUNE,4],[I.EARTH_RUNE,4],[I.NATURE_RUNE,3]]){
  f.p.getInventory().deleteNumber(id,f.p.getInventory().getAmount(id));f.p.getInventory().add(new core.Item(id,count));
 }
 f.p.getInventory().deleteNumber(I.WATER_RUNE,1);assert.equal(f.spell.canCast(f.p,false),false);
 f.p.getInventory().add(new core.Item(I.WATER_RUNE));assert.equal(f.commit(),true);
 for(const id of [I.WATER_RUNE,I.EARTH_RUNE,I.NATURE_RUNE])assert.equal(f.p.getInventory().getAmount(id),0);
});
test('canonical Bind/Snare/Entangle maxima feed the real hit roller, including a true zero',t=>{
 for(const [name,max]of [['BIND',0],['SNARE',2],['ENTANGLE',5]]){
  const f=fixture(t,name);assert.equal(f.spell.maximumHit(),max,name);
  t.mock.method(core.Misc,'randomInclusive',(_min,maximum)=>maximum);
  assert.equal(f.commit(),true);assert.equal(f.hit().getTotalDamage(),max,name);
 }
});
test('accurate binding impacts hold for8/16/24 exact ticks followed by5 immunity ticks',t=>{
 for(const [name,ticks]of [['BIND',8],['SNARE',16],['ENTANGLE',24]]){
  const f=fixture(t,name);assert.equal(f.commit(),true);f.impact(f.hit());const timers=f.target.getTimers();
  assert.equal(timers.getTicks(core.TimerKey.FREEZE),ticks,name);
  assert.equal(timers.getTicks(core.TimerKey.FREEZE_IMMUNITY),ticks+5,name);
  for(let n=1;n<ticks;n++)timers.process();assert.equal(timers.has(core.TimerKey.FREEZE),true);
  timers.process();assert.equal(timers.has(core.TimerKey.FREEZE),false);assert.equal(timers.getTicks(core.TimerKey.FREEZE_IMMUNITY),5);
  for(let n=0;n<5;n++)timers.process();assert.equal(timers.has(core.TimerKey.FREEZE_IMMUNITY),false);
 }
});
test('only the three main Swampbark pieces add2 ticks each, up to the published maxima',t=>{
 for(const [name,base]of [['BIND',8],['SNARE',16],['ENTANGLE',24]])for(let count=0;count<=3;count++){
  const f=fixture(t,name);armour(f,count);
  f.p.getEquipment().getItems()[core.Equipment.HANDS_SLOT]=new core.Item(core.ItemIdentifiers.SWAMPBARK_GAUNTLETS);
  f.p.getEquipment().getItems()[core.Equipment.FEET_SLOT]=new core.Item(core.ItemIdentifiers.SWAMPBARK_BOOTS);
  assert.equal(f.commit(),true);f.impact(f.hit());assert.equal(f.target.getTimers().getTicks(core.TimerKey.FREEZE),base+count*2,name+' '+count);
 }
});
test('launched duration survives gear removal and later casts; newly worn armour cannot boost it',t=>{
 for(const count of [0,3]){
  const f=fixture(t,'ENTANGLE');armour(f,count);assert.equal(f.commit(),true);const hit=f.hit();
  armour(f,3-count);f.next();
  for(const id of [core.ItemIdentifiers.FIRE_RUNE,core.ItemIdentifiers.AIR_RUNE,core.ItemIdentifiers.MIND_RUNE])f.p.getInventory().add(new core.Item(id,5));
  f.p.getCombat().setCastSpell(core.CombatSpells.FIRE_STRIKE);assert.equal(core.CombatSpells.FIRE_STRIKE.canCast(f.p,true),true);
  f.impact(hit);
  assert.equal(f.target.getTimers().getTicks(core.TimerKey.FREEZE),24+count*2);
 }
});
test('held or immune targets refuse before spending runes or a Water tome charge',t=>{
 for(const name of ['BIND','SNARE','ENTANGLE'])for(const key of [core.TimerKey.FREEZE,core.TimerKey.FREEZE_IMMUNITY]){
  const f=fixture(t,name),book=new core.Item(core.ItemIdentifiers.TOME_OF_WATER_EMPTY_);
  Common.set(book,Common.getDefinition(book.getId()),1,core.ItemIdentifiers.SOAKED_PAGE);f.p.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=book;
  f.target.getTimers().registers(key,5);const inventory=JSON.stringify(f.p.getInventory().getItems());
  assert.equal(f.spell.canCast(f.p,false),false,name);assert.equal(f.commit(),false,name);
  assert.equal(JSON.stringify(f.p.getInventory().getItems()),inventory);assert.equal(Common.read(book).charges,1);
  assert.ok(f.messages.some(m=>/already held|currently immune/.test(m)));
 }
});
test('an intervening hold or immunity before impact cannot be extended or replaced',t=>{
 for(const key of [core.TimerKey.FREEZE,core.TimerKey.FREEZE_IMMUNITY]){
  const f=fixture(t,'ENTANGLE');assert.equal(f.commit(),true);const hit=f.hit();f.target.getTimers().registers(key,7);
  f.impact(hit);assert.equal(f.target.getTimers().getTicks(key),7);
 }
});
test('player targets keep the full hold and grace durations with Protect from Magic',t=>{
 for(const [name,ticks]of [['BIND',8],['SNARE',16],['ENTANGLE',24]]){
  const f=fixture(t,name,true);
  t.mock.method(core.PrayerHandler,'isActivated',(player,prayer)=>player===f.target&&prayer===core.PrayerHandler.PROTECT_FROM_MAGIC);
  assert.equal(f.commit(),true);f.impact(f.hit());
  assert.equal(f.target.getTimers().getTicks(core.TimerKey.FREEZE),ticks,name);
  assert.equal(f.target.getTimers().getTicks(core.TimerKey.FREEZE_IMMUNITY),ticks+5,name);
 }
});
test('splashes never bind, and unrelated curses and existing large-NPC immunity remain intact',t=>{
 const splash=fixture(t);splash.p.setAttribute(PROBE,false);t.mock.method(AccuracyFormulasDpsCalc,'rollAccuracy',()=>false);
 assert.equal(splash.commit(),true);const missed=splash.hit();assert.equal(missed.isAccurate(),false);splash.impact(missed);
 assert.equal(splash.target.getTimers().has(core.TimerKey.FREEZE),false);
 const curse=fixture(t,'CONFUSE');assert.equal(curse.commit(),true);curse.impact(curse.hit());assert.equal(curse.target.getTimers().has(core.TimerKey.FREEZE),false);
 const large=fixture(t,'ENTANGLE');t.mock.method(large.target,'getSize',()=>3);assert.equal(large.commit(),true);large.impact(large.hit());assert.equal(large.target.getTimers().has(core.TimerKey.FREEZE),false);
 large.target.setFlag('combat:freezable',true);large.impact(large.hit());assert.equal(large.target.getTimers().getTicks(core.TimerKey.FREEZE),24);
});
