const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
const path = require('node:path');

Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Item } = require('../dist/game/model/Item');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { encodeInventorySnapshot } = require('../dist/net/protocol/ClientProtocol');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { createContext } = require('../plugins/agent/mcp/Context.AgentMcp');
const registerWorldTools = require('../plugins/agent/mcp/World.AgentMcp');

test('cache item zero is valid inventory content and can be handed in', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));

  const player = {
    getUsername: () => 'item-zero-regression',
    getPacketSender: () => ({ sendItemContainer() {} }),
    sendMessage() {},
  };
  const inventory = new Inventory(player);
  const remains = new Item(0, 1);
  const mcp = createContext({ ItemDefinition }, { registerTool() {} });

  assert.equal(ItemDefinition.forId(0).getName(), 'Dwarf remains');
  assert.equal(remains.isValid(), true);
  inventory.addItem(remains);
  assert.equal(inventory.containsNumber(0), true);
  assert.equal(inventory.getAmount(0), 1);
  assert.equal(inventory.isSlotOccupied(inventory.getSlotForItemId(0)), true);
  assert.equal(inventory.getValidItems()[0].getId(), 0);
  assert.deepEqual(mcp.items(inventory), [{ slot: 0, id: 0, name: 'Dwarf remains', amount: 1 }]);
  const carriedPacket = encodeInventorySnapshot([{ slot: 0, itemId: 0, quantity: 1 }]);
  const emptyPacket = encodeInventorySnapshot([{ slot: 0, itemId: -1, quantity: 0 }]);
  assert.deepEqual(carriedPacket.subarray(7, 9), Buffer.from([0, 1]), 'wire ID is cache ID + 1');
  assert.deepEqual(emptyPacket.subarray(7, 9), Buffer.from([0, 0]), 'empty sentinel remains wire ID 0');

  let interfacePacket;
  const packetSender = new PacketSender({ getSession: () => ({ write: (packet) => { interfacePacket = packet.getBuffer(); } }) });
  packetSender.sendInterfaceItems(123, [remains]);
  assert.deepEqual(interfacePacket.subarray(-6), Buffer.from([0, 0, 0, 1, 0, 1]), 'legacy interface packet includes item 0 as ID+1');

  inventory.deleteNumber(0, 1);
  assert.equal(inventory.containsNumber(0), false);
  assert.equal(inventory.getFreeSlots(), 28);
});

test('MCP inventory option and item-use accept a real item-0 slot', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const inventory = new Inventory({
    getUsername: () => 'item-zero-mcp',
    getPacketSender: () => ({ sendMessage() {}, sendTypedMessage() {}, sendItemContainer() {} }),
    sendMessage() {},
  });
  inventory.addItem(new Item(0, 1));
  const sent = [];
  const player = {
    getUsername: () => 'item-zero-mcp',
    getPacketSender: () => ({ sendMessage() {}, sendTypedMessage() {} }),
    getInventory: () => inventory,
    getLocation: () => ({ getX: () => 2567, getY: () => 3444, getZ: () => 2 }),
    getHitpoints: () => 10,
    getMovementQueue: () => ({ hasPendingWork: () => false }),
    getCombat: () => ({ hasPendingWork: () => false }),
    getInterfaceId: () => 0,
  };
  let cycle = 0;
  const world = { getPlayerByName: () => player, getProcessCycle: () => ++cycle };
  const core = {
    ItemDefinition, World: world,
    GameConstants: { GAME_ENGINE_PROCESSING_CYCLE_RATE: 12 },
    dispatchClientMessages: (_player, messages) => { sent.push(...messages); return true; },
  };
  const handlers = new Map();
  const ctx = createContext(core, { registerTool: (name, _definition, handler) => handlers.set(name, handler) });
  registerWorldTools(ctx);

  await handlers.get('inventory_option')({ player: 'item-zero-mcp', item: 'Dwarf remains', option: 'Drop' });
  assert.equal(sent.at(-1).type, 'inventory_action');
  assert.equal(sent.at(-1).itemId, 0);

  sent.length = 0;
  await handlers.get('use_item')({ player: 'item-zero-mcp', slot: 0, on: 'loc', id: 1, maxTicks: 1 });
  assert.equal(sent[0].type, 'inventory_use_on');
  assert.equal(sent[0].itemId, 0);
});
