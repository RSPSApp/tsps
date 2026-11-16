// Native decoded packets, real Player/Inventory/Equipment/Bank and persistence; network captured only.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');
const { Bank } = require('../dist/game/model/container/impl/Bank');
const KEY = 'alchemists-amulet:charges';
let core, next = 9040;
const savedEnvironment = { DISABLE_PLAYER_BOTS: process.env.DISABLE_PLAYER_BOTS, BROWSER_HOST: process.env.BROWSER_HOST };
const saveDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'alchemists-amulet-'));
const obj = n => core.CacheDefinitions.getObjId(n);
const charged = () => obj('amulet_of_chemistry_imbued_charged');
const empty = () => obj('amulet_of_chemistry_imbued_uncharged');
const chemistry = () => obj('amulet_of_chemistry');
const noted = () => obj('cert_amulet_of_chemistry');
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  process.env.BROWSER_HOST = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/persistence/IndexedDbPlayerPersistence.plugin').IndexedDbPlayerPersistence.SAVE_DIRECTORY = saveDirectory;
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(async () => {
  PM.emitServerShutdown({});
  const persistence=require('../dist/game/GameConstants').GameConstants.PLAYER_PERSISTENCE;
  await persistence.pendingWriteChain;
  fs.rmSync(saveDirectory,{recursive:true,force:true});
  for(const [key,value] of Object.entries(savedEnvironment)){
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
function actor(t) {
  const ch = { kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true, send:()=>true, close(){}, onData(){}, onError(){}, onClose(){} };
  const p = new Player(new PlayerSession(ch));
  p.setIndex(next++); p.setUsername('amuletqa'+next); p.setRegistered(true);
  p.setLocation(new core.Location(3222,3218,0)); p.needsPlacement=false;
  p.getSkillManager().setMaxLevel(core.Skill.HERBLORE,99,true).setCurrentLevel(core.Skill.HERBLORE,99,true);
  require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q=>q.key==='druidic_ritual').complete(p,{experience:false});
  const c = new ClientConnection(ch); c.player=p;
  const messages=[];
  t.mock.method(p.getPacketSender(),'sendMessage',m=>{messages.push(m);return p.getPacketSender();});
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());});
  return {p,c,inv:p.getInventory(),eq:p.getEquipment(),messages};
}
async function send(f,packet){await f.c.dispatch([packet]);f.c.processTurnPackets();}
async function use(f,a,b){await send(f,{type:'inventory_use_on',slot:a,itemId:f.inv.getItems()[a].getId(),target:{kind:'inventory',slot:b,itemId:f.inv.getItems()[b].getId()}});}
async function action(f,slot,option){
  const itemId=f.inv.getItems()[slot].getId();
  const op=[2,3,4,6,7].find(n=>ItemActionPacketListener.resolveInventoryWidgetAction(itemId,n)?.option===option);
  assert.ok(op,option);
  await send(f,{type:'widget_action',widgetId:149<<16,groupId:149,childId:0,buttonNum:op,slot,itemId});
}
const put=(f,slot,id,count=1,meta)=>{f.inv.setItem(slot,new core.Item(id,count,meta));return f.inv.getItems()[slot];};
const wear=(f,charges,id=charged())=>{f.eq.set(core.Equipment.AMULET_SLOT,new core.Item(id,1,{[KEY]:charges}));return f.eq.get(core.Equipment.AMULET_SLOT);};
const ticks=n=>{for(let i=0;i<n;i++)core.TaskManager.process();};
const amount=(f,n)=>send(f,{type:'dialogue_amount',amount:n});
const choice=(f,n)=>send(f,{type:'dialogue_continue',widgetId:(219<<16)|1,childIndex:n});

