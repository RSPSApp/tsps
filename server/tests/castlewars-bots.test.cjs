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
    MapObjects: { get: () => ({}) },
    PathFinder: {
      calculateWalkRoute: (player, x, y) => {
        walks.push([x, y]);
        return 1;
      },
    },
  });
  const fakeGame = {
    TEAM: data.TEAM,
    data: { CLIMB_ROUTES: { 1: [[[5, 5, 1], [5, 5, 0]]] } },
    BOT_KEY: {},
    BOT_ROLE_KEY: 'castlewars:bot-role',
    inGameProcessors: [],
    getTeamData: () => ({ startRoom: new core.Location(0, 0, 0), respawnBounds: { inside: () => false } }),
    climbTo: (player, to) => climbs.push(to),
  };
  Bots({ core: fakeCore, onCustomEvent: () => {}, onPlayerLogout: () => {} }, fakeGame);

  let pending;
  const location = { current: new core.Location(10, 11, 0) };
  const player = {
    getLocation: () => location.current,
    getMovementQueue: () => ({ size: () => 0, walkToObject: (_object, action) => { pending = action; } }),
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
  assert.deepEqual(climbs, [], 'a nearby bot must pass the normal object reach check');
  assert.ok(pending);
  pending.execute();
  assert.deepEqual(climbs, [[5, 5, 0]], 'the native route callback starts the climb');

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
    const defender = pickTierChoice({ getUsername: () => 'CWBotS3' }, ROLES.DEFENDER, tier);
    assert.ok(defender.tags.includes('magic'), `${tier} defender keeps a magic loadout`);
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

function nativeBotGame(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const registry = { ...PluginManager.createApi('CastleWarsBotTest'), getTaskManager: () => ({ submit() {}, cancelTasks() {} }) };
  const game = require('../plugins/minigames/castlewars/Game.CastleWars')(registry);
  const players = [];
  game.gameArea = { getPlayers: () => players };
  game.inGameProcessors = [];
  game.BOT_ROLE_KEY = 'castlewars:bot-role';
  game.BOT_TIER_KEY = 'castlewars:bot-tier';
  game.PRACTICE_MAXED_KEY = 'castlewars:practice-maxed';
  game.isPlaying = (player) => players.includes(player);
  game.requirePlaying = game.isPlaying;
  require('../plugins/minigames/castlewars/Flags.CastleWars')(registry, game);
  require('../plugins/minigames/castlewars/Doors.CastleWars')(registry, game);
  require('../plugins/minigames/castlewars/Practice.CastleWars')(registry, game);
  Bots(registry, game);
  const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  function actor(team, at, role = 'scorer') {
    const player = new Player(new PlayerSession(channel), new core.Location(...at));
    player.setIndex(1500 + players.length);
    player.setUsername(`CWBot${players.length}`);
    player.setRegistered(true);
    player.setPlayerBot(true);
    player.setAttribute(game.BOT_KEY, true);
    player.setAttribute(game.BOT_ROLE_KEY, role);
    player.getArea = () => game.gameArea;
    game.setTeamId(player, team);
    players.push(player);
    return player;
  }
  function turns(player, count = 4) {
    for (let index = 0; index < count; index++) {
      core.TaskManager.process();
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
  }
  t.after(() => {
    for (const team of Object.values(game.TEAM)) game.removeDroppedFlagObject(team);
    registry.emitCustomEvent('castlewars:reset', {});
    for (const player of players) { core.TaskManager.cancelTasks(player.getIndex()); player.setRegistered(false); }
  });
  return { game, registry, actor, turns };
}

test('a full scorer inventory makes room for both hands through the native flag interaction', (t) => {
  const { game, actor } = nativeBotGame(t);
  const enemy = TEAM.ZAMORAK;
  const stand = game.getTeamData(enemy).standLocation;
  core.RegionManager.loadMapFiles(stand.getX(), stand.getY());
  const player = actor(TEAM.SARADOMIN, [stand.getX(), stand.getY() - 1, stand.getZ()]);
  const wand = new core.Item(core.ItemIdentifiers.MASTER_WAND, 1, { charges: 7 });
  const shield = new core.Item(core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD, 1);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, wand);
  player.getEquipment().setItem(core.Equipment.SHIELD_SLOT, shield);
  for (let index = 0; index < 28; index++) player.getInventory().adds(core.ItemIdentifiers.BANDAGES, 1);
  const state = { role: 'scorer', flagMode: 'out', route: [], cursor: 0, nextStandClickAt: 0 };
  Bots._test.flagCycle({ player, nowMs: 1000 }, state, TEAM.SARADOMIN);
  assert.equal(game.getCarriedFlagTeam(player), enemy);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BANDAGES), 26);
  assert.equal(player.getInventory().getAmount(wand.getId()), 1);
  assert.equal(player.getInventory().getAmount(shield.getId()), 1);
  assert.deepEqual(player.getInventory().getItems().find((item) => item.getId() === wand.getId()), wand);
  assert.equal(player.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), -1);
});

