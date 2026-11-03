// Run after `yarn build`: node --test tests/castlewars-tunnel-collapse.test.cjs
// Tunnel collapses over a dropped standard, with the real ObjectManager and cache map (issue 1929).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { World } = require('../dist/game/World');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { ObjectManager, OperationType } = require('../dist/game/entity/impl/object/ObjectManager');
const core = PluginManager.getCoreApi();
const Game = require('../plugins/minigames/castlewars/Game.CastleWars');
const Tunnels = require('../plugins/minigames/castlewars/Tunnels.CastleWars');
let game;
let blastRocks;
let blastWall;

// The Saradomin north-south patch: Rocks 4437 at 2401,9494 (2x2), cave walls on its corners.
const ANCHOR = [2401, 9494];
const WALL = [2400, 9493];
const PATCH = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => [ANCHOR[0] + dx, ANCHOR[1] + dy]);

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  RegionManager.loadMapFiles(2401, 9494);
  RegionManager.loadMapFiles(2426, 3080);
  const api = {
    core,
    getAreaManager: () => ({}),
    getBonusManager: () => ({ update() {} }),
    getObjectManager: () => ObjectManager,
    getRegionManager: () => RegionManager,
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => World,
    onObjectInteraction() {},
    onItemOnObject(item, name, fn) {
      if (name === 'Rocks') blastRocks = fn;
      if (name === 'Cave wall') blastWall = fn;
    },
    emitCustomEvent() {},
  };
  game = Game(api);
  game.isPlaying = () => true;
  game.requirePlaying = () => true;
  game.getTeamId = () => game.TEAM.SARADOMIN;
  game.gameArea = { getPlayers: () => [] };
  Tunnels(api, game);
});

function playerAt(t, x, y) {
  const p = new Player(null, new core.Location(x, y, 0));
  const messages = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() {}, write() {} }));
  t.mock.method(p, 'sendMessage', (message) => messages.push(message));
  p.messages = messages;
  return p;
}

function usePotion(t, handler, object) {
  const p = playerAt(t, ANCHOR[0], ANCHOR[1] - 1);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  handler({ player: p, object, itemSlot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) });
  return p;
}

const at = ([x, y]) => new core.Location(x, y, 0);
const rocksAt = (id) => MapObjects.get(id, at(ANCHOR), null);

test('issue 1929: a carrier crushed under the rocks sends the standard home, and the rocks keep their collision', (t) => {
  const { SARADOMIN } = game.TEAM;
  const operations = [];
  const perform = ObjectManager.perform.bind(ObjectManager);
  t.mock.method(ObjectManager, 'perform', (object, type) => {
    operations.push({ id: object.getId(), type, x: object.getLocation().getX(), y: object.getLocation().getY() });
    return perform(object, type);
  });
  for (const tile of PATCH) {
    // Mine the patch away with two potions, as players do.
    usePotion(t, blastRocks, rocksAt(core.ObjectIdentifiers.ROCKS_21));
    usePotion(t, blastRocks, rocksAt(core.ObjectIdentifiers.ROCKS_22));
    assert.equal(RegionManager.blocked(at(tile), null), false, `${tile} is open once mined`);

    const carrier = playerAt(t, ...tile);
    game.carryFlag(carrier, SARADOMIN);
    t.mock.method(game.gameArea, 'getPlayers', () => [carrier]);
    operations.length = 0;
    const p = usePotion(t, blastWall, MapObjects.get(core.ObjectIdentifiers.CAVE_WALL, at(WALL), null));
    assert.match(p.messages.at(-1), /collapsed the tunnel/);
    game.dropCarriedFlag(carrier); // the death that follows

    // RuneHQ: "if you die on the stepping stones or under the rockslide, it will return to your base."
    assert.equal(game.flagStatus[SARADOMIN], 0, `crushed on ${tile}: the standard is safe`);
    assert.equal(game.getDroppedFlagObject(SARADOMIN), null, 'nothing lies under the rocks');
    assert.ok(rocksAt(core.ObjectIdentifiers.ROCKS_21), 'the rocks are back');
    for (const covered of PATCH) {
      assert.equal(RegionManager.blocked(at(covered), null), true, `crushed on ${tile}: ${covered} stays blocked`);
    }
    // No despawn may follow the rocks' spawn: a tile/type removal would delete them on clients.
    const rocksSpawn = operations.findIndex((op) => op.id === core.ObjectIdentifiers.ROCKS_21 && op.type === OperationType.SPAWN);
    assert.ok(rocksSpawn >= 0);
    assert.deepEqual(operations.slice(rocksSpawn + 1).filter((op) => op.type === OperationType.DESPAWN), []);
  }
});
