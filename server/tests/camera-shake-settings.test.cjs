// Run after `yarn build`: node --test tests/camera-shake-settings.test.cjs
// The camera shake rows of All Settings: each is a toggle in the cache on the varbit the shake checks,
// a master off turns off its whole group, a sub-row off turns off its own effect, and every camera
// shake in the plugins goes through CameraShake.send with a known effect.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');
const CameraShake = require('../plugins/interface/CameraShake.plugin');
const settingsJson = require('../plugins/interface/data/settings.json').settings;

const COMBAT = 16106;
const ATMOSPHERIC = 16110;
// Struct param 1080 names a sub-row's group; the settings scripts read the master for it.
const GROUP_MASTER = { 3335: COMBAT, 5198: ATMOSPHERIC };
const ROWS = { 425: COMBAT, 426: ATMOSPHERIC, 427: 16107, 428: 16108, 429: 16109, 445: 17776, 281: 14197, 282: 4814, 283: 14198 };

let restoreSettings;
const structs = new Map();

before(async () => {
  await CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  const api = { core, onPlayerLogin: (fn) => { if (fn.name === 'restoreSettings') restoreSettings = fn; }, emitCustomEvent: () => {} };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of CacheDefinitions.getEnumValues(422)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    for (const [, s] of CacheDefinitions.getEnumValues(Number(category.get(745)))) {
      const params = CacheDefinitions.getStructParams(Number(s));
      structs.set(Number(params.get(1077)), params);
    }
  }
});

function sender(varbits = {}) {
  const values = new Map(Object.entries(varbits).map(([k, v]) => [Number(k), v]));
  const shakes = [];
  const s = {
    shakes,
    getVarbit: (id) => values.get(id) ?? 0,
    sendVarbit(id, value) { values.set(id, value); return s; },
    getVarp: () => 0,
    sendConfig() { return s; },
    sendClientScript() { return s; },
    sendCameraShake(...args) { shakes.push(args); return s; },
  };
  return s;
}

function player(varbits) {
  const s = sender(varbits);
  const attributes = new Map();
  return { getPacketSender: () => s, getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v) };
}

test('every camera shake row is a toggle in the cache on the varbit its effect checks', () => {
  const byVarbit = new Map(Object.values(CameraShake.EFFECTS).filter((e) => e.varbit).map((e) => [e.settingId, e]));
  for (const [id, varbit] of Object.entries(ROWS)) {
    const params = structs.get(Number(id));
    assert.ok(params, `setting ${id} is in the cache`);
    assert.equal(Number(params.get(1078) ?? 0), 0, `setting ${id} is a toggle`);
    assert.deepEqual(settingsJson[id], { name: params.get(1086).replace(/\.$/, ''), varbit }, `setting ${id} in settings.json`);
    assert.ok(CacheDefinitions.getVarbit(varbit).baseVar >= 0, `varbit ${varbit} exists`);
    const group = params.get(1080);
    if (varbit === COMBAT || varbit === ATMOSPHERIC) {
      assert.equal(group, undefined, `setting ${id} is a master`);
      continue;
    }
    const effect = byVarbit.get(Number(id));
    assert.equal(effect.varbit, varbit, `setting ${id} effect var`);
    assert.equal(effect.master.varbit, GROUP_MASTER[Number(group)], `setting ${id} belongs to its cache group`);
  }
});

test('a master off turns off its whole group, a sub-row off only its own effect', () => {
  const cases = [
    [{}, { combat: true, atmospheric: true, doom: true, barrows: true }],
    [{ [COMBAT]: 1 }, { combat: false, doom: false, olm: false, atmospheric: true, barrows: true }],
    [{ [ATMOSPHERIC]: 1 }, { atmospheric: false, babaYaga: false, trawler: false, barrows: false, combat: true, doom: true }],
    [{ 17776: 1 }, { doom: false, combat: true, shamans: true }],
    [{ 14198: 1 }, { barrows: false, atmospheric: true, babaYaga: true }],
  ];
  for (const [varbits, expected] of cases) {
    const s = sender(varbits);
    for (const [effect, allowed] of Object.entries(expected)) {
      assert.equal(CameraShake.allowed(s, effect), allowed, `${effect} with ${JSON.stringify(varbits)}`);
    }
  }
  assert.throws(() => CameraShake.allowed(sender(), 'earthquake'), /Unknown camera shake effect/);
});

