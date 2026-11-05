// Run after yarn build: node --test tests/random-event-rewards.test.cjs
// The shared reward helper against a real Inventory, whose add() clamps a stack at its maximum.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
require('../dist/game/cache/CachePipeline').CachePipeline.initialize();
const { Item } = require('../dist/game/model/Item');
const { Location } = require('../dist/game/model/Location');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const Rewards = require('../plugins/npcs/random-events/Rewards.RandomEvents');

const MAX = 2_147_483_647;

function fixture() {
  const messages = [], drops = [], obtains = [];
  const player = { getUsername: () => 'RewardTest', getLocation: () => new Location(3222, 3218),
    sendMessage: text => messages.push(text), isPlayerBot: () => false,
    getPacketSender: () => ({ sendItemContainer() {} }) };
  const inventory = new Inventory(player); player.getInventory = () => inventory;
  const api = { core: { Item }, getItemOnGroundManager: () => ({
    registerLocation(owner, item, position, privateArea, options) { drops.push({ item, options }); } }),
    emitCustomEvent(name, event) { if (name === 'collection-log:obtain') obtains.push(event); } };
  return { player, inventory, messages, drops, obtains, api };
}

test('a reward that would overflow an existing stack is placed on the ground whole', () => {
  const f = fixture();
  f.inventory.add(new Item(I.COINS, MAX - 1));
  Rewards.give(f.api, f.player, [{ id: I.COINS, amount: 80 }]);
  assert.equal(f.inventory.getAmount(I.COINS), MAX - 1);
  assert.deepEqual(f.drops.map(drop => [drop.item.getId(), drop.item.getAmount(), drop.options.despawnDelay]),
    [[I.COINS, 80, Rewards.LIFETIME_TICKS]]);
  assert.deepEqual(f.messages, ['Your reward is: <col=ff0000>80</col> x <col=ff0000>Coins</col> - it has been placed <col=ff0000>on the ground</col>.']);
});

test('a reward that exactly fills an existing stack joins it', () => {
  const f = fixture();
  f.inventory.add(new Item(I.COINS, MAX - 80));
  Rewards.give(f.api, f.player, [{ id: I.COINS, amount: 80 }]);
  assert.equal(f.inventory.getAmount(I.COINS), MAX);
  assert.deepEqual(f.drops, []);
  assert.deepEqual(f.messages, ['Your reward is: <col=ff0000>80</col> x <col=ff0000>Coins</col>.']);
});


test('a random event reward is credited to the collection log once, even when it lands on the ground', () => {
  const f = fixture();
  f.inventory.add(new Item(I.COINS, MAX - 1));
  Rewards.give(f.api, f.player, [{ id: 6654, amount: 1 }, { id: I.COINS, amount: 80 }]);
  assert.deepEqual(f.obtains.map((event) => [event.itemId, event.amount]), [[6654, 1], [I.COINS, 80]]);
});
