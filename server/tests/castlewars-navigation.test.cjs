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
let game, registry, objectHandler, routeHandlers, customHandlers, startup, equip, unequip;

before(() => {
  CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

beforeEach(() => {
  routeHandlers = []; customHandlers = new Map(); startup = [];
  registry = {
    core,
    getAreaManager: () => ({ areas: [] }), getBonusManager: () => ({ update() {} }),
    getObjectManager: () => ({ register() {}, deregister() {} }),
    getRegionManager: () => core.RegionManager, getWorld: () => core.World,
    getTaskManager: () => ({ submit() {}, cancelTasks() {} }),
    onObjectInteraction: (...args) => { if (args.length === 1) objectHandler = args[0]; },
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
  const object = new core.GameObject(dropped ? td.droppedFlagObjectId : td.safeStandId,
    td.standLocation, dropped ? 10 : td.standType, 0, null);
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

test('only the requested staircase and inner-ladder rails are removed', (t) => {
  core.RegionManager.init();
  attachNavigation(registry, game);
  const objectAt = (x, y, type = 0) => core.MapObjects.getType(new core.Location(x, y, 1), type, null);
  const outer = objectAt(2419, 3072);
  const removed = [];
  t.mock.method(core.ObjectManager, 'deregister', object => removed.push(object));
  startup.at(-1)();
  assert.equal(removed.length, 14);
  assert.ok(removed.every(object => object.getLocation().getZ() === 1 && object.getType() <= 3));
  assert.ok(removed.some(object => object.getLocation().equals(new core.Location(2419, 3080, 1))));
  assert.ok(removed.some(object => object.getLocation().equals(new core.Location(2380, 3127, 1))));
  assert.ok(!removed.includes(outer), 'the outer castle wall remains');
});
