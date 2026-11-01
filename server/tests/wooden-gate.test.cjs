
// Run after `yarn build`: node --test tests/wooden-gate.test.cjs
//
// Wooden gates are two locs (hinge 12986 + extension 12987) that must swing together around
// the hinge post; opening replaces both with 12988/12989 on the perpendicular tile line.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { Sounds } = require('../dist/game/Sounds');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { TemplatedInstanceArea } = require('../dist/game/model/areas/impl/TemplatedInstanceArea');
const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const { crossingFor: shantayCrossingFor } = require('../plugins/areas/shantaypass/Gate.ShantayPass');

const tileKey = (id, x, y, z) => `${id}@${x},${y},${z}`;
let mapCollisionInitialized = false;

async function initializeMapCollisionOnce() {
  if (mapCollisionInitialized) return;
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  RegionManager.init();
  mapCollisionInitialized = true;
}

function buildHarness({ cacheObjects, objectManager: suppliedObjectManager, realMapObjects = false } = {}) {
  const world = new Map();
  const ops = [];
  const sounds = [];
  const submitted = [];

  const originalGet = MapObjects.get;
  const originalSound = Sounds.sendSound;
  const originalGetObject = CacheDefinitions.getObject;
  const originalGetCounts = CacheDefinitions.getCounts;
  if (!realMapObjects) MapObjects.get = (id, location) =>
    world.get(tileKey(id, location.getX(), location.getY(), location.getZ())) ?? null;
  Sounds.sendSound = (...args) => sounds.push(args);
  CacheDefinitions.getObject = (id) => cacheObjects?.get(id) ?? (id === 3743
    ? { name: 'Large door', actions: ['Open'], models: [[14930], [14931]] }
    : id === 3747 ? { name: 'Door', actions: ['Open'], models: [[14928], [14929]] }
    : id === 2394
    ? { name: 'Gate', actions: ['Open'], models: [[1298]] }
    : id === 2606 ? { name: 'Wall', actions: ['Open'], models: [[633]] }
    : id === 8738 || id === 8739
      ? { name: 'Ardougne Wall Door', actions: ['Open'], models: [[1298]] }
      : { name: 'Gate' });
  CacheDefinitions.getCounts = () => ({ npcs: 0, items: 0, objects: cacheObjects ? 62522 : 8740 });

  const handlers = new Map();
  const routes = [];
  const startup = [];
  let regionLoaded;
  let doorToggleHandler = null;
  const customHandlers = new Map();
  const visibleObjectIds = new Map();
  const objectManager = suppliedObjectManager ?? {
    register: (o) => ops.push(['register', o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]),
    deregister: (o) => ops.push(['deregister', o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]),
  };
  const taskManager = { submit: (task) => submitted.push(task), cancelTasks: () => {} };
  const api = {
    // The plugin reads its engine classes from api.core; MapObjects/Sounds/CacheDefinitions
    // are the real classes with the static methods patched above.
    core: {
      CacheDefinitions, GameObject, Location, MapObjects, RegionManager, Sounds, World,
      ObjectIdentifiers: require('../dist/util/ObjectIdentifiers').ObjectIdentifiers,
      ObjectDefinition: { forPlayer: (id) => ({ id: visibleObjectIds.get(id) ?? id, getInteractions: () => CacheDefinitions.getObject(visibleObjectIds.get(id) ?? id)?.actions ?? [] }) },
      Sound: require('../dist/game/Sound').Sound,
      Task: require('../dist/game/task/Task').Task,
      ObjectManager: objectManager,
      TaskManager: taskManager,
    },
    getObjectManager: () => objectManager,
    getTaskManager: () => taskManager,
    emitCustomEvent: (name, event) => {
      if (name === 'door:toggle') doorToggleHandler?.(event);
      customHandlers.get(name)?.(event);
    },
    onCustomEvent: (name, handler) => customHandlers.set(name, handler),
    onObjectInteraction: (name, actions) => handlers.set(name, actions),
    onRegionLoaded: (handler) => { regionLoaded = handler; },
    onObjectRoute: (handler) => routes.push(handler),
    onServerStartup: (handler) => startup.push(handler),
    onPlayerProcess: () => {},
  };
  delete require.cache[require.resolve('../plugins/objects/Doors.plugin')];
  const plugin = require('../plugins/objects/Doors.plugin');
  plugin.register(api);
  for (const handler of startup) handler();

  const place = (id, x, y, face) => {
    const object = new GameObject(id, new Location(x, y, 0), 0, face, null);
    world.set(tileKey(id, x, y, 0), object);
  };

  const click = (id, x, y, face, action = 'Open', name = 'Gate', type = 0, privateArea = null, z = 0) => {
    const object = new GameObject(id, new Location(x, y, z), type, face, privateArea);
    const location = object.getLocation();
    const player = {
      getUsername: () => 'tester',
      isPlayerBot: () => false,
      getPrivateArea: () => privateArea,
      getLocation: () => location,
      getAttribute: () => 0,
      setAttribute: () => {},
      isNeedsPlacement: () => false,
      isAllowRegionChangePacket: () => false,
      getPacketSender: () => ({}),
    };
    ops.length = 0;
    handlers.get(name)[action]({ player, object, objectId: id, clickType: action === 'Open' ? 1 : 2, location: { x, y, z } });
    return ops.splice(0);
  };

  const restore = () => {
    MapObjects.get = originalGet;
    Sounds.sendSound = originalSound;
    CacheDefinitions.getObject = originalGetObject;
    CacheDefinitions.getCounts = originalGetCounts;
  };

  return { place, click, sounds, ops, submitted, handlers, routes, customHandlers, internals: plugin.__internals, regionLoaded: (regionId) => regionLoaded({ regionId }), visibleObjectIds, setDoorToggleHandler: (handler) => { doorToggleHandler = handler; }, restore };
}

test('shared wall-door reach masks cover every operation and preserve other object routing', () => {
  const h = buildHarness();
  try {
    assert.equal(h.routes.length, 1, 'the shared reach hook is installed on startup');
    const route = ({ name = 'Door', shape = 0, face = 0, clickType = 1, blockAccessFlags = 0, destination = null } = {}) => {
      const event = {
        object: new GameObject(30112, new Location(100, 100, 0), shape, face, null),
        sourceLocation: { x: 104, y: 97, z: 0 }, clickType, blockAccessFlags, destination,
        definition: { getName: () => name, getInteractions: () => ['Open', 'Close', 'Pick-lock'] },
      };
      h.routes[0](event);
      return event;
    };
    for (let face = 0; face < 4; face++) {
      for (const [clickType, option] of [[1, 'Open'], [2, 'Close'], [3, 'Pick-lock'], [0, 'item or spell']]) {
        const event = route({ face, clickType });
        assert.equal(event.blockAccessFlags, 0x5, `${option} uses the same local face mask at rotation ${face}`);
        assert.equal(event.destination, null, 'the shared route finder chooses either usable face tile');
      }
    }
    for (const name of ['Door', 'Doors', 'Large door', 'Castle door', 'Cell Door', 'Glass door',
      'Doorway', 'Wall', 'Ardougne Wall Door', 'Oak door', 'Heavy door', 'Tomb Door',
      'Hardwood Grove Doors', 'Gate', 'Metal gate', 'Ancient Gate', 'Sapphire Gate', 'Gate of War']) {
      assert.equal(route({ name }).blockAccessFlags, 0x5, `${name} uses shared wall-door reach`);
    }
    for (const name of ['Ladder', 'Iron ore vein', 'Wardrobe', 'Stained-glass window']) {
      assert.equal(route({ name }).blockAccessFlags, 0, `${name} retains its ordinary wall reach`);
    }
    for (const shape of [2, 4, 9, 10, 11, 22]) {
      assert.equal(route({ shape }).blockAccessFlags, 0, `shape ${shape} retains its existing reach geometry`);
    }
    const questRoute = { x: 300, y: 400, z: 1 };
    assert.equal(route({ destination: questRoute }).destination, questRoute, 'explicit plugin destinations remain intact');
    assert.equal(route({ blockAccessFlags: 0xa }).blockAccessFlags, 0xf, 'the door mask retains prior access restrictions');
  } finally { h.restore(); }
});

test('real Ardougne wall doors retain collision checks at their ends', async () => {
  await initializeMapCollisionOnce();
  const door = MapObjects.get(1535, new Location(2579, 3285, 0), null);
  assert.equal(door.getFace(), 2);
  const h = buildHarness({ realMapObjects: true });
  const finder = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  try {
    const request = { object: door, definition: { getName: () => 'Door' },
      sourceLocation: { x: 2579, y: 3284, z: 0 }, clickType: 1, destination: null };
    h.routes[0](request);
    assert.equal(request.destination, null, 'being adjacent cannot bypass another wall');
    const reachable = (x, y) => finder.reachedAbsolute({
      level: 0, srcX: x, srcY: y, srcSize: 1, destX: 2579, destY: 3285,
      destWidth: 1, destLength: 1, locAngle: door.getFace(), locShape: door.getType(),
      blockAccessFlags: request.blockAccessFlags, privateArea: null,
    });
    assert.equal(reachable(2579, 3284), false, 'the south tile is separated by the castle wall');
    assert.equal(reachable(2580, 3285), true, 'the actual east door face remains usable');
  } finally { h.restore(); }
});

