// Plugins load with the player bots off: a booted bot plugin rescans and rewrites the tracked
// server/plugins/bots/data/object-index.json whenever the tracked object ids moved.
process.env.DISABLE_PLAYER_BOTS = "1";
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

// #2193: registered chest options, canonical stock and real native payment.
// Requires the regenerated osrsreboxed food variants; never substitutes equipment.
test('Culinaromancer chest selects persisted tiers and charges canonical full-stock prices', async t => {
  const runtime = require('../plugins/quests/QuestRuntime');
  const quest = runtime.getRegisteredQuests().find(q => q.key === 'recipe_for_disaster');
  assert.ok(quest, 'use the quest already registered by the real plugin loader');
  const {BY_KEY} = require('../plugins/achievements/diaries/Data.AchievementDiaries');
  const diary = BY_KEY.get('lumbridge');
  assert.ok(diary);
  const I = core.ItemIdentifiers;
  const FLAGS = 'recipe-for-disaster:rescues';
  const PREFIX = "Culinaromancer's Chest";
  const itemNames = ['Full', 'Elite Diary', '0 Subquests', '1 Subquest', '2 Subquests', '3 Subquests', '4 Subquests', '5 Subquests', '6 Subquests', '7 Subquests', '8 Subquests'];
  const foodNames = ['food, full', 'food, full, diary', 'food, 0 Subquests', 'food, 1 Subquest', 'food, 2 Subquests', 'food, 3 Subquests', 'food, 4 Subquests', 'food, 5 Subquests', 'food, 6 Subquests', 'food, 7 Subquests', 'food, 8 Subquests'];
  const named = suffix => `${PREFIX} (${suffix})`;
  const defs = core.ShopDefinition.all();
  const line = (f, id) => core.ShopManager.getOpenShop(f.p)?.stock.find(row => row.itemId === id);
  function setup(child, stage, flags = 0) {
    // Reset actual shared stock, not definitions, between serial cases.
    core.ShopManager.reload();
    const f = actor(child);
    child.after(() => core.TaskManager.cancelTasks(f.p));
    f.p.setLocation(new core.Location(3218, 9623, 0));
    f.p.setAttribute(FLAGS, flags);
    quest.setStage(f.p, stage);
    return f;
  }
  function use(f, option) {
    const definition = core.ObjectDefinition.forPlayer(12308, f.p);
    assert.ok(definition, 'resolve the real cache base loc through this player\'s progress');
    const slot = definition.getActions().indexOf(option);
    assert.ok(slot >= 0, `${option} must be an actual action on the resolved chest`);
    // A native loc supplies the handler event. Its fixture location is the floor
    // side; this test does not assert the live map spawn footprint or pathing.
    const object = new core.GameObject(12308, f.p.getLocation().clone(), 10, 0, null);
    const source = f.p.getLocation().clone();
    assert.equal(PM.emitObjectInteraction({
      player: f.p, object, objectId: object.getId(), definition,
      clickType: slot + 1, option: option.toLowerCase(),
      location: {x: object.getLocation().getX(), y: object.getLocation().getY(), z: object.getLocation().getZ()},
      sourceLocation: {x: source.getX(), y: source.getY(), z: source.getZ()},
      handled: false,
    }), true);
  }
  async function buy(f, id) {
    const slot = core.ShopManager.getOpenShop(f.p).stock.findIndex(row => row.itemId === id);
    assert.ok(slot >= 0);
    await input(f, {type: 'widget_action', widgetId: (300 << 16) | 16, groupId: 300, childId: 16, buttonNum: 2, slot: slot + 1, itemId: id});
  }
  async function payment(f, id, expectedPrice, expectedStock) {
    const inv = f.p.getInventory();
    inv.add(new core.Item(I.COINS, 200000), false);
    const previous = inv.getAmount(id);
    assert.equal(line(f, id)?.price, expectedPrice, 'literal independent full-stock quote');
    assert.equal(line(f, id)?.amount, expectedStock);
    const coins = inv.getAmount(I.COINS);
    await buy(f, id);
    assert.equal(inv.getAmount(I.COINS), coins - expectedPrice, 'actual coin debit');
    assert.equal(inv.getAmount(id), previous + 1, 'actual delivery');
    assert.equal(line(f, id)?.amount, expectedStock - 1, 'actual stock transfer');
  }
  await t.test('canonical equipment identities survive and all food variants are separately generated', child => {
    for (const [index, suffix] of itemNames.entries()) {
      const matches = defs.filter(d => d.getName() === named(suffix));
      assert.equal(matches.length, 1);
      assert.equal(matches[0].getId(), index + 1069, 'preserve original equipment IDs');
    }
    for (const suffix of foodNames) {
      const matches = defs.filter(d => d.getName() === named(suffix));
      assert.equal(matches.length, 1, `${suffix}: canonical exporter/import required`);
      assert.equal(matches[0].getOriginalStock().length, 21);
      assert.ok(matches[0].getOriginalStock().every(row => row.id < 7433 || row.id > 7462), 'food is not the equipment list');
    }
  });
  await t.test('Bank retains its existing provider and base chest route', child => {
    const f = setup(child, 4);
    let opened = 0;
    child.mock.method(f.p.getBank(f.p.getCurrentBankTab()), 'open', () => { opened++; });
    use(f, 'Bank');
    assert.equal(opened, 1);
    assert.equal(core.ShopManager.getOpenShop(f.p), null);
    const object = new core.GameObject(12308, f.p.getLocation().clone(), 10, 0, null);
    const definition = core.ObjectDefinition.forPlayer(object.getId(), f.p);
    const source = f.p.getLocation().clone();
    const event = {
      player: f.p, object, objectId: object.getId(), definition,
      clickType: definition.getActions().indexOf('Bank') + 1,
      sourceLocation: {x: source.getX(), y: source.getY(), z: source.getZ()},
      destination: null,
    };
    PM.emitObjectRoute(event);
    assert.deepEqual(event.destination, {x: 3218, y: 9623, z: 0});
  });
  const gloves = [7453, 7454, 7455, 7456, 7457, 7458, 7459, 7460, 7461];
  const weapons = [7433, 7435, 7437, 7439, 7441, 7443, 7445, 7447, 7449];
  const eggStock = [1, 2, 3, 4, 5, 10, 13, 15, 18];
  const flourStock = [1, 2, 3, 4, 5, 6, 6, 7, 7];
  for (const [count, flags] of [0, 128, 129, 133, 149, 181, 189, 253, 255].entries()) {
    await t.test(`${count} independently saved rescues select both distinct partial shops`, child => {
      const f = setup(child, 4, flags);
      use(f, 'Buy-items');
      assert.equal(core.ShopManager.getOpenShop(f.p).name, named(itemNames[count + 2]));
      assert.deepEqual(core.ShopManager.getOpenShop(f.p).stock.map(row => [row.itemId, row.amount]),
        [...gloves.slice(0, count + 1).map(id => [id, 30]), ...weapons.slice(0, count + 1).map(id => [id, 5])]);
      assert.equal(line(f, 7462), undefined, 'eight rescues is not finale completion');
      use(f, 'Buy-food');
      assert.equal(core.ShopManager.getOpenShop(f.p).name, named(foodNames[count + 2]));
      assert.equal(line(f, I.EGG)?.amount, eggStock[count]);
      assert.equal(line(f, I.POT_OF_FLOUR)?.amount, flourStock[count]);
      assert.equal(line(f, 7453), undefined);
    });
  }
  await t.test('full finale opens full equipment and normal literal payment', async child => {
    const f = setup(child, 5, 255);
    use(f, 'Buy-items');
    assert.equal(core.ShopManager.getOpenShop(f.p).name, named('Full'));
    assert.equal(line(f, 7462)?.amount, 60);
    assert.equal(line(f, 7451)?.amount, 10);
    await payment(f, 7453, 65, 60);
  });
  await t.test('claimed elite cannot substitute for the finale with only eight rescues', child => {
    const f = setup(child, 4, 255);
    f.p.setAttribute('achievement-diaries:rewards', {lumbridge: ['elite']});
    use(f, 'Buy-items');
    assert.equal(core.ShopManager.getOpenShop(f.p).name, named('8 Subquests'));
    assert.equal(line(f, 7462), undefined);
    assert.equal(line(f, 7461)?.amount, 30);
    use(f, 'Buy-food');
    assert.equal(core.ShopManager.getOpenShop(f.p).name, named('food, 8 Subquests'));
    assert.equal(line(f, I.EGG)?.amount, 18);
  });
  await t.test('completed elite tasks without claimed rewards keep normal full price', async child => {
    const f = setup(child, 5, 255);
    f.p.setAttribute('achievement-diaries:tasks', {lumbridge: diary.tiers.elite.tasks.map(task => task.key)});
    const query = {player: f.p, diary: 'lumbridge', tier: 'elite', complete: false};
    PM.emitCustomEvent('diary:is-complete', query);
    assert.equal(query.complete, true);
    const reward = {player: f.p, diary: 'lumbridge', tier: 'elite', claimed: false};
    PM.emitCustomEvent('diary:is-reward-claimed', reward);
    assert.equal(reward.claimed, false);
    use(f, 'Buy-items');
    assert.equal(core.ShopManager.getOpenShop(f.p).name, named('Full'));
    await payment(f, 7453, 65, 60);
  });
  await t.test('claimed elite uses the reward API and actual discounted equipment payment', async child => {
    const f = setup(child, 5, 255);
    f.p.setAttribute('achievement-diaries:tasks', {lumbridge: diary.tiers.elite.tasks.map(task => task.key)});
    f.p.setAttribute('achievement-diaries:rewards', {lumbridge: ['elite']});
    const query = {player: f.p, diary: 'lumbridge', tier: 'elite', claimed: false};
    PM.emitCustomEvent('diary:is-reward-claimed', query);
    assert.equal(query.claimed, true);
    use(f, 'Buy-items');
    assert.equal(core.ShopManager.getOpenShop(f.p).name, named('Elite Diary'));
    await payment(f, 7453, 52, 60);
  });
  for (const elite of [false, true]) await t.test(`${elite ? 'claimed elite' : 'normal'} full food quotes and real payment round once`, async child => {
    const f = setup(child, 5, 255);
    if (elite) f.p.setAttribute('achievement-diaries:rewards', {lumbridge: ['elite']});
    use(f, 'Buy-food');
    assert.equal(core.ShopManager.getOpenShop(f.p).name, named(elite ? 'food, full, diary' : 'food, full'));
    await payment(f, I.BUCKET_OF_MILK, elite ? 6 : 7, 50);
    await payment(f, I.CHOCOLATE_BAR, elite ? 10 : 13, 50);
    await payment(f, I.POT_OF_FLOUR, elite ? 10 : 13, 10);
    await payment(f, I.EGG, elite ? 4 : 5, 50);
  });
  for (const elite of [false, true]) await t.test(`${elite ? 'claimed elite' : 'normal'} chest buyback pays 40 percent without a diary discount`, async child => {
    const f = setup(child, 5, 255), inv = f.p.getInventory();
    if (elite) f.p.setAttribute('achievement-diaries:rewards', {lumbridge: ['elite']});
    use(f, 'Buy-items');
    inv.add(new core.Item(7433), false);
    assert.equal(await refund(f, 7433), 14, 'literal wooden spoon buyback quote');
    assert.equal(line(f, 7433)?.amount, 10);
    await sale(f, 7433);
    assert.equal(inv.getAmount(7433), 0);
    assert.equal(inv.getAmount(I.COINS), 14);
    assert.equal(line(f, 7433)?.amount, 11);
    use(f, 'Buy-food');
    inv.add(new core.Item(I.BUCKET_OF_MILK), false);
    assert.equal(await refund(f, I.BUCKET_OF_MILK), 2, 'literal milk buyback quote');
    assert.equal(line(f, I.BUCKET_OF_MILK)?.amount, 50);
    await sale(f, I.BUCKET_OF_MILK);
    assert.equal(inv.getAmount(I.BUCKET_OF_MILK), 0);
    assert.equal(inv.getAmount(I.COINS), 16);
    assert.equal(line(f, I.BUCKET_OF_MILK)?.amount, 51);
  });
  await t.test('registered price hooks preserve earlier zero and customized quotes and unrelated shops', child => {
    const f = setup(child, 5, 255);
    const shop = defs.find(def => def.getName() === named('Full'));
    for (const price of [0, 17]) {
      const event = {player: f.p, shopId: shop.getId(), shopName: shop.getName(), currency: 'COINS', itemId: 7453, price};
      PM.emitCustomEvent('shop:buy-price', event);
      assert.equal(event.price, price, 'do not re-price a customized earlier hook result');
    }
    const zeroSale = {player: f.p, shopId: shop.getId(), shopName: shop.getName(), currency: 'COINS', itemId: 7433, buyPrice: 35, price: 0};
    PM.emitCustomEvent('shop:sell-price', zeroSale);
    assert.equal(zeroSale.price, 0, 'preserve an earlier free-shop no-buyback policy');
    const other = {player: f.p, shopId: -1, shopName: 'Unrelated shop', currency: 'COINS', itemId: 7453, price: 17};
    PM.emitCustomEvent('shop:buy-price', other);
    assert.equal(other.price, 17);
    const otherSale = {...other, buyPrice: 50};
    PM.emitCustomEvent('shop:sell-price', otherSale);
    assert.equal(otherSale.price, 17);
  });
  await t.test('insufficient money and a full inventory preserve actual currency and stock', async child => {
    const f = setup(child, 5, 255), inv = f.p.getInventory();
    use(f, 'Buy-items');
    inv.add(new core.Item(I.COINS, 64), false);
    await buy(f, 7453);
    assert.equal(inv.getAmount(I.COINS), 64);
    assert.equal(inv.getAmount(7453), 0);
    assert.equal(line(f, 7453)?.amount, 60);
    inv.add(new core.Item(I.COINS, 100), false);
    for (let i = 0; i < 27; i++) inv.add(new core.Item(I.RAKE), false);
    assert.equal(inv.getFreeSlots(), 0);
    await buy(f, 7453);
    assert.equal(inv.getAmount(I.COINS), 164);
    assert.equal(inv.getAmount(7453), 0);
    assert.equal(line(f, 7453)?.amount, 60);
  });
  await t.test('fresh save restoration retains nonconsecutive rescue tier and food selection', child => {
    const f = setup(child, 4, 129);
    PM.emitPlayerLogout({player: f.p, username: f.p.getUsername()});
    const g = actor(child);
    child.after(() => core.TaskManager.cancelTasks(g.p));
    PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
    PM.emitPlayerLogin({player: g.p, username: g.p.getUsername(), isNewAccount: false});
    g.p.needsPlacement = false;
    assert.equal(g.p.getAttribute(FLAGS), 129);
    assert.equal(quest.getStage(g.p), 4);
    use(g, 'Buy-items');
    assert.equal(core.ShopManager.getOpenShop(g.p).name, named('2 Subquests'));
    use(g, 'Buy-food');
    assert.equal(core.ShopManager.getOpenShop(g.p).name, named('food, 2 Subquests'));
  });
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


test('native Lowe purchases charge only for credited ordinary arrows', async t => {
  const ARROW = core.ItemIdentifiers.BRONZE_ARROW, COINS = core.ItemIdentifiers.COINS;
  const iron = require('../plugins/modes/ironman/Common.Ironman');
  const relics = require('../plugins/modes/leaguerelics/Common.LeagueRelics');
  assert.equal(ARROW, 882); assert.equal(core.ItemDefinition.forId(ARROW).isStackable(), true);
  for (const mode of ['room', 'last stack space', 'full pack without arrows', 'capped stack', 'buy five with two spaces', 'tagged stack with room', 'tagged stack full pack', 'full pack with exact coins']) {
    await t.test(mode, async child => {
      // Existing native actor, loader, stock reset and ClientConnection; no fake stock/capacity.
      core.ShopManager.reload();
      const f = actor(child), p = f.p, inv = p.getInventory();
      PM.emitPlayerLogin({player:p, username:p.getUsername()}); p.closeInterruptibleInterfaces();
      assert.equal(iron.isIron(p), false); assert.equal(relics.leagueOf(p), null);
      inv.add(new core.Item(COINS, mode === 'full pack with exact coins' ? 1 : 10000), false);
      if (mode === 'last stack space' || mode === 'capped stack') inv.add(new core.Item(ARROW, CAP - 1), false);
      if (mode === 'buy five with two spaces') inv.add(new core.Item(ARROW, CAP - 2), false);
      if (mode.startsWith('tagged stack')) inv.add(new core.Item(ARROW, 3, {source:'tagged'}), false);
      if (mode === 'full pack without arrows' || mode === 'tagged stack full pack' || mode === 'full pack with exact coins') while (inv.getFreeSlots() > 0) inv.add(new core.Item(core.ItemIdentifiers.RAKE), false);
      const at = p.getLocation(), npc = core.NPC.create(core.NpcIdentifiers.LOWE, new core.Location(at.getX() + 1, at.getY(), at.getZ()));
      assert.equal(core.World.getNpcs().add(npc), true);
      const definition = npc.getCurrentDefinition(p); assert.equal(definition.getName(), 'Lowe');
      const trade = definition.getActions().indexOf('Trade') + 1; assert.equal(trade, 3);
      child.after(() => {
        PM.emitPlayerDisconnect({player:p, username:p.getUsername()});
        core.TaskManager.cancelTasks(p); core.World.getNpcs().remove(npc);
        for (const ground of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) core.ItemOnGroundManager.deregister(ground);
      });
      const stores = id => ({inventory:inv.getAmount(id), equipment:p.getEquipment().getAmount(id),
        bank:p.getBanks().reduce((n,b,tab) => n + (b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0),
        floor:core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername()
          && g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === id).reduce((n,g) => n + g.getItem().getAmount(), 0)});
      const owned = id => Object.values(stores(id)).reduce((n,amount) => n + amount, 0);
      const xp = () => core.Skill.values().map(skill => p.getSkillManager().getExperience(skill));
      let turns = 0;
      const turn = () => {
        assert.ok(++turns <= 12, 'bounded native input/task/movement phase budget'); p.resetUpdating();
        core.TaskManager.process(); f.c.processTurnPackets();
        const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit(); if (q.hasPendingWork()) q.process();
        core.TaskManager.processWalkTo(p.getIndex());
      };
      const send = async packet => { await f.c.dispatch([packet]); turn(); };
      if (mode === 'capped stack') {
        core.ItemOnGroundManager.registerLocation(p, new core.Item(ARROW), at.clone());
        assert.equal(stores(ARROW).floor, 1);
        await send({type:'ground_item_action', itemId:ARROW, x:at.getX(), y:at.getY(), option:'Take', optionIndex:3});
        for (let n = 0; n < 4 && stores(ARROW).floor; n++) turn();
        assert.equal(inv.getAmount(ARROW), CAP, 'actual native Take fills the ordinary arrow stack'); assert.equal(stores(ARROW).floor, 0);
      }
      const expectedSpace = mode === 'capped stack' || mode === 'full pack without arrows' || mode === 'tagged stack full pack' || mode === 'full pack with exact coins' ? 0 : mode === 'buy five with two spaces' ? 2 : 1;
      assert.equal(inv.getAddableAmount(new core.Item(ARROW, mode === 'buy five with two spaces' ? 5 : 1)), expectedSpace);
      const beforeTrade = {coins:stores(COINS), arrows:stores(ARROW), rake:stores(core.ItemIdentifiers.RAKE), xp:xp()};
      await send({type:'npc_option', index:npc.getIndex(), clickType:trade});
      const view = core.ShopManager.getOpenShop(p); assert.ok(view); assert.equal(view.name, "Lowe's Archery Emporium"); assert.equal(core.ShopDefinition.forId(1221).getName(), view.name);
      assert.equal(p.getInterfaceId(), 300);
      const sender = p.getPacketSender(), mount = sender.subInterfaceTargets.get(300);
      assert.ok(mount); assert.equal(sender.getSubInterfaceAt((161 << 16) | 16), mount);
      const slot = view.stock.findIndex(row => row.itemId === ARROW); assert.ok(slot >= 0);
      const quote = view.stock[slot].price, stockBefore = view.stock[slot].amount;
      const requested = mode === 'buy five with two spaces' ? 5 : 1;
      assert.ok(Number.isInteger(quote) && quote > 0 && quote * requested <= inv.getAmount(COINS), 'actual displayed positive native quote and affordable funds');
      if (mode === 'full pack with exact coins') assert.equal(inv.getAmount(COINS), quote, 'payment would consume the coin stack');
      assert.equal(stockBefore, 2000, 'ordinary authored stock after existing runtime reload');
      assert.deepEqual({coins:stores(COINS), arrows:stores(ARROW), rake:stores(core.ItemIdentifiers.RAKE), xp:xp()}, beforeTrade);
      const before = {coins:stores(COINS), arrows:stores(ARROW), rake:stores(core.ItemIdentifiers.RAKE), xp:xp()}, coinBefore = owned(COINS), arrowBefore = owned(ARROW);
      await send({type:'widget_action', widgetId:(300 << 16) | 16, groupId:300, childId:16, buttonNum:requested === 5 ? 3 : 2, slot:slot + 1, itemId:ARROW});
      const credited = owned(ARROW) - arrowBefore, debit = coinBefore - owned(COINS), stockAfter = core.ShopManager.shopsById.get(1221).stock.get(ARROW) ?? 0;
      const after = {coins:stores(COINS), arrows:stores(ARROW), rake:stores(core.ItemIdentifiers.RAKE), xp:xp(), stockAfter}, details = JSON.stringify({mode, quote, requested, before, after});
      // First target: charge for actual owned credit; an owned-floor delivery also counts.
      assert.equal(debit, quote * credited, 'native buy fee/item conservation: ' + details);
      assert.equal(stockBefore - stockAfter, credited, 'native stock debit equals owned credit: ' + details);
      assert.ok(Number.isInteger(credited) && credited >= 0 && credited <= requested, details);
      if (mode === 'room' || mode === 'last stack space' || mode === 'tagged stack with room') assert.equal(credited, 1, details);
      if (mode === 'full pack without arrows' || mode === 'capped stack' || mode === 'tagged stack full pack' || mode === 'full pack with exact coins') assert.equal(credited, 0, details);
      if (mode === 'buy five with two spaces') assert.equal(credited, 2, details);
      if (mode.startsWith('tagged stack')) {
        const tagged = inv.getItems().find(item => item.getId() === ARROW && item.getMeta()?.source === 'tagged');
        assert.ok(tagged); assert.equal(tagged.getAmount(), 3);
      }
      assert.deepEqual(stores(core.ItemIdentifiers.RAKE), before.rake); assert.deepEqual(xp(), before.xp);
    });
  }
});
