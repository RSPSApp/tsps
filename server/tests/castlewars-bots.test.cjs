// Run after `yarn build`: node --test tests/castlewars-bots.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { Location } = require('../dist/game/model/Location');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const data = require('../plugins/minigames/castlewars/Data.CastleWars')(core);
const Bots = require('../plugins/minigames/castlewars/Bots.CastleWars');

const { TEAM, TEAM_DATA, CLIMB_ROUTES } = data;
const routes = Bots._test.buildRoutes(core, TEAM);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/bots/behaviours/pvp/PvpTierLoadouts.PlayerBots').initPvpTierLoadouts({
    core: require('../dist/plugins/PluginManager').PluginManager.getCoreApi(),
  });
  RegionManager.init();
  RegionManager.loadMapFiles(2390, 3086);
});

test('a clipped walk line (the river) counts as blocked, a clear bank line does not', () => {
  const player = { getLocation: () => new Location(2390, 3080, 0), getPrivateArea: () => null };
  const across = { getLocation: () => new Location(2390, 3082, 0) };
  const blocked = (a, b) => Bots._test.walkLineBlocked(a, b, core);
  assert.equal(blocked(player, across), false, 'the probed bank line starts clear');
  RegionManager.addClipping(2390, 3081, 0, core.RegionManager.BLOCKED_TILE, null);
  try {
    assert.equal(blocked(player, across), true, 'a clipped tile between the two blocks the chase');
    assert.equal(
      blocked(player, { getLocation: () => new Location(2390, 3081, 0) }),
      false,
      'an adjacent target needs no line sampling'
    );
  } finally {
    RegionManager.removeClipping(2390, 3081, 0, core.RegionManager.BLOCKED_TILE, null);
  }
  assert.equal(blocked(player, across), false, 'removing the clip restores the clear line');
});

function sameTile(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** The CLIMB_ROUTES object id offering this exact [from, to] pair, or null. */
function climbObjectFor(from, to) {
  for (const [id, pairs] of Object.entries(CLIMB_ROUTES)) {
    if (pairs.some(([pairFrom, pairTo]) => sameTile(pairFrom, from) && sameTile(pairTo, to))) {
      return Number(id);
    }
  }
  return null;
}

function eachRoute(visit) {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    for (const name of ['flagOut', 'flagHome', 'carryHome', 'guardUp', 'descent', 'attackerOut', 'attackerRaid', 'attackerEast', 'attackerTunnel', 'tunnelRaid', 'doormanUp', 'sideDoorUp', 'battlementUp']) {
      visit(team, name, routes[team][name]);
    }
  }
}

test('every route climb is one of the castle map\'s CLIMB_ROUTES pairs, one floor at a time', () => {
  let climbs = 0;
  eachRoute((team, name, route) => {
    for (const step of route) {
      if (step.type !== 'climb') {
        continue;
      }
      climbs += 1;
      const climbId = climbObjectFor(step.from, step.to);
      assert.ok(climbId, `${team} ${name}: CLIMB_ROUTES offers ${JSON.stringify(step.from)} -> ${JSON.stringify(step.to)}`);
      assert.ok(
        Math.abs(step.to[2] - step.from[2]) <= 1,
        // The battlement stairs climb within z0 (the walkway is raised, not a new plane).
        `${team} ${name}: a climb never skips a floor`
      );
    }
  });
  assert.ok(climbs >= 16, 'all five routes carry their ladder steps');
});

test('flag routes run from the start room to the enemy standard on floor 3', () => {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const enemy = team === TEAM.SARADOMIN ? TEAM.ZAMORAK : TEAM.SARADOMIN;
    const route = routes[team].flagOut;
    const first = route[0];
    const startRoom = TEAM_DATA[team].startRoom;
    // Routes may open with a barrier pass, whose tile sits on the spawn floor.
    const firstFloor = first.type === 'barrier' ? first.stand[2] : first.z;
    const firstX = first.type === 'barrier' ? first.stand[0] : first.x;
    const firstY = first.type === 'barrier' ? first.stand[1] : first.y;
    assert.equal(firstFloor, startRoom.getZ(), `${team} flag starts on the start-room floor`);
    assert.ok(
      Math.max(Math.abs(firstX - startRoom.getX()), Math.abs(firstY - startRoom.getY())) <= 12,
      `${team} flag starts near the start room`
    );
    const last = route[route.length - 1];
    const stand = TEAM_DATA[enemy].standLocation;
    assert.equal(last.type, 'walk');
    assert.deepEqual([last.x, last.y, last.z], [stand.getX(), stand.getY(), stand.getZ()], `${team} flag ends at the enemy stand`);
  }
});

