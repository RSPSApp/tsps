// Run after `yarn build`: node --test tests/quest-item-rewards.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { after, before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Item } = require('../dist/game/model/Item');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const runtime = require('../plugins/quests/QuestRuntime');

const REWARD_ITEM = ItemIdentifiers.BRONZE_SWORD;
const STACKABLE_REWARD = ItemIdentifiers.COINS;
const FILLER_ITEM = ItemIdentifiers.SHARK;

let dropped = [];
let testApi;
let normalQuest;
let stackableQuest;
const originalRegisters = ItemOnGroundManager.registers;

function createPlayer() {
  const attributes = new Map();
  const messages = [];
  const sender = new Proxy({}, {
    get: (_target, property) => {
      if (property === 'sendString') return (text, uid) => { messages.push([uid, text]); return sender; };
      if (property === 'sendItemOnInterfaces') return (uid, id, amount) => { messages.push(['item', uid, id, amount]); return sender; };
      return () => sender;
    },
  });
  const player = {
    messages,
    getUsername: () => 'reward-test',
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getFrameUpdater: () => null,
    getInventory: () => player.inventory,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  return player;
}

function fillInventory(player, fillerCount, existingReward = 0) {
  for (let index = 0; index < fillerCount; index++) {
    player.getInventory().add(new Item(FILLER_ITEM, 1), false);
  }
  if (existingReward > 0) player.getInventory().add(new Item(STACKABLE_REWARD, existingReward), false);
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  assert.equal(ItemDefinition.forId(REWARD_ITEM).isStackable(), false, 'reward fixture is non-stackable');
  assert.equal(ItemDefinition.forId(STACKABLE_REWARD).isStackable(), true, 'stack fixture is stackable');
  assert.equal(ItemDefinition.forId(FILLER_ITEM).isStackable(), false, 'filler fixture is non-stackable');

  ItemOnGroundManager.registers = (player, item) => {
    dropped.push({ player, id: item.getId(), amount: item.getAmount() });
    return null;
  };

  const custom = new Map();
  testApi = {
    core: { Item },
    persistAttribute() {},
    onInterfaceActionButton() {},
    onCustomEvent(name, fn) {
      const list = custom.get(name) ?? [];
      list.push(fn);
      custom.set(name, list);
    },
    onPlayerLogin() {},
    emitCustomEvent(name, event) {
      for (const fn of custom.get(name) ?? []) fn(event);
    },
  };
  normalQuest = runtime.registerQuest(testApi, {
    key: 'reward-overflow-test',
    name: 'Reward Overflow Test',
    varpId: 20001,
    startedValue: 1,
    completionValue: 2,
    questPoints: 1,
    rewardItemId: REWARD_ITEM,
  });
  stackableQuest = runtime.registerQuest(testApi, {
    key: 'reward-stack-test',
    name: 'Reward Stack Test',
    varpId: 20002,
    startedValue: 1,
    completionValue: 2,
    questPoints: 1,
    rewardItemId: STACKABLE_REWARD,
  });
});

after(() => {
  ItemOnGroundManager.registers = originalRegisters;
});

test('force-add preserves every non-stackable reward with zero, one or two free slots', () => {
  for (const freeSlots of [0, 1, 2, 3]) {
    const player = createPlayer();
    fillInventory(player, 28 - freeSlots);
    dropped = [];
    const reward = new Item(REWARD_ITEM, 3);
    player.getInventory().forceAdd(player, reward);
    const carried = player.getInventory().getAmount(REWARD_ITEM);
    const onGround = dropped.filter(drop => drop.id === REWARD_ITEM).reduce((sum, drop) => sum + drop.amount, 0);
    assert.equal(carried, freeSlots, `${freeSlots} items fit`);
    assert.equal(carried + onGround, 3, 'every reward is carried or available on the ground');
    assert.equal(reward.getAmount(), 3, 'overflow never mutates the caller’s item');
  }
});

