// Run after yarn build: node --test tests/castlewars-navigation.test.cjs
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const core = PluginManager.getCoreApi();
const createGame = require('../plugins/minigames/castlewars/Game.CastleWars');
const attachFlags = require('../plugins/minigames/castlewars/Flags.CastleWars');
const attachDoors = require('../plugins/minigames/castlewars/Doors.CastleWars');
const attachNavigation = require('../plugins/minigames/castlewars/Navigation.CastleWars');
const attachAreas = require('../plugins/minigames/castlewars/Areas.CastleWars');
let playerOption;
let namedInteractions;
let game, registry, objectHandler, routeHandlers, customHandlers, startup, equip, unequip;

before(() => {
  CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

beforeEach(() => {
  namedInteractions = new Map();
  routeHandlers = []; customHandlers = new Map(); startup = [];
  registry = {
    core,
    getAreaManager: () => ({ areas: [] }), getBonusManager: () => ({ update() {} }),
    getObjectManager: () => ({ register() {}, deregister() {} }),
    getRegionManager: () => core.RegionManager, getWorld: () => core.World,
    getTaskManager: () => ({ submit() {}, cancelTasks() {} }),
    onObjectInteraction: (...args) => { if (args.length === 1) objectHandler = args[0]; else namedInteractions.set(args[0], args[1]); },
    onPlayerOption: handler => { playerOption = handler; },
    onCanEquip: handler => { equip = handler; }, onCanUnequip: handler => { unequip = handler; },
    onObjectRoute: handler => routeHandlers.push(handler),
    onCustomEvent: (name, handler) => customHandlers.set(name, handler),
    onServerStartup: handler => startup.push(handler),
    emitCustomEvent() {},
  };
  game = createGame(registry);
  game.isPlaying = () => true;
  game.gameArea = {};
  game.inGameProcessors = [];
  attachFlags(registry, game);
});

function player(team = game.TEAM.SARADOMIN, at = [2400, 3100, 0]) {
  const p = new Player(null, new core.Location(...at));
  p.setUsername(`cw_nav_${team}`);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.messages = [];
  p.sendMessage = message => p.messages.push(message);
  p.getArea = () => game.gameArea;
  game.setTeamId(p, team);
  return p;
}

function clickFlag(p, team, dropped = false) {
  const td = game.getTeamData(team);
  const object = dropped ? game.getDroppedFlagObject(team) :
    new core.GameObject(td.safeStandId, td.standLocation, td.standType, 0, null);
  const event = { player: p, object, handled: false };
  objectHandler(event);
  assert.equal(event.handled, true);
}

test('taking a flag stows both hands atomically, preserves item metadata and clears a queued spell', () => {
  const p = player();
  const weapon = new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1, { charges: 70 });
  const shield = new core.Item(core.ItemIdentifiers.RUNE_KITESHIELD, 1);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, weapon);
  p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, shield);
  p.getCombat().setCastSpell({});
  clickFlag(p, game.TEAM.ZAMORAK);
  assert.equal(game.getCarriedFlagTeam(p), game.TEAM.ZAMORAK);
  assert.equal(p.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), -1);
  assert.deepEqual(p.getInventory().getItems()[0], weapon);
  assert.deepEqual(p.getInventory().getItems()[1], shield);
  assert.equal(p.getCombat().getCastSpell(), null);
  assert.equal(CombatFactory.getMethod(p), CombatFactory.MELEE_COMBAT);
  assert.equal(CombatFactory.getMethod(p).attackDistance(p), 1);
  assert.equal(p.getAttackAnim(), 1428, 'cache human_banner_spike');
});

test('insufficient room leaves both hands and the standard unchanged', () => {
  const p = player();
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1));
  p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.RUNE_KITESHIELD, 1));
  for (let i = 0; i < 27; i++) p.getInventory().setItem(i, new core.Item(core.ItemIdentifiers.BANDAGES, 1));
  clickFlag(p, game.TEAM.ZAMORAK);
  assert.equal(game.flagStatus[game.TEAM.ZAMORAK], 0);
  assert.equal(p.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.RUNE_SCIMITAR);
  assert.equal(p.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), core.ItemIdentifiers.RUNE_KITESHIELD);
  assert.match(p.messages.at(-1), /two free inventory spaces/);
  p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(-1, 0));
  p.getInventory().setItem(27, new core.Item(core.ItemIdentifiers.BANDAGES, 1));
  clickFlag(p, game.TEAM.ZAMORAK);
  assert.match(p.messages.at(-1), /one free inventory space/);
});

