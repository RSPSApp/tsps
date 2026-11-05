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
  game.gameArea = { getPlayers: () => players, isMulti: () => true, getName: () => "Castle Wars", canAttack: () => null };
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
  const I = core.ItemIdentifiers;
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const enemy = team === TEAM.SARADOMIN ? TEAM.ZAMORAK : TEAM.SARADOMIN;
    const stand = game.getTeamData(enemy).standLocation;
    core.RegionManager.loadMapFiles(stand.getX(), stand.getY());
    const player = actor(team, [stand.getX(), stand.getY() - 1, stand.getZ()]);
    const crossbow = new core.Item(I.ZARYTE_CROSSBOW, 1);
    const shield = new core.Item(I.SPECTRAL_SPIRIT_SHIELD, 1);
    player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, crossbow);
    player.getEquipment().setItem(core.Equipment.SHIELD_SLOT, shield);
    player.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(I.ONYX_BOLTS_E_, 1000));
    for (let index = 0; index < 28; index++) player.getInventory().adds(I.BANDAGES, 1);
    const state = { role: 'scorer', flagMode: 'out', route: [], cursor: 0, nextStandClickAt: 0 };
    Bots._test.flagCycle({ player, nowMs: 1000 }, state, team);
    assert.equal(game.getCarriedFlagTeam(player), enemy, team);
    assert.equal(player.getInventory().getAmount(I.BANDAGES), 26, `${team} makes room for both hands`);
    assert.equal(player.getInventory().getAmount(crossbow.getId()), 1, `${team} stows the crossbow`);
    assert.equal(player.getInventory().getAmount(shield.getId()), 1, `${team} stows the shield`);
    assert.deepEqual(player.getInventory().getItems().find((item) => item.getId() === crossbow.getId()), crossbow);
    assert.deepEqual(player.getInventory().getItems().find((item) => item.getId() === shield.getId()), shield);
    assert.equal(player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), game.getTeamData(enemy).bannerId);
    assert.equal(player.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), -1);
    assert.equal(player.getEquipment().getSlot(core.Equipment.AMMUNITION_SLOT), I.ONYX_BOLTS_E_);
  }
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
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.ZARYTE_CROSSBOW, 1));
  player.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(core.ItemIdentifiers.ONYX_BOLTS_E_, 1000));
  for (let index = 0; index < 28; index++) player.getInventory().adds(core.ItemIdentifiers.BANDAGES, 1);
  const state = { role: 'scorer', flagMode: 'out', route: [], cursor: 0, nextStandClickAt: 0 };
  Bots._test.flagCycle({ player, nowMs: 1000 }, state, TEAM.SARADOMIN);
  assert.equal(game.getCarriedFlagTeam(player), TEAM.SARADOMIN);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BANDAGES), 26);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ZARYTE_CROSSBOW), 1);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD), 1);
  assert.equal(player.getEquipment().getSlot(core.Equipment.AMMUNITION_SLOT), core.ItemIdentifiers.ONYX_BOLTS_E_);
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

const REPORTED_ZAMORAK_DEFENDER_POSTS = [
  [2369, 3129, 0], [2383, 3134, 0], [2380, 3130, 0],
  [2372, 3126, 1], [2374, 3126, 1], [2374, 3125, 1], [2375, 3126, 1],
  [2375, 3125, 1], [2376, 3126, 1], [2378, 3127, 1],
  [2371, 3128, 2], [2374, 3130, 2], [2374, 3129, 2], [2375, 3130, 2],
  [2373, 3133, 3],
];

test('defender patrols cover every reported Zamorak chokepoint and reachable Saradomin mirrors', () => {
  const zamPosts = routes[TEAM.ZAMORAK].defenderPosts;
  for (const post of REPORTED_ZAMORAK_DEFENDER_POSTS) {
    assert.ok(zamPosts.some((entry) => sameTile(entry, post)), `Zamorak defender post ${post}`);
  }
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const posts = routes[team].defenderPosts;
    assert.ok(posts.length >= REPORTED_ZAMORAK_DEFENDER_POSTS.length);
    assert.deepEqual(
      [...new Set(posts.map((post) => post[2]))].sort((a, b) => a - b),
      [0, 1, 2, 3],
      `${team} defenders cover every castle floor`
    );
    for (const post of posts) {
      RegionManager.loadMapFiles(post[0], post[1]);
      assert.equal(
        RegionManager.blocked(new Location(post[0], post[1], post[2]), null),
        false,
        `${team} defender post ${post} is walkable`
      );
      const route = Bots._test.defenderPostRoute(team, post, 1);
      const last = route[route.length - 1];
      assert.deepEqual([last.x, last.y, last.z], post, `${team} ${post} is the route destination`);
      assert.equal(last.exact, true, `${team} ${post} is walked exactly, not just adjacent`);
      for (const step of route) {
        if (step.type === 'climb') {
          assert.ok(climbObjectFor(step.from, step.to), `${team} ${post}: real stair ${JSON.stringify(step.from)} -> ${JSON.stringify(step.to)}`);
        }
      }
      if (post[2] !== 1) {
        assert.ok(
          route.some((step) => step.type === 'climb' && step.to[2] === post[2]),
          `${team} ${post} uses a stair onto its floor`
        );
      }
    }
  }
});

