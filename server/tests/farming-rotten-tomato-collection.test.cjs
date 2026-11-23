// Real map objects, players, containers, Farming work and native object packets; network only is stubbed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { after, before, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { GameConstants } = require('../dist/game/GameConstants');
let core, Data, Patches, Services, index = 1700;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname,'..'));
  PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core = PM.getCoreApi();
  core.RegionManager.init();
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Services = require('../plugins/skills/farming/Services.Farming');
  PM.emitServerStartup({});
  realProcessCycle = core.World.getProcessCycle;
  core.World.getProcessCycle = () => cycle;
  core.RegionManager.loadMapFiles(3056,3312); core.RegionManager.loadMapFiles(1272,3729);
});
function fixture(t, type = 'COMPOST', count = 3, tier = 4) {
  const transport = { kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,
    close(){},onData(){},onError(){},onClose(){} };
  const p = new Player(new PlayerSession(transport));
  p.setIndex(index++); p.setUsername('tomatobin' + index); p.setRegistered(true);
  p.setAttribute('bot-skip-persistence',true);
  p.getSkillManager().setMaxLevels(core.Skill.FARMING,99,false).setCurrentLevels(core.Skill.FARMING,99,false);
  const patch = Data.CACHE.patches.find(p => p.type === type && (type === 'BIG_COMPOST' || p.x === 3056));
  p.setLocation(new core.Location(patch.x - 1,patch.y,patch.z));
  const state = Patches.stateFor(p,patch);
  state.bin = { count,super:0,tomatoes:tier === 4 ? count : 0,tier,closedAt:1,open:true };
  Patches.syncPatch(p,patch);
  const connection = new ClientConnection(transport); connection.player=p;
  const messages=[];
  t.mock.method(p.getPacketSender(),'sendMessage',text=>{messages.push(text);return p.getPacketSender();});
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});core.TaskManager.cancelTasks(p);p.setRegistered(false);});
  return {p,patch,state,bin:state.bin,connection,messages,inv:p.getInventory(),xp:p.getSkillManager().getExperience(core.Skill.FARMING)};
}
async function input(f,packet) {
  await f.connection.dispatch([packet]); f.connection.processTurnPackets();
  f.p.getMovementQueue().process(); core.TaskManager.processWalkTo(f.p.getIndex());
}
async function take(f) {
  const definition = core.ObjectDefinition.forPlayer(f.patch.id,f.p);
  assert.equal(definition.getInteractions()[0],'Take','active-cache collection option');
  await input(f,{type:'object_option',id:f.patch.id,x:f.patch.x,y:f.patch.y,action:'Take'});
}
// Each tick is a new world cycle, as World.process runs farming before client input.
let cycle = 0, realProcessCycle;
after(() => { if (realProcessCycle) core.World.getProcessCycle = realProcessCycle; });
function ticks(n) { while (n--) { cycle++; Patches.tick(); } }
function amount(f,name) { return f.inv.getAmount(Data.itemId(name)); }
function stock(f,name,n) { for(let i=0;i<n;i++) f.inv.add(new core.Item(Data.itemId(name)),false); }

test('both bin sizes collect tomatoes without buckets, every four ticks, with XP and final reset',async t=>{
  for(const type of ['COMPOST','BIG_COMPOST']) {
    const f=fixture(t,type); await take(f); ticks(1); assert.equal(amount(f,'Rotten tomato'),0);
    // Standing at the bin: scooped a tick after the click (#6539).
    ticks(1); assert.equal(amount(f,'Rotten tomato'),1); assert.equal(f.bin.count,2);
    ticks(3); assert.equal(amount(f,'Rotten tomato'),1);
    ticks(1); assert.equal(amount(f,'Rotten tomato'),2);
    ticks(4); assert.equal(amount(f,'Rotten tomato'),3); assert.equal(f.state.bin.count,0); assert.equal(f.state.bin.open,false);
    assert.equal(f.p.getSkillManager().getSkills().experience[core.Skill.FARMING.getIndex()]-f.xp,13.5*GameConstants.EXPERIENCE_MULTIPLIER);
    assert.equal(f.p.getPacketSender().getVarbit(f.patch.varbit),0);
  }
});
test('carried buckets are preserved and do not create capacity for a tomato',async t=>{
  const f=fixture(t);stock(f,'Bucket',28);await take(f);ticks(12);
  assert.equal(amount(f,'Bucket'),28);assert.equal(amount(f,'Rotten tomato'),0);assert.equal(f.bin.count,3);
  assert.ok(f.messages.some(m=>m.includes("You don't have space to hold a rotten tomato")));
  const g=fixture(t);stock(g,'Bucket',1);await take(g);ticks(3);
  assert.equal(amount(g,'Bucket'),1);assert.equal(amount(g,'Rotten tomato'),1);
});
test('last slot stops collection without loss, and capacity is rechecked after animation',async t=>{
  const f=fixture(t);stock(f,'Rake',27);await take(f);ticks(12);
  assert.equal(amount(f,'Rotten tomato'),1);assert.equal(f.bin.count,2);
  const g=fixture(t);await take(g);ticks(1);stock(g,'Rake',28);ticks(1);
  assert.equal(amount(g,'Rotten tomato'),0);assert.equal(g.bin.count,3);
  assert.equal(g.p.getSkillManager().getExperience(core.Skill.FARMING),g.xp);
});
test('native walking cancels collection before output and repeated Take never duplicates it',async t=>{
  const f=fixture(t);await take(f);ticks(1);
  await input(f,{type:'move',x:f.patch.x-2,y:f.patch.y,run:false});ticks(10);
  assert.equal(amount(f,'Rotten tomato'),0);assert.equal(f.bin.count,3);
  const g=fixture(t);await take(g);await take(g);ticks(15);
  assert.ok(amount(g,'Rotten tomato')<=3);assert.equal(amount(g,'Rotten tomato')+(g.state.bin?.count??0),3);
});
test('ordinary compost still exchanges one empty bucket for one filled bucket',async t=>{
  const f=fixture(t,'COMPOST',2,1);stock(f,'Bucket',2);await take(f);ticks(7);
  assert.equal(amount(f,'Bucket'),0);assert.equal(amount(f,'Compost'),2);assert.equal(f.state.bin.count,0);assert.equal(f.state.bin.open,false);
  const g=fixture(t,'COMPOST',2,1);await take(g);ticks(7);
  assert.equal(amount(g,'Compost'),0);assert.equal(g.bin.count,2);
});
