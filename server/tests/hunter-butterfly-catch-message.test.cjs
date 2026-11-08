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
  C.H.api={emitCustomEvent(){}};
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
  t.mock.method(Math,'random',()=>0);
  const npc=core.NPC.create(core.NpcIdentifiers.RUBY_HARVEST,p.getLocation().clone());
  npc.setRegistered(true);npc.setNeedsPlacement(false);
  t.after(()=>{p.setRegistered(false);npc.setRegistered(false);C.H.actions.clear();C.H.players.clear();C.H.hidden.clear();C.H.reserved.clear();});
  const catchNpc=()=>Catching.catchNpc({player:p,npc,npcId:npc.getId()});
  const finish=()=>{C.H.tick+=2;C.processActions();};
  return {p,npc,messages,xp,catchNpc,finish};
}
for(const net of [I.BUTTERFLY_NET,I.MAGIC_BUTTERFLY_NET]){
  test('net '+net+' without a jar reports a net catch at level15',t=>{
    const f=fixture(t,net);f.catchNpc();assert.deepEqual(f.messages,[]);f.finish();
    assert.deepEqual(f.messages,['You catch the creature in your net and release it.']);
    assert.deepEqual(f.xp,[24]);assert.equal(f.p.getInventory().getAmount(I.RUBY_HARVEST),0);
  });
  test('net '+net+' with a jar preserves the captured-creature message and exchange',t=>{
    const f=fixture(t,net,true);f.catchNpc();f.finish();
    assert.deepEqual(f.messages,['You catch the creature in a jar.']);
    assert.equal(f.p.getInventory().getAmount(I.BUTTERFLY_JAR),0);
    assert.equal(f.p.getInventory().getAmount(I.RUBY_HARVEST),1);assert.deepEqual(f.xp,[24]);
  });
}
test('hands15 still reject, while hands25 keep native catch/release text and XP',t=>{
  const f=fixture(t,null);f.catchNpc();
  assert.deepEqual(f.messages,['You need a Hunter level of at least 25 to catch this butterfly barehanded.']);
  assert.deepEqual(f.xp,[]);
  f.messages.length=0;f.p.getSkillManager().setMaxLevel(core.Skill.HUNTER,25).setCurrentLevels(core.Skill.HUNTER,25);
  f.catchNpc();
  assert.deepEqual(f.messages,['You catch and release the ruby harvest butterfly.']);assert.deepEqual(f.xp,[44]);
});
test('removing the net before the delayed catch preserves cancellation and no reward',t=>{
  const f=fixture(t);f.catchNpc();f.p.getEquipment().set(core.Equipment.WEAPON_SLOT,new core.Item(-1,0));f.finish();
  assert.deepEqual(f.messages,[]);assert.deepEqual(f.xp,[]);
});
