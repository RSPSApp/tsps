'use strict';
// Run after `yarn build`: node --test tests/rune-pouch-note.test.cjs
// Issue 4257: the Rune pouch note (24587), used on a banker or bank booth, becomes a Rune pouch
// (OSRS Wiki Rune_pouch_note), or says "You already have one of those." when one is owned.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

const { PluginManager } = require('../dist/plugins/PluginManager');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { Item } = require('../dist/game/model/Item');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');

const BANKER = 2897;
const NOTE = 24587;
const POUCH = 12791;

function register() {
  const hooks = {};
  const api = new Proxy(PluginManager.createApi('BankBooths'), {
    get(target, property) {
      if (typeof property === 'string' && /^on[A-Z]/.test(property)) {
        return (handler) => { (hooks[property] ??= []).push(handler); };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  require('../plugins/objects/BankBooths.plugin').register(api);
  return hooks;
}

function makePlayer({ inventory = [], bank = [] } = {}) {
  const sender = new Proxy({}, { get: () => () => sender });
  const messages = [];
  const player = {
    messages,
    sendMessage: (message) => messages.push(message),
    getDialogueManager: () => ({ getCurrent: () => null, startDialogues() { messages.push('dialogue'); } }),
    getPacketSender: () => sender,
  };
  const container = new Inventory(player);
  inventory.forEach((item, slot) => { container.getItems()[slot] = item; });
  player.getInventory = () => container;
  const bankItems = [...bank];
  player.getBanks = () => [{ containsAnyIds: (ids) => bankItems.some((item) => ids.includes(item.getId())) }];
  return player;
}

function useOnBanker(hooks, player, slot = 0) {
  const event = {
    player, definition: NpcDefinition.forId(BANKER), npcId: BANKER, target: {}, targetIndex: 1, interfaceId: 149,
    item: player.getInventory().forSlot(slot), itemId: NOTE, slot, handled: false,
  };
  for (const handler of hooks.onItemOnNpc) if (!event.handled) handler(event); // the manager skips hooks once handled
  return event;
}

function useOnBooth(hooks, player, slot = 0) {
  const event = {
    player, object: { getDefinition: () => ({ getName: () => 'Bank booth' }) }, objectId: 10355,
    item: player.getInventory().forSlot(slot), itemId: NOTE, itemSlot: slot, handled: false,
  };
  for (const handler of hooks.onItemOnObject) if (!event.handled) handler(event);
  return event;
}

for (const [name, use] of [['banker', useOnBanker], ['bank booth', useOnBooth]]) {
  test(`the note used on a ${name} becomes a rune pouch`, () => {
    const player = makePlayer({ inventory: [new Item(NOTE, 1)] });
    const event = use(register(), player);
    assert.equal(event.handled, true);
    assert.equal(player.getInventory().getAmount(NOTE), 0);
    assert.equal(player.getInventory().getAmount(POUCH), 1);
    assert.deepEqual(player.messages, ['You exchange the promissory note.']);
  });

  test(`one note of a stack is exchanged at a ${name}`, () => {
    const player = makePlayer({ inventory: [new Item(NOTE, 3)] });
    use(register(), player);
    assert.equal(player.getInventory().getAmount(NOTE), 2);
    assert.equal(player.getInventory().getAmount(POUCH), 1);
  });

  test(`the note is kept at a ${name} when a pouch is carried`, () => {
    const player = makePlayer({ inventory: [new Item(NOTE, 1), new Item(POUCH, 1)] });
    const event = use(register(), player);
    assert.equal(event.handled, true);
    assert.equal(player.getInventory().getAmount(NOTE), 1);
    assert.equal(player.getInventory().getAmount(POUCH), 1);
    assert.deepEqual(player.messages, ['You already have one of those.']);
  });

  test(`the note is kept at a ${name} when a pouch is in the bank`, () => {
    const player = makePlayer({ inventory: [new Item(NOTE, 1)], bank: [new Item(POUCH, 1)] });
    use(register(), player);
    assert.equal(player.getInventory().getAmount(NOTE), 1);
    assert.equal(player.getInventory().getAmount(POUCH), 0);
    assert.deepEqual(player.messages, ['You already have one of those.']);
  });
}

test('a stack of notes in a full inventory is refused without losing a note', () => {
  const filler = Array.from({ length: 27 }, () => new Item(4151, 1));
  const player = makePlayer({ inventory: [new Item(NOTE, 2), ...filler] });
  useOnBanker(register(), player);
  assert.equal(player.getInventory().getAmount(NOTE), 2);
  assert.deepEqual(player.messages, ["You don't have enough inventory space."]);
});
