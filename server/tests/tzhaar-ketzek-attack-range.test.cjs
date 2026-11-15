// Run after `yarn build`: node --test tests/tzhaar-ketzek-attack-range.test.cjs
// The Ket-Zek and Tok-Xil reach 15 tiles (Wiki: Ket-Zek "magic attack is fired from a 15 tile range"; Tok-Xil "a range of 15
// tiles"). Retail (rsprox 551 and 83, rev 227.1; raw sha256 536110ed...bb2f and 9dd19c51...e5e9; footprint distance, reviewer
// measured): no Ket-Zek or Tok-Xil attacked without walking from farther than 15 (Ket-Zek 14 at most, 3126 in 551 run 2 line
// 201451 [9088]; Tok-Xil 15 at most, 551 lines 9155 and 18831); walkers stopped at 13 to 15. Our attackDistance() was 8.
// Yt-MejKot and Tz-Kih keep their melee reach (1) and Tz-Kek has no hybrid provider: none has a stated or measured range.
// TzTok-Jad is 15 already.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const core = PluginManager.getCoreApi();
const N = core.NpcIdentifiers;

/** Loads the Fight Caves monsters module with a recording api: the providers it registers, by id. */
function providers() {
  const registered = new Map();
  const api = new Proxy({ core, registerNpcCombatMethodProvider(ids, Class) {
    for (const id of [].concat(ids)) registered.set(id, Class);
  } }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/minigames/tzhaar/Monsters.TzhaarFightCaves')(api);
  return registered;
}

/** An NPC attacker for CombatRange.attackDistance: not a player, so no combat state is read. */
const npc = { isPlayer: () => false, isNpc: () => true };
const target = { isPlayer: () => true, isNpc: () => false };

let registered;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  registered = providers();
});

function reach(id) {
  const Class = registered.get(id);
  assert.ok(Class, `a combat method is registered for ${id}`);
  return core.CombatRange.attackDistance(npc, new Class(), target);
}

test('the Ket-Zek reaches 15 tiles (both ids: the plain and the marker)', () => {
  assert.equal(reach(N.KET_ZEK), 15);
  assert.equal(reach(N.KET_ZEK_2), 15);
});

test('the Tok-Xil reaches 15 tiles', () => {
  assert.equal(reach(N.TOK_XIL_4), 15);
  assert.equal(reach(N.TOK_XIL_5), 15);
});

test('TzTok-Jad is 15 already, unchanged', () => {
  assert.equal(reach(N.TZTOK_JAD), 15);
});

test('Yt-MejKot and Tz-Kih keep their melee reach (1); Tz-Kek has no provider here: no stated or measured range, not changed', () => {
  for (const id of [N.YT_MEJKOT, N.TZ_KIH_3]) {
    const Class = registered.get(id);
    assert.ok(Class, `a combat method is registered for ${id}`);
    assert.equal(new Class().attackDistance(npc), 1, `id ${id}`);
  }
  assert.ok(!registered.has(N.TZ_KEK_3), 'Tz-Kek is not given a hybrid provider');
});

test('reach by footprint: a Ket-Zek 13 tiles away is in reach, 16 is not', () => {
  const size = 5;
  const origin = new core.Location(2400, 5100, 0);
  const near = new core.Location(2400 + 4 + 13, 5100 + 2, 0);
  const far = new core.Location(2400 + 4 + 16, 5100 + 2, 0);
  const distance = (point) => core.CombatRange.footprintDistance(origin, size, point);
  assert.equal(distance(near), 13);
  assert.equal(distance(far), 16);
  assert.ok(distance(near) <= reach(N.KET_ZEK));
  assert.ok(distance(far) > reach(N.KET_ZEK));
});
