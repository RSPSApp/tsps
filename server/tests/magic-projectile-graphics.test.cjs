const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const core = PluginManager.getCoreApi();
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/combat/StandardBindings.plugin").register(PluginManager.createApi("ProjectileGraphicBindings"));
});
let index = 1500;
function actor(t, x) {
  const channel = { kind:"test", remoteAddress:"127.0.0.1", isOpen:()=>true, send:()=>true, close(){}, onData(){}, onError(){}, onClose(){} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername("visual"+p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(x,3200,0)); p.needsPlacement=false;
  t.mock.method(p.getSession(), "sendClientPacket", () => true);
  t.mock.method(p, "sendMessage", () => {});
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC,99);
  p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,99,false);
  t.after(()=>{p.getCombat().getHitQueue().clear();p.setRegistered(false);});
  return p;
}
function fixture(t, {distance=3, accurate=true, pvp=false, spellName="FIRE_WAVE", configure, paid=true}={}) {
  let cycle=100;
  t.mock.method(core.World,"getProcessCycle",()=>cycle);
  t.mock.method(Date,"now",()=>cycle*600);
  t.mock.method(AccuracyFormulasDpsCalc,"rollAccuracy",()=>accurate);
  t.mock.method(core.Misc,"randomInclusive",()=>2);
  const caster=actor(t,3200), target=pvp?actor(t,3200+distance):new core.NPC(4176,new core.Location(3200+distance,3200,0));
  if(!pvp){target.setIndex(5000+index++);target.setRegistered(true);target.needsPlacement=false;t.after(()=>{target.getCombat().getHitQueue().clear();target.setRegistered(false);});}
  const spell=core.CombatSpells[spellName],method=new core.MagicCombatMethod(),graphics=[],projectiles=[],sounds=[],callbacks=[];
  t.mock.method(core.World,"forEachNetworkPlayer",fn=>fn(caster));
  t.mock.method(caster.getPacketSender(),"sendProjectile",(...args)=>projectiles.push(args));
  const perform=target.performGraphic.bind(target);
  t.mock.method(target,"performGraphic",g=>{graphics.push({cycle,g});perform(g);});
  t.mock.method(core.Sounds,"sendSound",()=>{});
  t.mock.method(core.Sounds,"playAreaSoundAt",(...args)=>sounds.push({cycle,args}));
  // The cast-time impact sound (live: sent with the cast, delayed to the projectile's end; 227/00102 tick 232).
  // The cast sound's area copy for bystanders (sent at the caster, undelayed) is kept apart from the impact sound.
  const castSoundId=core.MagicCombatMethod.castSoundFor(spell)?.getId(),castSounds=[];
  t.mock.method(core.Sounds,"playAreaSound",(sound)=>(sound.soundId===castSoundId&&sound.source===caster?castSounds:sounds).push({cycle,args:[sound],delay:sound.delay}));
  const finish=spell.finishCast.bind(spell);
  t.mock.method(spell,"finishCast",(...args)=>{callbacks.push({cycle,args});return finish(...args);});
  caster.getCombat().setCastSpell(spell);
  t.mock.method(caster.getCombat(),"getTarget",()=>target);
  if(configure)configure({caster,target,spell});
  caster.setSpellbook(spell.getSpellbook());
  for(const rune of spell.itemsRequired(caster)??[])caster.getInventory().add(new core.Item(rune.getId(),rune.getAmount()*5));
  if(paid)assert.equal(spell.canCast(caster,true),true,"real paid cast");
  method.start(caster,target);
  const hit=method.hits(caster,target)[0];
  const beforeHP=target.getHitpoints();
  return {caster,target,spell,method,hit,graphics,projectiles,sounds,castSounds,callbacks,beforeHP,
    context:hit.getSpellContext(), cycle:()=>cycle,
    next(){cycle++;target.resetUpdating();},
    land(){core.CombatFactory.addPendingHit(hit);const due=cycle+hit.getDelay()+core.CombatFactory.hitProcessingDelay(hit);while(cycle<due){target.getCombat().getHitQueue().process(cycle);cycle++;target.resetUpdating();}target.getCombat().getHitQueue().process(cycle);return due;}
  };
}
for(const distance of[1,3])for(const accurate of[true,false])test(`Fire Wave NPC ${accurate?"impact":"splash"} queues at cast at distance${distance}, damage and callbacks wait`,t=>{
  const f=fixture(t,{distance,accurate});
  assert.equal(f.projectiles.length,1);
  assert.deepEqual([f.projectiles[0][3],f.projectiles[0][8]],[distance===1?56:76,51],"native projectile end/start cycles");
  assert.equal(f.graphics.length,1,"target visual sent in cast tick");
  const g=f.graphics[0].g;
  assert.equal(g.getId(),accurate?f.spell.endGraphic().getId():core.MagicCombatMethod.SPLASH_GRAPHIC.getId());
  assert.equal(g.getDelay(),distance===1?56:76);
  assert.equal(g.getHeight(),accurate?f.spell.endGraphic().getHeight():core.MagicCombatMethod.SPLASH_GRAPHIC.getHeight());
  assert.equal(f.target.getHitpoints(),f.beforeHP);assert.equal(f.callbacks.length,0);
  assert.equal(f.castSounds.length,1,"the cast sound's area copy at the caster");assert.equal(f.castSounds[0].args[0].exclude,f.caster);
  assert.equal(f.sounds.length,1,"the impact sound goes out with the cast");assert.equal(f.sounds[0].delay,distance===1?56:76,"delayed to the projectile's end, as the graphic");
  const castCycle=f.cycle();
  assert.equal(f.land(),distance===1?102:103,"unchanged NPC hit processing deadline");
  assert.equal(f.target.getHitpoints(),f.beforeHP-(accurate?2:0));
  assert.equal(f.graphics.length,1,"no second impact graphic");
  assert.equal(f.callbacks.length,1);assert.equal(f.callbacks[0].cycle,f.cycle());assert.equal(f.callbacks[0].args[4],f.context);
  assert.equal(f.sounds.length,1,"no second sound at landing");assert.equal(f.sounds[0].cycle,castCycle);
});
test("Fire Wave on a player queues its impact graphic for the projectile end, like an NPC",t=>{
  const f=fixture(t,{distance:3,pvp:true});
  assert.equal(f.graphics.length,1,"target visual sent in cast tick");
  assert.equal(f.graphics[0].g.getDelay(),76);
  f.land();assert.equal(f.graphics.length,1,"no second impact graphic");
});
for(const mode of["fixed","custom-projectile","no-projectile","no-context","arceuus","aoe"])test(`${mode} retains impact-time graphic fallback`,t=>{
  const options={paid:mode!=="no-context",configure:({spell})=>{
    if(mode==="fixed")t.mock.method(spell,"hitDelay",()=>1);
    if(mode==="custom-projectile")t.mock.method(spell,"castProjectile",(a,b)=>core.Projectile.createProjectile(a,b,156,30,90,43,31));
    if(mode==="no-projectile")t.mock.method(spell,"castProjectile",()=>null);
    if(mode==="arceuus")t.mock.method(spell,"getSpellbook",()=>core.MagicSpellbook.ARCEUUS);
    if(mode==="aoe"){spell.spellRadius=()=>1;t.after(()=>delete spell.spellRadius);}
  }};
  const f=fixture(t,options);assert.equal(f.graphics.length,0,"no new cast-time graphic");f.land();
  assert.equal(f.graphics.length,1);assert.equal(f.graphics[0].g.getDelay(),0);assert.equal(f.callbacks.length,1);
});
test("queued visual ownership is the original paid cast and target, even across later casts",t=>{
  const f=fixture(t),old=f.context;
  f.next();assert.equal(f.spell.canCast(f.caster,true),true);
  const later=core.Spell.getCastContext(f.caster,f.spell);assert.notEqual(later,old);
  assert.equal(f.spell.getProjectileVisual(old,f.target).queued,true);
  const other=new core.NPC(4176,f.target.getLocation().clone());other.setIndex(f.target.getIndex());
  assert.equal(f.spell.getProjectileVisual(old,other),null,"index reuse cannot claim the visual");
  assert.equal(f.spell.getProjectileVisual(later,f.target),null,"later cast has no sent projectile yet");
  f.method.handleAfterHitEffects(f.hit);assert.equal(f.graphics.length,1,"old hit still suppresses its own duplicate");
});
test("a delayed graphic copy preserves height and priority without mutating the original",()=>{
  for(const height of[core.GraphicHeight.LOW,core.GraphicHeight.HIGH]){
    const original=new core.Graphic(157,height,core.Priority.HIGH),copy=original.withDelay(76);
    assert.notEqual(copy,original);assert.equal(copy.getId(),157);assert.equal(copy.getHeight(),height);
    assert.equal(copy.getPriority(),core.Priority.HIGH);assert.equal(copy.getDelay(),76);assert.equal(original.getDelay(),0);
  }
});
test("binding debuff still starts at the resolved hit, not the queued graphic",t=>{
  const f=fixture(t,{spellName:"ENTANGLE"});assert.equal(f.graphics.length,1);
  assert.equal(f.target.getTimers().has(core.TimerKey.FREEZE),false);
  f.land();assert.equal(f.target.getTimers().getTicks(core.TimerKey.FREEZE),24);assert.equal(f.callbacks.length,1);
});

