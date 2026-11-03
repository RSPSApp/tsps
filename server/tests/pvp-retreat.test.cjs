// Run after `yarn build`: node --test tests/pvp-retreat.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Location } = require('../dist/game/model/Location');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { TeleportHandler } = require('../dist/game/model/teleportation/TeleportHandler');
const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

// The bots ask the Food plugin what is food, and it reads item names from the cache.
before(async () => {
  await CachePipeline.initialize();
  require('../plugins/items/Food.plugin').register({
    core: PluginManager.getCoreApi(), persistAttribute() {}, onPlayerLogin() {}, onItemAction() {},
  });
});
const filename = path.resolve(__dirname, '../plugins/bots/behaviours/nodes/pvp/PvpDefensiveActionNode.PlayerBots.js');
const localRequire = createRequire(filename);

test('PvP retreat starts when actual food runs out at any HP, runs first, then respects depth/teleblock/freeze', () => {
  const RETREAT_RUN_GRACE_MS = 5000;
  let routes = [], teleports = [], loads = 0, blocked = false, frozen = false;
  let allowed = true, hp = 10, teleporting = false, retaliate = true, globalPvp = false;
  let nowMs = 1000;
  let inventoryItems = [{ getId: () => ItemIdentifiers.SHARK }];
  let location = new Location(3100, 3600, 0), target = {}, attacker = { getLocation: () => new Location(3100, 3601, 0) };
  const originalCheck = TeleportHandler.checkReqs;
  const originalTeleport = TeleportHandler.teleport;
  const originalIsIn = Wilderness.isIn;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: (name) => {
      if (name.endsWith('/WorldDefinition')) return { hasGlobalWorldTag: () => globalPvp };
      if (name.endsWith('/Navigation.PlayerBots')) return {
        queueRouteAndFlagAppearance: (_, x, y) => routes.push({ x, y }),
        clearMovementRequest: () => {},
        peekMovementRequest: () => null,
        randomInRange: () => 2,
      };
      if (name.endsWith('/PvpLoadoutPolicy.PlayerBots')) return {
        applyGeneratedPvpLoadout: () => { loads++; hp = 99; return true; },
      };
      return localRequire(name);
    },
  }, { filename });
  const combat = {
    getTarget: () => target, reset: () => { target = null; },
    getAttacker: () => attacker, setUnderAttack: (value) => { attacker = value; },
    clearDamageMap: () => {},
    getTeleblockTimer: () => ({ finished: () => !blocked }),
  };
  const player = {
    getHitpoints: () => hp, getSkillManager: () => ({ getMaxLevel: () => 99 }),
    getInventory: () => ({ getItems: () => inventoryItems }),
    autoRetaliateReturn: () => retaliate, setAutoRetaliate: (value) => { retaliate = value; },
    getCombat: () => combat, getLocation: () => location,
    get isTeleporting() { return teleporting; },
    isTeleportingReturn: Player.prototype.isTeleportingReturn, isDyingReturn: () => false,
    getForceMovement: () => null, setFollowing: () => {}, setCombatFollowing: () => {},
    getTimers: () => ({ has: () => frozen }),
    getMovementQueue: () => ({ reset: () => {}, isMovementBlocked: () => false }),
    setRunning: () => {}, getRunEnergy: () => 100,
  };
  let profile = 'elite';
  const state = { home: { x: 3100, y: 3550, z: 0 }, pvp: { escapeThreshold: 0.2 } };
  const node = new module.exports.PvpDefensiveActionNode({
    setPhase: (state, phase) => { state.pvp.phase = phase; },
    getProfile: () => ({ id: profile, foodCharges: 10 }), stopPvp: () => {},
    api: { getCombatFactory: () => ({ canAttackPermission: () => undefined, getMethod: () => null }) },
  });
  const tick = () => node.tick({ player, state, nowMs, target: null });
  try {
    Wilderness.isIn = () => true;
    TeleportHandler.checkReqs = () => allowed;
    TeleportHandler.teleport = (_, destination) => { teleports.push(destination); teleporting = true; };
    assert.equal(tick().handled, false, 'inventory food prevents retreat with an uninitialized counter');
    state.virtualFoodChargesRemaining = 3;
    assert.equal(tick().handled, false, 'low HP alone never triggers retreat with food remaining');
    assert.equal(retaliate, true);

    // A stale virtual counter must not hide real food, even at low HP.
    state.virtualFoodChargesRemaining = 0;
    assert.equal(tick().handled, false, 'actual food prevents retreat despite exhausted virtual charges');
    assert.equal(retaliate, true);

    // Inventory is empty but the virtual counter still reports meals: run at high HP.
    inventoryItems = [null, { getId: () => ItemIdentifiers.COINS }, { getId: () => ItemIdentifiers.SHARK_2 }];
    state.virtualFoodChargesRemaining = 10;
    hp = 80;
    assert.equal(tick().handled, true, 'no actual food at healthy HP starts a retreat');
    assert.equal(retaliate, false);
    assert.equal(teleports.length, 0, 'retreat runs before teleporting');
    nowMs += 1000;
    tick();
    assert.equal(teleports.length, 0, 'still running inside the grace window');
    nowMs += RETREAT_RUN_GRACE_MS;
    tick();
    assert.equal(teleports.length, 1, 'teleports once the run grace elapses');
    assert.equal(loads, 0);
    const { getEnabledWildernessHotspots } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
    assert.ok(getEnabledWildernessHotspots().some(({ anchor }) =>
      teleports[0].equals(new Location(anchor.x, anchor.y, anchor.z))), 'destination is a known Wilderness location');
    tick();
    assert.equal(teleports.length, 1, 'do not restart an active teleport');
    location = teleports[0]; teleporting = false;
    tick();
    assert.equal(loads, 1);
    assert.equal(state.pvp.retreat, null);
    assert.equal(state.virtualFoodChargesRemaining, null);
    assert.equal(retaliate, true);
    assert.equal(hp, 99);

    // Deep Wilderness cannot teleport even once the grace has elapsed; it runs south.
    state.virtualFoodChargesRemaining = 0; hp = 10;
    attacker = null; location = new Location(3100, 3680, 0);
    tick();
    assert.equal(teleports.length, 1, 'level 21 cannot teleport even when combat ends');
    assert.deepEqual(routes.at(-1), { x: 3100, y: 3668 }, 'deep retreat heads south');
    location = new Location(3100, 3672, 0);
    tick();
    assert.equal(teleports.length, 1, 'level 20 also runs below 20');

    // In teleport range now: teleblock/freeze/veto still gate the escape.
    nowMs += RETREAT_RUN_GRACE_MS;
    location = new Location(3100, 3671, 0); blocked = true;
    attacker = { getLocation: () => new Location(3100, 3672, 0) };
    tick();
    assert.equal(teleports.length, 1, 'teleblock prevents teleport below level 20');
    const routeCount = routes.length; frozen = true;
    tick();
    assert.equal(routes.length, routeCount, 'freeze prevents retreat movement');
    blocked = false; allowed = false;
    tick();
    assert.equal(teleports.length, 1, 'normal teleport veto is respected');
    allowed = true;
    tick();
    assert.equal(teleports.length, 2, 'freeze alone does not prevent teleport below level 20');

    teleporting = false; state.pvp.retreat = null; frozen = false; retaliate = true;
    profile = 'novice'; location = new Location(3100, 3600, 0);
    state.virtualFoodChargesRemaining = 0; hp = 10;
    tick();
    assert.equal(teleports.length, 2, 'novice runs first too');
    nowMs += RETREAT_RUN_GRACE_MS;
    tick();
    assert.equal(teleports.length, 3, 'novice also teleports while under attack');
    location = teleports.at(-1); teleporting = false;
    tick();
    assert.equal(loads, 2);

    state.virtualFoodChargesRemaining = 0; hp = 10;
    globalPvp = true; location = new Location(3100, 3900, 0);
    attacker = { getLocation: () => new Location(3100, 3901, 0) };
    blocked = true;
    tick();
    assert.equal(teleports.length, 3, 'global PvP still respects teleblock');
    blocked = false;
    nowMs += RETREAT_RUN_GRACE_MS;
    tick();
    assert.equal(teleports.length, 4, 'global PvP ignores depth even above level 20');
    teleporting = false; state.pvp.retreat = null;
    location = new Location(3200, 3200, 0);
    state.virtualFoodChargesRemaining = 0; hp = 10;
    tick();
    nowMs += RETREAT_RUN_GRACE_MS;
    tick();
    assert.equal(teleports.length, 5, 'global PvP permits escape at non-Wilderness coordinates');
    teleporting = false; state.pvp.retreat = null; globalPvp = false;
    location = new Location(3100, 3525, 0);
    state.virtualFoodChargesRemaining = 0; hp = 10;
    tick();
    nowMs += RETREAT_RUN_GRACE_MS;
    tick();
    assert.equal(teleports.length, 6, 'level 1 can also teleport');

    teleporting = false; state.pvp.retreat = null; hp = 10;
    state.virtualFoodChargesRemaining = 0;
    blocked = true; attacker = null; retaliate = true; location = new Location(3100, 3600, 0);
    tick();
    assert.deepEqual(routes.at(-1), { x: state.home.x, y: state.home.y }, 'walk home after combat while teleblocked');
    location = new Location(state.home.x, state.home.y, 0);
    tick();
    assert.equal(loads, 3, 'walking home also replenishes the bot');
    assert.equal(state.pvp.retreat, null);
    assert.equal(retaliate, true);
  } finally {
    TeleportHandler.checkReqs = originalCheck;
    TeleportHandler.teleport = originalTeleport;
    Wilderness.isIn = originalIsIn;
  }
});

