// Run after `yarn build`: node --test tests/firelighter-coat-message.test.cjs
// Coating logs with a firelighter: live sends "You coat the logs with the <colour> chemicals." as a
// spam (filterable) message (rsprox 227/00091.txt tick 24172). Real plugins, a real Player, the
// native inventory_use_on packet.
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

test('the coat line is a spam message', async (t) => {
  t.mock.method(core.WorldDefinition, 'isMembersWorld', () => true);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2760); p.setUsername('firelighter');
  p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const typed = [], plain = [];
  const sender = p.getPacketSender();
  const sendTyped = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { typed.push([type, text]); return sendTyped(type, text); });
  t.mock.method(sender, 'sendMessage', (text) => { plain.push(text); return sender; });
  p.getInventory().add(new core.Item(core.ItemIdentifiers.RED_FIRELIGHTER, 1), true);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.LOGS, 1), true);
  await c.dispatch([{ type: 'inventory_use_on', itemId: core.ItemIdentifiers.RED_FIRELIGHTER, slot: 0, target: { kind: 'inventory', slot: 1 } }]);
  c.processTurnPackets(); core.TaskManager.process();
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.RED_LOGS), 1, 'the logs are coated');
  assert.ok(typed.some(([type, text]) => type === core.ChatType.SPAM && text === 'You coat the logs with the red chemicals.'), JSON.stringify({ typed, plain }));
  assert.ok(!plain.some((text) => text.startsWith('You coat the logs')), 'not a plain game message');
});
