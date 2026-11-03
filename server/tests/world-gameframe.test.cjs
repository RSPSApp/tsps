// Run after `yarn build`: node --test tests/world-gameframe.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const {
  parseWorldDefinition,
  WorldDefinitionValidationError,
  WORLD_GAMEFRAMES,
} = require('../dist/game/definition/WorldDefinition');

const world = (extra) => ({ spawn: { x: 3222, y: 3219, z: 0 }, zones: [{ tags: [] }], ...extra });

test('gameframe is optional and left out when absent', () => {
  assert.equal('gameframe' in parseWorldDefinition(world()), false);
});

test('every supported gameframe is accepted', () => {
  for (const gameframe of WORLD_GAMEFRAMES) {
    assert.equal(parseWorldDefinition(world({ gameframe })).gameframe, gameframe);
  }
});

test('pluginConfig is carried so the map editor saves it back', () => {
  const pluginConfig = { 'TutorialIsland:allowSkip': false };
  assert.deepEqual(parseWorldDefinition(world({ pluginConfig })).pluginConfig, pluginConfig);
  assert.equal('pluginConfig' in parseWorldDefinition(world({ pluginConfig: [] })), false, 'malformed config is ignored');
});

test('an unknown gameframe is rejected', () => {
  assert.throws(() => parseWorldDefinition(world({ gameframe: 'classic-resizable' })), WorldDefinitionValidationError);
});

test('voice plugin is off by default', () => {
  assert.equal(require('../plugins/interface/VoiceChat.plugin.js').enabled, false);
});

test('plugins is carried so the map editor saves it back', () => {
  const plugins = { TutorialIsland: false };
  assert.deepEqual(parseWorldDefinition(world({ plugins })).plugins, plugins);
});

