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

// Modify offer, as recorded (rsprox local 1001438 ticks 10289-16394, local 1001441 ticks 3620-7230).
const GE = 465;
const OFFER_CONTENTS = (GE << 16) | 1;
const LOADING_POPUP = 916;
const IRON_BAR = 2351;
const IRON_BAR_NOTE = 2352;
const COINS = 995;
let core;
let plugin;
let index = 4800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  plugin = require('../plugins/interface/GrandExchange.plugin');
});
after(() => PM.emitServerShutdown({}));

/** A player at the exchange with one offer still trading in `slot`; its completion timer never fires. */
function trader(t, offer) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername('gemodify' + index);
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
  const placed = { finished: false, placedAt: Date.now(), completesAt: Date.now() + 3_600_000, total: offer.quantity * offer.price, ...offer };
  if (!offer.sell) placed.limitOnFill = true;
  p.setAttribute(plugin._test.OFFERS_ATTRIBUTE, { [offer.slot]: placed });
  const timeout = t.mock.method(globalThis, 'setTimeout', () => 0);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  timeout.mock.restore();
  p.setInterfaceId(GE);
  const sender = p.getPacketSender();
  const messages = [];
  t.mock.method(sender, 'sendMessage', function (text) { messages.push(text); return this; });
  const opened = t.mock.method(sender, 'sendSubInterface');
  const closed = t.mock.method(sender, 'closeSubInterface');
  return { p, conn, messages, opened, closed, offers: () => p.getAttribute(plugin._test.OFFERS_ATTRIBUTE) };
}

async function button(f, child, slot, buttonNum = 1) {
  const widgetId = (GE << 16) | child;
  await f.conn.dispatch([{ type: 'widget_action', widgetId, groupId: GE, childId: child, slot, buttonNum }]);
  f.conn.processTurnPackets();
}

/** Views the offer in `slot` (465:7 + slot), then picks Modify (465:23, dynamic child 1). */
async function modify(f, slot) {
  await button(f, 7 + slot, 2);
  await button(f, 23, 1);
}

function tick() {
  core.TaskManager.process();
}

test('Modify on a sell: "Please wait...", then two ticks later the items come back noted and the setup holds the offer', async t => {
  const price = plugin._test.sellPrice(IRON_BAR) + 7;
  const f = trader(t, { itemId: IRON_BAR, sell: true, slot: 2, quantity: 3, price });
  const inventory = f.p.getInventory();

  await modify(f, 2);
  assert.ok(f.opened.mock.calls.some(({ arguments: [target, group] }) => target === OFFER_CONTENTS && group === LOADING_POPUP),
    'popuploading over ge_offers:contents');
  assert.equal(f.offers()[2].aborted, true, 'the offer stops trading at once');
  assert.equal(inventory.getAmount(IRON_BAR_NOTE), 0, 'nothing back yet');

  tick();
  assert.equal(inventory.getAmount(IRON_BAR_NOTE), 0, 'still waiting after one tick');
  tick();
  assert.equal(inventory.getAmount(IRON_BAR_NOTE), 3, 'three bars come back as notes');
  assert.equal(f.offers()[2], undefined, 'the slot is free again');
  assert.ok(f.closed.mock.calls.some(({ arguments: [target] }) => target === OFFER_CONTENTS), 'the popup closes');
  const setup = plugin._test.getOffer(f.p);
  assert.deepEqual({ sell: setup.sell, slot: setup.slot, itemId: setup.itemId, quantity: setup.quantity, price: setup.price },
    { sell: true, slot: 2, itemId: IRON_BAR, quantity: 3, price });
  assert.deepEqual(f.messages, [], 'no abort or collect message, as recorded');
});

test('the modified setup confirms as a new offer in the same slot', async t => {
  const price = plugin._test.sellPrice(IRON_BAR) + 7;
  const f = trader(t, { itemId: IRON_BAR, sell: true, slot: 2, quantity: 3, price });
  await modify(f, 2);
  tick();
  tick();
  plugin._test.getOffer(f.p).price = price - 1;
  await button(f, 30, -1);
  const placed = f.offers()[2];
  assert.ok(placed && !placed.finished, 'placed again');
  assert.equal(placed.price, price - 1);
  assert.equal(placed.quantity, 3);
  assert.equal(f.p.getInventory().getAmount(IRON_BAR_NOTE), 0, 'the notes went into the offer');
});

test('Modify on a buy: the coins come back, the buy limit is released, and the setup is a buy', async t => {
  const price = plugin._test.price(IRON_BAR) + 3;
  const f = trader(t, { itemId: IRON_BAR, sell: false, slot: 5, quantity: 10, price });
  const limit = plugin._test.remainingLimit(f.p, IRON_BAR);
  await modify(f, 5);
  tick();
  tick();
  assert.equal(f.p.getInventory().getAmount(COINS), price * 10);
  assert.equal(plugin._test.remainingLimit(f.p, IRON_BAR), limit + 10, 'the pending buy no longer counts');
  const setup = plugin._test.getOffer(f.p);
  assert.deepEqual({ sell: setup.sell, slot: setup.slot, itemId: setup.itemId, quantity: setup.quantity, price: setup.price },
    { sell: false, slot: 5, itemId: IRON_BAR, quantity: 10, price });
});

