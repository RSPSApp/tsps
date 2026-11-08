// Run after `yarn build`: node --test tests/world-config-docs.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { WorldConfigStore } = require('../dist/game/definition/WorldConfigStore');
const { WorldConfigCatalog } = require('../dist/plugins/WorldConfigCatalog');
const { renderWorldConfigDocs, WORLD_CONFIG_DOCS_START, WORLD_CONFIG_DOCS_END } = require('../dist/plugins/WorldConfigDocs');

const root = path.resolve(__dirname, '..');
const doc = fs.readFileSync(path.join(root, '..', 'docs', 'world-configuration.md'), 'utf8');

test('the generated settings block in docs/world-configuration.md is current', () => {
  const start = doc.indexOf(WORLD_CONFIG_DOCS_START);
  const end = doc.indexOf(WORLD_CONFIG_DOCS_END);
  assert.ok(start >= 0 && end > start, 'docs/world-configuration.md is missing the generated-block markers');
  const committed = doc.slice(start + WORLD_CONFIG_DOCS_START.length, end).trim();
  const { shipped } = WorldConfigStore.read(path.join(root, 'data', 'definitions'));
  const catalog = WorldConfigCatalog.build(path.join(root, 'plugins'), { shipped, local: {}, localExists: false, localHash: '' });
  assert.equal(committed, renderWorldConfigDocs(catalog).trim(),
    'The generated settings block is stale. Run: yarn --cwd server world-config-docs');
});

test('table cells escape pipes and newlines', () => {
  const decl = { type: 'enum', label: 'A|B', help: 'one\ntwo | three', default: 'x', values: [{ value: 'x', label: 'Ex' }] };
  const out = renderWorldConfigDocs({
    plugins: [], world: [], membersWorld: true,
    options: [{ key: 'P:k', owner: 'core', decl, shipped: undefined, local: undefined, ownerEnabled: true }],
  });
  assert.match(out, /\*\*A\\\|B\.\*\* one two \\\| three/);
  assert.match(out, /enum: `x` \(Ex\)/);
});
