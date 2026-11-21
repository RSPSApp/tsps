// Run after `yarn build`: node --test tests/mythical-cape.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const MythicalCape = require('../plugins/items/MythicalCape.plugin');

before(async () => CachePipeline.initialize(path.resolve(__dirname, '..')));

const core = PluginManager.getCoreApi();
const registered = [];
MythicalCape.register(new Proxy({
  core,
  onItemAction: (name, actions) => registered.push({ name, actions }),
}, { get: (object, key) => object[key] ?? (() => {}) }));

function withTeleportHandler(allowed, run) {
  const calls = [];
  const handler = core.TeleportHandler;
  const saved = { checkReqs: handler.checkReqs, teleport: handler.teleport };
  handler.checkReqs = (player, location, level) => { calls.push({ check: location, level }); return allowed; };
  handler.teleport = (player, location, type, wilderness) => calls.push({ teleport: location, type, wilderness });
  try { run(); } finally { Object.assign(handler, saved); }
  return calls;
}

test('the cape and the Mythical max cape are hooked by name with the same Teleport option', () => {
  assert.deepEqual(registered.map(({ name }) => name), ['Mythical cape', 'Mythical max cape']);
  for (const { actions } of registered) assert.deepEqual(Object.keys(actions), ['Teleport']);
  assert.equal(registered[1].actions.Teleport, registered[0].actions.Teleport);
});

test('Teleport takes the player to the Myths\' Guild with a normal teleport (rsprox 1437)', () => {
  const calls = withTeleportHandler(true, () => assert.equal(registered[0].actions.Teleport({ player: {} }), true));
  assert.equal(calls.length, 2);
  const [x, y, z] = MythicalCape._test.MYTHS_GUILD;
  assert.deepEqual([calls[1].teleport.getX(), calls[1].teleport.getY(), calls[1].teleport.getZ()], [x, y, z]);
  assert.deepEqual([x, y, z], [2458, 2850, 0]);
  assert.equal(calls[1].type, core.TeleportType.NORMAL);
});

test('a refused teleport (the shared checks) does nothing and still consumes the click', () => {
  const calls = withTeleportHandler(false, () => assert.equal(registered[0].actions.Teleport({ player: {} }), true));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].level, 20);
});

test('the cache gives the cape both an inventory and a worn Teleport option', () => {
  const definition = core.CacheDefinitions.getItem(core.ItemIdentifiers.MYTHICAL_CAPE_2);
  assert.equal(definition.name, 'Mythical cape');
  assert.equal(definition.inventoryActions[2], 'Teleport');
  assert.equal(definition.params.get(451), 'Teleport');
});

test('the cache gives the Mythical max cape the same inventory and worn Teleport option', () => {
  const definition = core.CacheDefinitions.getItem(core.ItemIdentifiers.MYTHICAL_MAX_CAPE);
  assert.equal(definition.name, 'Mythical max cape');
  assert.equal(definition.inventoryActions[2], 'Teleport');
  assert.equal(definition.params.get(451), 'Teleport');
});