test('defender posts spread over the whole squad instead of stacking on the flag', () => {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const posts = routes[team].defenderPosts;
    const chosen = new Set();
    for (let index = 0; index < 30; index++) {
      chosen.add(`${Bots._test.defenderPostFor({ getUsername: () => `CWBotZ${index}` }, team)}`);
    }
    assert.equal(chosen.size, posts.length, `${team} all posts are assigned`);
    assert.equal(posts.filter((post) => post[2] === 3).length, 1, `${team} only one flag-room post`);
  }
});

test('field pickups go straight home while flag-room pickups use the enemy descent', (t) => {
  const { game, actor } = nativeBotGame(t);
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const enemy = team === TEAM.SARADOMIN ? TEAM.ZAMORAK : TEAM.SARADOMIN;
    const enemyStand = game.getTeamData(enemy).standLocation;
    const room = actor(team, [enemyStand.getX(), enemyStand.getY(), enemyStand.getZ()]);
    const roomRoute = Bots._test.homeRouteFor(room, team);
    assert.deepEqual(
      [roomRoute[0].x, roomRoute[0].y, roomRoute[0].z],
      [routes[team].flagHome[0].x, routes[team].flagHome[0].y, routes[team].flagHome[0].z],
      `${team} flag-room pickup walks the enemy descent`
    );
    const lower = actor(team, [
      game.getTeamData(enemy).startRoom.getX(),
      game.getTeamData(enemy).startRoom.getY(),
      game.getTeamData(enemy).startRoom.getZ(),
    ]);
    assert.deepEqual(
      [Bots._test.homeRouteFor(lower, team)[0].x, Bots._test.homeRouteFor(lower, team)[0].y],
      [routes[team].flagHome[0].x, routes[team].flagHome[0].y],
      `${team} enemy-castle pickup walks the enemy descent`
    );
    const field = actor(team, [routes[team].carryHome[0].x, routes[team].carryHome[0].y, routes[team].carryHome[0].z]);
    const fieldRoute = Bots._test.homeRouteFor(field, team);
    assert.deepEqual(
      [fieldRoute[0].x, fieldRoute[0].y, fieldRoute[0].z],
      [routes[team].carryHome[0].x, routes[team].carryHome[0].y, routes[team].carryHome[0].z],
      `${team} field pickup goes straight to its own door`
    );
  }
});

test('floor recovery picks the nearer side of a castle visited twice on one floor', () => {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const home = routes[team].flagHome;
    const own = routes[team].carryHome[0];
    const index = Bots._test.firstStepOnFloor(home, 0, 0, new Location(own.x, own.y, own.z));
    assert.ok(index >= 0);
    assert.deepEqual(
      [home[index].x, home[index].y],
      [own.x, own.y],
      `${team} resumes on the own-door side, not the enemy bridge side`
    );
  }
});

test('scorers carry the Zaryte crossbow, spectral shield, onyx bolts and barricades, restoring them after a stow', (t) => {
  const { game, actor } = nativeBotGame(t);
  const E = core.Equipment;
  const I = core.ItemIdentifiers;
  const player = actor(TEAM.SARADOMIN, [2425, 3078, 0], 'scorer');
  player.getCombat().setCastSpell(core.CombatSpells.ICE_BARRAGE.getSpell());
  player.getCombat().setAutocastSpell(core.CombatSpells.ICE_BARRAGE.getSpell());
  const state = { role: 'scorer', nextLoadoutAt: 0 };
  Bots._test.ensureLoadout(player, state, TEAM.SARADOMIN, 1000);
  assert.equal(state.equipped, true);
  assert.equal(player.getCombat().getCastSpell(), null, 'ranged gear clears the old cast spell');
  assert.equal(player.getCombat().getAutocastSpell(), null, 'ranged gear clears the old autocast');
  assert.equal(player.getEquipment().getSlot(E.WEAPON_SLOT), I.ZARYTE_CROSSBOW);
  assert.equal(player.getEquipment().getSlot(E.SHIELD_SLOT), I.SPECTRAL_SPIRIT_SHIELD, 'the one-handed crossbow keeps the shield');
  assert.equal(player.getEquipment().getSlot(E.AMMUNITION_SLOT), I.ONYX_BOLTS_E_);
  assert.ok(player.getInventory().getAmount(I.BARRICADE) >= 3);

  player.getInventory().adds(I.ZARYTE_CROSSBOW, 1);
  player.getInventory().adds(I.SPECTRAL_SPIRIT_SHIELD, 1);
  player.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(-1, 0));
  player.getEquipment().setItem(E.SHIELD_SLOT, new core.Item(-1, 0));
  Bots._test.ensureFlagWeapon(player, 'scorer');
  assert.equal(player.getEquipment().getSlot(E.WEAPON_SLOT), I.ZARYTE_CROSSBOW);
  assert.equal(player.getEquipment().getSlot(E.SHIELD_SLOT), I.SPECTRAL_SPIRIT_SHIELD);
  assert.equal(player.getInventory().getAmount(I.ZARYTE_CROSSBOW), 0, 'the stowed crossbow is restored, not duplicated');
  assert.equal(player.getInventory().getAmount(I.SPECTRAL_SPIRIT_SHIELD), 0, 'the stowed shield is restored, not duplicated');
  assert.equal(player.getEquipment().getSlot(E.AMMUNITION_SLOT), I.ONYX_BOLTS_E_);

  // The native flag handler stows both hands; while the banner is held nothing is put back.
  player.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(-1, 0));
  player.getEquipment().setItem(E.SHIELD_SLOT, new core.Item(-1, 0));
  game.carryFlag(player, TEAM.ZAMORAK);
  Bots._test.ensureFlagWeapon(player, 'scorer');
  assert.equal(player.getEquipment().getSlot(E.WEAPON_SLOT), game.getTeamData(TEAM.ZAMORAK).bannerId, 'the banner is never swapped while carried');
  assert.equal(player.getEquipment().getSlot(E.SHIELD_SLOT), -1);
});