test('retreat blocks southbound ditch crossings, including queued crossings, but allows returning north', () => {
  const { maybeCrossDitch } = require('../plugins/bots/brain/DitchCrossing.PlayerBots');
  let location = new Location(3100, 3525, 0), pending, crossings = 0;
  const player = {
    getLocation: () => location, getUsername: () => 'retreat-test', setPositionToFace: () => {},
    getForceMovement: () => null,
    getMovementQueue: () => ({ walkToObject: (_, action) => { pending = action; }, reset: () => {} }),
  };
  const ditch = { getLocation: () => new Location(3100, 3521, 0), getId: () => 23271 };
  const world = {
    ditch: { objectId: 23271, attemptCooldownMs: 0 },
    objectSearch: { findObjectOnRoute: () => ditch },
    emitObjectInteraction: () => { crossings++; return true; },
  };
  const state = { pvp: { retreat: {} } };
  const south = { x: 3100, y: 3518, z: 0 };
  assert.equal(maybeCrossDitch({ player, state, world, request: south }), false);
  assert.equal(pending, undefined);
  state.pvp.retreat = null;
  assert.equal(maybeCrossDitch({ player, state, world, request: south }), true);
  state.pvp.retreat = {};
  pending.execute();
  assert.equal(crossings, 0, 'queued southbound crossing is cancelled when retreat begins');
  location = new Location(3100, 3518, 0);
  assert.equal(maybeCrossDitch({ player, state, world, request: { x: 3100, y: 3550, z: 0 } }), true);
  pending.execute();
  assert.equal(crossings, 1, 'returning to the Wilderness is allowed');
});

