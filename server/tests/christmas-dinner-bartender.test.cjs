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
let api,c,bartenderId;
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));api=PM.createApi('ChristmasDinner');c=api.core;c.RegionManager.init();
  require('../plugins/world/DefinitionArchives.plugin').register(PM.createApi('DefinitionArchives'));
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('NpcDialogues'));
  require('../plugins/npcs/Bartenders.plugin').register(PM.createApi('Bartenders'));
  require('../plugins/world/ChristmasDinner.plugin').register(api);
  bartenderId=c.CacheDefinitions.getNpcId('bluemoon_bartender');assert.ok(bartenderId!==null);
});
function fixture(t){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const player=new Player(new PlayerSession(channel)),connection=new ClientConnection(channel);connection.player=player;
  assert.equal(c.World.getPlayers().add(player),true);
  // Registered actor positions are seeded routing fixtures, not spawn evidence.
  const npc=c.NPC.create(bartenderId,new c.Location(3230,3400));assert.equal(c.World.getNpcs().add(npc),true);
  t.after(()=>{player.closeInterruptibleInterfaces();c.TaskManager.cancelTasks(player.getIndex());c.World.getNpcs().remove(npc);c.World.getPlayers().remove(player);PM.emitCustomEvent('events:active',{key:'christmas-2025',active:false});});
  PM.emitCustomEvent('events:active',{key:'christmas-2025',active:true});
  return {player,npc,connection};
}
async function talk(f){
  f.player.setLocation(new c.Location(3230,3399));f.player.setNeedsPlacement(false);
  await f.connection.dispatch([{type:'npc_option',index:f.npc.getIndex(),clickType:1}]);f.connection.processTurnPackets();
  for(let tick=0;tick<4;tick++){c.TaskManager.processWalkTo(f.player.getIndex());f.player.getMovementQueue().process();c.TaskManager.process();}
}
async function resume(f,choice=1){
  const pending=MultiChatboxPrompt.getPending(f.player),group=f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{type:'dialogue_continue',widgetId:pending?MultiChatboxPrompt.OPTIONS_WIDGET_ID:(group<<16)|5,childIndex:pending?choice:-1}]);f.connection.processTurnPackets();
}
async function close(f){await f.connection.dispatch([{type:'interface_close'}]);f.connection.processTurnPackets();}
const text=f=>f.player.getDialogueManager().getCurrent()?.getText?.().replace(/\s+/g,' ');

test('native bartender conversation uses annual greetings and retains the ordinary menu across activity stages',async t=>{
  const f=fixture(t);
  for(const [phase,expected]of [
    ['new',"If you're here to offer us a hand during the festive rush, please talk to the cook in the kitchen!"],
    ['queue','Thanks for all your help!'],
    ['complete',"No time to chat, we're rushed off our feet!"],
  ]){
    // Completion is seeded; this tests routing, not unfinished event completion.
    f.player.setAttribute(Progress.PROGRESS_ATTRIBUTE,{...Progress.initial(),phase,...(phase==='complete'?{customer:3,seats:[0,1,2]}:{})});
    await talk(f);assert.equal(text(f),expected);
    await resume(f);assert.equal(MultiChatboxPrompt.getPending(f.player)?.options[0],'A glass of your finest ale please.');
    assert.deepEqual(MultiChatboxPrompt.getPending(f.player)?.options,[
      'A glass of your finest ale please.','Can you recommend where an adventurer might make his fortune?',
      'Do you know where I can get some good equipment?',
    ]);
    if(phase==='queue'){
      await resume(f,2);assert.equal(text(f),'Can you recommend where an adventurer might make his fortune?');
      await resume(f);assert.match(text(f),/makes the game too easy/);
      await resume(f);assert.ok(MultiChatboxPrompt.getPending(f.player)?.options.includes('Game? What are you talking about?'));
    }else if(phase==='complete'){
      await resume(f,3);assert.equal(text(f),'Do you know where I can get some good equipment?');
      await resume(f);assert.match(text(f),/sword shop across the road/);
    }
    await close(f);
  }
  await talk(f);PM.emitCustomEvent('events:active',{key:'christmas-2025',active:false});
  assert.equal(f.player.getDialogueManager().getCurrent(),undefined,'closing the annual window cancels its owned greeting');
  await resume(f);assert.equal(MultiChatboxPrompt.getPending(f.player),null);
  await talk(f);assert.equal(text(f),'What can I do yer for?','ordinary talk resumes while the annual window is inactive');
});

test('annual greeting preserves real native beer purchase, exact-price last-slot success and refusal without loss',async t=>{
  for(const [coins,full,beer]of [[2,true,1],[3,true,0],[1,false,0]]){
    const f=fixture(t),inventory=f.player.getInventory();inventory.adds(c.ItemIdentifiers.COINS,coins);
    if(full)for(let n=0;n<27;n++)inventory.addItem(new c.Item(c.ItemIdentifiers.LOGS,1));
    const state=Progress.read(f.player);await talk(f);await resume(f);await resume(f,1);
    for(let n=0;n<20&&f.player.getDialogueManager().getCurrent();n++)await resume(f);
    assert.equal(inventory.getAmount(c.ItemIdentifiers.BEER),beer);
    assert.equal(inventory.getAmount(c.ItemIdentifiers.COINS),coins-(beer?2:0));
    assert.equal(inventory.getAmount(c.ItemIdentifiers.LOGS),full?27:0);
    assert.deepEqual(Progress.read(f.player),state,'ordinary purchase cannot grant Christmas progression');
    await resume(f,1);assert.equal(inventory.getAmount(c.ItemIdentifiers.BEER),beer,'a stale choice cannot repeat the purchase');
    await close(f);
  }
});

test('a retained annual session cannot override a bartender after the real actor becomes privately owned',async t=>{
  const f=fixture(t);await talk(f);assert.match(text(f),/festive rush/);await close(f);
  f.npc.setOwner(f.player);
  await talk(f);assert.equal(text(f),'What can I do yer for?','ordinary owned actors must not inherit an earlier public annual session');
  f.npc.setOwner(null);
});