test('scorer combat is a bounded burst and then goes back to scoring', (t) => {
  const { actor } = nativeBotGame(t);
  const player = actor(TEAM.SARADOMIN, [2425, 3078, 0], 'scorer');
  actor(TEAM.ZAMORAK, [2425, 3079, 0]);
  Bots._test.preparePracticeLoadout(player, { role: 'scorer' }, TEAM.SARADOMIN);
  const attack = t.mock.method(player.getCombat(), 'attack', () => {});
  t.mock.method(core.CombatFactory, 'canAttackPermission', () => core.CanAttackResponse.CAN_ATTACK);
  const state = { role: 'scorer' };
  assert.equal(Bots._test.scorerCombat({ player, nowMs: 1000 }, state, TEAM.SARADOMIN), 'running');
  assert.equal(state.practiceCombatUntil, 3500);
  assert.equal(Bots._test.scorerCombat({ player, nowMs: 3000 }, state, TEAM.SARADOMIN), 'running');
  assert.equal(Bots._test.scorerCombat({ player, nowMs: 3600 }, state, TEAM.SARADOMIN), 'failure');
  assert.equal(state.practiceCombatUntil, 0, 'the burst ends');
  assert.equal(Bots._test.scorerCombat({ player, nowMs: 7000 }, state, TEAM.SARADOMIN), 'running');
  assert.ok(attack.mock.callCount() >= 2);
});

test('defenders keep enemy carriers first but never chase them out of their base', (t) => {
  const { game, actor } = nativeBotGame(t);
  const defender = actor(TEAM.SARADOMIN, [2428, 3079, 2], 'defender');
  const carrier = actor(TEAM.ZAMORAK, [2426, 3079, 2]);
  const decoy = actor(TEAM.ZAMORAK, [2427, 3079, 2]);
  game.carryFlag(carrier, TEAM.SARADOMIN);
  assert.equal(Bots._test.defenderTarget(defender, TEAM.SARADOMIN), carrier);
  carrier.moveTo(new Location(2414, 3079, 2));
  assert.equal(Bots._test.defenderTarget(defender, TEAM.SARADOMIN), decoy);
});

test('route walking hands the current step destination to the practice tools', (t) => {
  const { game, actor } = nativeBotGame(t);
  const player = actor(TEAM.SARADOMIN, [2425, 3078, 0], 'scorer');
  let goal = null;
  t.mock.method(game.practiceBots, 'scorerTools', (_ctx, state) => {
    goal = state.practiceGoal?.slice() ?? null;
    return 'failure';
  });
  t.mock.method(game.practiceBots, 'scorerDefence', () => 'failure');
  const state = {
    role: 'scorer',
    route: [{ type: 'walk', x: 2420, y: 3080, z: 0 }],
    cursor: 0, pendingClimb: null, routeActive: false, lastTile: null,
    lastMovedAt: 0, nextWalkAt: 0,
  };
  Bots._test.runRoute({ player, nowMs: 1000 }, state);
  assert.deepEqual(goal, [2420, 3080, 0], 'the goal is the current step destination');
  assert.deepEqual(state.practiceGoal, [2420, 3080, 0], 'the valid current goal is kept for scorerDefence');
  Bots._test.resetRouteState(state);
  assert.equal(state.practiceGoal, null, 'a route reset clears the goal');
});