test('send shakes only when allowed, always sends a stop, and returns the sender', () => {
  const on = sender();
  assert.equal(CameraShake.send(on, 'doom', 1, 8), on);
  assert.deepEqual(on.shakes, [[1, 8]], 'the shake goes out as the caller wrote it');
  const off = sender({ [COMBAT]: 1 });
  CameraShake.send(off, 'doom', 1, 8, 2, 3);
  CameraShake.send(off, 'combat', 0, 0, 5, 10);
  assert.deepEqual(off.shakes, []);
  CameraShake.send(off, 'combat', 0, 0);
  CameraShake.send(off, 'combat', 3, 0, 0, 0);
  assert.deepEqual(off.shakes, [[0, 0], [3, 0, 0, 0]]);
  const bare = { getVarbit: () => 0 };
  assert.equal(CameraShake.send(bare, 'combat', 0, 5), bare, 'a sender without the packet is left alone');
});

test('a sub-row stays put while its master is off', () => {
  const locked = { player: player({ [COMBAT]: 1 }), settingId: 445, handled: false };
  CameraShake._test.settingClicked(locked);
  assert.equal(locked.handled, true);
  const open = { player: player(), settingId: 445, handled: false };
  CameraShake._test.settingClicked(open);
  assert.equal(open.handled, false);
  const master = { player: player({ [COMBAT]: 1 }), settingId: 425, handled: false };
  CameraShake._test.settingClicked(master);
  assert.equal(master.handled, false, 'the master itself still toggles');
  const otherGroup = { player: player({ [COMBAT]: 1 }), settingId: 283, handled: false };
  CameraShake._test.settingClicked(otherGroup);
  assert.equal(otherGroup.handled, false);
});

test('the rows start on and come back at login', () => {
  const fresh = player();
  restoreSettings({ player: fresh });
  for (const varbit of Object.values(ROWS)) assert.equal(fresh.getPacketSender().getVarbit(varbit), 0, `varbit ${varbit} starts at 0`);
  const saved = player();
  saved.setAttribute('settings:values', { [`varbit:${COMBAT}`]: 1, 'varbit:14198': 1 });
  restoreSettings({ player: saved });
  assert.equal(saved.getPacketSender().getVarbit(COMBAT), 1);
  assert.equal(saved.getPacketSender().getVarbit(14198), 1);
});

function pluginSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pluginSources(full, out);
    else if (/\.(c?js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('every camera shake in the plugins names a known effect, and none goes around them', () => {
  const root = path.join(__dirname, '..', 'plugins');
  const helper = path.join(root, 'interface', 'CameraShake.plugin.js');
  const calls = [];
  for (const file of pluginSources(root)) {
    if (file === helper) continue;
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    assert.doesNotMatch(src, /\.sendCameraShake\b/, `${rel} sends a camera shake without CameraShake.send`);
    for (const m of src.matchAll(/CameraShake\.send\(/g)) {
      const rest = src.slice(m.index + m[0].length);
      const effect = /^[^,]+,\s*"([A-Za-z]+)"\s*,/.exec(rest)?.[1];
      assert.ok(effect && CameraShake.EFFECTS[effect], `${rel}: CameraShake.send names a known effect (${rest.slice(0, 60)})`);
      calls.push(effect);
    }
  }
  const src = path.join(__dirname, '..', 'src', 'main', 'typescript');
  const packetSender = path.join(src, 'elvarg', 'net', 'packet', 'PacketSender.ts');
  for (const file of pluginSources(src)) {
    if (file === packetSender) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\.sendCameraShake\b/, `${path.relative(src, file)} sends a camera shake around the settings`);
  }
  assert.ok(calls.length >= 50, `found ${calls.length} camera shakes`);
  assert.ok(calls.includes('doom') && calls.includes('combat') && calls.includes('atmospheric'));
});
