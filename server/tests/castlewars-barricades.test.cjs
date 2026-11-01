// Run after `yarn build`: node --test tests/castlewars-barricades.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { World } = require('../dist/game/World');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { GameConstants } = require('../dist/game/GameConstants');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const core = PluginManager.getCoreApi();
const Game = require('../plugins/minigames/castlewars/Game.CastleWars');
const Barricades = require('../plugins/minigames/castlewars/Barricades.CastleWars');
const Tunnels = require('../plugins/minigames/castlewars/Tunnels.CastleWars');
const Mining = require('../plugins/skills/Mining.plugin');
const data = require('../plugins/minigames/castlewars/Data.CastleWars')(core);
let game;
let setup;
let itemOnNpc;
let burn;
let collapse;
let blastWall;
const swaps = [];

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  RegionManager.loadMapFiles(2426, 3080);
  RegionManager.loadMapFiles(2391, 9501);
  const itemActions = PluginManager.createApi('Castle Wars barricade regression');
  const api = {
    core,
    getAreaManager: () => ({}),
    getBonusManager: () => ({}),
    getObjectManager: () => ({ register() {}, deregister() {} }),
    getRegionManager: () => RegionManager,
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => World,
    onItemAction(name, actions) {
      itemActions.onItemAction(name, actions);
      setup = actions['Set-up'];
    },
    onNpcDeath() {},
    onCustomEvent: (...args) => itemActions.onCustomEvent(...args),
    onNpcInteraction(name, actions) { burn = actions.Burn; },
    onItemOnNpc(fn) {
      PluginManager.createApi('Castle Wars explosive regression').onItemOnNpc(fn);
      itemOnNpc = fn;
    },
    onObjectInteraction(name, actions) { if (name === 'Cave wall') collapse = actions.Collapse; },
    onItemOnObject(item, name, fn) { if (name === 'Cave wall') blastWall = fn; },
    emitCustomEvent(name, request) { if (name === 'mining:best-pickaxe') request.pickaxe = Mining.findBestPickaxe(request.player); },
  };
  game = Game(api);
  game.isPlaying = () => true;
  game.requirePlaying = () => true;
  game.getTeamId = () => data.TEAM.SARADOMIN;
  game.swapObject = (...args) => swaps.push(args);
  game.gameArea = { getPlayers: () => [] };
  Barricades(api, game);
  require('../plugins/combat/specials/Shove.SpecialAttack')(PluginManager.createApi('Castle Wars shove regression'));
  Tunnels(api, game);
});

function playerAt(t, x, y, z = 1) {
  const p = new Player(null, new core.Location(x, y, z));
  const messages = [];
  const graphics = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() {}, write() {} }));
  t.mock.method(p, 'sendMessage', (message) => messages.push(message));
  t.mock.method(p.getPacketSender(), 'sendGlobalGraphic', (graphic, location) => graphics.push({ graphic, location }));
  p.messages = messages;
  p.graphics = graphics;
  p.getInventory().add(new core.Item(core.ItemIdentifiers.BARRICADE, 3));
  return p;
}

function deployed(t, p) {
  const before = new Set([...World.getNpcs()]);
  setup({ player: p, slot: 2 });
  const npc = [...World.getNpcs()].find((entry) => !before.has(entry));
  assert.ok(npc, p.messages.join('\n'));
  t.after(() => {
    game.releaseBarricade(npc);
    World.getRemoveNPCQueue().splice(0);
    World.getNpcs().remove(npc);
  });
  return npc;
}

test('the energy-barrier exit and nonblocking map objects allow immediate barricades', (t) => {
  for (const [x, y] of [[2426, 3081], [2426, 3080], [2423, 3076]]) {
    const p = playerAt(t, x, y);
    const inventory = p.getInventory();
    const npc = deployed(t, p);
    assert.equal(npc.isRegistered(), true, 'registered before the next world queue pass');
    assert.equal(World.getAddNPCQueue().includes(npc), false);
    assert.equal(inventory.getItems()[0].getId(), -1, 'the first barricade was consumed');
    assert.equal(inventory.getItems()[2].getId(), core.ItemIdentifiers.BARRICADE, 'the clicked last barricade stays put');
  }
});

