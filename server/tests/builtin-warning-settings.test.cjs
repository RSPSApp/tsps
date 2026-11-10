// Run after `yarn build`: node --test tests/builtin-warning-settings.test.cjs
// The Notifications/warning rows of All Settings: each is in the cache, is the type the row
// handler expects, names a real varbit, and a toggle is saved, sent back at login, and defaults as live.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');
const AlchemyThreshold = require('../plugins/interface/AlchemyWarningThreshold.plugin');
const settingsJson = require('../plugins/interface/data/settings.json').settings;

const NEW_TOGGLES = [38, 40, 41, 42, 159, 161, 162, 185, 189, 248, 250, 254, 256, 297, 298, 308, 309, 370,
  420, 421, 422, 423, 446, 448, 456, 463, 467, 469, 471, 500];
const NEW_NUMBERS = { 39: 10000, 43: 150000, 66: 20000 };
// Defaults measured in rsprox: the 703 default-state logins (see docs/settings.md).
const LIVE_DEFAULTS = { 38: 1, 40: 1, 42: 1, 161: 1, 297: 1, 420: 1, 423: 1, ...NEW_NUMBERS };

let clickSetting;
let restoreSettings;
const catalog = new Map();

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
  for (const [, structId] of CacheDefinitions.getEnumValues(422)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    for (const [, s] of CacheDefinitions.getEnumValues(Number(category.get(745)))) {
      const params = CacheDefinitions.getStructParams(Number(s));
      catalog.set(Number(params.get(1077)), Number(params.get(1078) ?? 0));
    }
  }
});

function player() {
  const varbits = new Map();
  const attributes = new Map();
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarp: () => 0,
    sendConfig() { return sender; },
    sendClientScript() { return sender; },
  };
  return { varbits, attributes, getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v), getPacketSender: () => sender };
}

test('every new toggle row is a toggle in the cache and names a real varbit', () => {
  for (const id of NEW_TOGGLES) {
    assert.equal(catalog.get(id), 0, `setting ${id} is a toggle in the cache`);
    const row = settingsJson[id];
    assert.ok(row && Number.isInteger(row.varbit), `setting ${id} has a varbit`);
    assert.ok(CacheDefinitions.getVarbit(row.varbit).baseVar >= 0, `varbit ${row.varbit} exists`);
    assert.equal(row.default, LIVE_DEFAULTS[id], `setting ${id} default matches the captures`);
  }
});

test('the number rows are number inputs in the cache and start at the live value', () => {
  for (const [id, value] of Object.entries(NEW_NUMBERS)) {
    assert.equal(catalog.get(Number(id)), 4, `setting ${id} is a number input in the cache`);
    assert.equal(settingsJson[id].default, value);
  }
});

test('a fresh account is sent the live defaults at login', () => {
  const p = player();
  restoreSettings({ player: p });
  assert.equal(p.varbits.get(5411), 1, 'drop warning on');
  assert.equal(p.varbits.get(5412), 150000);
  assert.equal(p.varbits.get(5399), 1, 'loot notifications on');
  assert.equal(p.varbits.has(13083), false, 'logout notifier off sends nothing');
});

test('clicking the Alchemy threshold asks live\'s prompt and saves the answer through settings:set', () => {
  const log = [];
  let action = null;
  const p = player();
  p.setEnteredAmountAction = (a) => { action = a; };
  p.getPacketSender().sendEnterAmountPrompt = (t) => { log.push(t); };
  const emitted = [];
  AlchemyThreshold._test.setApi({ emitCustomEvent: (n, e) => emitted.push([n, e]) });
  const request = { player: p, settingId: 66, handled: false };
  AlchemyThreshold._test.settingClicked(request);
  assert.equal(request.handled, true);
  assert.deepEqual(log, ['Set value threshold for alchemy warnings:']);
  action.execute(1);
  assert.deepEqual(emitted, [['settings:set', { player: p, settingId: 66, value: 1 }]]);
  action.execute(9e12);
  assert.equal(emitted[1][1].value, 2147483647);
  const other = { player: p, settingId: 5, handled: false };
  AlchemyThreshold._test.settingClicked(other);
  assert.equal(other.handled, false);
});