test('death and respawn reset transient practice state', () => {
  const state = {
    route: [{}], cursor: 3, pendingClimb: {}, flagMode: 'home',
    practiceGoal: [1, 2, 3], practicePost: [4, 5, 6], practiceClearGoal: 'x', practiceClearSince: 10,
    pendingClear: {}, defenderBarricade: {}, defenderPatrol: true, defenderPostIndex: 4, defenderHoldUntil: 25,
    nextToolAt: 5, nextBarricadeAt: 6, practiceCombatUntil: 7, nextPracticeCombatAt: 8,
    nextDefencePlaceAt: 9, scorerDefenceLight: {}, flagCirculating: true,
  };
  Bots._test.resetRouteState(state);
  assert.equal(state.route, null);
  assert.equal(state.cursor, 0);
  assert.equal(state.practiceGoal, null);
  assert.equal(state.practicePost, null);
  assert.equal(state.pendingClear, null);
  assert.equal(state.defenderBarricade, null);
  assert.equal(state.defenderPatrol, false);
  assert.equal(state.defenderPostIndex, null);
  assert.equal(state.defenderHoldUntil, 0);
  assert.equal(state.nextToolAt, 0);
  assert.equal(state.nextBarricadeAt, 0);
  assert.equal(state.practiceCombatUntil, 0);
  assert.equal(state.nextPracticeCombatAt, 0);
  assert.equal(state.nextDefencePlaceAt, 0);
  assert.equal(state.scorerDefenceLight, null);
  assert.equal(state.flagCirculating, false);
});

test('a barricade pause holds the route until the practice tools release it', (t) => {
  const { game, actor } = nativeBotGame(t);
  const player = actor(TEAM.SARADOMIN, [2425, 3080, 0], 'scorer');
  let tools = 'running';
  t.mock.method(game.practiceBots, 'scorerTools', () => tools);
  t.mock.method(game.practiceBots, 'scorerDefence', () => 'failure');
  const walk = t.mock.method(core.PathFinder, 'calculateWalkRoute', () => 1);
  const state = {
    role: 'scorer',
    route: [{ type: 'walk', x: 2420, y: 3080, z: 0 }],
    cursor: 0, pendingClimb: null, routeActive: false, lastTile: null,
    lastMovedAt: 0, nextWalkAt: 0,
  };
  assert.equal(Bots._test.runRoute({ player, nowMs: 1000 }, state), 'running');
  assert.equal(walk.mock.callCount(), 0, 'walking is paused while the barricade is being cleared');
  tools = 'failure';
  assert.equal(Bots._test.runRoute({ player, nowMs: 2000 }, state), 'running');
  assert.ok(walk.mock.callCount() >= 1, 'walking resumes when the tools release the route');
});

test('defender floor links use the castle stairs in both directions', () => {
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    for (const post of routes[team].defenderPosts) {
      for (let fromZ = 0; fromZ <= 3; fromZ++) {
        const route = Bots._test.defenderPostRoute(team, post, fromZ);
        const last = route[route.length - 1];
        assert.deepEqual([last.x, last.y, last.z], post, `${team} ${fromZ}->${post[2]}`);
        let z = fromZ;
        for (const step of route) {
          if (step.type !== 'climb') continue;
          assert.equal(step.from[2], z, `${team} climb starts on the current floor`);
          assert.equal(Math.abs(step.to[2] - z), 1, `${team} climb changes one floor`);
          assert.ok(climbObjectFor(step.from, step.to), `${team} real stair ${JSON.stringify(step.from)}`);
          z = step.to[2];
        }
        assert.equal(z, post[2]);
      }
    }
  }
  const descending = Bots._test.defenderPostRoute(TEAM.ZAMORAK, [2369, 3129, 0], 3)
    .filter((step) => step.type === 'climb')
    .map((step) => step.to[2]);
  assert.deepEqual(descending, [2, 1, 0], 'a flag-floor defender descends to the ground post');
});

test('a lone defender cycles every floor and takes a new post after its hold', (t) => {
  const { game, actor } = nativeBotGame(t);
  const player = actor(TEAM.SARADOMIN, [2425, 3078, 0], 'defender');
  const posts = routes[TEAM.SARADOMIN].defenderPosts;
  const seenFloors = new Set();
  let index = 0;
  for (let step = 0; step < posts.length; step++) {
    const next = Bots._test.nextDefenderPost(player, TEAM.SARADOMIN, { defenderPostIndex: index });
    index = next.index;
    seenFloors.add(next.post[2]);
  }
  assert.deepEqual([...seenFloors].sort((a, b) => a - b), [0, 1, 2, 3], 'the patrol visits every floor');

  player.moveTo(new Location(posts[0][0], posts[0][1], posts[0][2]));
  const state = {
    role: 'defender', defenderPostIndex: 0, defenderPost: posts[0], practicePost: posts[0],
    defenderHoldUntil: 0, defenderPatrol: false, route: null, cursor: 0, pendingClimb: null,
    routeActive: false, lastTile: null, lastMovedAt: 0, nextWalkAt: 0, nextClimbAt: 0,
  };
  t.mock.method(core.PathFinder, 'calculateWalkRoute', () => 1);
  assert.equal(Bots._test.defenderPatrol({ player, nowMs: 1000 }, state, TEAM.SARADOMIN), 'running');
  assert.equal(state.defenderHoldUntil, 1000 + 2200, 'the defender holds the post briefly');
  assert.equal(state.defenderPostIndex, 0);
  assert.equal(Bots._test.defenderPatrol({ player, nowMs: 4000 }, state, TEAM.SARADOMIN), 'running');
  assert.notEqual(state.defenderPostIndex, 0, 'the patrol moves on after the hold');
  assert.ok(state.route, 'a route to the next post is started');
  const next = posts[state.defenderPostIndex];
  assert.deepEqual(
    [state.route[state.route.length - 1].x, state.route[state.route.length - 1].y, state.route[state.route.length - 1].z],
    next
  );
});

