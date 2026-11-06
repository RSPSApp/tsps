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
    isNpc: () => false, isPlayer: () => true, getAsPlayer: () => ({ getUsername: () => 'test' }),
    getCombat: () => ({ getCastSpell: () => null, getAutocastSpell: () => null }), hasFlag: () => false };
}
test('cross-floor ranged and magic honor the option, range and collision; melee remains blocked', t => {
  const original = Object.fromEntries(['CROSS_FLOOR_VISIBILITY_AND_COMBAT', 'CROSS_FLOOR_VISIBILITY', 'CROSS_FLOOR_COMBAT'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(PluginManager, 'emitCombatAttackDistance', data => data.distance);
  const clipping = t.mock.method(RegionManager, 'canProjectileAttackBounds', () => true);
  t.mock.method(RegionManager, 'getRegion', () => ({ isUnderRoof: () => false }));
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

test('lower-floor actor and projectile visibility follows its parent visibility option', t => {
  const { CrossFloor } = require('../dist/game/CrossFloor');
  const previous = Object.fromEntries(['CROSS_FLOOR_VISIBILITY_AND_COMBAT', 'CROSS_FLOOR_VISIBILITY', 'CROSS_FLOOR_COMBAT'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  delete process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT;
  process.env.CROSS_FLOOR_COMBAT = '0';
  process.env.CROSS_FLOOR_VISIBILITY = '1';
  const viewer = new Location(3200, 3200, 1);
  const lower = new Location(3204, 3200, 0);
  const upper = new Location(3204, 3200, 2);
  assert.equal(CrossFloor.visible(viewer, lower, 15), true);
  assert.equal(CrossFloor.visible(viewer, upper, 15), false, 'floors above the viewer stay hidden');
  assert.equal(CrossFloor.visible(viewer, new Location(3216, 3200, 0), 15), false, 'out-of-range actors stay hidden');
  assert.equal(CrossFloor.projectileVisible(viewer, lower, 15), true,
    'lower-floor projectiles follow actor visibility when combat is off');
  assert.equal(CrossFloor.projectileVisible(viewer, upper, 15), false,
    'projectiles from floors above the viewer stay hidden');
  process.env.CROSS_FLOOR_COMBAT = '1';
  process.env.CROSS_FLOOR_VISIBILITY = '0';
  assert.equal(CrossFloor.enabled(), false, 'explicitly disabling visibility stays authoritative');
  assert.equal(CrossFloor.combatEnabled(), false, 'combat cannot bypass its visibility prerequisite');
  assert.equal(CrossFloor.visible(viewer, lower, 15), false);
  assert.equal(CrossFloor.projectileVisible(viewer, lower, 15), false);
  process.env.CROSS_FLOOR_COMBAT = '0';
  assert.equal(CrossFloor.visible(viewer, lower, 15), false, 'both options off restores same-floor visibility');
  assert.equal(CrossFloor.projectileVisible(viewer, lower, 15), false,
    'both options off hides cross-floor projectiles');
  process.env.CROSS_FLOOR_VISIBILITY = '1';
  process.env.CROSS_FLOOR_COMBAT = '1';
  assert.equal(CrossFloor.enabled(), true);
  assert.equal(CrossFloor.combatEnabled(), true, 'combat is enabled when both parent and child options are on');
});

test('cross-floor combat searches reachable clear-shot tiles on the attacker floor', t => {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const previous = Object.fromEntries(["CROSS_FLOOR_VISIBILITY", "CROSS_FLOOR_COMBAT"].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.CROSS_FLOOR_VISIBILITY = "1";
  process.env.CROSS_FLOOR_COMBAT = '1';
  t.mock.method(RegionManager, 'canProjectileAttackBounds', () => true);
  let destinations;
  t.mock.method(PathFinder, 'calculateRouteToAny', (_attacker, candidates) => { destinations = candidates; return 1; });
  const attacker = actor(3200, 3200, 1);
  const target = actor(3210, 3200, 0);
  const ranged = { type: () => CombatType.RANGED, attackDistance: () => 6 };
  assert.equal(CombatRange.route(attacker, ranged, target), true);
  assert.ok(destinations.length > 0);
  assert.ok(destinations.every(tile => tile.getZ() === 1), "destinations stay on the attacker's floor");
  assert.ok(destinations.every(tile => Math.max(Math.abs(tile.getX() - 3210), Math.abs(tile.getY() - 3200)) <= 6),
    'destinations remain within the attack range');
});

test('cross-floor combat stops when no clear-shot tile is reachable instead of routing without line of sight', t => {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const previous = Object.fromEntries(["CROSS_FLOOR_VISIBILITY", "CROSS_FLOOR_COMBAT"].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.CROSS_FLOOR_VISIBILITY = "1";
  process.env.CROSS_FLOOR_COMBAT = '1';
  let candidateSearches = 0;
  let genericApproaches = 0;
  t.mock.method(RegionManager, 'canProjectileAttackBounds', () => true);
  t.mock.method(PathFinder, 'calculateRouteToAny', () => { candidateSearches++; return 0; });
  t.mock.method(PathFinder, 'calculateEntityRoute', () => { genericApproaches++; return 1; });
  const attacker = actor(3200, 3200, 1);
  const target = actor(3210, 3200, 0);
  const ranged = { type: () => CombatType.RANGED, attackDistance: () => 6 };
  assert.equal(CombatRange.route(attacker, ranged, target), false);
  assert.ok(candidateSearches > 1, 'searches beyond the nearest blocked firing positions');
  assert.equal(genericApproaches, 0, 'does not send the player to an endpoint with no guaranteed shot');
});

test('cross-floor combat falls back when a zero-step range route cannot clear projectile clipping', t => {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const previous = Object.fromEntries(['CROSS_FLOOR_VISIBILITY_AND_COMBAT', 'CROSS_FLOOR_VISIBILITY', 'CROSS_FLOOR_COMBAT'].map(key => [key, process.env[key]]));
  const previousFinder = PathFinder.rsmodRouteFinding;
  t.after(() => {
    PathFinder.rsmodRouteFinding = previousFinder;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  t.mock.method(PluginManager, 'emitCombatAttackDistance', data => data.distance);
  process.env.CROSS_FLOOR_VISIBILITY = '1';
  process.env.CROSS_FLOOR_COMBAT = '1';

  const blocker = RegionManager.PROJECTILE_TILE_BLOCKED | RegionManager.BLOCKED_TILE;
  t.mock.method(RegionManager, 'getClipping', (x, y, z) => z === 1 && x === 3207 && y === 3200 ? blocker : 0);
  PathFinder.rsmodRouteFinding = new RsmodRouteFinding(RegionManager.getClipping.bind(RegionManager));

  const queue = {
    checkpoints: [],
    foundRoute: false,
    reset() { this.checkpoints.length = 0; this.foundRoute = false; return this; },
    setRoute(found) { this.foundRoute = found; },
    setPathX() { return this; },
    setPathY() { return this; },
    addCheckpoint(position) { this.checkpoints.push(position); },
    syncDestinationFlagToRoute() {},
    hasRoute() { return this.foundRoute; },
  };
  let attackerLocation = new Location(3204, 3200, 1);
  const attacker = {
    ...actor(3204, 3200, 1),
    getLocation: () => attackerLocation,
    getMovementQueue: () => queue,
  };
  const target = actor(3210, 3200, 0);
  const ranged = { type: () => CombatType.RANGED, attackDistance: () => 6 };

  const wideRouteSteps = PathFinder.calculateEntityRoute(attacker, target, 6);
  assert.equal(wideRouteSteps, 0, 'the wide move-near route succeeds without adding checkpoints');
  assert.equal(queue.hasRoute(), true);
  assert.equal(CombatRange.canReach(attacker, ranged, target), false, 'the level-1 blocker still blocks the shot');

  assert.equal(CombatRange.route(attacker, ranged, target), true);
  assert.ok(queue.checkpoints.length > 0, 'the ordinary approach queues a route around the blocker');
  attackerLocation = queue.checkpoints.at(-1);
  assert.equal(CombatRange.canReach(attacker, ranged, target), true, 'the fallback endpoint has a clear cross-floor shot');
});

test('projectile travel uses horizontal Chebyshev distance on every floor', () => {
  const { Projectile } = require('../dist/game/model/Projectile');
  const { Location } = require('../dist/game/model/Location');
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3201, 3200, 0)), 50);
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3200, 3200, 1)), 40);
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3201, 3200, 1)), 50);
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3202, 3201, 1)), 60);
  assert.equal(Projectile.arrivalCycles(new Location(3200, 3200, 0), new Location(3200, 3200, 3)), 40);
});

