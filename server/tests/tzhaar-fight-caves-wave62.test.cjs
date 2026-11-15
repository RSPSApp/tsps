// Run after `yarn build`: node --test tests/tzhaar-fight-caves-wave62.test.cjs
// Wave 62 is two Ket-Zeks: one plain (3125) and one recoloured (3126) that stands on TzTok-Jad's spawn point, so it marks
// where Jad appears in the next round. Retail: RSProx 1151 (rev 237.1, "Wave: 62" line 81745 [2583]; NPC adds line 81757:
// 3125 at (13770,15474), 3126 at (13770,15439)); reviewer-verified in recordings 551 (rev 227.1) and 83 (rev 227.1): 3126 is
// added at Jad's spawn tile (551: (10723,2383) at wave 62, Jad 3127 at the same tile at wave 63). Colour inferred from the
// cache's recolour pair on 3126; not decoded. Placement follows the plugin's own spawn cycle (index 1 of wave 62 = Jad's point).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const plugin = require('../plugins/minigames/TzhaarFightCaves.plugin');

const core = PluginManager.getCoreApi();
const N = core.NpcIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = new Proxy({ core }, { get: (target, key) => target[key] ?? (() => {}) });
  plugin.register(api);
});

test('wave 62 is one plain Ket-Zek (3125) and one recoloured Ket-Zek (3126)', () => {
  assert.deepEqual(plugin.waveMonsters(62), [N.KET_ZEK, N.KET_ZEK_2]);
});

test('the recoloured Ket-Zek of wave 62 stands on TzTok-Jad\'s spawn point; the plain one does not', () => {
  for (const rotation of [0, 1, 7, 14]) {
    const spawns = plugin.waveSpawns(62, rotation);
    const jad = plugin.jadSpawn(rotation);
    const marker = spawns.find((spawn) => spawn.id === N.KET_ZEK_2);
    const plain = spawns.find((spawn) => spawn.id === N.KET_ZEK);
    assert.deepEqual(marker.at, jad, `rotation ${rotation}: the marker stands on Jad's point`);
    assert.notDeepEqual(plain.at, jad, `rotation ${rotation}: the plain Ket-Zek is elsewhere`);
  }
});

test('no other wave has 3126: waves 1-61 are unchanged', () => {
  for (let wave = 1; wave <= 61; wave++) {
    assert.ok(!plugin.waveMonsters(wave).includes(N.KET_ZEK_2), `wave ${wave}`);
  }
});

test('a wave with one Ket-Zek is unchanged: wave 31 is one plain Ket-Zek', () => {
  assert.deepEqual(plugin.waveMonsters(31), [N.KET_ZEK]);
});

test('the other monsters of the wave table are unchanged: wave 61 is one Ket-Zek and two Yt-MejKot', () => {
  assert.deepEqual(plugin.waveMonsters(61), [N.KET_ZEK, N.YT_MEJKOT, N.YT_MEJKOT]);
});
