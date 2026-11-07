const assert = require('node:assert/strict');
const {test} = require('node:test');
const {Server} = require('../dist/Server');
Server.installProductionPathResolver();
const {ArceuusThralls} = require('../dist/game/content/combat/magic/ArceuusThralls');
const {ArceuusSpells} = require('../dist/game/content/combat/magic/ArceuusSpells');
const {World} = require('../dist/game/World');
const {NPC} = require('../dist/game/entity/impl/npc/NPC');
const {Location} = require('../dist/game/model/Location');
const {Skill} = require('../dist/game/model/Skill');
const {MagicSpellbook} = require('../dist/game/model/MagicSpellbook');
const {TaskManager} = require('../dist/game/task/TaskManager');
const {Combat} = require('../dist/game/content/combat/Combat');
const {HitDamage} = require('../dist/game/content/combat/hit/HitDamage');
const {HitMask} = require('../dist/game/content/combat/hit/HitMask');
const {PluginManager} = require('../dist/plugins/PluginManager');
const Rewards = require('../plugins/achievements/combatachievements/Rewards.CombatAchievements');
const Progress = require('../plugins/achievements/combatachievements/Progress.CombatAchievements');
const Slayer = require('../plugins/skills/slayer/Equipment.Slayer');

function fixture(t,{magic=99,hp=100,claimed=false,name='Goblin',attackHook=null}={}) {
  const tasks=[],actors=[],shown=[],attributes=new Map(),runes=new Map([[558,100],[556,100],[560,100],[557,100],[565,100],[554,100],[564,100]]);
  const p={magic,prayer:100,registered:true,animations:[],graphics:[],isNpc:()=>false,isPlayer:()=>true,isRegistered:()=>p.registered,
    performAnimation:animation=>p.animations.push(animation.getId()),performGraphic:graphic=>p.graphics.push(graphic.getId()),
    getLocation:()=>new Location(3200,3200,0),getAttribute:k=>attributes.get(k),setAttribute:(k,v)=>attributes.set(k,v),
    getPacketSender:()=>({sendVarbit(){}}),sendMessage(){},getSpellbook:()=>MagicSpellbook.ARCEUUS,
    getEquipment:()=>({contains:id=>id===25818,containsAllItem:()=>true}),
    getInventory:()=>({getAmount:id=>runes.get(id)??0,deletes:item=>runes.set(item.getId(),runes.get(item.getId())-item.getAmount())}),
    getSkillManager:()=>({getCurrentLevel:s=>s===Skill.PRAYER?p.prayer:p.magic,
      decreaseCurrentLevel:(_s,n)=>{p.prayer-=n;},addExperiences(){}}),
    getCombat:()=>({getTarget:()=>target,getAttacker:()=>null,reset(){},setCastSpell(){}})};
  const target={hp,registered:true,getDefinition:()=>({getName:()=>name}),isNpc:()=>true,isPlayer:()=>false,isRegistered:()=>target.registered,isUntargetable:()=>false,
    getHitpoints:()=>target.hp,getSize:()=>1,getLocation:()=>new Location(3203,3200,0),
    // Match Mobile's pre-healing applied-damage bookkeeping.
    decrementHealth:hit=>{hit.setDamage(Math.min(hit.getDamage(),Math.max(0,target.hp)));hit.setHealthLost(hit.getDamage());target.hp-=hit.getDamage();return hit;},
    addTickHit:hit=>shown.push(hit.getDamage()),getCombat:()=>combat};
  const combat=new Combat(target);
  const thrallAnimations=[];
  t.mock.method(NPC,'create',()=>{
    const attrs=new Map(),movement={reset(){},setPursuitCheckpoint(){}};
    const a={registered:true,following:null,graphics:[],isRegistered:()=>a.registered,getLocation:()=>p.getLocation(),getSize:()=>1,
      performGraphic:graphic=>a.graphics.push(graphic.getId()),
      setOwner(){},setPet(){},setUntargetable(){},setFollowing:v=>{a.following=v;},getFollowing:()=>a.following,
      getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),getInteractingMobile:()=>target,setMobileInteraction(){},
      getMovementQueue:()=>movement,calculateDistance:()=>3,getAttackAnim:()=>1,performAnimation:()=>thrallAnimations.push(World.getProcessCycle())};
    actors.push(a);return a;
  });
  t.mock.method(TaskManager,'submit',task=>{task.setRunning(true);tasks.push(task);});
  const hooks=new Map();
  Rewards({core:{},onBeforeNpcInteraction(){},onPlayerLogout(){},onNpcDialogueVariant(){},onNpcDialogueCondition(){},onItemAction(){},onCustomEvent:(name,fn)=>hooks.set(name,fn)});
  // The Slayer plugin attached as the server does: it cancels the thrall's attack on its thrall-immune monsters.
  Slayer.attach({onCombatHitRoll(){},registerIncomingDamageModifier(){},onCombatHitResolved(){},onNpcHitModify(){},onCustomEvent:(name,fn)=>hooks.set(name,fn)});
  if(attackHook)hooks.set('magic:thrall-attack',attackHook);
  t.mock.method(PluginManager,'emitCustomEvent',(name,event)=>hooks.get(name)?.(event));
  if(claimed)Progress.setClaimed(p,{tier:5,index:4});
  const step=(n=1,apply=true)=>{for(let i=0;i<n;i++){World.processCycle++;for(const task of tasks)if(task.isRunning())task.tick();if(apply)combat.getHitQueue().process(World.getProcessCycle());}};
  const credit=()=>combat.damageMap?.get(p)?.getDamage()??0;
  return {p,target,tasks,actors,shown,runes,step,credit,queue:combat.getHitQueue(),attributes,thrallAnimations};
}

