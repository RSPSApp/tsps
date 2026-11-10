// Run after `yarn build`: node --test tests/settings-gates.test.cjs
// All Settings rows that switch existing behaviour: each row is in the cache as the type its
// handler expects and names its gameval's varbit, and each behaviour follows it both ways.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const settingsJson = require('../plugins/interface/data/settings.json').settings;

let core;
const catalog = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  for (const [, structId] of CacheDefinitions.getEnumValues(422)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    for (const [, s] of CacheDefinitions.getEnumValues(Number(category.get(745)))) {
      const params = CacheDefinitions.getStructParams(Number(s));
      catalog.set(Number(params.get(1077)), { type: Number(params.get(1078) ?? 0), inverted: params.get(1084) === 1 });
    }
  }
});

/** A player whose packet sender keeps varbits (and logs everything else it is sent). */
function player(varbits = {}) {
  const bits = new Map(Object.entries(varbits).map(([id, value]) => [Number(id), value]));
  const attributes = new Map();
  const messages = [];
  const sent = [];
  const sender = new Proxy({
    getVarbit: (id) => bits.get(id) ?? 0,
    sendVarbit(id, value) { bits.set(id, value); return sender; },
    sendTypedMessage(type, text) { messages.push([type, text]); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : (...args) => { sent.push([key, ...args]); return sender; }) });
  return {
    bits, attributes, messages, sent,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(['game', text]),
  };
}

const varbit = (name) => CacheDefinitions.getVarbitId(name);

/** Anything not stubbed answers with a no-op that chains. */
function lenient(target) {
  const noop = new Proxy(() => noop, { get: () => noop });
  return new Proxy(target, { get: (t, p) => (p in t ? t[p] : noop) });
}

/** A fake plugin api: the given hooks, every other call a no-op. */
const fakeApi = (hooks = {}) => new Proxy({ core, ...hooks }, { get: (t, p) => (p in t ? t[p] : () => {}) });

// The rows wired here, by their gameval (and whether the row's tick means the varbit is 0).
const ROWS = {
  183: ['iron_noloot_message_disabled', true],
  296: ['wilderness_lever_first_op', false],
  302: ['settings_muspah_messages', false],
  373: ['settings_barbarian_potion_makex', false],
  424: ['bank_depositbox_oplocu_askquantity', true],
  452: ['settings_ca_open_last_interface_disabled', true],
  458: ['sailing_current_duck_hintarrow_disabled', true],
  459: ['sailing_barracuda_trials_hintarrow_disabled', true],
  // Stored before; gated here.
  41: ['boss_killcount_filtered', false],
  161: ['ca_failure_notifications_enabled', false],
  162: ['ca_refailure_notifications_enabled', false],
  256: ['wildy_canoe_warning', true],
  446: ['settings_farming_dig_disable_warning', true],
  456: ['settings_sailing_charting_popup', true],
};

test('every gated row is a toggle in the cache, names its gameval varbit and starts as a new account does', () => {
  for (const [id, [name, inverted]] of Object.entries(ROWS)) {
    const row = settingsJson[id];
    assert.ok(row, `setting ${id} is in settings.json`);
    assert.equal(catalog.get(Number(id))?.type, 0, `setting ${id} is a toggle`);
    assert.equal(row.varbit, varbit(name), `setting ${id} is ${name}`);
    assert.equal(catalog.get(Number(id)).inverted, inverted, `setting ${id}'s tick reads the varbit as the gate does`);
    // Live sends none of these at login for a new account, except 161 (on).
    assert.equal(row.default, id === '161' ? 1 : undefined, `setting ${id}'s default`);
  }
  assert.equal(catalog.get(468).type, 6, 'the volume reset is a button row');
});

