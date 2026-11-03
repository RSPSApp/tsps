const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const { Bank } = core;
const { Player } = require('../dist/game/entity/impl/player/Player');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const Common = require('../plugins/items/elementaltomes/Common.ElementalTomes');
const TomeBank = require('../plugins/items/elementaltomes/Bank.ElementalTomes');
const ATTRIBUTE = 'elemental-tomes:bank-charge-targets';
const handlers = new Map(), persisted = [];
before(async()=>{
  await CachePipeline.initialize(process.cwd());
  Common.initialize({core});
  TomeBank.initialize({core});
  TomeBank.attach({persistAttribute:(...args)=>{persisted.push(args);PlayerSave.persistAttribute(...args);},onCustomEvent:(name,handler)=>handlers.set(name,handler)});
});
function fixture(t) {
  const p = new Player(null), messages = [], events = [];
  t.mock.method(p,'getSession',()=>({sendClientPacket:()=>true}));
  t.mock.method(p,'sendMessage',message=>messages.push(message));
  t.mock.method(core.Sounds,'sendSound',()=>{});
  t.mock.method(PluginManager,'emitCustomEvent',(name,event)=>{
    events.push({name,event}); handlers.get(name)?.(event);
  });
  p.setStatus(core.PlayerStatus.BANKING); p.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  return {p,messages,events};
}
function book(p,id,charges=0,pageId=null,amount=1,tab=0) {
  const item = new core.Item(id,amount);
  if (charges) Common.set(item,Common.getDefinition(id),charges,pageId);
  p.getBank(tab).add(item,false);
  return p.getBank(tab).getValidItems().find(held=>held.getId()===item.getId());
}
function configure(p,item,target,tab=0,choice=null) {
  const event={player:p,item,tab,slot:p.getBank(tab).getItems().indexOf(item),op:9,handled:false};
  handlers.get(Bank.ITEM_OP_EVENT)(event);
  if (choice) p.getDialogueManager().getCurrent().execute(choice);
  if (target !== undefined) p.getEnteredAmountAction()?.execute(target);
  return event;
}
function withdraw(p,item,amount=1,tab=0) {
  Bank.withdraw(p,item.getId(),p.getBank(tab).getItems().indexOf(item),amount,tab);
  return p.getInventory().getValidItems().filter(held=>Common.getDefinition(held.getId()));
}

for (const [tab, charges, search] of [[0,99,false],[1,150,true]]) {
  test(`a changed charged tome refills its original placeholder in tab ${tab}${search ? ' while searching' : ''}`,t=>{
    const {p}=fixture(t);
    p.setPlaceholders(true);
    const item=book(p,core.ItemIdentifiers.TOME_OF_FIRE,100,core.ItemIdentifiers.BURNT_PAGE,1,tab);
    const bank=p.getBank(tab), slot=bank.getItems().indexOf(item);
    assert.ok(item.getDefinition().getPlaceholderId()>0,'the charged item has a native cache placeholder');
    const [taken]=withdraw(p,item,1,tab);
    const placeholder=bank.getItems()[slot];
    assert.equal(placeholder.getAmount(),0);
    Common.set(taken,Common.getDefinition(taken.getId()),charges,core.ItemIdentifiers.BURNT_PAGE);
    if(search)Bank.search(p,'tome');
    Bank.deposits(p,taken.getId(),p.getInventory().getItems().indexOf(taken),1);
    assert.equal(bank.getValidItems().length,1,'a new charge count cannot leave the old placeholder behind');
    assert.equal(bank.getItems()[slot].getAmount(),1);
    assert.deepEqual(Common.read(bank.getItems()[slot]),{charges,pageId:core.ItemIdentifiers.BURNT_PAGE});
    assert.notEqual(bank.getItems()[slot],placeholder,'refilling does not revive the removed stack identity');
    assert.equal(p.getInventory().getAmount(taken.getId()),0);
    const restored=new Player(null);
    PlayerSave.fromPlayer(p).applyToPlayer(restored);
    assert.deepEqual(Common.read(restored.getBank(tab).getItems()[slot]),{charges,pageId:core.ItemIdentifiers.BURNT_PAGE});
  });
}

