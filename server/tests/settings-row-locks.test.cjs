// Run after `yarn build`: node --test tests/settings-row-locks.test.cjs
// All Settings rows the game keeps locked until something is done: a click says the row's own
// locked text (cache param 1116) and leaves the setting as it was, until the player unlocks it.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');

const handlers = {};
const slots = new Map();
/** What other plugins answer, per test: event name -> (request) => void. */
let answers = {};

before(async () => {
  await CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onInterfaceActionButton: (_id, fn) => { handlers[fn.name] = fn; },
    onPlayerLogin: (fn) => { handlers[fn.name] = fn; },
    onCustomEvent: (_name, fn) => { handlers[fn.name] = fn; },
    emitCustomEvent: (name, request) => answers[name]?.(request),
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const settings = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    settings.forEach(([, s], slot) => slots.set(Number(CacheDefinitions.getStructParams(Number(s)).get(1077)), { category: Number(category.get(743)), slot }));
  }
});

function player() {
  const varps = new Map();
  const messages = [];
  const attributes = new Map();
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
  };
  return { messages, sendMessage: (text) => messages.push(text), getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v), getPacketSender: () => sender };
}

function click(p, settingId) {
  const { category, slot } = slots.get(settingId);
  p.setAttribute('settings-view', category);
  return handlers.clickSetting({ player: p, slot });
}

// setting id, its varbit, its locked text in the cache, and the answer that unlocks it.
const LOCKED_ROWS = [
  [296, 14674, 'You must have completed at least one Wilderness achievement diary to access this setting.',
    { 'diary:is-complete': (r) => { if (r.diary === 'wilderness' && r.tier === 'medium') r.complete = true; } }],
  [302, 14711, 'You must complete the Secrets of the North quest to access this setting.',
    { 'quest:is-complete': (r) => { if (r.key === 'secrets_of_the_north') r.complete = true; } }],
  [373, 5983, 'You must complete the Herblore portion of Barbarian Training to access this setting.',
    { 'herblore:unlocked': (r) => { if (r.unlock === 'barbarian_herblore') r.allowed = true; } }],
];

test('a locked row says its cache text and stays as it was, and flips once unlocked', () => {
  for (const [id, varbit, text, unlock] of LOCKED_ROWS) {
    answers = {};
    const p = player();
    const sender = p.getPacketSender();
    assert.equal(click(p, id), true, `row ${id} is handled`);
    assert.deepEqual(p.messages, [text], `row ${id} says its locked text`);
    assert.equal(sender.getVarbit(varbit), 0, `row ${id} is unchanged while locked`);
    assert.equal(p.getAttribute('settings:values'), undefined, `row ${id} saves nothing while locked`);

    answers = unlock;
    const q = player();
    assert.equal(click(q, id), true);
    assert.deepEqual(q.messages, [], `row ${id} says nothing once unlocked`);
    assert.equal(q.getPacketSender().getVarbit(varbit), 1, `row ${id} flips once unlocked`);
  }
});

test('a locked row resends the value it keeps over a flip the client made itself', () => {
  answers = {};
  const p = player();
  const resent = [];
  const sender = p.getPacketSender();
  const send = sender.sendVarbit;
  sender.sendVarbit = (id, value) => { resent.push([id, value]); return send.call(sender, id, value); };
  click(p, 302);
  assert.deepEqual(resent.filter(([id]) => id === 14711), [[14711, 0]]);
});

test('rows with a locked text but no lock condition here are not refused', () => {
  answers = {};
  const p = player();
  assert.equal(Settings.refuseLockedSetting(p, 380), false, 'the barcrawl row is its own plugin\'s');
  assert.equal(Settings.refuseLockedSetting(p, 2), false);
  assert.deepEqual(p.messages, []);
});

test('the lock check is shared: other paths can ask it before changing a row', () => {
  answers = {};
  const p = player();
  assert.equal(Settings.refuseLockedSetting(p, 373), true);
  assert.deepEqual(p.messages, ['You must complete the Herblore portion of Barbarian Training to access this setting.']);
});
