// Run after `yarn build`: node --test tests/settings-quest-list-button.test.cjs
// The quest list settings button turns the client search on, runs clientscript 5968
// settings_search_override("Quest List") and opens All Settings without changing the category
// (rsprox_transcripts/226/01637.txt, 01662.txt; live order in 242/900308.txt 1974-1991, 242/900231.txt 35465-35503).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
});

test('quest list settings button searches All Settings for "Quest List" and keeps the category', (t) => {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(731);
  player.setUsername('questset731');
  const out = player.getPacketSender();
  const scripts = [];
  const mounts = [];
  const order = [];
  const script = out.sendClientScript.bind(out);
  const mount = out.sendSubInterface.bind(out);
  const varbit = out.sendVarbit.bind(out);
  t.mock.method(out, 'sendClientScript', (...a) => { scripts.push(a); order.push(`script:${a[0]}`); return script(...a); });
  t.mock.method(out, 'sendSubInterface', (...a) => { mounts.push(a); order.push('mount'); return mount(...a); });
  t.mock.method(out, 'sendVarbit', (...a) => { order.push(`varbit:${a[0]}=${a[1]}`); return varbit(...a); });
  const categoryVarbit = core.CacheDefinitions.getVarbitId('settings_category');
  const category = out.getVarbit(categoryVarbit);
  const searching = core.CacheDefinitions.getVarbitId('floater_is_searching');
  const listening = core.CacheDefinitions.getVarbitId('floater_search_listen_for_keyboard');

  const buttonId = core.CacheDefinitions.getComponentId('questlist:settings_button');
  PluginManager.emitInterfaceActionClick({
    player, buttonId, groupId: buttonId >>> 16, componentId: buttonId & 65535,
    action: 1, slot: -1, itemId: -1, handled: false,
  });

  assert.deepEqual(scripts[0], [5968, 'Quest List']);
  assert.ok(mounts.some((m) => m[1] === core.CacheDefinitions.getInterfaceId('settings')), 'All Settings opens');
  assert.equal(out.getVarbit(categoryVarbit), category, 'category untouched');

  // The client only filters rows while its search is on.
  assert.equal(out.getVarbit(searching), 1, 'client search on');
  assert.equal(out.getVarbit(listening), 1, 'search listens for the keyboard');
  const flow = order.filter((e) => e === 'mount' || e.startsWith('script:') || e.startsWith(`varbit:${searching}=`) || e.startsWith(`varbit:${listening}=`));
  assert.deepEqual(flow, [`varbit:${searching}=1`, `varbit:${listening}=1`, 'script:5968', 'mount', 'script:4020']);

  // A row click resolves through the whole search list. Live clicked setting 214 at sub=327 (900308);
  // the shared catalog holds 214 at index 328, so this asserts the slot the existing search path uses.
  const rows = core.CacheDefinitions.getComponentId('settings:settings_clickzone');
  PluginManager.emitInterfaceActionClick({
    player, buttonId: rows, groupId: rows >>> 16, componentId: rows & 65535,
    action: 1, slot: 328, itemId: -1, handled: false,
  });
  assert.equal(player.getAttribute('settings:selected'), 214);

  // Closing All Settings lets the search go.
  PluginManager.emitCustomEvent('interface:closed', { player, interfaceId: core.CacheDefinitions.getInterfaceId('settings') });
  assert.equal(out.getVarbit(searching), 0);
  assert.equal(out.getVarbit(listening), 0);
});
