// Real map objects, players, containers, Farming work and native object packets; network only is stubbed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
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
let cycle = 0;
function ticks(n) { while (n--) { cycle++; Patches.tick(); } }
function amount(f,name) { return f.inv.getAmount(Data.itemId(name)); }
function stock(f,name,n) { for(let i=0;i<n;i++) f.inv.add(new core.Item(Data.itemId(name)),false); }


function bottomless(f,charges=0,tier=0){const item=new core.Item(charges?core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4:Data.itemId('Bottomless compost bucket')).setMetaValue('farming:charges',charges).setMetaValue('farming:tier',tier).setMetaValue('test:owner',f.p.getUsername());f.inv.add(item,false);return f.inv.getValidItems().find(i=>i.getMetaValue('test:owner')===f.p.getUsername()&&i.getMetaValue('farming:charges')===charges);}
test('both bin sizes and all compost tiers collect into a carried bottomless bucket with existing cadence and XP',async t=>{
 for(const type of ['COMPOST','BIG_COMPOST'])for(const tier of [1,2,3]){const f=fixture(t,type,3,tier);bottomless(f);await take(f);ticks(1);assert.equal(f.bin.count,3);ticks(1);assert.equal(f.bin.count,2);ticks(8);assert.equal(f.state.bin.count,0);const b=f.inv.getValidItems()[0];assert.equal(b.getMetaValue('farming:charges'),6);assert.equal(b.getMetaValue('farming:tier'),tier);assert.equal(b.getMetaValue('test:owner'),f.p.getUsername());assert.equal(f.p.getSkillManager().getSkills().experience[core.Skill.FARMING.getIndex()]-f.xp,[0,4.5,8.5,10][tier]*3*GameConstants.EXPERIENCE_MULTIPLIER);}
});
test('ordinary buckets take priority and collection continues into the carried bottomless bucket',async t=>{
 const f=fixture(t,'COMPOST',3,1);stock(f,'Bucket',1);bottomless(f);await take(f);ticks(3);assert.equal(amount(f,'Compost'),1);assert.equal(f.inv.getValidItems().find(i=>i.getMetaValue('test:owner')).getMetaValue('farming:charges'),0);ticks(8);assert.equal(f.state.bin.count,0);assert.equal(f.inv.getValidItems().find(i=>i.getMetaValue('test:owner')).getMetaValue('farming:charges'),4);
});
test('full/mismatched/noted buckets refuse, skip to eligible ones, and cap exhaustion preserves remaining bin',async t=>{
 for(const mode of ['full','mixed','noted']){const f=fixture(t,'COMPOST',3,1);if(mode==='noted')f.inv.add(new core.Item(core.CacheDefinitions.getItem(Data.itemId('Bottomless compost bucket')).note),false);else bottomless(f,mode==='full'?10000:2,2);await take(f);ticks(12);assert.equal(f.bin.count,3);assert.equal(f.p.getSkillManager().getExperience(core.Skill.FARMING),f.xp);}
 const f=fixture(t,'COMPOST',3,1);bottomless(f,9998,1);await take(f);ticks(11);assert.equal(f.bin.count,2);assert.equal(f.inv.getValidItems()[0].getMetaValue('farming:charges'),10000);bottomless(f);f.p.getClickDelay().reset(-100);await take(f);ticks(7);assert.equal(f.state.bin.count,0);assert.equal(f.inv.getValidItems()[1].getMetaValue('farming:charges'),4);
});
test('full inventory still collects charges; native walking prevents output; tomatoes never charge a bucket',async t=>{
 const f=fixture(t,'COMPOST',3,2);bottomless(f);stock(f,'Rake',27);await take(f);ticks(11);assert.equal(f.state.bin.count,0);assert.equal(f.inv.getFreeSlots(),0);assert.equal(f.inv.getValidItems()[0].getMetaValue('farming:charges'),6);
 const g=fixture(t,'COMPOST',3,1);bottomless(g);await take(g);ticks(1);await input(g,{type:'move',worldX:g.patch.x-1,worldY:g.patch.y+1,modifierFlags:0});assert.equal(g.p.getLocation().getY(),g.patch.y+1);ticks(10);assert.equal(g.bin.count,3);assert.equal(g.inv.getValidItems()[0].getMetaValue('farming:charges'),0);
 const h=fixture(t,'COMPOST',3,4);bottomless(h);await take(h);ticks(11);assert.equal(amount(h,'Rotten tomato'),3);assert.equal(h.inv.getValidItems()[0].getMetaValue('farming:charges'),0);
});

