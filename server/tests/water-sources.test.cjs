// From server/: node --test tests/water-sources.test.cjs (after yarn build).
// WaterSources: the item-on-object hook against the cache's loc names.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, O = core.ObjectIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.ObjectDefinition.init();
});

function harness() {
  const tasks = [], events = [];
  let hook;
  const api = {
    core: { ...core, TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } } },
    onItemOnObject: (fn) => { hook = fn; },
    emitCustomEvent: (key, event) => events.push([key, event]),
  };
  const plugin = require('../plugins/world/WaterSources.plugin.js');
  plugin.register(api);
  const tick = () => tasks.slice().forEach((task) => task.isRunning() && task.execute());
  return { hook: (event) => { hook(event); return event; }, tasks, events, tick };
}

function player(items) {
  const slots = items.map((id) => new core.Item(id, 1));
  const location = new core.Location(1440, 9625, 1);
  const p = {
    spam: [], animations: [], sounds: [], location,
    getInventory: () => inventory,
    getLocation: () => location,
    getIndex: () => 1,
    isRegistered: () => true,
    performAnimation: (animation) => p.animations.push(animation.getId()),
    getPacketSender: () => ({
      sendSoundEffect: (id) => p.sounds.push(id),
      sendTypedMessage: (type, text) => p.spam.push(text),
    }),
    count: (id) => slots.filter((item) => item?.getId() === id).length,
  };
  const inventory = {
    getSlotForItemId: (id) => slots.findIndex((item) => item?.getId() === id),
    getItems: () => slots,
    setItem(slot, item) { slots[slot] = item; return inventory; },
    refreshItems() {},
  };
  return p;
}

function use(h, p, itemId, objectId) {
  return h.hook({ player: p, itemId, objectId, location: new core.Location(1437, 9623, 1) });
}

test('Neypotzli entrance fountainhead fills each empty bucket, one per tick', () => {
  const h = harness();
  const p = player([I.BUCKET, I.BUCKET]);
  const event = use(h, p, I.BUCKET, O.ANCIENT_FOUNTAINHEAD);
  assert.equal(event.handled, true);
  assert.equal(p.count(I.BUCKET_OF_WATER), 1);
  assert.deepEqual(p.animations, [832]);
  assert.deepEqual(p.sounds, [2609]);
  assert.deepEqual(p.spam, ['You fill the bucket.']);
  assert.equal(h.events[0][0], 'water-source:filled');
  assert.equal(h.events[0][1].name, 'ancient fountainhead');
  h.tick();
  assert.equal(p.count(I.BUCKET), 0);
  assert.equal(p.count(I.BUCKET_OF_WATER), 2);
  assert.deepEqual(p.spam, ['You fill the bucket.'], 'only the first fill sends the line');
});

test('Blue Moon chamber fountainhead refills a waterskin', () => {
  const h = harness();
  const p = player([I.WATERSKIN_1_]);
  assert.equal(use(h, p, I.WATERSKIN_1_, O.ANCIENT_FOUNTAINHEAD_4).handled, true);
  assert.equal(p.count(I.WATERSKIN_4_), 1);
});

test('Blood and Eclipse Moon chamber fountainheads are not water sources', () => {
  for (const objectId of [O.ANCIENT_FOUNTAINHEAD_6, O.ANCIENT_FOUNTAINHEAD_8]) {
    const h = harness();
    const p = player([I.VIAL]);
    assert.equal(use(h, p, I.VIAL, objectId).handled, undefined);
    assert.equal(p.count(I.VIAL), 1);
    assert.deepEqual(p.spam, []);
  }
});

test('a fountain still fills with its own line', () => {
  const h = harness();
  const p = player([I.VIAL]);
  assert.equal(use(h, p, I.VIAL, O.FOUNTAIN).handled, true);
  assert.deepEqual(p.spam, ['You fill the vial from the fountain.']);
});