test('the own standard returns immediately inside either castle, including a tunnel landing', () => {
  for (const [team, outside, inside] of [
    [game.TEAM.SARADOMIN, [2426, 3088, 0], [2426, 3087, 0]],
    [game.TEAM.SARADOMIN, [2414, 3073, 0], [2415, 3073, 0]],
    [game.TEAM.SARADOMIN, [2430, 9482, 0], [2430, 3081, 0]],
    [game.TEAM.ZAMORAK, [2372, 3119, 0], [2372, 3120, 0]],
    [game.TEAM.ZAMORAK, [2385, 3134, 0], [2384, 3134, 0]],
    [game.TEAM.ZAMORAK, [2369, 9525, 0], [2369, 3126, 0]],
  ]) {
    const p = player(team, outside);
    game.carryFlag(p, team);
    game.inGameProcessors[0](p);
    assert.equal(game.flagStatus[team], 1);
    p.moveTo(new core.Location(...inside));
    game.inGameProcessors[0](p);
    assert.equal(game.flagStatus[team], 0);
    assert.equal(game.getCarriedFlagTeam(p), null);
    clickFlag(p, team);
    assert.match(p.messages.at(-1), /wants the other team's standard/);
  }
});

test('own standards dropped outside either main or side door can still be carried', () => {
  for (const [team, outside] of [
    [game.TEAM.SARADOMIN, [2426, 3088, 0]],
    [game.TEAM.SARADOMIN, [2414, 3073, 0]],
    [game.TEAM.ZAMORAK, [2372, 3119, 0]],
    [game.TEAM.ZAMORAK, [2385, 3134, 0]],
  ]) {
    const p = player(team, outside);
    game.carryFlag(p, team);
    game.dropCarriedFlag(p);
    clickFlag(p, team, true);
    game.inGameProcessors[0](p);
    assert.equal(game.getCarriedFlagTeam(p), team, `${team} flag remains outside at ${outside}`);
    assert.equal(game.flagStatus[team], 1);
    game.clearWeaponSlot(p);
    game.restoreFlagToBase(team);
  }
});

test('a defender can return their dropped standard while still holding the enemy standard', () => {
  const owner = player(game.TEAM.SARADOMIN, [2426, 3085, 0]);
  game.carryFlag(owner, game.TEAM.SARADOMIN);
  game.dropCarriedFlag(owner);
  const scorer = player(game.TEAM.SARADOMIN, [2426, 3085, 0]);
  game.carryFlag(scorer, game.TEAM.ZAMORAK);
  clickFlag(scorer, game.TEAM.SARADOMIN, true);
  assert.equal(game.flagStatus[game.TEAM.SARADOMIN], 0);
  assert.equal(game.getCarriedFlagTeam(scorer), game.TEAM.ZAMORAK);
});

test('own dropped standards return during the pickup action without a free hand or inventory slot', () => {
  for (const [team, at] of [[game.TEAM.SARADOMIN, [2426, 3087, 0]], [game.TEAM.ZAMORAK, [2372, 3120, 0]]]) {
    const owner = player(team, at);
    game.carryFlag(owner, team);
    game.dropCarriedFlag(owner);
    const defender = player(team, at);
    defender.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR));
    defender.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.RUNE_KITESHIELD));
    for (let slot = 0; slot < 28; slot++) defender.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.BANDAGES));
    clickFlag(defender, team, true);
    assert.equal(game.flagStatus[team], 0, 'the pickup action returns it before any game-area processor runs');
    assert.equal(game.getDroppedFlagObject(team), null);
    assert.equal(game.getCarriedFlagTeam(defender), null);
    assert.equal(defender.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), core.ItemIdentifiers.RUNE_SCIMITAR);
    assert.equal(defender.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), core.ItemIdentifiers.RUNE_KITESHIELD);
    assert.equal(defender.getInventory().getFreeSlots(), 0);
  }
});

const CATAPULT_TILES = [
  ['zamorak', [[2383, 3116], [2384, 3116], [2385, 3116], [2387, 3118], [2387, 3119]]],
  ['saradomin', [[2412, 3088], [2412, 3089], [2414, 3091], [2415, 3091], [2416, 3091]]],
];

