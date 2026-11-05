const assert=require('node:assert/strict');
const {test}=require('node:test');
const {Server}=require('../dist/Server');Server.installProductionPathResolver();
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
const {GameConstants}=require('../dist/game/GameConstants');
const {TaskManager}=require('../dist/game/task/TaskManager');
const {CombatPoisonEffect}=require('../dist/game/task/impl/CombatPoisonEffect');
const {curePoisonAndVenom}=require('../plugins/items/ConsumableEffects');

function player(t,venom=false){
 const p=new Player(null);p.setRegistered(true);p.setPoisonDamage(venom?10:27);p.setVenomed(venom);
 t.mock.method(p,'isPlayerBot',()=>true);
 t.mock.method(p.getTrading(),'closeTrade',()=>{});
 t.mock.method(p.getRelations(),'updateLists',()=>{});
 const sender=new Proxy({},{get:(_,key)=>key==='hasInterruptibleInterface'?()=>false:()=>sender});
 t.mock.method(p,'getPacketSender',()=>sender);
 t.after(()=>{p.setRegistered(false);CombatPoisonEffect.suspend(p);TaskManager.cancelTasks(p);});return p;
}

test('real logout cancellation preserves poison and venom in the save snapshot',t=>{
 let snapshot;
 t.mock.method(GameConstants.PLAYER_PERSISTENCE,'cancelRequestedSave',()=>{});
 t.mock.method(GameConstants.PLAYER_PERSISTENCE,'save',p=>{snapshot=PlayerSave.fromPlayer(p);});
 for(const venom of [false,true]){
  const p=player(t,venom),effect=new CombatPoisonEffect(p);TaskManager.submit(effect);
  p.setRegistered(false);p.onLogout();
  assert.equal(effect.isRunning(),false);
  assert.equal(snapshot.getPoisonDamage(),venom?10:27);
  assert.equal(snapshot.isVenomed(),venom);
 }
});

test('loading a poisoned save restarts exactly one damage task on login',t=>{
 for(const venom of [false,true]){
  const original=player(t,venom),save=PlayerSave.fromPlayer(original),loaded=player(t);
  save.applyToPlayer(loaded);loaded.setRegistered(true);
  const submitted=[],submit=TaskManager.submit.bind(TaskManager);
  t.mock.method(TaskManager,'submit',task=>{submitted.push(task);submit(task);});
  loaded.onLogin();loaded.onLogin();
  const poison=submitted.filter(task=>task instanceof CombatPoisonEffect);
  assert.equal(poison.length,1,'repeated login setup must not double poison ticks');
  assert.equal(loaded.getPoisonDamage(),venom?10:27);
  assert.equal(CombatPoisonEffect.orbValue(loaded),venom?1000002:27);
  const hits=[];t.mock.method(loaded.getCombat().getHitQueue(),'addPendingDamage',values=>hits.push(...values));
  for(let i=0;i<35;i++)poison[0].tick();
  assert.deepEqual(hits.map(hit=>hit.getDamage()),[venom?10:6],'the restored task actually damages with its saved progression');
  assert.equal(loaded.getPoisonDamage(),venom?12:26);
  t.mock.restoreAll();
 }
});

test('replaced and cancelled tasks cannot alter a newer affliction',t=>{
 const p=player(t,true),old=new CombatPoisonEffect(p);TaskManager.submit(old);
 const current=new CombatPoisonEffect(p);TaskManager.submit(current);
 let hits=0;t.mock.method(p.getCombat().getHitQueue(),'addPendingDamage',()=>{hits++;});
 assert.equal(old.isRunning(),false);
 for(let i=0;i<35;i++)old.execute();
 assert.equal(hits,0);assert.equal(p.getPoisonDamage(),10);
 old.stop();for(let i=0;i<35;i++)current.tick();
 assert.equal(hits,1);assert.equal(p.getPoisonDamage(),12);
});

test('cancelling player activity tasks does not suspend or restart the poison clock',t=>{
 const p=player(t,true),effect=new CombatPoisonEffect(p);TaskManager.submit(effect);
 let hits=0;t.mock.method(p.getCombat().getHitQueue(),'addPendingDamage',()=>{hits++;});
 for(let i=0;i<15;i++)effect.tick();
 TaskManager.cancelTasks(p);
 assert.equal(effect.isRunning(),true,'bot movement reset is activity cancellation, not logout');
 for(let i=0;i<20;i++)effect.tick();
 assert.equal(hits,1);assert.equal(p.getPoisonDamage(),12);
});

