// Run after `npx tsc --build`: node --test tests/item-fill-charges.test.cjs
//
// "item:fill-charges" { player, item, handled }: content that hands out charged items ready to
// use (the PvP Arena's load-outs) asks each item's own plugin for a full one. Every charged item
// the arena's load-outs offer (enum 4390) answers, through its real plugin and the real cache.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const PLUGINS = [
  'ToxicStaffOfTheDead.plugin', 'ToxicBlowpipe.plugin', 'SanguinestiStaff.plugin', 'ScytheOfVitur.plugin',
  'AmuletOfBloodFury.plugin', 'ElementalTomes.plugin', 'Trident.plugin', 'TumekensShadow.plugin',
  'EyeOfAyak.plugin', 'AccursedSceptre.plugin', 'WarpedSceptre.plugin',
];
const fillers = [];
let core;

before(() => {
  CachePipeline.initialize();
  const startups = [];
  const noop = () => {};
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onServerStartup: (handler) => startups.push(handler),
    onCustomEvent: (name, handler) => { if (name === 'item:fill-charges') fillers.push(handler); },
    getAreaManager: () => ({}),
  }, { get: (target, key) => target[key] ?? noop });
  core = api.core;
  for (const name of PLUGINS) require(`../plugins/items/${name}`).register(api);
  for (const startup of startups) startup({});
});

function fill(id) {
  const item = new core.Item(id, 1);
  const event = { player: null, item, handled: false };
  for (const handler of fillers) handler(event);
  return { item, handled: event.handled };
}

const I = () => core.ItemIdentifiers;

test('each charged load-out item comes full, in its charged form', () => {
  const cases = [
    [I().TOXIC_STAFF_OF_THE_DEAD, 'toxic-staff-charges', 11000],
    [I().SANGUINESTI_STAFF, 'sanguinesti-staff-charges', 20000],
    [I().SCYTHE_OF_VITUR, 'scythe-of-vitur-charges', 20000],
  ];
  for (const [id, key, charges] of cases) {
    const { item, handled } = fill(id);
    assert.equal(handled, true, core.CacheDefinitions.getItem(id).name);
    assert.equal(item.getId(), id);
    assert.equal(item.getMetaValue(key), charges);
  }
});

test('the blowpipe comes with its scales and darts, the amulet and the tome charged', () => {
  const pipe = fill(I().TOXIC_BLOWPIPE);
  assert.equal(pipe.handled, true);
  assert.equal(pipe.item.getId(), I().TOXIC_BLOWPIPE);
  assert.deepEqual(pipe.item.getMetaValue('toxic-blowpipe'), { scales: 16383, dartId: I().DRAGON_DART, dartAmount: 16383 });

  const amulet = fill(I().AMULET_OF_BLOOD_FURY);
  assert.equal(amulet.handled, true);
  assert.deepEqual(amulet.item.getMetaValue('blood-fury'), { charges: 30000 });

  const tome = fill(I().TOME_OF_FIRE);
  assert.equal(tome.handled, true);
  assert.equal(tome.item.getId(), I().TOME_OF_FIRE);
  assert.equal(tome.item.getMetaValue('elemental-tomes').charges, 20000);
});

test('an uncharged staff is handed out charged; items without charges are left alone', () => {
  const uncharged = fill(I().UNCHARGED_TRIDENT);
  assert.equal(uncharged.handled, true);
  assert.equal(uncharged.item.getId(), I().TRIDENT_OF_THE_SEAS);
  const plain = fill(I().ABYSSAL_WHIP);
  assert.equal(plain.handled, false);
  assert.equal(plain.item.getMeta?.() ?? null, null);
});