/** Loads `files` as a plugin directory under `world`; returns console output and loaded names. */
function loadPlugins(world, files, env = {}) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-plugin-switch-'));
  const cwd = process.cwd();
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const output = { info: [], warn: [] };
  try {
    for (const [name, contents] of Object.entries({ 'data/definitions/world.json': JSON.stringify(world), ...files })) {
      fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      fs.writeFileSync(path.join(directory, name), contents);
    }
    process.chdir(directory);
    console.info = (message) => output.info.push(message);
    console.warn = (message) => output.warn.push(message);
    PluginManager.loadFromDirectory(path.join(directory, 'plugins'));
    return { ...output, loaded: [...PluginManager.loadedPlugins] };
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    process.chdir(cwd);
    PluginManager.initialized = false;
    PluginManager.loadedPlugins = [];
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const plugin = (name, extra = '') => `module.exports = { name: '${name}', ${extra} register() {} };`;
const switchFiles = {
  'plugins/On.plugin.js': plugin('On'),
  'plugins/Off.plugin.js': plugin('Off', 'enabled: false,'),
  'plugins/Other.plugin.js': plugin('Other'),
};

test('plugins left out of world.json keep their own default', () => {
  const { loaded, warn } = loadPlugins({}, switchFiles);
  assert.deepEqual(loaded.sort(), ['On', 'Other']);
  assert.deepEqual(warn, []);
});

test('world.json plugins turns plugins on and off over their default, and warns on unknown names', () => {
  const { loaded, warn } = loadPlugins({ plugins: { Off: true, other: false, Typo: false } }, switchFiles);
  assert.deepEqual(loaded.sort(), ['Off', 'On']);
  assert.deepEqual(warn, ['[plugins] world.json names a plugin that does not exist: typo']);
});

test('the older disabledPlugins list still decides alone, with a deprecation warning', () => {
  const { loaded, warn } = loadPlugins({ plugins: { On: false }, disabledPlugins: ['Other'] }, switchFiles);
  assert.deepEqual(loaded.sort(), ['Off', 'On']);
  assert.equal(warn.length, 1);
  assert.match(warn[0], /disabledPlugins is deprecated/);
});

test('malformed plugins is rejected', () => {
  assert.throws(() => loadPlugins({ plugins: { On: 'no' } }, switchFiles), /must map plugin names to true or false/);
});

test('plugin loading counts disabled files and logs only the final persistence override', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { GameConstants } = require('../dist/game/GameConstants');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-plugin-config-'));
  const cwd = process.cwd();
  const persistence = GameConstants.PLAYER_PERSISTENCE;
  const disableBots = process.env.DISABLE_PLAYER_BOTS;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const messages = [];
  const warnings = [];
  const write = (name, contents) => {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  try {
    write('data/definitions/world.json', JSON.stringify({
      plugins: { VoiceChat: false, DisabledAlias: false },
    }));
    // Disabled filenames must be filtered before require(), including VoiceChat.
    write('plugins/VoiceChat.plugin.js', 'throw new Error("voice was evaluated");');
    write('plugins/bots/PlayerBots.plugin.js', 'throw new Error("bots were evaluated");');
    write('plugins/Alias.plugin.js', 'module.exports = { name: "DisabledAlias", register() { throw new Error("disabled alias registered"); } };');
    write('plugins/First.plugin.js', `module.exports = { name: 'First', register(api) {
      api.setPlayerPersistence(new class FirstPersistence { load() {} save() {} exists() {} });
    } };`);
    write('plugins/Last.plugin.js', `module.exports = { name: 'Last', dependsOn: ['First'], register(api) {
      api.setPlayerPersistence(new class LastPersistence { load() {} save() {} exists() {} });
      api.setPlayerPersistence({});
    } };`);
    process.chdir(directory);
    process.env.DISABLE_PLAYER_BOTS = '1';
    console.info = (message) => messages.push(message);
    console.warn = (message) => warnings.push(message);
    PluginManager.loadFromDirectory(path.join(directory, 'plugins'));
    PluginManager.loadFromDirectory(path.join(directory, 'plugins'));
    assert.deepEqual(messages, [
      '[plugins] player persistence set by Last: FirstPersistence -> LastPersistence',
      '[plugins] active=2 disabled=3',
    ]);
    assert.deepEqual(warnings, ['[plugins] Last attempted invalid player persistence registration']);
    assert.equal(GameConstants.PLAYER_PERSISTENCE.constructor.name, 'LastPersistence');
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    process.chdir(cwd);
    if (disableBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = disableBots;
    GameConstants.setPlayerPersistence(persistence);
    PluginManager.initialized = false;
    PluginManager.loadedPlugins = [];
    PluginManager.lastPersistenceOverride = null;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('NPC click hooks accept the fifth option and reject options outside 1–5', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const hooks = PluginManager.npcInteractionHooks.slice();
  const warnings = [];
  const originalWarn = console.warn;
  try {
    console.warn = (message) => warnings.push(message);
    const api = PluginManager.createApi('NpcClickTest');
    const handler = () => true;
    api.onNpcClick(1, 5, handler);
    for (const invalid of [0, 6, 1.5]) api.onNpcClick(1, invalid, handler);
    assert.equal(warnings.length, 3);
    const event = { player: {}, npc: {}, npcId: 1, clickType: 5, handled: false };
    assert.equal(PluginManager.emitNpcInteraction(event), true);
    assert.equal(PluginManager.emitNpcInteraction({ ...event, clickType: 4, handled: false }), false);
  } finally {
    console.warn = originalWarn;
    PluginManager.npcInteractionHooks = hooks;
  }
});

test('pluginConfig commands:permissions sets the rank a command needs, either way', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const config = PluginManager.pluginConfigCache;
  const permissions = PluginManager.commandPermissionsCache;
  const registered = PluginManager.commandRights.get('items');
  const player = (rights) => ({ getRights: () => ({ getId: () => rights }) });
  const warn = console.warn;
  try {
    console.warn = () => {};
    PluginManager.commandRights.set('items', 2);
    PluginManager.pluginConfigCache = { 'commands:permissions': { '::Teleports': 'OWNER', items: 'none', bad: 'KING' } };
    PluginManager.commandPermissionsCache = null;
    assert.equal(PluginManager.playerHasCommandRights(player(2), 'teleports'), false, 'raised to owner');
    assert.equal(PluginManager.playerHasCommandRights(player(3), 'teleports'), true);
    assert.equal(PluginManager.playerHasCommandRights(player(0), 'items'), true, 'lowered below its registered administrator rank');
    assert.equal(PluginManager.playerHasCommandRights(player(0), 'bad'), true, 'unknown rights names are ignored');

    PluginManager.pluginConfigCache = { 'commands:permissions': {} };
    PluginManager.commandPermissionsCache = null;
    assert.equal(PluginManager.playerHasCommandRights(player(0), 'items'), false, 'falls back to the registered rank');
    assert.equal(PluginManager.playerHasCommandRights(player(0), 'teleports'), true);
  } finally {
    console.warn = warn;
    PluginManager.pluginConfigCache = config;
    PluginManager.commandPermissionsCache = permissions;
    if (registered === undefined) PluginManager.commandRights.delete('items');
    else PluginManager.commandRights.set('items', registered);
  }
});

function isolatedProfiler(t) {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const fields = ['customEventHooks', 'npcInteractionHooks', 'npcAnyInteractionHooks',
    'beforeNpcInteractionHooks', 'objectInteractionHooks', 'beforeObjectInteractionHooks',
    'objectHooksById', 'objectHooksByName', 'nextObjectHookOrder', 'pluginPerfStats', 'pluginPerfEnabled'];
  const saved = Object.fromEntries(fields.map((field) => [field, PluginManager[field]]));
  t.after(() => Object.assign(PluginManager, saved));
  for (const field of fields) {
    PluginManager[field] = saved[field] instanceof Map ? new Map()
      : Array.isArray(saved[field]) ? [] : field === 'pluginPerfEnabled' ? true : 0;
  }
  return PluginManager;
}

test('scoped profiling identifies the slowest callback separately from the busiest event', (t) => {
  const manager = isolatedProfiler(t);
  let now = 0n;
  t.mock.method(process.hrtime, 'bigint', () => now);
  const errors = t.mock.method(console, 'error', () => {});
  const api = manager.createApi('Quests');
  const first = api.withProfileLabel('Quests/First');
  const second = api.withProfileLabel('Quests/Second');
  first.onCustomEvent('test:frequent', function frequent() { now += 2_000_000n; });
  first.onCustomEvent('test:slow', function slow() { now += 5_000_000n; });
  second.onCustomEvent('test:slow', function otherQuest() { now += 1_000_000n; });
  for (let i = 0; i < 3; i++) manager.emitCustomEvent('test:frequent', {});
  manager.emitCustomEvent('test:slow', {});
  const rows = manager.getPluginPerformanceSnapshot();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.pluginName), ['Quests/First', 'Quests/Second']);
  assert.equal(rows[0].totalMs, 11);
  assert.equal(rows[0].topEventName, 'custom_event:test:frequent');
  assert.equal(rows[0].maxMs, 5);
  assert.equal(rows[0].maxEventName, 'custom_event:test:slow');
  assert.equal(rows[0].maxHandlerName, 'slow');
  assert.equal(rows[1].maxHandlerName, 'otherQuest');

  first.onCustomEvent('test:failure', function failedCallback() { now += 7_000_000n; throw new Error('expected'); });
  let continued = false;
  second.onCustomEvent('test:failure', function afterFailure() { continued = true; });
  manager.emitCustomEvent('test:failure', {});
  const failed = manager.getPluginPerformanceSnapshot()[0];
  assert.equal(failed.errors, 1);
  assert.equal(failed.maxMs, 7);
  assert.equal(failed.maxEventName, 'custom_event:test:failure');
  assert.equal(failed.maxHandlerName, 'failedCallback');
  assert.equal(errors.mock.callCount(), 1);
  assert.equal(continued, true, 'one failing callback does not prevent later hooks');

  manager.resetPluginPerformanceStats();
  manager.setPluginPerformanceProfilingEnabled(false);
  continued = false;
  manager.emitCustomEvent('test:failure', {});
  assert.equal(continued, true, 'callbacks still execute with profiling disabled');
  assert.deepEqual(manager.getPluginPerformanceSnapshot(), [], 'reset and disabled profiling retain no samples');
});

test('scoped hooks retain NPC editor methods, spawn owners and shared definition sources', (t) => {
  const manager = isolatedProfiler(t);
  const { NpcInteractionManager } = require('../dist/game/entity/impl/npc/NpcInteractionManager');
  const { DefinitionLoader } = require('../dist/game/definition/loader/DefinitionLoader');
  const methods = NpcInteractionManager.pluginMethods;
  const bindings = NpcInteractionManager.pluginBindings;
  NpcInteractionManager.pluginMethods = new Map();
  NpcInteractionManager.pluginBindings = new Map();
  t.after(() => {
    NpcInteractionManager.pluginMethods = methods;
    NpcInteractionManager.pluginBindings = bindings;
  });
  const source = t.mock.method(DefinitionLoader, 'registerSource', () => {});
  const spawn = t.mock.method(manager, 'spawnNpc', () => null);
  const api = manager.createApi('Quests');
  const first = api.withProfileLabel('Quests/First');
  const second = api.withProfileLabel('Quests/Second');
  let now = 0n;
  t.mock.method(process.hrtime, 'bigint', () => now);
  first.onNpcClick(1, 1, function talkToGuide() { now += 3_000_000n; return true; });
  assert.equal(manager.emitNpcInteraction({ player: {}, npc: {}, npcId: 1, clickType: 1, handled: false }), true);
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxHandlerName, 'talkToGuide', 'core guard keeps original name');
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxEventName, 'npc_interaction');
  assert.deepEqual(NpcInteractionManager.all().find((entry) => entry.npcId === 1).firstClick,
    { method: 'quests.talkToGuide', source: 'Quests' });
  first.registerNpcInteraction(1, { firstClick: { shopId: 1 } });
  second.registerNpcInteraction(2, { firstClick: { shopId: 2 } });
  assert.equal(source.mock.callCount(), 1, 'scopes share the owner source instead of overwriting it');
  const [, owner, definitionSource] = source.mock.calls[0].arguments;
  assert.equal(owner, 'Quests');
  assert.deepEqual(definitionSource.load().map((entry) => entry.npcId), [1, 2]);
  const definition = { id: 1, x: 3222, y: 3219 };
  first.spawnNpc(definition);
  assert.deepEqual(spawn.mock.calls[0].arguments, [definition, 'Quests']);
});

