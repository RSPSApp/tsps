// Run after `yarn build`: node --test tests/imp-in-a-box-refusals.test.cjs
// The imp-in-a-box refuses the Wiki's listed items. Its Stick and Unholy symbol entries link one item
// each (Stick (item), 4179; Unholy symbol (Icthlarin's Little Helper), 4683), and only those pages say
// they "cannot be banked with an imp-in-a-box": the other Sticks and the Zamorak Unholy symbol (1724)
// are banked. Real plugins, a real Player, the native inventory_use_on packet.
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

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 2750;
async function useOnBox(t, itemId) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('impbox' + p.getIndex());
  p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (message) => { messages.push(message); return p.getPacketSender(); });
  p.getInventory().add(new core.Item(itemId, 1), true);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.IMP_IN_A_BOX_2_, 1), true);
  await c.dispatch([{ type: 'inventory_use_on', itemId, slot: 0, target: { kind: 'inventory', slot: 1 } }]);
  c.processTurnPackets(); core.TaskManager.process();
  return { banked: p.getInventory().getAmount(itemId) === 0, messages };
}

test("the Wiki's Stick and Icthlarin's Little Helper unholy symbol are refused", async (t) => {
  for (const id of [core.ItemIdentifiers.STICK, core.ItemIdentifiers.UNHOLY_SYMBOL_3]) {
    const { banked, messages } = await useOnBox(t, id);
    assert.equal(banked, false, `item ${id}`);
    assert.ok(messages.includes('The imp refuses to bank that.'), messages.join(' | '));
  }
});

test('other items of the same names are banked', async (t) => {
  for (const id of [core.ItemIdentifiers.UNHOLY_SYMBOL, core.ItemIdentifiers.STICK_2, core.ItemIdentifiers.STICK_3]) {
    const { banked, messages } = await useOnBox(t, id);
    assert.equal(banked, true, `item ${id}: ${messages.join(' | ')}`);
  }
});
