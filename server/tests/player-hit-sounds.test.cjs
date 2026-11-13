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

test('an unrelated observer hears no hurt voice from nearby NPC combat, including bot targets',t=>{
  const f=fixture(t,{gender:1}),observer=actor(t);
  t.mock.method(c.Misc,'getRandom',()=>0);
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.deepEqual(f.frames,[hurt(509)],'the damaged player retains the voice');
  assert.deepEqual(f.spectator.frames,[],'an unrelated player retains no private voice');
  assert.deepEqual(observer.frames,[],'another player at the same tile receives no voice');
  f.p.setPlayerBot(true);
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.deepEqual(observer.frames,[],'a neighbouring bot fight must not add full-volume hurt synths');
});

test('a positive NPC hit nearby does not give a zero-hit observer a hurt voice',t=>{
  const f=fixture(t),observer=actor(t);
  t.mock.method(c.Misc,'getRandom',()=>0);
  const zero=new c.PendingHit(f.attacker,observer.p,method,{damage:0,rollAccuracy:false,experience:false,handleAfterHitEffects:false});
  c.CombatFactory.executeHit(zero);
  c.CombatFactory.executeHit(f.hit());f.tick();
  observer.p.getCombat().getHitQueue().process(c.World.processCycle);
  assert.equal(observer.p.getHitpoints(),50);
  assert.deepEqual(observer.frames,[legacy(511)],'only their own block plays, not a voice from another target');
  assert.deepEqual(f.frames,[hurt()],'the genuine positive hit still speaks');
});