test('a full scorer can retrieve its own standard near the enemy stand', (t) => {
  const { game, actor } = nativeBotGame(t);
  const stand = game.getTeamData(TEAM.ZAMORAK).standLocation;
  core.RegionManager.loadMapFiles(stand.getX(), stand.getY());
  const at = [stand.getX(), stand.getY() - 1, stand.getZ()];
  const player = actor(TEAM.SARADOMIN, at);
  const carrier = actor(TEAM.ZAMORAK, at);
  game.carryFlag(carrier, TEAM.SARADOMIN);
  game.dropCarriedFlag(carrier);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.MASTER_WAND, 1));
  player.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD, 1));
  for (let index = 0; index < 28; index++) player.getInventory().adds(core.ItemIdentifiers.BANDAGES, 1);
  const state = { role: 'scorer', flagMode: 'out', route: [], cursor: 0, nextStandClickAt: 0 };
  Bots._test.flagCycle({ player, nowMs: 1000 }, state, TEAM.SARADOMIN);
  assert.equal(game.getCarriedFlagTeam(player), TEAM.SARADOMIN);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BANDAGES), 26);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.MASTER_WAND), 1);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD), 1);
});

test('defenders safe a nearby own flag at the castle entrance before attacking', (t) => {
  const { game, actor, turns } = nativeBotGame(t);
  core.RegionManager.loadMapFiles(2425, 3085);
  const player = actor(TEAM.SARADOMIN, [2425, 3086, 0], 'defender');
  const enemy = actor(TEAM.ZAMORAK, [2425, 3085, 0]);
  game.carryFlag(enemy, TEAM.SARADOMIN);
  game.dropCarriedFlag(enemy);
  let attacks = 0;
  t.mock.method(game.practiceBots, 'defenderAttack', () => { attacks++; return 'running'; });
  t.mock.method(game.practiceBots, 'defenderTools', () => 'failure');
  t.mock.method(Math, 'random', () => 0.99);
  assert.equal(game.flagStatus[TEAM.SARADOMIN], 2);
  Bots._test.processBot(player);
  turns(player);
  assert.equal(game.flagStatus[TEAM.SARADOMIN], 0);
  assert.equal(game.getDroppedFlagObject(TEAM.SARADOMIN), null);
  assert.equal(attacks, 0, 'returning a flag at the base takes priority over a new fight');
});

