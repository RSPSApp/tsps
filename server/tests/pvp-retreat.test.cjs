// Run after `yarn build`: node --test tests/pvp-retreat.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
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
const filename = path.resolve(__dirname, '../plugins/bots/behaviours/nodes/pvp/PvpDefensiveActionNode.js');
const localRequire = createRequire(filename);

test('PvP retreat respects depth, teleblock, freezes and replenishes only after arrival', () => {
  let routes = [], teleports = [], loads = 0, blocked = false, frozen = false;
  let allowed = true, hp = 10, teleporting = false, retaliate = true, globalPvp = false;
  let location = new Location(3100, 3600, 0), target = {}, attacker = { getLocation: () => new Location(3100, 3601, 0) };
  const originalCheck = TeleportHandler.checkReqs;
  const originalTeleport = TeleportHandler.teleport;
  const originalIsIn = Wilderness.isIn;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: (name) => {
      if (name.endsWith('/WorldDefinition')) return { hasGlobalWorldTag: () => globalPvp };
      if (name.endsWith('/BotNavigation')) return {
        queueRouteAndFlagAppearance: (_, x, y) => routes.push({ x, y }),
        clearMovementRequest: () => {},
        peekMovementRequest: () => null,
        randomInRange: () => 2,
      };
      if (name.endsWith('/PvpLoadoutPolicy')) return {
        applyGeneratedPvpLoadout: () => { loads++; hp = 99; return true; },
      };
      return localRequire(name);
    },
  }, { filename });
  const combat = {
    getTarget: () => target, reset: () => { target = null; },
    getAttacker: () => attacker, setUnderAttack: (value) => { attacker = value; },
    getTeleblockTimer: () => ({ finished: () => !blocked }),
  };
  const player = {
    getHitpoints: () => hp, getSkillManager: () => ({ getMaxLevel: () => 99 }),
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
  const tick = () => node.tick({ player, state, nowMs: 1000, target: null });
  try {
    Wilderness.isIn = () => true;
    TeleportHandler.checkReqs = () => allowed;
    TeleportHandler.teleport = (_, destination) => { teleports.push(destination); teleporting = true; };
    assert.equal(tick().handled, false, 'uninitialized food counter uses the full profile supply');
    state.virtualFoodChargesRemaining = 3;
    assert.equal(tick().handled, false, 'low HP alone never triggers retreat with food remaining');
    assert.equal(retaliate, true);
    state.virtualFoodChargesRemaining = 2;
    tick();
    assert.equal(teleports.length, 1, 'two charges triggers escape');
    assert.equal(retaliate, false);
    assert.equal(loads, 0);
    const { getEnabledWildernessHotspots } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry');
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

    state.virtualFoodChargesRemaining = 1;
    attacker = null; location = new Location(3100, 3680, 0);
    tick();
    assert.equal(teleports.length, 1, 'level 21 cannot teleport even when combat ends');
    assert.deepEqual(routes.at(-1), { x: 3100, y: 3668 }, 'deep retreat heads south');
    location = new Location(3100, 3672, 0);
    tick();
    assert.equal(teleports.length, 1, 'level 20 also runs below 20');
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
    tick();
    assert.equal(teleports.length, 3, 'novice also teleports while under attack');
    location = teleports.at(-1); teleporting = false;
    tick();
    assert.equal(loads, 2);

    state.virtualFoodChargesRemaining = 0;
    globalPvp = true; location = new Location(3100, 3900, 0);
    attacker = { getLocation: () => new Location(3100, 3901, 0) };
    blocked = true;
    tick();
    assert.equal(teleports.length, 3, 'global PvP still respects teleblock');
    blocked = false;
    tick();
    assert.equal(teleports.length, 4, 'global PvP ignores depth even above level 20');
    teleporting = false; state.pvp.retreat = null;
    location = new Location(3200, 3200, 0);
    tick();
    assert.equal(teleports.length, 5, 'global PvP permits escape at non-Wilderness coordinates');
    teleporting = false; state.pvp.retreat = null; globalPvp = false;
    location = new Location(3100, 3525, 0);
    tick();
    assert.equal(teleports.length, 6, 'level 1 can also teleport');

    teleporting = false; state.pvp.retreat = null;
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
  const { DitchTraversalService } = require('../plugins/bots/behaviours/traversal/DitchTraversalService');
  let location = new Location(3100, 3525, 0), pending, crossings = 0;
  const player = {
    getLocation: () => location, getUsername: () => 'retreat-test', setPositionToFace: () => {},
    getMovementQueue: () => ({ walkToObject: (_, action) => { pending = action; }, reset: () => {} }),
  };
  const state = { pvp: { retreat: {} }, roaming: { target: { x: 3100, y: 3518, z: 0 } } };
  const ditch = { getLocation: () => new Location(3100, 3521, 0), getId: () => 23271 };
  const service = new DitchTraversalService({
    api: { log: () => {} }, options: { ditchAttemptCooldownMs: 0 },
    emitObjectInteraction: () => { crossings++; return true; },
  });
  assert.equal(service.requestCross(player, state, ditch), false);
  assert.equal(pending, undefined);
  state.pvp.retreat = null;
  assert.equal(service.requestCross(player, state, ditch), true);
  state.pvp.retreat = {};
  pending.execute();
  assert.equal(crossings, 0, 'queued southbound crossing is cancelled when retreat begins');
  location = new Location(3100, 3518, 0);
  state.roaming.target.y = 3550;
  assert.equal(service.requestCross(player, state, ditch), true);
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
        levelAt, isInLocation: () => true, isInSafeBuilding: () => false,
      } };
      if (name.endsWith('/LootKeys.plugin')) return { isSafeLocation: () => false };
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
});