test('flag home routes run from the enemy standard back to the team\'s own', () => {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const enemy = team === TEAM.SARADOMIN ? TEAM.ZAMORAK : TEAM.SARADOMIN;
    const home = routes[team].flagHome;
    const first = home[0];
    const enemyStand = TEAM_DATA[enemy].standLocation;
    assert.equal(first.z, enemyStand.getZ(), `${team} carrier starts on the flag-room floor`);
    assert.ok(
      Math.max(Math.abs(first.x - enemyStand.getX()), Math.abs(first.y - enemyStand.getY())) <= 6,
      `${team} carrier starts near the enemy stand`
    );
    const last = home[home.length - 1];
    const ownStand = TEAM_DATA[team].standLocation;
    assert.equal(last.z, ownStand.getZ());
    assert.ok(
      Math.max(Math.abs(last.x - ownStand.getX()), Math.abs(last.y - ownStand.getY())) <= 1,
      `${team} carrier ends at its own stand`
    );
  }
});

test('guard routes end at the team\'s own standard; attacker routes at the enemy large door', () => {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const stand = TEAM_DATA[team].standLocation;
    const guardLast = routes[team].guardUp[routes[team].guardUp.length - 1];
    assert.equal(guardLast.z, stand.getZ(), `${team} guard reaches the flag floor`);
    assert.ok(
      Math.max(Math.abs(guardLast.x - stand.getX()), Math.abs(guardLast.y - stand.getY())) <= 1,
      `${team} guard ends on the standard tile`
    );

    const door = routes[team].door;
    const approach = routes[team].attackerOut[routes[team].attackerOut.length - 1];
    assert.deepEqual([approach.x, approach.y, approach.z], door.approach, `${team} attacker walk ends at the door approach`);
    assert.ok(
      door.leaves.some(
        ([, x, y, z]) =>
          approach.z === z && Math.max(Math.abs(approach.x - x), Math.abs(approach.y - y)) <= 1
      ),
      `${team} attacker can click an enemy door leaf from the approach`
    );
  }
});

test('firstStepOnFloor resumes a route from the bot\'s current floor', () => {
  const route = routes[TEAM.SARADOMIN].flagOut;
  const index = Bots._test.firstStepOnFloor(route, 0, 0);
  assert.equal(route[index].z, 0);
  assert.equal(Bots._test.firstStepOnFloor(route, route.length, 0), -1, 'nothing left on the floor reads as stuck');
});

test('the large-door Attack option index is read from the cache definition', () => {
  assert.equal(Bots._test.attackOptionIndex({ getInteractions: () => ['Open', 'Attack', null] }), 2);
  assert.equal(Bots._test.attackOptionIndex({ getInteractions: () => [null, 'Attack'] }), 2);
  assert.equal(Bots._test.attackOptionIndex({}), 2, 'unknown definitions fall back to the door Attack slot');
});

