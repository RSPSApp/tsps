// Run after `npx tsc --build`: node --test tests/commemorative-plaques.test.cjs
//
// The Clan Cup Trophy and the Crack the Clue III noticeboard (interface cba_plaque): Read opens
// the plaque with live's title and columns, in live's packet order (rsprox 3172, 3237), on a
// real Player with only the network stubbed; other Noticeboards are left alone.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const Plaques = require('../plugins/world/CommemorativePlaques.plugin');

const hooks = {};
const buttons = {};
let cache;
let index = 1;

before(() => {
  CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => { (hooks[name] ??= []).push(actions); },
    onInterfaceActionButton: (ids, handler) => { for (const id of [ids].flat()) (buttons[id] ??= []).push(handler); },
  };
  Plaques.register(api);
  cache = api.core.CacheDefinitions;
});

/** A real Player with only the network stubbed; the packets it would send are recorded in order. */
function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = [];
  for (const name of ['sendInterface', 'sendString', 'sendClientScript', 'sendInterfaceScript', 'sendInterfaceRemoval']) {
    const original = sender[name];
    t.mock.method(sender, name, function (...args) { p.sent.push([name, ...args]); return original.apply(this, args); });
  }
  return p;
}

function read(player, name, objectId) {
  for (const actions of hooks[name] ?? []) {
    if (actions.Read?.({ player, objectId, option: 'read', clickType: 1, handled: false }) === true) return true;
  }
  return false;
}

/** The packets one Read sent, without the script/interface calls the core makes inside them. */
const opened = (p) => p.sent.filter(([name, id]) => name !== 'sendInterfaceScript' || id === 2524);

test('the Clan Cup Trophy opens the winners list as live sent it (rsprox 3172 tick 2870)', (t) => {
  const p = realPlayer(t);
  assert.equal(read(p, 'Clan Cup Trophy', cache.getLocId('cba_trophy_2013')), true);
  const [mainmodal, iface, title, columns] = opened(p);
  assert.deepEqual(mainmodal.slice(0, 3), ['sendInterfaceScript', 2524, [-1, -1]]);
  assert.deepEqual(iface, ['sendInterface', cache.getInterfaceId('cba_plaque')]);
  assert.deepEqual(title.slice(0, 3), ['sendString', 'Old School Clan Cup Winners', cache.getComponentId('cba_plaque:title')]);
  assert.equal(columns[0], 'sendClientScript');
  assert.equal(columns[1], 498);
  assert.ok(columns[2].startsWith('Ancient Fury:<br>'));
  assert.ok(columns[2].endsWith('Mayhem Makers<br><br><br><br>'));
  assert.ok(columns[3].startsWith('<br>P2P All-Out Champions 2014<br>'));
  assert.ok(columns[3].endsWith('F2P Pure Champions 2013<br><br><br>'));
});

test('the Crack the Clue III noticeboard opens its solvers list (rsprox 3237 tick 1876)', (t) => {
  const p = realPlayer(t);
  assert.equal(read(p, 'Noticeboard', cache.getLocId('crackclue_2022_noticeboard')), true);
  const [, iface, title, columns] = opened(p);
  assert.deepEqual(iface, ['sendInterface', cache.getInterfaceId('cba_plaque')]);
  assert.equal(title[1], 'Crack the Clue III');
  assert.equal(columns[2], 'Player who first solved the event:<br><br><br><br><br>Players who contributed to earlier steps:');
  assert.ok(columns[3].includes('<br><br>Spider1357<br>'));
  assert.ok(columns[3].endsWith('And a huge shout out to the Crack the Clue discord.<br><br><br><br>'));
});

test("the plaque's Close button closes it (rsprox 3172 tick 3042)", (t) => {
  const p = realPlayer(t);
  read(p, 'Clan Cup Trophy', cache.getLocId('cba_trophy_2013'));
  p.sent.length = 0;
  const handlers = buttons[cache.getComponentId('cba_plaque:com_6')] ?? [];
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0]({ player: p, interfaceId: cache.getInterfaceId('cba_plaque') }), true);
  assert.ok(p.sent.some(([name]) => name === 'sendInterfaceRemoval'));
});

test('another Noticeboard is not a plaque', (t) => {
  const p = realPlayer(t);
  const other = cache.getLocId('crackclue_2022_noticeboard') + 1;
  assert.equal(read(p, 'Noticeboard', other), false);
  assert.deepEqual(p.sent, []);
});

test('the cache still has the plaque, its title and its Close button', () => {
  assert.ok(cache.getInterfaceId('cba_plaque') > 0);
  assert.ok(cache.getComponentId('cba_plaque:title') > 0);
  assert.ok(cache.getComponentId('cba_plaque:com_6') > 0);
});
