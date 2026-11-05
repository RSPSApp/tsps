const assert = require('node:assert/strict');
const {before,test} = require('node:test');
const path = require('node:path');
const {Server} = require('../dist/Server');Server.installProductionPathResolver();
const {PluginManager} = require('../dist/plugins/PluginManager');
const c = PluginManager.getCoreApi();
const {PlayerSession} = require('../dist/net/PlayerSession');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {encodeSound} = require('../dist/net/protocol/ClientProtocol');
const activePlayersByTest = new WeakMap();
before(async()=>{
  await c.CachePipeline.initialize(path.resolve(__dirname,'..'));
  const api = PluginManager.createApi('PlayerHitSoundsTest');
  require('../plugins/combat/PlayerHitSounds.plugin').register({...api,onServerStartup:fn=>fn()});
});
const method = {type:()=>c.CombatType.MELEE,accuracyDefenceType:()=>undefined};
let nextIndex = 1700;
function actor(t,gender=0,bot=false){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel),new c.Location(3222,3218)),frames=[];
  p.setIndex(nextIndex++);p.setUsername('hurt'+p.getIndex());p.setRegistered(true);p.setNeedsPlacement(false);p.setAutoRetaliate(false);
  p.getSkillManager().setMaxLevel(c.Skill.HITPOINTS,50);p.setHitpoints(50);
  p.getAppearance().setLook(c.Appearance.GENDER,gender);p.setPlayerBot(bot);
  p.getSession().sendClientPacket=frame=>{if(frame[0]===131)frames.push(Buffer.from(frame));return true};
  const worldPlayers=activePlayersByTest.get(t);
  if(worldPlayers)worldPlayers.push(p);
  t.after(()=>{p.setRegistered(false);p.getCombat().getHitQueue().clear();c.TaskManager.cancelTasks(p.getIndex());});
  return {p,frames};
}
function fixture(t,options={}){
  let worldPlayers=activePlayersByTest.get(t);
  if(!worldPlayers){
    worldPlayers=[];activePlayersByTest.set(t,worldPlayers);
    t.mock.method(c.World,'getPlayers',()=>worldPlayers);
  }
  const f=actor(t,options.gender??0,options.bot??false),spectator=actor(t);
  const npc=c.NPC.create(c.NpcIdentifiers.MAN,new c.Location(3223,3218));
  npc.setIndex(nextIndex++);npc.setRegistered(true);npc.setNeedsPlacement(false);
  t.after(()=>npc.setRegistered(false));
  const attacker=options.pvp?spectator.p:npc;
  if(options.morph)f.p.setNpcTransformationId(c.NpcIdentifiers.MAN);
  const hit=(values=[5],extra={})=>{
    const h=new c.PendingHit(attacker,f.p,method,{damage:values[0],hitAmount:values.length,rollAccuracy:false,experience:false,handleAfterHitEffects:false,...extra});
    h.getHits().forEach((part,i)=>part.setDamage(values[i]));h.updateTotalDamage();
    return h;
  };
  const tick=()=>{
    c.World.processCycle++;
    c.TaskManager.process();
    f.p.getCombat().getHitQueue().process(c.World.processCycle);
  };
  return {...f,spectator,attacker,hit,tick};
}
const hurt = (id=518)=>encodeSound(id,{loops:1,delay:20});
const legacy = id=>encodeSound(id,{loops:1,delay:0});

