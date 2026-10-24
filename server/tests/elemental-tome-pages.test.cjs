const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { UpdateFlag } = require('../dist/game/model/UpdateFlag');
const Common = require('../plugins/items/elementaltomes/Common.ElementalTomes');
const Pages = require('../plugins/items/elementaltomes/Pages.ElementalTomes');
const actions = new Map(), uses = [];
before(async () => {
  await CachePipeline.initialize(); Common.initialize({core}); Pages.initialize({core});
  Pages.attach({core, onItemAction(name,ops){actions.set(name,ops);},
    onItemOnItem(a,b,fn,options){uses.push({a,b,fn,options});}});
});
function setup(id=20716,worn=false) {
  const messages=[]; let input,menu;
  const player={getUsername:()=> 'tome-pages-test',sendMessage:m=>messages.push(m),
    getUpdateFlag:()=>new UpdateFlag(),getInventory:()=>inventory,getEquipment:()=>equipment,
    getPacketSender:()=>({sendItemContainer(){},sendEnterAmountPrompt(){},sendInterfaceRemoval(){}}),
    setEnteredAmountAction(action){input=action;},getDialogueManager:()=>({startDialogues(chain){menu=chain;}})};
  const inventory=new Inventory(player),equipment=new core.Equipment(player),item=new core.Item(id);
  (worn?equipment:inventory).getItems()[worn?core.Equipment.SHIELD_SLOT:0]=item;
  return {player,inventory,equipment,item,messages,enter(amount){input.execute(amount);},get input(){return input;},get menu(){return menu;}};
}
function use(s,pageId=20718) {
  const page=new core.Item(pageId,1001);s.inventory.getItems()[1]=page;
  const handler=uses.find(x=>x.a===core.ItemDefinition.forId(pageId).getName()&&x.b===core.ItemDefinition.forId(s.item.getId()).getName());
  assert.ok(handler,'native page/tome name pair registered');
  return handler.fn({player:s.player,usedItem:page,usedItemId:pageId,usedWithItem:s.item,usedWithItemId:s.item.getId()});
}
test('native item-on-item adds integer pages, clamps capacity, and never mixes page kinds',()=>{
  const s=setup();use(s);s.enter(1001);
  assert.deepEqual(Common.read(s.item),{charges:20000,pageId:20718});assert.equal(s.inventory.getAmount(20718),1);
  use(s,28931);s.enter(1);assert.deepEqual(Common.read(s.item),{charges:20000,pageId:20718});assert.equal(s.inventory.getAmount(28931),1001);
});
test('every element and searing fire accept only actual matching pages',()=>{
  for(const [empty,page,charged] of [[20716,28931,20714],[25576,25578,25574],[30066,30068,30064]]) {
    const s=setup(empty);use(s,page);s.enter(2);assert.equal(s.item.getId(),charged);
    assert.deepEqual(Common.read(s.item),{charges:40,pageId:page});assert.equal(s.inventory.getAmount(page),999);
  }
  const s=setup(),fn=uses[0].fn;
  for(const page of [20719,28932,25578]) {const other=new core.Item(page,2);s.inventory.getItems()[1]=other;
    assert.equal(fn({player:s.player,usedItem:other,usedWithItem:s.item}),false);}
});
test('callbacks reject moved, equipped, replaced, changed, and missing-page inventory state',()=>{
  for(const mutate of [s=>{s.inventory.getItems()[2]=s.item;s.inventory.getItems()[0]=new core.Item(-1,0);},
    s=>{s.equipment.getItems()[5]=s.item;s.inventory.getItems()[0]=new core.Item(-1,0);},
    s=>s.inventory.getItems()[0]=s.item.clone(),s=>Common.set(s.item,Common.getDefinition(s.item.getId()),20,28931),
    s=>s.inventory.getItems()[1]=new core.Item(-1,0)]) {
    const s=setup();use(s);mutate(s);const before=Common.read(s.item);s.enter(2);assert.deepEqual(Common.read(s.item),before);
  }
  for(const amount of [NaN,Infinity,1.5,-1,0,'2']) {const s=setup();use(s);s.enter(amount);assert.equal(Common.read(s.item).charges,0);}
});
test('Check and Pages reject notes and validate real inventory/equipment ownership',()=>{
  for(const worn of [false,true]) {const s=setup(20714,worn);Common.set(s.item,Common.getDefinition(20714),39,20718);
    const ops=actions.get(core.ItemDefinition.forId(20714).getName());assert.equal(ops.Check({player:s.player,item:s.item}),true);
    assert.match(s.messages.at(-1),/39/);assert.equal(ops.Pages({player:s.player,item:s.item}),true);assert.ok(s.menu);}
  const s=setup(20717),ops=actions.get(core.ItemDefinition.forId(20714).getName());
  assert.equal(ops.Check({player:s.player,item:s.item}),false);assert.equal(ops.Pages({player:s.player,item:s.item}),false);
});
function open(s) {
  actions.get(core.ItemDefinition.forId(s.item.getId()).getName()).Pages({player:s.player,item:s.item});
  return s.menu.getDialogues().get(0);
}
test('Pages menu adds while worn and full removal returns only whole original pages',()=>{
  for(const [id,page,charges,refund] of [[20714,20718,39,1],[20714,28931,41,2],[25574,25578,19,0],[30064,30068,40,2]]) {
    for(const worn of [false,true]) {
      const s=setup(id,worn),definition=Common.getDefinition(id);Common.set(s.item,definition,charges,page);
      const menu=open(s);menu.execute(definition.specialPageId?3:2);
      assert.equal(s.item.getId(),definition.emptyId);assert.equal(Common.read(s.item).charges,0);
      assert.equal(s.inventory.getAmount(page),refund);
    }
  }
  const s=setup(25576,true);s.inventory.getItems()[0]=new core.Item(25578,5);
  open(s).execute(1);s.enter(3);assert.equal(Common.read(s.item).charges,60);assert.equal(s.inventory.getAmount(25578),2);
});
test('full inventories and stack overflow cannot destroy charges or refund pages',()=>{
  for(const worn of [false,true]) for(const stack of [null,2147483647,2147483646]) {
    const s=setup(20714,worn);Common.set(s.item,Common.getDefinition(20714),40,20718);
    for(let i=0;i<28;i++) if(s.inventory.getItems()[i]!==s.item) s.inventory.getItems()[i]=new core.Item(4151);
    if(stack!==null) s.inventory.getItems()[1]=new core.Item(20718,stack);
    open(s).execute(3);assert.equal(Common.read(s.item).charges,40);
    assert.equal(s.inventory.getAmount(20718),stack??0);
  }
  const s=setup(20714);Common.set(s.item,Common.getDefinition(20714),40,20718);
  for(let i=1;i<28;i++) s.inventory.getItems()[i]=new core.Item(4151);
  s.inventory.getItems()[1]=new core.Item(20718,2147483645);open(s).execute(3);
  assert.equal(Common.read(s.item).charges,0);assert.equal(s.inventory.getAmount(20718),2147483647);
});
test('page menus revalidate both the modal and subsequent count callback',()=>{
  const s=setup(20714);Common.set(s.item,Common.getDefinition(20714),40,20718);
  const menu=open(s);s.inventory.getItems()[0]=new core.Item(-1,0);menu.execute(3);
  assert.equal(Common.read(s.item).charges,40);assert.equal(s.inventory.getAmount(20718),0);
  const worn=setup(20716,true);worn.inventory.getItems()[0]=new core.Item(20718,2);
  open(worn).execute(1);worn.equipment.getItems()[5]=new core.Item(-1,0);worn.inventory.getItems()[2]=worn.item;
  worn.enter(2);assert.equal(Common.read(worn.item).charges,0);assert.equal(worn.inventory.getAmount(20718),2);
});
test('reverse item use, remaining capacity, changing page supplies and replayed callbacks conserve items',()=>{
  const s=setup();const page=new core.Item(20718,5);s.inventory.getItems()[1]=page;
  Common.set(s.item,Common.getDefinition(20716),19960,20718);
  const fn=uses[0].fn;
  assert.equal(fn({player:s.player,usedItem:s.item,usedWithItem:page}),true);
  page.setAmount(1);s.enter(50);s.enter(50);
  assert.equal(Common.read(s.item).charges,19980);assert.equal(s.inventory.getAmount(20718),0);
  const partial=setup(20714);Common.set(partial.item,Common.getDefinition(20714),19999,20718);
  use(partial);assert.equal(partial.input,undefined);assert.equal(Common.read(partial.item).charges,19999);
  const other=setup(20716);assert.equal(fn({player:other.player,usedItem:s.item,usedWithItem:page}),false);
});
test('fire Check identifies burnt and searing pages explicitly',()=>{
  for(const [id,page,kind] of [[20714,20718,'burnt'],[20714,28931,'searing']]) {
    const s=setup(id);Common.set(s.item,Common.getDefinition(id),39,page);
    actions.get(core.ItemDefinition.forId(id).getName()).Check({player:s.player,item:s.item});
    assert.match(s.messages.at(-1),new RegExp(`39.*${kind}`));
  }
});
test('a rejected mixed-page interaction invalidates the earlier amount prompt',()=>{
  const s=setup(20714);Common.set(s.item,Common.getDefinition(20714),20,20718);
  use(s,20718);const previous=s.input;const special=new core.Item(28931,2);s.inventory.getItems()[2]=special;
  uses[0].fn({player:s.player,usedItem:special,usedWithItem:s.item});previous.execute(1);
  assert.equal(Common.read(s.item).charges,20);assert.equal(s.inventory.getAmount(28931),2);
});