test('delayed completion scrolls resolve each player’s own reward icon', (t) => {
  const pending = [];
  class CompletionTask {
    constructor(_player, _ticks, callback) { this.callback = callback; }
  }
  const api = {
    ...testApi,
    core: { Item, CountdownTask: CompletionTask, TaskManager: { submit: task => pending.push(task) } },
  };
  t.after(() => {
    delete api.core.CountdownTask;
    delete api.core.TaskManager;
  });
  const quest = runtime.registerQuest(api, {
    key: 'reward-scroll-player-test', name: 'Player Reward Scroll',
    varpId: 20003, startedValue: 1, completionValue: 2, questPoints: 0,
    scrollItemId: player => player.getAttribute('test:reward-icon'),
  });
  const first = createPlayer();
  const second = createPlayer();
  first.setAttribute('test:reward-icon', REWARD_ITEM);
  second.setAttribute('test:reward-icon', STACKABLE_REWARD);
  quest.complete(first);
  quest.complete(second);
  assert.equal(pending.length, 2, 'both scrolls wait until the hand-in has finished');
  for (const task of pending) task.callback();
  assert.deepEqual(first.messages.filter(entry => Array.isArray(entry) && entry[0] === 'item').map(entry => entry[2]), [REWARD_ITEM]);
  assert.deepEqual(second.messages.filter(entry => Array.isArray(entry) && entry[0] === 'item').map(entry => entry[2]), [STACKABLE_REWARD]);
});

test('full inventory without an existing stack drops the quest reward and pays it once', () => {
  dropped = [];
  const player = createPlayer();
  fillInventory(player, 28);
  assert.equal(player.getInventory().isFull(), true);

  // Red proof for the old `adds` path: a full bag silently rejects this reward.
  player.getInventory().adds(REWARD_ITEM, 1);
  assert.equal(player.getInventory().getAmount(REWARD_ITEM), 0, 'adds loses the item on a full bag');
  assert.equal(dropped.length, 0);

  assert.equal(normalQuest.complete(player), true);
  assert.equal(dropped.length, 1, 'the real reward is registered on the ground once');
  assert.equal(dropped[0].player, player);
  assert.equal(dropped[0].id, REWARD_ITEM);
  assert.equal(dropped[0].amount, 1);
  assert.equal(player.getInventory().getAmount(REWARD_ITEM), 0);

  assert.equal(normalQuest.complete(player), false, 'completion is still idempotent');
  assert.equal(dropped.length, 1, 'the reward is not paid twice');
});

test('full inventory with an existing reward stack merges the stackable reward', () => {
  dropped = [];
  const player = createPlayer();
  fillInventory(player, 27, 10);
  assert.equal(player.getInventory().isFull(), true);
  assert.equal(player.getInventory().getAmount(STACKABLE_REWARD), 10);

  assert.equal(stackableQuest.complete(player), true);
  assert.equal(player.getInventory().getAmount(STACKABLE_REWARD), 11);
  assert.equal(dropped.length, 0, 'a stackable reward already in the bag is not dropped');
});

test('one free inventory slot accepts the reward without a ground drop', () => {
  dropped = [];
  const player = createPlayer();
  fillInventory(player, 27);
  assert.equal(player.getInventory().isFull(), false);

  assert.equal(normalQuest.complete(player), true);
  assert.equal(player.getInventory().getAmount(REWARD_ITEM), 1);
  assert.equal(dropped.length, 0);
});

test('quest:get-stage answers a registered saved stage and leaves unknown keys unanswered', () => {
  const player = createPlayer();
  player.setAttribute('quest.reward-overflow-test.stage', 1);
  const known = { player, key: 'reward-overflow-test', stage: null };
  testApi.emitCustomEvent('quest:get-stage', known);
  assert.equal(known.stage, 1, 'answers the registered quest saved stage');

  const unknown = { player, key: 'not-a-registered-quest', stage: null };
  testApi.emitCustomEvent('quest:get-stage', unknown);
  assert.equal(unknown.stage, null, 'unknown keys stay unanswered');
});