test('NPC body0 positive health loss emits one recorded variant to nearby listeners at application',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  c.CombatFactory.executeHit(f.hit());
  assert.deepEqual(f.frames,[],'no premature513 and no hurt sound before actual HP loss');
  assert.deepEqual(f.spectator.frames,[]);
  f.tick();
  assert.equal(f.p.getHitpoints(),45);
  assert.deepEqual(f.frames,[hurt()]);
  assert.deepEqual(f.spectator.frames,[hurt()],'nearby listeners receive their own private synth packet');
});
test('all four recorded variants are selected without asserting native probability weights',t=>{
  const f=fixture(t);let roll=0;
  t.mock.method(Math,'random',()=>roll);
  for(const value of [0,0.25,0.5,0.999]){roll=value;c.CombatFactory.executeHit(f.hit([1]));f.tick();}
  assert.deepEqual(f.frames,[518,519,520,521].map(hurt));
  assert.deepEqual(f.spectator.frames,[518,519,520,521].map(hurt));
});
test('guaranteed positive ordinary damage on an inaccurate roll still follows actual health loss',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  const hit=f.hit();t.mock.method(hit,'isAccurate',()=>false);
  c.CombatFactory.executeHit(hit);f.tick();
  assert.equal(f.p.getHitpoints(),45);assert.deepEqual(f.frames,[hurt()]);assert.deepEqual(f.spectator.frames,[hurt()]);
});
test('final mitigation to zero produces no hurt sound, while a resolved zero retains block511',t=>{
  const f=fixture(t);
  const api=PluginManager.createApi('HurtZeroApply');
  api.onCustomEvent('combat:damage-apply',e=>{if(e.target===f.p)e.hit.setDamage(0);});
  t.after(()=>{
    const hooks=PluginManager.customEventHooks.get('combat:damage-apply')??[];
    PluginManager.customEventHooks.set('combat:damage-apply',hooks.filter(h=>h.pluginName!=='HurtZeroApply'));
  });
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.equal(f.p.getHitpoints(),50);assert.deepEqual(f.frames,[]);assert.deepEqual(f.spectator.frames,[]);
  c.CombatFactory.executeHit(f.hit([0]));f.tick();
  assert.deepEqual(f.frames,[legacy(511)]);assert.deepEqual(f.spectator.frames,[]);
});
test('delayed multipart damage waits through a real hit-queue stall and speaks per positive applied part',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  let hold=-1;t.mock.method(f.p.getCombat(),'getIncomingHitCycle',()=>hold);
  const hit=f.hit([1,2,3]);t.mock.method(hit,'getHitDelays',()=>[0,2,4]);
  c.CombatFactory.executeHit(hit);f.tick();
  assert.deepEqual(f.frames,[hurt()]);assert.deepEqual(f.spectator.frames,[hurt()]);assert.equal(f.p.getHitpoints(),49);
  hold=c.World.processCycle+5;
  for(let i=0;i<4;i++)f.tick();
  assert.equal(f.p.getHitpoints(),49);assert.deepEqual(f.frames,[hurt()],'later parts remain silent while stalled');
  assert.deepEqual(f.spectator.frames,[hurt()]);
  f.tick();
  assert.equal(f.p.getHitpoints(),44);assert.deepEqual(f.frames,[hurt(),hurt(),hurt()]);
  assert.deepEqual(f.spectator.frames,[hurt(),hurt(),hurt()]);
});
test('multiple pending ordinary hits emit only when released, one per applied positive splat',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  const release=c.World.processCycle+3;t.mock.method(f.p.getCombat(),'getIncomingHitCycle',()=>release);
  f.p.getCombat().getHitQueue().addPendingHit(f.hit([2]),c.World.processCycle+1);
  f.p.getCombat().getHitQueue().addPendingHit(f.hit([3]),c.World.processCycle+1);
  f.tick();f.tick();assert.deepEqual(f.frames,[]);
  f.tick();assert.equal(f.p.getHitpoints(),45);assert.deepEqual(f.frames,[hurt(),hurt()]);
  assert.deepEqual(f.spectator.frames,[hurt(),hurt()]);
});
test('HP cap suppresses later overkill parts and preserves actual loss before reactive healing',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  const hit=f.hit([4,4]);f.p.setHitpoints(2);
  c.CombatFactory.executeHit(hit);f.tick();
  assert.equal(f.p.getHitpoints(),0);assert.deepEqual(f.frames,[hurt()]);assert.deepEqual(f.spectator.frames,[hurt()]);
  const g=fixture(t);
  g.p.setLocation(new c.Location(3322,3218));g.spectator.p.setLocation(new c.Location(3322,3218));
  const h=g.hit([4]);h.getHits()[0].onApplied(()=>g.p.setHitpoints(50));
  c.CombatFactory.executeHit(h);g.tick();
  assert.equal(g.p.getHitpoints(),50);assert.deepEqual(g.frames,[hurt()],'reactive healing does not erase the observed actual loss');
  assert.deepEqual(g.spectator.frames,[hurt()]);
});
test('poison, recoil and nonordinary mask damage do not acquire ordinary hurt audio',t=>{
  const f=fixture(t);
  f.p.getCombat().getHitQueue().addPendingDamage([
    new c.HitDamage(2,c.HitMask.GREEN).setSource(f.attacker),
    new c.HitDamage(2,c.HitMask.RED).markReflected().setSource(f.attacker),
  ]);f.tick();assert.deepEqual(f.frames,[]);
  for(const reflected of [false,true]){
    const h=f.hit([2]);if(reflected)h.getHits()[0].markReflected();else h.getHits()[0].setHitmask(c.HitMask.GREEN);
    c.CombatFactory.executeHit(h);f.tick();
  }
  assert.deepEqual(f.frames,[]);
});
test('body1 hits use recorded 509 and 510 variants for nearby listeners',t=>{
  const f=fixture(t,{gender:1});let roll=0;
  t.mock.method(Math,'random',()=>roll);
  for(const value of [0,0.999]){roll=value;c.CombatFactory.executeHit(f.hit([1]));f.tick();}
  assert.deepEqual(f.frames,[hurt(509),hurt(510)]);
  assert.deepEqual(f.spectator.frames,[hurt(509),hurt(510)]);
});
test('PvP hurt packets go to both participants with an independent body0 variant per client',t=>{
  const f=fixture(t,{pvp:true});const rolls=[0,3];
  t.mock.method(c.Misc,'getRandom',()=>rolls.shift()??0);
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.equal(f.frames.length,1);assert.equal(f.spectator.frames.length,1);
  const packets=[f.frames[0],f.spectator.frames[0]];
  assert.ok(packets.some(frame=>frame.equals(hurt(518))));
  assert.ok(packets.some(frame=>frame.equals(hurt(521))));
});
test('body1 PvP hits use the recorded body1 variants for both participants',t=>{
  const f=fixture(t,{gender:1,pvp:true});t.mock.method(Math,'random',()=>0);
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.deepEqual(f.frames,[hurt(509)]);assert.deepEqual(f.spectator.frames,[hurt(509)]);
});
test('NPC-morphed players preserve the legacy fallback and block sound',t=>{
  const f=fixture(t,{morph:true});
  c.CombatFactory.executeHit(f.hit([2,3]));
  assert.deepEqual(f.frames,[legacy(513)]);assert.deepEqual(f.spectator.frames,[]);
  f.tick();assert.deepEqual(f.frames,[legacy(513)]);
  const miss=f.hit([0]);t.mock.method(miss,'isAccurate',()=>false);
  c.CombatFactory.executeHit(miss);assert.deepEqual(f.frames,[legacy(513),legacy(511)]);
});
test('physical body rather than pronouns selects the captured PvM voice group',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  f.p.getAppearance().setPronouns(1);
  c.CombatFactory.executeHit(f.hit());f.tick();assert.deepEqual(f.frames,[hurt()]);
  assert.deepEqual(f.spectator.frames,[hurt()]);
});
for(const change of ['body','morph']){
  test('delayed applied damage stops using the recorded group after a '+change+' change',t=>{
    const f=fixture(t);t.mock.method(Math,'random',()=>0);
    const hit=f.hit([1,2]);t.mock.method(hit,'getHitDelays',()=>[0,3]);
    c.CombatFactory.executeHit(hit);f.tick();assert.deepEqual(f.frames,[hurt()]);
    assert.deepEqual(f.spectator.frames,[hurt()]);
    if(change==='body')f.p.getAppearance().setLook(c.Appearance.GENDER,1);
    else f.p.setNpcTransformationId(c.NpcIdentifiers.MAN);
    f.tick();f.tick();
    assert.equal(f.p.getHitpoints(),47);
    assert.deepEqual(f.frames,change==='body'?[hurt(),hurt(509)]:[hurt()]);
    assert.deepEqual(f.spectator.frames,change==='body'?[hurt(),hurt(509)]:[hurt()]);
  });
}
test('bot recipients remain suppressed for both recorded and legacy hurt sounds',t=>{
  const f=fixture(t,{bot:true});t.mock.method(c.Misc,'getRandom',()=>0);
  c.CombatFactory.executeHit(f.hit());f.tick();assert.deepEqual(f.frames,[]);
  assert.deepEqual(f.spectator.frames,[hurt()],'network listeners can hear a nearby bot target');
});
