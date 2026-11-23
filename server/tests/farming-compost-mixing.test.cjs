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
let core, Data, Patches, index = 1700;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname,'..'));
  PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core = PM.getCoreApi();
  core.RegionManager.init();
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  PM.emitServerStartup({});
  core.World.getProcessCycle = () => cycle;
  core.RegionManager.loadMapFiles(3056,3312); core.RegionManager.loadMapFiles(1272,3729);
});
function fixture(t, type = 'COMPOST', count = 3, tier = 4) {
  const transport = { kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,
    close(){},onData(){},onError(){},onClose(){} };
  const p = new Player(new PlayerSession(transport));
  p.setIndex(index++); p.setUsername('dumpbin' + index); p.setRegistered(true);
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

function setup(t,type='COMPOST',superFirst=true,count=3){
 const f=fixture(t,type,count,superFirst?2:1);Object.assign(f.bin,{closedAt:0,open:false,super:superFirst?count:0,tomatoes:0});Patches.syncPatch(f.p,f.patch);
 f.id=Data.itemId(superFirst?'Weeds':'Pineapple');for(let i=0;i<3;i++)f.inv.add(new core.Item(f.id),false);return f;
}
async function use(f){await input(f,{type:'item_on_object',widgetId:core.Inventory.INTERFACE_ID,objectId:f.patch.id,itemId:f.id,slot:0,x:f.patch.x,y:f.patch.y});}
async function answer(f,n=1){await input(f,{type:'dialogue_continue',widgetId:core.OptionDialogue.OPTIONS_WIDGET_ID,childIndex:n});}
// Each tick is a new world cycle, as World.process runs farming before client input.
let cycle = 0;
function ticks(n) { while (n--) { cycle++; Patches.tick(); } }
test('both mixing directions and bin sizes require confirmation before any input; Yes fills one automatic batch',async t=>{
 for(const type of ['COMPOST','BIG_COMPOST'])for(const direction of [true,false]){
 const f=setup(t,type,direction);await use(f);assert.ok(f.p.getDialogueManager().getCurrent() instanceof core.OptionDialogue);ticks(8);assert.equal(f.bin.count,3);assert.equal(f.inv.getAmount(f.id),3);
 // Weeds all go in together two ticks after the animation (#6539); pineapples one a tick after it.
 await answer(f);ticks(2);assert.equal(f.bin.count,3);ticks(1);assert.equal(f.bin.count,direction?3:4);ticks(12);assert.equal(f.bin.count,6);assert.equal(f.bin.super,3);assert.equal(f.bin.tier,1);assert.equal(f.inv.getAmount(f.id),0);
 }
});
test('No and stale answers preserve inventory and bin',async t=>{
 for(const mode of ['no','close','walk','logout','bin','stack']){
 const f=setup(t);await use(f);
 if(mode==='no')await answer(f,2);if(mode==='close')f.p.getPacketSender().sendInterfaceRemoval();
 if(mode==='walk')await input(f,{type:'move',worldX:f.patch.x-1,worldY:f.patch.y+1,modifierFlags:0});
 if(mode==='logout'){PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});f.p.setRegistered(false);}
 if(mode==='bin')f.bin.count++;if(mode==='stack')f.inv.forSlot(0).setAmount(2);
 const before=JSON.stringify(f.state.bin),items=JSON.stringify(f.inv.getCopiedItems());await answer(f);ticks(12);assert.equal(JSON.stringify(f.state.bin),before,mode);assert.equal(JSON.stringify(f.inv.getCopiedItems()),items,mode);
 }
});
test('empty and compatible bins fill without warning; confirmations cannot replay onto another bin',async t=>{
 for(const empty of [true,false]){const f=setup(t);if(empty){f.bin.count=0;f.bin.super=0;}else{f.bin.super=0;f.bin.tier=1;}await use(f);assert.ok(!(f.p.getDialogueManager().getCurrent() instanceof core.OptionDialogue));ticks(10);assert.equal(f.bin.count,empty?3:6);}
 const f=setup(t),g=setup(t);await use(f);await answer(f);ticks(12);const before=JSON.stringify(f.state.bin);await answer(f);ticks(12);assert.equal(JSON.stringify(f.state.bin),before);assert.equal(g.bin.count,3);assert.equal(g.inv.getAmount(g.id),3);
});