test('a single sold item comes back as the item, not a note (rsprox local 1001441 tick 6690)', async t => {
  const f = trader(t, { itemId: IRON_BAR, sell: true, slot: 0, quantity: 1, price: 100 });
  await modify(f, 0);
  tick();
  tick();
  assert.equal(f.p.getInventory().getAmount(IRON_BAR), 1);
  assert.equal(f.p.getInventory().getAmount(IRON_BAR_NOTE), 0);
});

test('with no room for the coins, the stopped offer waits in its collection slot', async t => {
  const f = trader(t, { itemId: IRON_BAR, sell: false, slot: 1, quantity: 2, price: 50 });
  const inventory = f.p.getInventory();
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(1511, 1));
  await modify(f, 1);
  tick();
  tick();
  const offer = f.offers()[1];
  assert.ok(offer?.finished && offer.aborted, 'aborted, still in the slot');
  assert.equal(plugin._test.getOffer(f.p), undefined, 'no setup screen');
  assert.ok(f.messages.some(text => /inventory space/.test(text)));
});

test('closing the exchange during the wait leaves the stopped offer to collect', async t => {
  const f = trader(t, { itemId: IRON_BAR, sell: true, slot: 3, quantity: 4, price: 100 });
  await modify(f, 3);
  f.p.setInterfaceId(-1);
  tick();
  tick();
  assert.ok(f.offers()[3]?.aborted, 'the aborted offer is still there');
  assert.equal(f.p.getInventory().getAmount(IRON_BAR_NOTE), 0);
});

test('Modify on a completed offer changes nothing', async t => {
  const f = trader(t, { itemId: IRON_BAR, sell: true, slot: 4, quantity: 2, price: 100 });
  f.offers()[4].finished = true;
  await modify(f, 4);
  tick();
  tick();
  assert.equal(f.offers()[4].aborted, undefined);
  assert.equal(f.opened.mock.calls.some(({ arguments: [, group] }) => group === LOADING_POPUP), false);
  assert.deepEqual(f.messages, ['That offer has already completed.']);
});

test('a player-wide task cancel during the wait neither strands the popup nor blocks the next Modify', async t => {
  const f = trader(t, { itemId: IRON_BAR, sell: true, slot: 2, quantity: 3, price: 100 });
  f.offers()[5] = { itemId: IRON_BAR, sell: true, slot: 5, quantity: 2, price: 100, total: 200, finished: false, placedAt: Date.now(), completesAt: null };
  await modify(f, 2);
  core.TaskManager.cancelTasks(f.p);
  tick();
  tick();
  assert.ok(f.closed.mock.calls.some(({ arguments: [target] }) => target === OFFER_CONTENTS), 'the popup still closes');
  assert.equal(f.p.getInventory().getAmount(IRON_BAR_NOTE), 3, 'the first offer still comes back');
  tick();
  await modify(f, 5);
  assert.equal(f.offers()[5].aborted, true, 'the second Modify stops its offer');
  tick();
  tick();
  assert.equal(plugin._test.getOffer(f.p)?.slot, 5, 'and opens its setup');
});

test('Collect-all goes on past an offer the inventory has no room for', async t => {
  const f = trader(t, { itemId: IRON_BAR, sell: false, slot: 0, quantity: 2, price: 50 });
  const offers = f.offers();
  offers[0].finished = true;
  offers[0].traded = 100;
  offers[1] = { itemId: IRON_BAR, sell: true, slot: 1, quantity: 1, price: 98, total: 98, traded: 98, finished: true, placedAt: Date.now(), completesAt: null };
  const inventory = f.p.getInventory();
  inventory.setItem(0, new core.Item(COINS, 10));
  for (let slot = 1; slot < 28; slot++) inventory.setItem(slot, new core.Item(1511, 1));
  await button(f, 6, 0);
  assert.ok(offers[0], 'the bars wait for room');
  assert.equal(offers[1], undefined, 'the later sale is collected');
  assert.ok(inventory.getAmount(COINS) > 10);
});

test('a logout during the wait leaves the stopped offer saved in its collection slot', async t => {
  const f = trader(t, { itemId: IRON_BAR, sell: true, slot: 6, quantity: 2, price: 100 });
  await modify(f, 6);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  f.p.setRegistered(false);
  tick();
  tick();
  assert.ok(f.offers()[6]?.aborted, 'still waiting to collect');
  assert.equal(f.p.getInventory().getAmount(IRON_BAR_NOTE), 0, 'nothing handed to a logged-out player');
});
