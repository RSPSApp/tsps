// Run after `yarn build`: node --test tests/lost-tribe-symbol-book.test.cjs
// The Lost Tribe's goblin symbol book is its own cache interface, lost_tribe_symbol_book (183), whose
// text the cache holds (Wiki, Transcript:Goblin symbol book). Read opens it on the title spread; the
// "Turn page" arrows show the next spread's layer and hide the rest; closing it after reading moves
// stage 7 to 8. Real plugins, a real Player, native inventory and widget packets.
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

const BOOK = 183;
// As read in rsprox_transcripts/232/03222.txt: titles, page 1-3, directions (15), symbols (14).
const SPREADS = [33, 38, 42, 46, 15, 14];
const RIGHT = 16, LEFT = 17, RIGHT_LAYER = 18, LEFT_LAYER = 19;
const uid = (child) => (BOOK << 16) | child;

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test('the goblin symbol book opens its own interface, turns through six spreads and moves the quest on when closed', async (t) => {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2743); p.setUsername('losttribebook');
  p.setRegistered(true); p.setLocation(new core.Location(3208, 3220, 2)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === 'the_lost_tribe');
  quest.setStage(p, 7);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.GOBLIN_SYMBOL_BOOK, 1), true);

  const hidden = new Map();
  const opened = [];
  const sender = p.getPacketSender();
  const display = sender.sendInterfaceDisplayState.bind(sender);
  t.mock.method(sender, 'sendInterfaceDisplayState', (id, hide) => { hidden.set(id, hide); return display(id, hide); });
  const open = sender.sendInterface.bind(sender);
  t.mock.method(sender, 'sendInterface', (id) => { opened.push(id); return open(id); });
  const send = async (packet) => { await c.dispatch([packet]); c.processTurnPackets(); core.TaskManager.process(); };
  const shown = () => SPREADS.filter((layer) => hidden.get(uid(layer)) === false);

  await send({ type: 'inventory_action', widgetId: core.Inventory.INTERFACE_ID, slot: 0,
    itemId: core.ItemIdentifiers.GOBLIN_SYMBOL_BOOK, option: 'Read', optionIndex: 1 });
  assert.equal(opened.at(-1), BOOK, 'Read opens lost_tribe_symbol_book');
  assert.deepEqual(shown(), [33], 'the title spread');
  assert.equal(hidden.get(uid(LEFT_LAYER)), true, 'no left arrow on the first spread');
  assert.equal(hidden.get(uid(RIGHT_LAYER)), false);
  assert.equal(quest.getStage(p), 7, 'opening it does not skip the reading');

  for (const layer of SPREADS.slice(1)) {
    await send({ type: 'widget_action', widgetId: uid(RIGHT), groupId: BOOK, childId: RIGHT, slot: -1, buttonNum: 1 });
    assert.deepEqual(shown(), [layer]);
  }
  assert.equal(hidden.get(uid(RIGHT_LAYER)), true, 'no right arrow on the last spread');
  assert.equal(hidden.get(uid(LEFT_LAYER)), false);
  await send({ type: 'widget_action', widgetId: uid(LEFT), groupId: BOOK, childId: LEFT, slot: -1, buttonNum: 1 });
  assert.deepEqual(shown(), [15], 'the left arrow turns back from the symbols to the directions');

  sender.sendInterfaceRemoval();
  assert.equal(quest.getStage(p), 8, 'closing the book completes the reading step');
});