test("the actual Arceuus grasp keeps its own cast-time30-cycle visual and impact callback",t=>{
  const f=fixture(t,{spellName:"UNDEAD_GRASP"});
  assert.equal(f.graphics.length,1);assert.equal(f.graphics[0].g.getDelay(),30);
  f.land();assert.equal(f.graphics.length,1);assert.equal(f.callbacks.length,1);
});
test("the actual ancient AoE keeps its existing impact-time graphic",t=>{
  const f=fixture(t,{spellName:"ICE_BURST"});assert.equal(f.graphics.length,0);
  f.land();assert.equal(f.graphics.length,1);assert.equal(f.graphics[0].g.getDelay(),0);assert.equal(f.callbacks.length,1);
});

test("an overlapping legacy shot whose encoded end precedes launch keeps the existing fallback",t=>{
  const f=fixture(t,{distance:0});assert.equal(f.graphics.length,0);
  assert.deepEqual([f.projectiles[0][3],f.projectiles[0][8]],[46,51]);
  f.land();assert.equal(f.graphics.length,1);assert.equal(f.graphics[0].g.getDelay(),0);
});

for(const accurate of[true,false])test(`a higher-priority NPC graphic keeps the ${accurate?"impact":"splash"} fallback when the cast-time visual is rejected`,t=>{
  const f=fixture(t,{accurate,configure:({target})=>target.performGraphic(new core.Graphic(369,core.GraphicHeight.LOW,core.Priority.HIGH))});
  assert.equal(f.target.getGraphic().getId(),369,"the higher-priority graphic still owns the cast tick");
  assert.equal(f.spell.getProjectileVisual(f.context,f.target).queued,false,"a rejected graphic must not suppress the later visual");
  f.land();
  assert.equal(f.target.getGraphic().getId(),accurate?f.spell.endGraphic().getId():core.MagicCombatMethod.SPLASH_GRAPHIC.getId());
  assert.equal(f.target.getGraphic().getDelay(),0,"the existing impact-time path remains available");
  assert.equal(f.callbacks.length,1);assert.equal(f.sounds.length,1,"the sound went out with the cast, whatever graphic won the tick");
});
