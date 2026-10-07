// Run after `yarn build`: node --test tests/castlewars.test.cjs
const assert = require('node:assert/strict');
const { test, before, afterEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { World } = require('../dist/game/World');

const core = PluginManager.getCoreApi();
const data = require('../plugins/minigames/castlewars/Data.CastleWars')(core);
const Game = require('../plugins/minigames/castlewars/Game.CastleWars');
const Lobby = require('../plugins/minigames/castlewars/Lobby.CastleWars');
const Areas = require('../plugins/minigames/castlewars/Areas.CastleWars');
const { TEAM } = data;

let game;
let objectHandler;
let botLogins = 0;

const registry = {
  core,
  getAreaManager: () => ({ areas: [] }),
  getBonusManager: () => ({}),
  getObjectManager: () => ({ register: () => {}, deregister: () => {}, existsLocation: () => false }),
  getRegionManager: () => RegionManager,
  getTaskManager: () => ({ submit: () => {}, cancelTasks: () => {} }),
  getWorld: () => World,
  getPluginConfig: (key, fallback) => PluginManager.getPluginConfig(key, fallback),
  emitPlayerLogin: () => { botLogins += 1; },
  onObjectInteraction: (handler) => { objectHandler = handler; },
  onNpcInteraction: () => {},
};

function fakeArea(players = []) {
  return { players, getPlayers: () => players };
}

function fakePlayer({ head = -1, cape = -1, inventory = [], bot = false } = {}) {
  const attributes = new Map();
  const state = {
    messages: [], moves: [], logouts: 0,
    getEquipment: () => ({
      getSlot: (slot) => (slot === core.Equipment.HEAD_SLOT ? head : slot === core.Equipment.CAPE_SLOT ? cape : -1),
    }),
    getInventory: () => ({ containsAny: (ids) => inventory.some((id) => ids.includes(id)) }),
    sendMessage: (message) => state.messages.push(message),
    smartMove: (location) => state.moves.push(location),
    isPlayerBot: () => bot,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getForcedLogoutTimer: () => ({ start: () => { state.logouts += 1; } }),
    requestLogout: () => {},
  };
  if (bot) attributes.set(game.BOT_KEY, true);
  return state;
}

function lobbyObject(id) {
  return { getId: () => id, getLocation: () => new core.Location(2440, 3089, 0) };
}

function enterPortal(player, portalId) {
  objectHandler({ player, object: lobbyObject(portalId), clickType: 1, handled: false });
}

function mapObject(id) {
  for (const list of MapObjects.mapObjects.values()) {
    for (const object of list) if (object.getId() === id) return object;
  }
  return null;
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  RegionManager.loadMapFiles(2436, 3089);
  RegionManager.loadMapFiles(2381, 9489);
  RegionManager.loadMapFiles(2429, 3074);
  game = Game(registry);
  game.lobbyArea = fakeArea();
  game.waitingAreas = { [TEAM.SARADOMIN]: fakeArea(), [TEAM.ZAMORAK]: fakeArea() };
  game.gameArea = fakeArea();
  Lobby(registry, game);
});

afterEach(() => {
  PluginManager.pluginConfigCache = {};
  World.getAddPlayerQueue().splice(0);
  for (const area of Object.values(game.waitingAreas)) area.players.length = 0;
  game.lobbyArea.players.length = 0;
});

test('every lobby, waiting-room and game portal matches its cache object and bounds', () => {
  for (const [id, team] of Object.entries(data.LOBBY_TEAMS)) {
    const object = mapObject(Number(id));
    assert.ok(object, `lobby portal ${id} exists on the map`);
    assert.equal(CacheDefinitions.getObject(Number(id)).actions[0], 'Enter', `lobby portal ${id} offers Enter`);
    assert.ok(
      data.LOBBY_BOUNDS.some((bounds) => bounds.inside(object.getLocation())),
      `lobby portal ${id} sits inside the lobby bounds`
    );
    assert.ok(team === null || data.TEAM_DATA[team], `lobby portal ${id} maps to a real team`);
  }
  for (const id of data.WAITING_EXIT_IDS) {
    const object = mapObject(id);
    assert.ok(object, `waiting exit ${id} exists on the map`);
    assert.equal(CacheDefinitions.getObject(id).actions[0], 'Exit', `waiting exit ${id} offers Exit`);
    assert.ok(
      Object.values(data.TEAM_DATA).some((team) => team.waitingBounds.some((bounds) => bounds.inside(object.getLocation()))),
      `waiting exit ${id} sits inside a waiting room`
    );
  }
  for (const id of data.GAME_EXIT_IDS) {
    const object = mapObject(id);
    assert.ok(object, `game exit ${id} exists on the map`);
    assert.equal(CacheDefinitions.getObject(id).actions[0], 'Leave', `game exit ${id} offers Leave`);
    assert.ok(
      Object.values(data.TEAM_DATA).some((team) => team.respawnBounds.inside(object.getLocation())),
      `game exit ${id} sits inside a respawn room`
    );
  }
});

test('Guthix sends a joiner to the smaller team', () => {
  game.waitingAreas[TEAM.SARADOMIN].players.push(fakePlayer());
  const player = fakePlayer();
  enterPortal(player, core.ObjectIdentifiers.GUTHIX_PORTAL);
  assert.equal(game.getTeamId(player), TEAM.ZAMORAK);
  assert.equal(player.moves.length, 1);
  assert.equal(player.moves[0].getY(), data.TEAM_DATA[TEAM.ZAMORAK].waitingRoom.getY());
});