test('issue 1961: only a carrier dropping their own standard safes it on catapult tiles', () => {
  for (const [, tiles] of CATAPULT_TILES) for (const [x, y] of tiles) {
    for (const team of Object.values(game.TEAM)) {
      for (const stripped of [false, true]) {
        const owner = player(team, [x, y, 0]);
        game.carryFlag(owner, team);
        if (stripped) owner.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
        game.dropCarriedFlag(owner);
        assert.equal(game.flagStatus[team], 0, `${team} own flag safes at ${x},${y}, stripped=${stripped}`);
        assert.equal(game.getDroppedFlagObject(team), null);
        assert.equal(game.getCarriedFlagTeam(owner), null);
      }
      const enemy = player(game.opposingTeam(team), [x, y, 0]);
      game.carryFlag(enemy, team);
      game.dropCarriedFlag(enemy);
      assert.equal(game.flagStatus[team], 2, `${team} enemy-carried flag drops at ${x},${y}`);
      assert.ok(game.getDroppedFlagObject(team).getLocation().equals(enemy.getLocation()));
      game.restoreFlagToBase(team);
    }
  }
});

test('issue 1961: catapult drops return to their base owner or can be retaken by an attacker', () => {
  for (const [baseTeam, tiles] of CATAPULT_TILES) for (const [x, y] of tiles) {
    for (const flagTeam of Object.values(game.TEAM)) {
      const attackerTeam = game.opposingTeam(flagTeam);
      const carrier = player(attackerTeam, [x, y, 0]);
      game.carryFlag(carrier, flagTeam);
      game.dropCarriedFlag(carrier);
      assert.equal(game.flagStatus[flagTeam], 2, 'a stolen flag stays dropped until pickup');
      const attacker = player(attackerTeam, [x, y, 0]);
      clickFlag(attacker, flagTeam, true);
      assert.equal(game.getCarriedFlagTeam(attacker), flagTeam, 'an attacker can keep the dropped standard');
      game.dropCarriedFlag(attacker);
      // Pickup is allowed from beside the drop; its tile decides which base owns the corner.
      const defender = player(flagTeam, [x + 1, y, 0]);
      if (flagTeam === baseTeam) {
        defender.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR));
        for (let slot = 0; slot < 28; slot++) defender.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.BANDAGES));
      }
      clickFlag(defender, flagTeam, true);
      assert.equal(game.flagStatus[flagTeam], flagTeam === baseTeam ? 0 : 1,
        'only the flag owner at their own catapult returns it; the other flag can still be held');
      assert.equal(game.getDroppedFlagObject(flagTeam), null);
      game.clearWeaponSlot(defender);
      game.restoreFlagToBase(flagTeam);
    }
  }
});

test('catapult flag returns do not extend to another plane or nearby deck tiles', () => {
  for (const at of [[2383, 3116, 1], [2412, 3088, 1], [2383, 3118, 0], [2413, 3087, 0]]) {
    const owner = player(game.TEAM.SARADOMIN, at);
    game.carryFlag(owner, game.TEAM.SARADOMIN);
    game.dropCarriedFlag(owner);
    assert.equal(game.flagStatus[game.TEAM.SARADOMIN], 2, `${at} leaves the standard dropped`);
    game.restoreFlagToBase(game.TEAM.SARADOMIN);
  }
});

test('dropping both standards on one tile returns the dropper own standard and keeps the enemy drop', () => {
  const sara = player();
  const zam = player(game.TEAM.ZAMORAK);
  game.carryFlag(sara, game.TEAM.ZAMORAK);
  game.carryFlag(zam, game.TEAM.SARADOMIN);
  game.dropCarriedFlag(sara);
  game.dropCarriedFlag(zam);
  assert.equal(game.flagStatus[game.TEAM.ZAMORAK], 0);
  assert.equal(game.getDroppedFlagObject(game.TEAM.ZAMORAK), null);
  assert.equal(game.flagStatus[game.TEAM.SARADOMIN], 2);
  assert.ok(game.getDroppedFlagObject(game.TEAM.SARADOMIN));
});

test('equipping a shield or removing a carried banner drops the flag rather than keeping both', () => {
  const p = player();
  game.carryFlag(p, game.TEAM.ZAMORAK);
  equip({ player: p, slot: core.Equipment.SHIELD_SLOT });
  assert.equal(game.getCarriedFlagTeam(p), null);
  assert.equal(game.flagStatus[game.TEAM.ZAMORAK], 2);
  game.carryFlag(p, game.TEAM.ZAMORAK);
  const event = { player: p, slot: core.Equipment.WEAPON_SLOT, allow: true };
  unequip(event);
  assert.equal(event.allow, false);
  assert.equal(game.getCarriedFlagTeam(p), null);
});