test('both bot flag routes unlock the enemy side door and retry a failed lock pick', (t) => {
  const { game, actor, turns } = nativeBotGame(t);
  for (const [team, id, from, doorAt] of [
    [TEAM.SARADOMIN, core.ObjectIdentifiers.DOOR_127, [2385, 3134, 0], [2384, 3134, 0]],
    [TEAM.ZAMORAK, core.ObjectIdentifiers.DOOR_125, [2414, 3073, 0], [2415, 3073, 0]],
  ]) {
    core.RegionManager.loadMapFiles(...doorAt.slice(0, 2));
    const player = actor(team, from);
    const route = Bots._test.buildRoutes(core, TEAM)[team].flagOut;
    const step = route.find((entry) => entry.type === 'door' && entry.leaves.some(([leaf]) => leaf === id));
    assert.ok(step, `${team} has a native side-door action on the way to the enemy flag`);
    const state = { route: [step], cursor: 0, routeActive: false, nextWalkAt: 0, nextDoorClickAt: 0 };
    let success = false;
    const random = t.mock.method(core.Misc, 'randomInclusive', () => success ? 1 : 6);
    assert.equal(Bots._test.runRoute({ player, nowMs: 1000 }, state), 'running');
    turns(player);
    assert.ok(core.MapObjects.get(id, new core.Location(...doorAt), null), 'failed pick leaves the closed leaf present');
    assert.equal(state.cursor, 0, 'the route must not advance after a refused unlock');
    success = true;
    assert.equal(Bots._test.runRoute({ player, nowMs: 3100 }, state), 'running');
    turns(player);
    assert.equal(core.MapObjects.get(id, new core.Location(...doorAt), null), null, 'normal Unlock opens the side door');
    assert.equal(Bots._test.runRoute({ player, nowMs: 3200 }, state), 'done');
    random.mock.restore();
  }
});

test('maxed practice uses veteran style presets even if an old novice tier remains on the bot', () => {
  const player = { getUsername: () => 'CWBotZ1', getAttribute: (key) => key === 'castlewars:practice-maxed' };
  const { getPvpProfile } = require('../plugins/bots/behaviours/pvp/PvpProfileRegistry.PlayerBots');
  for (const role of [Bots._test.ROLES.ATTACKER, Bots._test.ROLES.SCORER, Bots._test.ROLES.DEFENDER, Bots._test.ROLES.ARCHER]) {
    const choice = Bots._test.pickTierChoice(player, role, 'novice');
    const selected = Bots._test.tierCombatLevel(choice.entry, getPvpProfile('veteran'));
    assert.ok(selected >= 101, `${role} chooses a veteran preset before maxed stat overrides`);
    if (role === Bots._test.ROLES.DEFENDER) assert.ok(choice.tags.includes('magic'));
    if (role === Bots._test.ROLES.ARCHER) assert.ok(choice.tags.includes('range'));
  }
});

test('maxed stats and native XP are applied after the real preset, including a full HP refill', (t) => {
  const { game, actor } = nativeBotGame(t);
  for (const role of ['scorer', 'defender', 'attacker']) {
    const player = actor(TEAM.SARADOMIN, [2425, 3078, 0], role);
    player.setAttribute(game.PRACTICE_MAXED_KEY, true);
    player.setAttribute(game.BOT_TIER_KEY, 'novice');
    const state = { role, nextLoadoutAt: 0 };
    Bots._test.ensureLoadout(player, state, TEAM.SARADOMIN, 1000);
    assert.equal(state.equipped, true, role);
    assert.equal(player.getSkillManager().getCombatLevel(), 126, role);
    for (const skill of [core.Skill.ATTACK, core.Skill.DEFENCE, core.Skill.STRENGTH, core.Skill.HITPOINTS,
      core.Skill.RANGED, core.Skill.PRAYER, core.Skill.MAGIC, core.Skill.THIEVING]) {
      assert.equal(player.getSkillManager().getCurrentLevel(skill), 99);
      assert.equal(player.getSkillManager().getMaxLevel(skill), 99);
      assert.equal(player.getSkillManager().getExperience(skill), core.SkillManager.getExperienceForLevel(99));
    }
    if (role !== 'attacker') assert.equal(player.getEquipment().getSlot(core.Equipment.BODY_SLOT), role === 'scorer'
      ? core.ItemIdentifiers.MASORI_BODY_F_ : core.ItemIdentifiers.ANCESTRAL_ROBE_TOP);
  }
});