test('Reset volume sliders to default sets every slider back to 100, sent and saved', () => {
  const Settings = require('../plugins/interface/Settings.plugin');
  let reset;
  const api = new Proxy({
    core,
    onCustomEvent: (name, fn) => { if (name === 'settings:setting-clicked' && fn.name === 'resetVolumeSliders') reset = fn; },
  }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  Settings.register(api);
  const p = player();
  const applied = [];
  p.applyAudioSettingFromClient = (varp, value) => applied.push([varp, value]);
  const request = { player: p, settingId: 468, handled: false };
  reset(request);
  assert.equal(request.handled, true);
  assert.deepEqual(applied, [[3796, 100], [168, 100], [169, 100], [872, 100]]);
  assert.deepEqual(p.sent.filter(([key]) => key === 'sendConfig').map(([, varp, value]) => [varp, value]), applied);
  const other = { player: player(), settingId: 467, handled: false };
  reset(other);
  assert.equal(other.handled, false);
});

test('a boss kill count is an ordinary game message, or filterable spam with the row on', () => {
  const KillCount = require('../plugins/interface/BossKillCount.plugin');
  KillCount.register({ core, onServerStartup: (start) => start() });
  const line = 'Your Zulrah kill count is: <col=ff0000>5</col>.';
  const off = player();
  KillCount.sendBossKillCount(off, line);
  assert.deepEqual(off.messages, [['game', line]]);
  const on = player({ [varbit('boss_killcount_filtered')]: 1 });
  KillCount.sendBossKillCount(on, line);
  assert.deepEqual(on.messages, [[core.ChatType.SPAM, line]]);
});

test('every boss kill-count line goes through the shared helper', () => {
  const root = path.resolve(__dirname, '../plugins');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(root);
  // A kill count sent straight to sendMessage: the text, or the data key boss plugins keep it under.
  const killCount = /\.sendMessage\(.*(kill count is|"killCount"|kill\.count|phosaniCount|kill\.message|awakenedMessage|success count is)/;
  const direct = [];
  let viaHelper = 0;
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, index) => {
      if (/^\s*(\*|\/\/)/.test(text)) return;
      if (killCount.test(text)) direct.push(`${path.relative(root, file)}:${index + 1}`);
      if (/sendBossKillCount\(/.test(text) && !file.endsWith('BossKillCount.plugin.js')) viaHelper++;
    });
  }
  assert.deepEqual(direct, []);
  assert.ok(viaHelper >= 27, `${viaHelper} kill-count lines use the helper`);
});

test('Disable Phantom Muspah messages hides the fight lines', () => {
  const Common = require('../plugins/bosses/phantommuspah/Common.PhantomMuspah');
  const off = player();
  Common.fightMessage(off, 'You have been corrupted!');
  assert.deepEqual(off.messages, [['game', 'You have been corrupted!']]);
  const on = player({ [varbit('settings_muspah_messages')]: 1 });
  Common.fightMessage(on, 'You have been corrupted!');
  assert.deepEqual(on.messages, []);
});