test('PvP worlds add 15 to the shared Wilderness level for players and bots', () => {
  let globalPvp = false;
  const coreFile = path.resolve(__dirname, '../dist/game/content/wilderness/Wilderness.js');
  const core = { exports: {} }, coreRequire = createRequire(coreFile);
  vm.runInNewContext(fs.readFileSync(coreFile, 'utf8'), {
    exports: core.exports, require(name) {
      if (name.endsWith('/WorldDefinition')) return { hasGlobalWorldTag: () => true };
      return coreRequire(name);
    },
  }, { filename: coreFile });
  const levelAt = core.exports.Wilderness.levelAt;
  const file = path.resolve(__dirname, '../plugins/areas/Wilderness.plugin.js');
  const local = createRequire(file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, require(name) {
      if (name.endsWith('/WorldDefinition')) return {
        hasGlobalWorldTag: () => globalPvp, WORLD_ZONE_BOUNDARIES: { safe: [] },
      };
      if (name.endsWith('/wilderness/Wilderness')) return { Wilderness: {
        levelAt, isPvpArea: () => true, isInLocation: () => true,
        isInSafeBuilding: () => false, isMulti: () => false,
      } };
      if (name.endsWith('/ferox/Bounds.FeroxEnclave')) return { isSafeLocation: () => false };
      return local(name);
    },
  }, { filename: file });
  const { wildernessAttackRange, canAttackByWildernessLevel } = module.exports;
  const player = (combat, y) => ({
    getLocation: () => new Location(3100, y, 0), getWildernessLevel: () => 0,
    getSkillManager: () => ({ getCombatLevel: () => combat }),
  });
  assert.equal(levelAt(3100, 3520), 1);
  assert.equal(levelAt(3100, 3528), 2);
  assert.equal(levelAt(3100, 9920), 1);
  assert.equal(levelAt(3200, 3200), 0);
  assert.equal(wildernessAttackRange(player(80, 3520), player(81, 3528)), 1);
  assert.equal(canAttackByWildernessLevel(player(80, 3520), player(82, 3528)), false);
  // #2146: a deeper attacker does not widen the bracket. In level 5 vs level 1 the range
  // is 1, so a 5-level gap is out of range in both directions.
  assert.equal(wildernessAttackRange(player(105, 3552), player(100, 3520)), 1);
  assert.equal(canAttackByWildernessLevel(player(105, 3552), player(100, 3520)), false);
  assert.equal(canAttackByWildernessLevel(player(100, 3520), player(105, 3552)), false);
  globalPvp = true;
  for (const [y, range] of [[3200, 15], [3520, 16], [3528, 17], [9920, 16]]) {
    assert.equal(wildernessAttackRange(player(80, y), player(80 + range, y)), range);
    for (const sign of [-1, 1]) {
      assert.equal(canAttackByWildernessLevel(player(80, y), player(80 + sign * range, y)), true);
      assert.equal(canAttackByWildernessLevel(player(80, y), player(80 + sign * (range + 1), y)), false);
    }
  }
  assert.equal(wildernessAttackRange(player(80, 3520), player(97, 3528)), 16);
  assert.equal(canAttackByWildernessLevel(player(80, 3520), player(97, 3528)), false);
  assert.equal(wildernessAttackRange(player(80, 3200), player(96, 3528)), 15);
  // Both levels cap the range, so the shallower side sets it in either direction.
  assert.equal(wildernessAttackRange(player(80, 3528), player(80, 3200)), 15);
  assert.equal(wildernessAttackRange(player(80, 3200), player(80, 3528)), 15);
  assert.equal(canAttackByWildernessLevel(player(80, 3528), player(97, 3200)), false);
  assert.equal(canAttackByWildernessLevel(player(80, 3200), player(97, 3528)), false);
});