test('scoped area methods and action dictionaries identify the original callback', (t) => {
  const manager = isolatedProfiler(t);
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const areas = AreaManager.areas;
  AreaManager.areas = [];
  t.after(() => { AreaManager.areas = areas; });
  let now = 0n;
  t.mock.method(process.hrtime, 'bigint', () => now);
  const api = manager.createApi('Quests').withProfileLabel('Quests/First');
  class QuestArea {
    getName() { return 'Quest area'; }
    process() { now += 4_000_000n; return 'processed'; }
  }
  const area = new QuestArea();
  api.registerArea(area);
  assert.equal(area.pluginName, 'Quests');
  assert.equal(manager.callArea(area, 'process'), 'processed');
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxHandlerName, 'QuestArea.process');
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxEventName, 'area:process');

  api.onObjectInteraction('Door', { Open: function openDoor() { now += 6_000_000n; } });
  const definition = { getName: () => 'Door', getInteractions: () => ['Open'] };
  assert.equal(manager.emitObjectInteraction({ player: {}, object: {}, definition, objectId: 1, clickType: 1, handled: false }), true);
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxHandlerName, 'openDoor');
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxEventName, 'object_interaction');
  api.onNpcInteraction('Guide', { 'Talk-to': function startQuest() { now += 8_000_000n; } });
  assert.equal(manager.emitNpcInteraction({ player: {}, npc: {}, npcId: 1, clickType: 1,
    definition: { getName: () => 'Guide', getActions: () => ['Talk-to'] }, handled: false }), true);
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxHandlerName, 'startQuest');
  assert.equal(manager.getPluginPerformanceSnapshot()[0].maxEventName, 'npc_interaction');
});

