const assert=require('node:assert/strict'),path=require('node:path');
const {before,test}=require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const {ClientConnection}=require('../dist/net/NetworkBuilder');
const {MultiChatboxPrompt}=require('../dist/game/model/menu/MultiChatboxPrompt');
const Progress=require('../plugins/world/seasonal/Progress.ChristmasDinner');
const Dialogue=require('../plugins/world/seasonal/Dialogue.ChristmasDinner');
const source=require('../plugins/world/seasonal/data/christmas-2025-archive.json');
let api,cook,platter,index=2900;
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));api=PM.createApi('ChristmasDinner');
  require('../plugins/world/DefinitionArchives.plugin').register(PM.createApi('DefinitionArchives'));
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('NpcDialogues'));
  const request={bundles:[source.bundle]};PM.emitCustomEvent('definition-archives:install',request);assert.equal(request.handled,true);
  require('../plugins/world/ChristmasDinner.plugin').register(api);
  require('../plugins/interface/DestroyItem.plugin').register(PM.createApi('DestroyItem'));
  Dialogue.activate({key:'christmas-2025',active:true});
  cook=api.core.CacheDefinitions.getNpcId('fai_varrock_bluemoon_chef');platter=Progress.platterId(api);
});
function fixture(t){
  const packets=[],channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:packet=>{packets.push(packet);return true;},close(){},onData(){},onError(){},onClose(){}};
  const player=new Player(new PlayerSession(channel));player.setIndex(index++);player.setRegistered(true);player.setUsername('christmasdialogue');
  const connection=new ClientConnection(channel);connection.player=player;
  const npc=api.core.NPC.create(cook,new api.core.Location(3230,3400));
  t.after(()=>{Dialogue.clear({player});player.closeInterruptibleInterfaces();player.setRegistered(false);api.core.TaskManager.cancelTasks(player.getIndex());});
  return {player,npc,connection,packets};
}
async function resume(f,choice){
  const pending=MultiChatboxPrompt.getPending(f.player);
  const group=[231,217,193,229].find(group=>f.player.getPacketSender().isChatboxInterface(group));
  const packet=pending?{widgetId:MultiChatboxPrompt.OPTIONS_WIDGET_ID,childIndex:choice??1}:{widgetId:(group<<16)|5,childIndex:-1};
  await f.connection.dispatch([{type:'dialogue_continue',...packet}]);f.connection.processTurnPackets();
}
async function finish(f){for(let count=0;count<100;count++){if(!f.player.getDialogueManager().getCurrent()&&!MultiChatboxPrompt.getPending(f.player))return;assert.equal(MultiChatboxPrompt.getPending(f.player),null,'unexpected choice');await resume(f);}assert.fail('dialogue failed to terminate');}
function play(f,variant,options={}){
  let npc=f.npc;
  if(variant.startsWith('serving-the-customers-talking-to-the-customer')||variant.includes('serving-the-table-')){
    const symbol=['xmas25_sir_prysin','xmas25_aggie','xmas25_jobless_jim'][Progress.read(f.player).customer];
    const id=api.core.CacheDefinitions.getArchivedId('christmas-2025','npc',symbol);
    npc=api.core.NPC.create(id,new api.core.Location(3220,3401));
  }
  assert.equal(Dialogue.start(api,{...f,npc,variant,...options}),true);
}
function apply(f,name,...args){return Progress[name](api,f.player,Progress.read(f.player).revision,...args);}
async function start(f){play(f,'starting-the-event-talking-to-the-cook');await resume(f,1);await finish(f);}
test('native choice/continuation reaches canonical platter handout and full inventory refusal',async t=>{
  const f=fixture(t);await start(f);assert.equal(Progress.read(f.player).phase,'queue');assert.equal(f.player.getInventory().getAmount(platter),1);assert.ok(f.packets.length>0);
  const full=fixture(t);for(let slot=0;slot<28;slot++)full.player.getInventory().setItem(slot,new api.core.Item(api.core.ItemIdentifiers.LOGS,1));
  await start(full);assert.equal(Progress.read(full.player).phase,'new');assert.equal(full.player.getInventory().getAmount(platter),0);
});
test('canonical native speech, bar and crate menus drive all three serving cycles',async t=>{
  const f=fixture(t);await start(f);
  for(let customer=0;customer<3;customer++){
  play(f,'serving-the-customers-talking-to-the-customer');await finish(f);assert.equal(Progress.read(f.player).phase,'table');apply(f,'seat',customer);
  play(f,'serving-the-customers-talking-to-the-customer-after-picking-a-table',{drink:'chocolate milk'});await finish(f);assert.equal(Progress.read(f.player).drink,'chocolate milk');
  play(f,'serving-the-customers-searching-the-bar-chocolate-milk',{drink:'chocolate milk'});await finish(f);assert.equal(Progress.read(f.player).drinkHeld,true);
  play(f,'serving-the-customers-serving-the-table-after-getting-the-drink',{table:customer,main:'trout',sides:['cabbage','parsnips','stuffing']});await finish(f);assert.equal(Progress.read(f.player).phase,'ingredients');
  for(const ingredient of ['trout','cabbage','parsnips','stuffing']){
    play(f,ingredient==='trout'?'serving-the-customers-searching-the-main-course-crate':'serving-the-customers-searching-the-side-dish-crate');
    for(let count=0;count<8;count++){
      const pending=MultiChatboxPrompt.getPending(f.player);assert.ok(pending,'source ingredient menu');
      const selected=pending.options.findIndex(name=>name.toLowerCase()===ingredient);
      if(selected>=0){await resume(f,selected+1);break;}
      const next=pending.options.findIndex(name=>name==='Next'||name==='More...');assert.ok(next>=0,'source menu can reach '+ingredient);await resume(f,next+1);
    }
    for(let count=0;count<8&&f.player.getDialogueManager().getCurrent()&&!MultiChatboxPrompt.getPending(f.player);count++)await resume(f);
    f.player.closeInterruptibleInterfaces();
    assert.ok(Progress.read(f.player).gathered.includes(ingredient));
  }
  play(f,customer===0?'serving-the-customers-talking-to-the-cook-with-all-the-ingredients-for-the-first-time':'serving-the-customers-talking-to-the-cook-with-all-the-ingredients-subsequent-times');await finish(f);assert.equal(Progress.read(f.player).phase,'cooked');
  play(f,'serving-the-customers-serving-the-table-with-cooked-food',{table:customer});await finish(f);assert.equal(Progress.read(f.player).customer,customer+1);assert.equal(Progress.read(f.player).phase,customer===2?'ready':'queue');
  }
});
test('scheduler closure invalidates pending native continuation before it can mutate progress',async t=>{
  const f=fixture(t);await start(f);play(f,'serving-the-customers-talking-to-the-customer');
  Dialogue.activate({key:'christmas-2025',active:false});await finish(f);assert.equal(Progress.read(f.player).phase,'queue');
  Dialogue.activate({key:'christmas-2025',active:true});
});

