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

const AntiDragDelay = require('../plugins/interface/AntiDragDelay.plugin')._test;
const DELAY = 13830;
const ENABLE_KEY = 13828;
const DISABLE_KEY = 13829;
const KEY_OPTIONS_ENUM = 4302;

function choose(p, settingId, option) {
  click(p, settingId);
  return handlers.clickDropdownOption({ player: p, slot: option * 3 });
}

test('Anti Drag - Delay asks for milliseconds and keeps them in 20 ms steps, up to 5000', () => {
  AntiDragDelay.setApi({ emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); } });
  for (const [answer, steps] of [[0, 0], [100, 5], [109, 5], [111, 6], [5000, 250], [99999, 250], [-5, 0]]) {
    const p = login();
    let action = null;
    let prompt = null;
    p.setEnteredAmountAction = (a) => { action = a; };
    p.getPacketSender().sendEnterAmountPrompt = (text) => { prompt = text; };
    const request = { player: p, settingId: 236, handled: false };
    AntiDragDelay.settingClicked(request);
    assert.equal(request.handled, true);
    assert.match(prompt, /Anti Drag delay/);
    action.execute(answer);
    assert.equal(p.getPacketSender().getVarbit(DELAY), steps, `${answer} ms`);
    assert.equal(login(p.attributes).getPacketSender().getVarbit(DELAY), steps, `${answer} ms is restored at login`);
  }
});

test('Anti Drag - Delay closed without an answer clears the chatbox flags and keeps the delay; 0 still sets it', () => {
  const { PacketSender } = require('../dist/net/packet/PacketSender');
  const FLOATER = 16075;
  const BUSY = 12393;
  AntiDragDelay.setApi({ emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); } });
  const p = login();
  let action = null;
  const sent = [];
  p.getEnteredAmountAction = () => action;
  p.setEnteredAmountAction = (a) => { action = a; };
  p.getEnteredSyntaxAction = () => null;
  p.setEnteredSyntaxAction = () => {};
  p.getSession = () => ({ sendClientPacket: (packet) => sent.push(packet) });
  p.getPacketSender().sendEnterAmountPrompt = () => {};
  const abort = () => PacketSender.prototype.abortInputPrompt.call(Object.assign(Object.create(PacketSender.prototype), { player: p }));
  const ask = () => AntiDragDelay.settingClicked({ player: p, settingId: 236, handled: false });

  ask();
  action.execute(100);
  assert.equal(p.getPacketSender().getVarbit(DELAY), 5);
  ask();
  assert.equal(p.getPacketSender().getVarbit(FLOATER), 1);
  assert.equal(p.getPacketSender().getVarbit(BUSY), 1);
  abort();
  assert.equal(action, null, 'the abort drops the action');
  assert.equal(sent.length, 1, 'the client is told to close the prompt');
  assert.equal(p.getPacketSender().getVarbit(FLOATER), 0, 'floater flag cleared');
  assert.equal(p.getPacketSender().getVarbit(BUSY), 0, 'busy flag cleared');
  assert.equal(login(p.attributes).getPacketSender().getVarbit(DELAY), 5, 'the delay is kept');

  ask();
  action.execute(0);
  assert.equal(p.getPacketSender().getVarbit(DELAY), 0, 'answering 0 sets no delay');
  assert.equal(p.getPacketSender().getVarbit(FLOATER), 0);
  assert.equal(login(p.attributes).getPacketSender().getVarbit(DELAY), 0);
});

test('Anti Drag enable and disable keys store the key code the cache reads back as the option', () => {
  // Script 3962 shows the option enum 4302 maps the varbit's key code to.
  const optionOf = new Map([...CacheDefinitions.getEnumValues(KEY_OPTIONS_ENUM)].map(([key, option]) => [Number(option), Number(key)]));
  assert.deepEqual([...optionOf.values()], [0, 81, 82]);
  for (const [settingId, varbit] of [[237, ENABLE_KEY], [238, DISABLE_KEY]]) {
    for (const option of [1, 2, 0]) {
      const p = login();
      assert.equal(choose(p, settingId, option), true, `row ${settingId} option ${option} is handled`);
      assert.equal(p.getPacketSender().getVarbit(varbit), optionOf.get(option));
      assert.equal(login(p.attributes).getPacketSender().getVarbit(varbit), optionOf.get(option), 'restored at login');
    }
  }
  const p = login();
  choose(p, 237, 1);
  choose(p, 238, 2);
  assert.equal(p.getPacketSender().getVarbit(ENABLE_KEY), 81, 'the two keys share a varp without clearing each other');
});