test('a full bank accepts changed item metadata into its reserved placeholder',t=>{
  const {p}=fixture(t);
  p.setPlaceholders(true);
  const item=book(p,core.ItemIdentifiers.TOME_OF_FIRE,100,core.ItemIdentifiers.BURNT_PAGE);
  const [taken]=withdraw(p,item);
  Common.set(taken,Common.getDefinition(taken.getId()),99,core.ItemIdentifiers.BURNT_PAGE);
  handlers.set(Bank.CAPACITY_EVENT,event=>{event.capacity=1;});
  t.after(()=>handlers.delete(Bank.CAPACITY_EVENT));
  assert.equal(p.getBank(0).getFreeSlots(),0);
  assert.equal(p.getBank(0).getAddableAmount(taken),1,'capacity planning recognizes a reusable empty placeholder');
  assert.equal(p.getBank(0).canTake(taken),true);
  Bank.deposits(p,taken.getId(),p.getInventory().getItems().indexOf(taken),1);
  assert.equal(p.getInventory().getAmount(taken.getId()),0);
  assert.equal(p.getBank(0).getValidItems().length,1);
  assert.equal(Common.read(p.getBank(0).getItems()[0]).charges,99);
});

test('an existing live matching charge stack takes priority over a stale placeholder',t=>{
  const {p}=fixture(t);
  p.setPlaceholders(true);
  const item=book(p,core.ItemIdentifiers.TOME_OF_FIRE,100,core.ItemIdentifiers.BURNT_PAGE);
  const [taken]=withdraw(p,item);
  Common.set(taken,Common.getDefinition(taken.getId()),99,core.ItemIdentifiers.BURNT_PAGE);
  const bank=p.getBank(0), placeholder=bank.getItems()[0];
  const same=taken.clone(), different=taken.clone();
  Common.set(different,Common.getDefinition(different.getId()),80,core.ItemIdentifiers.BURNT_PAGE);
  bank.setItem(1,same);bank.setItem(2,different);
  Bank.deposits(p,taken.getId(),p.getInventory().getItems().indexOf(taken),1);
  assert.equal(bank.getItems()[0],placeholder);
  assert.equal(placeholder.getAmount(),0,'an earlier empty placeholder cannot split an existing live stack');
  assert.equal(bank.getItems()[1],same);
  assert.equal(same.getAmount(),2);
  assert.equal(bank.getItems()[2],different);
  assert.equal(different.getAmount(),1);
  assert.deepEqual([Common.read(same).charges,Common.read(different).charges],[99,80]);
});
test('bank exposes an event for actual successfully withdrawn inventory instances', () => {
  assert.equal(Bank.WITHDRAWN_ITEMS_EVENT, 'bank:withdrawn-items');
});
test('configuration persists per-element preferences and spends nothing until withdrawal',t=>{
  const {p}=fixture(t);
  assert.deepEqual(persisted,[[ATTRIBUTE,{}]]);
  const item=book(p,25576); p.getBank(0).add(new core.Item(25578,10),false);
  assert.equal(configure(p,item,100).handled,true);
  assert.equal(Common.read(item).charges,0); assert.equal(p.getBank(0).getAmount(25578),10);
  const serialized=JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p).attributes[ATTRIBUTE]));
  assert.deepEqual(serialized,{water:{target:100,pageId:25578}});
  p.setAttribute(ATTRIBUTE,serialized);
  const [taken]=withdraw(p,item);
  assert.equal(Common.read(taken).charges,100); assert.equal(p.getBank(0).getAmount(25578),5);
});
test('all page types top up actual independent withdrawn instances across tabs',t=>{
  for (const [empty,page,choice] of [[20716,20718,null],[20716,28931,2],[25576,25578,null],[30066,30068,null]]) {
    const {p,events}=fixture(t);
    const item=book(p,empty,0,null,2);
    p.getBank(1).add(new core.Item(page,7),false);
    if(choice)p.getBank(0).add(new core.Item(20718,3),false);
    configure(p,item,60,0,choice);
    const taken=withdraw(p,item,2);
    assert.equal(taken.length,2);
    for(const held of taken)assert.deepEqual(Common.read(held),{charges:60,pageId:page});
    assert.notEqual(taken[0],taken[1]); assert.equal(p.getBank(0).getAmount(page)+p.getBank(1).getAmount(page),1);
    assert.equal(events.filter(e=>e.name===Bank.WITHDRAWN_ITEMS_EVENT).length,1);
  }
});
test('partial charges survive, never mix fire pages, never reduce above target or exceed capacity',t=>{
  const {p}=fixture(t);
  const item=book(p,20716,19991,20718); p.getBank(0).add(new core.Item(20718,100),false);
  configure(p,item,20000); const [taken]=withdraw(p,item);
  assert.equal(Common.read(taken).charges,19991); assert.equal(p.getBank(0).getAmount(20718),100);
  const other=book(p,20716,41,20718); configure(p,other,40);
  withdraw(p,other); assert.equal(p.getBank(0).getAmount(20718),100);
  p.setAttribute(ATTRIBUTE,{fire:{target:100,pageId:28931}});
  const partial=book(p,20716,1,20718); p.getBank(0).add(new core.Item(28931,50),false);
  const takenPartial=withdraw(p,partial).find(i=>Common.read(i).charges===101);
  assert.ok(takenPartial); assert.equal(Common.read(takenPartial).pageId,20718);
  assert.equal(p.getBank(0).getAmount(28931),50);
});
test('insufficient pages produce only affordable charges and a message; zero disables',t=>{
  const {p,messages}=fixture(t); const item=book(p,30066);
  p.getBank(0).add(new core.Item(30068,2),false); configure(p,item,100);
  const [taken]=withdraw(p,item); assert.equal(Common.read(taken).charges,40);
  assert.ok(messages.some(m=>m.includes('enough matching pages')));
  const next=book(p,30066); p.getBank(0).add(new core.Item(30068,3),false);
  configure(p,next,0); withdraw(p,next);
  assert.equal(p.getBank(0).getAmount(30068),3);
});
test('invalid or stale callbacks cannot save a setting or spend pages',t=>{
  const {p}=fixture(t); const item=book(p,25576); p.getBank(0).add(new core.Item(25578,20),false);
  configure(p,item,undefined); const action=p.getEnteredAmountAction();
  for(const value of [-1,20001,Infinity,NaN,1.5,'20'])action.execute(value);
  assert.equal(p.getAttribute(ATTRIBUTE),undefined);
  p.setStatus(core.PlayerStatus.NONE); action.execute(100);
  assert.equal(p.getAttribute(ATTRIBUTE),undefined);
  p.setStatus(core.PlayerStatus.BANKING); p.getBank(0).getItems()[0]=item.clone(); action.execute(100);
  assert.equal(p.getAttribute(ATTRIBUTE),undefined); assert.equal(p.getBank(0).getAmount(25578),20);
});
test('zero passes the native amount contract and superseded prompts cannot overwrite newer configuration',t=>{
  const {p}=fixture(t); const item=book(p,25576);
  configure(p,item,undefined); const old=p.getEnteredAmountAction();
  assert.equal(old.acceptsZero,true);
  configure(p,item,100); old.execute(200);
  assert.equal(p.getAttribute(ATTRIBUTE).water.target,100);
});
test('closed bank and full inventory do not emit withdrawal events; notes and unrelated items never charge',t=>{
  const {p,events}=fixture(t);const item=book(p,25576);p.getBank(0).add(new core.Item(25578,20),false);configure(p,item,100);
  const withdrawals=()=>events.filter(e=>e.name===Bank.WITHDRAWN_ITEMS_EVENT).length;
  p.setStatus(core.PlayerStatus.NONE);withdraw(p,item);assert.equal(withdrawals(),0);
  p.setStatus(core.PlayerStatus.BANKING);
  p.getInventory().add(new core.Item(4151,28),false);withdraw(p,item);assert.equal(withdrawals(),0);
  p.getInventory().resetItems();p.setNoteWithdrawal(true);withdraw(p,item);
  assert.equal(p.getBank(0).getAmount(25578),20);assert.equal(p.getInventory().getAmount(25577),1);
  p.setNoteWithdrawal(false);const unrelated=book(p,4151);withdraw(p,unrelated);
  assert.equal(p.getBank(0).getAmount(25578),20);
});