test('cross-floor ranged and magic hitsplats wait for the slower projectile arrival', t => {
  const { CrossFloor } = require('../dist/game/CrossFloor');
  const { RangedCombatMethod } = require('../dist/game/content/combat/method/impl/RangedCombatMethod');
  const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
  const { WeaponProfiles } = require('../dist/game/content/combat/WeaponProfile');
  const previous = Object.fromEntries(["CROSS_FLOOR_VISIBILITY", "CROSS_FLOOR_COMBAT"].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.CROSS_FLOOR_VISIBILITY = "1";
  process.env.CROSS_FLOOR_COMBAT = '1';
  t.mock.method(WeaponProfiles, 'hitDelays', () => [1]);
  t.mock.method(WeaponProfiles, 'ranged', () => ({ projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5 }] }));
  const archer = actor(3200, 3200, 1), target = actor(3200, 3200, 0);
  assert.deepEqual(RangedCombatMethod.playerHitDelays(archer, target, 8), [3]);
  assert.equal(MagicCombatMethod.hitDelay(archer, target), 2);
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

test('world plugin settings override legacy flags and combat requires visibility', t => {
  const { CrossFloor } = require('../dist/game/CrossFloor');
  const previous = Object.fromEntries(['CROSS_FLOOR_VISIBILITY_AND_COMBAT', 'CROSS_FLOOR_VISIBILITY', 'CROSS_FLOOR_COMBAT'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const flags = {};
  t.mock.method(PluginManager, 'getPluginConfig', (key) => flags[key]);
  for (const key of Object.keys(previous)) delete process.env[key];
  assert.equal(CrossFloor.enabled(), false);
  assert.equal(CrossFloor.combatEnabled(), false);
  process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT = '1';
  assert.equal(CrossFloor.enabled(), true, 'existing combined flags still work');
  assert.equal(CrossFloor.combatEnabled(), true);
  flags['CrossFloor:visibility'] = false;
  flags['CrossFloor:combat'] = true;
  assert.equal(CrossFloor.enabled(), false, 'explicit false wins over a legacy enable');
  assert.equal(CrossFloor.combatEnabled(), false, 'combat cannot bypass the visibility parent');
  flags['CrossFloor:visibility'] = true;
  flags['CrossFloor:combat'] = false;
  assert.equal(CrossFloor.enabled(), true);
  assert.equal(CrossFloor.combatEnabled(), false, 'visibility alone need not enable combat');
  flags['CrossFloor:combat'] = true;
  process.env.CROSS_FLOOR_VISIBILITY = '0';
  process.env.CROSS_FLOOR_COMBAT = '0';
  assert.equal(CrossFloor.combatEnabled(), true, 'world settings win over explicit legacy disables');
  flags['CrossFloor:visibility'] = 'true';
  assert.equal(CrossFloor.enabled(), false, 'non-boolean settings fall back to the existing defaults/flags');
  delete flags['CrossFloor:visibility'];
  delete flags['CrossFloor:combat'];
  process.env.CROSS_FLOOR_COMBAT = '1';
  assert.equal(CrossFloor.combatEnabled(), false, 'old flags also respect the visibility dependency');
});
