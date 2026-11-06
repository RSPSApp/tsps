// Build first: node --test tests/event-scheduler.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test, before, beforeEach, afterEach} = require('node:test');
const {Server} = require('../dist/Server');
Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {CommandPacketListener} = require('../dist/net/packet/impl/CommandPacketListener');
const {Player} = require('../dist/game/entity/impl/player/Player');
const pluginPath = path.resolve(__dirname,'../plugins/world/EventScheduler.plugin.js');
const dataPath = path.resolve(__dirname,'../plugins/world/data/events.json');
const configured = fs.existsSync(dataPath) ? require(dataPath) : [];
const shipped = JSON.stringify(configured);
let core, api, events = [], consumer = null, enableConsumer = false;
const START = Date.parse('2026-12-24T00:00:00.000Z');
const END = Date.parse('2027-01-04T00:00:00.000Z');
const definition = (key='fixture') => ({key,enabled:true,windows:[{start:new Date(START).toISOString(),end:new Date(END).toISOString()}]});
function status(key='fixture') {const q={key,active:null};PM.emitCustomEvent('events:status',q);return q.active;}
function command(text,rights) {
  const p=new Player(null);p.setUsername('holidayqa');
  const sender=new Proxy({}, {get:()=>()=>sender});p.getPacketSender=()=>sender;p.setHitpoints(10);
  p.setRights(rights ?? core.PlayerRights.OWNER);
  const messages=[];p.sendMessage=m=>messages.push(m);
  CommandPacketListener.execute(p,text);return messages;
}
function transition(e) {
  events.push({key:e.key,active:e.active,query:status(e.key)});
  if(enableConsumer && e.key==='fixture') {
    if(e.active) consumer=api.spawnNpc({id:core.NpcIdentifiers.MAN,x:3222,y:3218,z:0,wanderRadius:0});
    else if(consumer) {api.removeNpc(consumer);consumer=null;}
  }
}
function start() {assert.ok(fs.existsSync(pluginPath),'world scheduler plugin must exist');PM.emitServerStartup({timestamp:Date.now()});}
function stop() {PM.emitServerShutdown({timestamp:Date.now()});}
function tasks() {return [...core.TaskManager.pendingTasks.toArray(),...core.TaskManager.activeTasks].filter(t=>t.key==='event-scheduler:clock'&&t.isRunning());}
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  core=PM.getCoreApi();api=PM.createApi('EventScheduler');
  if(fs.existsSync(pluginPath)) require(pluginPath).register(api);
  PM.createApi('HolidayConsumerTest').onCustomEvent('events:active',transition);
});
beforeEach(()=>{stop();configured.splice(0,configured.length,definition());events=[];enableConsumer=false;});
afterEach(()=>{stop();configured.splice(0,configured.length,...JSON.parse(shipped));});
test('loads through the supported register lifecycle without initialize',()=>{
  start();assert.equal(typeof status(),'boolean');assert.equal(tasks().length,1);
});
test('UTC windows include their start and exclude their end across New Year',(t)=>{
  let now=START-1;t.mock.method(Date,'now',()=>now);start();assert.equal(status(),false);
  now=START;command('forceevent fixture auto');assert.equal(status(),true);
  assert.deepEqual(events,[{key:'fixture',active:true,query:true}]);
  now=END;command('forceevent fixture auto');assert.equal(status(),false);
  assert.deepEqual(events.at(-1),{key:'fixture',active:false,query:false});
});
test('native command arguments force on/off/auto and reject unknown keys or modes',(t)=>{
  t.mock.method(Date,'now',()=>START-1);start();
  command('::forceevent fixture');assert.equal(status(),true);
  command('forceevent fixture off');assert.equal(status(),false);
  command('forceevent fixture on');assert.equal(status(),true);
  assert.match(command('forceevent imaginary on').join(' '),/unknown/i);
  assert.match(command('forceevent fixture nonsense').join(' '),/usage/i);assert.equal(status(),true);
  command('forceevent fixture auto');assert.equal(status(),false);
});
test('ordinary players and Administrators cannot change the event',(t)=>{
  t.mock.method(Date,'now',()=>START-1);start();
  for(const rank of [core.PlayerRights.NONE,core.PlayerRights.MODERATOR,core.PlayerRights.ADMINISTRATOR]) {
    assert.match(command('forceevent fixture on',rank).join(' '),/permission/i);assert.equal(status(),false);
  }
  command('forceevent fixture on',core.PlayerRights.OWNER);assert.equal(status(),true);
});
test('disabled events require an explicit test override and reset restores all dates',(t)=>{
  t.mock.method(Date,'now',()=>START+1);configured[0].enabled=false;
  configured.push(definition('second'));start();assert.equal(status(),false);assert.equal(status('second'),true);
  command('forceevent fixture on');command('forceevent second off');
  assert.equal(status(),true);assert.equal(status('second'),false);
  command('forceevent reset');assert.equal(status(),false);assert.equal(status('second'),true);
});
test('duplicate startup/repeated commands emit one transition and own one task',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();start();command('forceevent fixture on');command('forceevent fixture on');
  assert.equal(tasks().length,1);assert.equal(events.length,1);
});
test('the real task loop closes an expired event without another command',(t)=>{
  let now=START;t.mock.method(Date,'now',()=>now);start();now=END;
  const delay=tasks()[0].getDelay();assert.ok(delay>0);
  for(let i=0;i<delay;i++)core.TaskManager.process();
  assert.equal(status(),false);assert.equal(events.length,2);
});
test('shutdown cancels its real task, not unrelated tasks; restart drops overrides',(t)=>{
  t.mock.method(Date,'now',()=>START-1);start();command('forceevent fixture on');
  const own=tasks()[0];const other=new(class extends core.Task {execute(){}})(1,'other-plugin');
  core.TaskManager.submit(other);stop();stop();assert.equal(own.isRunning(),false);assert.equal(other.isRunning(),true);
  assert.equal(status(),false);assert.equal(events.filter(e=>!e.active).length,1);
  command('forceevent fixture on');assert.equal(status(),false);
  start();assert.equal(status(),false);assert.equal(tasks().length,1);other.stop();
});
test('real consumer NPC is removed on close and shutdown without removing another NPC',(t)=>{
  t.mock.method(Date,'now',()=>START-1);enableConsumer=true;start();
  const unrelated=api.spawnNpc({id:core.NpcIdentifiers.MAN,x:3223,y:3218,z:0});
  command('forceevent fixture on');const first=consumer;assert.ok(first?.isRegistered());
  command('forceevent fixture off');assert.equal(first.isRegistered(),false);assert.equal(unrelated.isRegistered(),true);
  command('forceevent fixture on');const second=consumer;assert.notEqual(first,second);
  stop();assert.equal(second.isRegistered(),false);assert.equal(unrelated.isRegistered(),true);api.removeNpc(unrelated);
});
test('unknown queries are inactive and query results cannot mutate scheduler state',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();assert.equal(status('missing'),false);
  const q={key:'fixture',active:false};PM.emitCustomEvent('events:status',q);q.active=false;assert.equal(status(),true);
});
test('rejects duplicate keys, invalid dates and reversed/empty windows before activation',(t)=>{
  t.mock.method(Date,'now',()=>START+1);
  for(const input of [[definition(),definition()],[{...definition(),windows:[{start:'nonsense',end:new Date(END).toISOString()}]}],[{...definition(),windows:[{start:new Date(END).toISOString(),end:new Date(START).toISOString()}]}],[{...definition(),windows:[]}]] ) {
    configured.splice(0,configured.length,...input);start();assert.equal(status(),false);assert.equal(tasks().length,0);stop();
  }
});
test('reentrant Owner close and shutdown reach every subscriber in start/stop order',(t)=>{
  t.mock.method(Date,'now',()=>START-1);
  let action=null,watching=true,lateNpc=null;
  const observed=[];
  api.onCustomEvent('events:active',e=>{
    if(!watching||e.key!=='fixture'||!e.active||!action)return;
    const close=action;action=null;
    if(close==='shutdown')stop();else command('forceevent fixture off');
  });
  api.onCustomEvent('events:active',e=>{
    if(!watching||e.key!=='fixture')return;
    observed.push({active:e.active,query:status()});
    if(e.active)lateNpc=api.spawnNpc({id:core.NpcIdentifiers.MAN,x:3222,y:3218,z:0});
    else if(lateNpc){api.removeNpc(lateNpc);lateNpc=null;}
  });
  t.after(()=>{watching=false;if(lateNpc)api.removeNpc(lateNpc);});
  for(const mode of ['command','shutdown']) {
    stop();observed.length=0;start();action=mode;command('forceevent fixture on');
    assert.deepEqual(observed,[{active:true,query:true},{active:false,query:false}]);
    assert.equal(status(),false);assert.equal(lateNpc,null);
  }
});