test('all three thrall tiers roll inclusive zero, intermediate and maximum hits at four-tick intervals',t=>{
  for(const max of [1,2,3])for(const random of [0,0.5,0.999999]){
    const f=fixture(t);t.mock.method(Math,'random',()=>random);
    ArceuusThralls.summon(f.p,10880,0,max,6);
    f.step(3);assert.deepEqual(f.shown,[]);
    f.step();const damage=Math.floor(random*(max+1));
    assert.deepEqual(f.shown,[damage]);assert.equal(f.credit(),damage);
    f.step(4);assert.deepEqual(f.shown,[damage,damage]);
  }
});

// Wiki (Thrall): "Thralls will no longer deal damage to kurasks and turoths"; Vyrewatch Sentinels are immune too.
test('a thrall deals no damage to a kurask, a turoth or a Vyrewatch Sentinel',t=>{
  for(const name of ['Kurask','Turoth','Vyrewatch Sentinel']){
    const f=fixture(t,{name});t.mock.method(Math,'random',()=>0.999999);
    ArceuusThralls.summon(f.p,10880,0,3,6);f.step(8);
    assert.deepEqual(f.shown,[],name);assert.equal(f.target.hp,100,name);
  }
});

// The immunity is content's: core only respects the cancel flag. The thrall still attacks, but no hit is queued (a max
// hit of 0 would still queue and show a 0).
test('a cancelled thrall attack still animates but queues no hit',t=>{
  const seen=[];
  const f=fixture(t,{attackHook:event=>{seen.push(event.target);event.cancelled=true;}});t.mock.method(Math,'random',()=>0.999999);
  ArceuusThralls.summon(f.p,10880,0,3,6);f.step(8);
  assert.equal(seen.length,2,'asked on each of the two attacks');assert.equal(seen[0],f.target);
  assert.equal(f.thrallAnimations.length,2,'the thrall still attacks');
  assert.deepEqual(f.shown,[]);assert.equal(f.target.hp,100);assert.equal(f.credit(),0);
});

test('thrall ownership credits only applied queued damage, including overkill and cancelled impacts',t=>{
  const f=fixture(t,{hp:1});t.mock.method(Math,'random',()=>0.999999);
  ArceuusThralls.summon(f.p,10880,0,3,6);f.step(4,false);
  assert.equal(f.credit(),0,'a launch has not dealt damage');
  f.queue.process(World.getProcessCycle());assert.equal(f.target.hp,0);assert.equal(f.credit(),1);
  assert.equal(f.queue.getLastAppliedHit().getSource(),f.p);
  const cancelled=fixture(t);ArceuusThralls.summon(cancelled.p,10880,0,3,6);cancelled.step(4,false);
  cancelled.queue.clear();cancelled.queue.process(World.getProcessCycle());assert.equal(cancelled.credit(),0);
  const dead=fixture(t,{hp:1});
  dead.queue.addPendingDamage([new HitDamage(1,HitMask.RED)]);
  ArceuusThralls.summon(dead.p,10880,0,3,6);dead.step(4,false);
  dead.queue.process(World.getProcessCycle());assert.equal(dead.credit(),0,'an earlier lethal hit leaves no thrall damage');
  const removed=fixture(t);ArceuusThralls.summon(removed.p,10880,0,3,6);removed.step(4,false);
  removed.target.registered=false;removed.queue.process(World.getProcessCycle());assert.equal(removed.credit(),0);
});