test('a reachable unlevelled PvP border does not remove the levelled player\'s combat cap', () => {
  const { AreaManager } = require('../dist/game/model/areas/AreaManager');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { Skill } = require('../dist/game/model/Skill');
  const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { hasGlobalWorldTag } = require('../dist/game/definition/WorldDefinition');
  const wild = require('../plugins/areas/Wilderness.plugin');
  const api = PluginManager.createApi('Wilderness');
  const startup = [];
  const areaCount = AreaManager.areas.length;
  wild.register({ ...api, onServerStartup: (handler) => startup.push(handler) });
  startup.forEach((handler) => handler());
  RegionManager.init();
  const player = (name, index, x, level) => {
    const session = new PlayerSession({ readyState: 1, send() {} });
    const actor = new Player(session, new Location(x, 3595, 0));
    session.setPlayer(actor);
    actor.setUsername(name).setIndex(index);
    actor.setRegistered(true);
    for (const skill of [Skill.ATTACK, Skill.DEFENCE, Skill.STRENGTH, Skill.HITPOINTS]) {
      actor.getSkillManager().setCurrentLevel(skill, level, false).setMaxLevels(skill, level, false);
    }
    actor.setHitpoints(level);
    actor.setArea(AreaManager.get(actor.getLocation()));
    return actor;
  };
  try {
    // world.json's PvP ground extends to x=3392; the cache's levelled strip stops at 3391.
    // These are adjacent, walkable tiles, not a fixture-only location across a wall or water.
    const high = player('BorderHigh', 880, 3391, 80);
    const low = player('BorderLow', 881, 3392, 10);
    assert.equal(hasGlobalWorldTag('pvp'), false);
    assert.equal(RegionManager.getRegion(3392, 3595).getClip(3392, 3595, 0), 0);
    assert.equal(RegionManager.canMove(3391, 3595, 3392, 3595, 0, 1, 1, null), true);
    assert.equal(Wilderness.isInLocation(high.getLocation()), true);
    assert.equal(Wilderness.isInLocation(low.getLocation()), true);
    assert.deepEqual([Wilderness.levelAt(3391, 3595), Wilderness.levelAt(3392, 3595)], [10, 0]);
    assert.ok(CombatFactory.validTarget(high, low));
    for (const [attacker, target] of [[high, low], [low, high]]) {
      assert.equal(wild.wildernessAttackRange(attacker, target), 10);
      assert.equal(CombatFactory.canAttackPermission(attacker, target, false, CombatFactory.MELEE_COMBAT),
        CanAttackResponse.CANT_ATTACK_IN_AREA);
      attacker.getCombat().attack(target);
      assert.equal(attacker.getCombat().performNewAttack(true), false);
      assert.equal(target.getCombat().getHitQueue().hasPendingWork(), false);
    }
    // Zero keeps its existing "no levelled constraint" meaning when neither side has a level.
    const unlevelled = player('BorderOther', 882, 3392, 80);
    assert.equal(wild.wildernessAttackRange(unlevelled, low), 0);
    assert.equal(wild.canAttackByWildernessLevel(unlevelled, low), true);
  } finally {
    AreaManager.areas.splice(areaCount);
  }
});
