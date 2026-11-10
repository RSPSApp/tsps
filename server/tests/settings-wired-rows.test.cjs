// Run after `yarn build`: node --test tests/settings-wired-rows.test.cjs
// All Settings rows whose effect the client scripts (or our own code) already apply. Each row is in
// the cache with the type its handler expects, names the var the cache's own setting reader reads
// (script 6716 for toggles, 3962 for dropdowns), flips or sets it on click, and comes back at login.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CacheIndexDat2 } = require('../dist/game/cache/codec/rs/cache/CacheIndex');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');
const settingsJson = require('../plugins/interface/data/settings.json').settings;

const TOGGLE = 0;
const DROPDOWN = 2;
// setting id -> the varbit its row sets. Toggles unless listed in DROPDOWNS.
const TOGGLES = {
  2: 4609, 3: 4181, 4: 5711, 6: 5712, 9: 10113, 265: 14179, 442: 17772, 472: 19615, 473: 19646, 474: 19647,
};
const DROPDOWNS = { 1: 6374 };
// Live defaults that are not zero: the fresh-account (Tutorial Island) logins in the rsprox captures.
const LIVE_DEFAULTS = { 2: 1 };

const CLIENT_SCRIPTS = 12;
const TOGGLE_READER = 6716;
const DROPDOWN_READER = 3962;
const PUSH_VARP = 1;
const PUSH_VARBIT = 25;
const GOSUB = 40;
const SWITCH = 60;

const handlers = {};
const catalog = new Map();
const slots = new Map();

/** A client script's instructions and switch tables, as the client decodes them. */
function readScript(id) {
  const data = Buffer.from(CacheIndexDat2.fromStore(CLIENT_SCRIPTS, CachePipeline.getStore()).getArchive(id).getFile(0).data);
  const switchLength = data.readUInt16BE(data.length - 2);
  const end = data.length - 2 - switchLength - 16; // rev 241 scripts carry long local/argument counts
  let at = end + 16;
  const switches = [];
  for (let i = 0, n = data[at++]; i < n; i++) {
    const cases = new Map();
    for (let count = data.readUInt16BE(at), k = (at += 2, 0); k < count; k++, at += 8) cases.set(data.readInt32BE(at), data.readInt32BE(at + 4));
    switches.push(cases);
  }
  const ops = [];
  const operands = [];
  at = data.indexOf(0) + 1; // after the script's name
  while (at < end) {
    const op = data.readUInt16BE(at);
    at += 2;
    let operand = 0;
    if (op === 3) at = data.indexOf(0, at) + 1;
    else if (op === 61) at += 8;
    else if (op === 21 || op === 38 || op === 39 || op === 62 || op === 63 || op >= 100) operand = data[at++];
    else { operand = data.readInt32BE(at); at += 4; }
    ops.push(op);
    operands.push(operand);
  }
  return { ops, operands, switches };
}

/** The first instructions a reader script runs for one setting id. */
function readerCase(scriptId, settingId) {
  const script = readScript(scriptId);
  const pc = script.ops.indexOf(SWITCH);
  const offset = script.switches[script.operands[pc]].get(settingId);
  assert.notEqual(offset, undefined, `script ${scriptId} has a case for setting ${settingId}`);
  const start = pc + offset + 1;
  return script.ops.slice(start, start + 3).map((op, i) => [op, script.operands[start + i]]);
}

before(async () => {
  await CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onInterfaceActionButton: (_id, fn) => { handlers[fn.name] = fn; },
    onPlayerLogin: (fn) => { handlers[fn.name] = fn; },
    onCustomEvent: (_name, fn) => { handlers[fn.name] = fn; },
    emitCustomEvent: () => {},
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const settings = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    settings.forEach(([, s], slot) => {
      const params = CacheDefinitions.getStructParams(Number(s));
      const id = Number(params.get(1077));
      catalog.set(id, Number(params.get(1078) ?? 0));
      slots.set(id, { category: Number(category.get(743)), slot });
    });
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
  };
  return { varps, attributes, getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v), getPacketSender: () => sender };
}

/** Clicks a setting's row in its own category. */
function click(p, settingId) {
  const { category, slot } = slots.get(settingId);
  p.setAttribute('settings-view', category);
  return handlers.clickSetting({ player: p, slot });
}

function choose(p, settingId, option) {
  click(p, settingId);
  return handlers.clickDropdownOption({ player: p, slot: option * 3 });
}

test('every wired row is in the cache, is the type its handler expects, and names the var the cache reads', () => {
  for (const [rows, type, reader] of [[TOGGLES, TOGGLE, TOGGLE_READER], [DROPDOWNS, DROPDOWN, DROPDOWN_READER]]) {
    for (const [id, varbit] of Object.entries(rows)) {
      assert.equal(catalog.get(Number(id)), type, `setting ${id} is ${type === TOGGLE ? 'a toggle' : 'a dropdown'} in the cache`);
      assert.equal(settingsJson[id]?.varbit, varbit, `settings.json row ${id}`);
      assert.deepEqual(readerCase(reader, Number(id))[0], [PUSH_VARBIT, varbit], `script ${reader} reads varbit ${varbit} for setting ${id}`);
      assert.equal(settingsJson[id].default, LIVE_DEFAULTS[id], `setting ${id} default matches the captures`);
    }
  }
});

test('a wired toggle flips on click, and its choice comes back at the next login', () => {
  for (const [id, varbit] of Object.entries(TOGGLES)) {
    const p = player();
    handlers.restoreSettings({ player: p });
    const start = p.getPacketSender().getVarbit(varbit);
    assert.equal(click(p, Number(id)), true, `setting ${id} is handled`);
    assert.equal(p.getPacketSender().getVarbit(varbit), 1 - start, `setting ${id} flips varbit ${varbit}`);
    const next = player(p.attributes);
    handlers.restoreSettings({ player: next });
    assert.equal(next.getPacketSender().getVarbit(varbit), 1 - start, `setting ${id} is restored at login`);
  }
});

test('a wired dropdown sets its var to the option chosen, and keeps it at the next login', () => {
  for (const [id, varbit] of Object.entries(DROPDOWNS)) {
    const p = player();
    assert.equal(choose(p, Number(id), 1), true);
    assert.equal(p.getPacketSender().getVarbit(varbit), 1);
    const next = player(p.attributes);
    handlers.restoreSettings({ player: next });
    assert.equal(next.getPacketSender().getVarbit(varbit), 1);
  }
});

test('a fresh account starts with the side panel setting live sends', () => {
  const p = player();
  handlers.restoreSettings({ player: p });
  assert.equal(p.getPacketSender().getVarbit(4609), 1);
});