test('a displayed food order survives closing before Continue and can be inspected immediately',async t=>{
  for(const variant of ['serving-the-customers-serving-the-table-after-getting-the-drink','serving-the-customers-talking-to-the-customer-again-before-getting-the-order']){
    const f=fixture(t);apply(f,'begin');apply(f,'greet',0);apply(f,'seat',0);apply(f,'orderDrink','beer');apply(f,'takeDrink','beer');
    if(variant.includes('again-before'))apply(f,'serveDrink',0);
    // Fixed order input isolates persistence; this does not establish live RNG.
    play(f,variant,{table:0,main:'trout',sides:['cabbage','parsnips','stuffing']});
    for(let count=0;count<12&&!f.player.getDialogueManager().getCurrent()?.getText().includes('For my main');count++)await resume(f);
    assert.match(f.player.getDialogueManager().getCurrent()?.getText()??'',/For my main, I would like trout/);
    assert.equal(Progress.read(f.player).phase,'ingredients','the visible order must already belong to saved progression');
    await f.connection.dispatch([{type:'interface_close'}]);f.connection.processTurnPackets();
    await itemOp(f,'Inspect');
    assert.equal(f.player.getDialogueManager().getCurrent()?.text,'I still need to get some trout, cabbage, parsnips, stuffing.');
    await finish(f);
    assert.equal(Progress.read(f.player).main,'trout');
    assert.deepEqual(Progress.read(f.player).sides,['cabbage','parsnips','stuffing']);
  }
});
test('a retained platter can begin a new saved activity without a duplicate handout',async t=>{
  const f=fixture(t);f.player.getInventory().addItem(new api.core.Item(platter,1));
  await start(f);assert.equal(Progress.read(f.player).phase,'queue');assert.equal(f.player.getInventory().getAmount(platter),1);
});
test('native platter inspection lists only missing ingredients without blank placeholders',async t=>{
  const f=fixture(t);apply(f,'begin');apply(f,'greet',0);apply(f,'seat',0);apply(f,'orderDrink','beer');apply(f,'takeDrink','beer');apply(f,'serveDrink',0);apply(f,'orderFood','trout',['cabbage','parsnips','stuffing']);apply(f,'collect','trout');
  play(f,'serving-the-customers-inspecting-the-serving-platter');
  const current=f.player.getDialogueManager().getCurrent();
  assert.equal(current.constructor.name,'ItemStatementDialogue');
  assert.equal(current.text,'I still need to get some cabbage, parsnips, stuffing.');
  await finish(f);
});

