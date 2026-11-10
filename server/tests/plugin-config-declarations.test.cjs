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
  const errors = [];
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalError = console.error;
  console.warn = (...args) => warnings.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  console.info = () => {};
  try {
    PluginManager.loadFromDirectory(dir);
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
    console.error = originalError;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  warnings.errors = errors;
  return warnings;
}

const loaded = () => [...PluginManager.loadedPlugins].sort();

test('two loading plugins declaring the same key: logged, the later one loses the key, both still load', () => {
  const { errors } = load({ A: plugin('Alpha', { 'Shared:count': COUNT }), B: plugin('Beta', { 'Shared:count': COUNT, 'Beta:own': COUNT }) });
  assert.deepEqual(loaded(), ['Alpha', 'Beta']);
  assert.ok(errors.some((e) => /Shared:count/.test(e) && /Alpha/.test(e) && /Beta/.test(e)), errors.join('\n'));
  const all = PluginManager.getConfigDeclarations();
  assert.equal(all.get('Shared:count').owner, 'Alpha');
  assert.equal(all.get('Beta:own').owner, 'Beta');
});

test('a plugin redeclaring a core key keeps loading and the core keeps the key', () => {
  const { errors } = load({ A: plugin('Alpha', { 'CrossFloor:combat': COUNT }) });
  assert.deepEqual(loaded(), ['Alpha']);
  assert.ok(errors.some((e) => /CrossFloor:combat/.test(e) && /core/.test(e)), errors.join('\n'));
  assert.equal(PluginManager.getConfigDeclarations().get('CrossFloor:combat').owner, 'core');
});

test('an invalid declaration is logged and dropped; the plugin still loads', () => {
  const { errors } = load({ A: plugin('Alpha', { 'Alpha:bad': { type: 'number', label: 'Bad', help: 'x' }, 'Alpha:good': COUNT }) });
  assert.deepEqual(loaded(), ['Alpha']);
  assert.ok(errors.some((e) => /Alpha:bad: set exactly one of default or defaultText/.test(e)), errors.join('\n'));
  const all = PluginManager.getConfigDeclarations();
  assert.equal(all.has('Alpha:bad'), false);
  assert.equal(all.get('Alpha:good').owner, 'Alpha');
});

test('a malformed declaration on an enabled:false plugin does not throw and the load continues', () => {
  const off = 'module.exports={name:"Off",enabled:false,config:{"X:y":{type:"number",label:"L",help:"H"}},register(){}}';
  const { errors } = load({ Off: off, On: plugin('On', { 'On:count': COUNT }) });
  assert.deepEqual(loaded(), ['On']);
  assert.deepEqual(errors, []);
  assert.equal(PluginManager.getConfigDeclarations().get('On:count').owner, 'On');
});

test('a disabled plugin cannot clash with a loading one', () => {
  const off = `module.exports={name:"Off",enabled:false,config:${JSON.stringify({ 'Shared:count': COUNT })},register(){}}`;
  const { errors } = load({ A: off, B: plugin('Beta', { 'Shared:count': COUNT }) });
  assert.deepEqual(loaded(), ['Beta']);
  assert.deepEqual(errors, []);
  assert.equal(PluginManager.getConfigDeclarations().get('Shared:count').owner, 'Beta');
});

test('a clashed key goes to the first claimant that loads when the earlier one fails its dependsOn', () => {
  const alpha = `module.exports = { name: "Alpha", dependsOn: ["Nope"], config: ${JSON.stringify({ 'Shared:k': COUNT })}, register() {} };`;
  const { errors } = load({ A: alpha, B: plugin('Beta', { 'Shared:k': COUNT }) });
  assert.deepEqual(loaded(), ['Beta']);
  assert.ok(errors.some((e) => /Shared:k/.test(e) && /Alpha is expected to own it/.test(e)), errors.join('\n'));
  assert.equal(PluginManager.getConfigDeclarations().get('Shared:k').owner, 'Beta');
});

test('a config that is not an object is logged and ignored; the plugin still loads', () => {
  const { errors } = load({ A: 'module.exports={name:"Alpha",config:[1],register(){}}' });
  assert.deepEqual(loaded(), ['Alpha']);
  assert.ok(errors.some((e) => /Alpha: config must be an object/.test(e)), errors.join('\n'));
});

test('a configured value that fails its declaration is warned about once and still returned', () => {
  const warnings = load({ F: plugin('Fixture', { 'Fixture:count': COUNT }) }, { 'Fixture:count': 'abc' });
  const mine = warnings.filter((w) => w.includes('Fixture:count'));
  assert.equal(mine.length, 1);
  assert.equal(PluginManager.getPluginConfig('Fixture:count', 5), 'abc');
});

test('startup warns about undeclared scoped settings and suggests the declared casing', () => {
  const cwd = process.cwd();
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-world-'));
  const definitions = path.join(world, 'data', 'definitions');
  fs.mkdirSync(definitions, { recursive: true });
  fs.writeFileSync(path.join(definitions, 'world.json'), JSON.stringify({
    plugins: {
      fixture: { enabled: true, count: 4 },
      CHARACTERS: { maxPerAccount: 2 },
      Off: { count: 3 },
    },
    pluginConfig: { 'fixture:legacy': 1 },
  }));
  fs.writeFileSync(path.join(definitions, 'world.local.json'), JSON.stringify({
    plugins: { Fixture: { count: 6, typo: 7 } },
  }));
  process.chdir(world);
  try {
    const warnings = load({
      F: plugin('Fixture', { 'Fixture:count': COUNT }),
      C: plugin('Characters', { 'characters:maxPerAccount': COUNT }),
      Off: 'module.exports={name:"Off",enabled:false,register(){}}',
    }, null).filter((warning) => warning.includes('scoped setting'));
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /plugins\.fixture\.count.*use the spelling in "Fixture:count"/);
    assert.match(warnings[1], /plugins\.Fixture\.typo.*no declared key "Fixture:typo"/);
    assert.deepEqual(loaded(), ['Characters', 'Fixture']);
    assert.equal(PluginManager.createApi('Fixture').getPluginConfig('count'), 6);
    assert.equal(PluginManager.createApi('Characters').getPluginConfig('maxPerAccount'), 2);
    assert.equal(PluginManager.getPluginConfig('Fixture:typo'), 7);
    assert.equal(PluginManager.getPluginConfig('fixture:legacy'), 1);
  } finally {
    process.chdir(cwd);
    fs.rmSync(world, { recursive: true, force: true });
  }
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

test('a plugin can read its scoped option using the short name and the legacy full key', () => {
  const { normalizeWorldPluginConfig } = require('../dist/game/definition/WorldPluginConfig');
  const settings = normalizeWorldPluginConfig({ plugins: { Characters: { maxPerAccount: 4 } } }).pluginConfig;
  PluginManager.pluginConfigCache = settings;
  const api = PluginManager.createApi('Characters');
  assert.equal(api.getPluginConfig('maxPerAccount', 6), 4);
  assert.equal(api.getPluginConfig('characters:maxPerAccount', 6), 4);
  assert.equal(api.getPluginConfig('missing', 6), 6);
});