test('a joiner cannot enter the bigger team', () => {
  game.waitingAreas[TEAM.SARADOMIN].players.push(fakePlayer(), fakePlayer());
  game.waitingAreas[TEAM.ZAMORAK].players.push(fakePlayer());
  const player = fakePlayer();
  enterPortal(player, core.ObjectIdentifiers.SARADOMIN_PORTAL);
  assert.equal(game.getTeamId(player), null);
  assert.equal(player.moves.length, 0);
  assert.deepEqual(player.messages, ['The Saradomin team is full, try Zamorak.']);
});

test('headwear and capes block entry before the teleport', () => {
  const player = fakePlayer({ head: core.ItemIdentifiers.CASTLEWARS_HOOD });
  enterPortal(player, core.ObjectIdentifiers.GUTHIX_PORTAL);
  assert.equal(game.getTeamId(player), null);
  assert.equal(player.moves.length, 0);
  assert.deepEqual(player.messages, ["You can't wear hats, capes, or helms in Castle Wars."]);
});

test('food carried in the inventory blocks entry', () => {
  const player = fakePlayer({ inventory: [Lobby._test.FOOD_ITEM_IDS[0]] });
  enterPortal(player, core.ObjectIdentifiers.GUTHIX_PORTAL);
  assert.equal(game.getTeamId(player), null);
  assert.equal(player.moves.length, 0);
  assert.deepEqual(player.messages, ['You may not bring your own consumables inside Castle Wars.']);
});

test('the bot seeding gate is off unless the world config turns it on', () => {
  assert.equal(Lobby._test.seedsBots(), false);
  const player = fakePlayer();
  const loginsBefore = botLogins;
  enterPortal(player, core.ObjectIdentifiers.GUTHIX_PORTAL);
  assert.equal(World.getAddPlayerQueue().length, 0, 'no bots seeded by default');
  assert.equal(botLogins, loginsBefore, 'no bot was logged in');

  PluginManager.pluginConfigCache = { [Lobby._test.SEED_BOTS_CONFIG_KEY]: true };
  assert.equal(Lobby._test.seedsBots(), true);
  const second = fakePlayer();
  enterPortal(second, core.ObjectIdentifiers.GUTHIX_PORTAL);
  const seeded = World.getAddPlayerQueue();
  assert.equal(seeded.length, 3, 'a configured development world seeds three bots');
  assert.equal(botLogins - loginsBefore, 3, 'each seeded bot logged in');
  assert.equal(seeded.filter((bot) => game.getTeamId(bot) === game.getTeamId(second)).length, 1);
  assert.equal(seeded.filter((bot) => game.getTeamId(bot) === game.opposingTeam(game.getTeamId(second))).length, 2);
});

test('seeded bots log out once no real player is left', () => {
  const real = fakePlayer();
  const bot = fakePlayer({ bot: true });
  game.lobbyArea.players.push(real);
  game.waitingAreas[TEAM.SARADOMIN].players.push(bot);
  assert.equal(game.releaseSeededBots(), false, 'bots stay while a real player is around');
  assert.equal(bot.logouts, 0);

  game.lobbyArea.players.length = 0;
  assert.equal(game.releaseSeededBots(), true);
  assert.equal(bot.logouts, 1, 'the bot was logged out');
});

test('both waiting rooms release seeded bots on leave and honour the transition path', () => {
  const registered = [];
  const calls = { released: 0, coloured: 0, countdown: 0 };
  const island = {
    data,
    BOT_KEY: {},
    TRANSITION_KEY: {},
    getTeamData: (team) => data.TEAM_DATA[team],
    getTeamId: () => null,
    setTeamId: () => {},
    clearCastleWarsItems: () => {},
    closeOverlay: () => {},
    equipTeamColours: () => { calls.coloured += 1; },
    beginStartCountdown: () => {},
    startSecondsLeft: () => 0,
    returnToLobby: () => {},
    releaseSeededBots: () => { calls.released += 1; return true; },
    checkStartCountdown: () => { calls.countdown += 1; },
  };
  Areas({
    core,
    registerArea: (area) => registered.push(area),
    onServerStartup: () => {}, onPlayerLogin: () => {}, onCanEquip: () => {}, onCanUnequip: () => {},
    onPlayerDeath: () => {}, onPlayerDeathItemDrop: () => {},
  }, island);

  const waitingRooms = registered.filter((area) => area.getName().includes('waiting room'));
  assert.equal(waitingRooms.length, 2, 'both waiting rooms are registered');
  for (const waitingRoom of waitingRooms) {
    const real = { getAsPlayer: () => real, getAttribute: () => false, isPlayerBot: () => false, resetAttributes: () => {} };
    waitingRoom.postLeave(real, false);
    assert.equal(calls.released, 1, 'leaving releases seeded bots');
    assert.equal(calls.countdown, 1, 'leaving cancels a pending countdown');
    calls.released = 0;
    calls.countdown = 0;

    const transitioning = new Map([[island.TRANSITION_KEY, true]]);
    const movingIn = { getAsPlayer: () => movingIn, getAttribute: (key) => transitioning.get(key), isPlayerBot: () => false };
    waitingRoom.postLeave(movingIn, false);
    assert.equal(calls.released, 0, 'a player moving into the game keeps the seeded bots');
    assert.equal(calls.countdown, 0, 'a player moving into the game keeps the countdown');

    const bot = { getAsPlayer: () => bot, getAttribute: () => false, isPlayerBot: () => true };
    waitingRoom.postEnter(bot);
    assert.equal(calls.released, 1, 'a bot arriving with no real players is released');
    assert.equal(calls.coloured, 0, 'a released bot never gets team colours');
    calls.released = 0;
  }
});
