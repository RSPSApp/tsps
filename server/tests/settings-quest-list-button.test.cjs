// Run after `yarn build`: node --test tests/settings-quest-list-button.test.cjs
// The quest list's settings button runs clientscript 5968 settings_search_override("Quest List") and opens
// All Settings without changing the category (rsprox_transcripts/226/01637.txt, 01662.txt).
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
  const script = out.sendClientScript.bind(out);
  const mount = out.sendSubInterface.bind(out);
  t.mock.method(out, 'sendClientScript', (...a) => { scripts.push(a); return script(...a); });
  t.mock.method(out, 'sendSubInterface', (...a) => { mounts.push(a); return mount(...a); });
  const categoryVarbit = core.CacheDefinitions.getVarbitId('settings_category');
  const category = out.getVarbit(categoryVarbit);

  const buttonId = core.CacheDefinitions.getComponentId('questlist:settings_button');
  PluginManager.emitInterfaceActionClick({
    player, buttonId, groupId: buttonId >>> 16, componentId: buttonId & 65535,
    action: 1, slot: -1, itemId: -1, handled: false,
  });

  assert.deepEqual(scripts[0], [5968, 'Quest List']);
  assert.ok(mounts.some((m) => m[1] === core.CacheDefinitions.getInterfaceId('settings')), 'All Settings opens');
  assert.equal(out.getVarbit(categoryVarbit), category, 'category untouched');
});