test('Iron loot restriction messages: the kill-credit warning follows the row', () => {
  const IronCommon = require('../plugins/modes/ironman/Common.Ironman');
  const hooks = {};
  const api = new Proxy({ core, onCanAttack: (fn) => { hooks.attack = fn; } }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  IronCommon.init(api);
  require('../plugins/modes/ironman/Loot.Ironman')(api);
  const other = {};
  const npc = { isNpc: () => true, getCombat: () => ({ getRecentDamagers: () => [other] }) };
  for (const disabled of [0, 1]) {
    const iron = player({ [varbit('iron_noloot_message_disabled')]: disabled });
    iron.isPlayer = () => true;
    iron.setAttribute(IronCommon.MODE_ATTRIBUTE, 'ironman');
    hooks.attack({ attacker: iron, target: npc });
    assert.deepEqual(iron.messages.map(([, text]) => text), disabled ? [] : [IronCommon.message('killCredit')]);
  }
});

test('Combat Achievement failures: off says nothing, on says it for tasks not done, repeat failure for done ones too', () => {
  require('../plugins/achievements/CombatAchievements.plugin').register(fakeApi());
  const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
  const Progress = require('../plugins/achievements/combatachievements/Progress.CombatAchievements');
  const task = Data.taskNamed('Perfect Zebak');
  const done = (p) => {
    const words = Data.TASK_VARPS.map(() => 0);
    words[task.id >>> 5] = 1 << (task.id & 31);
    p.setAttribute(Progress.COMPLETED_ATTRIBUTE, words);
  };
  const line = 'You have failed <col=0cc919>Perfect Zebak</col>: You lost a prayer point.';
  const failure = varbit('ca_failure_notifications_enabled');
  const refailure = varbit('ca_refailure_notifications_enabled');
  const cases = [
    [{ [failure]: 0 }, false, []],
    [{ [failure]: 1 }, false, [line]],
    [{ [failure]: 1 }, true, []],
    [{ [failure]: 1, [refailure]: 1 }, true, [line]],
    [{ [failure]: 0, [refailure]: 1 }, true, []],
  ];
  for (const [bits, completed, expected] of cases) {
    const p = player(bits);
    if (completed) done(p);
    Progress.announceFailure(p, 'Perfect Zebak', 'You lost a prayer point.');
    assert.deepEqual(p.messages.map(([, text]) => text), expected, JSON.stringify({ bits, completed }));
  }
});

test('Warning on digging up a farming patch: off digs the crop up without asking', (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  require('../plugins/skills/farming/Core.Farming').init({ core });
  const Data = require('../plugins/skills/farming/Data.Farming');
  const Model = require('../plugins/skills/farming/Model.Farming');
  const Patches = require('../plugins/skills/farming/Patches.Farming');
  Data.initializeFarmingData();
  let dig;
  Patches.attach(new Proxy({}, { get: (_, name) => (...args) => { if (name === 'onObjectInteraction') dig = args[0]; } }));
  t.mock.method(core.MapObjects, 'get', () => null);
  t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => ['Dig-up'] }));
  for (const disabled of [0, 1]) {
    const who = new Player(null);
    const bits = new Map([[varbit('settings_farming_dig_disable_warning'), disabled]]);
    const sender = new Proxy({}, { get: (_, name) => name === 'getVarbit' ? (id) => bits.get(id) ?? 0
      : name === 'sendVarbit' ? (id, value) => { bits.set(id, value); return sender; } : () => sender });
    const asked = [];
    who.getPacketSender = () => sender;
    who.sendMessage = () => {};
    who.performAnimation = () => {};
    who.busy = () => false;
    who.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    who.getDialogueManager = () => ({ start: (dialogue) => asked.push(dialogue), startDialogues: (dialogue) => asked.push(dialogue) });
    const crop = [...Data.CROPS.values()].find((each) => each.type === 'ALLOTMENT');
    const patch = Data.CACHE.patches.find((each) => each.type === crop.type);
    who.moveTo(new core.Location(patch.x, patch.y, patch.z));
    const farm = { offset: 0, patches: {}, tools: {} };
    farm.patches[Data.patchKey(patch)] = { ...Model.emptyPatch(Date.now(), farm), crop: crop.key, stage: crop.stages,
      status: 'grown', checked: true, lives: 3, nextAt: Number.MAX_SAFE_INTEGER };
    who.setAttribute(Patches.FARM_ATTRIBUTE, farm);
    who.getInventory().add(new core.Item(core.ItemIdentifiers.SPADE), false);
    dig({ player: who, object: { getId: () => patch.id }, clickType: 1, location: { x: patch.x, y: patch.y, z: patch.z } });
    for (let i = 0; i < 6; i++) Patches.tick();
    const cleared = farm.patches[Data.patchKey(patch)].crop === undefined;
    assert.equal(cleared, disabled === 1, disabled ? 'dug up at once' : 'kept until the warning is answered');
    assert.equal(asked.length > 0, disabled === 0, disabled ? 'no warning' : 'the warning');
  }
});

