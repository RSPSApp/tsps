// Run after `yarn build`: node --test tests/world-local-config.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const modulePath = require.resolve('../dist/game/definition/WorldDefinition');
// Load runtime dependencies before the fixture switches to a minimal data directory.
const { PluginManager, resolvePluginEnabled } = require('../dist/plugins/PluginManager');
const { CrossFloor } = require('../dist/game/CrossFloor');
const crossFloorPlugin = require('../plugins/world/CrossFloor.plugin.js');
const shipped = {
  spawn: { x: 3222, y: 3219, z: 0 },
  zones: [{ tags: [] }],
  plugins: { TutorialIsland: false, PvpMode: false },
  experienceMultiplier: 1,
  pluginConfig: { a: 1, b: 2 },
};

/** Loads WorldDefinition from a directory holding world.json (and world.local.json, if given). */
function loadWorld(local, shippedWorld = shipped) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-world-local-'));
  const cwd = process.cwd();
  const policy = CrossFloor.policy;
  try {
    fs.mkdirSync(path.join(directory, 'data/definitions'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'data/definitions/world.json'), JSON.stringify(shippedWorld));
    if (local) {
      fs.writeFileSync(path.join(directory, 'data/definitions/world.local.json'), JSON.stringify(local));
    }
    process.chdir(directory);
    delete require.cache[modulePath];
    const world = require(modulePath);
    PluginManager.pluginConfigCache = undefined;
    const config = world.readWorldConfig();
    const { switches, defaultEnabled } = PluginManager.parsePluginSwitches(config);
    CrossFloor.policy = undefined;
    if (resolvePluginEnabled(switches, defaultEnabled, 'CrossFloor', 'CrossFloor', crossFloorPlugin.enabled)) {
      crossFloorPlugin.register({ core: { CrossFloor }, getPluginConfig: key => PluginManager.getPluginConfig(key) });
    }
    return { config, definition: world.getWorldDefinition(),
      crossFloor: [CrossFloor.enabled(), CrossFloor.combatEnabled()] };
  } finally {
    CrossFloor.policy = policy;
    process.chdir(cwd);
    PluginManager.pluginConfigCache = undefined;
    delete require.cache[modulePath];
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('without world.local.json the shipped world.json applies', () => {
  const { definition } = loadWorld();
  assert.equal(definition.experienceMultiplier, 1);
  assert.deepEqual(definition.plugins, { TutorialIsland: false, PvpMode: false });
});

test('world.local.json replaces top-level keys and merges pluginConfig and plugins', () => {
  const { config, definition } = loadWorld({
    experienceMultiplier: 10,
    plugins: { TutorialIsland: true },
    pluginConfig: { b: 3 },
  });
  assert.equal(definition.experienceMultiplier, 10);
  assert.deepEqual(definition.plugins, { TutorialIsland: true, PvpMode: false });
  assert.deepEqual(config.pluginConfig, { a: 1, b: 3 });
  assert.deepEqual(definition.spawn, shipped.spawn, 'keys it does not set stay as shipped');
});

test('cross-floor options are read from the real layered world configuration', () => {
  assert.deepEqual(loadWorld({ pluginConfig: { 'CrossFloor:visibility': true, 'CrossFloor:combat': true } }).crossFloor, [true, true]);
  assert.deepEqual(loadWorld({ pluginConfig: { 'CrossFloor:visibility': true, 'CrossFloor:combat': false } }).crossFloor, [true, false]);
  assert.deepEqual(loadWorld({ pluginConfig: { 'CrossFloor:visibility': false, 'CrossFloor:combat': true } }).crossFloor, [false, false]);
});

test('CrossFloor switch wins within a layer and world.local.json can use either format', () => {
  assert.deepEqual(loadWorld({
    plugins: { CrossFloor: { enabled: false, combat: true } },
    pluginConfig: { 'CrossFloor:visibility': true },
  }).crossFloor, [false, false]);
  assert.deepEqual(loadWorld({
    plugins: { CrossFloor: { enabled: true, combat: true } },
  }, { ...shipped, plugins: { 'cross-floor': false } }).crossFloor, [true, true]);
  assert.deepEqual(loadWorld({
    pluginConfig: { 'CrossFloor:visibility': false },
  }, { ...shipped, plugins: { CrossFloor: { enabled: true, combat: true } } }).crossFloor, [false, false]);
  assert.deepEqual(loadWorld({
    pluginConfig: { 'CrossFloor:visibility': true, 'CrossFloor:combat': true },
  }, { ...shipped, disabledPlugins: [] }).crossFloor, [true, true]);
});

test('world names default to OSRS and local overrides are trimmed', () => {
  assert.equal(loadWorld().definition.name, 'Old School RuneScape');
  assert.equal(loadWorld({ name: '  Solaris RSPS  ' }).definition.name, 'Solaris RSPS');
});
test('world names reject invalid types, markup, controls and excessive length', () => {
  for (const name of [null, 1, '', '   ', 'x'.repeat(65), 'Solaris\nRSPS', '<col=ff0000>World']) assert.throws(() => loadWorld({ name }), /name must be plain text/);
});
