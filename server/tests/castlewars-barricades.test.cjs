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
    getBonusManager: () => ({ update() {} }),
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
  game.hasPracticeBots = () => false;
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

test('practice and human games keep players above native barricades through burning, extinguishing and removal', (t) => {
  let practice = true;
  t.mock.method(game, 'hasPracticeBots', () => practice);
  for (const team of Object.values(data.TEAM)) {
    t.mock.method(game, 'getTeamId', () => team);
    for (const isPractice of [true, false]) {
      practice = isPractice;
      const p = playerAt(t, 2427, 3078);
      const inventory = p.getInventory();
      inventory.adds(core.ItemIdentifiers.TINDERBOX, 1);
      inventory.adds(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
      const npc = deployed(t, p);
      const expected = data.BARRICADE_NPC[team];
      assert.equal(npc.getId(), expected);
      const definition = core.CacheDefinitions.getNpc(npc.getId());
      assert.equal(definition.drawPriority, 1);
      assert.equal(definition.name, 'Barricade');
      assert.equal(npc.hasFlag(core.NPC.BLOCKS_PLAYERS_FLAG), true);
      assert.equal(game.isBarricade(npc), true);
      p.moveTo(npc.getLocation().transform(-1, 0));
      itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX, slot: inventory.getSlotForItemId(core.ItemIdentifiers.TINDERBOX), handled: false });
      assert.equal(npc.getNpcTransformationId(), expected + 1);
      assert.equal(core.CacheDefinitions.getNpc(expected + 1).drawPriority, 1);
      itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.BUCKET_OF_WATER, slot: inventory.getSlotForItemId(core.ItemIdentifiers.BUCKET_OF_WATER), handled: false });
      assert.equal(npc.getNpcTransformationId(), -1);
      assert.equal(npc.getId(), expected, 'extinguishing restores the standard variant');
      inventory.adds(core.ItemIdentifiers.EXPLOSIVE_POTION, 1);
      itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.EXPLOSIVE_POTION, slot: inventory.getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION), handled: false });
      assert.equal(game.isBarricade(npc), false, 'explosion releases the barricade');
      assert.equal(npc.hasFlag(core.NPC.BLOCKS_PLAYERS_FLAG), false);
      World.getRemoveNPCQueue().splice(0);
      World.getNpcs().remove(npc);
    }
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
      npc.setNpcTransformationId(burning ? core.NpcIdentifiers.BARRICADE_6 : -1);
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

test('issue 1929: mined-away tunnel rock tiles still refuse barricades; the tile beside them does not', (t) => {
  t.mock.method(RegionManager, 'blocked', () => false);
  // Every tile of all four 2x2 patches, as a player stands there once the rocks are cleared.
  for (const [x, y] of [[2401, 9494], [2409, 9503], [2400, 9512], [2391, 9501]]) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = playerAt(t, x + dx, y + dy, 0);
      setup({ player: p, slot: 0 });
      assert.match(p.messages.at(-1) ?? '', /can't set up a barricade here/, `${x + dx},${y + dy}`);
      assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BARRICADE), 3);
    }
  }
  deployed(t, playerAt(t, 2401, 9493, 0));
});

test('issue 1929: a player cannot cut diagonally past a barricade', (t) => {
  const walker = playerAt(t, 2405, 3110, 0);
  const north = deployed(t, playerAt(t, 2405, 3111, 0));
  const east = deployed(t, playerAt(t, 2406, 3110, 0));
  const step = (dx, dy) => walker.getMovementQueue().canWalkTo(walker.getLocation().transform(dx, dy), walker.getLocation());
  assert.equal(step(1, 1), false, 'between the north and east barricades');
  assert.equal(step(-1, 1), false, 'past the north barricade');
  assert.equal(step(1, -1), false, 'past the east barricade');
  assert.equal(step(-1, -1), true, 'no barricade beside the south-west step');
  game.releaseBarricade(north);
  assert.equal(step(1, 1), false, 'one barricade beside the step is enough');
  assert.equal(step(-1, 1), true);
  game.releaseBarricade(east);
  assert.equal(step(1, 1), true);
});