test('native brewing: 15% extra dose spends only successful charges and grants ordinary XP',async t=>{
  const f=actor(t),amulet=wear(f,2);
  put(f,0,obj('ranarrvial'));put(f,1,obj('snape_grass'));
  const before=f.p.getSkillManager().skills.experience[core.Skill.HERBLORE.getIndex()];
  t.mock.method(Math,'random',()=>.10);
  await use(f,0,1);
  assert.equal(f.inv.getAmount(obj('4doseprayerrestore')),1);
  assert.equal(amulet.getMetaValue(KEY),1);
  assert.equal(f.p.getSkillManager().skills.experience[core.Skill.HERBLORE.getIndex()]-before,87.5);
});
test('native charging and uncharging conserve whole chemistry amulets and remainder',async t=>{
  const f=actor(t);put(f,0,empty());put(f,1,chemistry());put(f,2,chemistry());
  await use(f,1,0);await amount(f,2);
  assert.equal(f.inv.getItems()[0].getId(),charged());assert.equal(f.inv.getItems()[0].getMetaValue(KEY),20);
  assert.equal(f.inv.getAmount(chemistry()),0);
  f.inv.getItems()[0].setMetaValue(KEY,19);
  await action(f,0,'Uncharge');await choice(f,1);
  assert.equal(f.inv.getItems()[0].getId(),empty());assert.equal(f.inv.getAmount(noted()),1);
});
test('native Charge amount zero and 4991 cap preserve supplies; charge count is per item',async t=>{
  const f=actor(t);put(f,0,charged(),1,{[KEY]:4991});put(f,1,chemistry());put(f,2,charged(),1,{[KEY]:30});
  await action(f,0,'Charge');await amount(f,1);
  assert.equal(f.inv.getAmount(chemistry()),1);assert.equal(f.inv.getItems()[0].getMetaValue(KEY),4991);
  f.inv.getItems()[0].setMetaValue(KEY,4990);
  await action(f,0,'Charge');await amount(f,0);
  assert.equal(f.inv.getAmount(chemistry()),1);
  await action(f,0,'Charge');await amount(f,1);
  assert.equal(f.inv.getItems()[0].getMetaValue(KEY),5000);assert.equal(f.inv.getItems()[2].getMetaValue(KEY),30);
});
test('pending charge cannot affect an amulet after real Bank deposit and withdrawal',async t=>{
  const f=actor(t);put(f,0,empty());put(f,1,chemistry());put(f,2,chemistry());
  await action(f,0,'Charge');
  const callback=f.p.getEnteredAmountAction();assert.ok(callback);
  f.p.setInterfaceId(Bank.MAIN_INTERFACE_ID); f.p.setStatus(core.PlayerStatus.BANKING);
  Bank.deposit(f.p,empty(),0,1,false);
  const bank=f.p.getBank(0),slot=bank.getItems().findIndex(i=>i.getId()===empty());
  assert.ok(slot>=0);Bank.withdraw(f.p,empty(),slot,1,0);
  callback.execute(2);
  assert.equal(f.inv.getAmount(chemistry()),2);assert.equal(f.inv.getAmount(charged()),0);
});
test('Uncharge full inventory and capped notes preserve charges, while sub-ten clears without return',async t=>{
  const f=actor(t);put(f,0,charged(),1,{[KEY]:19});
  for(let i=1;i<28;i++)put(f,i,core.ItemIdentifiers.RAKE);
  await action(f,0,'Uncharge');await choice(f,1);
  assert.equal(f.inv.getItems()[0].getId(),charged());assert.equal(f.inv.getItems()[0].getMetaValue(KEY),19);
  put(f,1,noted(),2147483647);
  await action(f,0,'Uncharge');await choice(f,1);
  assert.equal(f.inv.getItems()[0].getMetaValue(KEY),19);
  f.inv.getItems()[0].setMetaValue(KEY,9);
  await action(f,0,'Uncharge');await choice(f,1);
  assert.equal(f.inv.getItems()[0].getId(),empty());assert.equal(f.inv.getAmount(noted()),2147483647);
});
test('real equipment and serialized save/load retain item charge metadata',async t=>{
  const f=actor(t);put(f,0,charged(),1,{[KEY]:23});
  await action(f,0,'Wear');assert.equal(f.eq.get(core.Equipment.AMULET_SLOT).getMetaValue(KEY),23);
  const persistence=require('../dist/game/GameConstants').GameConstants.PLAYER_PERSISTENCE;
  persistence.save(f.p);await persistence.flush();
  const saved=persistence.load(f.p.getUsername());const restored=actor(t);saved.applyToPlayer(restored.p);
  assert.equal(restored.eq.get(core.Equipment.AMULET_SLOT).getMetaValue(KEY),23);
});
test('eligible variable doses and dressing; unfinished, four-dose and Guthix rest refused',async t=>{
  const extra=require('../plugins/items/AmuletOfChemistry.plugin')._test.withExtraDose;
  assert.equal(extra(obj('3dosehaemostaticdressing')),obj('4dosehaemostaticdressing'));
  assert.equal(extra(obj('3dosestamina')),obj('4dosestamina'));
  assert.equal(extra(obj('4dosestamina')),null);
  assert.equal(extra(obj('ranarrvial')),null);
  assert.equal(extra(core.ItemIdentifiers.GUTHIX_REST_3_),null);
});
test('real death route: lost worn PvP amulet is uncharged in its owners grave; other cases retain charges', t=>{
  const {PlayerDeathTask}=require('../dist/game/task/impl/PlayerDeath');
  for(const mode of ['worn-pvp','carried-pvp','protected-pvp','worn-pvm']){
    const f=actor(t),killer=actor(t).p;
    f.p.setLocation(new core.Location(3090,3500,0));
    f.p.setAttribute('gravestones:met-death',true);
    if(mode!=='protected-pvp')f.p.setSkullTimer(100);
    const amulet=mode==='carried-pvp'?put(f,0,charged(),1,{[KEY]:37}):wear(f,37);
    const kept=PlayerDeathTask.dropItems(f.p,mode==='worn-pvm'?null:killer,f.p.getLocation());
    const state={player:f.p};PM.emitCustomEvent('gravestones:state',state);
    if(mode==='worn-pvp'){
      assert.ok(state.grave,'lost worn amulet creates victim grave');
      assert.ok(state.grave.items.some(i=>i?.id===empty()));
      assert.ok(!kept.some(i=>i.getId()===empty()||i.getId()===charged()));
      assert.equal(amulet.getMetaValue(KEY),undefined);
    }else if(mode==='worn-pvm'){
      assert.ok(state.grave.items.some(i=>i?.id===charged()&&i?.meta?.[KEY]===37));
    }else{
      assert.equal(state.grave,null,mode);
      assert.ok(kept.some(i=>i.getId()===charged()&&i.getMetaValue(KEY)===37),mode);
    }
    PM.emitCustomEvent('gravestones:forfeit',{player:f.p});
  }
});
test('native make-all continues after final charge despite ordinary chemistry stop setting',async t=>{
  const f=actor(t);wear(f,1);
  f.p.setAttribute('amulet-of-chemistry:stop-on-break',true);
  for(let n=0;n<2;n++){put(f,n*2,obj('ranarrvial'));put(f,n*2+1,obj('snape_grass'));}
  t.mock.method(Math,'random',()=>.10);
  await use(f,0,1);
  const {CREATION_MENU_FIRST_ITEM_COMPONENT}=require('../dist/net/packet/PacketSender');
  await send(f,{type:'dialogue_continue',widgetId:(270<<16)|CREATION_MENU_FIRST_ITEM_COMPONENT,childIndex:2});ticks(7);
  assert.equal(f.inv.getAmount(obj('4doseprayerrestore')),1);
  assert.equal(f.inv.getAmount(obj('3doseprayerrestore')),1);
  assert.equal(f.eq.get(core.Equipment.AMULET_SLOT).getId(),empty());
});
test('exact 15 percent boundary, inert empty and dummy, ordinary chemistry regression, and goggles share native brew',async t=>{
  for(const [id,count,roll,extra,left,goggles] of [
    [()=>charged(),3,.15,false,3,false],
    [()=>empty(),3,0,false,3,false],
    [()=>obj('amulet_of_chemistry_imbued_charged_dummy'),3,0,false,3,false],
    [()=>chemistry(),3,.04,true,3,false],
    [()=>charged(),3,0,true,2,true],
  ]){
    const f=actor(t),amulet=wear(f,count,id());
    if(goggles)f.eq.set(core.Equipment.HEAD_SLOT,new core.Item(obj('mm_alchemist_hat')));
    put(f,0,obj('ranarrvial'));put(f,1,obj('snape_grass'));
    t.mock.method(Math,'random',()=>roll);
    await use(f,0,1);
    assert.equal(f.inv.getAmount(obj(extra?'4doseprayerrestore':'3doseprayerrestore')),1);
    assert.equal(amulet.getMetaValue(KEY),left);
    if(goggles)assert.equal(f.inv.getAmount(obj('snape_grass')),1);
    if(id()===chemistry())assert.equal(f.p.getAttribute('amulet-of-chemistry:charges'),4);
    t.mock.restoreAll();
  }
});
test('actual native Mixology purchase grants 50 charges and refuses no-space before spending resin',async t=>{
  const Shared=require('../plugins/minigames/mixology/Shared.Mixology');
  const cache=core.CacheDefinitions;
  const stock=cache.getDbRow(cache.getDbRowId('mixology_rewards')).column(cache.getDbColumn(cache.getDbTableId('omnishop_shop_data'),'omnishop_shop_stock'));
  const index=stock.indexOf(cache.getDbRowId('mixology_stock_amulet'));
  assert.ok(index>=0);
  for(const full of [true,false]){
    const f=actor(t);
    for(const [reagent,n] of Object.entries({mox:6900,aga:5650,lye:7400}))Shared.setResin(f.p,reagent,n);
    if(full)for(let i=0;i<28;i++)put(f,i,core.ItemIdentifiers.RAKE);
    PM.emitCustomEvent('omnishop:open',{player:f.p,shop:'mixology_rewards'});
    const component=cache.getComponentId('omnishop_main:list');
    await send(f,{type:'widget_action',widgetId:component,groupId:component>>>16,childId:component&65535,buttonNum:2,slot:index*12,itemId:-1});
    assert.equal(Shared.resin(f.p,'mox'),full?6900:0);
    assert.equal(f.inv.getAmount(charged()),full?0:1);
    if(!full)assert.equal(f.inv.getItems().find(i=>i.getId()===charged()).getMetaValue(KEY),50);
  }
});
test('grave owner refuses nominated third-party, protected or tradeable PvP loot',t=>{
  const api=PM.createApi('AmuletPolicyTest');
  const f=actor(t),killer=actor(t).p;
  const thirdParty=new core.Item(charged(),1,{[KEY]:50});
  const worn=wear(f,20);put(f,0,core.ItemIdentifiers.COINS,700);
  f.p.setSkullTimer(100);
  api.onCustomEvent('gravestones:pvp-items',query=>{
    if(query.player===f.p)query.items.push(thirdParty,...f.inv.getItems());
  });
  const {PlayerDeathTask}=require('../dist/game/task/impl/PlayerDeath');
  const kept=PlayerDeathTask.dropItems(f.p,killer,f.p.getLocation());
  const state={player:f.p};PM.emitCustomEvent('gravestones:state',state);
  assert.deepEqual(state.grave.items.filter(Boolean).map(i=>i.id),[empty()]);
  assert.equal(thirdParty.getMetaValue(KEY),50);
  assert.ok(!kept.includes(worn));
  PM.emitCustomEvent('gravestones:forfeit',{player:f.p});
});
test('native Friendly Forager supplies fourth dose without spending either amulet kind charge',async t=>{
  for(const ordinary of [false,true]){
    const f=actor(t);f.p.setProfile('league');f.p.setAttribute('league:type',5);f.p.setAttribute('league:relics',{'1':2});
    assert.equal(require('../plugins/modes/leaguerelics/Common.LeagueRelics').hasRelic(f.p,'friendly-forager'),true);
    const amulet=wear(f,2,ordinary?chemistry():charged());
    const observed=[];
    PM.createApi('AmuletCancellationTest').onCustomEvent('herblore:made',e=>{if(e.player===f.p)observed.push(e.mix);});
    f.p.setAttribute('amulet-of-chemistry:charges',4);
    put(f,0,obj('ranarrvial'));put(f,1,obj('snape_grass'));
    const before=f.p.getSkillManager().skills.experience[core.Skill.HERBLORE.getIndex()];
    const messagesBefore=f.messages.length;
    t.mock.method(Math,'random',()=>.01);
    await use(f,0,1);
    assert.equal(f.inv.getAmount(obj('4doseprayerrestore')),1);
    assert.equal(f.inv.getAmount(obj('snape_grass')),1);
    assert.equal(f.p.getSkillManager().skills.experience[core.Skill.HERBLORE.getIndex()]-before,87.5*8, 'ordinary recipe XP with actual League multiplier');
    assert.equal(amulet.getMetaValue(KEY),2);
    assert.equal(f.p.getAttribute('amulet-of-chemistry:charges'),4);
    assert.ok(!f.messages.slice(messagesBefore).some(m=>/amulet.*helps you/.test(m)));
    assert.equal(observed.length,1);
    assert.equal(observed[0].alchemistExtraDose,undefined,'pending amulet token cleared even on cancellation');
  }
});
test('real grave retrieval auto-equips transformed PvP amulet and preserves normal controls',t=>{
  const {PlayerDeathTask}=require('../dist/game/task/impl/PlayerDeath');
  const Common=require('../plugins/world/gravestones/Common.Gravestones');
  const Grave=require('../plugins/world/gravestones/Grave.Gravestones');
  for(const kind of ['charged-pvp','uncharged-pvp','charged-pvm']){
    const f=actor(t),killer=actor(t);f.p.setSkullTimer(100);f.p.setAttribute('gravestones:met-death',true);
    const pvp=kind!=='charged-pvm';const original=wear(f,17,kind==='uncharged-pvp'?empty():charged());
    Common.setVarbit(f.p,'autoEquip',1);
    const kept=PlayerDeathTask.dropItems(f.p,pvp?killer.p:null,f.p.getLocation());
    assert.ok(!kept.includes(original));
    const state={player:f.p};PM.emitCustomEvent('gravestones:state',state);
    const expected=pvp?empty():charged();
    assert.deepEqual(state.grave.items.filter(Boolean).map(i=>i.id),[expected]);
    Grave.takeFree(f.p);
    assert.equal(f.eq.get(core.Equipment.AMULET_SLOT).getId(),expected,kind);
    assert.equal(f.inv.getAmount(expected),0,kind);
    if(!pvp)assert.equal(f.eq.get(core.Equipment.AMULET_SLOT).getMetaValue(KEY),17);
    PM.emitCustomEvent('gravestones:forfeit',{player:f.p});
  }
});
