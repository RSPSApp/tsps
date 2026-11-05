const assert=require('node:assert/strict'),path=require('node:path');
const {before,test}=require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const Progress=require('../plugins/world/seasonal/Progress.ChristmasDinner');
const Rewards=require('../plugins/world/seasonal/Rewards.ChristmasDinner');
const source=require('../plugins/world/seasonal/data/christmas-2025-archive.json');
let api,platter,index=3100;
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));api=PM.createApi('ChristmasDinnerRewardsTest');
  require('../plugins/world/DefinitionArchives.plugin').register(PM.createApi('DefinitionArchives'));
  const request={bundles:[source.bundle]};PM.emitCustomEvent('definition-archives:install',request);assert.equal(request.handled,true);
  require('../plugins/world/PlayerOnlineTimer.plugin').register(PM.createApi('PlayerOnlineTimer'));
  require('../plugins/world/HolidayRewards.plugin').register(PM.createApi('HolidayRewards'));
  platter=Progress.platterId(api);
});
function fixture(seconds=90000){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setRegistered(true);p.setUsername('christmasrewards');
  p.setAttribute('player-online:lifetime-seconds',seconds);
  const apply=(name,...args)=>assert.equal(Progress[name](api,p,Progress.read(p).revision,...args),true);
  apply('begin');
  for(let guest=0;guest<3;guest++){
    apply('greet',guest);apply('seat',guest);apply('orderDrink','chocolate milk');apply('takeDrink','chocolate milk');apply('serveDrink',guest);
    apply('orderFood','trout',['cabbage','parsnips','stuffing']);
    for(const ingredient of ['trout','cabbage','parsnips','stuffing'])apply('collect',ingredient);
    apply('cook');apply('serveMeal',guest);
  }
  for(let slot=1;slot<16;slot++)p.getInventory().setItem(slot,new api.core.Item(api.core.ItemIdentifiers.LOGS,1));
  return p;
}
function plan(p){return Rewards.plan(api,p,Progress.read(p).revision);}
function amount(items,id){return items.filter(item=>item.getId()===id).reduce((total,item)=>total+item.getAmount(),0);}
function snapshot(p){return p.getInventory().getItems().map(item=>({id:item.getId(),amount:item.getAmount(),meta:item.getMeta()}));}

test('25-hour boundary uses the canonical online-time owner and awards individual noted hats',()=>{
  const young=fixture(89999),old=fixture(90000),before=snapshot(old);
  const basic=plan(young),full=plan(old);assert.equal(basic.rewards.length,4);assert.equal(full.rewards.length,12);
  for(const id of [1039,1041,1043,1045,1047,1049,1051,963])assert.equal(amount(full.items,id),2);
  for(const id of [32928,32934,32930,32932])assert.equal(amount(full.items,id),1);
  assert.equal(amount(full.items,13173),0,'no GE partyhat-set box');assert.equal(amount(full.items,13174),0,'no noted GE box');
  assert.equal(amount(full.items,platter),0);assert.deepEqual(snapshot(old),before,'planning cannot consume the live platter or mutate live items');
  assert.equal(Progress.read(old).phase,'ready');assert.equal(old.getAttribute('holiday-rewards:unlocked'),undefined);
});

test('source 12-slot requirement permits retry after a real inventory removal and rejects stale progression',()=>{
  const p=fixture(),inventory=p.getInventory();inventory.setItem(16,new api.core.Item(api.core.ItemIdentifiers.LOGS,1));
  const before=snapshot(p);assert.equal(inventory.getFreeSlots(),11);assert.equal(plan(p),null);assert.deepEqual(snapshot(p),before);
  inventory.deleteAtSlot(16,1);assert.equal(inventory.getFreeSlots(),12);assert.ok(plan(p));
  assert.equal(Rewards.plan(api,p,Progress.read(p).revision-1),null);
  inventory.deleteAtSlot(inventory.getSlotForItemId(platter),1);assert.equal(plan(p),null,'lost physical platter cannot be silently exchanged');
});

test('real inventory stack cap refuses the whole award until both noted hats fit',()=>{
  const p=fixture(),inventory=p.getInventory();inventory.setItem(1,new api.core.Item(1039,2147483646));
  const before=snapshot(p);assert.equal(plan(p),null);assert.deepEqual(snapshot(p),before);
  inventory.deleteAtSlot(1,1);const next=plan(p);assert.ok(next);assert.equal(amount(next.items,1039),2147483647);
  assert.equal(inventory.getAmount(1039),2147483645,'successful planning also leaves live stack untouched');
});

test('Christmas unlock names are accepted by the real Diango service and exclude rare-award enum entries',()=>{
  const p=fixture(),before=snapshot(p),request={player:p,items:[...Rewards.UNLOCKS]};
  api.emitCustomEvent('holiday-rewards:unlock',request);assert.equal(request.accepted,true);
  const unlocked=p.getAttribute('holiday-rewards:unlocked');
  assert.equal(unlocked.length,69);assert.ok(unlocked.includes('xm21_present_1'),'the source generic Secret santa present includes its red reclaim base');
  assert.ok(!unlocked.includes('osb10_jumper_red'),'birthday jumper is not a Christmas reward');
  for(const symbol of Rewards.RARES)assert.ok(!unlocked.includes(symbol),'tradeable rare awards are not reclaim unlocks');
  assert.deepEqual(snapshot(p),before,'entitlement owner grants no physical items');
});

test('reward commit exchanges the platter once and preserves unrelated inventory and entitlements',()=>{
  const p=fixture(),revision=Progress.read(p).revision;
  p.setAttribute('holiday-rewards:unlocked',['rubber_chicken']);
  assert.equal(Rewards.claim(api,p,revision),true);
  assert.equal(Progress.read(p).phase,'complete');
  assert.equal(p.getInventory().getAmount(platter),0);
  assert.equal(p.getInventory().getAmount(api.core.ItemIdentifiers.LOGS),15);
  assert.equal(p.getInventory().getAmount(1039),2);
  assert.ok(p.getAttribute('holiday-rewards:unlocked').includes('rubber_chicken'));
  assert.ok(p.getAttribute('holiday-rewards:unlocked').includes('xm21_present_1'));
  const before=snapshot(p);assert.equal(Rewards.claim(api,p,revision),false);
  assert.deepEqual(snapshot(p),before,'repeated completion cannot mint more rares');
});
