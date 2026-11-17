// Owned source extraction only: no product modules, cache, actors, native code or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const data = JSON.parse(read('plugins/modes/data/league-tutorial.json'));
const tutorial = read('plugins/modes/league/Tutorial.LeagueMode.js');
// Extract the actual listener declarations/registration, without evaluating require().
const listeners = tutorial.slice(tutorial.indexOf('const STAGE_ATTRIBUTE'));
const packet = read('src/main/typescript/elvarg/net/packet/PacketSender.ts');
const playerSource = read('src/main/typescript/elvarg/game/entity/impl/player/Player.ts');
function methodBody(source, signature) {
  const start = source.indexOf('{', source.indexOf(signature));
  assert.ok(start >= 0);
  let depth = 1, end = start + 1;
  for (; depth; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
  return source.slice(start + 1, end - 1);
}
// Actual ownership method bodies, with only TypeScript signatures replaced by JS signatures.
const getMount = new Function('targetUid', methodBody(packet, 'getSubInterfaceAt(targetUid:'));
const closeMount = new Function('mount', methodBody(packet, 'closeSubInterfaceMount(mount:'));
const canonical = value => JSON.parse(JSON.stringify(value));
const uid = ([a, b]) => (a << 16) | b;
function harness(options = {}) {
  const tasks = [], microtasks = [], events = [], writes = [], closed = [], attributes = new Map();
  const callbacks = new Map(), persistent = new Set();
  const p = {
    profile: options.profile ?? 'league', type: options.type ?? 4, main: -1,
    dialogue: { active: true }, unrelated: { unlocks: [1, 2], points: 0, tasks: [], relics: {}, quests: {}, items: [], location: [3234, 3213, 0], movement: {} },
    getProfile() { return this.profile; },
    getAttribute(key) { return key === 'league:type' ? this.type : attributes.get(key); },
    setAttribute(key, value) { writes.push([key, value]); attributes.set(key, value); },
    getInterfaceId() { return this.main; }, setInterfaceId(id) { this.main = id; },
    isPlayerBot: () => false,
    getPacketSender: () => sender,
  };
  if (options.stage !== undefined) attributes.set('league:tutorial-stage', options.stage);
  Object.defineProperty(p, 'main', { get() { return this.interfaceId; }, set(value) { this.interfaceId = value; } });
  p.interfaceId = -1;
  p.interfaceOpens = 0;
  p.getInterfaceOpens = new Function(methodBody(playerSource, 'public getInterfaceOpens():'));
  const emit = (name, event) => {
    events.push(name);
    for (const fn of callbacks.get(name) ?? []) fn(event);
    if (name === 'interface:changed') options.onInterfaceChanged?.(event, sender);
  };
  p.setInterfaceId = new Function('PluginManager', 'return function(interfaceId){' +
    methodBody(playerSource, 'public setInterfaceId(interfaceId:') + '}')({ emitCustomEvent: emit });
  const api = {
    persistAttribute: key => persistent.add(key),
    onCustomEvent: (name, fn) => callbacks.set(name, [...(callbacks.get(name) ?? []), fn]),
    onPlayerLogout() {}, onInterfaceActionButton() {},
  };
  const Common = {
    api: { emitCustomEvent: emit },
    leagueOf: player => player?.getProfile() === 'league' ? player.type : null,
    later: (_p, _ticks, fn) => tasks.push(fn),
  };
  const sender = {
    subInterfaceTargets: new Map(), varbits: new Map(),
    getSubInterfaceAt: getMount, closeSubInterfaceMount: closeMount,
    mountSubInterface(targetUid, groupId, type = 1) {
      for (const [g, m] of this.subInterfaceTargets) if (m.targetUid === targetUid || g === groupId) this.subInterfaceTargets.delete(g);
      const mount = Object.freeze({ targetUid, groupId, type });
      this.subInterfaceTargets.set(groupId, mount);
      emit('interface:opened', { player: p, groupId, targetUid, type });
      options.onMount?.(mount, p, this, emit);
      return mount;
    },
    sendSubInterface(...args) { this.mountSubInterface(...args); return this; },
    sendInterface(group) { p.setInterfaceId(group); this.mountSubInterface(uid(data.screens.mainModal), group, 0); return this; },
    closeSubInterface(target) {
      for (const [group, mount] of this.subInterfaceTargets) if (mount.targetUid === target) this.subInterfaceTargets.delete(group);
      closed.push(target); options.onClose?.(target, p, this); return this;
    },
    isSubInterfaceOpen(group) { return this.subInterfaceTargets.has(group); },
    sendVarbit(id, value) { this.varbits.set(id, value); return this; },
    sendInterfaceDisplayState(id, hide) { events.push(`display:${id}:${hide}`); return this; },
    sendInterfaceScript() { return this; },
    sendInterfaceFlagsRange() { return this; },
  };
  let client;
  if (options.recorder) {
    sender.player = p;
    p.getFrameUpdater = () => ({ clearGroup() {} });
    p.getSession = () => ({ sendClientPacket() {} });
    sender.releaseInterfaceInventories = () => {};
    const remember = methodBody(packet, 'private rememberSubInterface(').replace('const mount: SubInterfaceMount', 'const mount');
    sender.rememberSubInterface = new Function('encodeWidgetCloseSub', 'return function(targetUid, groupId, type){' + remember + '}')(() => ({}));
    const subTail = packet.slice(packet.indexOf('  sendSubInterface('));
    sender.sendSubInterface = new Function('targetUid', 'groupId', 'type = 1', 'options = {}', methodBody(subTail, '): this'));
    const mountTail = packet.slice(packet.indexOf('  mountSubInterface('));
    sender.mountSubInterface = new Function('MAIN_INVENTORY_GROUP_ID', 'MAIN_INVENTORY_WIDGET_UID', 'MAIN_INVENTORY_SLOT_FLAGS', 'encodeWidgetOpenSub', 'encodeWidgetSetFlagsRange',
      'return function(targetUid, groupId, type = 1, options = {}){' + methodBody(mountTail, '): SubInterfaceMount') + '}')(-1, -1, 0, () => ({}), () => ({}));
    sender.sendInterface = new Function('MAIN_MODAL_TARGET_UID', 'return function(id){' + methodBody(packet, '  sendInterface(id:') + '}')(uid(data.screens.mainModal));
    sender.emitInterfaceOpened = (targetUid, groupId, type) => {
      const mount = sender.getSubInterfaceAt(targetUid);
      emit('interface:opened', { player: p, targetUid, groupId, type });
      options.onMount?.(mount, p, sender, emit);
    };
    client = { varbits: {}, varps: {}, interfaces: [], graphics: [], interactionModes: [] };
    const recorder = options.recorderSource ?? read('plugins/agent/mcp/Context.AgentMcp.js');
    new Function('MAX_MESSAGES', 'return function(sender, state){' + methodBody(recorder, 'function recordClient(') + '}')(100)(sender, { client });
  }
  const sandbox = { Common, data, FLAG_OP1: 2, module: { exports: {} }, queueMicrotask: fn => microtasks.push(fn) };
  const extracted = options.tutorialSource ? options.tutorialSource.slice(options.tutorialSource.indexOf('const STAGE_ATTRIBUTE')) : listeners;
  vm.runInNewContext(extracted, sandbox, { timeout: 1000 });
  sandbox.module.exports(api);
  const flush = () => { let n = 0; while (tasks.length || microtasks.length) { assert.ok(n++ < 20); for (const fn of tasks.splice(0)) fn(); for (const fn of microtasks.splice(0)) fn(); } };
  const login = () => emit('league:login', { player: p });
  const skip = () => emit('account:skip-onboarding', { player: p });
  return { p, sender, emit, login, skip, flush, attributes, persistent, events, writes, closed, client };
}
function initial(options) { return harness({ stage: 0, ...options }); }
function noRewards(h, before) {
  assert.deepEqual(h.p.unrelated, before);
  assert.ok(h.writes.every(([key]) => key === 'league:tutorial-stage'));
  assert.ok(!h.events.some(e => /award|complete-task|unlocked/.test(e)));
  assert.equal(h.p.dialogue.active, true, 'unrelated dialogue untouched');
}
for (const late of [false, true]) test(`explicit skip ${late ? 'after' : 'before'} owned mounts cancels reopen and earns nothing`, () => {
  const h = initial(); const before = structuredClone(h.p.unrelated);
  h.login(); if (late) { h.flush(); assert.equal(h.p.main, 677); }
  h.skip(); h.flush();
  assert.equal(h.attributes.get('league:tutorial-stage'), 12);
  assert.equal(h.sender.varbits.get(10037), 12);
  assert.equal(h.sender.varbits.get(4084), 0);
  assert.equal(h.p.main, -1); assert.equal(h.sender.subInterfaceTargets.size, 0);
  if (late) assert.equal(h.sender.varbits.get(10690), 0);
  assert.equal(h.events.filter(x => x === 'settings:restore-data-orbs').length, 1);
  const effectCount = h.writes.length + h.closed.length + h.events.filter(x => x === 'settings:restore-data-orbs').length;
  h.skip(); h.flush();
  assert.equal(h.writes.length + h.closed.length + h.events.filter(x => x === 'settings:restore-data-orbs').length, effectCount);
  noRewards(h, before);
});
test('ordinary/show path keeps initial tutorial and emits no skip', () => {
  const h = initial(); h.login(); h.flush();
  assert.equal(h.p.main, 677); assert.equal(h.attributes.get('league:tutorial-stage'), 0);
  assert.equal(h.sender.varbits.get(4084), 1);
  assert.ok(!h.events.includes('account:skip-onboarding'));
  const session = read('plugins/agent/mcp/Session.AgentMcp.js');
  assert.match(session, /if \(onboarding === "skip"\) core\.PluginManager\.emitCustomEvent\("account:skip-onboarding"/);
});
for (const options of [{}, { profile: 'main', stage: 0 }, { type: 1, stage: 0 }, { stage: 12 }, { stage: 3 }, { stage: -1 }]) {
  test(`unsupported/absent/completed/progressed state unchanged ${JSON.stringify(options)}`, () => {
    const h = harness(options), before = [...h.attributes]; h.skip(); h.flush();
    assert.deepEqual([...h.attributes], before); assert.equal(h.writes.length, 0); assert.equal(h.closed.length, 0);
    assert.equal(h.sender.varbits.size, 0);
  });
}
for (const type of [2, 4, 5, 6]) test(`uses source flow final for league ${type}`, () => {
  const h = initial({ type }); h.login(); h.skip(); h.flush();
  assert.equal(h.attributes.get('league:tutorial-stage'), data.flows[data.leagues[type].flow].final);
});
test('stage0 without owned login state changes only domain stage, not arbitrary UI/settings', () => {
  const h = initial(); h.sender.sendInterface(999); h.skip();
  assert.equal(h.p.main, 999); assert.equal(h.closed.length, 0);
  assert.deepEqual([...h.sender.varbits], [[10037, 12]]);
  assert.ok(!h.events.includes('settings:restore-data-orbs'));
});
for (const sameGroup of [false, true]) test(`replacement before skip preserved (same group ${sameGroup})`, () => {
  const h = initial(); h.login(); h.flush();
  const replacement = h.sender.mountSubInterface(uid(data.screens.mainModal), sameGroup ? 677 : 999, 0);
  h.p.main = replacement.groupId; h.skip(); h.flush();
  assert.equal(h.sender.getSubInterfaceAt(replacement.targetUid), replacement); assert.equal(h.p.main, replacement.groupId);
});
test('reentrant opened-hook same-group replacement is never claimed', () => {
  let replacement;
  const h = initial({ onMount(m, p, sender) {
    if (m.groupId === 677 && !replacement) {
      replacement = Object.freeze({ ...m }); sender.subInterfaceTargets.set(677, replacement); p.main = 677;
    }
  } });
  h.login(); h.flush(); h.skip();
  assert.equal(h.sender.getSubInterfaceAt(uid(data.screens.mainModal)), replacement);
  assert.equal(h.p.main, 677);
});
test('close failure never clears owned main ID', () => {
  const h = initial(); h.login(); h.flush(); h.sender.closeSubInterfaceMount = () => false; h.skip();
  assert.equal(h.p.main, 677);
});
test('unrelated main ID is not cleared even when owned mount closes', () => {
  const h = initial(); h.login(); h.flush(); h.p.main = 999; h.skip(); assert.equal(h.p.main, 999);
});
test('replacement during close survives and main ID remains', () => {
  let replacement;
  const h = initial({ onClose(target, p, sender) {
    if (target === uid(data.screens.mainModal)) {
      replacement = Object.freeze({ targetUid: target, groupId: 677, type: 0 }); sender.subInterfaceTargets.set(677, replacement); p.main = 677;
    }
  } });
  h.login(); h.flush(); h.skip();
  assert.equal(h.sender.getSubInterfaceAt(uid(data.screens.mainModal)), replacement); assert.equal(h.p.main, 677);
});
for (const targetName of ['overlay', 'mesoverlay']) test(`replacement ${targetName} mount/overlap not modified`, () => {
  const h = initial(); h.login(); h.flush();
  const target = uid(data.screens[targetName].target), group = data.screens[targetName].group;
  const replacement = h.sender.mountSubInterface(target, group, 1), displays = h.events.filter(e => e.startsWith('display:')).length;
  h.skip(); assert.equal(h.sender.getSubInterfaceAt(target), replacement);
  assert.equal(h.sender.varbits.get(10690), 1);
  if (targetName === 'overlay') assert.equal(h.events.filter(e => e.startsWith('display:')).length, displays);
});
for (const duringGroup of [653, 263, 677]) test(`reentrant skip while mounting ${duringGroup} cleans only returned lifetime`, () => {
  const h = initial({ onMount(m, _p, _s, emit) { if (m.groupId === duringGroup) emit('account:skip-onboarding', { player: _p }); } });
  h.login(); h.flush(); assert.equal(h.attributes.get('league:tutorial-stage'), 12);
  assert.equal(h.sender.subInterfaceTargets.size, 0); assert.equal(h.p.main, -1);
});
test('actual persistent-key projection and restoration retain skip across login', () => {
  const h = initial(); h.login(); h.skip();
  const saveSource = read('src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerSave.ts');
  const start = saveSource.indexOf('playerSave.attributes = Object.fromEntries(');
  const end = saveSource.indexOf('\n        );', start) + '\n        );'.length;
  const PlayerSave = { persistentAttributeKeys: h.persistent, attributeDefaults: new Map(), cloneAttribute: (_key, value) => canonical(value) };
  const playerSave = {};
  vm.runInNewContext(saveSource.slice(start, end).replace('key as string', 'key'), { PlayerSave, playerSave, player: h.p });
  const attributes = JSON.parse(JSON.stringify(playerSave.attributes));
  const restored = initial();
  const a = saveSource.indexOf('for (const key of PlayerSave.persistentAttributeKeys)');
  vm.runInNewContext('(function(){' + saveSource.slice(a, saveSource.indexOf('        PlayerSave.applyAttributeDefaults(player);', a)) + '}).call(saved)', { PlayerSave, saved: { attributes }, player: restored.p });
  restored.login(); restored.flush(); assert.equal(restored.attributes.get('league:tutorial-stage'), 12);
  assert.equal(restored.p.main, -1); assert.equal(restored.sender.subInterfaceTargets.size, 0);
});
for (const onboarding of ['skip', 'show']) test(`actual Session login callback keeps explicit ${onboarding} separation`, async () => {
  const h = initial();
  const source = read('plugins/agent/mcp/Session.AgentMcp.js');
  const start = source.indexOf('async ({ username, password, onboarding }) => {');
  const end = source.indexOf('\n    }\n  );', start) + '\n    }'.length;
  assert.ok(start >= 0 && end > start);
  const core = { connectHeadlessClient: async () => { h.login(); return { player: h.p }; }, PluginManager: { emitCustomEvent: h.emit } };
  h.p.getUsername = () => 'fabricated';
  const callback = vm.runInNewContext('(' + source.slice(start, end) + ')', {
    core, sleepTicks: async () => {}, find: () => h.p, status: p => ({ open: p.main > 0 ? 'interface' : null }),
  });
  await callback({ username: 'fabricated', password: 'inert', onboarding }); h.flush();
  assert.equal(h.attributes.get('league:tutorial-stage'), onboarding === 'skip' ? 12 : 0);
  assert.equal(h.p.main, onboarding === 'skip' ? -1 : 677);
});
test('unchanged actual status classification still reports unrelated interface and dialogue', () => {
  const source = read('plugins/agent/mcp/Context.AgentMcp.js');
  const start = source.indexOf('const waitingOn =');
  const end = source.indexOf('// Game messages since the last call', start);
  const classify = vm.runInNewContext(source.slice(start, end) + '\nwaitingOn;', { MultiChatboxPrompt: { getPending: () => false } });
  const h = initial(); h.login(); h.flush(); h.sender.sendInterface(999); h.skip();
  const p = { getInterfaceId: () => h.p.main, getDialogueManager: () => ({ isActive: () => false }) };
  assert.equal(classify(p), 'interface');
  p.getDialogueManager = () => ({ isActive: () => true });
  assert.equal(classify(p), 'dialogue');
});

for (const targetName of ['overlay', 'mesoverlay']) test(`real Player setter callback replacement ${targetName} retains overlap`, () => {
  let replacement;
  const target = uid(data.screens[targetName].target), group = data.screens[targetName].group;
  const h = initial({ onInterfaceChanged(event, sender) {
    if (event.previousId === 677 && event.interfaceId === -1) {
      replacement = sender.mountSubInterface(target, group, 1);
      sender.sendVarbit(10690, 1);
    }
  } });
  h.login(); h.flush(); h.skip(); h.flush();
  assert.ok(replacement);
  assert.equal(h.sender.getSubInterfaceAt(target), replacement);
  assert.equal(h.sender.varbits.get(10690), 1, 'replacement overlap contribution survives setter callback');
  assert.equal(h.attributes.get('league:tutorial-stage'), 12);
});

const initialRecords = ['open 653 on 161:1', 'show 653:1', 'open 263 on 162:565', 'open 677', 'open 677 on 161:16'];
test('actual recorder and sender chain preserves ordinary/show initial observations exactly', () => {
  const h = initial({ recorder: true }); h.login(); h.flush();
  assert.deepEqual(h.client.interfaces, initialRecords);
  assert.equal(h.p.main, 677);
});
test('actual legacy sender chain has no duplicate opens versus direct owned mounts', () => {
  const h = initial({ recorder: true });
  h.sender.sendSubInterface(uid(data.screens.overlay.target), 653, 1);
  h.sender.sendInterfaceDisplayState(uid([653, 1]), false);
  h.sender.sendSubInterface(uid(data.screens.mesoverlay.target), 263, 1);
  h.sender.sendInterface(677);
  assert.deepEqual(h.client.interfaces, initialRecords);
});
test('recorded direct main mount keeps exact return lifetime across a reentrant replacement', () => {
  let replacement;
  const h = initial({ recorder: true, onMount(m, p, sender) {
    if (m.groupId === 677 && !replacement) {
      replacement = Object.freeze({ ...m }); sender.subInterfaceTargets.set(677, replacement); p.main = 677;
    }
  } });
  h.login(); h.flush(); assert.deepEqual(h.client.interfaces, initialRecords);
  h.skip(); assert.equal(h.sender.getSubInterfaceAt(uid(data.screens.mainModal)), replacement); assert.equal(h.p.main, 677);
});
test('legacy nesting is restored after original sender throw before any mount', () => {
  const h = initial({ recorder: true }), error = new Error('setter throw');
  h.p.setInterfaceId = () => { throw error; };
  assert.throws(() => h.sender.sendInterface(777), e => e === error);
  const mount = h.sender.mountSubInterface(uid(data.screens.mainModal), 888, 0);
  assert.equal(h.sender.getSubInterfaceAt(mount.targetUid), mount);
  assert.deepEqual(h.client.interfaces, ['open 777', 'open 888', 'open 888 on 161:16']);
});
test('reentrant direct mount inside legacy mount records its own main open exactly once', () => {
  let entered = false;
  const h = initial({ recorder: true, onMount(m, _p, sender) {
    if (m.groupId === 777 && !entered) { entered = true; sender.mountSubInterface(uid(data.screens.mainModal), 888, 0); }
  } });
  h.sender.sendInterface(777);
  assert.deepEqual(h.client.interfaces, ['open 777', 'open 777 on 161:16', 'open 888', 'open 888 on 161:16']);
});
test('original mount throw retains error and restores legacy nesting after entered mount', () => {
  const error = new Error('mount throw'); let first = true;
  const h = initial({ recorder: true, onMount() { if (first) { first = false; throw error; } } });
  assert.throws(() => h.sender.sendInterface(777), e => e === error);
  h.sender.mountSubInterface(uid(data.screens.mainModal), 888, 0);
  assert.deepEqual(h.client.interfaces, ['open 777', 'open 777 on 161:16', 'open 888', 'open 888 on 161:16']);
});
test('mount recorder preserves bound receiver, argument identities, returned lifetime and original throw', () => {
  const source = read('plugins/agent/mcp/Context.AgentMcp.js');
  const args = [uid(data.screens.mainModal), 677, 0, { privateOptions: true }], returned = Object.freeze({ lifetime: true }), error = new Error('original');
  let fail = false, count = 0;
  const sender = { mountSubInterface(...actual) {
    assert.equal(this, sender); assert.deepEqual(actual, args); assert.equal(actual[3], args[3]); count++;
    if (fail) throw error;
    return returned;
  } };
  const state = { client: { interfaces: [], interactionModes: [], graphics: [], varbits: {}, varps: {} } };
  new Function('MAX_MESSAGES', 'return function(sender, state){' + methodBody(source, 'function recordClient(') + '}')(100)(sender, state);
  assert.equal(sender.mountSubInterface(...args), returned);
  fail = true; assert.throws(() => sender.mountSubInterface(...args), e => e === error);
  assert.equal(count, 2);
});
test('direct mount recording retains the existing finite client-event cap', () => {
  const h = initial({ recorder: true });
  for (let i = 0; i < 105; i++) h.sender.mountSubInterface(uid(data.screens.mainModal), 677, 0);
  assert.equal(h.client.interfaces.length, 100);
});
for (const group of [888, 777]) test(`real setter BEFORE first legacy delegation records direct ${group} lifetime`, () => {
  let direct;
  const h = initial({ recorder: true, onInterfaceChanged(event, sender) {
    if (event.previousId === -1 && event.interfaceId === 777) direct = sender.mountSubInterface(uid(data.screens.mainModal), group, 0);
  } });
  h.sender.sendInterface(777);
  assert.ok(direct);
  assert.deepEqual(h.client.interfaces, ['open 777', `open ${group}`, `open ${group} on 161:16`, 'open 777 on 161:16']);
  assert.notEqual(h.sender.getSubInterfaceAt(direct.targetUid), direct, 'legacy mount is a distinct lifetime even for the same group');
});
for (const name of ['overlay', 'mesoverlay']) for (const replace of [false, true]) test(`actual in-flight ${name} early skip (replacement ${replace})`, () => {
  const target = uid(data.screens[name].target), group = data.screens[name].group;
  let entered = false, replacement, sawFinalStage = false;
  const h = initial({ recorder: true, onMount(m, p, sender, emit) {
    if (m.groupId !== group || entered) return;
    entered = true;
    if (replace) { replacement = sender.mountSubInterface(target, group, 1); sender.sendVarbit(10690, 1); }
    emit('account:skip-onboarding', { player: p });
    sawFinalStage = p.getAttribute('league:tutorial-stage') === 12;
  } });
  h.login(); h.flush();
  assert.equal(sawFinalStage, true, 'domain stage changes before the outer mount returns');
  assert.equal(h.attributes.get('league:tutorial-stage'), 12);
  assert.equal(h.sender.varbits.get(10690), replace ? 1 : 0);
  assert.equal(h.sender.getSubInterfaceAt(target), replace ? replacement : undefined);
  assert.equal(h.p.main, -1);
  assert.equal(h.client.interfaces.some(line => line === 'open 677'), false, 'early skip creates no subsequent main mount');
});
for (const name of ['overlay', 'mesoverlay']) test(`throwing in-flight ${name} hook retains error and replacement contribution`, () => {
  const target = uid(data.screens[name].target), group = data.screens[name].group;
  let entered = false, replacement; const error = new Error('opened hook failure');
  const h = initial({ recorder: true, onMount(m, p, sender, emit) {
    if (m.groupId !== group || entered) return;
    entered = true; replacement = sender.mountSubInterface(target, group, 1); sender.sendVarbit(10690, 1);
    emit('account:skip-onboarding', { player: p }); throw error;
  } });
  h.login(); assert.throws(() => h.flush(), e => e === error);
  assert.equal(h.attributes.get('league:tutorial-stage'), 12);
  assert.equal(h.sender.getSubInterfaceAt(target), replacement);
  assert.equal(h.sender.varbits.get(10690), 1);
  assert.equal(h.client.interfaces.some(line => line === 'open 677'), false);
});

for (const kind of ['own-only', 'same-group-mount', 'other-group-mount', 'other-id', 'id-roundtrip', 'invalid-count', 'setter-throw']) test(`pending initial main assignment ownership ${kind}`, () => {
  let entered = false, replacement; const error = new Error('setter callback failure');
  const h = initial({ recorder: true, onInterfaceChanged(event, sender) {
    if (event.interfaceId !== 677 || entered) return;
    entered = true;
    if (kind === 'same-group-mount' || kind === 'other-group-mount') replacement = sender.mountSubInterface(uid(data.screens.mainModal), kind === 'same-group-mount' ? 677 : 999, 0);
    if (kind === 'other-id' || kind === 'id-roundtrip') event.player.setInterfaceId(999);
    if (kind === 'id-roundtrip') event.player.setInterfaceId(677);
    h.skip();
    if (kind === 'setter-throw') throw error;
  } });
  if (kind === 'invalid-count') h.p.getInterfaceOpens = () => Infinity;
  h.login();
  if (kind === 'setter-throw') assert.throws(() => h.flush(), e => e === error); else h.flush();
  assert.equal(h.attributes.get('league:tutorial-stage'), 12);
  assert.equal(h.p.main, kind === 'own-only' ? -1 : kind === 'other-id' ? 999 : 677);
  assert.equal(h.sender.getSubInterfaceAt(uid(data.screens.mainModal)), replacement);
  // Only a callback-created replacement may mount main; no tutorial-owned mount follows skip.
  assert.equal(h.client.interfaces.filter(line => line === 'open 677 on 161:16').length, kind === 'same-group-mount' ? 1 : 0);
});
