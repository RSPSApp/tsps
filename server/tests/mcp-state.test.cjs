const assert = require('node:assert/strict');
const { test } = require('node:test');
const z = require('zod');

const { createContext } = require('../plugins/agent/mcp/Context.AgentMcp');
const registerWorldTools = require('../plugins/agent/mcp/World.AgentMcp');

let blocked = true;
const players = new Map();
const core = {
  World: {
    getProcessCycle: () => 0,
    getPlayerByName: name => players.get(name),
  },
  Skill: { values: () => [] },
  BoatManager: {
    rootLocation: p => p.getLocation(), getBoatAboard: () => null,
    all: () => [], canSeeBoat: () => false,
  },
  BOAT_VIEW_DISTANCE: 16,
  MapObjects: {}, ObjectDefinition: {}, RegionManager: {},
  ItemDefinition: { forId: () => ({ getName: () => 'item' }) },
  GameConstants: { GAME_ENGINE_PROCESSING_CYCLE_RATE: 1 },
  TaskManager: { hasActiveTask: () => false },
  MultiChatboxPrompt: { getPending: () => null },
};

function player() {
  return {
    getUsername: () => 'qa',
    getIndex: () => 1,
    getLocation: () => ({ getX: () => 3207, getY: () => 3212, getZ: () => 1 }),
    getHitpoints: () => 10,
    getRunEnergy: () => 100,
    getMovementQueue: () => ({ hasPendingWork: () => blocked, isMovementBlocked: () => blocked }),
    getCombat: () => ({ hasPendingWork: () => false }),
    getInterfaceId: () => -1,
    getDialogueManager: () => ({ isActive: () => false }),
    getPacketSender: () => ({ sendMessage: () => {}, sendTypedMessage: () => {} }),
    getSkillManager: () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, getExperience: () => 0 }),
    getInventory: () => ({ getItems: () => [] }),
    getEquipment: () => ({ getItems: () => [] }),
    getArea: () => null,
    getPrivateArea: () => null,
  };
}

const tools = {};
const server = { registerTool: (name, _definition, handler) => { tools[name] = handler; } };
const context = createContext(core, server);
context.nearby = () => ({ npcs: [], objects: [], groundItems: [] });
registerWorldTools(context);

async function observe() {
  const result = await tools.observe({ player: 'qa', radius: 8, varbits: [], varps: [], widgets: [] });
  return JSON.parse(result.content[0].text);
}

test('status and the registered observe handler report the actual movement-queue lock', async () => {
  players.set('qa', player());
  const blockedStatus = context.status(players.get('qa'));
  assert.equal(blockedStatus.movementBlocked, true);
  assert.deepEqual(blockedStatus.busy, ['moving']);
  assert.equal((await observe()).movementBlocked, true);

  blocked = false;
  assert.equal(context.status(players.get('qa')).movementBlocked, false);
  assert.equal((await observe()).movementBlocked, false);
});

test('movementBlocked defaults to false when a mock lacks the movement-queue API', () => {
  const p = player();
  p.getMovementQueue = undefined;
  assert.equal(context.status(p).movementBlocked, false);
  p.getMovementQueue = () => ({ hasPendingWork: () => false });
  assert.equal(context.status(p).movementBlocked, false);
});
