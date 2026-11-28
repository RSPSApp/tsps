const assert = require('node:assert/strict');
const {before,test} = require('node:test');
const path = require('node:path');
const {Server} = require('../dist/Server');Server.installProductionPathResolver();
const {PluginManager} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const C = require('../plugins/skills/hunter/Context.Hunter');
const Catching = require('../plugins/skills/hunter/Catching.Hunter');
const core = PluginManager.getCoreApi(), I = core.ItemIdentifiers;
before(async()=>{
  await core.CachePipeline.initialize(path.resolve(__dirname,'..'));
  C.H.core=core;C.H.data=require('../plugins/skills/hunter/Data.Hunter').build(core);
  C.H.api={emitCustomEvent(name,payload){if(name==='hunter:barehand-caught')barehanded.push(payload);}};
});
function fixture(t,net=I.BUTTERFLY_NET,jar=false){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel),new core.Location(2337,3604)),messages=[],xp=[];
  p.setIndex(1700);p.setUsername('butterfly-test');p.setRegistered(true);p.setNeedsPlacement(false);p.setHitpoints(10);
  p.getSkillManager().setMaxLevel(core.Skill.HUNTER,15).setCurrentLevels(core.Skill.HUNTER,15);
  if(net)p.getEquipment().set(core.Equipment.WEAPON_SLOT,new core.Item(net));
  if(jar)p.getInventory().adds(I.BUTTERFLY_JAR,1);
  t.mock.method(p,'sendMessage',text=>messages.push(text));
  t.mock.method(p.getPacketSender(),'sendTypedMessage',(_type,text)=>messages.push(text));
  t.mock.method(p.getSkillManager(),'addExperiences',(_skill,amount)=>xp.push(amount));
  const walks=[];let roll=0;
  t.mock.method(Math,'random',()=>roll);
  t.mock.method(p.getMovementQueue(),'walkToEntity',(target,arrive)=>walks.push({target,arrive}));
  const npc=core.NPC.create(core.NpcIdentifiers.RUBY_HARVEST,p.getLocation().clone());
  npc.setRegistered(true);npc.setNeedsPlacement(false);
  p.setMobileInteraction(npc); // as walking up to the clicked butterfly leaves it
  t.after(()=>{core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.process();p.setRegistered(false);npc.setRegistered(false);C.H.actions.clear();C.H.players.clear();C.H.hidden.clear();C.H.reserved.clear();});
  const catchNpc=()=>Catching.catchNpc({player:p,npc,npcId:npc.getId()});
  return {p,npc,messages,xp,walks,catchNpc,miss:()=>{roll=1;},hit:()=>{roll=0;}};
}
// Game ticks: the Hunter clock, then the engine's tasks.
const ticks=n=>{for(let i=0;i<n;i++){C.H.tick++;core.TaskManager.process();}};
for(const net of [I.BUTTERFLY_NET,I.MAGIC_BUTTERFLY_NET]){
  test('net '+net+' without a jar reports a net catch at level15',t=>{
    const f=fixture(t,net);f.catchNpc();
    assert.deepEqual(f.messages,['You catch the creature in your net and release it.']);
    assert.deepEqual(f.xp,[24]);assert.equal(f.p.getInventory().getAmount(I.RUBY_HARVEST),0);
  });
  test('net '+net+' with a jar preserves the captured-creature message and exchange',t=>{
    const f=fixture(t,net,true);f.catchNpc();
    assert.deepEqual(f.messages,['You catch the creature in a jar.']);
    assert.equal(f.p.getInventory().getAmount(I.BUTTERFLY_JAR),0);
    assert.equal(f.p.getInventory().getAmount(I.RUBY_HARVEST),1);assert.deepEqual(f.xp,[24]);
  });
}
const barehanded=[];

