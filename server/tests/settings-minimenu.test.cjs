// Run after `yarn build`: node --test tests/settings-minimenu.test.cjs
// All Settings > Interfaces > Minimenu: the rows on varp 4503 are saved whether the client changes
// them (the spacing slider, the toggles' local flip) or the server does (the spacing number and
// reset rows), and come back at login.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');

const MINIMENU_VARP = 4503;
const SPACING_VARBIT = 11523; // settings_minimenu_spacing
const ENTITY_FILTER_VARBIT = 11526; // settings_minimenu_filter_entity
const REORDERING_VARBIT = 11521; // settings_minimenu_reordering_toggle: not a row of ours
const SPACING_SCRIPT = 7460;

const handlers = {};
const clickedHandlers = [];
const slots = new Map();

before(async () => {
  await CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onInterfaceActionButton: (_id, fn) => { handlers[fn.name] = fn; },
    onPlayerLogin: (fn) => { handlers[fn.name] = fn; },
    onCustomEvent: (name, fn) => {
      handlers[fn.name] = fn;
      if (name === 'settings:setting-clicked') clickedHandlers.push(fn);
    },
    emitCustomEvent: (name, request) => {
      if (name === 'settings:setting-clicked') for (const fn of clickedHandlers) fn(request);
    },
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const settings = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    settings.forEach(([, s], slot) => {
      const id = Number(CacheDefinitions.getStructParams(Number(s)).get(1077));
      slots.set(id, { category: Number(category.get(743)), slot });
    });
  }
});

/** A player whose varbits live in their varps, as the client keeps them. */
function player(attributes = new Map()) {
  const varps = new Map();
  const scripts = [];
  const prompts = [];
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
    sendClientScript(...args) { scripts.push(args); return sender; },
    sendEnterAmountPrompt(text) { prompts.push(text); return sender; },
    sendMessage() { return sender; },
  };
  const p = {
    varps, scripts, prompts, attributes,
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    getPacketSender: () => sender,
    sendMessage() {},
    setEnteredAmountAction(action) { p.amountAction = action; },
  };
  return p;
}

function click(p, settingId) {
  const { category, slot } = slots.get(settingId);
  p.setAttribute('settings-view', category);
  return handlers.clickSetting({ player: p, slot });
}

/** The client changes a varbit on varp 4503 itself and transmits the whole varp. */
function clientSets(p, varbit, value) {
  const sender = p.getPacketSender();
  sender.sendVarbit(varbit, value);
  handlers.handleSettingsVarpTransmit({ player: p, varpId: MINIMENU_VARP, value: sender.getVarp(MINIMENU_VARP) });
}

function relog(p) {
  const next = player(p.attributes);
  handlers.restoreSettings({ player: next });
  return next.getPacketSender();
}

test('the minimenu varbits are on the transmitted varp', () => {
  for (const varbit of [71, 11520, 11522, SPACING_VARBIT, ENTITY_FILTER_VARBIT, 11530, 11533]) {
    assert.equal(CacheDefinitions.getVarbit(varbit).baseVar, MINIMENU_VARP, `varbit ${varbit}`);
  }
});

test('the spacing slider, changed in the client only, is kept at the next login', () => {
  const p = player();
  clientSets(p, SPACING_VARBIT, 37);
  assert.equal(relog(p).getVarbit(SPACING_VARBIT), 37);
});

test('a filter row flipped by the client and then clicked flips once', () => {
  const p = player();
  clientSets(p, ENTITY_FILTER_VARBIT, 1);
  click(p, 398);
  assert.equal(p.getPacketSender().getVarbit(ENTITY_FILTER_VARBIT), 1, 'the click does not undo the transmitted flip');
  assert.equal(relog(p).getVarbit(ENTITY_FILTER_VARBIT), 1);
  click(p, 398);
  assert.equal(p.getPacketSender().getVarbit(ENTITY_FILTER_VARBIT), 0, 'a later click flips it back');
});

test('a filter row clicked right after a slider change still flips', () => {
  const p = player();
  clientSets(p, SPACING_VARBIT, 12);
  click(p, 405);
  assert.equal(p.getPacketSender().getVarbit(11533), 1, 'the slider change does not stand for the click');
});

test('a bit on the varp that is not a row of ours is not saved', () => {
  const p = player();
  clientSets(p, REORDERING_VARBIT, 1);
  assert.equal(relog(p).getVarbit(REORDERING_VARBIT), 0);
});

test('Minimenu spacing value asks for a number, clamps it, applies it in the client and keeps it', () => {
  const p = player();
  click(p, 394);
  assert.equal(p.prompts.length, 1);
  p.amountAction.execute(250);
  assert.equal(p.getPacketSender().getVarbit(SPACING_VARBIT), 100);
  assert.deepEqual(p.scripts.at(-1), [SPACING_SCRIPT, 100]);
  assert.equal(relog(p).getVarbit(SPACING_VARBIT), 100);
  assert.equal(p.getPacketSender().getVarbit(16075), 0, 'the chatbox prompt flags clear');
});

test('Reset minimenu spacing sets no spacing and applies it in the client', () => {
  const p = player();
  clientSets(p, SPACING_VARBIT, 20);
  click(p, 395);
  assert.equal(p.getPacketSender().getVarbit(SPACING_VARBIT), 0);
  assert.deepEqual(p.scripts.at(-1), [SPACING_SCRIPT, 0]);
  assert.equal(relog(p).getVarbit(SPACING_VARBIT), 0);
});
