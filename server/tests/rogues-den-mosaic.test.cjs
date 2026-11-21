// From server/: yarn build && node --test tests/rogues-den-mosaic.test.cjs
//
// The Rogues' Den mosaic door used to ask "Which tile do you place in the mosaic?" in a chat
// menu, all four floor tiles were the correct one (5568), and the match said "The mosaic door
// swings open.". Live opens the cache's roguesden_mosaic (688) modal, whose Select buttons show
// only for the tiles held; the floor holds four different tiles; only tile1 fits, and the match
// sends "A perfect match!" with the enchant-door animation, the door's loc animation and its
// synth (the user's recordings local 1001658 tick 19519, local 1001704 ticks 5271 and 5307-5311).
// These cases drive the real ObjectActionPacketListener, the plugin's button registration and a
// real PacketSender against the cache's door 7234.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const ROOT = path.resolve(__dirname, '..');
const MOSAIC_DOOR = 7234;
const DOOR_AT = [3023, 5082, 1];
// The recorded player walks onto the door's own tile before the modal opens (tick 5306).
const STAND_AT = [3023, 5082, 1];
const TILES = [5568, 5569, 5570, 5571];
const MOSAIC_INTERFACE = 688;
const BUSY_VARBIT = 12393;
const ENCHANT_DOOR = 2243;
const DOOR_SOUND = 1235;

let core;
let Player;
let Location;
let ObjectActionPacketListener;
let PluginManager;
let Lobby;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init();
  RegionManager.loadMapFiles(DOOR_AT[0], DOOR_AT[1]);

  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  ({ Location } = require('../dist/game/model/Location'));
  ({ ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener'));
  ({ PluginManager } = require('../dist/plugins/PluginManager'));
  core = PluginManager.getCoreApi();
  require('../plugins/minigames/RoguesDen.plugin').register(
    PluginManager.createApi('RoguesDenMosaicRegression'),
  );
  Lobby = require('../plugins/minigames/roguesden/Lobby.RoguesDen');

  assert.ok(core.MapObjects.get(MOSAIC_DOOR, new Location(...DOOR_AT), null), 'cache supplies the mosaic door');
});

let nextIndex = 1;

/** A player whose real PacketSender is wrapped so each call is also recorded. */
function account(t, tiles) {
  const player = new Player(null);
  player.setIndex(nextIndex++);
  player.setRegistered(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket() {}, write() {} }));
  const real = player.getPacketSender();
  const calls = [];
  const sender = new Proxy(real, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => {
        calls.push([key, ...args]);
        const result = value.apply(target, args);
        return result === target ? sender : result;
      };
    },
  });
  player.getPacketSender = () => sender;
  player.calls = calls;
  player.messages = () => calls.filter(([key]) => key === 'sendMessage').map(([, text]) => String(text));
  player.moveTo(new Location(...STAND_AT));
  player.setNeedsPlacement(false);
  for (const id of tiles) player.getInventory().adds(id, 1);
  t.after(() => {
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return player;
}

function openDoor(player) {
  new ObjectActionPacketListener().executeAction(player, MOSAIC_DOOR, DOOR_AT[0], DOOR_AT[1], 1);
  for (let tick = 0; tick < 6; tick++) {
    player.getMovementQueue().process();
    core.TaskManager.processWalkTo(player.getIndex());
  }
}

function select(player, tileIndex) {
  const buttonId = core.CacheDefinitions.getComponentId(`roguesden_mosaic:tile${tileIndex + 1}`);
  return PluginManager.emitInterfaceActionClick({ player, buttonId, action: 1, opId: 1 });
}

function tick() {
  core.TaskManager.process();
}

const varbits = (player) => player.calls.filter(([key, id]) => key === 'sendVarbit' && id === BUSY_VARBIT)
  .map(([, , value]) => value);

test('the floor holds the four different tiles at their recorded spots', () => {
  const registered = [];
  const manager = core.ItemOnGroundManager ?? PluginManager.createApi('RoguesDenMosaicSpawns').getItemOnGroundManager();
  const original = manager.register;
  manager.register = (item) => { registered.push(item); };
  try {
    Lobby.spawnItems();
  } finally {
    manager.register = original;
  }
  const tiles = registered
    .filter((item) => TILES.includes(item.getItem().getId()))
    .map((item) => [item.getItem().getId(), item.getPosition().getX(), item.getPosition().getY(), item.getPosition().getZ()])
    .sort((a, b) => a[0] - b[0]);
  assert.deepEqual(tiles, [
    [5568, 3018, 5080, 1],
    [5569, 3011, 5082, 1],
    [5570, 3013, 5090, 1],
    [5571, 3018, 5086, 1],
  ]);
});

test('opening the door with a tile opens the roguesden_mosaic modal, not a chat menu', (t) => {
  const player = account(t, [TILES[0]]);
  openDoor(player);
  assert.equal(player.getInterfaceId(), MOSAIC_INTERFACE);
  assert.equal(player.calls.some(([key]) => key === 'sendChatboxInterface'), false, 'no chat menu');
});

test('placing tile1 matches: message, animations, sound, tile taken, then a step through', (t) => {
  const player = account(t, [TILES[0]]);
  const animations = [];
  t.mock.method(player, 'performAnimation', (animation) => { animations.push(animation.getId()); });
  openDoor(player);
  const before = player.calls.length;
  assert.equal(select(player, 0), true, 'the Select click is handled');
  assert.deepEqual(varbits(player), [1], 'busy is set on the click');
  assert.equal(player.getInventory().contains(TILES[0]), true, 'nothing resolves on the click tick');

  tick();
  const resolved = player.calls.slice(before);
  assert.deepEqual(player.messages(), ['A perfect match!']);
  assert.equal(player.getInventory().contains(TILES[0]), false, 'the tile is placed');
  assert.notEqual(player.getInterfaceId(), MOSAIC_INTERFACE, 'the modal closes');
  assert.deepEqual(animations, [ENCHANT_DOOR], 'the enchant-door animation plays');
  assert.ok(resolved.some(([key, object, animation]) => key === 'sendObjectAnimation'
    && object.getId() === MOSAIC_DOOR && animation.getId() === core.CacheDefinitions.getSeqId('rogue_magic_door')),
    'the door plays its own loc animation');
  assert.ok(resolved.some(([key, id]) => key === 'sendSound' && id === DOOR_SOUND), 'the door synth plays');
  assert.ok(player.getLocation().equals(new Location(...STAND_AT)), 'the player waits on the match tick');

  tick();
  tick();
  tick();
  assert.ok(player.getLocation().equals(new Location(3024, 5082, 1)), 'the player is through the door, east');
  assert.deepEqual(varbits(player), [1, 0], 'busy clears');
});

test('a wrong tile does not open the door and is kept', (t) => {
  const player = account(t, [TILES[2]]);
  openDoor(player);
  assert.equal(player.getInterfaceId(), MOSAIC_INTERFACE);
  select(player, 2);
  tick();
  tick();
  tick();
  assert.deepEqual(player.messages(), ['The tile does not fit the mosaic.']);
  assert.equal(player.getInventory().contains(TILES[2]), true);
  assert.ok(player.getLocation().equals(new Location(...STAND_AT)), 'the player stays');
});

test('a Select for a tile the player does not hold does nothing', (t) => {
  const player = account(t, [TILES[1]]);
  openDoor(player);
  select(player, 0);
  tick();
  tick();
  assert.deepEqual(player.messages(), []);
  assert.equal(player.getInventory().contains(TILES[1]), true);
  assert.equal(player.getInterfaceId(), MOSAIC_INTERFACE, 'the modal stays open');
});