test('runRoute walks within one tile and only climbs from the right floor', () => {
  const walks = [];
  const climbs = [];
  const fakeCore = Object.freeze({
    ...core,
    PathFinder: {
      calculateWalkRoute: (player, x, y) => {
        walks.push([x, y]);
        return 1;
      },
    },
  });
  const fakeGame = {
    TEAM: data.TEAM,
    BOT_KEY: {},
    BOT_ROLE_KEY: 'castlewars:bot-role',
    inGameProcessors: [],
    getTeamData: () => ({ startRoom: new core.Location(0, 0, 0), respawnBounds: { inside: () => false } }),
    climbTo: (player, to) => climbs.push(to),
  };
  Bots({ core: fakeCore, onCustomEvent: () => {}, onPlayerLogout: () => {} }, fakeGame);

  const location = { current: new core.Location(10, 11, 0) };
  const player = {
    getLocation: () => location.current,
    getMovementQueue: () => ({ size: () => 0 }),
  };
  const state = {
    route: [{ type: 'walk', x: 10, y: 10, z: 0 }],
    cursor: 0, pendingClimb: null, routeActive: false,
    lastTile: null, lastMovedAt: 0, nextWalkAt: 0, nextClimbAt: 0,
  };
  assert.equal(Bots._test.runRoute({ player, nowMs: 1000 }, state), 'done', 'one tile away already counts as arrived');

  location.current = new core.Location(10, 13, 0);
  state.route = [{ type: 'walk', x: 10, y: 10, z: 0 }];
  state.cursor = 0;
  state.routeActive = false;
  assert.equal(Bots._test.runRoute({ player, nowMs: 2000 }, state), 'running');
  assert.deepEqual(walks.pop(), [10, 10], 'the pather is asked for the step');

  // A climb from the wrong floor is a resume problem, not a climb.
  location.current = new core.Location(5, 5, 2);
  state.route = [{ type: 'climb', from: [5, 5, 1], to: [5, 5, 0] }];
  state.cursor = 0;
  state.routeActive = false;
  assert.equal(Bots._test.runRoute({ player, nowMs: 3000 }, state), 'stuck');

  location.current = new core.Location(5, 6, 1);
  state.route = [{ type: 'climb', from: [5, 5, 1], to: [5, 5, 0] }];
  state.cursor = 0;
  state.routeActive = false;
  assert.equal(Bots._test.runRoute({ player, nowMs: 4000 }, state), 'running');
  assert.deepEqual(climbs, [[5, 5, 0]], 'standing by the stair starts the climb');

  location.current = new core.Location(5, 5, 0);
  assert.equal(Bots._test.runRoute({ player, nowMs: 4100 }, state), 'done', 'landing on the destination finishes the climb');
});

test('attacker route variants spread over the whole pool, not just the stone crossings', () => {
  const seen = new Set();
  for (let index = 0; index < 8; index++) {
    seen.add(Bots._test.variantIndex({ getUsername: () => `CWBotZ${index}` }, 4));
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3], 'all four routes are picked');
});

test('a lobby tier pins each bot to a loadout archetype inside its combat band', () => {
  const { pickTierChoice, tierCombatLevel, TIER_BANDS, TIER_PROFILE_IDS, ROLES } = Bots._test;
  const { getPvpProfile } = require('../plugins/bots/behaviours/pvp/PvpProfileRegistry.PlayerBots');
  for (const tier of Object.keys(TIER_BANDS)) {
    const profile = getPvpProfile(TIER_PROFILE_IDS[tier]);
    const band = TIER_BANDS[tier];
    const attacker = pickTierChoice({ getUsername: () => 'CWBotZ7' }, ROLES.ATTACKER, tier);
    assert.ok(attacker, `${tier} attacker has a choice`);
    const level = tierCombatLevel(attacker.entry, profile);
    assert.ok(level >= band.min && level <= band.max, `${tier} attacker sits at level ${level}`);
    const archer = pickTierChoice({ getUsername: () => 'CWBotS3' }, ROLES.ARCHER, tier);
    assert.ok(archer.tags.includes('range'), `${tier} archer keeps a ranged loadout`);
    const mage = pickTierChoice({ getUsername: () => 'CWBotS3' }, ROLES.MAGE, tier);
    assert.ok(mage.tags.includes('magic'), `${tier} mage keeps a magic loadout`);
  }
  assert.equal(pickTierChoice({ getUsername: () => 'CWBotZ7' }, ROLES.ATTACKER, null), null, 'no tier means no pinning');
});

test('the main routes cross by the island bridge, not the stepping stones', () => {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    for (const name of ['flagOut', 'flagHome']) {
      assert.equal(
        routes[team][name].some((step) => step.type === 'stones'),
        false,
        `${team} ${name} walks the island bridge`
      );
    }
    assert.ok(
      routes[team].attackerOut.some((step) => step.x === 2384 && step.y === 3104),
      `${team} attackerOut crosses the island bridge`
    );
  }
});