test('patrol still visits barricaded posts so a full cap cannot strand it upstairs', (t) => {
  const { game, actor } = nativeBotGame(t);
  const player = actor(TEAM.SARADOMIN, [2425, 3078, 0], 'defender');
  const posts = routes[TEAM.SARADOMIN].defenderPosts;
  const fakeBarricade = {
    getLocation: () => new Location(posts[1][0], posts[1][1], posts[1][2]),
  };
  t.mock.method(core.World, 'getNpcs', () => [fakeBarricade]);
  t.mock.method(game, 'isBarricade', (npc) => npc === fakeBarricade);
  const next = Bots._test.nextDefenderPost(player, TEAM.SARADOMIN, { defenderPostIndex: 0 });
  assert.equal(next.index, 1, 'the post is visited from beside its existing barricade');
});

test('scorer defence works while carrying the standard but not on climb or barrier steps', (t) => {
  const { game, actor } = nativeBotGame(t);
  const player = actor(TEAM.SARADOMIN, [2425, 3078, 0], 'scorer');
  actor(TEAM.ZAMORAK, [2425, 3079, 0]);
  game.carryFlag(player, TEAM.ZAMORAK);
  let calls = 0;
  t.mock.method(game.practiceBots, 'scorerDefence', () => { calls++; return 'running'; });
  const state = { role: 'scorer' };
  assert.equal(
    Bots._test.runScorerDefence({ player, nowMs: 1000 }, state, { type: 'walk', x: 2420, y: 3080, z: 0 }),
    'running'
  );
  assert.equal(calls, 1, 'the tools run even while the banner is carried');
  assert.equal(
    Bots._test.runScorerDefence({ player, nowMs: 1001 }, state, {
      type: 'climb', from: [2425, 3078, 0], to: [2426, 3074, 3],
    }),
    'failure'
  );
  assert.equal(calls, 1, 'a climb step does not start defensive placement');
});

test('a scorer whose teammate has the enemy flag circles the enemy castle instead of camping', (t) => {
  const { game, actor } = nativeBotGame(t);
  t.mock.method(core.PathFinder, 'calculateWalkRoute', () => 1);
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const enemy = team === TEAM.SARADOMIN ? TEAM.ZAMORAK : TEAM.SARADOMIN;
    const stand = game.getTeamData(enemy).standLocation;
    core.RegionManager.loadMapFiles(stand.getX(), stand.getY());
    const scorer = actor(team, [stand.getX(), stand.getY() - 1, stand.getZ()], 'scorer');
    const mate = actor(team, [
      game.getTeamData(team).startRoom.getX(),
      game.getTeamData(team).startRoom.getY(),
      game.getTeamData(team).startRoom.getZ(),
    ], 'flag');
    game.carryFlag(mate, enemy);
    const state = {
      role: 'scorer', flagMode: 'out', route: null, cursor: 0, nextStandClickAt: 0,
      pendingClimb: null, routeActive: false, lastTile: null, lastMovedAt: 0, nextWalkAt: 0,
    };
    Bots._test.flagCycle({ player: scorer, nowMs: 1000 }, state, team);
    assert.equal(state.flagCirculating, true, `${team} leaves the stand`);
    assert.ok(state.route, `${team} starts the enemy-castle patrol`);
    const first = routes[team].enemyCirculation[0];
    assert.deepEqual(
      [state.route[0].x, state.route[0].y, state.route[0].z],
      [first.x, first.y, first.z],
      `${team} uses its enemy-castle circulation route`
    );
  }
});

test('both teams recover a dropped enemy standard in the field', (t) => {
  const { game, actor } = nativeBotGame(t);
  for (const team of [TEAM.SARADOMIN, TEAM.ZAMORAK]) {
    const enemy = team === TEAM.SARADOMIN ? TEAM.ZAMORAK : TEAM.SARADOMIN;
    const carrier = actor(enemy, [2386, 3103, 0], 'flag');
    game.carryFlag(carrier, enemy);
    carrier.moveTo(new Location(2386, 3103, 0));
    game.dropCarriedFlag(carrier);
    assert.equal(game.flagStatus[enemy], 2, `${team} has a ground standard to recover`);
    const player = actor(team, [2386, 3104, 0], 'attacker');
    const state = { role: 'attacker', route: null, cursor: 0, nextFlagClickAt: 0 };
    Bots._test.recoverEnemyFlag({ player, nowMs: 1000 }, state, team);
    assert.equal(game.getCarriedFlagTeam(player), enemy, `${team} takes the dropped standard`);
  }
});