test('banners use the cache flag stance, walking, running and blocking sequences', () => {
  for (const id of [core.ItemIdentifiers.SARADOMIN_BANNER, core.ItemIdentifiers.ZAMORAK_BANNER]) {
    const item = ItemDefinition.forId(id);
    assert.equal(item.isDoubleHanded(), true);
    assert.deepEqual([item.getStandAnim(), item.getWalkAnim(), item.getRunAnim(), item.getBlockAnim()], [1421, 1422, 1427, 1429]);
  }
});

test('both open large and side doors route to the original threshold on the player side', () => {
  attachDoors(registry, game);
  for (const [team, id, at, source, expected] of [
    [game.TEAM.SARADOMIN, core.ObjectIdentifiers.LARGE_DOOR_26, [2426, 3087, 0], [2426, 3089, 0], [2426, 3088, 0]],
    [game.TEAM.ZAMORAK, core.ObjectIdentifiers.LARGE_DOOR_31, [2372, 3120, 0], [2372, 3118, 0], [2372, 3119, 0]],
    [game.TEAM.SARADOMIN, core.ObjectIdentifiers.DOOR_126, [2414, 3073, 0], [2416, 3073, 0], [2415, 3073, 0]],
    [game.TEAM.ZAMORAK, core.ObjectIdentifiers.DOOR_128, [2385, 3134, 0], [2383, 3134, 0], [2384, 3134, 0]],
  ]) {
    const p = player(team, source);
    const event = { player: p, objectId: id, object: new core.GameObject(id, new core.Location(...at), 0, 0, null),
      sourceLocation: { x: source[0], y: source[1], z: source[2] }, destination: null };
    routeHandlers.at(-1)(event);
    assert.deepEqual(event.destination, { x: expected[0], y: expected[1], z: expected[2] });
  }
});

test('both starting-room trapdoors intercept generic door handling and descend immediately', () => {
  attachNavigation(registry, game);
  for (const [team, id, from, to] of [
    [game.TEAM.SARADOMIN, core.ObjectIdentifiers.TRAPDOOR_16, [2429, 3074, 2], [2429, 3075, 1]],
    [game.TEAM.ZAMORAK, core.ObjectIdentifiers.TRAPDOOR_17, [2370, 3133, 2], [2370, 3132, 1]],
  ]) {
    const p = player(team, from);
    const event = { player: p, object: new core.GameObject(id, new core.Location(...from), 22, 0, null), handled: false };
    customHandlers.get('door:toggle')(event);
    assert.equal(event.handled, true);
    assert.ok(p.getLocation().equals(new core.Location(...to)));
  }
});

test('leaving either respawn room by ladder renews the idle allowance on return', (t) => {
  attachAreas({
    ...registry, registerArea() {}, onPlayerLogin() {}, onPlayerDeath() {}, onShouldDropItemsOnDeath() {},
  }, game);
  attachNavigation(registry, game);
  const ejected = [];
  t.mock.method(game, 'returnToLobby', p => ejected.push(p));
  for (const [team, ladder, trapdoor, at] of [
    [game.TEAM.SARADOMIN, core.ObjectIdentifiers.LADDER_63, core.ObjectIdentifiers.TRAPDOOR_16, [2429, 3074, 1]],
    [game.TEAM.ZAMORAK, core.ObjectIdentifiers.LADDER_64, core.ObjectIdentifiers.TRAPDOOR_17, [2370, 3133, 1]],
  ]) {
    const p = player(team, at);
    const texts = [];
    const previousEjections = ejected.length;
    t.mock.method(p.getPacketSender(), 'sendString', (text, uid) => texts.push([text, uid]));
    p.setAttribute(game.IDLE_TICKS_KEY, 8);
    game.gameArea.process(p);
    assert.equal(p.getAttribute(game.IDLE_TICKS_KEY), 7, 'idling still consumes the current allowance');

    const up = { player: p, object: new core.GameObject(ladder, new core.Location(...at), 10, 0, null), handled: false };
    customHandlers.get('ladders:climb')(up);
    assert.equal(up.handled, true);
    assert.equal(game.getTeamData(team).respawnBounds.inside(p.getLocation()), false);
    for (let tick = 0; tick < 8; tick++) game.gameArea.process(p);
    assert.equal(p.getAttribute(game.IDLE_TICKS_KEY), 200, 'time outside renews rather than pauses the allowance');
    assert.deepEqual(texts.at(-1), ['', game.data.EJECT_TEXT_UID[team]], 'the warning is hidden outside');
    assert.equal(ejected.length, previousEjections, 'time outside cannot eject the player');

    const down = { player: p, object: new core.GameObject(trapdoor, new core.Location(at[0], at[1], 2), 22, 0, null), handled: false };
    customHandlers.get('door:toggle')(down);
    assert.equal(down.handled, true);
    assert.equal(game.getTeamData(team).respawnBounds.inside(p.getLocation()), true);
    game.gameArea.process(p);
    assert.deepEqual(texts.at(-1), ['You have 02:00 to leave the respawn room.', game.data.EJECT_TEXT_UID[team]]);
    for (let tick = 0; tick < 198; tick++) game.gameArea.process(p);
    assert.equal(p.getAttribute(game.IDLE_TICKS_KEY), 1);
    assert.equal(ejected.length, previousEjections, 'a returned player receives the full two-minute allowance');
    game.gameArea.process(p);
    assert.equal(ejected.at(-1), p, 'uninterrupted idling still ejects at the deadline');
    assert.equal(p.messages.at(-1), 'You idled too long in the respawn room.');
  }
});