test('Shove cannot stun or displace either team\'s intact or burning barricades', (t) => {
  const tasks = [];
  t.mock.method(TaskManager, 'submit', task => tasks.push(task));
  for (const team of Object.values(data.TEAM)) {
    t.mock.method(game, 'getTeamId', () => team);
    const p = playerAt(t, 2427, 3078);
    const npc = deployed(t, p);
    const origin = npc.getLocation().clone();
    p.moveTo(origin.transform(-1, 0));
    for (const burning of [false, true]) {
      npc.setNpcTransformationId(burning ? core.NpcIdentifiers.BARRICADE_2 : -1);
      for (const id of [core.ItemIdentifiers.DRAGON_SPEAR, core.ItemIdentifiers.ZAMORAKIAN_SPEAR, core.ItemIdentifiers.ZAMORAKIAN_HASTA]) {
        p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(id));
        p.setSpecialPercentage(100);
        p.setSpecialActivated(true);
        tasks.length = 0;
        core.CombatSpecial.getForWeaponId(id).getCombatMethod().start(p, npc);
        for (const task of tasks) task.execute();
        assert.ok(npc.getLocation().equals(origin), 'the registered barricade keeps its blocking tile');
        assert.equal(npc.getTimers().has(core.TimerKey.STUN), false, 'no stun is applied');
        assert.equal(p.getSpecialPercentage(), 100, 'a refused Shove spends no energy');
        assert.equal(p.isSpecialActivated(), false, 'the refused special does not repeat each swing');
        assert.ok(npc.hasFlag(core.NPC.BLOCKS_PLAYERS_FLAG));
        assert.equal(game.teamBarricadeCount(team), 1);
      }
    }
    game.releaseBarricade(npc);
    World.getNpcs().remove(npc);
    const goblin = new core.NPC(core.NpcIdentifiers.GOBLIN, origin);
    p.setSpecialPercentage(100);
    p.setSpecialActivated(true);
    core.CombatSpecial.getForWeaponId(core.ItemIdentifiers.ZAMORAKIAN_HASTA).getCombatMethod().start(p, goblin);
    assert.equal(goblin.getTimers().has(core.TimerKey.STUN), true, 'the barricade hook still permits ordinary targets');
    assert.equal(p.getSpecialPercentage(), 75);
  }
});

