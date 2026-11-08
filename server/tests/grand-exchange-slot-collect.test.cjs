const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');

const GE = 465;
const IRON_BAR = 2351;
const COINS = 995;
let core;
let plugin;
let index = 4700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  plugin = require('../plugins/interface/GrandExchange.plugin');
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername('geslot' + index);
  p.setRegistered(true);
  p.setLocation(new core.Location(3164, 3488, 0));
  p.needsPlacement = false;
  p.setAttribute('bot-skip-persistence', true);
  const conn = new ClientConnection(channel);
  conn.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
  });
  return { p, conn };
}

async function button(f, child, slot, buttonNum) {
  const widgetId = (GE << 16) | child;
  await f.conn.dispatch([{ type: 'widget_action', widgetId, groupId: GE, childId: child, slot, buttonNum }]);
  f.conn.processTurnPackets();
}

test('a slot click on a finished overbid buy collects only that slot: coins first, then the item (rsprox 236/03950)', async t => {
  const f = actor(t);
  const { p } = f;
  const guide = plugin._test.price(IRON_BAR);
  assert.ok(guide > 0);
  const offer = { itemId: IRON_BAR, sell: false, slot: 0, quantity: 10, price: guide * 2, total: guide * 20,
    finished: false, placedAt: Date.now(), completesAt: Date.now() + 60_000 };
  p.setAttribute(plugin._test.OFFERS_ATTRIBUTE, { 0: offer });
  const timers = [];
  const timeout = t.mock.method(globalThis, 'setTimeout', callback => { timers.push(callback); return 0; });
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  timeout.mock.restore();
  const offers = p.getAttribute(plugin._test.OFFERS_ATTRIBUTE);
  const saved = offers[0];
  assert.ok(saved, 'the offer survived login');
  assert.ok(timers.length > 0, 'completion scheduled');
  for (const timer of timers) timer();
  assert.equal(saved.finished, true);
  assert.equal(saved.traded, guide * 10, 'ten at the guide price');

  p.setInterfaceId(GE);
  await button(f, 7, 0, 1);
  const inventory = p.getInventory();
  await button(f, 24, 3, 2);
  assert.equal(inventory.getAmount(COINS), guide * 10, 'the refunded difference');
  assert.equal(inventory.getAmount(IRON_BAR) + inventory.getAmount(IRON_BAR + 1), 0, 'no bars from the coins slot');
  assert.ok(offers[0], 'the bars still wait in the offer');
  assert.deepEqual(offers[0].collected, [1]);

  await button(f, 24, 3, 2);
  assert.equal(inventory.getAmount(COINS), guide * 10, 'a second click on the emptied slot pays nothing');

  await button(f, 24, 2, 2);
  assert.equal(inventory.getAmount(IRON_BAR) + inventory.getAmount(IRON_BAR + 1), 10);
  assert.equal(offers[0], undefined, 'the offer clears once both slots are taken');
});
