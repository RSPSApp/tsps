const assert=require('node:assert/strict'),path=require('node:path');
const {before,test}=require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const Progress=require('../plugins/world/seasonal/Progress.ChristmasDinner');
const source=require('../plugins/world/seasonal/data/christmas-2025-archive.json');
let api,platter;
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));api=PM.createApi('ChristmasDinnerTest');
  require('../plugins/world/DefinitionArchives.plugin').register(PM.createApi('DefinitionArchives'));
  const request={bundles:[source.bundle]};PM.emitCustomEvent('definition-archives:install',request);assert.equal(request.handled,true);
  platter=api.core.CacheDefinitions.getArchivedId('christmas-2025','obj','xmas25_serving_platter');
});
function player(){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel));p.setUsername('christmasprogress');return p;
}
function apply(p,name,...args){return Progress[name](api,p,Progress.read(p).revision,...args);}
function readyForFood(p,seat=0){
  assert.equal(apply(p,'begin'),true);
  assert.equal(apply(p,'greet',0),true);
  assert.equal(apply(p,'seat',seat),true);
  assert.equal(apply(p,'orderDrink','chocolate milk'),true);
  assert.equal(apply(p,'takeDrink','chocolate milk'),true);
  assert.equal(apply(p,'serveDrink',seat),true);
  assert.equal(apply(p,'orderFood','trout',['cabbage','parsnips','stuffing']),true);
}
function prepareMeal(p){for(const name of ['trout','cabbage','parsnips','stuffing'])assert.equal(apply(p,'collect',name),true);assert.equal(apply(p,'cook'),true);}
test('real inventory handout refuses full capacity, permits a retry and never duplicates the platter',()=>{
  const p=player(),inv=p.getInventory();for(let i=0;i<28;i++)inv.setItem(i,new api.core.Item(api.core.ItemIdentifiers.LOGS,1));
  assert.equal(apply(p,'begin'),false);assert.equal(Progress.read(p).phase,'new');
  inv.deleteAtSlot(0,1);assert.equal(apply(p,'begin'),true);assert.equal(inv.getAmount(platter),1);
  assert.equal(apply(p,'begin'),false);assert.equal(inv.getAmount(platter),1);
});
test('three real serving cycles require matching drink, four ingredients and cooking before the next customer',()=>{
  const p=player();readyForFood(p,2);
  assert.equal(apply(p,'greet',1),false);assert.equal(apply(p,'serveMeal',2),false);
  assert.equal(apply(p,'collect','beef'),false);assert.equal(apply(p,'cook'),false);
  prepareMeal(p);assert.equal(apply(p,'serveMeal',0),false);assert.equal(apply(p,'serveMeal',2),true);
  for(let customer=1;customer<3;customer++){
    assert.equal(apply(p,'greet',customer),true);assert.equal(apply(p,'seat',2),false);assert.equal(apply(p,'seat',customer-1),true);
    assert.equal(apply(p,'orderDrink','cider'),true);assert.equal(apply(p,'takeDrink','beer'),false);
    assert.equal(apply(p,'serveDrink',customer-1),false);assert.equal(apply(p,'takeDrink','cider'),true);assert.equal(apply(p,'serveDrink',customer-1),true);
    assert.equal(apply(p,'orderFood','trout',['cabbage','parsnips','stuffing']),true);prepareMeal(p);assert.equal(apply(p,'serveMeal',customer-1),true);
  }
  assert.equal(Progress.read(p).phase,'ready');assert.equal(Progress.read(p).customer,3);assert.equal(apply(p,'greet',3),false);
  assert.deepEqual(Progress.read(p).seats,[2,0,1]);assert.equal(p.getInventory().getAmount(platter),1);
});
test('stale dialogue continuations and duplicate ingredients cannot replay progression',()=>{
  const p=player();readyForFood(p);
  const revision=Progress.read(p).revision;assert.equal(Progress.collect(api,p,revision,'trout'),true);
  assert.equal(Progress.collect(api,p,revision,'cabbage'),false);assert.equal(apply(p,'collect','trout'),false);
  assert.equal(Progress.read(p).gathered.length,1);
  const leaked=Progress.read(p);leaked.gathered.push('cabbage');assert.deepEqual(Progress.read(p).gathered,['trout']);
});
test('destroyed platter invalidates carried food; a replacement cannot recover a cooked meal for free',()=>{
  const p=player();readyForFood(p);prepareMeal(p);
  p.getInventory().deleteAtSlot(p.getInventory().getSlotForItemId(platter),1);
  assert.equal(apply(p,'serveMeal',0),false);assert.equal(apply(p,'reclaim'),true);
  assert.equal(Progress.read(p).phase,'ingredients');assert.deepEqual(Progress.read(p).gathered,[]);
  assert.equal(apply(p,'serveMeal',0),false);prepareMeal(p);assert.equal(apply(p,'serveMeal',0),true);
});
test('saved JSON progress resumes the same customer, order and gathered items in a new player',()=>{
  const p=player();readyForFood(p,1);apply(p,'collect','cabbage');
  const saved=JSON.parse(JSON.stringify(p.getAttribute(Progress.PROGRESS_ATTRIBUTE)));
  const loaded=player();loaded.setAttribute(Progress.PROGRESS_ATTRIBUTE,saved);loaded.getInventory().addItem(new api.core.Item(platter,1));
  assert.deepEqual(Progress.read(loaded),Progress.read(p));
  for(const name of ['trout','parsnips','stuffing'])assert.equal(apply(loaded,'collect',name),true);
  assert.equal(apply(loaded,'cook'),true);assert.equal(apply(loaded,'serveMeal',1),true);
  assert.equal(Progress.read(p).customer,0,'resumed character owns its own state');
});
test('invalid meal/order choices do not poison saved progression',()=>{
  const p=player();apply(p,'begin');apply(p,'greet',0);apply(p,'seat',0);
  assert.equal(apply(p,'orderDrink','tea'),false);apply(p,'orderDrink','beer');apply(p,'takeDrink','beer');apply(p,'serveDrink',0);
  assert.equal(apply(p,'orderFood','beef',['peas','peas','stuffing']),false);
  assert.equal(apply(p,'orderFood','beef',['peas','stuffing','sand']),false);
  assert.equal(Progress.read(p).phase,'food-order');assert.equal(apply(p,'orderFood','beef',['peas','carrots','stuffing']),true);
});
test('registered progression and the physical platter survive a committed real JSON save/load',async()=>{
  const fs=require('node:fs'),runtime=path.resolve(__dirname,'../.runtime');fs.mkdirSync(runtime,{recursive:true});
  const directory=fs.mkdtempSync(path.join(runtime,'christmas-progress-save-'));
  const plugin=require('../plugins/persistence/JsonPlayerPersistence.plugin'),previous=plugin.JsonPlayerPersistence.SAVE_DIRECTORY;
  let persistence;
  try{
    require('../plugins/world/ChristmasDinner.plugin').register(api);
    plugin.JsonPlayerPersistence.SAVE_DIRECTORY=directory;
    plugin.register({getSkillManager:()=>api.getSkillManager(),setPlayerPersistence:backend=>{persistence=backend;},log(){}});
    const p=player();readyForFood(p,1);apply(p,'collect','cabbage');
    persistence.save(p);await persistence.flush();
    const freshBackend=new plugin.JsonPlayerPersistence(),saved=freshBackend.load(p.getUsername());assert.ok(saved);
    const loaded=player();saved.applyToPlayer(loaded);
    assert.deepEqual(Progress.read(loaded),Progress.read(p));assert.equal(loaded.getInventory().getAmount(platter),1);
    for(const name of ['trout','parsnips','stuffing'])assert.equal(apply(loaded,'collect',name),true);
    assert.equal(apply(loaded,'cook'),true);assert.equal(apply(loaded,'serveMeal',1),true);
  }finally{
    plugin.JsonPlayerPersistence.SAVE_DIRECTORY=previous;
    assert.ok(path.resolve(directory).startsWith(runtime+path.sep));fs.rmSync(directory,{recursive:true,force:true});
  }
});
test('real Bank deposit cannot move an active serving platter or its recorded contents',()=>{
  const p=player();readyForFood(p);apply(p,'collect','trout');
  p.getBank(0).open();
  api.core.Bank.deposit(p,platter,p.getInventory().getSlotForItemId(platter),1,false);
  assert.equal(p.getInventory().getAmount(platter),1);assert.equal(p.getBank(0).getAmount(platter),0);
  assert.deepEqual(Progress.read(p).gathered,['trout']);
  p.getPacketSender().sendInterfaceRemoval();
});