test('hands15 still reject, while hands25 keep native catch/release text and XP',t=>{
  const f=fixture(t,null);f.catchNpc();
  assert.deepEqual(f.messages,['You need a Hunter level of at least 25 to catch this butterfly barehanded.']);
  assert.deepEqual(f.xp,[]);
  f.messages.length=0;f.p.getSkillManager().setMaxLevel(core.Skill.HUNTER,25).setCurrentLevels(core.Skill.HUNTER,25);
  f.catchNpc();
  assert.deepEqual(f.messages,['You catch and release the ruby harvest butterfly.']);assert.deepEqual(f.xp,[44]);
  // hunter:barehand-caught with the creature's name (a league's moonlight moth task reads it).
  assert.deepEqual(barehanded.filter(e=>e.player===f.p).map(e=>e.name),['ruby harvest butterfly']);
});
for(const [name,net] of [['a net',I.BUTTERFLY_NET],['bare hands',null]]){
  test('a miss with '+name+' follows the butterfly and tries again every 4 ticks until it is caught',t=>{
    const f=fixture(t,net);f.p.getSkillManager().setMaxLevel(core.Skill.HUNTER,25).setCurrentLevels(core.Skill.HUNTER,25);
    f.miss();f.catchNpc();
    assert.deepEqual(f.messages,['The creature slips away.']);
    ticks(3);assert.equal(f.walks.length,0);
    ticks(1);assert.equal(f.walks.length,1);assert.equal(f.walks[0].target,f.npc);
    f.walks[0].arrive();assert.equal(f.messages.length,2,'missed again on arrival');
    ticks(4);assert.equal(f.walks.length,2);
    f.hit();f.walks[1].arrive();assert.equal(f.xp.length,1);
    ticks(8);assert.equal(f.walks.length,2,'a catch ends the retries');
  });
}
test('the retry ends with a walk, a dropped interaction, a gone butterfly or a changed weapon',t=>{
  const stops={
    'walk':f=>f.p.getMovementQueue().walkToReset(),
    'dropped interaction':f=>f.p.setMobileInteraction(null),
    'butterfly gone':f=>f.npc.setVisible(false),
    'net removed':f=>f.p.getEquipment().set(core.Equipment.WEAPON_SLOT,new core.Item(-1,0)),
  };
  for(const [name,stop] of Object.entries(stops)){
    const f=fixture(t);f.miss();f.catchNpc();stop(f);ticks(8);
    assert.equal(f.walks.length,0,name);assert.equal(f.messages.length,1,name);
  }
});
test('clicking again after a net miss throws no sooner than 2 ticks later, and keeps trying',t=>{
  const f=fixture(t);f.miss();f.catchNpc();
  f.p.getMovementQueue().walkToReset();f.p.setMobileInteraction(f.npc);f.catchNpc();
  assert.equal(f.messages.length,1,'no second throw on the same tick');
  ticks(2);assert.equal(f.walks.length,1);
  f.walks[0].arrive();assert.equal(f.messages.length,2);
  ticks(4);assert.equal(f.walks.length,2);
});
// A jarred ruby harvest used on a player boosts Attack by the shared potion rule (ConsumableEffects.boostSkill):
// from a drained level it adds 4 + 15%, between base and the cap it goes to the cap, past the cap it stays.
test('a ruby harvest boost adds to drained Attack, up to base + boost, like a potion',t=>{
  const f=fixture(t);
  C.H.api.getAreaManager=()=>({inMulti:()=>false});t.after(()=>{delete C.H.api.getAreaManager;});
  for(const [before,after] of [[50,50+14+4],[105,99+14+4],[120,120]]){
    f.p.getInventory().adds(I.RUBY_HARVEST,1);
    f.p.getSkillManager().setMaxLevel(core.Skill.ATTACK,99).setCurrentLevels(core.Skill.ATTACK,before);
    Catching.boost({player:f.p,target:f.p,itemId:I.RUBY_HARVEST});
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK),after,'Attack '+before);
  }
});