async function widget(f,uid,buttonNum,extra={}){
  await f.connection.dispatch([{type:'widget_action',widgetId:uid,groupId:uid>>>16,childId:uid&65535,buttonNum,...extra}]);
  f.connection.processTurnPackets();
}
async function itemOp(f,option){
  const {MAIN_INVENTORY_WIDGET_UID}=require('../dist/net/protocol/ClientProtocol');
  const actions=api.core.CacheDefinitions.getItem(platter).inventoryActions;
  const index=actions.findIndex(action=>action?.toLowerCase()===option.toLowerCase());assert.ok(index>=0);
  await widget(f,MAIN_INVENTORY_WIDGET_UID,[2,3,4,6,7][index],{slot:f.player.getInventory().getSlotForItemId(platter),itemId:platter});
}
test('actual inventory widget Inspect opens the canonical platter message without a fabricated NPC',async t=>{
  const f=fixture(t);apply(f,'begin');await itemOp(f,'Inspect');
  assert.equal(f.player.getDialogueManager().getCurrent()?.text,'The serving platter is empty.');await finish(f);
  apply(f,'greet',0);apply(f,'seat',0);apply(f,'orderDrink','beer');await itemOp(f,'Inspect');
  assert.equal(f.player.getDialogueManager().getCurrent()?.text,'I need to get some beer from the bar.');await finish(f);
  apply(f,'takeDrink','beer');await itemOp(f,'Inspect');
  assert.equal(f.player.getDialogueManager().getCurrent()?.text,'Currently carrying beer.');await finish(f);
  Dialogue.activate({key:'christmas-2025',active:false});
  try{
    await itemOp(f,'Inspect');
    assert.ok(!f.player.getDialogueManager().getCurrent(),'inactive activity cannot start a transcript');
  }finally{Dialogue.activate({key:'christmas-2025',active:true});}
});
test('real shared Destroy cancel preserves contents; confirmation empties progress and a reclaimed platter',async t=>{
  const f=fixture(t);apply(f,'begin');apply(f,'greet',0);apply(f,'seat',0);apply(f,'orderDrink','beer');apply(f,'takeDrink','beer');
  const state=Progress.read(f.player);
  await itemOp(f,'Destroy');assert.equal(f.player.getPacketSender().isChatboxInterface(30005),true);
  assert.equal(f.player.getInventory().getAmount(platter),1);
  await widget(f,(30005<<16)|12,1);assert.deepEqual(Progress.read(f.player),state);
  await itemOp(f,'Destroy');await widget(f,(30005<<16)|11,1);
  assert.equal(f.player.getInventory().getAmount(platter),0);
  assert.equal(Progress.read(f.player).drinkHeld,false,'confirmed loss discards carried drink immediately');
  assert.ok(Progress.read(f.player).revision>state.revision,'loss invalidates existing continuations');
  play(f,'starting-the-event-talking-to-the-cook-after-losing-the-serving-tray');await finish(f);
  assert.equal(f.player.getInventory().getAmount(platter),1);assert.equal(Progress.read(f.player).drinkHeld,false);
  await widget(f,(30005<<16)|11,1);assert.equal(f.player.getInventory().getAmount(platter),1,'old confirmation cannot destroy the replacement');
});
test('native Inspect follows ingredient/cooked states and confirmed destruction removes the cooked meal',async t=>{
  const f=fixture(t);apply(f,'begin');apply(f,'greet',0);apply(f,'seat',0);apply(f,'orderDrink','beer');apply(f,'takeDrink','beer');apply(f,'serveDrink',0);
  apply(f,'orderFood','trout',['cabbage','parsnips','stuffing']);apply(f,'collect','trout');
  await itemOp(f,'Inspect');assert.equal(f.player.getDialogueManager().getCurrent()?.text,'I still need to get some cabbage, parsnips, stuffing.');await finish(f);
  for(const ingredient of ['cabbage','parsnips','stuffing'])apply(f,'collect',ingredient);
  await itemOp(f,'Inspect');assert.equal(f.player.getDialogueManager().getCurrent()?.text,'The serving platter is full of uncooked ingredients. Take them to the Cook!');await finish(f);
  apply(f,'cook');await itemOp(f,'Inspect');assert.equal(f.player.getDialogueManager().getCurrent()?.text,'The serving platter has a fresh, hot, Christmas dinner on it.');await finish(f);
  await itemOp(f,'Destroy');await widget(f,(30005<<16)|11,1);
  assert.equal(Progress.read(f.player).phase,'ingredients');assert.deepEqual(Progress.read(f.player).gathered,[]);
  assert.equal(apply(f,'serveMeal',0),false);
  play(f,'starting-the-event-talking-to-the-cook-after-losing-the-serving-tray');await finish(f);
  assert.equal(f.player.getInventory().getAmount(platter),1);assert.equal(apply(f,'serveMeal',0),false);
});
test('native inventory input rejects a stale slot, a dead player and a busy owner before Inspect',async t=>{
  const f=fixture(t);apply(f,'begin');
  const {MAIN_INVENTORY_WIDGET_UID}=require('../dist/net/protocol/ClientProtocol');
  await widget(f,MAIN_INVENTORY_WIDGET_UID,2,{slot:27,itemId:platter});
  assert.ok(!f.player.getDialogueManager().getCurrent());
  const dead=fixture(t);apply(dead,'begin');dead.player.setHitpoints(0);
  await itemOp(dead,'Inspect');assert.ok(!dead.player.getDialogueManager().getCurrent());
  f.player.getPacketSender().sendInterface(12);assert.equal(f.player.busy(),true);
  await itemOp(f,'Inspect');assert.ok(!f.player.getDialogueManager().getCurrent());
  f.player.closeInterruptibleInterfaces();await itemOp(f,'Inspect');
  assert.equal(f.player.getDialogueManager().getCurrent()?.text,'The serving platter is empty.');await finish(f);
});
function talkToCook(f){
  return PM.emitNpcInteraction({player:f.player,npc:f.npc,npcId:cook,clickType:1,handled:false});
}
test('the actual Cook dispatcher selects the source start, stage reminders and cooking result',async t=>{
  const f=fixture(t);assert.equal(talkToCook(f),true);
  assert.equal(MultiChatboxPrompt.getPending(f.player)?.title,'Ask about the Christmas Event?');
  await resume(f,1);await finish(f);assert.equal(Progress.read(f.player).phase,'queue');
  talkToCook(f);assert.equal(f.player.getDialogueManager().getCurrent()?.getText().replace(/\s+/g,' '),'Sorry to bother you, but what was I meant to be doing again?');await finish(f);
  apply(f,'greet',0);apply(f,'seat',0);apply(f,'orderDrink','beer');apply(f,'takeDrink','beer');apply(f,'serveDrink',0);apply(f,'orderFood','trout',['cabbage','parsnips','stuffing']);
  talkToCook(f);
  const lines=[];
  while(f.player.getDialogueManager().getCurrent()){
    lines.push(f.player.getDialogueManager().getCurrent().getText().replace(/\s+/g,' '));await resume(f);
  }
  assert.ok(lines.includes('trout, with cabbage, parsnips, stuffing.'),'actual order reminder resolves the original source placeholders');
  for(const ingredient of ['trout','cabbage','parsnips','stuffing'])apply(f,'collect',ingredient);
  talkToCook(f);await finish(f);assert.equal(Progress.read(f.player).phase,'cooked');
  talkToCook(f);await finish(f);assert.equal(Progress.read(f.player).phase,'cooked','reminder does not serve the meal');
});
test('native NPC packet and walk-to reach the Cook activity only while its epoch is active',async t=>{
  const f=fixture(t),core=api.core;
  // The Cook's original Wiki location is3230,3400. This registered test actor
  // is a seeded fixture, not evidence of queue/seat NPC placement or rendering.
  core.World.getNpcs().add(f.npc);t.after(()=>core.World.getNpcs().remove(f.npc));
  f.player.setLocation(new core.Location(3230,3399));f.player.setNeedsPlacement(false);
  async function click(){
    await f.connection.dispatch([{type:'npc_option',index:f.npc.getIndex(),clickType:1}]);f.connection.processTurnPackets();
    for(let count=0;count<4;count++){core.TaskManager.processWalkTo(f.player.getIndex());f.player.getMovementQueue().process();core.TaskManager.process();}
  }
  await click();assert.equal(MultiChatboxPrompt.getPending(f.player)?.title,'Ask about the Christmas Event?');
  await resume(f,2);await finish(f);assert.equal(Progress.read(f.player).phase,'new');
  Dialogue.activate({key:'christmas-2025',active:false});
  try{
    await click();assert.notEqual(MultiChatboxPrompt.getPending(f.player)?.title,'Ask about the Christmas Event?');
  }finally{Dialogue.activate({key:'christmas-2025',active:true});}
});
