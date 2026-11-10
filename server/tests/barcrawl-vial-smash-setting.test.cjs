// Run after `yarn build`: node --test tests/barcrawl-vial-smash-setting.test.cjs
// All Settings "Automatically smash empty vials" (setting 380, varbit 5668) is the barbarian guard's
// barcrawl reward: the row toggles it once the miniquest is handed in, and keeps it off before then.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');
const registerBarcrawl = require('../plugins/quests/quests/AlfredGrimhandsBarcrawl.Quest');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');

const AUTO_SMASH_SETTING = 380;
const AUTO_SMASH_VARBIT = 5668;
const AUTO_SMASH_ATTRIBUTE = 'alfred-grimhands-barcrawl:auto-smash';
const SEARCH_CATEGORIES_ENUM = 422;

let clickSetting;
let quest;

before(async () => {
  await CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const listeners = new Map();
  const api = {
    core,
    onInterfaceActionButton: (_id, fn) => { if (fn.name === 'clickSetting') clickSetting = fn; },
    onCustomEvent: (event, fn) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
    emitCustomEvent: (event, payload) => { for (const fn of listeners.get(event) ?? []) fn(payload); },
  };
  const proxied = new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) });
  Settings.register(proxied);
  registerBarcrawl(proxied);
  quest = getRegisteredQuests().findLast((entry) => entry.key === 'alfred-grimhands-barcrawl');
});

/** The category and row the setting sits on, from the cache's settings enums. */
function rowOf(settingId) {
  for (const [, structId] of CacheDefinitions.getEnumValues(SEARCH_CATEGORIES_ENUM)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const rows = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    const slot = rows.findIndex(([, s]) => Number(CacheDefinitions.getStructParams(Number(s)).get(1077)) === settingId);
    if (slot >= 0) return { category: Number(category.get(743)), slot };
  }
  return null;
}

function player() {
  const attributes = new Map(), varbits = new Map(), messages = [];
  const sender = new Proxy({
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarp: () => 0,
  }, { get: (t, p) => (p in t ? t[p] : () => sender) });
  return {
    attributes, varbits, messages,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };
}

function click(p) {
  const row = rowOf(AUTO_SMASH_SETTING);
  assert.ok(row, 'setting 380 is an All Settings row');
  p.setAttribute('settings-view', row.category);
  return clickSetting({ player: p, slot: row.slot });
}

test('after the barcrawl the settings row turns vial smashing on and off', () => {
  const p = player();
  quest.setStage(p, 2);
  assert.equal(click(p), true);
  assert.equal(p.varbits.get(AUTO_SMASH_VARBIT), 1);
  assert.equal(p.getAttribute(AUTO_SMASH_ATTRIBUTE), true, 'saved where the guard and login read it');
  click(p);
  assert.equal(p.varbits.get(AUTO_SMASH_VARBIT), 0);
  assert.equal(p.getAttribute(AUTO_SMASH_ATTRIBUTE), false);
});

test('before the barcrawl is handed in the row leaves vial smashing off', () => {
  for (const stage of [0, 1]) {
    const p = player();
    quest.setStage(p, stage);
    p.varbits.set(AUTO_SMASH_VARBIT, 1); // a client that changed it locally
    assert.equal(click(p), true);
    assert.equal(p.varbits.get(AUTO_SMASH_VARBIT), 0, `stage ${stage}`);
    assert.equal(p.getAttribute(AUTO_SMASH_ATTRIBUTE), false, `stage ${stage}`);
  }
});
