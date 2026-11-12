// Run after yarn build: node --test --test-concurrency=1 tests/monkey-madness-greegrees-native.test.cjs
// Real inputs/cache/inventory/quest hooks at seeded checkpoints; no natural quest,
// rendered client, retail cadence or paid-exchange capture claim.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { MAIN_PROFILE } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
let core, mm1, mm2, tunnel, stronghold, serial=0;
const spawned = [], errors = [], tasks = new Set();
let originalError, originalSubmit;
const variants = [[3179,4024],[3180,4025],[3181,4026],[3182,4027],[3185,4029],[3186,4030],[3183,4031],[3166,4031],[4034,4028]];
const GARKOR = 'quest.monkey_madness_i.garkor-asked';
const DEMON = 'quest.monkey_madness_i.demon-killed';
before(async () => {
  originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  originalSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function(task, ...args) { tasks.add(task); return originalSubmit.call(this,task,...args); };
  core.RegionManager.init();
  for (const [x,y] of [[2804,9145],[2383,3509]]) core.RegionManager.loadMapFiles(x,y);
  PM.emitServerStartup({});
  const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  mm1 = quests.find(q => q.key === 'monkey_madness_i'); mm2 = quests.find(q => q.key === 'monkey_madness_ii');
  assert.ok(mm1 && mm2);
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/definitions/npc-spawns.json')));
  function worldNpc(id,x,y,z) {
    assert.ok(data.some(row => row.id===id && row.x===x && row.y===y && row.level===z), 'canonical world spawn row');
    const existing = [...core.World.getNpcs()].find(n => n?.getId()===id && n.getLocation().getX()===x && n.getLocation().getY()===y);
    if (existing) return existing;
    const n=PM.spawnNpc({id,x,y,z,wanderRadius:0}); assert.ok(n); spawned.push(n); return n;
  }
  tunnel=worldNpc(7193,2804,9145,0); stronghold=worldNpc(7194,2383,3509,1);
});
after(() => {
  try {
    for (const n of spawned) if(n.isRegistered()) PM.removeNpc(n);
    PM.emitServerShutdown({});
    for(const task of tasks) if(task.isRunning()) task.stop();
    assert.deepEqual(errors, [], 'no swallowed plugin/runtime errors');
  } finally { console.error=originalError; if(core) core.TaskManager.submit=originalSubmit; }
});
function actor(t,stage=9,mm2stage=0,npc=tunnel) {
  const ch={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const session=new PlayerSession(ch),p=new Player(session),c=new ClientConnection(ch);
  c.player=p; session.setPlayer(p); session.setTurnPacketProcessor(()=>c.processTurnPackets());
  p.setUsername('gg'+(Date.now()%1000000)+(++serial)); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence',true); assert.equal(core.World.getPlayers().add(p),true);
  mm1.setStage(p,stage); mm2.setStage(p,mm2stage); p.setAttribute(GARKOR,true);
  const pos=npc.getLocation();p.moveTo(new core.Location(pos.getX()+1,pos.getY(),pos.getZ()));p.needsPlacement=false;
  assert.equal(p.getProfile(),MAIN_PROFILE); assert.equal(p.getPrivateArea(),null); assert.ok(p.getHitpoints()>0);
  assert.equal(p.busy(),false); assert.equal(p.isRegistered(),true);
  const messages=[],send=p.sendMessage.bind(p);p.sendMessage=s=>{messages.push(s);return send(s);};
  t.after(()=>{
    const index=p.getIndex();
    PM.emitPlayerDisconnect({player:p,username:p.getUsername()});PM.emitPlayerLogout({player:p,username:p.getUsername()});
    p.closeInterruptibleInterfaces(); p.getMovementQueue().reset();p.getMovementQueue().walkToReset();
    core.TaskManager.cancelTasks(p);core.TaskManager.cancelTasks(index);core.World.getPlayers().remove(p);
    assert.equal(p.isRegistered(),false);assert.equal(core.TaskManager.hasActiveTask(p),false);assert.equal(core.TaskManager.hasActiveTask(index),false);
  });
  return {p,c,npc,messages};
}
function amount(f,id){return f.p.getInventory().getAmount(id);}
function add(f,id,n=1){f.p.getInventory().add(new core.Item(id,n),true);assert.ok(amount(f,id)>=n);}
function position(f){const l=f.p.getLocation();return [l.getX(),l.getY(),l.getZ()];}
function turn(){core.World.process();core.TaskManager.process();}
async function input(f,packet){await f.c.dispatch([packet]);for(let i=0;i<4;i++)turn();}
function current(f){return f.p.getDialogueManager().getCurrent();}
function options(f){return MultiChatboxPrompt.getPending(f.p)?.options ?? current(f)?.getOptions?.() ?? [];}
function text(f){return current(f)?.getText?.()?.replace(/\s+/g,' ') ?? '';}
async function advance(f){
  assert.ok(!options(f).length,'explicit option selection required');
  const group=f.p.getPacketSender().getChatboxGroupId(); assert.ok(group>0);
  const component = {193:0,229:4,11:4,217:5,231:5}[group];
  assert.ok(Number.isInteger(component),`known native Continue component for group ${group}`);
  await input(f,{type:'dialogue_continue',widgetId:(group<<16)|component,childIndex:group===193?0:-1});
}
async function drain(f,max=160){for(let i=0;i<max && f.p.getDialogueManager().isActive();i++){assert.equal(options(f).length,0,'unexpected menu while draining');await advance(f);}assert.equal(f.p.getDialogueManager().isActive(),false,'dialogue finished within bound');assert.equal(options(f).length,0,'no unexpected remaining menu');}
async function choose(f,label){const opts=options(f),n=opts.findIndex(o=>(typeof o==='string'?o:o.getText?.() ?? o.text)===label);assert.ok(n>=0,`ordinary option ${label}; current text=${text(f)} options=${JSON.stringify(opts)}`);await input(f,{type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:n+1});}
async function talk(f){const d=f.npc.getCurrentDefinition(f.p);assert.ok(d);assert.equal(d.getName(),'Zooknock');const op=d.getActions().indexOf('Talk-to')+1;assert.ok(op>0);await input(f,{type:'npc_option',index:f.npc.getIndex(),clickType:op});}
async function request(f,yes=true){
  await talk(f);assert.ok(options(f).length>0,'repeat Talk-to opens the material-request menu without teleport');
  await choose(f,'Can you make another monkey talisman?');
  for(let i=0;i<8 && !options(f).length;i++)await advance(f);
  await choose(f,yes?'Yes':'No');await drain(f);
}
async function use(f,id){const slot=f.p.getInventory().getSlotForItemId(id);assert.ok(slot>=0);await input(f,{type:'item_on_npc',targetIndex:f.npc.getIndex(),itemId:id,slot,widgetId:149<<16});}
async function exchange(f,remains,talismanFirst=false){await use(f,talismanFirst?4023:remains);await drain(f);await use(f,talismanFirst?remains:4023);await drain(f);}

// Existing unaffected positive is reached through the same real actor/input machinery.
test('control: MM2 stage66 Talk-to still consumes paw/talisman once and advances70',async t=>{
  const f=actor(t,9,66);assert.equal(tunnel.getContentId(f.p),7170);add(f,19523);add(f,4023);await talk(f);
  assert.equal(amount(f,19525),1);assert.equal(amount(f,19523),0);assert.equal(amount(f,4023),0);assert.equal(mm2.getStage(f.p),70);
  await talk(f);assert.equal(amount(f,19525),1);f.p.closeInterruptibleInterfaces();
});
test('completed MM1 with demon-killed flag opens ordinary repeat menu rather than teleporting',async t=>{
  const f=actor(t);f.p.setAttribute(DEMON,true);const start=position(f);add(f,3179);add(f,4023);await request(f);await exchange(f,3179);
  assert.deepEqual(position(f),start);assert.equal(amount(f,4024),1);assert.equal(mm1.getStage(f.p),9);
});
for(const [remains,product] of variants)for(const talismanFirst of [false,true])test(`repeat exact ${remains}->${product}, ${talismanFirst?'talisman':'remains'} first`,async t=>{
  const f=actor(t);assert.equal(tunnel.getContentId(f.p),7170);add(f,remains);add(f,4023);const start=position(f);
  await request(f);await exchange(f,remains,talismanFirst);
  assert.equal(amount(f,remains),0);assert.equal(amount(f,4023),0);assert.equal(amount(f,product),1);assert.deepEqual(position(f),start);assert.equal(mm1.getStage(f.p),9);
});
test('permission is per pair; exact selected variant among different carried bones; repeated same output is paid',async t=>{
  const f=actor(t);for(const [r]of variants)add(f,r);add(f,4023,3);
  await use(f,3186);await drain(f);assert.equal(amount(f,3186),1);assert.ok(f.messages.some(s=>/Ask Zooknock/.test(s)));
  await request(f);await exchange(f,3186);assert.equal(amount(f,4030),1);assert.equal(amount(f,3183),1);assert.equal(amount(f,3179),1);assert.equal(amount(f,4023),2);
  add(f,3186);await use(f,3186);await drain(f);assert.equal(amount(f,3186),1);assert.equal(amount(f,4030),1);
  await request(f);await exchange(f,3186);assert.equal(amount(f,4030),2);assert.equal(amount(f,4023),1);
});
test('No, close, noted and unrelated items cannot consume a pair; full bag still exchanges inputs for output',async t=>{
  const f=actor(t);add(f,3179);add(f,4023);add(f,3184);add(f,995,1);
  await request(f,false);await use(f,3179);await drain(f);assert.equal(amount(f,3179),1);
  await request(f);await use(f,3184);await use(f,995);assert.equal(amount(f,3184),1);assert.equal(amount(f,995),1);assert.ok(f.messages.some(s=>/unnoted/.test(s)));
  while(f.p.getInventory().getFreeSlots()>0)add(f,1511);
  await exchange(f,3179);assert.equal(amount(f,4024),1);assert.equal(amount(f,4023),0);assert.equal(amount(f,3184),1);
});
for(const first of [3179,4023])test(`partial ${first} handover survives close/save/logout/login and completes once`,async t=>{
  const f=actor(t);add(f,3179);add(f,4023);await request(f);await use(f,first);
  assert.ok(f.p.getDialogueManager().isActive());await input(f,{type:'interface_close'});
  assert.equal(f.p.getDialogueManager().isActive(),false);
  assert.equal(amount(f,3179),1);assert.equal(amount(f,4023),1,'offered items retained before handback');
  f.p.closeInterruptibleInterfaces();const saved=PlayerSave.fromPlayer(f.p);PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
  const g=actor(t);saved.applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;
  await use(g,first===3179?4023:3179);await drain(g);assert.equal(amount(g,4024),1);assert.equal(amount(g,3179),0);assert.equal(amount(g,4023),0);
  await input(g,{type:'dialogue_continue',widgetId:(193<<16)|0,childIndex:0});assert.equal(amount(g,4024),1);
});
test('a selected input removed during the second dialogue refuses at handback then can recover without charging twice',async t=>{
  const f=actor(t);add(f,3179);add(f,4023);await request(f);await use(f,3179);await drain(f);await use(f,4023);
  f.p.getInventory().deleteNumber(3179,1);await drain(f);assert.equal(amount(f,4024),0);assert.equal(amount(f,4023),1);assert.ok(f.messages.some(s=>/offered monkey remains/.test(s)));
  add(f,3179);await talk(f);await drain(f);assert.equal(amount(f,4024),1);assert.equal(amount(f,4023),0);
});
for(const first of [3183,4023])test(`initial MM1 both-order/restarted scene ${first} retains inputs or earned output and progresses once`,async t=>{
  const f=actor(t,7);add(f,3183);add(f,4023);await use(f,first);await drain(f);assert.equal(amount(f,3183),1);assert.equal(amount(f,4023),1);
  await use(f,first===3183?4023:3183);assert.ok(f.p.getDialogueManager().isActive());
  await input(f,{type:'interface_close'});await talk(f);assert.ok(f.p.getDialogueManager().isActive());
  // Continue until the real hand-back item statement, then interrupt the story.
  for(let i=0;i<25 && amount(f,4031)===0;i++)await advance(f);
  assert.equal(amount(f,4031),1);assert.equal(amount(f,3183),0);assert.equal(amount(f,4023),0);assert.equal(mm1.getStage(f.p),7);
  const saved=PlayerSave.fromPlayer(f.p);PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
  const g=actor(t,7);saved.applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;
  await talk(g);await drain(g);assert.equal(amount(g,4031),1);assert.equal(mm1.getStage(g.p),8);
});
test('legacy consumed initial credits recover with a full bag refusal and no guessed refund or duplicate reward',async t=>{
  const f=actor(t,7);f.p.setAttribute('quest.monkey_madness_i.talisman-given',true);f.p.setAttribute('quest.monkey_madness_i.remains-given',true);
  while(f.p.getInventory().getFreeSlots()>0)add(f,1511);await talk(f);await drain(f);assert.equal(amount(f,4031),0);assert.ok(f.messages.some(s=>/free inventory slot/.test(s)));
  f.p.getInventory().deleteNumber(1511,1);await talk(f);await drain(f);assert.equal(amount(f,4031),1);assert.equal(mm1.getStage(f.p),8);assert.equal(amount(f,3183),0);assert.equal(amount(f,4023),0);
});
test('bystander and malformed/replayed item packets cannot consume another player offers',async t=>{
  const f=actor(t),g=actor(t);add(f,3179);add(f,4023);add(g,3181);add(g,4023);await request(f);await use(f,3179);await drain(f);
  await use(g,3181);await drain(g);assert.equal(amount(g,3181),1);
  await input(g,{type:'item_on_npc',targetIndex:tunnel.getIndex(),itemId:3179,slot:0,widgetId:149<<16});
  assert.equal(amount(f,3179),1);assert.equal(amount(f,4023),1);await use(f,4023);await drain(f);assert.equal(amount(f,4024),1);assert.equal(amount(g,4026),0);
});
for(const store of ['carried','banked','equipped'])test(`MM2 stage70 existing ${store} Kruk yields paid repeat without granting replacement`,async t=>{
  const f=actor(t,9,70);if(store==='banked')f.p.getBank(0).add(new core.Item(19525),false);else if(store==='equipped')f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT,new core.Item(19525));else add(f,19525);
  add(f,3181);add(f,4023);await request(f);await exchange(f,3181);assert.equal(amount(f,4026),1);assert.equal(mm2.getStage(f.p),70);assert.equal(amount(f,19525),store==='carried'?1:0);
});
test('MM2 missing Kruk replacement and postquest stronghold page retain ownership over item and Talk routes',async t=>{
  const f=actor(t,9,70);add(f,3179);add(f,4023);await use(f,3179);assert.equal(amount(f,3179),1);await talk(f);assert.equal(amount(f,19525),1);assert.equal(amount(f,4023),1);
  const g=actor(t,9,195,stronghold);assert.equal(stronghold.getContentId(g.p),7171);add(g,4023);await use(g,4023);assert.equal(amount(g,4023),1);await talk(g);assert.match(text(g),/Good day/);
  for(let i=0;i<8&&!options(g).length;i++)await advance(g);await choose(g,'Monkey talisman.');for(let i=0;i<12&&!options(g).length;i++)await advance(g);await choose(g,'Large ninja.');
  for(let i=0;i<12&&amount(g,19525)===0;i++)await advance(g);assert.equal(amount(g,19525),1);assert.equal(amount(g,4023),1);
});
test('MM2 stage170 aftermath with existing Kruk retains Talk authority and does not accept paid materials',async t=>{
  const f=actor(t,9,170);add(f,19525);add(f,3179);add(f,4023);await use(f,3179);assert.equal(amount(f,3179),1);await talk(f);
  assert.ok(f.p.getDialogueManager().isActive());assert.equal(options(f).includes('Can you make another monkey talisman?'),false);assert.equal(amount(f,4023),1);assert.equal(mm2.getStage(f.p),170);
  f.p.closeInterruptibleInterfaces();
});
test('inventory slot replacement during ordinary item approach invalidates the offer',async t=>{
  const f=actor(t);add(f,3179);add(f,4023);await request(f);
  const slot=f.p.getInventory().getSlotForItemId(3179);
  // Queue the actual ordinary input, change the selected physical item before
  // the player's next turn, then let World perform admission and approach.
  await f.c.dispatch([{type:'item_on_npc',targetIndex:tunnel.getIndex(),itemId:3179,slot,widgetId:149<<16}]);
  f.p.getInventory().setItem(slot,new core.Item(3181));for(let i=0;i<6;i++)turn();
  await use(f,4023);await drain(f);assert.equal(amount(f,4024),0);assert.equal(amount(f,4026),0);assert.equal(amount(f,3181),1);assert.equal(amount(f,4023),1);
});
test('initial ninja refusal leaves both materials untouched and ordinary initial remains still work',async t=>{
  const f=actor(t,7);add(f,3179);add(f,3183);add(f,4023);await use(f,3179);await drain(f);assert.equal(amount(f,3179),1);assert.equal(amount(f,4023),1);assert.ok(f.messages.some(s=>/first greegree/.test(s)));
  await exchange(f,3183);assert.equal(amount(f,4031),1);assert.equal(amount(f,3179),1);assert.equal(mm1.getStage(f.p),8);
});
test('closing the second-material dialogue before handback preserves both inputs and Talk resumes the same offer',async t=>{
  const f=actor(t);add(f,3180);add(f,4023);await request(f);await use(f,3180);await drain(f);await use(f,4023);
  assert.equal(amount(f,4025),0);await input(f,{type:'interface_close'});assert.equal(f.p.getDialogueManager().isActive(),false);
  assert.equal(amount(f,3180),1);assert.equal(amount(f,4023),1);await talk(f);await drain(f);assert.equal(amount(f,4025),1);assert.equal(amount(f,3180),0);assert.equal(amount(f,4023),0);
});
test('closing a permission confirmation before its reply is continued cannot grant an unconfirmed exchange',async t=>{
  const f=actor(t);add(f,3179);add(f,4023);await talk(f);await choose(f,'Can you make another monkey talisman?');
  for(let i=0;i<8&&!options(f).length;i++)await advance(f);await choose(f,'Yes');
  await input(f,{type:'interface_close'});await use(f,3179);await drain(f);await use(f,4023);await drain(f);
  assert.equal(amount(f,4024),0);assert.equal(amount(f,3179),1);assert.equal(amount(f,4023),1);await request(f);await exchange(f,3179);assert.equal(amount(f,4024),1);
});
