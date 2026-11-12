// Run after `yarn build`: node --test tests/world-config-catalog.test.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { WorldConfigCatalog } = require('../dist/plugins/WorldConfigCatalog');

const OPT = { type: 'boolean', label: 'Opt', help: 'An option.', default: true };
const plugin = (name, extra = '') =>
  `module.exports = { name: ${JSON.stringify(name)}, description: 'About ${name}.', config: { '${name}:opt': ${JSON.stringify(OPT)} }, ${extra} register() {} };`;

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-catalog-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const layers = (shipped = {}, local = {}, localHash = 'h') => ({ shipped, local, localExists: true, localHash });

test('a plugin switched off still appears, disabled, with its option owner disabled', () => {
  const dir = fixture({
    'skills/On.plugin.js': plugin('On'),
    'skills/Off.plugin.js': plugin('Off'),
    'quests/Dependent.plugin.js': plugin('Dependent', "dependsOn: ['Off'],"),
    'quests/Members.plugin.js': plugin('Members', 'members: true,'),
  });
  try {
    const data = WorldConfigCatalog.build(dir, layers(
      { plugins: { FreeToPlay: true }, pluginConfig: { 'On:opt': false } },
      { plugins: { Off: false }, pluginConfig: { 'On:opt': true } }, 'a'));
    const byName = Object.fromEntries(data.plugins.map((p) => [p.name, p]));
    assert.equal(byName.On.enabled, true);
    assert.equal(byName.On.loaded, true);
    assert.equal(byName.On.area, 'skills');
    assert.equal(byName.On.description, 'About On.');
    assert.equal(byName.Off.enabled, false);
    assert.equal(byName.Off.loaded, false);
    assert.equal(byName.Dependent.enabled, true);
    assert.equal(byName.Dependent.loaded, false, 'a dependency that is off keeps it unloaded');
    assert.equal(byName.Members.loaded, false, 'members plugin on a free-to-play world');
    const off = data.options.find((o) => o.key === 'Off:opt');
    assert.equal(off.ownerEnabled, false);
    assert.equal(off.owner, 'Off');
    const on = data.options.find((o) => o.key === 'On:opt');
    assert.equal(on.shipped, false);
    assert.equal(on.local, true);
    assert.equal(data.membersWorld, false);
    assert.ok(data.options.some((o) => o.owner === 'core' && o.ownerEnabled));
    assert.ok(data.world.length > 0 && data.world.every((o) => o.owner === 'world'));
    assert.equal(data.world.find((o) => o.key === 'name').shipped, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('like the loader, the catalog leaves out invalid declarations and gives a clashing key to its loaded owner', () => {
  const dir = fixture({
    'a/Bad.plugin.js': `module.exports = { name: 'Bad', config: { 'Bad:opt': { type: 'number', label: 'L', help: 'H', default: '5' }, 'Bad:ok': ${JSON.stringify(OPT)} }, register() {} };`,
    'a/Junk.plugin.js': "module.exports = { name: 'Junk', config: [1], register() {} };",
    'a/AOff.plugin.js': `module.exports = { name: 'AOff', enabled: false, config: { 'Shared:opt': ${JSON.stringify(OPT)} }, register() {} };`,
    'a/BOn.plugin.js': `module.exports = { name: 'BOn', config: { 'Shared:opt': ${JSON.stringify(OPT)}, 'commands:permissions': ${JSON.stringify(OPT)} }, register() {} };`,
  });
  try {
    const data = WorldConfigCatalog.build(dir, layers({}, {}, 'clash'));
    const keys = data.options.map((o) => `${o.owner}/${o.key}`);
    assert.ok(!keys.includes('Bad/Bad:opt'), keys.join());
    assert.ok(keys.includes('Bad/Bad:ok'));
    assert.ok(!keys.some((k) => k.startsWith('Junk/')));
    assert.deepEqual(data.options.filter((o) => o.key === 'Shared:opt').map((o) => o.owner), ['BOn']);
    assert.deepEqual(data.options.filter((o) => o.key === 'commands:permissions').map((o) => o.owner), ['core']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a clashing key goes to the first claimant that loads when the earlier one fails its dependsOn', () => {
  const shared = `config: { 'Shared:k': ${JSON.stringify(OPT)} }`;
  const dir = fixture({
    'a/Alpha.plugin.js': `module.exports = { name: 'Alpha', dependsOn: ['Nope'], ${shared}, register() {} };`,
    'a/Beta.plugin.js': `module.exports = { name: 'Beta', ${shared}, register() {} };`,
  });
  try {
    const data = WorldConfigCatalog.build(dir, layers({}, {}, 'dep-clash'));
    assert.deepEqual(data.options.filter((o) => o.key === 'Shared:k').map((o) => [o.owner, o.ownerEnabled]), [['Beta', true]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the catalog is cached per layers hash', () => {
  const dir = fixture({ 'a/A.plugin.js': plugin('A') });
  try {
    const first = WorldConfigCatalog.build(dir, layers({}, {}, 'x'));
    assert.equal(WorldConfigCatalog.build(dir, layers({}, {}, 'x')), first);
    assert.notEqual(WorldConfigCatalog.build(dir, layers({}, { plugins: { A: false } }, 'y')), first);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('imported source is listed from its manifest until the runtime loads it', () => {
  const entry = 'imported/welcome/Welcome.plugin.js';
  const dir = fixture({
    [entry]: plugin('Welcome'),
    'imported/welcome/plugin.json': JSON.stringify({ format: 1, id: 'welcome', name: 'Welcome', version: '1.0.0', description: 'Uploaded welcome message.' }),
  });
  const file = require.resolve(path.join(dir, entry));
  try {
    const first = WorldConfigCatalog.build(dir, layers());
    assert.equal(first.plugins[0].description, 'Uploaded welcome message.');
    assert.equal(first.plugins[0].awaitingLoad, true);
    assert.equal(first.plugins[0].packageId, 'welcome');
    assert.equal(first.plugins[0].loaded, false);
    assert.equal(require.cache[file], undefined);
    require(file);
    WorldConfigCatalog.invalidate();
    const loaded = WorldConfigCatalog.build(dir, layers());
    assert.equal(loaded.plugins[0].loaded, true);
    assert.ok(loaded.options.some(option => option.owner === 'Welcome'));
  } finally {
    delete require.cache[file];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real Prayer plugin sits in the skills area', () => {
  const dir = path.resolve(__dirname, '..', 'plugins');
  const data = WorldConfigCatalog.build(dir, layers({}, {}, 'real'));
  assert.equal(data.plugins.find((p) => p.file === 'skills/Prayer.plugin.js').area, 'skills');
});

test('requiring every real plugin leaves no timer or socket behind', () => {
  const script = `
    const path = require('node:path');
    const { Server } = require('./dist/Server');
    Server.installProductionPathResolver();
    const { PluginManager } = require('./dist/plugins/PluginManager');
    const files = PluginManager.discoverPluginFiles(path.resolve('plugins'), PluginManager.MAX_PLUGIN_DEPTH);
    const count = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout' || r === 'TCPServerWrap').length;
    const before = count();
    const bad = [];
    for (const file of files) {
      const was = count();
      try { require(file); } catch (e) { bad.push(path.basename(file) + ' threw: ' + e.message); continue; }
      if (count() > was) bad.push(path.basename(file) + ' left a timer or socket');
    }
    console.log(JSON.stringify({ files: files.length, bad, grew: count() - before }));
    process.exit(0);`;
  const result = childProcess.spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 120000,
  });
  const line = result.stdout.trim().split('\n').pop();
  const out = JSON.parse(line);
  assert.ok(out.files > 50);
  assert.deepEqual(out.bad, []);
  assert.equal(out.grew, 0);
});

test('plugins report world.json and world.local.json switches so the page can send null to remove a local entry', () => {
  const dir = fixture({
    'a/Listed.plugin.js': plugin('Listed'),
    'a/LocalOnly.plugin.js': plugin('LocalOnly'),
    'a/ByFile.plugin.js': plugin('Renamed'),
  });
  try {
    const data = WorldConfigCatalog.build(dir, layers(
      { plugins: { listed: false, ByFile: true } },
      { plugins: { Listed: true, LocalOnly: false } }, 'switches'));
    const byName = Object.fromEntries(data.plugins.map((p) => [p.name, p]));
    assert.equal(byName.Listed.shippedSwitch, false, 'matched case-insensitively');
    assert.equal(byName.Listed.localSwitch, true);
    assert.equal(byName.LocalOnly.shippedSwitch, undefined);
    assert.equal(byName.LocalOnly.localSwitch, false);
    assert.equal(byName.Renamed.shippedSwitch, true, 'matched by file name');
    assert.equal(byName.Renamed.localSwitch, undefined);

    const legacy = WorldConfigCatalog.build(dir, layers({ disabledPlugins: ['Listed'] }, { plugins: { LocalOnly: false } }, 'legacy'));
    assert.equal(legacy.plugins.find((p) => p.name === 'LocalOnly').localSwitch, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