const RELICS_HIDDEN = 12383;
const BUFF_BAR_HIDDEN = 9528;

test('relics hidden from the buff bar itself, with no row click, stay hidden at the next login', () => {
  const p = login();
  flipInClient(p, RELICS_HIDDEN, 1);
  const next = login(p.attributes);
  assert.equal(next.getPacketSender().getVarbit(RELICS_HIDDEN), 1);
  assert.equal(next.getPacketSender().getVarbit(BUFF_BAR_HIDDEN), 0, 'the other buff bar rows on the varp are left alone');
  flipInClient(next, RELICS_HIDDEN, 0);
  assert.equal(click(next, 127), true, 'the Display Relics row click after the client flipped it');
  assert.equal(login(next.attributes).getPacketSender().getVarbit(RELICS_HIDDEN), 0);
});

test('a transmit that changes none of the rows does not swallow the next row click', () => {
  const p = login();
  flipInClient(p, COLLECTION_LOG_NOTIFY, 3);
  assert.equal(click(p, 115), true);
  assert.equal(p.getPacketSender().getVarbit(ANTI_DRAG), 1, 'the click still toggles it');
});

test('the Emotes and Account keybind rows (21, 26) save their keys for the next login', () => {
  const p = login();
  for (const [settingId, varbit, key] of [[21, 4687, 7], [26, 6517, 11]]) {
    click(p, settingId);
    assert.equal(handlers.clickDropdownOption({ player: p, slot: key * 3 }), true, `row ${settingId} takes F${key}`);
    assert.equal(p.getPacketSender().getVarbit(varbit), key);
  }
  const next = login(p.attributes);
  assert.equal(next.getPacketSender().getVarbit(4687), 7, 'Emotes key restored at login');
  assert.equal(next.getPacketSender().getVarbit(6517), 11, 'Account key restored at login');
  assert.equal(next.getPacketSender().getVarbit(4683), 0, 'Clan chat gave up F7');
});

test('Restore default keybinds (row 58) resets every key and saves it, as the panel button does', () => {
  const restored = (via) => {
    const p = login();
    click(p, 21);
    handlers.clickDropdownOption({ player: p, slot: 1 * 3 });
    click(p, 57);
    assert.equal(p.getPacketSender().getVarbit(4675), 0, 'Combat gave up F1');
    const messages = [];
    p.getPacketSender().sendMessage = (text) => { messages.push(text); return p.getPacketSender(); };
    assert.equal(via(p), true);
    assert.deepEqual(messages, ['Keybindings restored to default.']);
    return login(p.attributes);
  };
  const fromRow = restored((p) => click(p, 58));
  const fromPanel = restored((p) => buttons.get((121 << 16) | 104)[0]({ player: p }));
  const fresh = login();
  for (const varbit of [4675, 4676, 4677, 4678, 4679, 4680, 4682, 4683, 4684, 4686, 4687, 4688, 4689, 6517, ESC_CLOSES]) {
    const expected = fresh.getPacketSender().getVarbit(varbit);
    assert.equal(fromRow.getPacketSender().getVarbit(varbit), expected, `varbit ${varbit} after the row`);
    assert.equal(fromPanel.getPacketSender().getVarbit(varbit), expected, `varbit ${varbit} after the panel button`);
  }
  assert.equal(fresh.getPacketSender().getVarbit(4675), 1, 'Combat is F1 by default');
});

test('a new account starts with the keys live gives one', () => {
  const sender = login().getPacketSender();
  const keys = { 4675: 1, 4676: 2, 4677: 3, 4678: 13, 4679: 4, 4680: 5, 4682: 6, 4683: 7, 4684: 8, 6517: 9, 4689: 0, 4686: 10, 4687: 11, 4688: 12 };
  for (const [varbit, key] of Object.entries(keys)) assert.equal(sender.getVarbit(Number(varbit)), key, `varbit ${varbit}`);
  assert.equal(sender.getVarbit(ESC_CLOSES), 1, 'Esc closes the current interface is on');
});