test('NPC body0 positive health loss emits one private variant to the damaged player at application',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  c.CombatFactory.executeHit(f.hit());
  assert.deepEqual(f.frames,[],'no premature513 and no hurt sound before actual HP loss');
  assert.deepEqual(f.spectator.frames,[]);
  f.tick();
  assert.equal(f.p.getHitpoints(),45);
  assert.deepEqual(f.frames,[hurt()]);
  assert.deepEqual(f.spectator.frames,[]);
});
test('all four recorded variants are selected without asserting native probability weights',t=>{
  const f=fixture(t);let roll=0;
  t.mock.method(Math,'random',()=>roll);
  for(const value of [0,0.25,0.5,0.999]){roll=value;c.CombatFactory.executeHit(f.hit([1]));f.tick();}
  assert.deepEqual(f.frames,[518,519,520,521].map(hurt));
  assert.deepEqual(f.spectator.frames,[]);
});
test('guaranteed positive ordinary damage on an inaccurate roll still follows actual health loss',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  const hit=f.hit();t.mock.method(hit,'isAccurate',()=>false);
  c.CombatFactory.executeHit(hit);f.tick();
  assert.equal(f.p.getHitpoints(),45);assert.deepEqual(f.frames,[hurt()]);assert.deepEqual(f.spectator.frames,[]);
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
  assert.deepEqual(f.frames,[hurt()]);assert.deepEqual(f.spectator.frames,[]);assert.equal(f.p.getHitpoints(),49);
  hold=c.World.processCycle+5;
  for(let i=0;i<4;i++)f.tick();
  assert.equal(f.p.getHitpoints(),49);assert.deepEqual(f.frames,[hurt()],'later parts remain silent while stalled');
  assert.deepEqual(f.spectator.frames,[]);
  f.tick();
  assert.equal(f.p.getHitpoints(),44);assert.deepEqual(f.frames,[hurt(),hurt(),hurt()]);
  assert.deepEqual(f.spectator.frames,[]);
});
test('multiple pending ordinary hits emit only when released, one per applied positive splat',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  const release=c.World.processCycle+3;t.mock.method(f.p.getCombat(),'getIncomingHitCycle',()=>release);
  f.p.getCombat().getHitQueue().addPendingHit(f.hit([2]),c.World.processCycle+1);
  f.p.getCombat().getHitQueue().addPendingHit(f.hit([3]),c.World.processCycle+1);
  f.tick();f.tick();assert.deepEqual(f.frames,[]);
  f.tick();assert.equal(f.p.getHitpoints(),45);assert.deepEqual(f.frames,[hurt(),hurt()]);
  assert.deepEqual(f.spectator.frames,[]);
});
test('HP cap suppresses later overkill parts and preserves actual loss before reactive healing',t=>{
  const f=fixture(t);t.mock.method(Math,'random',()=>0);
  const hit=f.hit([4,4]);f.p.setHitpoints(2);
  c.CombatFactory.executeHit(hit);f.tick();
  assert.equal(f.p.getHitpoints(),0);assert.deepEqual(f.frames,[hurt()]);assert.deepEqual(f.spectator.frames,[]);
  const g=fixture(t);
  g.p.setLocation(new c.Location(3322,3218));g.spectator.p.setLocation(new c.Location(3322,3218));
  const h=g.hit([4]);h.getHits()[0].onApplied(()=>g.p.setHitpoints(50));
  c.CombatFactory.executeHit(h);g.tick();
  assert.equal(g.p.getHitpoints(),50);assert.deepEqual(g.frames,[hurt()],'reactive healing does not erase the observed actual loss');
  assert.deepEqual(g.spectator.frames,[]);
});
test('poison and nonordinary mask damage do not acquire ordinary hurt audio',t=>{
  // Recordings: 1 of 3,393 poison-only ticks and none of 5,848 venom-only ticks carry a hurt voice.
  const f=fixture(t);
  f.p.getCombat().getHitQueue().addPendingDamage([new c.HitDamage(2,c.HitMask.GREEN).setSource(f.attacker)]);
  f.tick();assert.deepEqual(f.frames,[]);
  const h=f.hit([2]);h.getHits()[0].setHitmask(c.HitMask.GREEN);
  c.CombatFactory.executeHit(h);f.tick();
  assert.deepEqual(f.frames,[]);
});
test('a rebound that hurts a player plays their hurt voice once, like an ordinary hit',t=>{
  // rsprox_transcripts/242/900257.txt tick 102: the Vengeance rebound brings the opponent's voice.
  const f=fixture(t);t.mock.method(c.Misc,'getRandom',()=>0);
  f.p.getCombat().getHitQueue().addPendingDamage([new c.HitDamage(2,c.HitMask.RED).markReflected().setOrigin('recoil').setSource(f.attacker)]);
  f.tick();
  assert.deepEqual(f.frames,[hurt()],"an NPC's rebound: only the struck player hears it");
  assert.deepEqual(f.spectator.frames,[]);
  f.frames.length=0;
  const h=f.hit([2]);h.getHits()[0].markReflected();
  c.CombatFactory.executeHit(h);f.tick();
  assert.deepEqual(f.frames,[hurt()],'a reflected part of a resolved hit is voiced once, not twice');
  f.frames.length=0;
  f.p.setHitpoints(0);
  f.p.getCombat().getHitQueue().addPendingDamage([new c.HitDamage(0,c.HitMask.RED).markReflected().setSource(f.attacker)]);
  f.tick();
  assert.deepEqual(f.frames,[],'a rebound that costs nothing is silent');
});
test('a Vengeance rebound in PvP is heard by both participants',t=>{
  const f=fixture(t,{pvp:true});t.mock.method(c.Misc,'getRandom',()=>0);
  f.p.getCombat().getHitQueue().addPendingDamage([new c.HitDamage(6,c.HitMask.RED).markReflected().setOrigin('vengeance').setSource(f.attacker)]);
  f.tick();
  assert.deepEqual(f.frames,[hurt()]);
  assert.deepEqual(f.spectator.frames,[hurt()],'the player whose Vengeance it was hears the struck player');
});
test('body1 hits use recorded 509 and 510 variants privately',t=>{
  const f=fixture(t,{gender:1});let roll=0;
  t.mock.method(Math,'random',()=>roll);
  for(const value of [0,0.999]){roll=value;c.CombatFactory.executeHit(f.hit([1]));f.tick();}
  assert.deepEqual(f.frames,[hurt(509),hurt(510)]);
  assert.deepEqual(f.spectator.frames,[]);
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

test('PvP hurt voices reach the two hit participants without full-volume spectator noise',t=>{
  const f=fixture(t,{gender:1,pvp:true}),near=actor(t),edge=actor(t);
  edge.p.setLocation(new c.Location(3237,3218));
  t.mock.method(c.Misc,'getRandom',()=>0);
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.deepEqual(f.frames,[hurt(509)],'the victim keeps the recorded voice');
  assert.deepEqual(f.spectator.frames,[hurt(509)],'the attacker keeps a private voice');
  assert.deepEqual(near.frames,[],'an unrelated player on the same tile gets no private hurt synth');
  assert.deepEqual(edge.frames,[],'a fight fifteen tiles away does not sound like local damage');
  f.p.setPlayerBot(true);f.frames.length=0;f.spectator.frames.length=0;
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.deepEqual(f.frames,[],'bot recipients remain suppressed');
  assert.deepEqual(f.spectator.frames,[hurt(509)],'a human attacker still hears a bot victim');
  assert.deepEqual(near.frames,[]);
});

test('delayed PvP voices retain their actual attacker after combat target changes',t=>{
  const f=fixture(t,{pvp:true}),other=actor(t);
  t.mock.method(c.Misc,'getRandom',()=>0);
  const hit=f.hit([3]);t.mock.method(hit,'getHitDelays',()=>[2]);
  c.CombatFactory.executeHit(hit);
  f.p.getCombat().setTarget(other.p);f.attacker.getCombat().setTarget(other.p);
  f.tick();f.tick();f.tick();
  assert.equal(f.p.getHitpoints(),47);
  assert.deepEqual(f.frames,[hurt()]);assert.deepEqual(f.spectator.frames,[hurt()]);
  assert.deepEqual(other.frames,[],'switching current targets cannot change a pending hit\'s listeners');
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
  assert.deepEqual(f.spectator.frames,[]);
});
for(const change of ['body','morph']){
  test('delayed applied damage stops using the recorded group after a '+change+' change',t=>{
    const f=fixture(t);t.mock.method(Math,'random',()=>0);
    const hit=f.hit([1,2]);t.mock.method(hit,'getHitDelays',()=>[0,3]);
    c.CombatFactory.executeHit(hit);f.tick();assert.deepEqual(f.frames,[hurt()]);
    assert.deepEqual(f.spectator.frames,[]);
    if(change==='body')f.p.getAppearance().setLook(c.Appearance.GENDER,1);
    else f.p.setNpcTransformationId(c.NpcIdentifiers.MAN);
    f.tick();f.tick();
    assert.equal(f.p.getHitpoints(),47);
    assert.deepEqual(f.frames,change==='body'?[hurt(),hurt(509)]:[hurt()]);
    assert.deepEqual(f.spectator.frames,[]);
  });
}
test('bot recipients remain suppressed for both recorded and legacy hurt sounds',t=>{
  const f=fixture(t,{bot:true});t.mock.method(c.Misc,'getRandom',()=>0);
  c.CombatFactory.executeHit(f.hit());f.tick();assert.deepEqual(f.frames,[]);
  assert.deepEqual(f.spectator.frames,[],'an unrelated listener does not hear an NPC attacking a bot');
});

test('the Hit sounds setting picks the voice: Type A is the body0 set, Type B the body1 set, whatever the body',t=>{
  const api=PluginManager.createApi('HitSoundsSettingTest');
  const choose=(player,option)=>{const request={player,settingId:382,option,handled:false};api.emitCustomEvent('settings:option-chosen',request);return request.handled;};
  const f=fixture(t);t.mock.method(c.Misc,'getRandom',()=>0);
  assert.equal(choose(f.p,1),true,'the plugin owns row 382');
  assert.equal(f.p.getPacketSender().getVarbit(10731),1);
  c.CombatFactory.executeHit(f.hit());f.tick();
  assert.deepEqual(f.frames,[hurt(509)],'a body0 player on Type B hears the body1 voice');
  const g=fixture(t,{gender:1});
  assert.equal(choose(g.p,0),true);
  c.CombatFactory.executeHit(g.hit());g.tick();
  assert.deepEqual(g.frames,[hurt(518)],'a body1 player on Type A hears the body0 voice');
  assert.equal(choose(g.p,2),false,'only the two options');
});

test('until the player chooses, Hit sounds follows the body type',t=>{
  const Plugin=require('../plugins/combat/PlayerHitSounds.plugin');
  const male=actor(t),female=actor(t,1);
  assert.equal(Plugin.hitSoundsType(male.p),0);
  assert.equal(Plugin.hitSoundsType(female.p),1);
  female.p.setAttribute('hit-sounds:type',0);
  assert.equal(Plugin.hitSoundsType(female.p),0,'a choice wins over the body type');
});