for (const activeRegions of [true, false]) {
  for (const level of [0, 1]) {
    test(`a native inventory click sends the barricade in the same tick on level ${level}, active regions ${activeRegions}`, async (t) => {
      const previousActiveRegions = GameConstants.PROCESS_NPCS_BY_ACTIVE_REGIONS;
      GameConstants.PROCESS_NPCS_BY_ACTIVE_REGIONS = activeRegions;
      t.after(() => { GameConstants.PROCESS_NPCS_BY_ACTIVE_REGIONS = previousActiveRegions; });
      const packets = [];
      const processedNpcs = [];
      const processNpc = core.NPC.prototype.process;
      t.mock.method(core.NPC.prototype, 'process', function () {
        processedNpcs.push(this);
        return processNpc.call(this);
      });
      const channel = {
        kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
        send: () => true, close() {}, onData() {}, onError() {}, onClose() {},
      };
      const session = new PlayerSession(channel);
      const player = new Player(session, new core.Location(2426, 3081, level));
      player.setUsername('barricadetiming');
      player.setNeedsPlacement(false);
      session.setPlayer(player);
      t.mock.method(player, 'onAdd', () => {});
      t.mock.method(player, 'onRemove', () => {});
      t.mock.method(session, 'sendClientPacket', (packet) => { packets.push(packet); return true; });
      const connection = new ClientConnection(channel);
      connection.player = player;
      session.setTurnPacketProcessor(() => connection.processTurnPackets());
      assert.ok(World.getPlayers().add(player));
      t.after(() => {
        for (const npc of [...World.getNpcs()]) {
          if (!game.isBarricade(npc)) continue;
          game.releaseBarricade(npc);
          World.getNpcs().remove(npc);
        }
        World.getRemoveNPCQueue().splice(0);
        World.getPlayers().remove(player);
        World.refreshActiveRegions();
      });
      World.refreshActiveRegions();
      World.process(); // A warm, already-visible scene, as when playing an ongoing game.
      packets.length = 0;
      player.getInventory().add(new core.Item(core.ItemIdentifiers.BARRICADE), false);
      await connection.dispatch([{
        type: 'widget_action', widgetId: (149 << 16), groupId: 149, childId: 0,
        buttonNum: 2, slot: 0, itemId: core.ItemIdentifiers.BARRICADE,
      }]);
      assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BARRICADE), 1, 'input waits for the normal player turn');
      World.process();
      assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BARRICADE), 0, 'the real inventory action ran');
      const npc = [...World.getNpcs()].find((candidate) => game.isBarricade(candidate));
      assert.ok(npc, 'the action registered its barricade');
      assert.equal(processedNpcs.includes(npc), false, 'sync does not give a late spawn an early AI turn');
      let ticksToVisibility = 1;
      while (!player.getLocalNpcs().includes(npc) && ticksToVisibility < 3) {
        World.process();
        ticksToVisibility++;
      }
      assert.equal(ticksToVisibility, 1, 'world ticks from the queued inventory click to NPC visibility');
      assert.equal(player.getLocalNpcs().filter((entry) => entry === npc).length, 1);
      const frame = packets.find((packet) => packet[0] === 21); // Native NPC_INFO.
      assert.ok(frame, 'the regular world flush sent NPC_INFO');
      const body = frame.subarray(3);
      assert.equal(body.readInt32BE(0), World.getProcessCycle());
      assert.equal(body.readUInt16BE(9), body.length - 11);
      const native = body.subarray(11);
      let bit = 0;
      const read = (width) => {
        let value = 0;
        for (let i = 0; i < width; i++, bit++) value = value * 2 + ((native[bit >> 3] >> (7 - (bit & 7))) & 1);
        return value;
      };
      assert.equal(read(8), 0, 'no NPC was known before this click');
      assert.equal(read(16), npc.getIndex(), 'this tick carries the new NPC index');
      read(1); // Optional update block.
      assert.equal(read(1), 0, 'main-world NPC');
      assert.equal(read(1), 0, 'first addition');
      assert.equal(read(body[4] ? 8 : 5), 0, 'placed on the player tile (y)');
      assert.equal(read(body[4] ? 8 : 5), 0, 'placed on the player tile (x)');
      read(3); // Rotation.
      assert.equal(read(16), data.BARRICADE_NPC[data.TEAM.SARADOMIN], 'correct barricade model');
      assert.equal(read(16), 0xffff, 'one addition, with a complete NPC_INFO bitstream');
      World.process();
      assert.deepEqual(player.getLocalNpcs(), [npc], 'subsequent ticks keep one barricade');
      assert.equal(processedNpcs.filter((entry) => entry === npc).length, 1, 'its first AI turn runs once on the next tick');
    });
  }
}

test('a barricade stops walking without making the pathfinder walk around it', (t) => {
  const p = playerAt(t, 2405, 3110, 0);
  const npc = deployed(t, p);
  const walker = playerAt(t, 2406, 3110, 0);
  assert.equal(RegionManager.blocked(npc.getLocation(), null), false, 'NPC collision is outside map collision');
  PathFinder.calculateWalkRoute(walker, 2404, 3110);
  assert.ok(walker.getMovementQueue().pointsReturn().every((point) => point.position.getY() === 3110), "the route stays straight through the barricade");
  assert.equal(walker.getMovementQueue().canWalkTo(new core.Location(2405, 3110, 0), walker.getLocation()), false);
  assert.equal(walker.getMovementQueue().canWalkTo(new core.Location(2406, 3111, 0), walker.getLocation()), true);
  game.releaseBarricade(npc);
  assert.equal(walker.getMovementQueue().canWalkTo(new core.Location(2405, 3110, 0), walker.getLocation()), true);
});

