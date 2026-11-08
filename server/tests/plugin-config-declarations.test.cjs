// Run after `yarn build`: node --test tests/plugin-config-declarations.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');

const COUNT = { type: 'number', label: 'Count', help: 'How many.', default: 5 };

function fixtureDir(plugins) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-config-'));
  for (const [file, body] of Object.entries(plugins)) {
    fs.writeFileSync(path.join(dir, `${file}.plugin.js`), body);
  }
  return dir;
}

const plugin = (name, config) =>
  `module.exports = { name: ${JSON.stringify(name)}, config: ${JSON.stringify(config)}, register() {} };`;

function load(plugins, pluginConfig = {}) {
  const dir = fixtureDir(plugins);
  PluginManager.initialized = false;
  PluginManager.loadedPlugins = [];
  PluginManager.pluginConfigDeclarations.clear();
  PluginManager.pluginConfigCache = pluginConfig;
  const warnings = [];
  const originalWarn = console.warn;
  const originalInfo = console.info;
  console.warn = (...args) => warnings.push(args.join(' '));
  console.info = () => {};
  try {
    PluginManager.loadFromDirectory(dir);
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return warnings;
}

test('two plugins declaring the same key fail the load, naming both and the key', () => {
  assert.throws(
    () => load({ A: plugin('Alpha', { 'Shared:count': COUNT }), B: plugin('Beta', { 'Shared:count': COUNT }) }),
    (err) => /Shared:count/.test(err.message) && /Alpha/.test(err.message) && /Beta/.test(err.message),
  );
});

test('an invalid declaration fails the load with the validation problem', () => {
  assert.throws(
    () => load({ A: plugin('Alpha', { 'Alpha:bad': { type: 'number', label: 'Bad', help: 'x' } }) }),
    /Alpha:bad: set exactly one of default or defaultText/,
  );
});

test('a configured value that fails its declaration is warned about once and still returned', () => {
  const warnings = load({ F: plugin('Fixture', { 'Fixture:count': COUNT }) }, { 'Fixture:count': 'abc' });
  const mine = warnings.filter((w) => w.includes('Fixture:count'));
  assert.equal(mine.length, 1);
  assert.equal(PluginManager.getPluginConfig('Fixture:count', 5), 'abc');
});

test('getConfigDeclarations lists loaded plugin keys with their owner plus the core keys', () => {
  load({ F: plugin('Fixture', { 'Fixture:count': COUNT }) });
  const all = PluginManager.getConfigDeclarations();
  assert.equal(all.get('Fixture:count').owner, 'Fixture');
  assert.deepEqual(all.get('Fixture:count').decl, COUNT);
  for (const key of ['CrossFloor:visibility', 'CrossFloor:combat', 'commands:permissions']) {
    assert.equal(all.get(key).owner, 'core');
  }
});