test('defender placement runs before combat so a ready tool action is not starved', (t) => {
  const { game, actor } = nativeBotGame(t);
  t.mock.method(core.CombatFactory, 'canAttackPermission', () => core.CanAttackResponse.CAN_ATTACK);
  const post = routes[TEAM.SARADOMIN].defenderPosts[0];
  const defender = actor(TEAM.SARADOMIN, [post[0], post[1], post[2]], 'defender');
  actor(TEAM.ZAMORAK, [post[0] - 1, post[1], post[2]], 'attacker');
  let toolsResult = 'running';
  let tools = 0;
  let attacks = 0;
  t.mock.method(game.practiceBots, 'defenderTools', () => { tools++; return toolsResult; });
  t.mock.method(game.practiceBots, 'defenderAttack', () => { attacks++; return 'running'; });
  Bots._test.processBot(defender);
  assert.ok(tools >= 1, 'the defender tools get the first action');
  assert.equal(attacks, 0, 'combat does not pre-empt placement/lighting');
  toolsResult = 'failure';
  Bots._test.processBot(defender);
  assert.ok(attacks >= 1, 'combat follows once the tools have nothing to do');
});


function nativePracticeGame(t) {
  const setup = nativeBotGame(t);
  const { game, registry } = setup;
  require('../plugins/minigames/castlewars/Barricades.CastleWars')(registry, game);
  require('../plugins/objects/Doors.plugin').register(registry);
  require('../plugins/minigames/castlewars/Navigation.CastleWars')({
    ...registry, getTaskManager: () => core.TaskManager, onServerStartup: (fn) => fn(),
  }, game);
  const oldNpcs = new Set(core.World.getNpcs());
  t.after(() => {
    for (const npc of [...core.World.getNpcs()]) {
      if (oldNpcs.has(npc)) continue;
      game.releaseBarricade(npc);
      core.World.getNpcs().remove(npc);
    }
    for (const team of Object.values(TEAM)) game.restoreFlagToBase(team);
  });
  for (const team of Object.values(TEAM)) game.restoreFlagToBase(team);
  return setup;
}

for (const team of Object.values(TEAM)) {
  test(`a ${team} scorer clears a native barricade and completes two full flag runs`, (t) => {
    const { game, actor, turns } = nativePracticeGame(t);
    const start = game.getTeamData(team).startRoom;
    const player = actor(team, [start.getX(), start.getY(), start.getZ()]);
    player.setAttribute(game.BOT_TIER_KEY, 'veteran');
    player.setAttribute(game.PRACTICE_MAXED_KEY, true);
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    let deployed = null, reactedAt = null, clearedAt = null;
    const tools = game.practiceBots.scorerTools;
    t.mock.method(game.practiceBots, 'scorerTools', (ctx, state) => {
      const result = tools(ctx, state);
      if (state.pendingClear && reactedAt === null) reactedAt = now;
      return result;
    });
    for (let tick = 0; tick < 1500 && game.score[team] < 2; tick++) {
      now += 600;
      if (!deployed && game.isInsideCastle(player, game.opposingTeam(team))) {
        const next = player.getMovementQueue().pointsReturn()
          .find((point) => !point.position.equals(player.getLocation()))?.position;
        const distance = next && Math.abs(next.getX() - player.getLocation().getX())
          + Math.abs(next.getY() - player.getLocation().getY());
        if (distance === 1 && !Object.values(TEAM_DATA).some((data) => data.respawnBounds.inside(next))) {
          const owner = actor(team, [next.getX(), next.getY(), next.getZ()], 'defender');
          owner.getInventory().adds(core.ItemIdentifiers.BARRICADE, 1);
          const before = new Set(core.World.getNpcs());
          core.PluginManager.emitItemAction({
            player: owner, itemId: core.ItemIdentifiers.BARRICADE,
            item: owner.getInventory().getItems()[0], slot: 0, interfaceId: 0,
            clickType: 1, option: 'Set-up', handled: false,
          });
          deployed = [...core.World.getNpcs()].find((npc) => !before.has(npc) && game.isBarricade(npc)) ?? null;
        }
      }
      Bots._test.processBot(player);
      turns(player, 1);
      player.setNeedsPlacement(false);
      if (deployed && !game.isBarricade(deployed) && clearedAt === null) clearedAt = now;
    }
    assert.ok(game.score[team] >= 2, `two full capture/return cycles; stopped at ${player.getLocation()}`);
    assert.ok(deployed && clearedAt !== null, 'a native blocking barricade was placed and cleared');
    assert.ok(reactedAt !== null && clearedAt - reactedAt >= 1200, 'clearing respects the reaction delay');
  });

  test(`a lone ${team} defender leaves spawn, places barricades, patrols every floor and descends again`, (t) => {
    const { game, actor, turns } = nativePracticeGame(t);
    const start = game.getTeamData(team).startRoom;
    const player = actor(team, [start.getX(), start.getY(), start.getZ()], 'defender');
    player.setAttribute(game.BOT_TIER_KEY, 'veteran');
    player.setAttribute(game.PRACTICE_MAXED_KEY, true);
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    const floors = new Set();
    let reachedFlag = false, descended = false;
    for (let tick = 0; tick < 1500 && !descended; tick++) {
      now += 600;
      Bots._test.processBot(player);
      turns(player, 1);
      player.setNeedsPlacement(false);
      const z = player.getLocation().getZ();
      floors.add(z);
      if (z === 3) reachedFlag = true;
      if (reachedFlag && z === 0) descended = true;
    }
    assert.deepEqual([...floors].sort(), [0, 1, 2, 3]);
    assert.ok(descended, `descends from the flag floor; stopped at ${player.getLocation()}`);
    assert.ok([...core.World.getNpcs()].some((npc) => game.isBarricade(npc)), 'places real barricades');
  });
}