test('base-map doors send private removals before spawns and keep identical instances independent', async () => {
  await initializeMapCollisionOnce();
  const base = MapObjects.get(1535, new Location(3226, 3214, 0), null);
  assert.ok(base.isMapOriginal());
  const definitions = new Map([1535, 1536].map((id) => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const areas = [new PrivateArea(), new PrivateArea()];
  const tuple = (object) => [object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()];
  const players = [...areas, null].map((area) => {
    const packets = [];
    return {
      packets,
      getPrivateArea: () => area,
      getRights: () => 0,
      getSession: () => ({ isTileInScene: () => true }),
      getPacketSender: () => ({
        sendObject: (object) => packets.push(['add', ...tuple(object)]),
        sendObjectRemoval: (object) => packets.push(['del', ...tuple(object)]),
      }),
    };
  });
  const originalBroadcast = World.forEachNetworkPlayer;
  World.forEachNetworkPlayer = (consumer) => players.forEach(consumer);
  const click = (player, object, action = 'Open') => h.handlers.get('Door')[action]({
    player, object, objectId: object.getId(), definition: { id: object.getId() }, location: object.getLocation(),
  });
  const opened = [['del', 1535, 3226, 3214, 2], ['add', 1536, 3227, 3214, 3]];
  const closed = [['del', 1536, 3227, 3214, 3], ['add', 1535, 3226, 3214, 2]];
  try {
    for (const player of players.slice(0, 2)) {
      assert.equal(MapObjects.getPrivateArea(player, 1535, base.getLocation()), base,
        'an ordinary private area initially resolves the shared base-map object');
      click(player, base);
      assert.deepEqual(player.packets.splice(0), opened);
      assert.deepEqual(player.getPrivateArea().getObjects().map(tuple), [[1536, 3227, 3214, 3]],
        'the area holds the current door only, without a synthetic closed snapshot');
    }
    assert.equal(h.submitted.length, 2);
    assert.notEqual(h.submitted[0].key, h.submitted[1].key, 'auto-close tasks are scoped to each instance');
    assert.equal(MapObjects.get(1535, base.getLocation(), null), base, 'opening a private door leaves the shared map intact');
    assert.deepEqual(players[2].packets, [], 'main-world viewers receive no private changes');
    h.regionLoaded(((3226 >> 6) << 8) | (3214 >> 6));
    assert.ok(areas.every((area) => area.getObjects().length === 1), 'shared map reloads do not attach closed snapshot objects');
    ObjectManager.onRegionChange(players[0], 3200, 3200);
    assert.deepEqual(players[0].packets.splice(0), opened, 'scene rebuilds replay the old-tile removal before the open door');

    click(players[0], areas[0].getObjects()[0], 'Close');
    assert.deepEqual(players[0].packets.splice(0), closed);
    assert.deepEqual(areas[0].getObjects().map(tuple), [[1535, 3226, 3214, 2]]);
    assert.deepEqual(areas[1].getObjects().map(tuple), [[1536, 3227, 3214, 3]], 'closing one instance leaves the other open');
    click(players[0], areas[0].getObjects()[0]);
    assert.deepEqual(players[0].packets.splice(0), opened);
    h.submitted[1].execute();
    assert.deepEqual(players[1].packets.splice(0), closed);
    assert.deepEqual(areas[1].getObjects().map(tuple), [[1535, 3226, 3214, 2]]);
    assert.deepEqual(areas[0].getObjects().map(tuple), [[1536, 3227, 3214, 3]], 'the other instance keeps its own close task');
    h.submitted.at(-1).execute();
    assert.deepEqual(players[0].packets.splice(0), closed);
    assert.deepEqual(areas[0].getObjects().map(tuple), [[1535, 3226, 3214, 2]]);
  } finally {
    World.forEachNetworkPlayer = originalBroadcast;
    for (const area of areas) area.destroy();
    h.restore();
  }
});

test('base-map double doors keep their records and auto-close scoped to each private area', async () => {
  await initializeMapCollisionOnce();
  const location = new Location(3287, 3172, 0);
  const base = MapObjects.get(1511, location, null);
  const partner = MapObjects.get(1513, new Location(3287, 3171, 0), null);
  assert.ok(base?.isMapOriginal() && partner?.isMapOriginal());
  const definitions = new Map([1511, 1512, 1513, 1516].map((id) => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const areas = [new PrivateArea(), new PrivateArea()];
  const ids = (area) => area.getObjects().map((object) => object.getId()).sort((a, b) => a - b);
  const click = (area, object, action = 'Open') => h.handlers.get('Large door')[action]({
    player: { getPrivateArea: () => area }, object, objectId: object.getId(), location: object.getLocation(),
  });
  try {
    for (const area of areas) {
      click(area, base);
      assert.deepEqual(ids(area), [1512, 1516], 'only the two open panels remain attached');
    }
    assert.notEqual(h.submitted[0].key, h.submitted[1].key);
    assert.equal(MapObjects.get(1511, location, null), base);
    h.submitted[0].execute();
    assert.deepEqual(ids(areas[0]), [1511, 1513]);
    assert.deepEqual(ids(areas[1]), [1512, 1516]);
    click(areas[1], areas[1].getObjects()[0], 'Close');
    assert.deepEqual(ids(areas[1]), [1511, 1513], 'closing one area still finds its records after another auto-closes');
    click(areas[1], areas[1].getObjects()[0]);
    areas[1].destroy();
    h.submitted.at(-1).execute();
    assert.deepEqual(areas[1].getObjects(), [], 'a delayed auto-close cannot repopulate a destroyed instance');
    assert.ok(!World.getObjects().some((object) => object.getPrivateArea() === areas[1]));
  } finally {
    for (const area of areas) area.destroy();
    h.restore();
  }
});

// --- World-state edge cases: auto-close, runtime records, region reloads ----------------------

const regionOf = (x, y) => ((x >> 6) << 8) | (y >> 6);
const mapCopies = (id, x, y, z = 0) =>
  (MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? []).filter((object) => object.getId() === id).length;
const clipAt = (x, y, area = null) => RegionManager.getClipping(x, y, 0, area);
const sharedPlayer = { getPrivateArea: () => null };
const openWith = (h, player, object, action = 'Open', name = 'Door') => h.handlers.get(name)[action]({
  player, object, objectId: object.getId(), definition: { id: object.getId() }, location: object.getLocation(),
});

test('Cauldron of Thunder prison doors open both cache leaves and restore their collision', async () => {
  await initializeMapCollisionOnce();
  const O = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  const ids = [O.PRISON_DOOR_3, O.PRISON_DOOR_4];
  const definitions = new Map(ids.map(id => [id, CacheDefinitions.getObject(id)]));
  RegionManager.loadMapFiles(2889, 9831);
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const finder = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  const route = (srcX, srcY, destX, destY) => finder.findRoute({
    level: 0, srcX, srcY, srcSize: 1, destX, destY, destWidth: 1, destLength: 1, privateArea: null, moveNear: false,
  }).success;
  const leaf = (id, x, y) => MapObjects.get(id, new Location(x, y, 0), null);
  try {
    assert.ok(h.handlers.get('Prison door')?.Open, 'the cache interaction name must be registered');
    for (const id of ids) {
      assert.equal(definitions.get(id).name, 'Prison door');
      assert.equal(definitions.get(id).actions[0], 'Open');
    }
    for (const y of [9830, 9831]) assert.equal(route(2888, y, 2892, y), false, 'the closed gate blocks the cauldron room');
    for (const clickedId of ids) {
      const y = clickedId === O.PRISON_DOOR_3 ? 9831 : 9830;
      const closed = leaf(clickedId, 2889, y);
      assert.ok(closed, 'the clicked leaf is on the actual dungeon map');
      openWith(h, sharedPlayer, closed, 'Open', 'Prison door');
      const north = leaf(O.PRISON_DOOR_3, 2888, 9831);
      const south = leaf(O.PRISON_DOOR_4, 2888, 9830);
      assert.equal(north?.getFace(), 1);
      assert.equal(south?.getFace(), 3);
      for (const y of [9830, 9831]) {
        assert.equal(route(2888, y, 2892, y), true, 'ordinary pathfinding reaches the cauldron side');
        assert.equal(route(2892, y, 2888, y), true, 'ordinary pathfinding can leave the room');
      }
      assert.equal(h.internals.OPEN_OBJECT_STATES.size, 1);
      if (clickedId === ids[0]) {
        // These cache leaves retain Open while swung out, so the next Open closes them.
        openWith(h, sharedPlayer, south, 'Open', 'Prison door');
      } else {
        assert.equal(h.submitted.at(-1).getDelay(), 500);
        h.submitted.at(-1).execute();
      }
      assert.equal(leaf(ids[0], 2889, 9831)?.getFace(), 0);
      assert.equal(leaf(ids[1], 2889, 9830)?.getFace(), 0);
      assert.equal(mapCopies(ids[0], 2889, 9831), 1);
      assert.equal(mapCopies(ids[1], 2889, 9830), 1);
      assert.equal(h.internals.OPEN_OBJECT_STATES.size, 0);
      assert.equal(route(2888, 9831, 2892, 9831), false, 'closing restores the wall collision');
    }
  } finally {
    if (h.internals.OPEN_OBJECT_STATES.size) h.submitted.at(-1).execute();
    h.restore();
  }
});

test('other prison doors retain their dedicated unlock handlers', async () => {
  await initializeMapCollisionOnce();
  const O = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  const ids = [O.PRISON_DOOR_3, O.PRISON_DOOR_4, O.PRISON_DOOR_5, O.PRISON_DOOR_6];
  const h = buildHarness({ cacheObjects: new Map(ids.map(id => [id, CacheDefinitions.getObject(id)])) });
  try {
    for (const id of [O.PRISON_DOOR_5, O.PRISON_DOOR_6]) {
      const object = new GameObject(id, new Location(3297, 3124, 0), 0, 2, null);
      const event = { player: sharedPlayer, object, objectId: id, location: object.getLocation() };
      assert.equal(h.handlers.get('Prison door').Open(event), false, 'no generic prison unlock is invented');
      h.setDoorToggleHandler(request => { request.handled = true; });
      assert.equal(h.handlers.get('Prison door').Open(event), true, 'a dedicated door handler still owns its gate');
      assert.deepEqual(h.ops, [], 'ordinary door handling does not move a dedicated gate');
      h.setDoorToggleHandler(null);
    }
  } finally { h.restore(); }
});

test('an untouched open double door closes itself after 500 ticks and never duplicates its records', () => {
  const h = buildHarness();
  const { OPEN_OBJECT_STATES: states, RUNTIME_DOUBLE_DOOR_RECORDS: records } = h.internals;
  try {
    h.place(1727, 3100, 3500, 1);
    h.place(1728, 3101, 3500, 1);
    for (let round = 0; round < 3; round++) {
      assert.deepEqual(h.click(1728, 3101, 3500, 1).slice(2), [
        ['register', 1571, 3100, 3501, 0], ['register', 1572, 3101, 3501, 2],
      ]);
      if (round === 1) {
        // Closing and opening by hand in between reuses the same two records.
        h.click(1571, 3100, 3501, 0, 'Close');
        assert.equal(records.length, 2);
        h.click(1728, 3101, 3500, 1);
      }
      assert.equal(records.length, 2, 'one record per leaf');
      const task = h.submitted.at(-1);
      assert.equal(task.getDelay(), 500);
      task.setRunning(true);
      for (let tick = 1; tick < 500; tick++) task.tick();
      assert.deepEqual(h.ops, [], 'still open after 499 ticks');
      assert.equal(states.size, 1);
      task.tick();
      assert.deepEqual(h.ops.splice(0), [
        ['deregister', 1571, 3100, 3501, 0], ['deregister', 1572, 3101, 3501, 2],
        ['register', 1727, 3100, 3500, 1], ['register', 1728, 3101, 3500, 1],
      ], 'the 500th tick swings both leaves shut');
      assert.ok(task.isStopped());
      assert.equal(states.size, 0);
      assert.equal(records.length, 0, 'auto-close leaves no records behind');
    }
  } finally {
    h.restore();
  }
});

test('a family leaf with no partner on its left or right keeps no runtime records', () => {
  const h = buildHarness();
  try {
    // 1551/1552 pair by id offset (left = id - 3 a tile south at face 0), so a 1552 to the east is no partner.
    h.place(1551, 3300, 3500, 0);
    h.place(1552, 3301, 3500, 0);
    for (let click = 0; click < 3; click++) {
      assert.deepEqual(h.click(1551, 3300, 3500, 0), []);
      assert.equal(h.internals.RUNTIME_DOUBLE_DOOR_RECORDS.length, 0);
    }
  } finally {
    h.restore();
  }
});

test('closing a door whose records are already gone leaves other doors\' records alone', () => {
  const ops = [];
  let duringDeregister = null;
  const tuple = (o) => [o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()];
  const objectManager = {
    register: (o) => ops.push(['register', ...tuple(o)]),
    deregister: (o) => {
      ops.push(['deregister', ...tuple(o)]);
      const hook = duringDeregister;
      duringDeregister = null;
      hook?.();
    },
  };
  const h = buildHarness({ objectManager });
  const records = h.internals.RUNTIME_DOUBLE_DOOR_RECORDS;
  const area = new PrivateArea();
  try {
    for (const x of [3100, 3200]) {
      h.place(1727, x, 3500, 1);
      h.place(1728, x + 1, 3500, 1);
      h.click(1728, x + 1, 3500, 1, 'Open', 'Gate', 0, area);
    }
    const firstAutoClose = h.submitted[0];
    assert.equal(records.length, 4);
    // The first gate's auto-close runs (and forgets its records) while its Close swaps the leaves.
    duringDeregister = () => firstAutoClose.execute();
    h.click(1571, 3100, 3501, 0, 'Close', 'Gate', 0, area);
    assert.deepEqual(records.map((record) => record.originalX).sort(), [3200, 3201],
      'an index of -1 must not splice the other gate\'s records');
    ops.length = 0;
    h.click(1571, 3200, 3501, 0, 'Close', 'Gate', 0, area);
    assert.deepEqual(ops.filter(([op]) => op === 'register'), [
      ['register', 1727, 3200, 3500, 1], ['register', 1728, 3201, 3500, 1],
    ], 'the other gate still closes from its own records');
    assert.equal(records.length, 0);
  } finally {
    area.destroy();
    h.restore();
  }
});

test('a shared door stays open with open collision across a region reload, then auto-closes', async () => {
  await initializeMapCollisionOnce();
  const definitions = new Map([1535, 1536].map((id) => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const region = regionOf(3226, 3214);
  const base = MapObjects.get(1535, new Location(3226, 3214, 0), null);
  const tiles = [[3226, 3214], [3227, 3214], [3227, 3213]];
  const clips = () => tiles.map(([x, y]) => clipAt(x, y));
  try {
    const closedClips = clips();
    openWith(h, sharedPlayer, base);
    const openClips = clips();
    assert.notDeepEqual(openClips, closedClips);
    for (let reload = 0; reload < 2; reload++) {
      assert.ok(RegionManager.reloadRegion(region));
      h.regionLoaded(region);
      assert.equal(mapCopies(1535, 3226, 3214), 0, 'the reloaded closed door is hidden again');
      assert.equal(mapCopies(1536, 3227, 3214), 1, 'the open leaf is back exactly once');
      assert.deepEqual(clips(), openClips, 'collision matches the open door, not the closed one');
    }
    assert.ok(World.getObjects().some((object) => object.getId() === 1536), 'players still see it open');
    h.submitted.at(-1).execute();
    assert.equal(mapCopies(1535, 3226, 3214), 1);
    assert.equal(mapCopies(1536, 3227, 3214), 0);
    assert.deepEqual(clips(), closedClips, 'auto-close restores the closed collision');
  } finally {
    h.restore();
  }
});

test('an ordinary reload whose world-object replay already hid the closed door keeps the open door', async () => {
  await initializeMapCollisionOnce();
  const definitions = new Map([1535, 1536].map((id) => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const region = regionOf(3226, 3214);
  const at = (object, x, y) => object.getLocation().getX() === x && object.getLocation().getY() === y;
  try {
    openWith(h, sharedPlayer, MapObjects.get(1535, new Location(3226, 3214, 0), null));
    assert.ok(RegionManager.reloadRegion(region));
    // Core's replay ran during the load, before the doors hook below.
    assert.equal(mapCopies(1535, 3226, 3214), 0, 'the replay already took the closed leaf out');
    const closed = World.getRemovedObjects().find((object) => object.getId() === 1535 && at(object, 3226, 3214));
    assert.ok(closed && RegionManager.wasRemovedOnLoad(1535, closed.getType(), closed.getFace(), 3226, 3214, 0),
      'the region remembers that its load placed the closed leaf');
    h.regionLoaded(region);
    assert.equal(h.internals.OPEN_OBJECT_STATES.size, 1, 'the door is not mistaken for a map replacement');
    assert.equal(mapCopies(1536, 3227, 3214), 1, 'the open leaf stays exactly once');
    assert.ok(World.getRemovedObjects().some((object) => object.getId() === 1535 && at(object, 3226, 3214)),
      'the closed leaf stays removed for players');
    h.submitted.at(-1).execute();
    assert.equal(mapCopies(1535, 3226, 3214), 1, 'auto-close still brings the closed leaf back');
    assert.equal(mapCopies(1536, 3227, 3214), 0);
  } finally {
    h.restore();
  }
});

test('a door open across a region boundary is re-applied once as either region loads', async () => {
  await initializeMapCollisionOnce();
  const definitions = new Map([1535, 1536].map((id) => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  // No cache door swings across a region edge, so place one on the last column of a region
  // whose eastern neighbour is not loaded yet.
  // The Ardougne end-clipping test also loads the next eastern region; use its next boundary.
  const [x, y] = [2687, 3300];
  const west = regionOf(x, y);
  const east = regionOf(x + 1, y);
  try {
    RegionManager.loadMapFiles(x, y, false);
    assert.ok(RegionManager.getRegionid(west).isLoaded() && !RegionManager.getRegionid(east).isLoaded());
    RegionManager.addObject(1535, x, y, 0, 0, 2);
    openWith(h, sharedPlayer, MapObjects.get(1535, new Location(x, y, 0), null));
    assert.equal(mapCopies(1536, x + 1, y), 1, 'the open leaf lands in the unloaded region');
    RegionManager.loadMapFiles(x + 1, y, false);
    h.regionLoaded(east);
    assert.equal(mapCopies(1536, x + 1, y), 1, 'its first load adds no second copy');
    assert.equal(mapCopies(1535, x, y), 0);
    const openClip = clipAt(x + 1, y);
    assert.ok(RegionManager.reloadRegion(east));
    h.regionLoaded(east);
    assert.equal(mapCopies(1536, x + 1, y), 1, 'reloading the open leaf\'s region puts it back once');
    assert.equal(clipAt(x + 1, y), openClip);
    h.submitted.at(-1).execute();
    assert.equal(mapCopies(1536, x + 1, y), 0);
    assert.equal(mapCopies(1535, x, y), 1);
  } finally {
    h.restore();
    RegionManager.reloadRegion(west); // drop the placed door
  }
});

test('a region replacement without the door drops its open leaves instead of restoring them', async () => {
  await initializeMapCollisionOnce();
  const { MapRegionReplacementManager } = require('../dist/game/collision/MapRegionReplacementManager');
  const { CacheMaps } = require('../dist/game/cache/CacheMaps');
  const definitions = new Map([1535, 1536].map((id) => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const region = regionOf(3226, 3214);
  const at = (object, x, y) => object.getLocation().getX() === x && object.getLocation().getY() === y;
  const originalReplacement = MapRegionReplacementManager.getReplacementMapData;
  try {
    openWith(h, sharedPlayer, MapObjects.get(1535, new Location(3226, 3214, 0), null));
    assert.ok(World.getRemovedObjects().some((object) => object.getId() === 1535 && at(object, 3226, 3214)));
    // The replacement keeps the terrain and places no objects at all.
    MapRegionReplacementManager.getReplacementMapData = (regionId) => regionId === region
      ? { terrainData: CacheMaps.getRegion(regionId).terrainData, objectData: Uint8Array.of(0) }
      : originalReplacement.call(MapRegionReplacementManager, regionId);
    assert.ok(RegionManager.reloadRegion(region));
    h.regionLoaded(region);
    assert.equal(h.internals.OPEN_OBJECT_STATES.size, 0, 'the door is forgotten');
    assert.equal(mapCopies(1536, 3227, 3214), 0, 'no stale open leaf on the new map');
    assert.ok(!World.getObjects().some((object) => object.getId() === 1536 && at(object, 3227, 3214)),
      'players no longer see the open leaf');
    assert.ok(!World.getRemovedObjects().some((object) => object.getId() === 1535 && at(object, 3226, 3214)),
      'no removal is replayed for a door the map no longer has');
    h.submitted.at(-1).execute();
    assert.equal(mapCopies(1535, 3226, 3214), 0, 'the old auto-close cannot bring the removed door back');
  } finally {
    MapRegionReplacementManager.getReplacementMapData = originalReplacement;
    RegionManager.reloadRegion(region);
    h.restore();
  }
});

test('a private-area door keeps its own objects and collision through a shared region reload', async () => {
  await initializeMapCollisionOnce();
  const definitions = new Map([1535, 1536].map((id) => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const region = regionOf(3226, 3214);
  const base = MapObjects.get(1535, new Location(3226, 3214, 0), null);
  const area = new PrivateArea();
  const player = { getPrivateArea: () => area };
  const tuple = (object) => [object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()];
  const tiles = [[3226, 3214], [3227, 3214], [3227, 3213]];
  try {
    const sharedClips = tiles.map(([x, y]) => clipAt(x, y));
    openWith(h, player, base);
    const areaClips = tiles.map(([x, y]) => clipAt(x, y, area));
    assert.ok(RegionManager.reloadRegion(region));
    h.regionLoaded(region);
    assert.deepEqual(area.getObjects().map(tuple), [[1536, 3227, 3214, 3]], 'the area still holds only its open door');
    assert.deepEqual(tiles.map(([x, y]) => clipAt(x, y, area)), areaClips, 'the area keeps its open collision');
    assert.equal(mapCopies(1535, 3226, 3214), 1, 'the shared map keeps one closed door');
    assert.equal(mapCopies(1536, 3227, 3214), 0, 'the private open leaf never reaches the shared map');
    assert.deepEqual(tiles.map(([x, y]) => clipAt(x, y)), sharedClips);
    h.submitted.at(-1).execute();
    assert.deepEqual(area.getObjects().map(tuple), [[1535, 3226, 3214, 2]]);
  } finally {
    area.destroy();
    h.restore();
  }
});

test('captured door portals can hand off before the ordinary door swing', () => {
  const h = buildHarness({ cacheObjects: new Map([
    [25341, { name: 'Mithril door', actions: ['Open'], models: [[26771]] }],
    [32208, { name: 'Mithril door', actions: ['Open'], models: [[26771]] }],
  ]) });
  try {
    assert.ok(h.handlers.get('Mithril door')?.Open,
      'the cache-specific door name enters the ordinary toggle path');
    const claimed = [];
    h.setDoorToggleHandler((request) => {
      if (request.objectId === 25341 && request.object.getLocation().getX() === 1759 && request.clickType === 1) {
        request.handled = true;
        claimed.push('entry');
      }
    });
    assert.deepEqual(h.click(25341, 1759, 5343, 3, 'Open', 'Mithril door', 0, null, 1), [],
      'a loc-teleport route claims the portal before local swing behavior');
    assert.deepEqual(claimed, ['entry']);
    h.setDoorToggleHandler(null);
    assert.deepEqual(h.click(25341, 1631, 5343, 3, 'Open', 'Mithril door', 0, null, 1), [],
      'an unrelated cache placement is not given a speculative DS2 door override');
  } finally {
    h.restore();
  }
});

test('cache-named ground doors open and close when the open loc precedes the closed loc', async () => {
  await initializeMapCollisionOnce();
  const closedId = CacheDefinitions.getLocId('canafis_door_ground');
  const openId = CacheDefinitions.getLocId('canafis_door_ground_open');
  const closed = CacheDefinitions.getObject(closedId);
  const open = CacheDefinitions.getObject(openId);
  assert.equal(closedId, 24369);
  assert.equal(openId, 24368);
  assert.equal(closed.actions[0], 'Open');
  assert.equal(open.actions[0], 'Close');
  assert.deepEqual(closed.models, open.models);

  const h = buildHarness({ cacheObjects: new Map([[closedId, closed], [openId, open]]) });
  try {
    for (let face = 0; face < 4; face++) {
      const opening = h.click(closedId, 1237, 3683, face, 'Open', 'Door');
      assert.ok(opening.some(([action, id]) => action === 'deregister' && id === closedId));
      const leaf = opening.find(([action, id]) => action === 'register' && id === openId);
      assert.ok(leaf, `rotation ${face} uses the cache-named open variant`);
      const closing = h.click(openId, leaf[2], leaf[3], leaf[4], 'Close', 'Door');
      assert.ok(closing.some(([action, id]) => action === 'deregister' && id === openId));
      assert.deepEqual(closing.find(([action, id]) => action === 'register' && id === closedId),
        ['register', closedId, 1237, 3683, face], 'closing restores the original tile and rotation');
    }
  } finally {
    h.restore();
  }
});

test('Lassar blue-key room door uses its cache Close variant after the unused loc id', async () => {
  await initializeMapCollisionOnce();
  const closed = CacheDefinitions.getObject(48274);
  const open = CacheDefinitions.getObject(48276);
  assert.equal(closed.name, 'Door');
  assert.equal(closed.actions[0], 'Open');
  assert.equal(open.name, 'Door');
  assert.equal(open.actions[0], 'Close');

  const h = buildHarness({ cacheObjects: new Map([[48274, closed], [48275, CacheDefinitions.getObject(48275)], [48276, open]]) });
  try {
    h.place(48274, 2422, 6442, 3);
    const operations = h.click(48274, 2422, 6442, 3, 'Open', 'Door');
    assert.ok(operations.some(([action, id]) => action === 'deregister' && id === 48274),
      'opening replaces the closed cache loc');
    assert.ok(operations.some(([action, id]) => action === 'register' && id === 48276),
      'opening uses the real Close-action partner, skipping actionless 48275');
  } finally {
    h.restore();
  }
});

test('Ghorrock Prison’s keyed western gate uses its cache-supported self-opening swing', async () => {
  await initializeMapCollisionOnce();
  const id = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers.GATE_282;
  const definition = CacheDefinitions.getObject(id);
  assert.equal(definition.name, 'Gate');
  assert.equal(definition.actions[0], 'Open');
  assert.equal(CacheDefinitions.getObject(id + 1)?.name, 'Crate', 'the gate has no cache open partner');
  const h = buildHarness({ cacheObjects: new Map([[id, definition]]) });
  try {
    const opened = h.click(id, 8343, 1689, 3);
    assert.deepEqual(opened, [
      ['deregister', id, 8343, 1689, 3],
      ['register', id, 8343, 1688, 0],
    ], 'opening rotates the same loc out of the doorway');
    const closed = h.click(id, 8343, 1688, 0);
    assert.deepEqual(closed, [
      ['deregister', id, 8343, 1688, 0],
      ['register', id, 8343, 1689, 3],
    ], 'the open gate can swing shut again through the normal door plugin');
  } finally {
    h.restore();
  }
});

test('the DT2 final-cell Gate swings to its actionless same-model loc after the lock opens', async () => {
  await initializeMapCollisionOnce();
  const O = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  const closed = CacheDefinitions.getObject(O.GATE_270);
  const open = CacheDefinitions.getObject(O.GATE_271);
  assert.equal(closed.name, 'Gate');
  assert.equal(closed.actions[0], 'Open');
  assert.ok(open.actions.every(action => !action), 'the open cache variant has no Close action');
  assert.deepEqual(open.models, closed.models, 'both locs use the cache model for this swinging Gate');

  const h = buildHarness({ cacheObjects: new Map([[O.GATE_270, closed], [O.GATE_271, open]]) });
  try {
    assert.deepEqual(h.click(O.GATE_270, 3107, 9248, 1), [
      ['deregister', O.GATE_270, 3107, 9248, 1],
      ['register', O.GATE_270, 3107, 9249, 2],
    ], 'the normal door handler rotates the same Gate out of the doorway');
  } finally {
    h.restore();
  }
});

test('Slepe church crypt gate opens through its actionless cache partner', async () => {
  await initializeMapCollisionOnce();
  const { GATE_210: closedId, GATE_211: openId } = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  const closed = CacheDefinitions.getObject(closedId);
  const opened = CacheDefinitions.getObject(openId);
  assert.equal(closed.name, 'Gate');
  assert.deepEqual(closed.actions.slice(0, 1), ['Open']);
  assert.equal(opened.name, 'Gate');
  assert.ok(opened.actions.every(action => !action), 'the open cache loc has no action for auto-pair discovery');
  assert.deepEqual(opened.models, closed.models);

  const h = buildHarness({ cacheObjects: new Map([[closedId, closed], [openId, opened]]) });
  try {
    // The placed loc's cache rotation is 1; opening swings its replacement north.
    assert.deepEqual(h.click(closedId, 3728, 9752, 1), [
      ['deregister', closedId, 3728, 9752, 1],
      ['register', openId, 3728, 9753, 2],
    ]);
  } finally {
    h.restore();
  }
});

test('Kourend Crypt cached Large doors keep their real double-leaf geometry and clear the plane-1 threshold', async () => {
  await initializeMapCollisionOnce();
  const cachedDoors = new Map([32404, 32405, 32406, 32407].map((id) => [
    id,
    CacheDefinitions.getObject(id),
  ]));
  for (const id of cachedDoors.keys()) {
    const definition = cachedDoors.get(id);
    assert.equal(definition.name, 'Large doors');
    assert.equal(definition.actions[0], 'Open');
    assert.deepEqual(definition.models, [[6623]]);
  }

  const area = new TemplatedInstanceArea(12, 8);
  for (let chunkX = 0; chunkX < 12; chunkX++) {
    for (let chunkY = 0; chunkY < 8; chunkY++) {
      area.setChunk(1, chunkX, chunkY, { sourceChunkX: 184 + chunkX, sourceChunkY: 1240 + chunkY, sourcePlane: 1, rotation: 0 });
    }
  }
  const x = area.getBaseX() + 31;
  const y = area.getBaseY() + 36;
  const upperY = area.getBaseY() + 24;
  const closedLowerCrossing = RegionManager.canMove(x, y, x, y + 1, 1, 1, 1, area);
  const closedUpperCrossing = RegionManager.canMove(x + 1, upperY - 1, x + 1, upperY, 1, 1, 1, area);
  const h = buildHarness({ cacheObjects: cachedDoors, objectManager: ObjectManager });
  const routes = new RsmodRouteFinding();
  const route = (startY, endY) => routes.findRoute({
    level: 1, srcX: x, srcY: startY, srcSize: 1, destX: x, destY: endY, privateArea: area, moveNear: false,
  });
  try {
    assert.ok(h.handlers.get('Large doors')?.Open, 'the plural cache name must be registered');
    const crossing = () => RegionManager.canMove(x, y, x, y + 1, 1, 1, 1, area);
    assert.equal(closedLowerCrossing, false, 'the closed shape-0 leaves block the real source-map approach edge');
    assert.equal(RegionManager.canMove(x, y - 2, x, y + 2, 1, 1, 1, area), false,
      'the closed lower leaves block the complete south-to-north route');
    assert.equal(RegionManager.canMove(x, y + 2, x, y - 2, 1, 1, 1, area), false,
      'the closed lower leaves block the complete north-to-south route');
    const westLeaf = area.resolveObject(32406, new Location(x, y, 1));
    assert.ok(westLeaf, 'the west cached leaf is resolved from the template, not MapObjects');
    const player = { getPrivateArea: () => area, getUsername: () => 'tester' };
    h.handlers.get('Large doors').Open({ player, object: westLeaf, objectId: 32406, location: westLeaf.getLocation() });
    assert.equal(crossing(), true, 'opening both cached leaves removes their original clipping and leaves the route walkable');
    const lowerApproach = y - 2;
    const lowerExit = y + 2;
    assert.equal(area.getClip(new Location(x, lowerExit, 1)) & RegionManager.BLOCKED_TILE, 0,
      'the cache terrain tile beyond the swung row at source y=9958 is not itself blocked');
    assert.equal(RegionManager.canMove(x, lowerApproach, x, lowerExit, 1, 1, 1, area), true,
      'the complete four-step south-to-north approach stays open beyond the swung leaves');
    assert.equal(RegionManager.canMove(x, lowerExit, x, lowerApproach, 1, 1, 1, area), true,
      'the complete four-step north-to-south return route also stays open');
    assert.equal(route(lowerApproach, lowerExit).success, true,
      'the normal route finder can reach beyond the swung lower leaves from the south');
    assert.equal(route(lowerExit, lowerApproach).success, true,
      'the normal route finder can return beyond the swung lower leaves from the north');

    const movedLeaves = area.getObjects().filter((object) => [32406, 32407].includes(object.getId()));
    assert.deepEqual(movedLeaves.map((object) => [object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]).sort(), [
      [32406, x, y + 1, 0],
      [32407, x + 1, y + 1, 2],
    ]);
    assert.ok(movedLeaves.every((object) => object.getPrivateArea() === area), 'open panels remain private to this crypt instance');

    const upperCrossing = () => RegionManager.canMove(x + 1, upperY - 1, x + 1, upperY, 1, 1, 1, area);
    assert.equal(closedUpperCrossing, false, 'the rotation-3 upper pair blocks the opposite approach edge');
    assert.equal(RegionManager.canMove(x + 1, upperY - 2, x + 1, upperY + 2, 1, 1, 1, area), false,
      'the closed upper leaves block the complete south-to-north route');
    assert.equal(RegionManager.canMove(x + 1, upperY + 2, x + 1, upperY - 2, 1, 1, 1, area), false,
      'the closed upper leaves block the complete north-to-south route');
    const upperWestLeaf = area.resolveObject(32405, new Location(x, upperY, 1));
    h.handlers.get('Large doors').Open({ player, object: upperWestLeaf, objectId: 32405, location: upperWestLeaf.getLocation() });
    assert.equal(upperCrossing(), true, 'the rotation-3 pair also opens its template collision gap');
    assert.equal(RegionManager.canMove(x + 1, upperY - 2, x + 1, upperY + 2, 1, 1, 1, area), true,
      'the complete four-step south-to-north upper approach stays open beyond the swung leaves');
    assert.equal(RegionManager.canMove(x + 1, upperY + 2, x + 1, upperY - 2, 1, 1, 1, area), true,
      'the complete upper north-to-south return route also stays open');

    const closeTask = h.submitted.at(-1);
    closeTask.execute();
    assert.equal(upperCrossing(), false, 'the ordinary auto-close restores both cached leaves and their collision');
    const closedLeaves = area.getObjects().filter((object) => [32404, 32405].includes(object.getId()));
    assert.equal(closedLeaves.length, 2);
    assert.ok(closedLeaves.every((object) => object.getPrivateArea() === area), 'auto-close keeps both leaves in the private instance');
  } finally {
    area.destroy();
    h.restore();
  }
});


test('Tree Gnome Stronghold doors use their nameless open variants and restore on auto-close', () => {
  const h = buildHarness();
  try {
    for (const [closed, open, x, face, openX, openFace] of [
      [1967, 1969, 2464, 0, 2463, 1], [1968, 1970, 2466, 2, 2467, 3],
    ]) {
      assert.deepEqual(h.click(closed, x, 3492, face, 'Open', 'Tree Door', 10), [
        ['deregister', closed, x, 3492, face], ['register', open, openX, 3492, openFace],
      ]);
      h.submitted.at(-1).execute();
      assert.deepEqual(h.ops.splice(0), [
        ['deregister', open, openX, 3492, openFace], ['register', closed, x, 3492, face],
      ]);
    }
  } finally {
    h.restore();
  }
});

test('Ardougne Wall Doors are registered and swing by rotating the same loc', () => {
  const h = buildHarness();
  try {
    h.place(8738, 2557, 3299, 0);
    assert.deepEqual(h.click(8738, 2557, 3299, 0, 'Open', 'Ardougne Wall Door'), [
      ['deregister', 8738, 2557, 3299, 0], ['register', 8738, 2556, 3299, 1],
    ]);
    assert.deepEqual(h.click(8738, 2557, 3299, 0, 'Open', 'Ardougne Wall Door'), [
      ['deregister', 8738, 2556, 3299, 1], ['register', 8738, 2557, 3299, 0],
    ]);
  } finally {
    h.restore();
  }
});

test('Tree Gnome Stronghold main gate handles packet coordinates, opens both leaves and auto-closes', () => {
  const h = buildHarness();
  try {
    assert.deepEqual(h.click(190, 2459, 3383, 2, 'Open', 'Gate', 10), [
      ['deregister', 190, 2459, 3383, 2],
      ['register', 191, 2459, 3383, 2], ['register', 192, 2462, 3383, 0],
    ]);
    h.submitted.at(-1).execute();
    assert.deepEqual(h.ops.splice(0), [
      ['deregister', 191, 2459, 3383, 2], ['deregister', 192, 2462, 3383, 0],
      ['register', 190, 2459, 3383, 2],
    ]);
  } finally {
    h.restore();
  }
});

test('wooden gate swings hinge + extension panels open from a closed hinge click', () => {
  const h = buildHarness();
  try {
    h.place(12986, 100, 100, 0);
    h.place(12987, 100, 101, 0);
    const ops = h.click(12986, 100, 100, 0);
    assert.deepEqual(ops, [
      ['deregister', 12986, 100, 100, 0],
      ['deregister', 12987, 100, 101, 0],
      ['register', 12988, 99, 100, 3],
      ['register', 12989, 98, 100, 3],
    ]);
    assert.equal(h.sounds.length, 1, 'gate open should play a sound');
  } finally {
    h.restore();
  }
});

test('clicking the closed extension opens the same way as the hinge', () => {
  const h = buildHarness();
  try {
    h.place(12986, 100, 100, 0);
    h.place(12987, 100, 101, 0);
    const ops = h.click(12987, 100, 101, 0);
    assert.deepEqual(ops, [
      ['deregister', 12986, 100, 100, 0],
      ['deregister', 12987, 100, 101, 0],
      ['register', 12988, 99, 100, 3],
      ['register', 12989, 98, 100, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('open wooden gate closes back onto its original tiles', () => {
  const h = buildHarness();
  try {
    h.place(12988, 99, 100, 3);
    h.place(12989, 98, 100, 3);
    const ops = h.click(12988, 99, 100, 3);
    assert.deepEqual(ops, [
      ['deregister', 12988, 99, 100, 3],
      ['deregister', 12989, 98, 100, 3],
      ['register', 12986, 100, 100, 0],
      ['register', 12987, 100, 101, 0],
    ]);
  } finally {
    h.restore();
  }
});

test('wooden gate open + close round-trips for a north-facing (rotation 1) gate', () => {
  const h = buildHarness();
  try {
    h.place(12986, 200, 200, 1);
    h.place(12987, 201, 200, 1);
    const opened = h.click(12986, 200, 200, 1);
    assert.deepEqual(opened, [
      ['deregister', 12986, 200, 200, 1],
      ['deregister', 12987, 201, 200, 1],
      ['register', 12988, 200, 201, 0],
      ['register', 12989, 200, 202, 0],
    ]);
    h.place(12988, 200, 201, 0);
    h.place(12989, 200, 202, 0);
    const closed = h.click(12988, 200, 201, 0);
    assert.deepEqual(closed, [
      ['deregister', 12988, 200, 201, 0],
      ['deregister', 12989, 200, 202, 0],
      ['register', 12986, 200, 200, 1],
      ['register', 12987, 201, 200, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('newly catalogued gates (47/48, 883/23917, 15514/15516) swing to their open ids', () => {
  const h = buildHarness();
  try {
    h.place(47, 300, 300, 0);
    h.place(48, 300, 301, 0);
    assert.deepEqual(h.click(47, 300, 300, 0), [
      ['deregister', 47, 300, 300, 0],
      ['deregister', 48, 300, 301, 0],
      ['register', 49, 299, 300, 3],
      ['register', 50, 298, 300, 3],
    ]);

    h.place(883, 310, 310, 0);
    h.place(23917, 310, 311, 0);
    assert.deepEqual(h.click(883, 310, 310, 0), [
      ['deregister', 883, 310, 310, 0],
      ['deregister', 23917, 310, 311, 0],
      ['register', 23918, 309, 310, 3],
      ['register', 23919, 308, 310, 3],
    ]);

    h.place(15514, 320, 320, 0);
    h.place(15516, 320, 321, 0);
    assert.deepEqual(h.click(15514, 320, 320, 0), [
      ['deregister', 15514, 320, 320, 0],
      ['deregister', 15516, 320, 321, 0],
      ['register', 15511, 319, 320, 3],
      ['register', 15513, 318, 320, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('gates with a Release action swing open (60763/60760)', () => {
  const h = buildHarness();
  try {
    h.place(60763, 400, 400, 0);
    h.place(60760, 400, 401, 0);
    assert.deepEqual(h.click(60763, 400, 400, 0, 'Release'), [
      ['deregister', 60763, 400, 400, 0],
      ['deregister', 60760, 400, 401, 0],
      ['register', 60761, 399, 400, 3],
      ['register', 60762, 398, 400, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('Castle Wars large doors swing both leaves to the open ids and back', () => {
  const h = buildHarness();
  try {
    // Saradomin: west leaf 4423 / east 4424, one row south when open.
    h.place(4423, 2426, 3088, 3);
    h.place(4424, 2427, 3088, 3);
    assert.deepEqual(h.click(4423, 2426, 3088, 3, 'Open', 'Large door'), [
      ['deregister', 4423, 2426, 3088, 3],
      ['deregister', 4424, 2427, 3088, 3],
      ['register', 4425, 2426, 3087, 0],
      ['register', 4426, 2427, 3087, 2],
    ], 'west leaf is left: it opens to face 0, the east leaf mirrors to face 2');
    h.place(4425, 2426, 3087, 0);
    h.place(4426, 2427, 3087, 2);
    assert.deepEqual(h.click(4425, 2426, 3087, 0, 'Close', 'Large door'), [
      ['deregister', 4425, 2426, 3087, 0],
      ['deregister', 4426, 2427, 3087, 2],
      ['register', 4423, 2426, 3088, 3],
      ['register', 4424, 2427, 3088, 3],
    ]);

    // Zamorak: ids run east to west, so 4428 is the west/left leaf.
    h.place(4428, 2372, 3119, 1);
    h.place(4427, 2373, 3119, 1);
    assert.deepEqual(h.click(4428, 2372, 3119, 1, 'Open', 'Large door'), [
      ['deregister', 4428, 2372, 3119, 1],
      ['deregister', 4427, 2373, 3119, 1],
      ['register', 4430, 2372, 3120, 0],
      ['register', 4429, 2373, 3120, 2],
    ]);
    h.place(4430, 2372, 3120, 0);
    h.place(4429, 2373, 3120, 2);
    assert.deepEqual(h.click(4430, 2372, 3120, 0, 'Close', 'Large door'), [
      ['deregister', 4430, 2372, 3120, 0],
      ['deregister', 4429, 2373, 3120, 2],
      ['register', 4428, 2372, 3119, 1],
      ['register', 4427, 2373, 3119, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('Paterdomus chapel entrance swings both cached leaves into its nameless open locs', () => {
  const ids = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  const cacheObjects = new Map([
    [ids.LARGE_DOOR_21, { name: 'Large door', actions: ['Open'], models: [[3544]] }],
    [ids.LARGE_DOOR_22, { name: 'Large door', actions: ['Open'], models: [[3544]] }],
    [3491, { name: null, actions: [null], models: [[3544]] }],
    [3492, { name: null, actions: [null], models: [[3544]] }],
  ]);
  const h = buildHarness({ cacheObjects });
  try {
    h.place(3490, 3408, 3488, 2);
    h.place(3489, 3408, 3489, 2);
    assert.deepEqual(h.click(3490, 3408, 3488, 2, 'Open', 'Large door'), [
      ['deregister', 3489, 3408, 3489, 2],
      ['deregister', 3490, 3408, 3488, 2],
      ['register', 3491, 3409, 3489, 1],
      ['register', 3492, 3409, 3488, 3],
    ], 'the north and south leaves swing east into their real cache open variants');
  } finally {
    h.restore();
  }
});

test('1727/1728 metal gates open from either leaf order (west leaf is left)', () => {
  // Both open into the shared 1571/1572 leaves.
  const h = buildHarness();
  try {
    // Usual order: 1727 west of 1728.
    h.place(1727, 3100, 3500, 1);
    h.place(1728, 3101, 3500, 1);
    assert.deepEqual(h.click(1728, 3101, 3500, 1), [
      ['deregister', 1727, 3100, 3500, 1],
      ['deregister', 1728, 3101, 3500, 1],
      ['register', 1571, 3100, 3501, 0],
      ['register', 1572, 3101, 3501, 2],
    ]);

    // Reversed: 1728 west of 1727 must still swing the west leaf as the left one, open and closed.
    h.place(1728, 3200, 3500, 1);
    h.place(1727, 3201, 3500, 1);
    assert.deepEqual(h.click(1727, 3201, 3500, 1), [
      ['deregister', 1728, 3200, 3500, 1],
      ['deregister', 1727, 3201, 3500, 1],
      ['register', 1572, 3200, 3501, 0],
      ['register', 1571, 3201, 3501, 2],
    ]);
    h.place(1572, 3200, 3501, 0);
    h.place(1571, 3201, 3501, 2);
    assert.deepEqual(h.click(1571, 3201, 3501, 2, 'Close'), [
      ['deregister', 1572, 3200, 3501, 0],
      ['deregister', 1571, 3201, 3501, 2],
      ['register', 1728, 3200, 3500, 1],
      ['register', 1727, 3201, 3500, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('52/53 double metal gates open both leaves into their nameless open panels', () => {
  // Real map: 53 west (2649,3470), 52 east (2650,3470). Open ids are nameless in the cache.
  const h = buildHarness();
  try {
    h.place(53, 3100, 3500, 1);
    h.place(52, 3101, 3500, 1);
    assert.deepEqual(h.click(52, 3101, 3500, 1), [
      ['deregister', 53, 3100, 3500, 1],
      ['deregister', 52, 3101, 3500, 1],
      ['register', 28854, 3100, 3501, 0],
      ['register', 28853, 3101, 3501, 2],
    ]);
  } finally {
    h.restore();
  }
});

test('reversed large doors (1513 south of 1511, as cached at 3287,3172) pick the left leaf by position', () => {
  const h = buildHarness();
  try {
    h.place(1511, 3287, 3172, 0);
    h.place(1513, 3287, 3171, 0);
    assert.deepEqual(h.click(1511, 3287, 3172, 0, 'Open', 'Large door'), [
      ['deregister', 1513, 3287, 3171, 0],
      ['deregister', 1511, 3287, 3172, 0],
      ['register', 1516, 3286, 3171, 3],
      ['register', 1512, 3286, 3172, 1],
    ]);
  } finally {
    h.restore();
  }
});

// --- Al Kharid toll gate -----------------------------------------------------
// Before Prince Ali Rescue: open a guard dialogue, answer the 10gp conditions,
// and on payment swing the leaves, force-walk the player through and shut the
// gate again. After it, Open swings the gate and walks the player straight
// through: sound, swing and step on one tick, shut two ticks later (rsprox 321,
// 326, 1050, 1051, 1693).

const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { World } = require('../dist/game/World');

const AL_KHARID_LEAF_SOUTH = 44598;
const AL_KHARID_LEAF_NORTH = 44599;

// The plugin starts guard conversations through QuestRuntime.startTranscript;
// stub it so these tests only exercise the gate's own logic.
function loadAlKharidGatePlugin(startTranscript) {
  const runtimePath = require.resolve('../plugins/quests/QuestRuntime');
  const pluginPath = require.resolve('../plugins/objects/AlKharidGate.plugin');
  const previous = require.cache[runtimePath];
  delete require.cache[pluginPath];
  require.cache[runtimePath] = { id: runtimePath, filename: runtimePath, loaded: true, exports: { startTranscript } };
  try {
    return require(pluginPath);
  } finally {
    if (previous) require.cache[runtimePath] = previous;
    else delete require.cache[runtimePath];
  }
}

function buildAlKharidHarness() {
  const dialogues = [];
  const submitted = [];
  const handlers = { custom: new Map(), object: new Map(), conditions: [] };
  const plugin = loadAlKharidGatePlugin((api, player, npcId, page, variant) => {
    dialogues.push({ npcId, page, variant });
  });
  plugin.register({
    core: PluginManager.getCoreApi(),
    getTaskManager: () => ({
      submit: (task) => {
        submitted.push(task);
        if (task.isImmediate?.()) task.execute();
      },
    }),
    onCustomEvent: (name, handler) => handlers.custom.set(name, handler),
    onObjectInteraction: (name, actions) => handlers.object.set(name, actions),
    onNpcDialogueCondition: (handler) => handlers.conditions.push(handler),
  });

  // Everyone created by alKharidPlayer has the gate in view.
  viewers = [];
  const originalForEachNetworkPlayer = World.forEachNetworkPlayer;
  World.forEachNetworkPlayer = (consumer) => viewers.forEach(consumer);
  const originalMapGet = MapObjects.get;
  MapObjects.get = (id, location) => {
    if (location.getZ() !== 0 || location.getX() !== 3268) return null;
    if (id === AL_KHARID_LEAF_SOUTH && location.getY() === 3227) return new GameObject(id, location.clone(), 0, 0, null);
    if (id === AL_KHARID_LEAF_NORTH && location.getY() === 3228) return new GameObject(id, location.clone(), 0, 0, null);
    return null;
  };

  return {
    dialogues, submitted, handlers,
    restore: () => {
      MapObjects.get = originalMapGet;
      World.forEachNetworkPlayer = originalForEachNetworkPlayer;
    },
  };
}

let viewers = [];

function alKharidPlayer(coins, x, y) {
  const attributes = new Map();
  const packets = [];
  const messages = [];
  const steps = [];
  const sounds = [];
  let location = new Location(x, y, 0);
  const player = {
    getInventory: () => ({
      getAmount: (id) => (id === ItemIdentifiers.COINS ? coins : 0),
      deleteNumber: (id, amount) => { if (id === ItemIdentifiers.COINS) coins = Math.max(0, coins - amount); },
    }),
    getCoins: () => coins,
    getAttribute: (name) => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    getLocation: () => location,
    setLocation: (next) => { location = next; steps.push([next.getX(), next.getY()]); },
    setWalkingDirection: () => {},
    getPacketSender: () => ({
      sendObject: (object) => packets.push(['add', object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]),
      sendObjectRemoval: (object) => packets.push(['del', object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]),
      sendSoundEffect: (id) => sounds.push(id),
    }),
    getMovementQueue: () => ({ reset: () => {}, setBlockMovement: () => {}, handleRegionChange: () => {} }),
    getForceMovement: () => null,
    setSkillAnimation: () => {},
    performAnimation: () => {},
    getUpdateFlag: () => ({ flag: () => {} }),
    getPrivateArea: () => null,
    getSession: () => ({ isTileInScene: () => true }),
    isRegistered: () => true,
    getHitpoints: () => 10,
    sendMessage: (message) => messages.push(message),
    packets,
    messages,
    steps,
    sounds,
  };
  viewers.push(player);
  return player;
}

/** Ticks a crossing until its walk ends, returning the tiles stepped onto each tick. */
function walkCrossing(task, player) {
  const ticks = [];
  for (let tick = 0; tick < 10 && !task.finished; tick++) {
    const before = player.steps.length;
    task.execute();
    ticks.push(player.steps.slice(before));
  }
  return ticks;
}

// inviswall on the closed tiles, inacmetalgateopenl/r swung west (rsprox 1050, 1051).
const INVISWALL = 38848;
const OPEN_LEFT = 1573;
const OPEN_RIGHT = 1574;
const GATE_SOUND = 69;
const GATE_OPEN_PACKETS = [
  ['del', AL_KHARID_LEAF_SOUTH, 3268, 3227, 0],
  ['del', AL_KHARID_LEAF_NORTH, 3268, 3228, 0],
  ['add', INVISWALL, 3268, 3227, 0],
  ['add', INVISWALL, 3268, 3228, 0],
  ['add', OPEN_LEFT, 3267, 3227, 3],
  ['add', OPEN_RIGHT, 3267, 3228, 1],
];
const GATE_CLOSE_PACKETS = [
  ['del', OPEN_LEFT, 3267, 3227, 3],
  ['del', OPEN_RIGHT, 3267, 3228, 1],
  ['add', AL_KHARID_LEAF_SOUTH, 3268, 3227, 0],
  ['add', AL_KHARID_LEAF_NORTH, 3268, 3228, 0],
];
const OPEN_PACKET_COUNT = GATE_OPEN_PACKETS.length;

/** The crossing's walk task (the runner's) and the gate's close timer, in either order. */
const crossingTasks = (h) => ({
  walk: h.submitted.filter((task) => task.isImmediate?.()),
  close: h.submitted.filter((task) => !task.isImmediate?.()),
});

function payAtGate(h, player, npcId) {
  h.handlers.custom.get('door:toggle')({
    player, objectId: AL_KHARID_LEAF_SOUTH, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227), handled: false,
  });
  const action = { player, npcId, stepId: 'hyXjU_', handled: false, end: false };
  h.handlers.custom.get('npc-dialogue:action')(action);
  return action;
}

const gateLeaf = (id, y) => new GameObject(id, new Location(3268, y, 0), 0, 0, null);

test('opening the Al Kharid gate before Prince Ali Rescue talks to the border guard', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(50, 3267, 3227);
    const event = { player, objectId: AL_KHARID_LEAF_SOUTH, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227), handled: false };
    h.handlers.custom.get('door:toggle')(event);
    assert.equal(event.handled, true);
    assert.deepEqual(h.dialogues, [{
      npcId: NpcIdentifiers.BORDER_GUARD, page: 'Border Guard',
      variant: 'before-completing-prince-ali-rescue-quest',
    }]);


    const otherDoor = { player, objectId: 12345, object: gateLeaf(12345, 3227), handled: false };
    h.handlers.custom.get('door:toggle')(otherDoor);
    assert.equal(otherDoor.handled, false, 'other doors are left to the Doors plugin');
  } finally {
    h.restore();
  }
});

test('after Prince Ali Rescue, Open walks the player through on the tick the gate swings', () => {
  const h = buildAlKharidHarness();
  try {
    for (const stage of [100, 110]) {
      h.submitted.length = 0;
      const player = alKharidPlayer(0, 3267, 3227);
      player.setAttribute('quest.prince_ali_rescue.stage', stage);
      const event = { player, objectId: AL_KHARID_LEAF_SOUTH, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227), handled: false };
      h.handlers.custom.get('door:toggle')(event);
      assert.equal(event.handled, true);
      assert.deepEqual(h.dialogues, [], `no guard dialogue at stage ${stage}`);
      assert.deepEqual(player.packets.slice(-OPEN_PACKET_COUNT), GATE_OPEN_PACKETS);
      assert.deepEqual(player.sounds, [GATE_SOUND]);
      assert.deepEqual(player.steps, [[3268, 3227]], 'the step lands with the swing');

      const { walk: [walk], close: [close] } = crossingTasks(h);
      assert.deepEqual(walkCrossing(walk, player), [[]], 'no second tile');
      assert.equal(player.getAttribute('agility.obstacle'), null);
      assert.equal(close.getDelay(), 2, 'shut two ticks after it opened');
      close.execute();
      assert.deepEqual(player.packets.slice(-GATE_CLOSE_PACKETS.length), GATE_CLOSE_PACKETS);
    }
  } finally {
    h.restore();
  }
});

test('from the Al Kharid side the free Open walks west, and the north leaf swings two left leaves', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(0, 3268, 3228);
    player.setAttribute('quest.prince_ali_rescue.stage', 110);
    h.handlers.custom.get('door:toggle')({
      player, objectId: AL_KHARID_LEAF_NORTH, object: gateLeaf(AL_KHARID_LEAF_NORTH, 3228), handled: false,
    });
    assert.deepEqual(h.dialogues, []);
    assert.deepEqual(player.steps, [[3267, 3228]]);
    // rsprox 1693: clicking the north leaf sends inacmetalgateopenl for both leaves.
    assert.deepEqual(player.packets.slice(-2), [
      ['add', OPEN_LEFT, 3267, 3227, 3],
      ['add', OPEN_LEFT, 3267, 3228, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('the toll condition reads the backpack coins', () => {
  const h = buildAlKharidHarness();
  try {
    const condition = h.handlers.conditions[0];
    const rich = alKharidPlayer(10, 3267, 3227);
    const poor = alKharidPlayer(9, 3267, 3227);
    assert.equal(condition({ player: rich, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player has 10gp:' }), true);
    assert.equal(condition({ player: rich, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player does not have 10gp:' }), false);
    assert.equal(condition({ player: poor, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player has 10gp:' }), false);
    assert.equal(condition({ player: poor, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player does not have 10gp:' }), true);
    assert.equal(condition({ player: rich, npcId: 9999, text: 'If the player has 10gp:' }), null);
  } finally {
    h.restore();
  }
});

test('paying the toll walks the player one tile past the gate line, then shuts it', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(10, 3267, 3227);
    const action = payAtGate(h, player, NpcIdentifiers.BORDER_GUARD);
    assert.equal(player.getCoins(), 0);
    assert.equal(action.handled, true);
    assert.deepEqual(player.packets, GATE_OPEN_PACKETS);
    assert.deepEqual(player.sounds, [GATE_SOUND]);
    assert.deepEqual(player.steps, [], 'no step on submit from a dialogue packet');
    assert.equal(player.getAttribute('agility.obstacle') != null, true, 'the player is locked while crossing');

    const { walk: [walk], close: [close] } = crossingTasks(h);
    assert.deepEqual(walkCrossing(walk, player), [[[3268, 3227]], []], 'one tile, onto the leaf tile');
    assert.equal(player.getAttribute('agility.obstacle'), null);
    assert.equal(player.packets.length, OPEN_PACKET_COUNT, 'the gate is still open on arrival');

    assert.equal(close.getDelay(), 2);
    close.execute();
    assert.deepEqual(player.packets.slice(OPEN_PACKET_COUNT), GATE_CLOSE_PACKETS);
  } finally {
    h.restore();
  }
});

test('the gate swings for everyone in view and stays open until the last crossing', () => {
  const h = buildAlKharidHarness();
  try {
    const bystander = alKharidPlayer(0, 3266, 3227);
    const first = alKharidPlayer(10, 3267, 3227);
    const second = alKharidPlayer(10, 3269, 3228);
    payAtGate(h, first, NpcIdentifiers.BORDER_GUARD);
    assert.deepEqual(bystander.packets, GATE_OPEN_PACKETS, 'a bystander sees the gate open');
    payAtGate(h, second, NpcIdentifiers.BORDER_GUARD_2);
    assert.equal(bystander.packets.length, OPEN_PACKET_COUNT, 'an open gate is not re-sent');

    const { walk, close } = crossingTasks(h);
    walkCrossing(walk[0], first);
    close[0].execute();
    assert.equal(bystander.packets.length, OPEN_PACKET_COUNT, 'still open while the second player crosses');

    walkCrossing(walk[1], second);
    close[1].execute();
    assert.deepEqual(bystander.packets.slice(OPEN_PACKET_COUNT), GATE_CLOSE_PACKETS, 'shut after the last one');
  } finally {
    h.restore();
  }
});

test('a player parked on the gate tile from the east walks one tile west', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(10, 3268, 3227);
    const action = payAtGate(h, player, NpcIdentifiers.BORDER_GUARD_2);
    assert.equal(action.handled, true);
    assert.deepEqual(walkCrossing(crossingTasks(h).walk[0], player), [[[3267, 3227]], []]);
  } finally {
    h.restore();
  }
});

test('a cancelled crossing still shuts the gate', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(10, 3267, 3227);
    payAtGate(h, player, NpcIdentifiers.BORDER_GUARD);
    const { walk, close } = crossingTasks(h);
    walk[0].stop();
    assert.equal(player.getAttribute('agility.obstacle'), null);
    close[0].execute();
    assert.deepEqual(player.packets.slice(OPEN_PACKET_COUNT), GATE_CLOSE_PACKETS);
  } finally {
    h.restore();
  }
});

test('clicking Pay-toll pays directly and refuses when the backpack is short', () => {
  const h = buildAlKharidHarness();
  try {
    const handler = h.handlers.object.get('Gate')['Pay-toll(10gp)'];
    const rich = alKharidPlayer(10, 3269, 3227);
    handler({ player: rich, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227) });
    assert.equal(rich.getCoins(), 0);
    assert.equal(rich.packets.length, OPEN_PACKET_COUNT);
    assert.deepEqual(rich.steps, [[3268, 3227]], 'the first step lands with the swing');
    walkCrossing(crossingTasks(h).walk[0], rich);
    assert.deepEqual(rich.steps, [[3268, 3227], [3267, 3227]], 'an east-side player crosses west');

    const poor = alKharidPlayer(4, 3269, 3227);
    const sent = poor.packets.length;
    handler({ player: poor, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227) });
    assert.equal(poor.getCoins(), 4);
    assert.equal(poor.packets.length, sent, 'the gate does not open');
    assert.deepEqual(poor.steps, []);
    assert.deepEqual(poor.messages, ["You don't have enough coins."]);
  } finally {
    h.restore();
  }
});


test('the Tutorial Island survival gate swings open and closes back to its own panels', () => {
  const h = buildHarness();
  try {
    // 9470/9708 open into 8812/8813, the same open panels as the 8810/8811 gate.
    h.place(9470, 200, 200, 0);
    h.place(9708, 200, 201, 0);
    assert.deepEqual(h.click(9470, 200, 200, 0), [
      ['deregister', 9470, 200, 200, 0],
      ['deregister', 9708, 200, 201, 0],
      ['register', 8812, 199, 200, 3],
      ['register', 8813, 198, 200, 3],
    ]);
    assert.deepEqual(h.click(8812, 199, 200, 3, 'Close'), [
      ['deregister', 8812, 199, 200, 3],
      ['deregister', 8813, 198, 200, 3],
      ['register', 9470, 200, 200, 0],
      ['register', 9708, 200, 201, 0],
    ], 'not 8810/8811');
  } finally {
    h.restore();
  }
});

test('the Gnome Ball pitch gate 2394 rotates in place and closes back onto its wall', () => {
  const h = buildHarness();
  try {
    // No open variant is placed (2395/193 are nameless, action-less locs), so the door
    // catalog self-pairs it and the panel swings one tile with the rotation.
    h.place(2394, 2383, 3488, 0);
    assert.deepEqual(h.click(2394, 2383, 3488, 0), [
      ['deregister', 2394, 2383, 3488, 0],
      ['register', 2394, 2382, 3488, 1],
    ], 'the closed gate opens');
    assert.deepEqual(h.click(2394, 2382, 3488, 1, 'Close'), [
      ['deregister', 2394, 2382, 3488, 1],
      ['register', 2394, 2383, 3488, 0],
    ], 'it closes back onto the pitch wall');
  } finally {
    h.restore();
  }
});

test('the Blood Moon Vitur food-shop door opens through the normal door handler', () => {
  const id = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers.VITUR_DOOR_4;
  const h = buildHarness({ cacheObjects: new Map([[id, {
    name: 'Vitur door', actions: ['Open'], models: [[60959]],
  }]]) });
  try {
    assert.ok(h.handlers.get('Vitur door')?.Open, 'the cache name is registered by the shared Doors plugin');
    assert.deepEqual(h.click(id, 2598, 7843, 3, 'Open', 'Vitur door'), [
      ['deregister', id, 2598, 7843, 3],
      ['register', id, 2598, 7842, 0],
    ], 'the self-opening door rotates away from the door tile just as recorded');
  } finally {
    h.restore();
  }
});

test('a transformed Blood Moon door opens its visible child instead of treating the parent as a closed loc', () => {
  const O = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  const h = buildHarness({ cacheObjects: new Map([
    [O.DOOR_837, { name: 'Door', actions: ['Open'], models: [[60956]] }],
    [O.DOOR_838, { name: 'Door', actions: ['Close'], models: [[60957]] }],
  ]) });
  try {
    const rawParent = 61840;
    const player = {
      getUsername: () => 'tester',
      getPrivateArea: () => null,
      getPacketSender: () => ({ getVarbit: () => 1, getVarp: () => 0 }),
    };
    const object = new GameObject(rawParent, new Location(2590, 7818, 0), 0, 1, null);
    h.visibleObjectIds.set(rawParent, O.DOOR_837);
    h.handlers.get('Door').Open({
      player, object, objectId: rawParent, definition: { id: O.DOOR_837 },
      location: object.getLocation(),
    });
    assert.deepEqual(h.ops, [
      ['deregister', rawParent, 2590, 7818, 1],
      ['register', O.DOOR_838, 2590, 7819, 2],
    ], 'the transformed closed parent is replaced with the cache-backed open child');
    assert.deepEqual(h.click(O.DOOR_838, 2590, 7819, 2, 'Close', 'Door'), [
      ['deregister', O.DOOR_838, 2590, 7819, 2],
      ['register', rawParent, 2590, 7818, 1],
    ], 'closing restores the actual placement parent and retains its native transforms');
  } finally {
    h.restore();
  }
});

test('the Blood Hunt Myrmel pub door swings from its cache Open-only definition', () => {
  const O = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  const h = buildHarness({ cacheObjects: new Map([[O.MYRMEL_DOOR, {
    name: 'Myrmel door', actions: ['Open'], models: [[60962]],
  }]]) });
  try {
    assert.ok(h.handlers.get('Myrmel door')?.Open);
    assert.deepEqual(h.click(O.MYRMEL_DOOR, 2599, 7826, 3, 'Open', 'Myrmel door'), [
      ['deregister', O.MYRMEL_DOOR, 2599, 7826, 3],
      ['register', O.MYRMEL_DOOR, 2599, 7825, 0],
    ], 'the unlocked pub doorway clears its recorded south approach');
  } finally {
    h.restore();
  }
});


test('the catacomb outer jail gate uses its actionless open cache variant and auto-closes', () => {
 const h=buildHarness();try{
  assert.deepEqual(h.click(53441,4126,4788,2),[
   ['deregister',53441,4126,4788,2],['register',53442,4127,4788,3],
  ]);
  h.submitted.at(-1).execute();assert.deepEqual(h.ops.splice(0),[
   ['deregister',53442,4127,4788,3],['register',53441,4126,4788,2],
  ]);
 }finally{h.restore();}
});

test('the Lassar cistern gate opens into its actionless cache variant', () => {
  const h = buildHarness({ cacheObjects: new Map([
    [48301, { name: 'Gate', actions: ['Open'], models: [[609]] }],
    [48302, { name: 'Gate', actions: [], models: [[609]] }],
  ]) });
  try {
    assert.deepEqual(h.click(48301, 2784, 6287, 0, 'Open', 'Gate', 0, null, 1), [
      ['deregister', 48301, 2784, 6287, 0],
      ['register', 48302, 2783, 6287, 1],
    ], 'opening uses the actual same-model open loc and clears the closed gate footprint');
  } finally {
    h.restore();
  }
});



test('Dragon Slayer secret wall opens with the normal door interaction', () => {
  const h = buildHarness();
  try {
    assert.ok(h.handlers.get('Wall')?.Open, 'the cache calls the Dragon Slayer passage a Wall');
    h.place(2606, 2836, 9600, 3);
    assert.deepEqual(h.click(2606, 2836, 9600, 3, 'Open', 'Wall'), [
      ['deregister', 2606, 2836, 9600, 3],
      ['register', 2606, 2836, 9599, 0],
    ], 'opening rotates the wall out of the doorway so ordinary pathfinding can cross');
  } finally {
    h.restore();
  }
});


test('the Shantay pass crosses the desert fence in the right direction', () => {
  assert.deepEqual(shantayCrossingFor({ x: 3303, y: 3117, z: 0 }), {
    desert: true,
    path: [[3303, 3116], [3303, 3115]],
  });
  assert.deepEqual(shantayCrossingFor({ x: 3303, y: 3115, z: 0 }), {
    desert: false,
    path: [[3303, 3116], [3303, 3117]],
  });
  assert.equal(shantayCrossingFor({ x: 3303, y: 3115, z: 1 }), null);
  // The gate is 4 tiles wide (3302-3305): live crossed from 3304 too.
  assert.deepEqual(shantayCrossingFor({ x: 3305, y: 3117, z: 0 }).path, [[3305, 3116], [3305, 3115]]);
  assert.equal(shantayCrossingFor({ x: 3306, y: 3117, z: 0 }), null);
});


test('Sophanem north gate opens and closes both nameless gate leaves', () => {
  const h = buildHarness();
  try {
    h.place(44036, 3283, 2809, 1);
    h.place(44038, 3284, 2809, 1);
    assert.deepEqual(h.click(44036, 3283, 2809, 1), [
      ['deregister', 44036, 3283, 2809, 1],
      ['deregister', 44038, 3284, 2809, 1],
      ['register', 44037, 3283, 2810, 0],
      ['register', 44039, 3284, 2810, 2],
    ]);

    h.place(44037, 3283, 2810, 0);
    h.place(44039, 3284, 2810, 2);
    assert.deepEqual(h.click(44037, 3283, 2810, 0, 'Close'), [
      ['deregister', 44037, 3283, 2810, 0],
      ['deregister', 44039, 3284, 2810, 2],
      ['register', 44036, 3283, 2809, 1],
      ['register', 44038, 3284, 2809, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('Lassar residential shadow doors use their canonical open and close locs', () => {
  const h = buildHarness();
  try {
    // Cache locs 48278/48279 are the adjacent Open leaves; their Close variants
    // are 48282/48283. The two actionless 48280/48281 locs are not used.
    h.place(48278, 2417, 6414, 2);
    h.place(48279, 2417, 6413, 2);
    assert.deepEqual(h.click(48279, 2417, 6413, 2, 'Open', 'Doors'), [
      ['deregister', 48278, 2417, 6414, 2],
      ['deregister', 48279, 2417, 6413, 2],
      ['register', 48282, 2418, 6414, 1],
      ['register', 48283, 2418, 6413, 3],
    ]);
    assert.deepEqual(h.click(48282, 2418, 6414, 1, 'Close', 'Doors'), [
      ['deregister', 48282, 2418, 6414, 1],
      ['deregister', 48283, 2418, 6413, 3],
      ['register', 48278, 2417, 6414, 2],
      ['register', 48279, 2417, 6413, 2],
    ]);
  } finally {
    h.restore();
  }
});

test('Lassar pub gate opens into its cache Close leaves and can be closed again', async () => {
  await initializeMapCollisionOnce();
  const closedWest = CacheDefinitions.getObject(48289);
  const closedEast = CacheDefinitions.getObject(48290);
  const openWest = CacheDefinitions.getObject(48291);
  const openEast = CacheDefinitions.getObject(48292);
  assert.deepEqual([closedWest.actions[0], closedEast.actions[0], openWest.actions[0], openEast.actions[0]],
    ['Open', 'Open', 'Close', 'Close']);
  assert.deepEqual([closedWest.models, closedEast.models], [openWest.models, openEast.models]);

  const h = buildHarness({ cacheObjects: new Map([
    [48289, closedWest], [48290, closedEast], [48291, openWest], [48292, openEast],
  ]) });
  try {
    h.place(48289, 2385, 6427, 0);
    h.place(48290, 2385, 6428, 0);
    const opened = h.click(48289, 2385, 6427, 0, 'Open', 'Doors');
    assert.ok(opened.some(([action, id]) => action === 'deregister' && id === 48289));
    assert.ok(opened.some(([action, id]) => action === 'deregister' && id === 48290));
    assert.ok(opened.some(([action, id]) => action === 'register' && id === 48291));
    assert.ok(opened.some(([action, id]) => action === 'register' && id === 48292));

    for (const [, id, x, y, face] of opened.filter(([action]) => action === 'register')) h.place(id, x, y, face);
    const [, firstOpenId, firstOpenX, firstOpenY, firstOpenFace] = opened.find(([action, id]) => action === 'register' && id === 48291);
    const closed = h.click(firstOpenId, firstOpenX, firstOpenY, firstOpenFace, 'Close', 'Doors');
    assert.ok(closed.some(([action, id]) => action === 'register' && id === 48289), JSON.stringify(closed));
    assert.ok(closed.some(([action, id]) => action === 'register' && id === 48290), JSON.stringify(closed));
  } finally {
    h.restore();
  }
});

test('Lassar residential house door opens through its nonconsecutive cache Close loc', async () => {
  await initializeMapCollisionOnce();
  const h = buildHarness({ cacheObjects: new Map([48262, 48263, 48264].map((id) => [id, CacheDefinitions.getObject(id)])) });
  try {
    h.place(48262, 2688, 6429, 2);
    assert.deepEqual(h.click(48262, 2688, 6429, 2, 'Open', 'Door'), [
      ['deregister', 48262, 2688, 6429, 2],
      ['register', 48264, 2689, 6429, 3],
    ]);
    assert.deepEqual(h.click(48264, 2689, 6429, 3, 'Close', 'Door'), [
      ['deregister', 48264, 2689, 6429, 3],
      ['register', 48262, 2688, 6429, 2],
    ]);
  } finally {
    h.restore();
  }
});


test('Varrock doors open across the actionless loc before their Close variant (11780 -> 11782)', async () => {
  await initializeMapCollisionOnce();
  const h = buildHarness({ cacheObjects: new Map([11780, 11781, 11782].map((id) => [id, CacheDefinitions.getObject(id)])) });
  try {
    // Katrine's Black Arm Gang hideout entrance.
    assert.deepEqual(h.click(11780, 3190, 3384, 0, 'Open', 'Door'), [
      ['deregister', 11780, 3190, 3384, 0],
      ['register', 11782, 3189, 3384, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('Pollnivneach curtains draw back in place into their cache Close loc and close again (1533 <-> 1534, issue #1708)', async () => {
  await initializeMapCollisionOnce();
  const h = buildHarness({ cacheObjects: new Map([1533, 1534].map((id) => [id, CacheDefinitions.getObject(id)])) });
  try {
    assert.ok(h.handlers.get('Curtain'), 'Curtain locs are handled as doors');
    // Curtains are drawn back in place: same tile, same rotation, no door swing.
    // Closed curtain placed by the cache at 3345,2955 (rotation 0).
    assert.deepEqual(h.click(1533, 3345, 2955, 0, 'Open', 'Curtain'), [
      ['deregister', 1533, 3345, 2955, 0],
      ['register', 1534, 3345, 2955, 0],
    ]);
    assert.deepEqual(h.click(1534, 3345, 2955, 0, 'Close', 'Curtain'), [
      ['deregister', 1534, 3345, 2955, 0],
      ['register', 1533, 3345, 2955, 0],
    ]);
    // A curtain the cache places open (3349,2962, rotation 1) closes on its own tile too.
    assert.deepEqual(h.click(1534, 3349, 2962, 1, 'Close', 'Curtain'), [
      ['deregister', 1534, 3349, 2962, 1],
      ['register', 1533, 3349, 2962, 1],
    ]);
  } finally {
    h.restore();
  }
});

test("the Champions' Guild door swings without a separate open cache loc", async () => {
  await initializeMapCollisionOnce();
  const h = buildHarness({ cacheObjects: new Map([1805, 1806].map((id) => [id, CacheDefinitions.getObject(id)])) });
  try {
    assert.deepEqual(h.click(1805, 3191, 3363, 3, 'Open', 'Door'), [
      ['deregister', 1805, 3191, 3363, 3],
      ['register', 1805, 3191, 3362, 0],
    ]);
  } finally {
    h.restore();
  }
});

test("Harold's bedroom door rotates without needing a separate open cache loc", () => {
  const h = buildHarness();
  try {
    assert.deepEqual(h.click(3747, 2906, 3543, 3, 'Open', 'Door'), [
      ['deregister', 3747, 2906, 3543, 3],
      ['register', 3747, 2906, 3542, 0],
    ]);
    assert.deepEqual(h.click(3747, 2906, 3542, 0, 'Open', 'Door'), [
      ['deregister', 3747, 2906, 3542, 0],
      ['register', 3747, 2906, 3543, 3],
    ]);
  } finally { h.restore(); }
});


test('Death Plateau equipment door swings open after the quest unlocks it', () => {
  const h = buildHarness();
  try {
    assert.deepEqual(h.click(3743, 2894, 3566, 1, 'Open', 'Large door'), [
      ['deregister', 3743, 2894, 3566, 1],
      ['register', 3743, 2894, 3567, 2],
    ]);
    assert.deepEqual(h.click(3743, 2894, 3567, 2, 'Open', 'Large door'), [
      ['deregister', 3743, 2894, 3567, 2],
      ['register', 3743, 2894, 3566, 1],
    ]);
  } finally { h.restore(); }
});


test('Elena’s cabinet house opens into its nameless cache door variant', async () => {
  await initializeMapCollisionOnce();
  const closed = CacheDefinitions.getObject(2054), opened = CacheDefinitions.getObject(2055);
  assert.equal(closed.name, 'Door');
  assert.deepEqual(closed.actions.filter(Boolean), ['Open']);
  assert.ok(opened.name === null || opened.name === 'null');
  assert.deepEqual(closed.models, opened.models);
  const h = buildHarness({ cacheObjects: new Map([[2054, closed], [2055, opened]]) });
  try {
    h.place(2054, 2592, 3339, 3);
    const ops = h.click(2054, 2592, 3339, 3, 'Open', 'Door');
    assert.ok(ops.some(op => op[0] === 'deregister' && op[1] === 2054));
    assert.ok(ops.some(op => op[0] === 'register' && op[1] === 2055));
  } finally { h.restore(); }
});


test('Elena house door leaves a real collision path to her chemical cabinet', async () => {
  await initializeMapCollisionOnce();
  const definitions = new Map([2054, 2055].map(id => [id, CacheDefinitions.getObject(id)]));
  const area = new TemplatedInstanceArea(3, 3);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let plane = 0; plane < 4; plane++) {
    area.setChunk(plane, x, y, { sourceChunkX: 323 + x, sourceChunkY: 415 + y, sourcePlane: plane, rotation: 0 });
  }
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager });
  try {
    const location = area.tile(8, 19, 0), door = area.resolveObject(2054, location);
    assert.ok(door);
    assert.equal(door.getFace(), 3);
    const player = { getUsername: () => 'elena-house-test', isPlayerBot: () => false,
      getPrivateArea: () => area, getLocation: () => area.tile(8, 20, 0), getPacketSender: () => ({}),
      getAttribute: () => null, setAttribute() {}, isNeedsPlacement: () => false, isAllowRegionChangePacket: () => false };
    h.handlers.get('Door').Open({ player, object: door, objectId: 2054, location });
    const route = new RsmodRouteFinding().findRoute({ level: 0, srcX: area.getBaseX() + 8,
      srcY: area.getBaseY() + 20, srcSize: 1, destX: area.getBaseX() + 7, destY: area.getBaseY() + 18,
      privateArea: area, moveNear: false });
    assert.equal(route.success, true, 'opening must connect the courtyard to the cabinet’s eastern approach');
  } finally { area.destroy(); h.restore(); }
});

test('Arboretum Large doors 39251/39253 swing east as a public double door', async () => {
  await initializeMapCollisionOnce();
  RegionManager.loadMapFiles(3614, 3361, true);
  const O = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  assert.deepEqual([O.LARGE_DOOR_100, O.LARGE_DOOR_101], [39251, 39253]);
  const definitions = new Map([39251, 39252, 39253, 39254]
    .map(id => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const closedAt = (id, x, y) => MapObjects.get(id, new Location(x, y, 0), null);
  try {
    const north = closedAt(39253, 3614, 3361), south = closedAt(39251, 3614, 3362);
    assert.ok(north && south, 'cache places both closed Arboretum leaves');
    assert.deepEqual([north.getFace(), south.getFace()], [2, 2]);

    // One normal Open on either leaf swings the whole public double door.
    h.click(39253, 3614, 3361, 2, 'Open', 'Large door');
    assert.equal(closedAt(39253, 3614, 3361), null);
    assert.equal(closedAt(39251, 3614, 3362), null);
    const openNorth = closedAt(39254, 3615, 3361), openSouth = closedAt(39252, 3615, 3362);
    assert.ok(openNorth && openSouth, 'both captured open leaves appear on the +x tiles');
    assert.deepEqual([openNorth.getFace(), openSouth.getFace()], [3, 1]);

    const route = new RsmodRouteFinding();
    const path = (srcY, destY) => route.findRoute({ level: 0, srcX: 3613, srcY, srcSize: 1,
      destX: 3616, destY, privateArea: null, moveNear: false });
    for (const y of [3361, 3362]) {
      assert.equal(path(y, y).success, true, `normal RSMOD crosses the open threshold east at y=${y}`);
      const back = route.findRoute({ level: 0, srcX: 3616, srcY: y, srcSize: 1,
        destX: 3613, destY: y, privateArea: null, moveNear: false });
      assert.equal(back.success, true, `normal RSMOD crosses the open threshold west at y=${y}`);
    }

    // Auto-close restores the closed pair, then an ordinary second player can open it.
    h.submitted.at(-1).execute();
    assert.ok(closedAt(39253, 3614, 3361) && closedAt(39251, 3614, 3362));
    h.click(39253, 3614, 3361, 2, 'Open', 'Large door');
    assert.ok(closedAt(39254, 3615, 3361) && closedAt(39252, 3615, 3362),
      'the public door is re-openable by another ordinary click');
  } finally {
    for (const [id, x, y] of [[39251, 3614, 3362], [39252, 3615, 3362],
      [39253, 3614, 3361], [39254, 3615, 3361]]) {
      const object = MapObjects.get(id, new Location(x, y, 0), null);
      if (object) ObjectManager.deregister(object, true);
    }
    ObjectManager.register(new GameObject(39251, new Location(3614, 3362, 0), 0, 2, null), true);
    ObjectManager.register(new GameObject(39253, new Location(3614, 3361, 0), 0, 2, null), true);
    h.restore();
  }
});

test('Rehnison door opens a real path past the entrance chair to the hidden bed', async () => {
  await initializeMapCollisionOnce();
  const definitions = new Map([2537, 2538].map(id => [id, CacheDefinitions.getObject(id)]));
  const area = new TemplatedInstanceArea(3, 3);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let plane = 0; plane < 4; plane++) {
    area.setChunk(plane, x, y, { sourceChunkX: 315 + x, sourceChunkY: 415 + y, sourcePlane: plane, rotation: 0 });
  }
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager });
  try {
    const location = area.tile(11, 8, 0), door = area.resolveObject(2537, location);
    assert.ok(door);
    assert.equal(door.getFace(), 1);
    const player = { getUsername: () => 'rehnison-door-test', isPlayerBot: () => false,
      getPrivateArea: () => area, getLocation: () => area.tile(11, 7, 0), getPacketSender: () => ({}),
      getAttribute: () => null, setAttribute() {}, isNeedsPlacement: () => false, isAllowRegionChangePacket: () => false };
    h.handlers.get('Door').Open({ player, object: door, objectId: 2537, location });
    const route = new RsmodRouteFinding().findRoute({ level: 0, srcX: area.getBaseX() + 11,
      srcY: area.getBaseY() + 7, srcSize: 1, destX: area.getBaseX() + 12, destY: area.getBaseY() + 11,
      privateArea: area, moveNear: false });
    assert.equal(route.success, true, 'the entrance must connect to the clear tile south-west of the bed');
  } finally { area.destroy(); h.restore(); }
});

test('Murder Mystery mansion Large doors 25748/25750 open their real north threshold together', async () => {
  await initializeMapCollisionOnce();
  RegionManager.loadMapFiles(2740, 3572, true);
  const O = require('../dist/util/ObjectIdentifiers').ObjectIdentifiers;
  assert.deepEqual([O.LARGE_DOOR_79, O.LARGE_DOOR_80], [25748, 25750]);
  const definitions = new Map([25748, 25749, 25750, 25751].map(id => [id, CacheDefinitions.getObject(id)]));
  for (const id of [25749, 25751]) {
    assert.equal(definitions.get(id).name, 'null');
    assert.equal(definitions.get(id).actions[0], 'Close');
    assert.deepEqual(definitions.get(id).models, definitions.get(id - 1).models);
  }
  const h = buildHarness({ cacheObjects: definitions, objectManager: ObjectManager, realMapObjects: true });
  const at = (id, x, y) => MapObjects.get(id, new Location(x, y, 0), null);
  const crosses = (x, northward) => RegionManager.canMove(x, northward ? 3572 : 3573,
    x, northward ? 3573 : 3572, 0, 1, 1, null);
  try {
    const west = at(25748, 2740, 3572), east = at(25750, 2741, 3572);
    assert.ok(west && east, 'actual cache places both closed mansion leaves');
    assert.deepEqual([west.getType(), east.getType(), west.getFace(), east.getFace()], [0, 0, 1, 1]);
    for (const x of [2740, 2741]) assert.equal(crosses(x, true), false, 'closed wall blocks the threshold');

    h.click(25748, 2740, 3572, 1, 'Open', 'Large door');
    assert.equal(at(25748, 2740, 3572), null);
    assert.equal(at(25750, 2741, 3572), null);
    const openWest = at(25749, 2740, 3573), openEast = at(25751, 2741, 3573);
    assert.ok(openWest && openEast, 'ordinary Open swings both leaves onto their north hinge tiles');
    assert.deepEqual([openWest.getFace(), openEast.getFace()], [0, 2]);
    for (const x of [2740, 2741]) {
      assert.equal(crosses(x, true), true, 'normal collision permits entry');
      assert.equal(crosses(x, false), true, 'normal collision permits exit');
      for (const [srcY, destY] of [[3571, 3574], [3574, 3571]]) {
        const route = new RsmodRouteFinding().findRoute({ level: 0, srcX: x, srcY, srcSize: 1,
          destX: x, destY, privateArea: null, moveNear: false });
        assert.equal(route.success, true, 'ordinary RSMOD reaches the opposite side of the mansion threshold');
      }
    }

    h.submitted.at(-1).execute();
    assert.ok(at(25748, 2740, 3572) && at(25750, 2741, 3572), 'auto-close restores both closed leaves');
    for (const x of [2740, 2741]) assert.equal(crosses(x, true), false);
    h.click(25750, 2741, 3572, 1, 'Open', 'Large door');
    assert.ok(at(25749, 2740, 3573) && at(25751, 2741, 3573), 'the other leaf can reopen the pair');
  } finally {
    for (const [id, x, y] of [[25748, 2740, 3572], [25750, 2741, 3572],
      [25749, 2740, 3573], [25751, 2741, 3573]]) {
      const object = at(id, x, y);if (object) ObjectManager.deregister(object, true);
    }
    ObjectManager.register(new GameObject(25748, new Location(2740, 3572, 0), 0, 1, null), true);
    ObjectManager.register(new GameObject(25750, new Location(2741, 3572, 0), 0, 1, null), true);
    h.restore();
  }
});

test('public door:open requests keep lock checks and never toggle an already-open door shut', async () => {
  await initializeMapCollisionOnce();
  const definitions = new Map([1535, 1536].map(id => [id, CacheDefinitions.getObject(id)]));
  const h = buildHarness({ cacheObjects: definitions });
  try {
    const player = { getPrivateArea: () => null, getLocation: () => new Location(101, 200, 0) };
    const object = new GameObject(1535, new Location(100, 200, 0), 0, 0, null);
    const request = target => ({ player, object: target, handled: false });
    const handler = h.customHandlers.get('door:open');
    assert.equal(typeof handler, 'function');
    h.setDoorToggleHandler(event => { event.handled = true; });
    const locked = request(object); handler(locked);
    assert.equal(locked.handled, true);
    assert.equal(h.ops.length, 0, 'existing public key/lock guards can reject an open request');
    h.setDoorToggleHandler(null);
    const allowed = request(object); handler(allowed);
    assert.equal(allowed.handled, true);
    assert.deepEqual(h.ops, [['deregister', 1535, 100, 200, 0], ['register', 1536, 99, 200, 1]]);
    h.ops.length = 0;
    const again = request(new GameObject(1536, new Location(99, 200, 0), 0, 1, null));
    handler(again);
    assert.equal(again.handled, true);
    assert.equal(h.ops.length, 0, 'a repeated Open request cannot close the panel');
  } finally { h.restore(); }
});
