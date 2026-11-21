// Real production plugins/cache, Player/Inventory and native packets; only the wire is stubbed.
// Trouble Brewing's water pump against rsprox recording 1849 (Leagues V), ticks 730-1362.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const {before, after, test} = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
const {Game} = require('../plugins/minigames/troublebrewing/Game.TroubleBrewing');
const PUMP_LOC = 15936; // brew_water_pump
const BLUE_PUMP = [3807, 2954]; // Common.BASE.blue.pump; the recording's player was on blue
const STAND = [3808, 2954];
let core, I, next = 5900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi(); I = core.ItemIdentifiers;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(BLUE_PUMP[0], BLUE_PUMP[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function actor(t, team = 'blue') {
  const wire = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p = new Player(new PlayerSession(wire));
  p.setUsername('brewpump'+next); p.setIndex(next++); p.setRegistered(true);
  p.needsPlacement=false;
  const c = new ClientConnection(wire); c.player=p;
  const game = new Game(team === 'red' ? {red:[p],blue:[]} : {red:[],blue:[p]});
  game.start(); p.setLocation(new core.Location(STAND[0], STAND[1], 0));
  p.setNeedsPlacement(false); p.setResetMovementQueue(false);
  const messages=[], anims=[], sounds=[];
  t.mock.method(p.getPacketSender(),'sendMessage',m=>{if(!String(m).startsWith('<col='))messages.push({type:'game',text:m});return p.getPacketSender();});
  const typed = p.getPacketSender().sendTypedMessage.bind(p.getPacketSender());
  t.mock.method(p.getPacketSender(),'sendTypedMessage',(type,m)=>{if(!String(m).startsWith('<col='))messages.push({type,text:m});return typed(type,m);});
  const effect = p.getPacketSender().sendSoundEffect.bind(p.getPacketSender());
  t.mock.method(p.getPacketSender(),'sendSoundEffect',(id,...rest)=>{sounds.push(id);return effect(id,...rest);});
  const perform = p.performAnimation.bind(p);
  t.mock.method(p,'performAnimation',a=>{anims.push(a.getId());return perform(a);});
  t.after(()=>{ game.finish?.(); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return {p,c,messages,anims,sounds,inv:p.getInventory()};
}
async function useOnPump(f, itemId) {
  await f.c.dispatch([{type:'item_on_object',widgetId:149<<16,objectId:PUMP_LOC,x:BLUE_PUMP[0],y:BLUE_PUMP[1],
    itemId,slot:f.inv.getSlotForItemId(itemId)}]);
  f.c.processTurnPackets();
  core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process();
}
function tick(f) { core.TaskManager.process(); f.p.getMovementQueue().process(); }
function water(f) { return f.inv.getAmount(I.BUCKET_OF_WATER); }

test('one bucket on the click, then one a tick, each with 832 and synth 2609; the message once', async t => {
  const f=actor(t);
  f.inv.setItem(0,new core.Item(I.LOGS,1)); f.inv.setItem(1,new core.Item(I.BUCKET,1));
  f.inv.setItem(2,new core.Item(I.KNIFE,1)); f.inv.setItem(3,new core.Item(I.BUCKET,1)); f.inv.setItem(4,new core.Item(I.BUCKET,1));
  await useOnPump(f, I.BUCKET);
  assert.equal(water(f),1,'the first bucket fills on the click tick (1849 tick 1050 +0)');
  assert.equal(f.inv.get(1).getId(),I.BUCKET_OF_WATER,'the filled bucket keeps the empty one\'s slot');
  assert.deepEqual(f.messages,[{type:core.ChatType.SPAM,text:'You fill the bucket.'}],'spam, as recorded');
  for (let i=0;i<4;i++) tick(f);
  assert.equal(water(f),3); assert.equal(f.inv.getAmount(I.BUCKET),0);
  assert.equal(f.inv.get(3).getId(),I.BUCKET_OF_WATER); assert.equal(f.inv.get(4).getId(),I.BUCKET_OF_WATER);
  assert.deepEqual(f.anims,[832,832,832]); assert.deepEqual(f.sounds,[2609,2609,2609]);
  assert.deepEqual(f.messages,[{type:core.ChatType.SPAM,text:'You fill the bucket.'}],'later buckets have no message (+1, +2)');
});

test('walking away stops the pumping', async t => {
  const f=actor(t);
  for (let s=0;s<4;s++) f.inv.setItem(s,new core.Item(I.BUCKET,1));
  await useOnPump(f, I.BUCKET);
  tick(f);
  assert.equal(water(f),2);
  f.p.setLocation(new core.Location(STAND[0]+1, STAND[1], 0));
  for (let i=0;i<3;i++) tick(f);
  assert.equal(water(f),2,'no bucket fills once the player has moved');
});

test('a bowl is too small: refused, no bowl of water (1849 tick 1041)', async t => {
  const f=actor(t);
  f.inv.setItem(0,new core.Item(I.BOWL,1));
  await useOnPump(f, I.BOWL);
  assert.deepEqual(f.messages,[{type:'game',text:'That bowl is too small to hold a useful amount of water, try a bucket instead.'}],'a game message');
  assert.equal(f.inv.getAmount(I.BOWL),1); assert.equal(f.inv.getAmount(I.BOWL_OF_WATER),0);
});

test('the other team\'s pump does nothing', async t => {
  const f=actor(t,'red');
  f.inv.setItem(0,new core.Item(I.BUCKET,1));
  await useOnPump(f, I.BUCKET);
  tick(f);
  assert.equal(water(f),0); assert.deepEqual(f.messages,[]);
});
