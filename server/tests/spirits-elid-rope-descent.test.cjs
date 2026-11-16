// From server/ after `yarn build`: node --test tests/spirits-elid-rope-descent.test.cjs
// RSPSApp/tsps#5931: the rope on the root above the waterfall must work from the river's east
// bank (Wiki: follow the river north to the waterfall and use the rope on the root above it).
// The waterfall's tiles leave no standable tile beside the root on that bank, so the click is
// answered from the bank tile instead of a walk that cannot arrive. The plugin's real
// object-route and item-on-object handlers run here; the player, its movement queue and the
// scene timers are stubbed, as disclosed in the PR. The root's cache tile (3369,3132, 3x1) is
// read from the cache in the in-game check, not fixed in the plugin.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const runtime = require('../plugins/quests/QuestRuntime');

const ROOT = 6382;
const ROPE = 954;
const ROOT_LOCATION = new Location(3369, 3132, 0);
const ROOT_SIZE = { x: 3, y: 1 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function setup(username = 'elid-rope-test') {
  const hooks = { custom: new Map(), login: [], objectRoute: [], itemOnObject: [] };
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    getWorld: () => ({ getNpcs: () => [] }),
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    onObjectRoute(fn) { hooks.objectRoute.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/SpiritsOfTheElid.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map(), inventory = new Map(), messages = [];
  inventory.set(ROPE, 1);
  let location = new Location(3371, 3129, 0);
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
      getAmount: (id) => inventory.get(id) ?? 0,
      getItems: () => [],
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      isFull: () => false,
      getFreeSlots: () => 28,
    }),
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getSkillManager: () => ({ addExperiences() {}, stopSkillable() {} }),
    getLocation: () => location,
    setPositionToFace() {},
    forcePositionToFace() {},
    performAnimation() {},
    moveTo(to) { location = to; },
    getPrivateArea: () => null,
    getDialogueManager: () => ({ isActive: () => false, reset() {}, startDialogues() {} }),
    getMovementQueue: () => ({ reset() { return this; } }),
    sendMessage: (message) => messages.push(message),
  };
  const setLocation = (to) => { location = to; };
  const rootObject = { getLocation: () => ROOT_LOCATION, getId: () => ROOT };
  const definition = { getSizeX: () => ROOT_SIZE.x, getSizeY: () => ROOT_SIZE.y };
  const route = (from) => {
    const event = {
      player, object: rootObject, objectId: ROOT, definition,
      sourceLocation: { x: from.getX(), y: from.getY(), z: from.getZ() }, destination: null,
    };
    for (const fn of hooks.objectRoute) fn(event);
    return event;
  };
  const useRope = () => {
    const event = { player, item: { getId: () => ROPE }, itemId: ROPE, objectId: ROOT, object: rootObject, handled: false };
    for (const fn of hooks.itemOnObject) fn(event);
    return event;
  };
  return { quest, player, inventory, messages, setLocation, route, useRope, rootObject, definition };
}

test('the east bank click is answered from the player tile (BEFORE: no destination, the walk stalls in the bank pocket)', () => {
  const h = setup();
  // The Shortest Path plugin's "Use Rope -> Root" start tile, 3371,3129: three tiles south of
  // the root's footprint and the closest tile the walk can reach on that bank.
  const event = h.route(new Location(3371, 3129, 0));
  assert.deepEqual(event.destination, { x: 3371, y: 3129, z: 0 });
});

test('a click from the bank pocket two tiles off is answered the same way', () => {
  const h = setup();
  const event = h.route(new Location(3372, 3130, 0));
  assert.deepEqual(event.destination, { x: 3372, y: 3130, z: 0 });
});

test('control: adjacent and distant clicks keep the ordinary walk (no destination override)', () => {
  const h = setup();
  assert.equal(h.route(new Location(3370, 3131, 0)).destination, null, 'adjacent: walk as before');
  assert.equal(h.route(new Location(3371, 3120, 0)).destination, null, 'twelve tiles off: walk as before');
});

test('behaviour: using the rope on the root descends from the bank and keeps the rope', () => {
  const h = setup();
  const event = h.useRope();
  assert.equal(event.handled, true);
  assert.equal(h.inventory.get(ROPE) ?? 0, 1, 'the rope is kept, as live does');
  assert.equal(h.messages.at(-1), 'You tie the rope to the root and climb down into the cave.');
});
