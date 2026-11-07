// Real production plugins/cache, Player/Inventory/PlayerSave and native packets; only the wire is stubbed.
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
const {PlayerSave} = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const Common = require('../plugins/minigames/troublebrewing/Common.TroubleBrewing');
const {Game} = require('../plugins/minigames/troublebrewing/Game.TroubleBrewing');
let core, jimmy, next = 5800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3812, 3027);
  PM.emitServerStartup({});
  const {ShopDefinitionLoader}=require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
  assert.equal(new ShopDefinitionLoader().load(),true); core.ShopManager.initialize();
  jimmy = core.NPC.create(core.NpcIdentifiers.HONEST_JIMMY, new core.Location(3812,3028,0));
  core.World.getNpcs().add(jimmy);
});
after(() => { core.World.getNpcs().remove(jimmy); PM.emitServerShutdown({}); });
function actor(t) {
  const wire = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p = new Player(new PlayerSession(wire));
  p.setUsername('brewtest'+next); p.setIndex(next++); p.setRegistered(true);
  p.setLocation(new core.Location(3812,3027,0)); p.needsPlacement=false;
  const c = new ClientConnection(wire); c.player=p;
  const messages=[];
  t.mock.method(p.getPacketSender(),'sendMessage',m=>{messages.push(m);return p.getPacketSender();});
  t.after(()=>{ PM.emitPlayerLogout({player:p,username:p.getUsername()}); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return {p,c,messages,inv:p.getInventory()};
}
async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); }
async function trade(f) {
  await send(f,{type:'npc_option',index:jimmy.getIndex(),clickType:3});
  for(let i=0;i<3;i++){core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process();}
  assert.equal(f.p.getInterfaceId(),819,'Trade opens the sourced native omnishop');
  assert.equal(f.p.getAttribute('omnishop:shop'),core.CacheDefinitions.getDbRowId('brew_shop_data'));
}
async function buy(f, entry, op=2) {
  const uid=core.CacheDefinitions.getComponentId('omnishop_main:list');
  await send(f,{type:'widget_action',widgetId:uid,groupId:uid>>>16,childId:uid&65535,slot:entry*12,buttonNum:op});
}
function balance(f) { return f.p.getAttribute(Common.PIECES_ATTRIBUTE) ?? 0; }
test('round award and old saved balance buy a cache-priced reward through native Trade', async t => {
  const f=actor(t); f.p.setAttribute(Common.PIECES_ATTRIBUTE,455);
  const game=new Game({red:[f.p],blue:[]}); game.stateOf('red').score=1; game.addContribution(f.p,55);
  // Controlled checkpoint: run the real final round tick, not a second reward implementation.
  game.elapsed=Common.GAME_TICKS-1; game.tick(); game.finish();
  assert.equal(balance(f),520,'10 per bottle +55 contribution, awarded only once');
  assert.equal(f.inv.getAmount(core.ItemIdentifiers.PIECES_OF_EIGHT),0,'currency remains account based');
  f.p.needsPlacement=false;
  await trade(f); await buy(f,1);
  assert.equal(f.inv.getAmount(core.ItemIdentifiers.BLUE_TRICORN_HAT),1);
  assert.equal(balance(f),20,'exact cache price500');
  assert.equal(f.p.getPacketSender().getVarp(core.CacheDefinitions.getVarpId('brew_pieces')),20);
  await buy(f,1); assert.equal(balance(f),20); assert.equal(f.inv.getAmount(core.ItemIdentifiers.BLUE_TRICORN_HAT),1);
});

