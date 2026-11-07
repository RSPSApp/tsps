const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const tables = require('../plugins/minigames/gamesroom/Tables.GamesRoom');
let core;

test.before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  tables.configure(core);
});

function at(object, id) {
  return core.MapObjects.get(id, object.getLocation().clone(), null);
}

test('real cache tables seat two players on actual stools and restore retained originals', t => {
  const allocation = tables.allocate('draughts', 0);
  assert.ok(allocation);
  t.after(() => allocation.release());
  assert.equal(allocation.stools.length, 2);
  assert.equal(allocation.seats.length, 2);
  assert.ok(at(allocation.table, core.CacheDefinitions.getLocId('boardgames_table_draughts')));
  for (let i = 0; i < 2; i++) {
    const stool = allocation.stools[i];
    assert.ok(at(stool, core.CacheDefinitions.getLocId('boardgames_barstool_invis')));
    assert.ok(allocation.seats[i].equals(stool.getLocation()));
    assert.notEqual(allocation.seats[i], stool.getLocation());
  }
  allocation.release();
  allocation.release();
  assert.equal(at(allocation.table, allocation.table.getId()), allocation.table);
  for (const stool of allocation.stools) assert.equal(at(stool, stool.getId()), stool);
});

test('two concurrent games transform independent tables and release independently', t => {
  const one = tables.allocate('draughts', 0), two = tables.allocate('runelink', 0);
  assert.ok(one); assert.ok(two);
  t.after(() => { one.release(); two.release(); });
  assert.equal(one.table.getLocation().equals(two.table.getLocation()), false);
  one.release();
  assert.equal(at(one.table, one.table.getId()), one.table);
  assert.ok(at(two.table, core.CacheDefinitions.getLocId('boardgames_table_runelink')));
  for (const stool of two.stools) assert.ok(at(stool, core.CacheDefinitions.getLocId('boardgames_barstool_invis')));
});

test('real map has forty-eight seats per plane, exhaustion is isolated and release permits reuse', t => {
  const held = [];
  t.after(() => held.forEach(entry => entry.release()));
  for (const plane of [0, 1]) {
    for (let i = 0; i < 48; i++) {
      const allocation = tables.allocate(i % 2 ? 'runelink' : 'draughts', plane);
      assert.ok(allocation, `table ${i + 1} on plane ${plane}`);
      assert.equal(allocation.table.getLocation().getZ(), plane);
      held.push(allocation);
    }
    assert.equal(tables.allocate('draughts', plane), null);
  }
  const original = held[0];
  original.release();
  const again = tables.allocate('runelink', 0);
  assert.ok(again);
  held.push(again);
  assert.ok(again.table.getLocation().equals(original.table.getLocation()));
  original.release();
  assert.equal(tables.allocate('draughts', 0), null, 'stale release cannot release its replacement');
});

test('unsupported game and plane do not reserve a table', () => {
  assert.equal(tables.allocate('unknown-game', 0), null);
  assert.equal(tables.allocate('draughts', 2), null);
});
