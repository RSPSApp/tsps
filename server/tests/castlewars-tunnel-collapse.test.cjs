// Run after `yarn build`: node --test tests/castlewars-tunnel-collapse.test.cjs
// Tunnel flag drops, equipment and deaths with the real ObjectManager and cache map (issues 1929/2355).
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

test('native Castle Wars tunnel drops use the current rock state through equipment and death', async (t) => {
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const errors = [];
  const error = console.error;
  t.mock.method(console, 'error', (...args) => { errors.push(args); error.apply(console, args); });
  t.after(() => assert.equal(errors.length, 0, 'caught native World/hook failures must fail the fixture'));
  const api = PluginManager.createApi('CastleWarsTunnelFlagNative');
  const match = Game(api);
  require('../plugins/minigames/castlewars/Areas.CastleWars')(api, match);
  require('../plugins/minigames/castlewars/Flags.CastleWars')(api, match);
  Tunnels(api, match);
  const actors = [];
  const previousOrder = World.playerProcessOrder.slice();
  const previousShuffle = World.nextPlayerOrderShuffleCycle;
  function actor(team, location) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel);
    const p = new Player(session, at(location));
    p.setUsername(`cwtunnel${actors.length}`);
    p.setNeedsPlacement(false);
    p.setAttribute(require('../plugins/bots/runtime/PersistenceConstants.PlayerBots').ATTR_SKIP_PERSISTENCE, true);
    session.setPlayer(p);
    t.mock.method(p, 'onAdd', () => {});
    t.mock.method(p, 'onRemove', () => {});
    t.mock.method(p, 'smartMove', () => {}); // The match setup stays at this fixture's controlled tiles.
    const connection = new ClientConnection(channel);
    connection.player = p;
    session.setTurnPacketProcessor(() => connection.processTurnPackets());
    assert.ok(World.getPlayers().add(p));
    match.setTeamId(p, team);
    const h = { p, connection, session };
    actors.push(h);
    return h;
  }
  const carrier = actor(match.TEAM.ZAMORAK, ANCHOR);
  const helper = actor(match.TEAM.SARADOMIN, [ANCHOR[0], ANCHOR[1] - 1]);
  t.after(() => {
    match.endGame();
    for (const { p } of actors) {
      match.gameArea.leave(p, false);
      p.setArea(null);
      core.TaskManager.cancelTasks(p.getIndex());
      core.TaskManager.cancelTasks(p);
      core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(p);
      const index = p.getIndex();
      World.getPlayers().remove(p);
      assert.equal(World.getPlayers().get(index), null, 'native actor slot is released');
    }
    World.playerProcessOrder = previousOrder;
    World.nextPlayerOrderShuffleCycle = previousShuffle;
    World.refreshActiveRegions();
  });
  const pending = [];
  const submit = core.TaskManager.submit;
  const capture = t.mock.method(core.TaskManager, 'submit', function (task) {
    pending.push(task); return submit.call(this, task);
  });
  const waiting = Object.values(match.waitingAreas).map((area, i) => t.mock.method(area, 'getPlayers', () => [actors[i].p]));
  match.beginStartCountdown();
  pending.find((task) => typeof task.onComplete === 'function').execute();
  capture.mock.restore();
  waiting.forEach((mock) => mock.mock.restore());
  assert.equal(match.getPhase(), match.PHASE.ACTIVE);
  for (const { p } of actors) { p.setArea(match.gameArea); match.gameArea.enter(p); }
  const patches = [[2401, 9494, 0], [2409, 9503, 1], [2400, 9512, 0], [2391, 9501, 1]];
  const approach = (patch) => patch[2] ? [patch[0] - 1, patch[1]] : [patch[0], patch[1] - 1];
  const rock = (patch, id) => MapObjects.get(id, at(patch), null);
  // Golden inner-floor corner offsets: [carrier dx,dy, flag dx,dy], mapped from the clips to the cache.
  const cells = (patch) => patch[2]
    ? [[0, 0, -1, 0], [1, 0, 2, 0], [0, 1, -1, 1], [1, 1, 2, 1]]
    : [[0, 0, 0, -1], [1, 0, 1, -1], [0, 1, 0, 2], [1, 1, 1, 2]];
  const walls = patches.flatMap(([x, y]) => [[x - 1, y - 1], [x + 2, y - 1], [x - 1, y + 2], [x + 2, y + 2]])
    .map((tile) => ({ tile, object: MapObjects.get(core.ObjectIdentifiers.CAVE_WALL, at(tile), null),
      clipping: RegionManager.getClipping(...tile, 0, null) }));
  t.after(() => {
    for (const wall of walls) {
      assert.equal(MapObjects.get(core.ObjectIdentifiers.CAVE_WALL, at(wall.tile), null), wall.object);
      assert.equal(RegionManager.getClipping(...wall.tile, 0, null), wall.clipping, 'drops and pickups preserve boundary wall clipping');
    }
  });
  function position(p, tile) {
    p.getMovementQueue().reset();
    p.setForceMovement(null);
    p.setLocation(at(tile));
    p.setNeedsPlacement(false);
  }
  async function potion(objectId, tile) {
    helper.p.getInventory().adds(core.ItemIdentifiers.EXPLOSIVE_POTION, 1);
    const slot = helper.p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION);
    await helper.connection.dispatch([{ type: 'item_on_object', widgetId: 149 << 16, objectId,
      itemId: core.ItemIdentifiers.EXPLOSIVE_POTION, slot, x: tile[0], y: tile[1] }]);
    World.refreshActiveRegions();
    World.process();
    assert.equal(helper.p.getInventory().getSlot(slot), -1, `native potion on ${objectId} at ${tile}: player ${helper.p.getLocation()}, area ${helper.p.getArea()?.getName()}, movement ${helper.p.getMovementQueue().size()}`);
  }
  async function clear(patch) {
    position(helper.p, approach(patch));
    for (const id of [core.ObjectIdentifiers.ROCKS_21, core.ObjectIdentifiers.ROCKS_22]) {
      if (rock(patch, id)) await potion(id, patch);
    }
    assert.equal(rock(patch, core.ObjectIdentifiers.ROCKS_21), null);
    assert.equal(rock(patch, core.ObjectIdentifiers.ROCKS_22), null);
  }
  function carry(team, tile) {
    match.setTeamId(carrier.p, match.opposingTeam(team));
    match.setTeamId(helper.p, team);
    position(carrier.p, tile);
    match.carryFlag(carrier.p, team);
  }
  function assertOutsideDrop(team, tile, expected) {
    assert.equal(match.flagStatus[team], 2, 'the standard drops rather than safing');
    const dropped = match.getDroppedFlagObject(team);
    assert.ok(dropped);
    assert.ok(dropped.getLocation().equals(at(expected)), 'the standard uses the matching inner-floor corner');
    assert.equal(dropped.getPrivateArea(), carrier.p.getPrivateArea());
    assert.equal(match.isTunnelRockTile(dropped.getLocation()), false, 'the standard is outside every rock footprint');
    assert.ok(carrier.p.getLocation().equals(at(tile)), 'relocating the flag never moves the carrier');
    return dropped;
  }

  await t.test('native banner Remove on each cleared footprint tile drops either standard outside the rocks', async () => {
    for (const patch of patches) for (const team of Object.values(match.TEAM)) {
      await clear(patch);
      for (const [dx, dy, tx, ty] of cells(patch)) {
        const tile = [patch[0] + dx, patch[1] + dy];
        carry(team, tile);
        try {
          await carrier.connection.dispatch([{ type: 'widget_action', widgetId: (387 << 16) | 18,
            groupId: 387, childId: 18, buttonNum: 1, slot: -1, itemId: -1 }]);
          World.process();
          const dropped = assertOutsideDrop(team, tile, [patch[0] + tx, patch[1] + ty]);
          assert.equal(match.getCarriedFlagTeam(carrier.p), null);
          const target = dropped.getLocation();
          await carrier.connection.dispatch([{ type: 'object_option', id: dropped.getId(),
            x: target.getX(), y: target.getY(), clickType: 1 }]);
          for (let i = 0; i < 8 && !match.getCarriedFlagTeam(carrier.p); i++) World.process();
          assert.equal(match.getCarriedFlagTeam(carrier.p), team, 'native movement and object pickup can recover the relocated standard');
          assert.equal(match.getDroppedFlagObject(team), null);
        } finally { match.clearWeaponSlot(carrier.p); match.restoreFlagToBase(team); }
      }
    }
  });

  await t.test('overlap is resolved at the relocated corner rather than either carrier tile', async () => {
    await clear(ANCHOR);
    for (const incomingOwnFlag of [false, true]) {
      const sara = match.TEAM.SARADOMIN, zam = match.TEAM.ZAMORAK;
      carry(incomingOwnFlag ? zam : sara, ANCHOR);
      await carrier.connection.dispatch([{ type: 'widget_action', widgetId: (387 << 16) | 18,
        groupId: 387, childId: 18, buttonNum: 1, slot: -1, itemId: -1 }]);
      World.process();
      const kept = match.getDroppedFlagObject(incomingOwnFlag ? zam : sara);
      assert.ok(kept);
      match.setTeamId(helper.p, sara);
      position(helper.p, ANCHOR);
      match.carryFlag(helper.p, incomingOwnFlag ? sara : zam);
      await helper.connection.dispatch([{ type: 'widget_action', widgetId: (387 << 16) | 18,
        groupId: 387, childId: 18, buttonNum: 1, slot: -1, itemId: -1 }]);
      World.process();
      assert.equal(match.flagStatus[sara], 0, 'the second dropper own standard is returned');
      assert.equal(match.getDroppedFlagObject(sara), null);
      assert.equal(match.flagStatus[zam], 2, 'the enemy standard remains available');
      const enemy = match.getDroppedFlagObject(zam);
      assert.ok(enemy.getLocation().equals(kept.getLocation()));
      assert.equal(MapObjects.get(enemy.getId(), enemy.getLocation(), null), enemy, 'one visible type10 standard occupies the final corner');
      for (const team of [sara, zam]) match.restoreFlagToBase(team);
      match.clearWeaponSlot(carrier.p); match.clearWeaponSlot(helper.p);
    }
  });

  for (const helperFirst of [false, true]) for (const layersLeft of [2, 1, 0]) {
    const order = helperFirst ? [helper.p, carrier.p] : [carrier.p, helper.p];
    World.playerProcessOrder = order.slice();
    World.nextPlayerOrderShuffleCycle = 0x7fffffff;
    await t.test(`actual collapse death resolves the current ${layersLeft}-layer rock state with ${helperFirst ? 'helper' : 'carrier'} first`, async () => {
      for (const patch of patches) for (const team of Object.values(match.TEAM)) for (const [dx, dy, tx, ty] of cells(patch)) {
        await clear(patch);
        const tile = [patch[0] + dx, patch[1] + dy];
        carry(team, tile);
        position(helper.p, approach(patch));
        try {
          await potion(core.ObjectIdentifiers.CAVE_WALL, [patch[0] - 1, patch[1] - 1]);
          assert.ok(rock(patch, core.ObjectIdentifiers.ROCKS_21));
          // The real collapse queues lethal damage; full World processing applies it and starts PlayerDeathTask.
          for (let i = 0; i < 2 && !carrier.p.isDyingReturn(); i++) World.process();
          assert.equal(carrier.p.isDyingReturn(), true);
          assert.equal(carrier.p.getHitpoints(), 0);
          assert.equal(match.flagStatus[team], 1, 'the standard remains carried while the death is pending');
          if (layersLeft < 2) await potion(core.ObjectIdentifiers.ROCKS_21, patch);
          if (layersLeft === 0) await potion(core.ObjectIdentifiers.ROCKS_22, patch);
          assert.equal(carrier.p.isDyingReturn(), true, 'clearing happens before the death completes');
          assert.equal(match.flagStatus[team], 1);
          for (let i = 0; i < 5 && carrier.p.isDyingReturn(); i++) World.process();
          assert.equal(carrier.p.isDyingReturn(), false, 'actual Castle Wars death/respawn completes');
          if (layersLeft) {
            assert.equal(match.flagStatus[team], 0, 'either remaining rock layer safes the standard');
            assert.equal(match.getDroppedFlagObject(team), null);
          } else {
            assert.equal(match.flagStatus[team], 2, 'clearing before completion leaves the standard dropped');
            assert.equal(match.isTunnelRockTile(match.getDroppedFlagObject(team).getLocation()), false);
            assert.ok(match.getDroppedFlagObject(team).getLocation().equals(at([patch[0] + tx, patch[1] + ty])));
          }
        } finally { match.clearWeaponSlot(carrier.p); match.restoreFlagToBase(team); }
      }
      assert.deepEqual(World.playerProcessOrder, order, 'both player-processing orders are exercised without random reshuffles');
    });
  }
});
