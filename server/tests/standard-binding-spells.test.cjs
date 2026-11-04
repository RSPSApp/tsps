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
test('blighted entangle sacks fund ordinary Bind, Snare and Entangle casts',async t=>{
 const SACK=24613,PLACEHOLDER=24614,RUNES=[555,557,561];
 const rows=[{name:'BIND',level:20,ticks:8},{name:'SNARE',level:50,ticks:16},{name:'ENTANGLE',level:79,ticks:24}];
 // Real plugin registration/dispatch, as in vengeance.test.cjs; no extracted first-hook shortcut.
 // Registration has this test process's lifetime, like the existing before() registrations.
 require('../plugins/items/BlightedSpellSacks.plugin').register(PluginManager.createApi('BindingSackTest'));
 assert.equal(core.ItemIdentifiers.BLIGHTED_ENTANGLE_SACK,SACK);
 assert.equal(core.ItemIdentifiers.BLIGHTED_ENTANGLE_SACK_2,PLACEHOLDER);
 const definition=new core.Item(SACK).getDefinition();
 assert.equal(definition.getName(),'Blighted entangle sack');
 assert.equal(definition.getPlaceholderId(),PLACEHOLDER);
 assert.equal(new core.Item(PLACEHOLDER).getDefinition().getPlaceholderId(),-1);

 function caster(st,row,{sacks=2,level=row.level,wild=true,book=core.MagicSpellbook.NORMAL}={}){
  const f=fixture(st,row.name);
  st.after(()=>{
   f.p.getInventory().resetItems();f.p.getEquipment().resetItems();
   f.target.getTimers().cancel(core.TimerKey.FREEZE);f.target.getTimers().cancel(core.TimerKey.FREEZE_IMMUNITY);
  });
  // The existing fixture seeds ordinary runes. Clear all of them before defining sack-only inputs.
  f.p.getInventory().resetItems();f.p.getEquipment().resetItems();
  f.p.setLocation(new core.Location(wild?3100:3200,wild?3600:3200));
  f.target.setLocation(new core.Location(wild?3101:3201,wild?3600:3200));
  f.p.setSpellbook(book);
  f.p.getSkillManager().setMaxLevel(core.Skill.MAGIC,level);
  f.p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,level,false);
  st.mock.method(core.WorldDefinition,'hasGlobalWorldTag',()=>false); // ordinary non-PvP world
  if(sacks)f.p.getInventory().add(new core.Item(SACK,sacks));
  assert.equal(f.p.isPlayerBot(),false);
  assert.deepEqual(f.p.getEquipment().getValidItems(),[]);
  assert.equal(core.Wilderness.levelAt(f.p.getLocation().getX(),f.p.getLocation().getY())>0,wild);
  assert.equal(f.p.getCombat().getTarget(),f.target);
  assert.equal(f.target.getHitpoints()>0,true);
  assert.equal(f.spell.canCastOnTarget(f.p,f.target),true);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.MAGIC),level);
  return f;
 }
 const amounts=f=>[SACK,...RUNES].map(id=>[id,f.p.getInventory().getAmount(id)]);
 const emptyEffect=f=>{
  assert.equal(f.target.getTimers().has(core.TimerKey.FREEZE),false);
  assert.equal(f.target.getTimers().has(core.TimerKey.FREEZE_IMMUNITY),false);
 };
 function refuses(f){
  const before=amounts(f);emptyEffect(f);
  assert.equal(f.spell.canCast(f.p,false),false);assert.equal(f.commit(),false);
  assert.deepEqual(amounts(f),before);emptyEffect(f);
 }
 for(const row of rows)await t.test(`${row.name}: one sack pays at level ${row.level}, hold ${row.ticks}+5`,st=>{
  const f=caster(st,row);emptyEffect(f);
  assert.deepEqual(f.p.getInventory().getValidItems().map(i=>[i.getId(),i.getAmount()]),[[SACK,2]]);
  for(let query=0;query<2;query++){
   assert.equal(f.spell.canCast(f.p,false),true,'eligible read-only query');
   assert.deepEqual(amounts(f),[[SACK,2],[555,0],[557,0],[561,0]]);emptyEffect(f);
  }
  assert.equal(f.commit(),true,'one ordinary committed cast');
  assert.deepEqual(amounts(f),[[SACK,1],[555,0],[557,0],[561,0]]);emptyEffect(f);
  assert.equal(f.commit(),false,'same-tick shared cooldown rejects duplicate payment');
  assert.deepEqual(amounts(f),[[SACK,1],[555,0],[557,0],[561,0]]);
  const hit=f.hit();assert.equal(hit.isAccurate(),true);f.impact(hit);
  const timers=f.target.getTimers();
  assert.equal(timers.getTicks(core.TimerKey.FREEZE),row.ticks);
  assert.equal(timers.getTicks(core.TimerKey.FREEZE_IMMUNITY),row.ticks+5);
  for(let tick=0;tick<row.ticks;tick++)timers.process();
  assert.equal(timers.has(core.TimerKey.FREEZE),false);assert.equal(timers.getTicks(core.TimerKey.FREEZE_IMMUNITY),5);
  for(let tick=0;tick<5;tick++)timers.process();emptyEffect(f);
  assert.deepEqual(amounts(f),[[SACK,1],[555,0],[557,0],[561,0]],'effect/timer processing never repays');
 });
 for(const row of rows)await t.test(`${row.name}: below required level preserves sacks`,st=>refuses(caster(st,row,{level:row.level-1})));
 const entangle=rows[2];
 await t.test('ordinary non-Wilderness land does not fund Entangle with a sack',st=>refuses(caster(st,entangle,{wild:false})));
 await t.test('no sack and no runes refuses Entangle',st=>refuses(caster(st,entangle,{sacks:0})));
 await t.test('wrong spellbook preserves both sacks',st=>refuses(caster(st,entangle,{book:core.MagicSpellbook.ANCIENT})));
 for(const[key,label]of [[core.TimerKey.FREEZE,'FREEZE'],[core.TimerKey.FREEZE_IMMUNITY,'FREEZE_IMMUNITY']])await t.test(`target timer ${label} refuses without paying`,st=>{
  const f=caster(st,entangle);f.target.getTimers().registers(key,7);const before=amounts(f);
  assert.equal(f.spell.canCast(f.p,false),false);assert.equal(f.commit(),false);
  assert.deepEqual(amounts(f),before);assert.equal(f.target.getTimers().getTicks(key),7);
 });
 await t.test('ordinary runes still pay one Entangle without any sack',st=>{
  const f=caster(st,entangle,{sacks:0});
  for(const[id,n]of [[555,5],[557,5],[561,4]])f.p.getInventory().add(new core.Item(id,n));
  assert.equal(f.spell.canCast(f.p,false),true);assert.deepEqual(amounts(f),[[SACK,0],[555,5],[557,5],[561,4]]);
  assert.equal(f.commit(),true);assert.deepEqual(amounts(f),[[SACK,0],[555,0],[557,0],[561,0]]);
  const hit=f.hit();assert.equal(hit.isAccurate(),true);f.impact(hit);
  assert.equal(f.target.getTimers().getTicks(core.TimerKey.FREEZE),24);
 });
 await t.test('a committed splash spends one sack but never binds',st=>{
  const f=caster(st,entangle);f.p.setAttribute(PROBE,false);
  st.mock.method(AccuracyFormulasDpsCalc,'rollAccuracy',()=>false);
  assert.equal(f.commit(),true);assert.deepEqual(amounts(f),[[SACK,1],[555,0],[557,0],[561,0]]);
  const hit=f.hit();assert.equal(hit.isAccurate(),false);f.impact(hit);emptyEffect(f);
  assert.deepEqual(amounts(f),[[SACK,1],[555,0],[557,0],[561,0]]);
 });
});