test('practice combat yields to leaving spawn and to native attack refusals', (t) => {
  const { game, actor } = nativeBotGame(t);
  const team = TEAM.SARADOMIN;
  const start = game.getTeamData(team).startRoom;
  const defender = actor(team, [start.getX(), start.getY(), start.getZ()], 'defender');
  const scorer = actor(team, [start.getX(), start.getY(), start.getZ()], 'scorer');
  actor(TEAM.ZAMORAK, [2426, 3081, 1]);
  const attack = t.mock.method(game.practiceBots, 'defenderAttack', () => 'running');
  assert.equal(Bots._test.defenderAttackAction({ player: defender }, {}, team), 'failure');
  assert.equal(Bots._test.scorerCombat({ player: scorer, nowMs: 1000 }, {}, team), 'failure');
  defender.setLocation(new Location(2426, 3082, 1));
  t.mock.method(core.CombatFactory, 'canAttackPermission', () => core.CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.equal(Bots._test.defenderAttackAction({ player: defender }, {}, team), 'failure');
  assert.equal(attack.mock.callCount(), 0);
});

test('defender combat leaves a gap for patrols even while an intruder remains nearby', (t) => {
  const { game, actor } = nativeBotGame(t);
  const player = actor(TEAM.SARADOMIN, [2425, 3082, 1], 'defender');
  actor(TEAM.ZAMORAK, [2424, 3082, 1]);
  t.mock.method(core.CombatFactory, 'canAttackPermission', () => core.CanAttackResponse.CAN_ATTACK);
  const attack = t.mock.method(game.practiceBots, 'defenderAttack', () => 'running');
  const state = {};
  assert.equal(Bots._test.defenderAttackAction({ player, nowMs: 1000 }, state, TEAM.SARADOMIN), 'running');
  assert.equal(Bots._test.defenderAttackAction({ player, nowMs: 3600 }, state, TEAM.SARADOMIN), 'failure');
  assert.equal(Bots._test.defenderAttackAction({ player, nowMs: 6000 }, state, TEAM.SARADOMIN), 'failure');
  assert.equal(Bots._test.defenderAttackAction({ player, nowMs: 7000 }, state, TEAM.SARADOMIN), 'running');
  assert.equal(attack.mock.callCount(), 2);
});

test('floor recovery includes door stands and stepping-stone approaches', () => {
  const door = { type: 'door', stand: [10, 10, 0], z: 0 };
  const stones = { type: 'stones', ends: [[10, 10, 0], [20, 20, 0]], z: 0 };
  const walk = { type: 'walk', x: 100, y: 100, z: 0 };
  for (const step of [door, stones]) {
    assert.equal(Bots._test.firstStepOnFloor([step, walk], 0, 0, new Location(10, 11, 0)), 0);
  }
});

test('native corner barricades are cleared when all diagonal movement fallbacks are occupied', (t) => {
  const { game, actor } = nativePracticeGame(t);
  const player = actor(TEAM.SARADOMIN, [2406, 3110, 0]);
  const origin = player.getLocation().clone();
  for (const at of [[2405, 3110, 0], [2406, 3111, 0]]) {
    const owner = actor(TEAM.SARADOMIN, at, 'defender');
    owner.getInventory().adds(core.ItemIdentifiers.BARRICADE, 1);
    core.PluginManager.emitItemAction({ player: owner, itemId: core.ItemIdentifiers.BARRICADE,
      item: owner.getInventory().getItems()[0], slot: 0, interfaceId: 0, clickType: 1, option: 'Set-up', handled: false });
  }
  const movement = player.getMovementQueue();
  assert.equal(movement.canWalk(-1, 1), true, 'static map clipping is open');
  assert.equal(movement.canWalkTo(origin.transform(-1, 1)), false, 'native NPC collision blocks the diagonal');
  movement.addCheckpoint(new Location(2404, 3112, 0));
  const state = { practiceGoal: [2404, 3112, 0] };
  assert.equal(game.practiceBots.scorerTools({ player, nowMs: 0 }, state), 'running');
  assert.ok(state.pendingClear, 'the corner obstruction is recognized without mocking collision');
  assert.equal(game.practiceBots.scorerTools({ player, nowMs: 1200 }, state), 'running');
  movement.process();
  assert.equal(player.getLocation().equals(origin), false, 'clearing one corner permits forward movement');
});

test('a defender on an adjacent post does not repeatedly reset another defender route', (t) => {
  const { actor } = nativeBotGame(t);
  const posts = routes[TEAM.ZAMORAK].defenderPosts;
  const player = actor(TEAM.ZAMORAK, [2378, 3126, 1], 'defender');
  actor(TEAM.ZAMORAK, posts[4], 'defender');
  const state = { role: 'defender', defenderPostIndex: 3, nextWalkAt: 0, nextClimbAt: 0 };
  assert.equal(Bots._test.defenderPostCrowded(player, TEAM.ZAMORAK, posts[3]), false);
  Bots._test.defenderPatrol({ player, nowMs: 1000 }, state, TEAM.ZAMORAK);
  const route = state.route;
  Bots._test.defenderPatrol({ player, nowMs: 1600 }, state, TEAM.ZAMORAK);
  assert.equal(state.route, route, 'the chosen route is retained while travelling');
});

test('a thirty-defender native patrol leaves spawn and places barricades across multiple floors', (t) => {
  const { game, actor } = nativePracticeGame(t);
  const team = TEAM.SARADOMIN;
  const start = game.getTeamData(team).startRoom;
  const players = Array.from({ length: 30 }, () => {
    const player = actor(team, [start.getX(), start.getY(), start.getZ()], 'defender');
    player.setAttribute(game.BOT_TIER_KEY, 'veteran');
    player.setAttribute(game.PRACTICE_MAXED_KEY, true);
    return player;
  });
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  for (let tick = 0; tick < 250; tick++) {
    now += 600;
    for (const player of players) Bots._test.processBot(player);
    core.TaskManager.process();
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
      player.setNeedsPlacement(false);
    }
  }
  const outside = players.filter((player) => !game.getTeamData(team).respawnBounds.inside(player.getLocation()));
  assert.ok(outside.length >= 25, `${outside.length}/30 defenders left spawn`);
  assert.ok(new Set(outside.map((player) => player.getLocation().getZ())).size >= 3, `patrols remain spread across floors: ${outside.map((player) => player.getLocation().getZ()).join(',')}`);
  assert.ok(game.teamBarricadeCount(team) >= 5, `several real choke points are barricaded: ${game.teamBarricadeCount(team)}`);
});

