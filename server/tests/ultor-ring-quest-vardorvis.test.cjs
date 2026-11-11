// Run after `yarn build`: node --test tests/ultor-ring-quest-vardorvis.test.cjs
// Wiki (Ultor ring): it needs Vardorvis killed at least once, "which is done during Desert Treasure
// II". The quest's Vardorvis is not counted as an ordinary kill, so a player who has only won the
// quest fight must still be able to wear the ring. Real plugins, a real Player, the quest's own
// stage and progress, and the native inventory Wear packet.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const QuestRuntime = require('../plugins/quests/QuestRuntime');

const VARDORVIS_PROGRESS = 'desert-treasure-ii:vardorvis-progress';
const SLIPS = 'The ring slips off your finger. The power within it seems unfamiliar.';
let core, next = 2770;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

async function wearAt(t, progress) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('ultor' + p.getIndex());
  p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  const quest = QuestRuntime.getRegisteredQuests().find((q) => /^Desert Treasure II/.test(q.name));
  assert.ok(quest, 'Desert Treasure II is registered');
  quest.setStage(p, 7); // the four chapters
  p.setAttribute(VARDORVIS_PROGRESS, progress);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.ULTOR_RING, 1), true);
  await c.dispatch([{ type: 'inventory_action', widgetId: core.Inventory.INTERFACE_ID, slot: 0,
    itemId: core.ItemIdentifiers.ULTOR_RING, option: 'Wear', optionIndex: 2 }]);
  c.processTurnPackets();
  return { worn: p.getEquipment().get(core.Equipment.RING_SLOT)?.getId?.() === core.ItemIdentifiers.ULTOR_RING, messages };
}

test("after the quest's Vardorvis fight is won the ring can be worn", async (t) => {
  const { worn, messages } = await wearAt(t, 17);
  assert.equal(worn, true, messages.join(' | '));
  assert.ok(!messages.includes(SLIPS));
});

test('before the fight is won it still slips off', async (t) => {
  const { worn, messages } = await wearAt(t, 16);
  assert.equal(worn, false);
  assert.ok(messages.includes(SLIPS), messages.join(' | '));
});