test('solid tunnel rocks and stepping stones refuse barricades', (t) => {
  for (const [x, y, z] of [[2391, 9501, 0], [2418, 3123, 0]]) {
    const p = playerAt(t, x, y, z);
    const amount = p.getInventory().getAmount(core.ItemIdentifiers.BARRICADE);
    setup({ player: p, slot: 0 });
    assert.match(p.messages.at(-1), /can't set up a barricade here/);
    assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BARRICADE), amount);
  }
});

test('lighting your own tile steps sideways; right-click Burn never consumes supplies', (t) => {
  const p = playerAt(t, 2426, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  assert.equal(burn({ player: p, npc }), true);
  assert.equal(npc.getNpcTransformationId(), -1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 1);
  const event = { player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX, slot: 0 };
  itemOnNpc(event);
  assert.equal(event.handled, true);
  assert.deepEqual(moves, [[-1, 0]]);
  assert.equal(npc.getNpcTransformationId(), core.NpcIdentifiers.BARRICADE_2);
});

test('lighting steps right if the left tile is blocked and refuses when both sides are blocked', (t) => {
  const p = playerAt(t, 2428, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'canWalk', (dx) => dx === 1);
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  assert.deepEqual(moves, [[1, 0]]);
  npc.setNpcTransformationId(-1);
  t.mock.method(p.getMovementQueue(), 'canWalk', () => false);
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  assert.equal(npc.getNpcTransformationId(), -1, 'no fire without a free sideways tile');
});

test('extinguishing and relighting starts a fresh burn duration', (t) => {
  const p = playerAt(t, 2425, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  p.getInventory().add(new core.Item(core.ItemIdentifiers.BUCKET_OF_WATER));
  const callbacks = [];
  t.mock.method(game, 'later', (ticks, complete) => callbacks.push(complete));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.BUCKET_OF_WATER });
  callbacks[0]();
  assert.equal(game.isBarricade(npc), true, 'a doused barricade survives its old burn timer');
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  callbacks[0]();
  assert.equal(game.isBarricade(npc), true, 'the previous timer cannot end the new fire');
  callbacks[1]();
  assert.equal(game.isBarricade(npc), false, 'the new burn timer removes the barricade');
});

test('the match barricade limit controls placement', (t) => {
  const p = playerAt(t, 2427, 3079);
  t.mock.method(game, 'teamBarricadeCount', () => 10);
  game.getBarricadeLimit = () => 10;
  t.after(() => { delete game.getBarricadeLimit; });
  setup({ player: p });
  assert.match(p.messages.at(-1), /already has 10/);
  game.getBarricadeLimit = () => 20;
  deployed(t, p);
});

test('explicit explosive use sends a tile explosion and removes the barricade', (t) => {
  const p = playerAt(t, 2427, 3078);
  const npc = deployed(t, p);
  p.moveTo(p.getLocation().transform(-1, 0));
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  const event = { player: p, target: npc, itemId: core.ItemIdentifiers.EXPLOSIVE_POTION,
    slot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) };
  itemOnNpc(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().contains(core.ItemIdentifiers.EXPLOSIVE_POTION), false);
  assert.equal(game.isBarricade(npc), false);
  assert.equal(p.graphics[0].graphic.id, core.CacheDefinitions.getSpotanimId('explodingvial'));
  assert.ok(p.graphics[0].location.equals(npc.getLocation()));
});