test('a dead practice bot re-equips on its first respawn tick, without waiting for the old retry timer', (t) => {
  const { game, actor } = nativePracticeGame(t);
  const team = TEAM.SARADOMIN;
  const player = actor(team, [2425, 3082, 1]);
  player.setAttribute(game.BOT_TIER_KEY, 'veteran');
  player.setAttribute(game.PRACTICE_MAXED_KEY, true);
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  for (let tick = 0; tick < 5; tick++) { now += 600; Bots._test.processBot(player); }
  assert.equal(player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.ZARYTE_CROSSBOW);
  player.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
  Bots._test.processBot(player);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  player.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 99);
  player.moveTo(game.getTeamData(team).startRoom);
  now += 600;
  Bots._test.processBot(player);
  assert.equal(player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.ZARYTE_CROSSBOW);
  assert.equal(player.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD);
});

for (const team of Object.values(TEAM)) {
  test(`a ${team} flag carrier opens a closed enemy door from inside and scores`, (t) => {
    const { game, registry, actor, turns } = nativePracticeGame(t);
    const enemy = game.opposingTeam(team);
    const at = team === TEAM.SARADOMIN ? [2372, 3120, 0] : [2426, 3087, 0];
    core.RegionManager.loadMapFiles(at[0], at[1]);
    const player = actor(team, at);
    const open = routes[enemy].doorman.open
      .map(([id, x, y, z]) => core.MapObjects.get(id, new Location(x, y, z), null)).find(Boolean);
    if (open) {
      const location = open.getLocation();
      registry.emitObjectInteraction({ player, object: open, objectId: open.getId(), clickType: 1,
        location: { x: location.getX(), y: location.getY(), z: location.getZ() },
        sourceLocation: { x: at[0], y: at[1], z: at[2] }, handled: false });
    }
    assert.ok(routes[team].door.leaves.some(([id, x, y, z]) => core.MapObjects.get(id, new Location(x, y, z), null)), 'enemy door starts closed');
    game.carryFlag(player, enemy);
    const state = { role: 'scorer', flagMode: 'home', route: null, cursor: 0, nextWalkAt: 0, nextClimbAt: 0, nextStandClickAt: 0 };
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    for (let tick = 0; tick < 600 && game.score[team] === 0; tick++) {
      now += 600;
      Bots._test.flagCycle({ player, nowMs: now }, state, team);
      turns(player, 1);
      player.setNeedsPlacement(false);
    }
    assert.equal(game.score[team], 1, `carrier stopped at ${player.getLocation()}`);
    player.moveTo(new Location(...(team === TEAM.SARADOMIN ? [2425, 3082, 1] : [2375, 3125, 1])));
    assert.deepEqual(Bots._test.homeRouteFor(player, team), routes[team].carryInside, 'own-castle recovery goes upstairs instead of back outside');
  });
}
