// From server/ after `yarn build`: node --test tests/spirits-elid-lake-door.test.cjs
// RSPSApp/tsps#6305: after all three guardian golems and all three water channels are done, the
// lake's double doors must put the player on reachable floor. The plugin used to place a second
// "Cave exit" (10417, 3x3) on the lake landing (3347,9563), so crossing the doors left the player
// standing on the exit with "Leave" as the only option; re-entering repeated it.
//
// The plugin's real object-route and door:toggle handlers run here; the player, its movement
// queue and the scene timers are stubbed, as disclosed in the PR. The cache's own cave exit
// (3347,9533) and the collision map are read from the cache, not fixed in the plugin. The
// post-channel state is seeded (stage 30 and the seven quest bits) because this test covers the
// door transition, not golem combat or the channel skill checks. The Doors plugin's wall-door
// route/catalog is not loaded; its door:toggle event is the boundary exercised, as in the
// existing Spirits dungeon-door test.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const runtime = require('../plugins/quests/QuestRuntime');

const LAKE_DOOR = 10423; // 10425 is the mirror leaf
const CAVE_EXIT = 10417;
const BITS_ATTRIBUTE = 'quest.spirits_of_the_elid.bits';
const ALL_GOLEMS_AND_CHANNELS = 0b1111111;
const STAGE_CHANNELS = 30;
const LAKE_ENTRY = [3347, 9563, 0];
const GOLEM_CORRIDOR = [3365, 9544, 0];
const DUNGEON_ENTRY = [3349, 9536, 0];
const CACHE_CAVE_EXIT = [3347, 9533, 0];
const GOLEM_SIDE = [3354, 9557, 0];
const LAKE_SIDE = [3354, 9559, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  RegionManager.loadMapFiles(3354, 9558, true);
  RegionManager.loadMapFiles(3347, 9533, true);
});

function walkable(x, y, z = 0) {
  return (RegionManager.getClipping(x, y, z, null) & RegionManager.BLOCKED_MASK) === 0;
}

/** Chebyshev distance from a tile to a loc's footprint (0 on it). */
function distanceToFootprint(tile, object) {
  const at = object.getLocation();
  const definition = object.getDefinition();
  const width = Math.max(1, definition?.getSizeX?.() ?? 1);
  const length = Math.max(1, definition?.getSizeY?.() ?? 1);
  const dx = Math.max(at.getX() - tile[0], 0, tile[0] - (at.getX() + width - 1));
  const dy = Math.max(at.getY() - tile[1], 0, tile[1] - (at.getY() + length - 1));
  return Math.max(dx, dy);
}

/** A cave exit whose 3x3 footprint covers `tile`, wherever its origin is. */
function caveExitCovering(tile) {
  for (const objects of MapObjects.mapObjects.values()) {
    for (const object of objects) {
      if (object.getId() === CAVE_EXIT && distanceToFootprint(tile, object) === 0) return object;
    }
  }
  return null;
}