for (const occupiedWest of [false, true]) {
  test(`native explosive use steps off before exploding, west occupied ${occupiedWest}`, async (t) => {
    const channel = {
      kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {},
    };
    const session = new PlayerSession(channel);
    const p = new Player(session, new core.Location(2405, 3110, 0));
    p.setUsername('barricadeblast');
    p.messages = [];
    p.getInventory().adds(core.ItemIdentifiers.BARRICADE, 1);
    p.setNeedsPlacement(false);
    session.setPlayer(p);
    t.mock.method(p, 'onAdd', () => {});
    t.mock.method(p, 'onRemove', () => {});
    t.mock.method(session, 'sendClientPacket', () => true);
    const connection = new ClientConnection(channel);
    connection.player = p;
    session.setTurnPacketProcessor(() => connection.processTurnPackets());
    assert.ok(World.getPlayers().add(p));
    const npc = deployed(t, p);
    t.after(() => {
      TaskManager.cancelTasks(p.getIndex());
      World.getPlayers().remove(p);
      World.refreshActiveRegions();
    });
    World.refreshActiveRegions();
    World.process();
    if (occupiedWest) deployed(t, playerAt(t, 2404, 3110, 0));
    const origin = p.getLocation().clone();
    const potion = core.ItemIdentifiers.EXPLOSIVE_POTION;
    p.getInventory().adds(potion, 1);
    const slot = p.getInventory().getSlotForItemId(potion);
    const effects = [];
    const send = p.getPacketSender().sendGlobalGraphic;
    t.mock.method(p.getPacketSender(), 'sendGlobalGraphic', function (graphic, location) {
      effects.push({ player: p.getLocation().clone(), graphic, location: location.clone() });
      return send.call(this, graphic, location);
    });
    await connection.dispatch([{
      type: 'item_on_npc', widgetId: (149 << 16), targetIndex: npc.getIndex(), itemId: potion, slot,
    }]);
    assert.equal(effects.length, 0, 'the packet waits for the player turn');
    World.process();
    assert.equal(effects.length, 0, 'the step completes before the explosion');
    assert.equal(p.getLocation().equals(origin), false, 'the actor stepped out');
    World.process();
    assert.equal(effects.length, 1);
    assert.equal(effects[0].player.equals(origin), false, 'movement happened before the effect was sent');
    assert.equal(Math.abs(effects[0].player.getX() - origin.getX()) + Math.abs(effects[0].player.getY() - origin.getY()), 1);
    assert.equal(effects[0].graphic.getId(), core.CacheDefinitions.getSpotanimId('explodingvial'));
    assert.ok(effects[0].location.equals(origin), 'the explosion stays on the barricade tile');
    assert.equal(p.getInventory().contains(potion), false);
    assert.equal(game.isBarricade(npc), false);
  });
}

test('an interrupted, blocked or stale explosive approach keeps the potion', (t) => {
  for (const change of ['swap-item', 'remove-target', 'deregister-target', 'dead-target', 'target-plane', 'target-instance', 'cancel', 'blocked', 'enclosed']) {
    const p = playerAt(t, 2426, 3078);
    const npc = deployed(t, p);
    const potion = core.ItemIdentifiers.EXPLOSIVE_POTION;
    p.getInventory().adds(potion, 1);
    const slot = p.getInventory().getSlotForItemId(potion);
    if (change === 'blocked') p.setNeedsPlacement(true);
    if (change === 'enclosed') {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const tile = p.getLocation().transform(dx, dy);
        const { BLOCKED_TILE } = RegionManager;
        const before = RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), null);
        RegionManager.addClipping(tile.getX(), tile.getY(), tile.getZ(), BLOCKED_TILE, null);
        t.after(() => { if (!(before & BLOCKED_TILE)) RegionManager.removeClipping(tile.getX(), tile.getY(), tile.getZ(), BLOCKED_TILE, null); });
      }
    }
    itemOnNpc({ player: p, target: npc, itemId: potion, slot });
    if (change === 'swap-item') p.getInventory().setItem(slot, new core.Item(potion));
    if (change === 'remove-target') game.removeBarricade(npc);
    if (change === 'deregister-target') World.getNpcs().remove(npc);
    if (change === 'dead-target') npc.setHitpoints(0);
    if (change === 'target-plane') npc.setLocation(npc.getLocation().transform(0, 0, 1));
    if (change === 'target-instance') {
      const otherArea = {};
      t.mock.method(npc, 'getPrivateArea', () => otherArea);
    }
    if (change === 'cancel') p.clearPendingAction();
    const movement = p.getMovementQueue();
    for (let tick = 0; tick < 2; tick++) {
      TaskManager.process();
      movement.beginCycle();
      movement.processEntityPursuit();
      movement.process();
      TaskManager.processWalkTo(p.getIndex());
    }
    assert.equal(p.getInventory().contains(potion), true, change);
    assert.equal(p.graphics.length, 0, change);
    if (change === 'enclosed') assert.match(p.messages.at(-1), /need room to stand beside/);
    TaskManager.cancelTasks(p.getIndex());
    game.releaseBarricade(npc);
    World.getNpcs().remove(npc);
  }
});

