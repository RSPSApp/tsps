// Run after `yarn build`: node --test tests/settings-follower-ops.test.cjs
// All Settings > Controls "Move follower options lower down" (setting 50, varbit 5599
// followerops_deprioritised) is saved when clicked and sent back at the next login. The gameframe's
// var-change script (902) then runs script 907, which reads the varbit and moves the options down.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');

const FOLLOWER_OPS_SETTING = 50;
const FOLLOWER_OPS_VARBIT = 5599;
const SEARCH_CATEGORIES_ENUM = 422;

let clickSetting;
let restoreSettings;

before(async () => {
  await CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = {
    core,
    onInterfaceActionButton: (_id, fn) => { if (fn.name === 'clickSetting') clickSetting = fn; },
    onPlayerLogin: (fn) => { if (fn.name === 'restoreSettings') restoreSettings = fn; },
    emitCustomEvent: () => {},
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
});

/** The category the setting is in, and its row there, from the cache's settings enums. */
function locate(settingId) {
  for (const [, structId] of CacheDefinitions.getEnumValues(SEARCH_CATEGORIES_ENUM)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const rows = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    const row = rows.findIndex(([, s]) => Number(CacheDefinitions.getStructParams(Number(s)).get(1077)) === settingId);
    if (row >= 0) return { category: Number(category.get(743)), row };
  }
  return undefined;
}

/** A player whose attributes survive a "relog" (the same map) and whose client starts from zero. */
function player(attributes = new Map()) {
  const varbits = new Map();
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarp: () => 0,
    sendConfig() { return sender; },
    sendClientScript() { return sender; },
  };
  return {
    attributes,
    varbits,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
  };
}

test('the setting is the cache\'s "Move follower options lower down" toggle on varbit 5599', () => {
  assert.equal(CacheDefinitions.getVarbitId('followerops_deprioritised'), FOLLOWER_OPS_VARBIT);
  assert.ok(locate(FOLLOWER_OPS_SETTING), 'setting 50 is a row in a settings category');
});

test('Move follower options lower down stays on after logging in again, and off once turned off', () => {
  const { category, row } = locate(FOLLOWER_OPS_SETTING);
  const first = player();
  first.setAttribute('settings-view', category);
  assert.equal(clickSetting({ player: first, slot: row }), true, 'the server handles the row');
  assert.equal(first.varbits.get(FOLLOWER_OPS_VARBIT), 1, 'turned on');

  const relogged = player(first.attributes);
  restoreSettings({ player: relogged });
  assert.equal(relogged.varbits.get(FOLLOWER_OPS_VARBIT), 1, 'sent again at login');

  relogged.setAttribute('settings-view', category);
  clickSetting({ player: relogged, slot: row });
  const again = player(relogged.attributes);
  restoreSettings({ player: again });
  assert.equal(again.varbits.get(FOLLOWER_OPS_VARBIT), 0, 'turning it off is saved too');
});
