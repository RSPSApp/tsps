const assert = require('node:assert/strict');
const path = require('node:path');
const {before, after, test} = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {ShopDefinitionLoader, setPresetShopPricesEnabled} = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
const {PlayerSave} = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const {MAX_STACK_AMOUNT: CAP} = require('../dist/game/model/container/StackType');
let core, next=1800;
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  PM.loadFromDirectory(path.resolve(__dirname,'../plugins'));core=PM.getCoreApi();
  core.RegionManager.init();core.RegionManager.loadMapFiles(3222,3218);PM.emitServerStartup({});
  assert.equal(new ShopDefinitionLoader().load(),true);core.ShopManager.initialize();
});
after(()=>PM.emitServerShutdown({}));
function actor(t){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel));p.setIndex(next++);p.setUsername('paycap'+next);p.setRegistered(true);p.setLocation(new core.Location(3222,3218,0));p.needsPlacement=false;
  const c=new ClientConnection(channel);c.player=p;const messages=[];
  t.mock.method(p.getPacketSender(),'sendMessage',m=>{messages.push(m);return p.getPacketSender();});
  t.after(()=>{core.ShopManager.close(p);PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());});
  return{p,c,messages};
}
async function input(f,packet){await f.c.dispatch([packet]);f.c.processTurnPackets();}
function open(f,shopId){assert.equal(core.ShopManager.open(f.p,shopId),true);assert.ok(core.ShopManager.getOpenShop(f.p));}
async function sale(f,itemId,buttonNum=2){
  const slot=f.p.getInventory().getSlotForItemId(itemId);assert.ok(slot>=0);
  await input(f,{type:'widget_action',widgetId:301<<16,groupId:301,childId:0,buttonNum,slot,itemId});
}
const stock=(f,id)=>core.ShopManager.getOpenShop(f.p).stock.find(s=>s.itemId===id)?.amount;
async function refund(f,itemId){
  await sale(f,itemId,1);
  const line=f.messages.findLast(m=>/shop will buy for [\d,]+/.test(m));assert.ok(line,f.messages.join('\n'));
  const price=Number(/shop will buy for ([\d,]+)/.exec(line)[1].replaceAll(',',''));assert.ok(price>0);return price;
}
for(const which of ['coins','tokkul'])test(`native ${which} sale cannot consume an item when the payment stack is full`,async t=>{
  const f=actor(t),currency=which==='coins'?core.ItemIdentifiers.COINS:core.ItemIdentifiers.TOKKUL;
  const item=which==='coins'?core.ItemIdentifiers.BRONZE_AXE:core.ItemIdentifiers.UNCUT_SAPPHIRE;
  const shop=which==='coins'?core.ShopDefinition.all().find(s=>s.getName().includes("Bob's Brilliant Axes")):core.ShopDefinition.forId(1468);
  assert.ok(shop);const inv=f.p.getInventory();inv.add(new core.Item(currency,CAP),false);inv.add(new core.Item(item),false);
  assert.equal(inv.getAddableAmount(new core.Item(currency,1)),0,'actual container refuses another matching currency');
  open(f,shop.getId());const before=stock(f,item);await sale(f,item);
  assert.equal(inv.getAmount(item),1,'refused payment must preserve the sold item');assert.equal(inv.getAmount(currency),CAP);assert.equal(stock(f,item),before);
  assert.ok(f.messages.includes("You don't have enough inventory space."),f.messages.join('\n'));
  await sale(f,item);assert.equal(inv.getAmount(item),1);assert.equal(stock(f,item),before,'repeat refusal cannot transfer stock');
});
test('ordinary native Tokkul sale survives actual Bank deposit/withdraw and fresh save restoration',async t=>{
  const f=actor(t),currency=core.ItemIdentifiers.TOKKUL,item=core.ItemIdentifiers.UNCUT_SAPPHIRE;
  f.p.getInventory().add(new core.Item(currency,100),false);f.p.getInventory().add(new core.Item(item),false);open(f,1468);const before=stock(f,item);
  await sale(f,item);const balance=f.p.getInventory().getAmount(currency);assert.ok(balance>100);assert.equal(f.p.getInventory().getAmount(item),0);assert.equal(stock(f,item),before+1);
  f.p.getPacketSender().sendInterfaceRemoval();f.p.getBank(0).open();core.Bank.deposit(f.p,currency,f.p.getInventory().getSlotForItemId(currency),balance,false);assert.equal(f.p.getInventory().getAmount(currency),0);
  core.Bank.withdraw(f.p,currency,f.p.getBank(0).getSlotForItemId(currency),balance,0);assert.equal(f.p.getInventory().getAmount(currency),balance);
  PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});const g=actor(t);PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});g.p.needsPlacement=false;
  assert.equal(g.p.getInventory().getAmount(currency),balance);assert.equal(g.p.getInventory().getAmount(item),0);
});
for(const gap of [0,1])test(`native payment ${gap===0?'exactly fills the stack':'one over the available space is refused before mutation'}`,async t=>{
  const f=actor(t),currency=core.ItemIdentifiers.TOKKUL,item=core.ItemIdentifiers.UNCUT_SAPPHIRE,inv=f.p.getInventory();
  inv.add(new core.Item(currency,1),false);inv.add(new core.Item(item),false);open(f,1468);const price=await refund(f,item);
  const money=inv.getItems()[inv.getSlotForItemId(currency)],gem=inv.getItems()[inv.getSlotForItemId(item)];money.setAmount(CAP-price+gap);const before=stock(f,item);
  await sale(f,item);
  assert.equal(inv.getAmount(currency),gap?CAP-price+1:CAP);assert.equal(inv.getAmount(item),gap?1:0);assert.equal(stock(f,item),before+(gap?0:1));
  assert.equal(inv.getItems()[inv.getSlotForItemId(currency)],money,'preview must not replace the live currency stack');
  if(gap)assert.equal(inv.getItems()[inv.getSlotForItemId(item)],gem,'preview must not replace the refused item');
});
test('selling an unstackable item from a full bag makes the actual last slot available to its payment',async t=>{
  const f=actor(t),currency=core.ItemIdentifiers.TOKKUL,item=core.ItemIdentifiers.UNCUT_SAPPHIRE,inv=f.p.getInventory();
  inv.add(new core.Item(item),false);for(let i=0;i<27;i++)inv.add(new core.Item(core.ItemIdentifiers.RAKE),false);assert.equal(inv.getFreeSlots(),0);
  assert.equal(inv.getAddableAmount(new core.Item(currency,1)),0);open(f,1468);const price=await refund(f,item);await sale(f,item);
  assert.equal(inv.getAmount(item),0);assert.equal(inv.getAmount(currency),price);assert.equal(inv.getAmount(core.ItemIdentifiers.RAKE),27);assert.equal(inv.getFreeSlots(),0);
});
test('real Bank metadata transfer cannot trick a full bag into merging a different currency stack',async t=>{
  const f=actor(t),currency=core.ItemIdentifiers.TOKKUL,gem=core.ItemIdentifiers.UNCUT_SAPPHIRE,item=core.ItemDefinition.forId(gem).getNoteId(),inv=f.p.getInventory();assert.ok(item>0);
  inv.add(new core.Item(currency,100,{'capacity-test':'separate'}),false);
  f.p.getBank(0).open();core.Bank.deposit(f.p,currency,inv.getSlotForItemId(currency),100,false);assert.equal(inv.getAmount(currency),0);
  core.Bank.withdraw(f.p,currency,f.p.getBank(0).getSlotForItemId(currency),100,0);f.p.getPacketSender().sendInterfaceRemoval();
  const money=inv.getItems()[inv.getSlotForItemId(currency)];assert.equal(money.getMeta()['capacity-test'],'separate');
  inv.add(new core.Item(item,10),false);for(let i=0;i<26;i++)inv.add(new core.Item(core.ItemIdentifiers.RAKE),false);assert.equal(inv.getFreeSlots(),0);
  assert.equal(inv.getAddableAmount(new core.Item(currency,1)),0,'incoming default payment cannot merge with the bank-returned tagged currency');
  open(f,1468);const price=await refund(f,item),before=stock(f,gem),items=inv.getCopiedItems();await sale(f,item);
  assert.deepEqual(inv.getItems(),items,'refusal preserves all amounts and metadata');assert.equal(stock(f,gem),before);assert.equal(inv.getItems()[inv.getSlotForItemId(currency)],money);
  await sale(f,item,4);assert.equal(inv.getAmount(item),0);assert.equal(inv.getAmount(currency),100+10*price);assert.equal(stock(f,gem),before+10);
  const paid=inv.getItems().filter(x=>x.getId()===currency);assert.equal(paid.length,2);assert.equal(money.getAmount(),100);assert.equal(money.getMeta()['capacity-test'],'separate');
});
test('Pk Supplies sells normal stackable Purple sweets at its authored coin and blood-money prices',async t=>{
  const shopId=27,normal=core.ItemIdentifiers.PURPLE_SWEETS_2,obsolete=core.ItemIdentifiers.PURPLE_SWEETS;
  const priorPresetPrices=core.ShopDefinition.forId(shopId).getCurrency()==='BLOOD_MONEY';
  try {
    for(const presets of [false,true]){
      setPresetShopPricesEnabled(presets);new ShopDefinitionLoader().load();core.ShopManager.initialize();
      const f=actor(t),inv=f.p.getInventory(),currency=presets?core.ItemIdentifiers.BLOOD_MONEY:core.ItemIdentifiers.COINS,price=presets?100:1000;
      inv.add(new core.Item(currency,price*10),false);open(f,shopId);
      const view=core.ShopManager.getOpenShop(f.p),slot=view.stock.findIndex(s=>s.itemId===normal);
      assert.ok(slot>=0,'stock must contain normal Treasure Trails sweets');
      assert.equal(view.stock.some(s=>s.itemId===obsolete),false,'the unobtainable Halloween version is not stock');
      assert.equal(view.stock[slot].price,price);
      assert.equal(core.ItemDefinition.forId(normal).isStackable(),true);
      assert.equal(core.ItemDefinition.forId(normal).isTradeable(),true);
      const packet={type:'widget_action',widgetId:(300<<16)|16,groupId:300,childId:16,buttonNum:2,slot:slot+1,itemId:normal};
      await input(f,packet);assert.equal(inv.getAmount(normal),1);assert.equal(inv.getAmount(currency),price*9);
      await input(f,{...packet,itemId:obsolete});
      assert.equal(inv.getAmount(obsolete),0);assert.equal(inv.getAmount(normal),1);assert.equal(inv.getAmount(currency),price*9,'stale stock clicks cannot charge');
      await input(f,{...packet,buttonNum:3});
      assert.equal(inv.getAmount(normal),6);assert.equal(inv.getAmount(currency),price*4);
      assert.equal(inv.getItems().filter(item=>item.getId()===normal).length,1,'purchases merge into one real sweet stack');
      core.ShopManager.close(f.p);
    }
  } finally {
    setPresetShopPricesEnabled(priorPresetPrices);new ShopDefinitionLoader().load();core.ShopManager.initialize();
  }
});