test('staircase battlements block the gaps while both castles retain their climb routes', (t) => {
  core.RegionManager.init();
  attachNavigation(registry, game);
  const objectAt = (x, y, type = 0) => core.MapObjects.getType(new core.Location(x, y, 1), type, null);
  const stairWalls = [];
  for (const [x, y] of [[2380, 3127], [2419, 3080]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let shape = 0; shape <= 3; shape++) {
      const object = objectAt(x + dx, y + dy, shape);
      if (object) stairWalls.push(object);
    }
  }
  assert.ok(stairWalls.length > 0, 'the actual cache supplies the stair enclosures');
  const removed = [];
  const deregister = core.ObjectManager.deregister.bind(core.ObjectManager);
  t.mock.method(core.ObjectManager, 'deregister', (object, update) => { removed.push(object); return deregister(object, update); });
  startup.at(-1)();
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const finder = new RsmodRouteFinding(core.RegionManager.getClipping.bind(core.RegionManager));
  for (const [team, inside, gap, up, down, upperLanding, lowerLanding] of [
    [game.TEAM.ZAMORAK, [2378, 3130, 1], [2380, 3123], [4418, 2380, 3127, 0], [4415, 2380, 3127, 1], [2379, 3127, 1], [2380, 3130, 0]],
    [game.TEAM.SARADOMIN, [2421, 3077, 1], [2419, 3084], [4417, 2419, 3078, 0], [4415, 2419, 3080, 1], [2420, 3080, 1], [2419, 3077, 0]],
  ]) {
    assert.equal(finder.findRoute({ level: 1, srcX: inside[0], srcY: inside[1], srcSize: 1,
      destX: gap[0], destY: gap[1], privateArea: null, moveNear: false }).success, false, 'the cache perimeter blocks walking into the empty space');
    assert.equal(finder.findRoute({ level: 1, srcX: upperLanding[0], srcY: upperLanding[1], srcSize: 1,
      destX: inside[0], destY: inside[1], privateArea: null, moveNear: false }).success, true, 'the upstairs landing remains connected to the castle');
    for (const [at, source, destination] of [[up, lowerLanding, upperLanding], [down, inside, lowerLanding]]) for (const bot of [false, true]) {
      const object = core.MapObjects.get(at[0], new core.Location(...at.slice(1)), null);
      assert.ok(object, 'the cache staircase remains');
      const definition = object.getDefinition(), p = player(team, source);
      t.mock.method(p, 'isPlayerBot', () => bot);
      core.PathFinder.calculateObjectRoute(p, object.getType() + 1, at[1], at[2], definition.getSizeX(), definition.getSizeY(), object.getFace(), definition.getBlockingMask());
      const approach = p.getMovementQueue().getDestination() ?? p.getLocation();
      p.moveTo(approach);
      assert.equal(core.PathFinder.reachedObject(p, at[1], at[2], definition.getSizeX(), definition.getSizeY(), object.getFace(), object.getType(), definition.getBlockingMask()), true,
        `the native ${bot ? 'bot' : 'player'} route reaches the intended stair face`);
      const event = { player: p, object, handled: false };
      customHandlers.get('ladders:climb')(event);
      assert.equal(event.handled, true);
      assert.ok(p.getLocation().equals(new core.Location(...destination)), 'climbing retains the existing landing');
    }
  }
  for (const wall of stairWalls) assert.equal(core.MapObjects.get(wall.getId(), wall.getLocation(), null), wall, 'retain the cache wall geometry and collision');
  assert.equal(removed.length, 4, 'only the separate inner-ladder rails are removed');
});

