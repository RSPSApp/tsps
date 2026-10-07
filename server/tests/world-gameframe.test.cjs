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

const world = (extra) => ({ spawn: { x: 3222, y: 3219, z: 0 }, zones: [{ tags: [] }], disabledPlugins: [], ...extra });

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

test('voice is disabled in the default world', () => {
  assert.ok(require('../data/definitions/world.json').disabledPlugins.includes('VoiceChat'));
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
      disabledPlugins: ['VoiceChat', 'DisabledAlias', 'NotInstalled'],
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