test('combat policy respects either distinct area denial and retains global denials', (t) => {
  const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { Location } = require('../dist/game/model/Location');
  const global = t.mock.method(PluginManager, 'emitCanAttack', () => null);
  const calls = [];
  const area = (name, verdict) => ({
    getName: () => name,
    canAttack: () => { calls.push(name); return verdict; },
  });
  const actor = (area) => ({
    getArea: () => area, getPrivateArea: () => null,
    isPlayer: () => true, getLocation: () => new Location(3222, 3219, 0),
  });
  const allow = area('allow', true), deny = area('deny', false), neutral = area('neutral', null);
  const response = (a, b) => CombatFactory.canAttackByPolicy(actor(a), actor(b));
  assert.equal(response(allow, deny), CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.deepEqual(calls.splice(0), ['allow', 'deny'], 'the target is consulted after an attacker-side allow');
  assert.equal(response(deny, allow), CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.deepEqual(calls.splice(0), ['deny'], 'an attacker-side denial still short-circuits');
  assert.equal(response(allow, neutral), CanAttackResponse.CAN_ATTACK);
  assert.equal(response(neutral, allow), CanAttackResponse.CAN_ATTACK);
  calls.length = 0;
  assert.equal(response(allow, allow), CanAttackResponse.CAN_ATTACK);
  assert.deepEqual(calls, ['allow'], 'a shared area runs once');
  global.mock.mockImplementation(() => false);
  assert.equal(response(allow, neutral), CanAttackResponse.CANT_ATTACK_IN_AREA);
});

function areaPriorityWorld(t) {
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { Area } = require('../dist/game/model/areas/Area');
  const { Boundary } = require('../dist/game/model/Boundary');
  const { Location } = require('../dist/game/model/Location');
  const saved = { areas: AreaManager.areas, areaSearchIndex: AreaManager.areaSearchIndex };
  t.after(() => Object.assign(AreaManager, saved));
  const events = [];
  class TrackedArea extends Area {
    constructor(name, min, max) { super([new Boundary(min, max, min, max, 0)]); this.label = name; }
    postEnter() { events.push(`${this.label}:enter`); }
    postLeave() { events.push(`${this.label}:leave`); }
    process() { events.push(`${this.label}:process`); }
  }
  const broad = new TrackedArea('broad', 0, 30), specific = new TrackedArea('specific', 10, 20);
  AreaManager.areas = [specific, broad];
  AreaManager.areaSearchIndex = null;
  let currentArea = null, location = new Location(5, 5, 0);
  const mobile = {
    getLocation: () => location, moveTo: (at) => { location = at; },
    getArea: () => currentArea, setArea: (area) => { currentArea = area; },
    isPlayer: () => false, isNpc: () => true, getAsNpc: () => mobile, getIndex: () => 1,
  };
  return { AreaManager, Location, TrackedArea, broad, specific, events, mobile };
}

test('moving through overlapping areas respects priority without looking up stationary actors', (t) => {
  const { AreaManager, Location, TrackedArea, broad, specific, events, mobile } = areaPriorityWorld(t);
  const lookup = t.mock.method(AreaManager, 'getWithBoundaryIndex');
  broad.enter(mobile);
  mobile.setArea(broad);
  AreaManager.process(mobile);
  assert.equal(mobile.getArea(), broad);
  assert.equal(lookup.mock.callCount(), 1);
  AreaManager.process(mobile);
  assert.equal(lookup.mock.callCount(), 1, 'stationary actors use their current boundary');
  events.length = 0;
  mobile.moveTo(new Location(15, 15, 0));
  AreaManager.process(mobile);
  assert.equal(mobile.getArea(), specific);
  assert.deepEqual(events, ['broad:leave', 'specific:enter', 'specific:process']);
  assert.equal(lookup.mock.callCount(), 2);
  AreaManager.process(mobile);
  assert.equal(lookup.mock.callCount(), 2);
  events.length = 0;
  mobile.moveTo(new Location(5, 5, 0));
  AreaManager.process(mobile);
  assert.equal(mobile.getArea(), broad);
  assert.deepEqual(events, ['specific:leave', 'broad:enter', 'broad:process']);
  assert.equal(lookup.mock.callCount(), 3);

  const instance = new TrackedArea('instance', 0, 30);
  instance.enter(mobile);
  mobile.setArea(instance);
  mobile.moveTo(new Location(15, 15, 0));
  AreaManager.process(mobile);
  assert.equal(mobile.getArea(), instance, 'an explicitly entered instance keeps ownership');
  assert.equal(lookup.mock.callCount(), 3, 'unregistered instances skip global priority lookups');
});

test('a same-area process teleport rechecks overlapping priority on the next tick', (t) => {
  const { AreaManager, Location, broad, specific, mobile } = areaPriorityWorld(t);
  broad.process = () => mobile.moveTo(new Location(15, 15, 0));
  AreaManager.process(mobile);
  assert.equal(mobile.getArea(), broad, 'the current callback completes in its original area');
  AreaManager.process(mobile);
  assert.equal(mobile.getArea(), specific, 'the teleport is not hidden by the location hint');
});


test('generic chests load on free-to-play worlds without members-only chest plugins', () => {
  const fs = require('node:fs');
  const files = {
    'plugins/Chests.plugin.js': fs.readFileSync(require.resolve('../plugins/objects/Chests.plugin.js'), 'utf8'),
  };
  for (const name of ['Quests', 'Clans', 'RandomEvents', 'GiantLairs']) {
    files[`plugins/${name}.plugin.js`] = plugin(name);
  }
  for (const [name, source] of [
    ['KeyChests', '../plugins/objects/KeyChests.plugin'],
    ['TheatreOfBlood', '../plugins/minigames/TheatreOfBlood.plugin'],
  ]) {
    files[`plugins/${name}.plugin.js`] = plugin(name, `members: ${require(source).members},`);
  }
  const worldDefinition = require('../dist/game/definition/WorldDefinition');
  const originalMembers = worldDefinition.isMembersWorld;
  try {
    worldDefinition.isMembersWorld = () => false;
    const { loaded, warn } = loadPlugins({}, files);
    assert.ok(!loaded.includes('KeyChests') && !loaded.includes('TheatreOfBlood'));
    assert.ok(loaded.includes('Chests'), warn.join('\n'));
  } finally {
    worldDefinition.isMembersWorld = originalMembers;
  }
});