test('explicit cures and natural expiry end damage while an antidote retains its protection task',t=>{
 for(const reason of ['antidote','cure','expiry']){
  const p=player(t,reason!=='expiry');
  if(reason==='expiry')p.setPoisonDamage(1);
  const effect=new CombatPoisonEffect(p);TaskManager.submit(effect);
  if(reason==='antidote'){curePoisonAndVenom(p);p.getCombat().getPoisonImmunityTimer().start(60);}
  if(reason==='cure')curePoisonAndVenom(p);
  const hits=[];t.mock.method(p.getCombat().getHitQueue(),'addPendingDamage',values=>hits.push(...values));
  for(let i=0;i<35;i++)effect.tick();
  assert.equal(effect.isRunning(),reason==='antidote',reason);assert.equal(p.getPoisonDamage(),0,reason);assert.equal(p.isVenomed(),false,reason);
  assert.deepEqual(hits.map(hit=>hit.getDamage()),reason==='expiry'?[1]:[],reason);
 }
});

test('a detached poison task stops without damaging or curing its saved actor',t=>{
 const p=player(t,true),effect=new CombatPoisonEffect(p);TaskManager.submit(effect);
 p.setRegistered(false);effect.execute();
 assert.equal(effect.isRunning(),false);assert.equal(p.getPoisonDamage(),10);assert.equal(p.isVenomed(),true);
});

test('a registered dead actor is cured before another poison damage can queue',t=>{
 const p=player(t,true),effect=new CombatPoisonEffect(p);TaskManager.submit(effect);
 t.mock.method(p,'getHitpoints',()=>0);
 let hits=0;t.mock.method(p.getCombat().getHitQueue(),'addPendingDamage',()=>{hits++;});
 for(let i=0;i<35;i++)effect.execute();
 assert.equal(hits,0);assert.equal(p.getPoisonDamage(),0);assert.equal(p.isVenomed(),false);assert.equal(effect.isRunning(),false);
});


