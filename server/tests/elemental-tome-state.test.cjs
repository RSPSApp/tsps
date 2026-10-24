// Run after yarn build: node --test tests/elemental-tome-state.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const { Item, Equipment, ItemDefinition } = core;
const Common = require('../plugins/items/elementaltomes/Common.ElementalTomes');
before(async () => {
  await CachePipeline.initialize();
  Common.initialize({ core });
});

test('recognizes wearable cache variants and excludes noted and placeholder copies', () => {
  assert.equal(typeof Common.getDefinition, 'function', 'tome definition lookup must exist');
  for (const [id, element] of [[20714,'fire'],[20716,'fire'],[25574,'water'],[25576,'water'],[30064,'earth'],[30066,'earth']]) {
    assert.equal(ItemDefinition.forId(id).getEquipmentType().getSlot(), 5);
    assert.equal(ItemDefinition.forId(id).isNoted(), false);
    assert.equal(Common.getDefinition(id).element, element);
  }
  for (const id of [27358,20715,20717,25575,25577,30065,30067,20718,28931,-1,0]) assert.equal(Common.getDefinition(id), null);
  for (const id of [20715,25575,30065,20719,25579,30069,28932]) assert.equal(CacheDefinitions.getItem(id).placeholderTemplate, 14401);
  for (const id of [20717,25577,30067]) assert.equal(ItemDefinition.forId(id).isNoted(), true);
});

test('raw charged variants never mint free charges and default to ordinary pages', () => {
  for (const [id,pageId] of [[20714,20718],[25574,25578],[30064,30068],[20716,20718]]) {
    assert.deepEqual(Common.read(new Item(id)), { charges:0, pageId });
  }
});

test('rejects malformed, over-capacity and wrong-page metadata without changing the item', () => {
  for (const raw of [null, 12, [], {}, {charges:-1,pageId:20718},{charges:20001,pageId:20718},{charges:1.5,pageId:20718},{charges:Infinity,pageId:20718},{charges:NaN,pageId:20718},{charges:'20',pageId:20718},{charges:20,pageId:25578},{charges:20,pageId:20719},{charges:20,pageId:28932},{charges:20,pageId:20717}]) {
    const item = new Item(20714, 1, { 'elemental-tomes':raw });
    const before = item.clone();
    assert.deepEqual(Common.read(item), {charges:0,pageId:20718});
    assert.ok(item.equals(before));
  }
  for (const [id,pageId] of [[20716,20718],[20716,28931],[27358,20718],[27358,28931],[20717,20718],[20715,20718]]) {
    assert.equal(Common.read(new Item(id,1,{'elemental-tomes':{charges:20,pageId}})).charges, 0);
  }
});

test('sets capacity, switches ordinary/searing metadata, then removes metadata on empty', () => {
  const item = new Item(20716,1,{preset:true});
  const definition = Common.getDefinition(20716);
  Common.set(item,definition,20000,20718);
  assert.equal(item.getId(),20714);
  assert.deepEqual(Common.read(item),{charges:20000,pageId:20718});
  Common.set(item,definition,21,28931);
  assert.equal(item.getId(),20714);
  assert.deepEqual(Common.read(item),{charges:21,pageId:28931});
  assert.equal(Common.wholePages(Common.read(item)),1);
  Common.set(item,definition,0,28931);
  assert.equal(item.getId(),20716);
  assert.deepEqual(item.getMeta(),{preset:true});
});

test('searing charges preserve native charged-tome Check, Pages and Wield actions', () => {
  const item = new Item(20716);
  Common.set(item,Common.getDefinition(20716),20,28931);
  const actions = core.CacheDefinitions.getItem(item.getId()).inventoryActions;
  for (const action of ['Check','Pages','Wield']) assert.ok(actions.includes(action), action);
  assert.equal(item.getId(),20714);
  assert.deepEqual(Common.read(item),{charges:20,pageId:28931});
});

test('ordinary fire tome reads either page kind and rejects nonstandard charged variants', () => {
  for (const pageId of [20718,28931]) {
    assert.deepEqual(Common.read(new Item(20714,1,{'elemental-tomes':{charges:20,pageId}})),{charges:20,pageId});
    const unsupported = new Item(27358,1,{'elemental-tomes':{charges:20,pageId},other:true});
    assert.deepEqual(Common.read(unsupported),{charges:0,pageId:null});
    assert.throws(() => Common.set(unsupported,Common.getDefinition(20714),20,pageId));
    assert.equal(unsupported.getId(),27358);
    assert.deepEqual(unsupported.getMeta(),{'elemental-tomes':{charges:20,pageId},other:true});
  }
  for (const id of [25574,30064]) {
    const item = new Item(id);
    assert.throws(() => Common.set(item,Common.getDefinition(id),20,28931));
    assert.equal(Common.read(item).charges,0);
  }
});

