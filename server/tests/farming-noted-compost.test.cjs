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
  core.RegionManager.loadMapFiles(3056,3312); core.RegionManager.loadMapFiles(1272,3729);
});


function fixture(t,tier=1,noted=true,count=2){
 const transport={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
 const p=new Player(new PlayerSession(transport));p.setIndex(index++);p.setUsername('noted'+index);p.setRegistered(true);p.setAttribute('bot-skip-persistence',true);p.setLocation(new core.Location(3200,3200,0));
 const inv=p.getInventory(),base=Data.itemId(['','Compost','Supercompost','Ultracompost'][tier]);
 const input=noted?core.CacheDefinitions.getItem(base).note:base,output=noted?core.CacheDefinitions.getItem(Data.itemId('Bucket')).note:Data.itemId('Bucket');
 inv.setItem(0,new core.Item(Data.itemId('Bottomless compost bucket')));inv.setItem(1,new core.Item(input,count));
 const connection=new ClientConnection(transport);connection.player=p;
 t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});core.TaskManager.cancelTasks(p);p.setRegistered(false);});
 return {p,inv,input,output,tier,connection};
}
async function fill(f,reverse=false,slot=1){await f.connection.dispatch([{type:'inventory_use_on',slot:reverse?0:slot,itemId:reverse?f.inv.forSlot(0).getId():f.input,target:{kind:'inventory',slot:reverse?slot:0}}]);f.connection.processTurnPackets();answer(f.p);}
/** Answers the fill: the most it will take, then Yes on the empty-bucket warning (captures). */
function answer(p){const action=p.getEnteredAmountAction?.();if(!action)return;p.setEnteredAmountAction(null);action.execute(1e9);const d=p.getDialogueManager();if(!/untradeable/.test(d.getCurrent()?.getText?.()??''))return;d.advance();d.handleResume(core.OptionDialogue.OPTIONS_WIDGET_ID,1);}
test('all three noted compost types fill the selected bucket in either orientation and return notes',async t=>{
 for(const tier of [1,2,3])for(const reverse of [false,true]){const f=fixture(t,tier);await fill(f,reverse);assert.equal(f.inv.forSlot(0).getMetaValue('farming:charges'),4);assert.equal(f.inv.forSlot(0).getMetaValue('farming:tier'),tier);assert.equal(f.inv.getAmount(f.input),0);assert.equal(f.inv.getAmount(f.output),2);}
});
test('full inventory refuses a remaining input stack but allows last-note slot reuse or output merge',async t=>{
 for(const count of [1,2]){const f=fixture(t,1,true,count);for(let i=2;i<28;i++)f.inv.setItem(i,new core.Item(Data.itemId('Rake')));if(count===2)f.inv.forSlot(0).setMetaValue('farming:charges',9998).setMetaValue('farming:tier',1);await fill(f);assert.equal(f.inv.getAmount(f.output),count===1?1:0);assert.equal(f.inv.forSlot(0).getMetaValue('farming:charges')??0,count===1?2:9998);assert.equal(f.inv.getAmount(f.input),count===1?0:2);}
 const f=fixture(t);for(let i=2;i<28;i++)f.inv.setItem(i,new core.Item(Data.itemId('Rake')));f.inv.setItem(2,new core.Item(f.output,8));await fill(f);assert.equal(f.inv.getAmount(f.output),10);
});
test('output stack cap, full bucket and mixed tiers leave input and charges intact',async t=>{
 for(const kind of ['stack','full','mixed']){const f=fixture(t);if(kind==='stack')f.inv.setItem(2,new core.Item(f.output,2147483647));if(kind==='full')f.inv.forSlot(0).setMetaValue('farming:charges',10000).setMetaValue('farming:tier',1);if(kind==='mixed')f.inv.forSlot(0).setMetaValue('farming:charges',2).setMetaValue('farming:tier',2);const before=JSON.stringify(f.inv.getCopiedItems());await fill(f);assert.equal(JSON.stringify(f.inv.getCopiedItems()),before,kind);}
});
test('clicked duplicate input and selected bottomless metadata are preserved, with unnoted control',async t=>{
 const f=fixture(t);f.inv.setItem(2,new core.Item(f.input,3).setMetaValue('test:chosen',true));f.inv.forSlot(0).setMetaValue('test:bucket',42);await fill(f,false,2);assert.equal(f.inv.forSlot(1).getAmount(),2);assert.equal(f.inv.getAmount(f.input),2);assert.equal(f.inv.getAmount(f.output),3);assert.equal(f.inv.forSlot(0).getMetaValue('test:bucket'),42);
 const g=fixture(t,3,false,1);await fill(g);assert.equal(g.inv.getAmount(g.output),1);assert.equal(g.inv.forSlot(0).getMetaValue('farming:charges'),2);
 const h=fixture(t);h.inv.forSlot(0).setMetaValue('farming:charges',9998).setMetaValue('farming:tier',1);await fill(h);assert.equal(h.inv.forSlot(0).getMetaValue('farming:charges'),10000);
});


test('5000-bucket batch limit and noted bottomless refusal preserve the input forms',async t=>{
 const f=fixture(t,2,true,5001);await fill(f);assert.equal(f.inv.forSlot(0).getMetaValue('farming:charges'),10000);assert.equal(f.inv.getAmount(f.input),1);assert.equal(f.inv.getAmount(f.output),5000);
 const g=fixture(t);const empty=Data.itemId('Bottomless compost bucket');g.inv.setItem(0,new core.Item(core.CacheDefinitions.getItem(empty).note,2));const before=JSON.stringify(g.inv.getCopiedItems());await fill(g);assert.equal(JSON.stringify(g.inv.getCopiedItems()),before);
});
