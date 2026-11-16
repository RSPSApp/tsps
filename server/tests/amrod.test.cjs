const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const path = require('node:path');
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, index = 6200;
before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3235, 6125);
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));
function setup(t) {
  const channel = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('amrod'+player.getIndex()); player.setRegistered(true);
  player.setLocation(new core.Location(3235,6125,0)); player.needsPlacement = false;
  const connection = new ClientConnection(channel); connection.player = player;
  const npc = core.NPC.create(9053,new core.Location(3236,6125,0));
  assert.equal(core.World.getNpcs().add(npc),true);
  t.after(() => { player.closeInterruptibleInterfaces(); PluginManager.emitPlayerLogout({player,username:player.getUsername()}); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); core.TaskManager.cancelTasks(player); core.World.getNpcs().remove(npc); });
  const scripts=[]; const sender=player.getPacketSender(); const original=sender.sendInterfaceScript.bind(sender);
  t.mock.method(sender,'sendInterfaceScript',(id,args)=>{scripts.push({id,args}); return original(id,args);});
  const turn=()=>{player.resetUpdating(); core.World.processCycle=(core.World.processCycle+1)&0x7fffffff; core.TaskManager.process(); connection.processTurnPackets(); const q=player.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(player.getIndex());};
  const send=async packet=>{await connection.dispatch([packet]);turn();};
  const trade=async()=>{await send({type:'npc_option',index:npc.getIndex(),clickType:3});for(let i=0;i<8&&!player.getCreationMenu();i++)turn();};
  const pick=async(slot,amount)=>send({type:'dialogue_continue',widgetId:(270<<16)| (15+slot),childIndex:amount});
  const answer=async n=>send({type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:n});
  return {player,npc,inv:player.getInventory(),scripts,turn,trade,pick,answer};
}
const rows=[['CRYSTAL_TOOL_SEED',100],['CRYSTAL_WEAPON_SEED',10],['CRYSTAL_ARMOUR_SEED',250],['ENHANCED_CRYSTAL_TELEPORT_SEED',150],['ENHANCED_CRYSTAL_WEAPON_SEED',1500]];
test('Trade opens captured five-seed menu and exchanges each seed at Wiki rates',async t=>{
  for(const [slot,[name,rate]] of rows.entries()) await t.test(name,async st=>{
    const f=setup(st), id=core.ItemIdentifiers[name], shard=core.ItemIdentifiers.CRYSTAL_SHARD;
    f.inv.add(new core.Item(id,2),false); await f.trade();
    const script=f.scripts.filter(s=>s.id===2046).at(-1);
    assert.equal(script.args[0],4); assert.match(script.args[1],/^How many do you wish to trade\?\|Crystal tool seed\|Crystal weapon seed\|Crystal armour seed\|Enhanced crystal teleport seed\|Enhanced crystal weapon seed$/);
    await f.pick(slot,2);
    assert.equal(f.inv.getAmount(id),2, 'confirmation does not consume');
    assert.equal(MultiChatboxPrompt.getPending(f.player)?.title,`Trade 2 x ${['Crystal tool seed','Crystal weapon seed','Crystal armour seed','Enhanced crystal teleport seed','Enhanced crystal weapon seed'][slot]} for ${rate*2} crystal shards?`);
    await f.answer(1); assert.equal(f.inv.getAmount(id),0); assert.equal(f.inv.getAmount(shard),rate*2);
    assert.equal(f.player.getDialogueManager().getCurrent().getText(),`You trade in your ${['Crystal tool seeds','Crystal weapon seeds','Crystal armour seeds','Enhanced crystal teleport seeds','Enhanced crystal weapon seeds'][slot]} for<br>${rate*2} crystal shards.`);
  });
});
test('cancel and inventory change cannot consume seeds or create shards',async t=>{
  const f=setup(t), id=core.ItemIdentifiers.ENHANCED_CRYSTAL_TELEPORT_SEED, shard=core.ItemIdentifiers.CRYSTAL_SHARD;
  f.inv.add(new core.Item(id,2),false); await f.trade(); await f.pick(3,2); assert.ok(MultiChatboxPrompt.getPending(f.player)); await f.answer(2);
  assert.equal(f.inv.getAmount(id),2); assert.equal(f.inv.getAmount(shard),0);
  await f.trade(); await f.pick(3,2); f.inv.deleteNumber(id,1); await f.answer(1);
  assert.equal(f.inv.getAmount(id),1); assert.equal(f.inv.getAmount(shard),0);
});
test('noted seeds and an overflowing shard stack are never exchanged',async t=>{
  const f=setup(t), id=core.ItemIdentifiers.ENHANCED_CRYSTAL_TELEPORT_SEED, shard=core.ItemIdentifiers.CRYSTAL_SHARD;
  f.inv.add(new core.Item(id+1,1),false); await f.trade(); await f.pick(3,1);
  assert.equal(MultiChatboxPrompt.getPending(f.player),null);
  assert.equal(f.inv.getAmount(shard),0); assert.equal(f.inv.getAmount(id+1),1);
  f.inv.add(new core.Item(id,1),false); f.inv.add(new core.Item(shard,2147483647),false);
  await f.trade(); await f.pick(3,1); assert.ok(MultiChatboxPrompt.getPending(f.player)); await f.answer(1);
  assert.equal(f.inv.getAmount(id),1); assert.equal(f.inv.getAmount(shard),2147483647);
});
test('Amrod dialogue action opens the same exchange after the conversation',t=>{
  const f=setup(t); const e={player:f.player,npc:f.npc,npcId:9053,text:'Chatbox trade interface opens for crystal seed exchanging.',handled:false};
  PluginManager.emitCustomEvent('npc-dialogue:action',e); assert.equal(e.handled,true); assert.equal(e.end,true); f.turn(); f.turn(); assert.ok(f.player.getCreationMenu());
});