test("a standard dropped on blocked tunnel rocks, or your own on catapult battlements, goes home", (t) => {
  const { SARADOMIN } = data.TEAM;
  const dropAt = (x, y) => {
    const carrier = playerAt(t, x, y, 0);
    game.setTeamId(carrier, SARADOMIN);
    game.carryFlag(carrier, SARADOMIN);
    game.dropCarriedFlag(carrier);
    const result = { status: game.flagStatus[SARADOMIN], dropped: game.getDroppedFlagObject(SARADOMIN) };
    game.restoreFlagToBase(SARADOMIN);
    return result;
  };
  // RuneHQ: "if you die on the stepping stones or under the rockslide, it will return to your base."
  // Rocks 4437 stand at 2391,9501 in the cache map; cleared patches have outside floor drops.
  const rockTiles = [[2391, 9501], [2392, 9502], [2401, 9494], [2402, 9495], [2409, 9503], [2400, 9512]];
  // The reporter's battlement tiles beside each catapult, and their mirrors.
  const battlements = [[2383, 3116], [2384, 3116], [2385, 3116], [2387, 3118], [2387, 3119],
    [2412, 3088], [2412, 3089], [2414, 3091], [2415, 3091], [2416, 3091]];
  for (const [x, y] of [...rockTiles, ...battlements]) {
    const { status, dropped } = dropAt(x, y);
    assert.equal(status, 0, `${x},${y} sends it home`);
    assert.equal(dropped, null, `${x},${y} leaves nothing on the floor`);
  }
  t.mock.method(core.MapObjects, 'get', () => null);
  const cleared = dropAt(2392, 9502);
  assert.equal(cleared.status, 2, 'cleared rocks leave a dropped standard');
  assert.ok(cleared.dropped.getLocation().equals(new core.Location(2393, 9502)), 'the east-west passage keeps the carrier row');
  // The rest of the catapult deck, and the tunnel beside the rocks, drop it as usual.
  for (const [x, y] of [[2383, 3118], [2385, 3120], [2413, 3087], [2393, 9502], [2401, 9493]]) {
    const { status, dropped } = dropAt(x, y);
    assert.equal(status, 2, `${x},${y} drops it`);
    assert.deepEqual([dropped.getLocation().getX(), dropped.getLocation().getY()], [x, y]);
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
  assert.equal(npc.getNpcTransformationId(), core.NpcIdentifiers.BARRICADE_6);
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

test('Collapse on a blocked tunnel consumes neither tools nor potions', (t) => {
  const p = playerAt(t, 2390, 9501, 0);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  const object = MapObjects.get(core.ObjectIdentifiers.CAVE_WALL, new core.Location(2390, 9500, 0), null);
  assert.ok(object, 'the cache wall is present');
  swaps.length = 0;
  collapse({ player: p, object });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 1);
  assert.equal(swaps.length, 0);
  assert.match(p.messages.at(-1), /already blocked/);
  t.mock.method(core.MapObjects, 'get', () => null);
  blastWall({ player: p, object, itemSlot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 0);
  assert.equal(swaps[0][1].getId(), core.ObjectIdentifiers.ROCKS_21);
});

test('standard-world barricades and burning variants use the cache types that render beneath players', () => {
  for (const id of Object.values(data.BARRICADE_NPC)) {
    assert.equal(core.CacheDefinitions.getNpc(id).drawPriority, 1);
    assert.equal(core.CacheDefinitions.getNpc(id + 1).drawPriority, 1);
    assert.equal(core.CacheDefinitions.getNpc(id).name, 'Barricade');
  }
});

test('Castle Wars barricades block combat sight in both directions and remain attackable', (t) => {
  const owner = playerAt(t, 2405, 3110, 0);
  const barricade = deployed(t, owner);
  const attacker = playerAt(t, 2406, 3110, 0);
  const target = playerAt(t, 2404, 3110, 0);
  attacker.getCombat().setCastSpell(core.CombatSpells.ICE_BARRAGE.getSpell());
  assert.equal(core.CombatRange.canReach(attacker, core.CombatFactory.MAGIC_COMBAT, target), false, 'native Ice Barrage targeting');
  const mapClip = RegionManager.getClipping(2405, 3110, 0, null);
  for (const type of [core.CombatType.RANGED, core.CombatType.MAGIC, core.CombatType.MELEE]) {
    const method = { type: () => type, attackDistance: () => 2 };
    assert.equal(core.CombatRange.canReach(attacker, method, target), false, String(type));
    assert.equal(core.CombatRange.canReach(target, method, attacker), false, 'reverse ray');
    assert.equal(core.CombatRange.canReach(attacker, method, barricade), true, 'attack the blocker itself');
    assert.equal(core.CombatRange.canReach(attacker, method, playerAt(t, 2406, 3111, 0)), true, 'off-ray target');
  }
  assert.equal(attacker.getMovementQueue().canWalkTo(owner.getLocation(), attacker.getLocation()), false);
  assert.equal(RegionManager.getClipping(2405, 3110, 0, null), mapClip, 'dynamic NPCs leave map clips intact');
  const sight = () => RegionManager.canProjectileAttackTarget(attacker, target);
  barricade.setNpcTransformationId(barricade.getId() + 1);
  assert.equal(sight(), false, 'burning still blocks sight');
  barricade.setNpcTransformationId(-1);
  assert.equal(sight(), false, 'extinguished still blocks sight');
  game.removeBarricade(barricade);
  assert.equal(sight(), true, 'removal opens the ray before the NPC removal queue runs');
  assert.equal(core.CombatRange.canReach(attacker, core.CombatFactory.MAGIC_COMBAT, target), true, 'Ice Barrage can target again');
});

test('projectile blockers are scoped to their plane and private area, and overlapping blockers clear independently', (t) => {
  const owner = playerAt(t, 2405, 3110, 0);
  const first = deployed(t, owner);
  const second = new core.NPC(first.getId(), owner.getLocation().clone());
  World.getNpcs().add(second);
  game.trackBarricade(second, data.TEAM.SARADOMIN);
  t.after(() => { game.releaseBarricade(second); World.getNpcs().remove(second); });
  const ray = (z = 0, area = null) => RegionManager.canProjectileAttackBounds(
    new core.Location(2406, 3110, z), new core.Location(2404, 3110, z), 1, 1, 1, 1, area);
  assert.equal(ray(), false);
  assert.equal(ray(0, {}), true, 'a different instance is unaffected');
  assert.equal(World.isProjectileBlockingNpcOnTile(2405, 3110, 1, null), false, 'another floor is unaffected');
  game.releaseBarricade(first);
  assert.equal(ray(), false, 'the overlapping blocker remains');
  second.setLocation(new core.Location(2405, 3111, 0));
  assert.equal(ray(), true, 'moving the blocker updates its indexed footprint');
  second.setLocation(owner.getLocation().clone());
  assert.equal(ray(), false);
  World.getNpcs().remove(second);
  assert.equal(ray(), true, 'unregistering removes the indexed blocker');
});
