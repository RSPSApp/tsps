// Run after `yarn build`: node --test tests/settings-transparent-chatbox.test.cjs
// All Settings > Display "Transparent chatbox" (setting 11, varbit 4608) is saved when clicked
// and sent back at the next login, like every row in plugins/interface/data/settings.json.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');

const TRANSPARENT_CHATBOX_SETTING = 11;
const CHATBOX_TRANSPARENCY_VARBIT = 4608;
const DISPLAY_CATEGORY = 6;
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

/** The row the setting is on in its category, from the cache's settings enums. */
function displayRow(settingId) {
  for (const [, structId] of CacheDefinitions.getEnumValues(SEARCH_CATEGORIES_ENUM)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    if (Number(category.get(743)) !== DISPLAY_CATEGORY) continue;
    const rows = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    return rows.findIndex(([, s]) => Number(CacheDefinitions.getStructParams(Number(s)).get(1077)) === settingId);
  }
  return -1;
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

test('Transparent chatbox stays on after logging in again', () => {
  const slot = displayRow(TRANSPARENT_CHATBOX_SETTING);
  assert.ok(slot >= 0, 'setting 11 is a Display row');

  const before = player();
  before.setAttribute('settings-view', DISPLAY_CATEGORY);
  assert.equal(clickSetting({ player: before, slot }), true);
  assert.equal(before.varbits.get(CHATBOX_TRANSPARENCY_VARBIT), 1, 'turned on');

  const after = player(before.attributes);
  restoreSettings({ player: after });
  assert.equal(after.varbits.get(CHATBOX_TRANSPARENCY_VARBIT), 1, 'sent again at login');

  after.setAttribute('settings-view', DISPLAY_CATEGORY);
  clickSetting({ player: after, slot });
  const again = player(after.attributes);
  restoreSettings({ player: again });
  assert.equal(again.varbits.get(CHATBOX_TRANSPARENCY_VARBIT), 0, 'turning it off is saved too');
});