test('Show warning on taking a canoe to the Wilderness: off paddles straight there', () => {
  const Canoes = require('../plugins/world/canoes/Network.Canoes');
  const prompts = [];
  const api = new Proxy({
    core,
    sendMultiChatboxPrompt: (...args) => prompts.push(args[1]),
  }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  Canoes(api);
  const { stations, TYPES, select } = Canoes._test;
  const edgeville = stations.find((s) => s.id === 4);
  const waka = TYPES.find((type) => type.id === 4);
  for (const disabled of [0, 1]) {
    prompts.length = 0;
    const who = lenient(player({ [varbit(edgeville.state)]: waka.id + 10, [varbit('wildy_canoe_warning')]: disabled }));
    who.getInterfaceId = () => 953;
    who.setInterfaceId = () => {};
    who.getLocation = () => new core.Location(edgeville.tree[0], edgeville.tree[1], 0);
    who.getIndex = () => 1;
    who.isRegistered = () => true;
    who.setAttribute('canoes:menu', { group: 953, station: edgeville });
    const travelled = [];
    who.moveTo = (to) => travelled.push(to);
    select({ player: who, buttonId: (953 << 16) | 28 });
    assert.equal(prompts.length, disabled ? 0 : 1, disabled ? 'no warning' : 'the one-way warning');
    if (!disabled) assert.equal(prompts[0], 'Travel into the Wilderness? This is a one-way trip.');
    assert.ok(Array.isArray(who.getAttribute('canoes:return')) === Boolean(disabled), disabled ? 'the trip starts' : 'no trip until answered');
    Canoes._test.logout({ player: who });
  }
});

test('Bank Deposit Box item quantity check: off deposits every one used on the box; a full bank keeps them', (t) => {
  const Booth = require('../plugins/objects/BankDepositBooth.plugin');
  const { Bank } = require('../dist/game/model/container/impl/Bank');
  let itemOnObject;
  const prompts = [];
  Booth.register(new Proxy({
    core,
    onItemOnObject: (fn) => { itemOnObject = fn; },
    emitCanBank: () => true,
    sendMultiChatboxPrompt: (who, title) => prompts.push(title),
  }, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  const box = { getDefinition: () => ({ getName: () => 'Bank deposit box' }) };
  for (const [disabled, bankFull] of [[0, false], [1, false], [1, true]]) {
    prompts.length = 0;
    const who = player({ [varbit('bank_depositbox_oplocu_askquantity')]: disabled });
    const slots = [5, 5, 5].map((id) => ({ getId: () => id }));
    const inventory = {
      getAmount: (id) => slots.filter((item) => item?.getId() === id).length,
      forSlot: (slot) => slots[slot] ?? null,
      getValidItems: () => slots.filter(Boolean),
    };
    who.getInventory = () => inventory;
    who.performAnimation = () => {};
    const deposits = [];
    t.mock.method(Bank, 'deposit', (_who, itemId, slot, amount) => {
      deposits.push(amount);
      if (bankFull) return;
      for (let i = 0, left = amount; i < slots.length && left > 0; i++) if (slots[i]?.getId() === itemId) { slots[i] = null; left--; }
    });
    itemOnObject({ player: who, object: box, itemId: 5, itemSlot: 0 });
    if (disabled) {
      assert.deepEqual(prompts, [], 'no quantity question');
      assert.deepEqual(deposits, [3], 'all three');
      assert.equal(inventory.getAmount(5), bankFull ? 3 : 0, bankFull ? 'a full bank takes none' : 'deposited');
    } else {
      assert.deepEqual(prompts, ['How many would you like to deposit?']);
      assert.deepEqual(deposits, []);
    }
    t.mock.restoreAll();
  }
});

test('Combat task interface remembers last interface opened: off reopens the overview', () => {
  const Interface = require('../plugins/achievements/combatachievements/Interface.CombatAchievements');
  for (const disabled of [0, 1]) {
    const who = lenient(player({ [varbit('settings_ca_open_last_interface_disabled')]: disabled }));
    who.setAttribute(Interface.VIEW_ATTRIBUTE, { [Interface.VARBIT.LAST_OPENED]: Interface.SCREEN.REWARDS });
    who.getInterfaceId = () => -1;
    Interface.open(who);
    assert.equal(who.getAttribute(Interface.VIEW_ATTRIBUTE)[Interface.VARBIT.LAST_OPENED], disabled ? Interface.SCREEN.OVERVIEW : Interface.SCREEN.REWARDS);
  }
});
