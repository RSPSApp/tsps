// Run after build: node --test tests/world-config-store.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { WorldConfigStore } = require('../dist/game/definition/WorldConfigStore');
const { WorldConfigCatalog } = require('../dist/plugins/WorldConfigCatalog');

const SHIPPED = {
  name: 'Test', description: '', experienceMultiplier: 1, membersWorld: true,
  spawn: { x: 3222, y: 3218, z: 0 }, zones: [], gameframe: 'modern-resizable',
  plugins: { Base: true }, pluginConfig: { 'Opt:a': true },
};
const OPT = { type: 'boolean', label: 'Opt', help: 'x', default: true };
const plugin = (name, extra = '') =>
  `module.exports = { name: '${name}', config: { '${name}:sequentialBurying': ${JSON.stringify(OPT)} }, ${extra} register() {} };`;

function tmp(local, shipped = SHIPPED) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-store-'));
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(shipped));
  if (local !== undefined) fs.writeFileSync(path.join(dir, 'world.local.json'), typeof local === 'string' ? local : JSON.stringify(local));
  return dir;
}
function pluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-store-plugins-'));
  fs.mkdirSync(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a', 'Prayer.plugin.js'), plugin('Prayer'));
  fs.writeFileSync(path.join(dir, 'a', 'Base.plugin.js'), plugin('Base'));
  fs.writeFileSync(path.join(dir, 'a', 'Child.plugin.js'), plugin('Child', "dependsOn: ['Base'],"));
  fs.writeFileSync(path.join(dir, 'a', 'Mem.plugin.js'), plugin('Mem', 'members: true,'));
  return dir;
}
function run(local, changes, shipped = SHIPPED) {
  const dir = tmp(local, shipped);
  const pdir = pluginDir();
  try {
    const layers = WorldConfigStore.read(dir);
    const catalog = WorldConfigCatalog.build(pdir, layers);
    return { layers, plan: WorldConfigStore.plan(layers, changes, catalog) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pdir, { recursive: true, force: true });
  }
}

test('values equal to shipped are removed, others diff key by key', () => {
  const { plan } = run({ experienceMultiplier: 3, pluginConfig: { 'Opt:a': false } },
    { world: { experienceMultiplier: 1, name: 'Mine' }, pluginConfig: { 'Opt:a': null, 'Opt:b': 5 }, plugins: { Prayer: false, Base: true } });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.nextLocal, { name: 'Mine', pluginConfig: { 'Opt:b': 5 }, plugins: { Prayer: false } });
  const paths = plan.diff.map((d) => d.path).sort();
  assert.deepEqual(paths, ['experienceMultiplier', 'name', 'pluginConfig.Opt:a', 'pluginConfig.Opt:b', 'plugins.Prayer']);
  const exp = plan.diff.find((d) => d.path === 'experienceMultiplier');
  assert.equal(exp.before, 3);
  assert.equal(exp.after, undefined);
  assert.ok(plan.warnings.some((w) => w.includes('Opt:b')), 'undeclared pluginConfig key warns');
});

test('unmanaged keys survive unchanged', () => {
  const { plan } = run({ zones: [{ a: 1 }], someUnknown: 1 }, { world: { name: 'N' } });
  assert.deepEqual(plan.nextLocal, { zones: [{ a: 1 }], someUnknown: 1, name: 'N' });
});

test('legacy disabledPlugins becomes plugins entries', () => {
  const { plan } = run({ disabledPlugins: ['Prayer'] }, {});
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.nextLocal, { plugins: { Prayer: false } });
  assert.ok(plan.diff.some((d) => d.path === 'disabledPlugins' && d.after === undefined));
  assert.ok(plan.diff.some((d) => d.path === 'plugins.Prayer' && d.after === false));
});

