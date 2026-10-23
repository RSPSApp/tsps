const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Item } = require('../dist/game/model/Item');
before(() => CachePipeline.initialize(require('node:path').resolve(__dirname, '..')));
test('all goblin mail rejects humans but retains the legitimate transformed-goblin Wear route', () => {
  let guard;
  require('../plugins/items/GoblinMail.plugin').register({ core: {}, onCustomEvent() {}, onCanEquip: handler => { guard = handler; } });
  for (const itemId of [288, 286, 287, 9054, 9055, 9056, 9057, 9058, 9059, 26567]) {
    const messages = [];
    let goblin = 0;
    const player = { getPacketSender: () => ({ getVarbit: id => id === 13612 ? goblin : 0 }), sendMessage: text => messages.push(text) };
    const event = { player, item: new Item(itemId, 1), allow: true };
    guard(event);
    assert.equal(event.allow, false, `human cannot wear ${itemId}`);
    assert.match(messages[0], /goblin|small/i);
    goblin = 1;
    const transformed = { player, item: new Item(itemId, 1), allow: true };
    guard(transformed);
    assert.equal(transformed.allow, true, `goblin can wear ${itemId}`);
  }
  const unrelated = { item: new Item(1117, 1), player: {}, allow: true };
  guard(unrelated);
  assert.equal(unrelated.allow, true);
});

test('legacy human-form goblin mail is safely removed at bootstrap; a full bag retains it', () => {
  const hooks = new Map();let unequips = 0;
  const core = { Equipment: { BODY_SLOT: 4 }, EquipPacketListener: { unequip: (_player, slot) => { assert.equal(slot,4);unequips++;return true; } } };
  require('../plugins/items/GoblinMail.plugin').register({ core, onCanEquip() {}, onCustomEvent: (name,handler) => hooks.set(name,handler) });
  const messages=[];let free=1, goblin=0;
  const player={ getInventory:()=>({getFreeSlots:()=>free}),getEquipment:()=>({get:()=>new Item(288,1)}),getPacketSender:()=>({getVarbit:()=>goblin}),sendMessage:text=>messages.push(text) };
  assert.equal(typeof hooks.get('player:bootstrap-complete'),'function');
  hooks.get('player:bootstrap-complete')({player});assert.equal(unequips,1);
  free=0;hooks.get('player:bootstrap-complete')({player});assert.equal(unequips,1);assert.match(messages.at(-1),/space/i);
  free=1;goblin=1;hooks.get('player:bootstrap-complete')({player});assert.equal(unequips,1);
});
