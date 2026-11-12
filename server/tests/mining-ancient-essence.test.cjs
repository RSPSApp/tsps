const assert = require('node:assert/strict'), path = require('node:path');
const {before, after, test} = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const AncientEssence = require('../plugins/skills/mining/AncientEssence.Mining');
let core;
const CRYSTALS = 46701, WALL = 46702;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname,'..')); PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi(); core.RegionManager.init(); core.RegionManager.loadMapFiles(2912,10307); });
after(() => PM.emitServerShutdown({}));
const at = (id, s) => core.MapObjects.get(id, new core.Location(s.x, s.y, 0), null);
const crystalSpots = () => AncientEssence._test.SPOTS.filter(s => at(CRYSTALS, s));

test('the mine starts with one crystal spot and the other two walls', () => {
  const t = AncientEssence._test;
  assert.equal(crystalSpots().length, 0, 'the map places only walls');
  assert.equal(t.move(), true);
  assert.equal(crystalSpots().length, 1);
  assert.equal(t.SPOTS.filter(s => at(WALL, s)).length, 2);
});

test('the crystals move to a different spot after the wait, never two at once', () => {
  const t = AncientEssence._test;
  for (let i = 0; i < 20; i++) {
    const before = crystalSpots()[0];
    assert.equal(t.move(), true);
    const now = crystalSpots();
    assert.equal(now.length, 1);
    assert.notEqual(now[0], before);
  }
  const {wait} = t.state();
  assert.ok(wait >= 100 && wait <= 150, `wait ${wait} ticks is 60-90 s`);
});

test('essence by Mining level', () => {
  for (const [level, lo, hi] of [[75,1,2],[77,1,2],[78,2,3],[89,2,3],[90,3,4],[99,3,4]]) {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(AncientEssence.essenceAmount(level));
    assert.deepEqual([...seen].sort(), Array.from({length: hi-lo+1}, (_, k) => lo+k), `level ${level}`);
  }
});