test('sets each elemental tome and rejects invalid writes atomically', () => {
  for (const [empty,charged,page] of [[25576,25574,25578],[30066,30064,30068]]) {
    const item = new Item(empty);
    Common.set(item,Common.getDefinition(empty),1,page);
    assert.equal(item.getId(),charged);
    assert.deepEqual(Common.read(item),{charges:1,pageId:page});
  }
  const item = new Item(20716,1,{other:'preserved'});
  const definition = Common.getDefinition(20716);
  for (const [charges,page] of [[-1,20718],[20001,20718],[Infinity,20718],[NaN,20718],[0.5,20718],['20',20718],[20,25578],[20,20719],[20,28932],[20,undefined]]) {
    assert.throws(() => Common.set(item,definition,charges,page));
    assert.equal(item.getId(),20716);
    assert.deepEqual(item.getMeta(),{other:'preserved'});
  }
  assert.throws(() => Common.set(item,Common.getDefinition(25576),20,25578));
  assert.equal(item.getId(),20716);
});

test('clone and save/load round trips retain independent per-item state', () => {
  const original = new Item(20716);
  Common.set(original,Common.getDefinition(20716),41,28931);
  const clone = original.clone();
  const saved = JSON.parse(JSON.stringify({id:original.getId(),amount:original.getAmount(),meta:original.getMeta()}));
  const loaded = new Item(saved.id,saved.amount,saved.meta);
  Common.set(clone,Common.getDefinition(clone.getId()),40,28931);
  Common.set(loaded,Common.getDefinition(loaded.getId()),1,28931);
  assert.deepEqual(Common.read(original),{charges:41,pageId:28931});
  assert.deepEqual(Common.read(clone),{charges:40,pageId:28931});
  assert.deepEqual(Common.read(loaded),{charges:1,pageId:28931});
  const snapshot = Common.read(original);
  snapshot.charges = 500;
  assert.equal(Common.read(original).charges,41);
});

test('equipped lookup uses only the occupied shield slot', () => {
  const items = Array.from({length:14},() => new Item(-1,0));
  const player = {getEquipment:() => ({getItems:() => items})};
  items[Equipment.WEAPON_SLOT] = new Item(20714);
  assert.equal(Common.getEquipped(player),null);
  const item = new Item(30066);
  Common.set(item,Common.getDefinition(item.getId()),39,30068);
  items[Equipment.SHIELD_SLOT] = item;
  assert.equal(Common.getEquipped(player).item,item);
  assert.deepEqual(Common.getEquipped(player).state,{charges:39,pageId:30068});
  item.setAmount(0);
  assert.equal(Common.getEquipped(player),null);
});

test('refresh sends changed inventory and worn item variants and marks appearance', () => {
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { UpdateFlag } = require('../dist/game/model/UpdateFlag');
  const updates = new UpdateFlag();
  const packets = [];
  const player = {
    getUsername: () => 'tome-state-test',
    getUpdateFlag: () => updates,
    getPacketSender: () => ({ sendItemContainer: (container, interfaceId) => {
      packets.push({interfaceId, ids:container.getItems().map(item => item.getId())});
    } }),
    getInventory: () => inventory,
    getEquipment: () => equipment,
  };
  const inventory = new Inventory(player);
  const equipment = new Equipment(player);
  const carried = new Item(25576);
  const worn = new Item(20716);
  inventory.getItems()[0] = carried;
  equipment.getItems()[Equipment.SHIELD_SLOT] = worn;
  Common.set(carried,Common.getDefinition(25576),20,25578);
  Common.set(worn,Common.getDefinition(20716),20,28931);
  Common.refresh(player);
  assert.equal(packets.find(packet => packet.interfaceId === 3214)?.ids[0],25574);
  assert.equal(packets.find(packet => packet.interfaceId === 1688)?.ids[5],20714);
  assert.equal(updates.flagged(core.Flag.APPEARANCE),true);
});