test('native item-on-item applies poison and whip mixes without losing item provenance', async t => {
 const path=require('node:path');
 const {CachePipeline}=require('../dist/game/cache/CachePipeline');
 const {PluginManager}=require('../dist/plugins/PluginManager');
 const {PlayerSession}=require('../dist/net/PlayerSession');
 const {ClientConnection}=require('../dist/net/NetworkBuilder');
 const {decodeClientPackets}=require('../dist/net/protocol/ClientProtocol');
 const {Item}=require('../dist/game/model/Item');
 const {CombatPoisonData}=require('../dist/game/task/impl/CombatPoisonEffect');
 await CachePipeline.initialize(path.resolve(__dirname,'..'));
 PluginManager.loadFromDirectory(path.resolve(__dirname,'../plugins'));
 PluginManager.emitServerStartup({});CombatPoisonData.init();
 t.after(()=>PluginManager.emitServerShutdown({}));
 function fixture(){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel));p.setUsername('coatingtest');p.setRegistered(true);
  const c=new ClientConnection(channel);c.player=p;
  t.after(()=>{p.setRegistered(false);TaskManager.cancelTasks(p);});
  return {p,inv:p.getInventory(),async use(a,b){
   const data=Buffer.alloc(13);data.writeUInt16BE(a,0);data.writeUInt16BE(this.inv.getItems()[a].getId(),2);data[4]=4;
   data.writeUInt16BE(b,9);data.writeUInt16BE(this.inv.getItems()[b].getId(),11);
   const decoded=decodeClientPackets(Buffer.concat([Buffer.from([241,data.length]),data]));
   assert.equal(decoded[0].type,'inventory_use_on');await c.dispatch(decoded,true);
  }};
 }

 await t.test('every authored poison family matches native usable items and existing combat tiers',async()=>{
  const rows=require('../plugins/items/data/weapon-poison.json').families;
  const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
  assert.equal(rows.length,67);
  for(const row of rows){
   const names=row.items.map(id=>{
    const d=CacheDefinitions.getItem(id);assert.equal(d.noteTemplate,-1);assert.equal(d.placeholderTemplate,-1);assert.ok([3,13].includes(d.wearPos));
    return d.name.replace(/\s+\(/g,'(');
   });
   assert.deepEqual(names,[row.name,...['(p)','(p+)','(p++)'].map(s=>row.name+s)]);
   for(let tier=1;tier<4;tier++){
    const f=fixture();f.inv.setItem(0,new Item(row.items[0]));f.inv.setItem(1,new Item([187,5937,5940][tier-1]));await f.use(0,1);
    assert.equal(f.inv.getItems()[0].getId(),row.items[tier],row.name);assert.notEqual(CombatPoisonData.getPoisonType(f.inv.getItems()[0]),undefined,row.name);
   }
  }
 });
 for(const [quantity,existing,full,expected] of [[1,0,true,1],[3,0,false,3],[5,0,true,5],[6,0,false,5],[10,0,true,0],[10,7,true,5],[10,2147483645,true,0]]){
  await t.test(`projectile batch ${quantity}, existing=${existing}, full=${full}`,async()=>{
   const f=fixture(),meta={preset:true,untradeable:true,origin:'ammo'};
   f.inv.setItem(0,new Item(882,quantity,meta));f.inv.setItem(1,new Item(5940));
   if(existing)f.inv.setItem(2,new Item(5622,existing,meta));
   if(full)for(let i=existing?3:2;i<28;i++)f.inv.setItem(i,new Item(385));
   await f.use(1,0);assert.equal(f.inv.getAmount(5622),existing+expected);assert.equal(f.inv.getAmount(882),quantity-expected);
   assert.equal(f.inv.getAmount(5940),expected?0:1);assert.equal(f.inv.getAmount(229),expected?1:0);
   for(const item of f.inv.getItems().filter(item=>item.getId()===5622))assert.deepEqual(item.getMeta(),meta);
  });
 }
 for(const [source,reagent,result] of [[1215,187,1231],[1231,3188,1215]])await t.test(`full inventory converts nonstackable ${source} beside another ${result}`,async()=>{
  const f=fixture(),meta={origin:'original'};
  f.inv.setItem(0,new Item(source,1,meta));f.inv.setItem(1,new Item(reagent));f.inv.setItem(2,new Item(result,1,meta));
  for(let slot=3;slot<28;slot++)f.inv.setItem(slot,new Item(385));
  await f.use(1,0);
  assert.equal(f.inv.getItems()[0].getId(),result,'the original weapon converts in its own slot');
  assert.deepEqual(f.inv.getItems()[0].getMeta(),meta);assert.equal(f.inv.getAmount(result),2);
  assert.equal(f.inv.getAmount(reagent===3188?3188:229),1,'cloth is retained or the poison vial is emptied');
 });
 await t.test('cleaning a stack retains its cloth and metadata and merges only matching stacks',async()=>{
  const f=fixture(),meta={preset:true,untradeable:true,origin:'ammo'};
  f.inv.setItem(0,new Item(5622,100,meta));f.inv.setItem(1,new Item(3188));f.inv.setItem(2,new Item(882,7,meta));f.inv.setItem(3,new Item(882,9));
  await f.use(0,1);assert.equal(f.inv.getAmount(5622),0);assert.equal(f.inv.getItems()[2].getAmount(),107);assert.deepEqual(f.inv.getItems()[2].getMeta(),meta);assert.equal(f.inv.getItems()[3].getAmount(),9);assert.equal(f.inv.getAmount(3188),1);
 });
 for(const reagent of [187,5937,5940,12771,12769])await t.test(`restricted reagent ${reagent} cannot turn into a valuable upgrade`,async()=>{
  const f=fixture(),base=reagent>12000?4151:1215;
  f.inv.setItem(0,new Item(base));f.inv.setItem(1,new Item(reagent,1,{preset:true,untradeable:true,unbankable:true}));await f.use(0,1);
  assert.equal(f.inv.getItems()[0].getId(),base);assert.equal(f.inv.getItems()[1].getId(),reagent);
 });
 for(const [target,reagent] of [[1216,187],[14640,187],[20407,187],[1215,1465],[4587,5940],[4151,12772],[4178,12771],[20405,12771],[1231,5940]])await t.test(`unsupported pair ${target}/${reagent} remains untouched`,async()=>{
  const f=fixture();f.inv.setItem(0,new Item(target));f.inv.setItem(1,new Item(reagent));await f.use(1,0);
  assert.equal(f.inv.getItems()[0].getId(),target);assert.equal(f.inv.getItems()[1].getId(),reagent);
 });
 await t.test('a retained event cannot consume a replacement item or credit a removed source',()=>{
  const f=fixture(),weapon=new Item(1215),poison=new Item(187);
  f.inv.setItem(0,weapon);f.inv.setItem(1,poison);f.inv.setItem(0,new Item(1215));
  const event={player:f.p,usedItem:poison,usedItemId:187,usedItemSlot:1,usedWithItem:weapon,usedWithItemId:1215,usedWithItemSlot:0,handled:false};
  PluginManager.emitItemOnItem(event);assert.equal(weapon.getId(),1215);assert.equal(f.inv.getItems()[0].getId(),1215);assert.equal(poison.getId(),187);
 });

 await t.test('a full poisoned stack cannot overflow an existing clean stack',async()=>{
  const f=fixture();f.inv.setItem(0,new Item(5622,5));f.inv.setItem(1,new Item(3188));f.inv.setItem(2,new Item(882,2147483645));
  await f.use(1,0);assert.equal(f.inv.getItems()[0].getId(),5622);assert.equal(f.inv.getItems()[0].getAmount(),5);assert.equal(f.inv.getItems()[2].getAmount(),2147483645);assert.equal(f.inv.getAmount(3188),1);
 });
 await t.test('partial coating does not merge into ammo with a different origin',async()=>{
  const f=fixture(),meta={preset:true,untradeable:true,origin:'original'};
  f.inv.setItem(0,new Item(882,10,meta));f.inv.setItem(1,new Item(5940));f.inv.setItem(2,new Item(5622,7));
  await f.use(0,1);assert.equal(f.inv.getItems()[2].getAmount(),7);assert.equal(f.inv.getItems()[2].getMeta(),null);
  const coated=f.inv.getItems().find(item=>item.getId()===5622&&item.isPresetItem());assert.ok(coated);assert.equal(coated.getAmount(),5);assert.deepEqual(coated.getMeta(),meta);
 });
 await t.test('whip dye requires the original live ingredient slots and has no direct Revert action',()=>{
  const f=fixture(),whip=new Item(4151),mix=new Item(12771);
  f.inv.setItem(0,whip);f.inv.setItem(1,mix);f.inv.setItem(1,new Item(12771));
  PluginManager.emitItemOnItem({player:f.p,usedItem:mix,usedItemId:12771,usedItemSlot:1,usedWithItem:whip,usedWithItemId:4151,usedWithItemSlot:0,handled:false});
  assert.equal(whip.getId(),4151);assert.equal(f.inv.getItems()[1].getId(),12771);
  const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
  for(const id of [12773,12774]){
   assert.equal(CacheDefinitions.getItem(id).inventoryActions.includes('Revert'),false);
   const dyed=new Item(id);f.inv.setItem(0,dyed);
   PluginManager.emitItemAction({player:f.p,item:dyed,itemId:id,slot:0,option:'Revert',handled:false});
   assert.equal(dyed.getId(),id);assert.equal(dyed.isTradeable(),false);
  }
 });
 for(const [poison,result,severity] of [[187,1231,20],[5937,5680,25],[5940,5698,30]])for(const reverse of [false,true]){
  await t.test(`dragon dagger tier ${poison}, reverse=${reverse}`,async()=>{
   const f=fixture(),meta={preset:true,untradeable:true,unbankable:true,origin:{owner:'original'}};
   f.inv.setItem(0,new Item(1215,1,meta));f.inv.setItem(1,new Item(poison));
   await f.use(reverse?0:1,reverse?1:0);
   assert.equal(f.inv.getItems()[0].getId(),result);
   assert.deepEqual(f.inv.getItems()[0].getMeta(),meta);
   assert.equal(CombatPoisonData.getMeleeSeverity(CombatPoisonData.getPoisonType(f.inv.getItems()[0])),severity);
   assert.equal(f.inv.getAmount(poison),0);assert.equal(f.inv.getAmount(229),1);
   f.inv.setItem(2,new Item(3188));await f.use(2,0);
   assert.equal(f.inv.getItems()[0].getId(),1215);assert.deepEqual(f.inv.getItems()[0].getMeta(),meta);assert.equal(f.inv.getAmount(3188),1);
  });
 }
 for(const [mix,result] of [[12771,12773],[12769,12774]])for(const reverse of [false,true]){
  await t.test(`whip mix ${mix}, reverse=${reverse}`,async()=>{
   const f=fixture(),meta={preset:true,untradeable:true,origin:{owner:'original'}};
   f.inv.setItem(0,new Item(4151,1,meta));f.inv.setItem(1,new Item(mix));await f.use(reverse?0:1,reverse?1:0);
   assert.equal(f.inv.getItems()[0].getId(),result);assert.deepEqual(f.inv.getItems()[0].getMeta(),meta);assert.equal(f.inv.getAmount(mix),0);
   f.inv.setItem(1,new Item(3188));await f.use(0,1);
   assert.equal(f.inv.getItems()[0].getId(),4151);assert.deepEqual(f.inv.getItems()[0].getMeta(),meta);assert.equal(f.inv.getAmount(mix),0);assert.equal(f.inv.getAmount(3188),1);
  });
 }
});