test('fire tools step out of an overlapping tile, but adjacent use stays in place', (t) => {
  for (const itemId of [core.ItemIdentifiers.TINDERBOX, core.ItemIdentifiers.BUCKET_OF_WATER]) {
    for (const overlapping of [true, false]) {
      const p = playerAt(t, 2426, 3078);
      const npc = deployed(t, p);
      p.getInventory().add(new core.Item(itemId));
      if (itemId === core.ItemIdentifiers.BUCKET_OF_WATER) npc.setNpcTransformationId(npc.getId() + 1);
      if (!overlapping) p.moveTo(p.getLocation().transform(-1, 0));
      const moves = [];
      t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
      itemOnNpc({ player: p, target: npc, itemId, slot: p.getInventory().getSlotForItemId(itemId) });
      assert.deepEqual(moves, overlapping ? [[-1, 0]] : [], `tool ${itemId}, overlapping=${overlapping}`);
      game.releaseBarricade(npc);
      World.getNpcs().remove(npc);
    }
  }
});

test('a free north or south tile remains usable when the horizontal sides are blocked', (t) => {
  const p = playerAt(t, 2426, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'canWalk', (dx, dy) => dx === 0 && dy === 1);
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  assert.deepEqual(moves, [[0, 1]]);
});

test('unavailable or invalid tool interactions neither move nor consume supplies', (t) => {
  for (const itemId of [core.ItemIdentifiers.TINDERBOX, core.ItemIdentifiers.BUCKET_OF_WATER]) {
    const p = playerAt(t, 2426, 3078);
    const npc = deployed(t, p);
    p.getInventory().add(new core.Item(itemId));
    if (itemId === core.ItemIdentifiers.BUCKET_OF_WATER) npc.setNpcTransformationId(npc.getId() + 1);
    t.mock.method(p.getMovementQueue(), 'canWalk', () => false);
    const moves = [];
    t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
    const before = npc.getNpcTransformationId();
    itemOnNpc({ player: p, target: npc, itemId, slot: p.getInventory().getSlotForItemId(itemId) });
    assert.deepEqual(moves, []);
    assert.equal(npc.getNpcTransformationId(), before);
    assert.equal(game.isBarricade(npc), true);
    assert.equal(p.getInventory().contains(itemId), true);
    assert.equal(p.graphics.length, 0);
    game.releaseBarricade(npc);
    World.getNpcs().remove(npc);
  }
  const p = playerAt(t, 2426, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  npc.setNpcTransformationId(npc.getId() + 1);
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.EXPLOSIVE_POTION,
    slot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) });
  assert.deepEqual(moves, [], 'a burning barricade rejects explosives before an escape step');
  assert.equal(p.getInventory().contains(core.ItemIdentifiers.EXPLOSIVE_POTION), true);
  assert.equal(game.isBarricade(npc), true);
});

test('Collapse requires explicit potion-on-wall use', (t) => {
  const p = playerAt(t, 2390, 9501, 0);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  const object = MapObjects.get(core.ObjectIdentifiers.CAVE_WALL, new core.Location(2390, 9500, 0), null);
  assert.ok(object, 'the cache wall is present');
  swaps.length = 0;
  collapse({ player: p, object });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 1);
  assert.equal(swaps.length, 0);
  assert.match(p.messages.at(-1), /Use an explosive potion/);
  t.mock.method(core.MapObjects, 'get', () => null);
  blastWall({ player: p, object, itemSlot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 0);
  assert.equal(swaps[0][1].getId(), core.ObjectIdentifiers.ROCKS_21);
});
