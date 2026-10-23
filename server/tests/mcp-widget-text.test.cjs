// Run after `yarn build`: node --test tests/mcp-widget-text.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const z = require('zod');
const { FrameUpdater } = require('../dist/util/FrameUpdater');

const frameUpdater = new FrameUpdater();
const player = {
  getLocation: () => ({ getX: () => 3222, getY: () => 3218, getZ: () => 0 }),
  getHitpoints: () => 10,
  getRunEnergy: () => 100,
  getIndex: () => 1,
  getPacketSender: () => ({ getVarbit: () => 0, getVarp: () => 0 }),
  getFrameUpdater: () => frameUpdater,
  getSkillManager: () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, getExperience: () => 0 }),
  getInventory: () => ({ getItems: () => [] }),
  getEquipment: () => ({ getItems: () => [] }),
};

const tools = {};
require('../plugins/agent/mcp/World.AgentMcp')({
  core: {
    World: { getProcessCycle: () => 1, getPlayers: () => ({ stream: () => [] }), getNpcs: () => ({ get: () => null }) },
    Skill: { values: () => [] },
    BoatManager: { rootLocation: (p) => p.getLocation(), getBoatAboard: () => null, all: () => [], canSeeBoat: () => true },
  },
  tool: (name, description, inputSchema, handler) => { tools[name] = { description, inputSchema, handler }; },
  z,
  player: z.string(),
  find: () => player,
  send: () => ({}),
  items: () => [],
  tile: (location) => ({ x: location.getX(), y: location.getY(), z: location.getZ() }),
  settle: () => ({}),
  status: () => ({}),
  sleepTicks: async () => {},
  takeMessages: () => [],
  takeClient: () => null,
  area: () => ({}),
  nearby: () => ({ npcs: [], objects: [], groundItems: [] }),
  nearest: () => ({}),
  npcClick: () => ({}),
  inventorySlot: () => 0,
  MAX_WAIT_TICKS: 50,
});

const observe = tools.observe;
const packed = (group, child) => (group << 16) | child;
const observeWidgets = (widgets) => observe.handler({ player: 'qa', radius: 15, varbits: [], varps: [], widgets });
const schema = z.object(observe.inputSchema);

test('observe returns the last widget text actually sent, and null for unknown ids', () => {
  const known = packed(665, 19);
  const unknown = packed(665, 99);
  frameUpdater.shouldUpdate('first line', known);

  assert.equal(observeWidgets([]).widgetTexts, undefined, 'no widgets requested keeps the old payload');
  assert.deepEqual(observeWidgets([known, unknown]).widgetTexts, { [known]: 'first line', [unknown]: null });

  frameUpdater.shouldUpdate('latest line', known);
  assert.deepEqual(observeWidgets([known]).widgetTexts, { [known]: 'latest line' });
});

test('observing widget text does not mutate the cache the client saw', () => {
  const known = packed(665, 20);
  frameUpdater.shouldUpdate('unchanged', known);
  const size = frameUpdater.interfaceTextMap.size;
  observeWidgets([known]);
  assert.equal(frameUpdater.interfaceTextMap.size, size);
  assert.equal(frameUpdater.interfaceTextMap.get(known).currentState, 'unchanged');
});

test('widget reads are capped at 100 packed ids', () => {
  assert.doesNotThrow(() => schema.parse({ player: 'qa', widgets: Array.from({ length: 100 }, (_, i) => i) }));
  assert.throws(() => schema.parse({ player: 'qa', widgets: Array.from({ length: 101 }, (_, i) => i) }));
});

// Dialogue amount prompts use the native resume_countdialog packet, not a quest-specific shortcut.
const dialogueTools = {};
const sentPackets = [];
let amountPromptOpen = false;
require('../plugins/agent/mcp/Dialogue.AgentMcp')({
  core: { MultiChatboxPrompt: { getPending: () => null } },
  tool: (name, _description, _schema, handler) => { dialogueTools[name] = handler; },
  z,
  player: z.string(),
  find: () => ({
    getEnteredAmountAction: () => (amountPromptOpen ? {} : null),
    getDialogueManager: () => ({ getCurrent: () => null }),
  }),
  send: (_player, packet) => { sentPackets.push(packet); return {}; },
  status: () => ({}),
  sleepTicks: async () => {},
});

test('dialogue_amount sends the native client amount packet only while an amount prompt is open', async () => {
  amountPromptOpen = false;
  await assert.rejects(
    dialogueTools.dialogue_amount({ player: 'qa', amount: 6 }),
    /No enter-amount prompt is open/
  );
  assert.deepEqual(sentPackets, []);

  amountPromptOpen = true;
  const result = await dialogueTools.dialogue_amount({ player: 'qa', amount: 6 });
  assert.deepEqual(sentPackets, [{ type: 'dialogue_amount', amount: 6 }]);
  assert.equal(result.amount, 6);
});
