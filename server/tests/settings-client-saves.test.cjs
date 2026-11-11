// Run after `yarn build`: node --test tests/settings-client-saves.test.cjs
// Settings the browser client changes by itself: the cache's toggle script flips the row's varbit in
// the client and the varp is transmitted whole, before (or instead of) the row click. The server
// keeps its own rows' bits from that varp, for the next login, without toggling them back.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');

const handlers = {};
const buttons = new Map();
const events = new Map();
const slots = new Map();

const KEYBINDINGS_ESC_TOGGLE = (121 << 16) | 103;
const ANTI_DRAG = 12345;
const PRECISE_TIMING = 11866;
const COLLECTION_LOG_NOTIFY = 11959;
const ESC_CLOSES = 4681;
const BOSS_KC_FILTER = 4930;

before(async () => {
  await CachePipeline.initialize();
  const on = (map) => (id, fn) => {
    handlers[fn.name] = fn;
    for (const key of [id].flat()) map.set(key, [...(map.get(key) ?? []), fn]);
  };
  const api = {
    core: PluginManager.getCoreApi(),
    onInterfaceActionButton: on(buttons),
    onPlayerLogin: (fn) => { handlers[fn.name] = fn; },
    onCustomEvent: on(events),
    emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); },
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const settings = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    settings.forEach(([, s], slot) => slots.set(Number(CacheDefinitions.getStructParams(Number(s)).get(1077)), { category: Number(category.get(743)), slot }));
  }
});

/** A player whose varbits live in their varps, as the client keeps them. */
function player(attributes = new Map()) {
  const varps = new Map();
  const bits = (id) => {
    const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
    return { baseVar, startBit, mask: (2 ** (endBit - startBit + 1) - 1) };
  };
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig(id, value) { varps.set(id, value); return sender; },
    getVarbit(id) { const b = bits(id); return ((varps.get(b.baseVar) ?? 0) >>> b.startBit) & b.mask; },
    sendVarbit(id, value) {
      const b = bits(id);
      varps.set(b.baseVar, ((varps.get(b.baseVar) ?? 0) & ~(b.mask << b.startBit)) | ((value & b.mask) << b.startBit));
      return sender;
    },
    sendClientScript() { return sender; },
    sendMessage() { return sender; },
  };
  return { attributes, sendMessage() {}, getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v), getPacketSender: () => sender };
}

function login(attributes) {
  const p = player(attributes);
  handlers.restoreSettings({ player: p });
  Settings.syncPlayerKeybindings(p);
  return p;
}

function click(p, settingId) {
  const { category, slot } = slots.get(settingId);
  p.setAttribute('settings-view', category);
  return handlers.clickSetting({ player: p, slot });
}

/** The browser sets the varbit itself and transmits its whole varp. */
function flipInClient(p, varbit, value) {
  const varpId = CacheDefinitions.getVarbit(varbit).baseVar;
  const client = player();
  client.getPacketSender().sendConfig(varpId, p.getPacketSender().getVarp(varpId)).sendVarbit(varbit, value);
  const transmission = { player: p, varpId, value: client.getPacketSender().getVarp(varpId), handled: false };
  for (const fn of events.get('player:varp-transmit')) fn(transmission);
  return transmission;
}

test('Anti Drag set in the client is kept for the next login, and its row click does not undo it', () => {
  const p = login();
  assert.equal(flipInClient(p, ANTI_DRAG, 1).handled, true);
  assert.equal(click(p, 115), true);
  assert.equal(p.getPacketSender().getVarbit(ANTI_DRAG), 1, 'the click keeps the transmitted value');
  assert.equal(login(p.attributes).getPacketSender().getVarbit(ANTI_DRAG), 1, 'restored at login');
  flipInClient(p, ANTI_DRAG, 0);
  assert.equal(login(p.attributes).getPacketSender().getVarbit(ANTI_DRAG), 0, 'turned off again');
});

test('a transmit of the shared varp keeps only the settings rows on it, not the collection log bits', () => {
  const p = login();
  p.getPacketSender().sendVarbit(COLLECTION_LOG_NOTIFY, 5);
  flipInClient(p, PRECISE_TIMING, 1);
  const saved = p.getAttribute('settings:values');
  assert.deepEqual(Object.keys(saved), [`varbit:${PRECISE_TIMING}`]);
  assert.equal(p.getPacketSender().getVarbit(COLLECTION_LOG_NOTIFY), 5, 'the collection log bits are left alone');
  const next = login(p.attributes);
  assert.equal(next.getPacketSender().getVarbit(PRECISE_TIMING), 1);
  assert.equal(next.getPacketSender().getVarbit(ANTI_DRAG), 0, 'an unchanged row is not saved');
});

test('a row click with no transmit (the official client) still toggles it on the server', () => {
  const p = login();
  assert.equal(click(p, 115), true);
  assert.equal(p.getPacketSender().getVarbit(ANTI_DRAG), 1);
  assert.equal(login(p.attributes).getPacketSender().getVarbit(ANTI_DRAG), 1);
});

test('Esc closes the current interface, turned off in the client, stays off at the next login', () => {
  const p = login();
  assert.equal(p.getPacketSender().getVarbit(ESC_CLOSES), 1, 'on by default');
  flipInClient(p, ESC_CLOSES, 0);
  assert.equal(click(p, 57), true, 'row 57 is handled');
  assert.equal(p.getPacketSender().getVarbit(ESC_CLOSES), 0, 'the click keeps the transmitted value');
  assert.equal(login(p.attributes).getPacketSender().getVarbit(ESC_CLOSES), 0, 'restored at login');
});

test('Esc closes clicked in All Settings or the keybindings panel without a transmit toggles it', () => {
  const p = login();
  assert.equal(click(p, 57), true);
  assert.equal(p.getPacketSender().getVarbit(ESC_CLOSES), 0);
  const [panel] = buttons.get(KEYBINDINGS_ESC_TOGGLE);
  assert.equal(panel({ player: p, buttonId: KEYBINDINGS_ESC_TOGGLE }), true);
  assert.equal(p.getPacketSender().getVarbit(ESC_CLOSES), 1);
  flipInClient(p, ESC_CLOSES, 0);
  panel({ player: p, buttonId: KEYBINDINGS_ESC_TOGGLE });
  assert.equal(p.getPacketSender().getVarbit(ESC_CLOSES), 0, 'a transmit before the panel click is not toggled back');
  assert.equal(login(p.attributes).getPacketSender().getVarbit(ESC_CLOSES), 0);
});

test('a row sharing varp 1224 with Esc closes is kept from the same transmit', () => {
  assert.equal(CacheDefinitions.getVarbit(BOSS_KC_FILTER).baseVar, CacheDefinitions.getVarbit(ESC_CLOSES).baseVar);
  const p = login();
  flipInClient(p, BOSS_KC_FILTER, 1);
  click(p, 41);
  const next = login(p.attributes);
  assert.equal(next.getPacketSender().getVarbit(BOSS_KC_FILTER), 1);
  assert.equal(next.getPacketSender().getVarbit(ESC_CLOSES), 1, 'Esc closes is left as it was');
});