function rewardPlayer() {
  const p=new Player(null);p.setUsername('holidayqa');p.getSession=()=>({sendClientPacket:()=>true});p.sendMessage=()=>{};return p;
}
function grant(p,extra={}) {
  const q={player:p,eventKey:'fixture',completion:'fixture-2026',rewards:[{itemId:core.ItemIdentifiers.SANTA_HAT,amount:1},{itemId:core.ItemIdentifiers.COINS,amount:5}],...extra};
  PM.emitCustomEvent('events:grant-reward',q);return q;
}
function completed(p,completion='fixture-2026') {const q={player:p,completion};PM.emitCustomEvent('events:completed',q);return q.completed;}
test('grant-reward gives every item once per completion key on a real inventory',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer();
  assert.equal(completed(p),false);
  const first=grant(p);assert.equal(first.granted,true);assert.equal(first.reason,null);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.SANTA_HAT),1);assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.COINS),5);
  const again=grant(p);assert.equal(again.granted,false);assert.equal(again.reason,'already-complete');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.SANTA_HAT),1);assert.equal(completed(p),true);
  assert.equal(grant(p,{completion:'fixture-2027'}).granted,true,'a different year is independent');
});
test('grant-reward refuses outside the window or when stopped and records nothing',(t)=>{
  let now=START-1;t.mock.method(Date,'now',()=>now);start();const p=rewardPlayer();
  assert.equal(grant(p).reason,'inactive');now=START+1;command('forceevent fixture auto');
  stop();assert.equal(grant(p).reason,'inactive');
  assert.equal(p.getInventory().getFreeSlots(),28);assert.equal(completed(p),false);
});
test('a full inventory or capped stack keeps the completion and grants nothing',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer(),inv=p.getInventory();
  for(let i=0;i<27;i++)inv.setItem(i,new core.Item(core.ItemIdentifiers.LOGS,1));
  // One free slot: the hat fits, the coins would need a second slot.
  const q=grant(p);assert.equal(q.granted,false);assert.equal(q.reason,'no-space');
  assert.equal(inv.getAmount(core.ItemIdentifiers.SANTA_HAT),0);assert.equal(completed(p),false);
  inv.setItem(26,new core.Item(core.ItemIdentifiers.COINS,2147483647-4));
  assert.equal(grant(p,{rewards:[{itemId:core.ItemIdentifiers.COINS,amount:5}]}).reason,'no-space','stack cap');
  assert.equal(grant(p,{rewards:[{itemId:core.ItemIdentifiers.COINS,amount:4}]}).granted,true,'exactly the room left');
  assert.equal(inv.getAmount(core.ItemIdentifiers.COINS),2147483647);
});
test('invalid requests and bad Diango unlocks are rejected without side effects',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer();
  for(const extra of [{rewards:[{itemId:0,amount:1}]},{rewards:[{itemId:core.ItemIdentifiers.SANTA_HAT,amount:0}]},{completion:'Bad Key'},{eventKey:undefined}])
    assert.equal(grant(p,extra).reason,'invalid');
  assert.equal(p.getInventory().getFreeSlots(),28);assert.equal(completed(p),false);
});
test('completions survive a real save and reload',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer();grant(p);
  const Json=require('../plugins/persistence/JsonPlayerPersistence.plugin'),codec=new Json.JsonPlayerPersistence();
  Json.register(PM.createApi('JsonPlayerPersistence'));
  const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const saved=JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p),codec.replacer.bind(codec)),codec.reviver.bind(codec));
  const restored=rewardPlayer();codec.hydratePlayerSave(saved).applyToPlayer(restored);
  assert.equal(completed(restored),true);assert.equal(grant(restored).reason,'already-complete');
});
test('a successful grant records its Diango unlocks; an unknown name blocks the whole grant',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();
  require('../plugins/world/HolidayRewards.plugin.js').register(PM.createApi('HolidayRewards'));
  const p=rewardPlayer();
  assert.equal(grant(p,{unlock:['win05_hat1','no_such_holiday_item']}).reason,'unlock-refused');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.SANTA_HAT),0);assert.equal(completed(p),false);
  assert.equal(grant(p,{unlock:['win05_hat1']}).granted,true);
  assert.deepEqual(p.getAttribute('holiday-rewards:unlocked'),['win05_hat1']);
});
test('ids past the cache and amounts past the stack cap are invalid, not clamped',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer();
  const past=core.CacheDefinitions.getCounts().items;
  assert.equal(grant(p,{rewards:[{itemId:past+5,amount:1}]}).reason,'invalid');
  assert.equal(grant(p,{rewards:[{itemId:core.ItemIdentifiers.COINS,amount:3000000000}]}).reason,'invalid');
  assert.equal(p.getInventory().getFreeSlots(),28);assert.equal(completed(p),false);
});
test('a plain stack beside a metadata stack of the same id is planned like add merges it',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer(),inv=p.getInventory();
  inv.setItem(0,new core.Item(core.ItemIdentifiers.COINS,2000000000).setMeta({x:1}));inv.setItem(1,new core.Item(core.ItemIdentifiers.COINS,1));
  assert.equal(grant(p,{rewards:[{itemId:core.ItemIdentifiers.COINS,amount:200000000}]}).granted,true);
  assert.equal(inv.getItems()[1].getAmount(),200000001);assert.equal(inv.getItems()[0].getAmount(),2000000000);
});
test('a grant nested inside the unlock listener is refused and the outer completion keeps every key',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer();let nested=null,armed=true;
  PM.createApi('NestedGrantTest').onCustomEvent('holiday-rewards:unlock',e=>{
    if(!armed||e.player!==p)return;armed=false;e.accepted=true;
    nested=grant(p,{completion:'other-2026',rewards:[{itemId:core.ItemIdentifiers.SANTA_HAT,amount:1}]});
  });
  const outer=grant(p,{unlock:['win05_hat1'],rewards:[{itemId:core.ItemIdentifiers.SANTA_HAT,amount:1}]});
  assert.equal(nested.reason,'busy');assert.equal(outer.granted,true);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.SANTA_HAT),1);
  assert.equal(completed(p,'other-2026'),false);assert.equal(grant(p,{completion:'other-2026'}).granted,true);
  assert.deepEqual(p.getAttribute('events:completions').sort(),['fixture-2026','other-2026']);
});
test('take consumes a held item in the same all-or-nothing plan, and its slot is free for the rewards',(t)=>{
  t.mock.method(Date,'now',()=>START+1);start();const p=rewardPlayer(),inv=p.getInventory(),I=core.ItemIdentifiers;
  for(let i=0;i<27;i++)inv.setItem(i,new core.Item(I.LOGS,1));
  const take=[{itemId:I.LOGS,amount:1}],hat=[{itemId:I.SANTA_HAT,amount:1}];
  assert.equal(grant(p,{rewards:[...hat,{itemId:I.COINS,amount:5}],take}).granted,true,'the taken log frees the second slot');
  assert.equal(inv.getAmount(I.LOGS),26);assert.equal(inv.getAmount(I.SANTA_HAT),1);assert.equal(inv.getAmount(I.COINS),5);
  const missing=grant(p,{completion:'fixture-2027',rewards:hat,take:[{itemId:I.BRONZE_DAGGER,amount:1}]});
  assert.equal(missing.reason,'missing-items');assert.equal(completed(p,'fixture-2027'),false);
  assert.equal(inv.getAmount(I.SANTA_HAT),1,'a refused take grants nothing');
  assert.equal(grant(p,{completion:'fixture-2028',take:[{itemId:0,amount:1}]}).reason,'invalid');
});
test('record-completion imports a claim idempotently, outside the window, and blocks a later grant',(t)=>{
  t.mock.method(Date,'now',()=>END+1);start();const p=rewardPlayer();
  for(let i=0;i<2;i++){const q={player:p,completion:'fixture-2026'};PM.emitCustomEvent('events:record-completion',q);assert.equal(q.recorded,true);}
  assert.deepEqual(p.getAttribute('events:completions'),['fixture-2026']);
  const bad={player:p,completion:'Not A Key'};PM.emitCustomEvent('events:record-completion',bad);assert.equal(bad.recorded,false);
  t.mock.method(Date,'now',()=>START+1);command('forceevent fixture auto');
  assert.equal(grant(p).reason,'already-complete');assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.SANTA_HAT),0);
});