test('standards cannot enter either respawn room through barriers or fixed climbs', () => {
  attachNavigation(registry, game);
  for (const [team, barrierId, from, to] of [
    [game.TEAM.ZAMORAK, core.ObjectIdentifiers.ENERGY_BARRIER_2, [2373, 3126, 1], [2373, 3127, 1]],
    [game.TEAM.SARADOMIN, core.ObjectIdentifiers.ENERGY_BARRIER, [2422, 3076, 1], [2423, 3076, 1]],
  ]) {
    const p = player(team, from);
    game.carryFlag(p, game.opposingTeam(team));
    assert.equal(game.canEnterRespawn(p, new core.Location(...to)), false);
    game.climbTo(p, to);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], from);
    const object = new core.GameObject(barrierId, new core.Location(...to), 0, 0, null);
    objectHandler({ player: p, object, handled: false });
    assert.match(p.messages.at(-1), /standard.*respawn/);
    assert.equal(game.canEnterRespawn(p, new core.Location(...from)), true, 'outside destinations stay usable');
    game.restoreFlagToBase(game.opposingTeam(team));
    game.clearWeaponSlot(p);
    assert.equal(game.canEnterRespawn(p, new core.Location(...to)), true);
  }
});

test('Take-from transfers only an adjacent teammate enemy standard after three minutes and resets the timer', (t) => {
  t.mock.method(core.RegionManager, 'canMovestart', () => true);
  const carrier = player(), taker = player(game.TEAM.SARADOMIN, [2401, 3100, 0]);
  game.carryFlag(carrier, game.TEAM.ZAMORAK);
  const take = () => playerOption({ player: taker, target: carrier, option: game.data.TAKE_FROM_OPTION_SLOT });
  take();
  assert.equal(game.getCarriedFlagTeam(carrier), game.TEAM.ZAMORAK);
  game.flagHeldSince.set(carrier, Date.now() - 180001);
  taker.setLocation(new core.Location(2402, 3100, 0)); take();
  assert.equal(game.getCarriedFlagTeam(carrier), game.TEAM.ZAMORAK, 'distance is checked server-side');
  taker.setLocation(new core.Location(2401, 3100, 0)); take();
  assert.equal(game.getCarriedFlagTeam(carrier), null);
  assert.equal(game.getCarriedFlagTeam(taker), game.TEAM.ZAMORAK);
  assert.ok(Date.now() - game.flagHeldSince.get(taker) < 1000);
});

test('repeated stale side-door clicks cannot overwrite its closed leaf and a new match can reopen it', () => {
  game.requirePlaying = () => true;
  attachDoors(registry, game);
  const swaps = []; game.swapObject = (...args) => swaps.push(args);
  const p = player(game.TEAM.SARADOMIN, [2416, 3073, 0]);
  const object = new core.GameObject(core.ObjectIdentifiers.DOOR_125, new core.Location(2415, 3073, 0), 0, 0, null);
  const event = { player: p, object, objectId: object.getId() };
  namedInteractions.get('Door').Unlock(event);
  namedInteractions.get('Door').Unlock(event);
  assert.equal(swaps.length, 1);
  customHandlers.get('castlewars:reset')({});
  namedInteractions.get('Door').Unlock(event);
  assert.equal(swaps.length, 2, 'reset forgets the previous game open-door state');
});

test('the house Kick route leaves option 7 available outside a house', () => {
  const api = PluginManager.createApi('CastleWarsHouseOptionTest');
  const hooks = new Map();
  const stub = new Proxy({ core, persistAttribute() {}, onCustomEvent: (name, fn) => hooks.set(name, fn),
    getPluginConfig: (_key, fallback) => fallback }, { get: (target, name) => name in target ? target[name] : () => {} });
  require('../plugins/skills/construction/Core.Construction').init(stub);
  require('../plugins/skills/construction/House.Construction').attach(stub);
  const route = { player: player(), target: player(), option: 7, handled: false };
  hooks.get('player:option-route')(route);
  assert.equal(route.handled, false, 'Castle Wars Take-from reaches its normal player-option handler');
});
