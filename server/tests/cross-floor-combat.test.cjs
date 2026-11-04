const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CombatRange } = require('../dist/game/content/combat/CombatRange');
const { CombatType } = require('../dist/game/content/combat/CombatType');
const { Location } = require('../dist/game/model/Location');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
function actor(x, y, z) {
  const location = new Location(x, y, z);
  return { getLocation: () => location, getPrivateArea: () => null, getSize: () => 1,
    isNpc: () => false, isPlayer: () => true, getAsPlayer: () => ({}),
    getCombat: () => ({ getCastSpell: () => null, getAutocastSpell: () => null }), hasFlag: () => false };
}
test('cross-floor ranged and magic honor the option, range and collision; melee remains blocked', t => {
  const original = Object.fromEntries(['CROSS_FLOOR_VISIBILITY_AND_COMBAT', 'CROSS_FLOOR_VISIBILITY', 'CROSS_FLOOR_COMBAT'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(PluginManager, 'emitCombatAttackDistance', data => data.distance);
  const clipping = t.mock.method(RegionManager, 'canProjectileAttackBounds', () => true);
  const archer = actor(3200, 3200, 1), target = actor(3204, 3200, 0);
  const method = type => ({ type: () => type, attackDistance: () => 6 });
  delete process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT;
  process.env.CROSS_FLOOR_VISIBILITY = '1';
  process.env.CROSS_FLOOR_COMBAT = '0';
  assert.equal(require('../dist/game/CrossFloor').CrossFloor.visible(archer.getLocation(), target.getLocation(), 15), true);
  assert.equal(CombatRange.canReach(archer, method(CombatType.RANGED), target), false, 'combat can be disabled while visibility stays on');
  process.env.CROSS_FLOOR_COMBAT = '1';
  assert.equal(CombatRange.canReach(archer, method(CombatType.RANGED), target), true);
  assert.equal(CombatRange.canReach(archer, method(CombatType.MAGIC), target), true);
  assert.equal(CombatRange.canReach(archer, method(CombatType.MELEE), target), false);
  assert.equal(CombatRange.canReach(archer, method(CombatType.RANGED), actor(3201, 3200, 4)), false);
  assert.equal(CombatRange.canReach(archer, method(CombatType.RANGED), actor(3208, 3200, 0)), false);
  clipping.mock.mockImplementation(() => false);
  assert.equal(CombatRange.canReach(archer, method(CombatType.MAGIC), target), false);
});

test('cross-floor combat routes toward a same-floor attack-range destination', t => {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const previous = process.env.CROSS_FLOOR_COMBAT;
  t.after(() => { if (previous === undefined) delete process.env.CROSS_FLOOR_COMBAT; else process.env.CROSS_FLOOR_COMBAT = previous; });
  process.env.CROSS_FLOOR_COMBAT = '1';
  const calls = [];
  t.mock.method(PathFinder, 'calculateEntityRoute', (...args) => calls.push(args));
  const attacker = actor(3200, 3200, 1);
  attacker.getMovementQueue = () => ({ hasRoute: () => true });
  const target = actor(3210, 3200, 0);
  const ranged = { type: () => CombatType.RANGED, attackDistance: () => 6 };
  assert.equal(CombatRange.route(attacker, ranged, target), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 6, 'the route goal covers the ranged attack distance');
});

test('cross-floor combat falls back to an ordinary approach when its range route is blocked', t => {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const previous = process.env.CROSS_FLOOR_COMBAT;
  t.after(() => { if (previous === undefined) delete process.env.CROSS_FLOOR_COMBAT; else process.env.CROSS_FLOOR_COMBAT = previous; });
  process.env.CROSS_FLOOR_COMBAT = '1';
  let hasRoute = false;
  const calls = [];
  t.mock.method(PathFinder, 'calculateEntityRoute', (...args) => { calls.push(args); hasRoute = calls.length === 2; });
  const attacker = actor(3200, 3200, 1);
  attacker.getMovementQueue = () => ({ hasRoute: () => hasRoute });
  const target = actor(3210, 3200, 0);
  const ranged = { type: () => CombatType.RANGED, attackDistance: () => 6 };
  assert.equal(CombatRange.route(attacker, ranged, target), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2], 6);
  assert.equal(calls[1].length, 2, 'the fallback uses the ordinary same-plane approach route');
});

test('projectile travel distance includes floor height and leaves same-floor timing unchanged', () => {
  const { Projectile } = require('../dist/game/model/Projectile');
  const { Location } = require('../dist/game/model/Location');
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3201, 3200, 0)), 50);
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3200, 3200, 1)), 120);
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3201, 3200, 1)), 130);
});

test('cross-floor ranged and magic hitsplats wait for the slower projectile arrival', t => {
  const { CrossFloor } = require('../dist/game/CrossFloor');
  const { RangedCombatMethod } = require('../dist/game/content/combat/method/impl/RangedCombatMethod');
  const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
  const { WeaponProfiles } = require('../dist/game/content/combat/WeaponProfile');
  const previous = process.env.CROSS_FLOOR_COMBAT;
  t.after(() => { if (previous === undefined) delete process.env.CROSS_FLOOR_COMBAT; else process.env.CROSS_FLOOR_COMBAT = previous; });
  process.env.CROSS_FLOOR_COMBAT = '1';
  t.mock.method(WeaponProfiles, 'hitDelays', () => [1]);
  t.mock.method(WeaponProfiles, 'ranged', () => ({ projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5 }] }));
  const archer = actor(3200, 3200, 1), target = actor(3200, 3200, 0);
  assert.deepEqual(RangedCombatMethod.playerHitDelays(archer, target, 8), [3]);
  assert.equal(MagicCombatMethod.hitDelay(archer, target), 5);
  assert.deepEqual(RangedCombatMethod.playerHitDelays(archer, actor(3200, 3200, 1), 0), [1], 'same-floor hits keep their native timing');
});

test('nearby-player lookup includes other floors only when enabled and keeps private areas separate', t => {
  const { World } = require('../dist/game/World');
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  const previous = process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT;
  t.after(() => { if (previous === undefined) delete process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT; else process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT = previous; });
  const viewer = { index: 1, location: new Location(3200, 3200, 1), area: null, getIndex() { return this.index; }, getViewDistance: () => 15 };
  const lower = { index: 2, location: new Location(3201, 3200, 0), area: null, getIndex() { return this.index; } };
  const privatePlayer = { index: 3, location: new Location(3201, 3201, 0), area: {}, getIndex() { return this.index; } };
  const players = new Map([[1, viewer], [2, lower], [3, privatePlayer]]);
  t.mock.method(World, 'getPlayers', () => players);
  t.mock.method(BoatManager, 'rootLocation', player => player.location);
  t.mock.method(BoatManager, 'syncArea', player => player.area);
  const oldBuckets = World.playerUpdateBuckets;
  t.after(() => { World.playerUpdateBuckets = oldBuckets; });
  World.playerUpdateBuckets = new Map([['1:400:400', [viewer]], ['0:400:400', [lower, privatePlayer]]]);
  delete process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT;
  assert.deepEqual(World.getBucketNearbyPlayersForUpdate(viewer), [viewer]);
  process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT = '1';
  assert.deepEqual(World.getBucketNearbyPlayersForUpdate(viewer), [viewer, lower]);
});