function setup(username = 'elid-lake-door-test') {
  const hooks = { custom: new Map(), login: [], objectRoute: [], objectInteraction: [] };
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    getWorld: () => ({ getNpcs: () => [] }),
    getItemOnGroundManager: () => ({ getGroundItem: () => null, registerLocation() {} }),
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    onObjectRoute(fn) { hooks.objectRoute.push(fn); },
    onObjectInteraction(nameOrFn, handlers) {
      if (typeof nameOrFn === 'function') hooks.objectInteraction.push(nameOrFn);
    },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/SpiritsOfTheElid.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map([[BITS_ATTRIBUTE, ALL_GOLEMS_AND_CHANNELS]]);
  const messages = [];
  let location = new Location(...GOLEM_SIDE);
  const sender = new Proxy({}, { get: () => () => sender });
  const player = {
    getUsername: () => username,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getIndex: () => 9,
    isPlayer: () => true,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getSize: () => 1,
    getPacketSender: () => sender,
    getInventory: () => ({
      getAmount: () => 0,
      getItems: () => [],
      deleteNumber() {},
      adds() {},
      isFull: () => false,
      getFreeSlots: () => 28,
    }),
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: () => 99, getMaxLevel: () => 99,
      addExperiences() {}, stopSkillable() {},
    }),
    getLocation: () => location,
    setPositionToFace() {},
    performAnimation() {},
    moveTo(to) { location = to; },
    getPrivateArea: () => null,
    getDialogueManager: () => ({ isActive: () => false, reset() {}, startDialogues() {} }),
    getMovementQueue: () => ({ reset() { return this; } }),
    sendMessage: (message) => messages.push(message),
  };
  quest.setStage(player, STAGE_CHANNELS);

  const setLocation = (x, y, z = 0) => { location = new Location(x, y, z); };
  const at = () => [location.getX(), location.getY(), location.getZ()];

  // The click is routed to the player's own tile (handleObjectRoute) and the
  // Doors plugin's door:toggle then reaches the quest's registered handler.
  function cross(objectId, from) {
    setLocation(...from);
    const route = {
      player, objectId,
      object: { getLocation: () => new Location(3354, 9558, 0), getId: () => objectId },
      definition: { getSizeX: () => 1, getSizeY: () => 1 },
      sourceLocation: { x: from[0], y: from[1], z: from[2] },
      destination: null,
    };
    for (const fn of hooks.objectRoute) fn(route);
    assert.deepEqual(route.destination, { x: from[0], y: from[1], z: from[2] }, 'the click is answered on the player tile');
    const toggle = { player, objectId, handled: false };
    for (const fn of hooks.custom.get('door:toggle') ?? []) fn(toggle);
    assert.equal(toggle.handled, true, 'the quest owns its door');
    return at();
  }

  function clickCaveExit() {
    const event = {
      player, objectId: CAVE_EXIT, clickType: 1,
      definition: { getActions: () => ['Leave'] },
      location: player.getLocation(),
    };
    for (const fn of hooks.objectInteraction) fn(event);
    assert.equal(event.handled, true, 'the cache cave exit keeps its Leave action');
    return at();
  }

  return { quest, player, messages, setLocation, at, cross, clickCaveExit };
}

test('defect (BEFORE fails here): the lake landing is walkable and has no cave exit on it', () => {
  const h = setup();
  assert.deepEqual(h.cross(LAKE_DOOR, GOLEM_SIDE), LAKE_ENTRY, 'the golem side crosses to the lake shore');
  assert.ok(walkable(...LAKE_ENTRY), 'the lake landing is standable cache floor');
  assert.equal(
    caveExitCovering(LAKE_ENTRY),
    null,
    'no Cave exit footprint covers the lake landing (BEFORE: the plugin placed one at 3347,9563)',
  );
});

test('the cache cave exit stays beside the rope landing and still leaves the cave', () => {
  const h = setup();
  const exit = MapObjects.get(CAVE_EXIT, new Location(...CACHE_CAVE_EXIT), null);
  assert.ok(exit, 'the cache map still places the entrance cave exit at 3347,9533');
  assert.ok(distanceToFootprint(DUNGEON_ENTRY, exit) <= 1, 'the exit is clickable from the rope landing');
  h.setLocation(...DUNGEON_ENTRY);
  assert.deepEqual(h.clickCaveExit(), [3371, 3129, 0], 'Leave returns to the waterfall bank');
});

test('the double doors cross back from the lake shore to the golem corridor', () => {
  const h = setup();
  assert.deepEqual(h.cross(LAKE_DOOR, GOLEM_SIDE), LAKE_ENTRY, 'enter the lake');
  assert.deepEqual(h.cross(LAKE_DOOR, LAKE_SIDE), GOLEM_CORRIDOR, 'the lake side crosses back');
  assert.ok(walkable(...GOLEM_CORRIDOR), 'the return landing is standable cache floor');
});

test('re-entering the cave and crossing the doors again keeps the player off the exit', () => {
  const h = setup();
  assert.deepEqual(h.cross(LAKE_DOOR, GOLEM_SIDE), LAKE_ENTRY, 'first crossing');
  assert.deepEqual(h.cross(LAKE_DOOR, LAKE_SIDE), GOLEM_CORRIDOR, 'back to the corridor');
  h.setLocation(...DUNGEON_ENTRY);
  assert.deepEqual(h.cross(LAKE_DOOR, GOLEM_SIDE), LAKE_ENTRY, 're-entered and crossed again');
  assert.ok(walkable(...LAKE_ENTRY), 'still on cache floor');
  assert.equal(caveExitCovering(LAKE_ENTRY), null, 'still no exit covering the landing');
});

test('control: the doors stay locked until all three channels are clear', () => {
  const h = setup('elid-lake-door-locked');
  h.player.setAttribute(BITS_ATTRIBUTE, 0);
  assert.deepEqual(h.cross(LAKE_DOOR, GOLEM_SIDE), GOLEM_SIDE, 'the player does not move');
  assert.equal(h.messages.at(-1), 'The door is locked.');
});