async function count(f, slot=f.inv.getSlotForItemId(core.ItemIdentifiers.PIECES_OF_EIGHT)) {
  await send(f,{type:'inventory_action',widgetId:149<<16,slot,itemId:core.ItemIdentifiers.PIECES_OF_EIGHT,option:'Count',optionIndex:1});
}
function close(f) { f.p.getPacketSender().sendInterfaceRemoval(); }
function reload(t,f) {
  let codec;
  require('../plugins/persistence/JsonPlayerPersistence.plugin').register({
    getSkillManager:()=>require('../dist/game/content/skill/SkillManager').SkillManager,
    setPlayerPersistence:p=>{codec=p;},log() {},
  });
  const data=JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.p),codec.replacer.bind(codec)),codec.reviver.bind(codec));
  const g=actor(t); codec.hydratePlayerSave(data).applyToPlayer(g.p);
  g.p.setRegistered(true); g.p.needsPlacement=false;
  PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});
  return g;
}
test('earned balance and reward survive JSON save/relogin without another award or item credit', async t => {
  const f=actor(t); f.p.setAttribute(Common.PIECES_ATTRIBUTE,65);
  await trade(f); await buy(f,27); assert.equal(balance(f),15); assert.equal(f.inv.getAmount(core.ItemIdentifiers.THE_STUFF),1);
  close(f); const g=reload(t,f); await trade(g); await buy(g,27);
  assert.equal(balance(g),15); assert.equal(g.inv.getAmount(core.ItemIdentifiers.THE_STUFF),1);
  assert.equal(g.inv.getAmount(core.ItemIdentifiers.PIECES_OF_EIGHT),0);
  assert.equal(g.p.getPacketSender().getVarp(core.CacheDefinitions.getVarpId('brew_pieces')),15);
  const h=reload(t,g); assert.equal(balance(h),15); assert.equal(h.inv.getAmount(core.ItemIdentifiers.THE_STUFF),1);
});
test('full inventory refuses reward delivery without spending; freeing one slot permits one bulk unit', async t => {
  const f=actor(t); f.p.setAttribute(Common.PIECES_ATTRIBUTE,1000);
  for(let i=0;i<28;i++)f.inv.add(new core.Item(core.ItemIdentifiers.RAKE),false);
  await trade(f); await buy(f,1); await buy(f,1);
  assert.equal(balance(f),1000); assert.equal(f.inv.getAmount(core.ItemIdentifiers.BLUE_TRICORN_HAT),0);
  assert.ok(f.messages.includes("You don't have enough inventory space."));
  f.inv.deleteAtSlot(0,1); await buy(f,1,3);
  assert.equal(balance(f),500); assert.equal(f.inv.getAmount(core.ItemIdentifiers.BLUE_TRICORN_HAT),1);
});
test('round reward and Count cannot lose currency to a full inventory or an existing capped coin stack', async t => {
  const f=actor(t),id=core.ItemIdentifiers.PIECES_OF_EIGHT,CAP=0x7fffffff;
  f.p.setAttribute(Common.PIECES_ATTRIBUTE,CAP-1); f.inv.add(new core.Item(id,CAP),false);
  for(let i=0;i<27;i++)f.inv.add(new core.Item(core.ItemIdentifiers.RAKE),false);
  assert.equal(f.inv.getAddableAmount(new core.Item(id,1)),0);
  const game=new Game({red:[f.p],blue:[]}); game.stateOf('red').score=1; game.addContribution(f.p,55); game.finish();
  assert.equal(balance(f),CAP+64); assert.equal(f.inv.getAmount(id),CAP);
  f.p.needsPlacement=false; await count(f); assert.equal(balance(f),2*CAP+64); assert.equal(f.inv.getAmount(id),0);
  const g=reload(t,f); assert.equal(balance(g),2*CAP+64); assert.equal(g.inv.getAmount(id),0);
});
test('Count converts a bank-returned genuine stack once, adds to legacy balance, and survives two relogs', async t => {
  const f=actor(t),id=core.ItemIdentifiers.PIECES_OF_EIGHT;
  f.p.setAttribute(Common.PIECES_ATTRIBUTE,40); f.inv.add(new core.Item(id,35),false);
  f.p.getBank(0).open(); core.Bank.deposit(f.p,id,f.inv.getSlotForItemId(id),35,false);
  assert.equal(f.inv.getAmount(id),0);
  core.Bank.withdraw(f.p,id,f.p.getBank(0).getSlotForItemId(id),35,0); close(f);
  await count(f); await count(f,0);
  assert.equal(balance(f),75); assert.equal(f.inv.getAmount(id),0);
  const g=reload(t,f); assert.equal(balance(g),75); assert.equal(g.inv.getAmount(id),0);
  await trade(g); await buy(g,27); assert.equal(balance(g),25);
  const h=reload(t,g); assert.equal(balance(h),25); assert.equal(h.inv.getAmount(id),0);
});
test('Count refuses preset and restricted stacks while a genuine stack of the same id still converts', async t => {
  for(const meta of [{preset:true},{untradeable:true},{unbankable:true}]) {
    const f=actor(t),id=core.ItemIdentifiers.PIECES_OF_EIGHT;
    f.inv.add(new core.Item(id,200,meta),false); f.inv.add(new core.Item(id,30),false);
    await count(f,0); assert.equal(balance(f),0); assert.equal(f.inv.getItems()[0].getAmount(),200);
    await count(f,1); assert.equal(balance(f),30); assert.equal(f.inv.getAmount(id),200);
    const g=reload(t,f); await count(g,0); assert.equal(balance(g),30); assert.deepEqual(g.inv.getItems()[0].getMeta(),meta);
  }
});
test('legacy balances above the wire limit stay spendable and physical currency cannot also pay', async t => {
  const f=actor(t),CAP=0x7fffffff,id=core.ItemIdentifiers.PIECES_OF_EIGHT;
  f.p.setAttribute(Common.PIECES_ATTRIBUTE,CAP+100); f.inv.add(new core.Item(id,500),false);
  await trade(f); await buy(f,1); assert.equal(balance(f),CAP-400); assert.equal(f.inv.getAmount(id),500);
  close(f); await count(f); assert.equal(balance(f),CAP+100); assert.equal(f.inv.getAmount(id),0);
  const g=reload(t,f); assert.equal(balance(g),CAP+100);
  assert.equal(g.p.getPacketSender().getVarp(core.CacheDefinitions.getVarpId('brew_pieces')),CAP);
});
test('cache stock prices cover all rewards; legacy shop callers redirect and closing invalidates native buys', async t => {
  const f=actor(t); f.p.setAttribute(Common.PIECES_ATTRIBUTE,1000);
  core.ShopManager.open(f.p,1448); assert.equal(f.p.getInterfaceId(),819);
  await buy(f,1); assert.equal(balance(f),500); close(f); await buy(f,1); assert.equal(balance(f),500);
  const shop=core.CacheDefinitions.getDbRow(core.CacheDefinitions.getDbRowId('brew_shop_data'));
  const column=(table,name)=>core.CacheDefinitions.getDbColumn(core.CacheDefinitions.getDbTableId(table),name);
  const rows=shop.column(column('omnishop_shop_data','omnishop_shop_stock'));
  assert.equal(rows.length,30);
  const prices=rows.map(id=>core.CacheDefinitions.getDbRow(Number(id)).column(column('omnishop_stock_data','omnishop_stock_cost'))[1]);
  assert.deepEqual(prices,[...Array(7).fill([1000,500,1000]).flat(),2000,2000,3000,4000,5000,6000,50,20,20]);
});