function enabledMap(layers, catalog, local) {
  const { PluginManager, pluginNameFromFile, resolvePluginEnabled } = require('../dist/plugins/PluginManager');
  const { mergeWorldConfig } = require('../dist/game/definition/WorldDefinition');
  const { switches, defaultEnabled } = PluginManager.parsePluginSwitches(mergeWorldConfig(layers.shipped, local));
  return Object.fromEntries(catalog.plugins.map((p) => [p.name,
    resolvePluginEnabled(switches, defaultEnabled, p.name, pluginNameFromFile(p.file), p.defaultEnabled ? undefined : false)]));
}

test('legacy migration keeps the enabled set identical (default-off stays on, masked plugins entry ignored)', () => {
  const dir = tmp({ disabledPlugins: ['Prayer'] }, { ...SHIPPED, plugins: { Base: true, Opt: false } });
  const pdir = pluginDir();
  fs.writeFileSync(path.join(pdir, 'a', 'Opt.plugin.js'), plugin('Opt', 'enabled: false,'));
  fs.writeFileSync(path.join(pdir, 'a', 'Foo.plugin.js'), plugin('Foo'));
  fs.writeFileSync(dir + '/world.json', JSON.stringify({ ...SHIPPED, plugins: { Base: true, Foo: false } }));
  try {
    const layers = WorldConfigStore.read(dir);
    const catalog = WorldConfigCatalog.build(pdir, layers);
    const before = enabledMap(layers, catalog, layers.local);
    assert.equal(before.Opt, true, 'legacy list turns default-off plugins on');
    assert.equal(before.Foo, true, 'legacy list masks the plugins section');
    const plan = WorldConfigStore.plan(layers, {}, catalog);
    assert.equal(plan.nextLocal.disabledPlugins, undefined);
    assert.equal(plan.nextLocal.plugins.Opt, true);
    assert.equal(plan.nextLocal.plugins.Foo, true);
    assert.equal(plan.nextLocal.plugins.Prayer, false);
    assert.deepEqual(enabledMap(layers, catalog, plan.nextLocal), before);
    assert.ok(plan.diff.some((d) => d.path === 'disabledPlugins'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pdir, { recursive: true, force: true });
  }
});

test('invalid values are errors', () => {
  let r = run({}, { world: { experienceMultiplier: 0 } });
  assert.ok(r.plan.errors.length > 0);
  r = run({}, { pluginConfig: { 'Prayer:sequentialBurying': 'yes' } });
  assert.ok(r.plan.errors.some((e) => e.includes('Prayer:sequentialBurying')));
  r = run({}, { plugins: { Base: 'no' } });
  assert.ok(r.plan.errors.length > 0);
});

test('warns about dependents and members content on a free world', () => {
  let r = run({}, { plugins: { Base: false } });
  assert.deepEqual(r.plan.errors, []);
  assert.ok(r.plan.warnings.some((w) => w.includes('Child')));
  r = run({}, { world: { membersWorld: false } });
  assert.ok(r.plan.warnings.some((w) => w.includes('Mem')));
});

test('malformed local file is reported by read and refused by write', () => {
  const dir = tmp('{ nope');
  try {
    const layers = WorldConfigStore.read(dir);
    assert.ok(layers.localError);
    assert.throws(() => WorldConfigStore.write(dir, { name: 'x' }, layers.localHash), /parse|malformed|valid/i);
    assert.equal(fs.readFileSync(path.join(dir, 'world.local.json'), 'utf8'), '{ nope');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('write is hash guarded, atomic, and creates the file', () => {
  const dir = tmp(undefined);
  try {
    const before = fs.readFileSync(path.join(dir, 'world.json'), 'utf8');
    WorldConfigStore.write(dir, { name: 'A' }, '');
    const file = path.join(dir, 'world.local.json');
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ name: 'A' }, null, 2) + '\n');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['world.json', 'world.local.json']);
    assert.throws(() => WorldConfigStore.write(dir, { name: 'B' }, ''), /changed since loaded/);
    assert.throws(() => WorldConfigStore.write(dir, { name: 'B' }, 'stale'), /changed since loaded/);
    const hash = WorldConfigStore.read(dir).localHash;
    WorldConfigStore.write(dir, { name: 'C' }, hash);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).name, 'C');
    assert.equal(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