test('all resurrection spells share a ten-second cooldown and rejection spends no runes or prayer',t=>{
  const f=fixture(t);World.processCycle=100;
  let wallClock=100000;t.mock.method(Date,'now',()=>wallClock);
  const spells=['lesser ghost','superior ghost','greater ghost','lesser skeleton','superior skeleton','greater skeleton','lesser zombie','superior zombie','greater zombie'];
  ArceuusSpells.handleSpell(f.p,`Resurrect ${spells[0]}`);
  assert.deepEqual(f.p.animations,[8973]);
  assert.deepEqual(f.p.graphics,[1873]);
  assert.deepEqual(f.actors[0].graphics,[1903]);
  const initialDeadline=f.attributes.get('arceuus:thrall-until');
  // Upstream 3bbf1cc8e uses whole ticks; the older installed integration uses
  // milliseconds. Validate either exact ten-second protocol, never infer an
  // arbitrary duration from the implementation's own deadline.
  assert.ok(initialDeadline===117 || initialDeadline===110000,`unexpected cooldown ${initialDeadline}`);
  const tickClock=initialDeadline===117,period=tickClock?17:10000;
  const now=()=>tickClock?World.getProcessCycle():wallClock;
  const advanceTo=value=>{if(tickClock)World.processCycle=value;else wallClock=value;};
  for(let i=1;i<=spells.length;i++){
    const spell=spells[i%spells.length];
    const until=f.attributes.get('arceuus:thrall-until'),runes=[...f.runes],prayer=f.p.prayer;
    assert.equal(until,now()+period);
    for(const at of [now(),until-1]){
      advanceTo(at);ArceuusSpells.handleSpell(f.p,`Resurrect ${spell}`);
      assert.deepEqual([...f.runes],runes);assert.equal(f.p.prayer,prayer);assert.equal(f.actors.length,i);
    }
    advanceTo(until);ArceuusSpells.handleSpell(f.p,`Resurrect ${spell}`);
    assert.equal(f.actors.length,i+1);assert.equal(f.p.prayer,prayer-(i%3+1)*2);
    assert.equal(f.attributes.get('arceuus:thrall-until'),until+period);
  }
});

test('only claimed Master rewards double the current-Magic duration, snapshotted for each summon',t=>{
  const unclaimed=fixture(t,{magic:10});
  unclaimed.attributes.set('combat-achievements:completed',Array(21).fill(-1));
  ArceuusThralls.summon(unclaimed.p,10880,0,3,6);unclaimed.p.magic=99;
  unclaimed.step(9);assert.ok(unclaimed.attributes.get('arceuus:thrall'));
  unclaimed.step();assert.equal(unclaimed.attributes.get('arceuus:thrall'),null);
  const claimed=fixture(t,{magic:10,claimed:true});
  ArceuusThralls.summon(claimed.p,10880,0,3,6);claimed.p.magic=1;
  claimed.step(19);assert.ok(claimed.attributes.get('arceuus:thrall'));
  claimed.step();assert.equal(claimed.attributes.get('arceuus:thrall'),null);
});

test('replacement and logout stop their owned thrall task without clearing a newer summon',t=>{
  const f=fixture(t,{magic:20});ArceuusThralls.summon(f.p,10880,0,3,6);
  const old=f.actors[0];ArceuusThralls.summon(f.p,10883,0,3,6);
  f.step();assert.equal(f.tasks[0].isRunning(),false);assert.equal(f.attributes.get('arceuus:thrall'),f.actors[1]);
  assert.ok(World.getRemoveNPCQueue().includes(old));
  f.p.registered=false;f.step();assert.equal(f.tasks[1].isRunning(),false);assert.equal(f.attributes.get('arceuus:thrall'),null);
});

test('the duration query has a current-Magic default when the reward plugin is absent',t=>{
  const f=fixture(t,{magic:12,claimed:true});t.mock.method(PluginManager,'emitCustomEvent',()=>{});
  ArceuusThralls.summon(f.p,10880,0,3,6);
  f.step(11);assert.ok(f.attributes.get('arceuus:thrall'));
  f.step();assert.equal(f.attributes.get('arceuus:thrall'),null);
});
