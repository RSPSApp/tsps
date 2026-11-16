// Run after `yarn build`: node --test tests/charred-island.test.cjs
//
// Charred Island's dark hole (Wiki: Dark hole (Charred Island), its transcript): tying the rope
// once, with a real Player and Inventory; the climb itself is a loc teleport (loc-teleports.test.cjs).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let Charred, core;
const hooks = {};
const prompts = [];
const climbs = [];
const logged = [];
const persisted = new Map();

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    onItemOnObject: (item, loc, fn) => { hooks[`${item} on ${loc}`] = fn; },
    onPlayerLogin: (fn) => { hooks.login = fn; },
    persistAttribute: (key, value) => persisted.set(key, value),
    sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ title, pairs }),
    onCustomEvent: (name, fn) => { hooks[name] = fn; },
    emitCustomEvent: (name, event) => (event.destination
      ? climbs.push({ name, to: [event.destination.getX(), event.destination.getY(), event.destination.getZ()] })
      : logged.push({ name, itemId: event.itemId })),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Charred = require('../plugins/areas/CharredIsland.plugin');
  Charred.register(api);
});

const HOLE = () => core.CacheDefinitions.getLocId('sailing_islands_dragon_island_dungeon_entrance_multiloc');
const VARBIT = () => core.CacheDefinitions.getVarbitId('dragon_island_dungeon_entrance_roped');

let nextIndex = 980;
function player(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.boxes = [];
  p.varbits = new Map();
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.mock.method(p, 'performAnimation', () => {});
  t.mock.method(p.getPacketSender(), 'sendVarbit', (id, v) => { p.varbits.set(id, v); return p.getPacketSender(); });
  t.mock.method(p, 'getDialogueManager', () => ({ startDialogues: (b) => { for (const d of b.getDialogues().values()) if (d.getText?.()) p.boxes.push(d.getText()); } }));
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  return p;
}

const climb = (p, objectId = HOLE()) => hooks['Dark hole']['Climb-down']({ player: p, objectId });
const rope = () => core.ItemIdentifiers.ROPE;

test('Climb-down with no rope tied or carried: the sheer drop box, and no way down', (t) => {
  const p = player(t);
  prompts.length = 0;
  assert.equal(climb(p), true);
  assert.deepEqual(p.boxes, [Charred._test.NEEDS_ROPE]);
  assert.equal(prompts.length, 0);
  assert.equal(p.varbits.size, 0);
});

test('Climb-down carrying a rope asks to attach it; Yes. uses the rope, ties it for good, and the hole is left to the climb', (t) => {
  const p = player(t);
  p.getInventory().add(new core.Item(rope(), 2));
  prompts.length = 0;
  climb(p);
  assert.equal(prompts[0].title, 'Attach a rope to the top of the hole?');
  assert.deepEqual(prompts[0].pairs.filter((_, i) => i % 2 === 0), ['Yes.', 'No.']);
  prompts[0].pairs[3]();
  assert.equal(p.getInventory().getAmount(rope()), 2, 'No. keeps the rope');
  prompts[0].pairs[1]();
  assert.equal(p.getInventory().getAmount(rope()), 1);
  assert.equal(p.varbits.get(VARBIT()), 1);
  assert.deepEqual(p.boxes, [Charred._test.TIED]);
  assert.equal(persisted.get(Charred._test.ROPED_ATTRIBUTE), false, 'saved, starting untied');
  // Roped: Climb-down climbs to the dungeon, and its rope back up beside the hole.
  climbs.length = 0;
  assert.equal(climb(p), true);
  assert.deepEqual(climbs, [{ name: 'ladders:climbDown', to: [2683, 8877, 0] }]);
  const claim = { player: p, objectId: core.CacheDefinitions.getLocId('sailing_islands_dragon_island_dungeon_exit'), handled: false };
  hooks['ladders:climb'](claim);
  assert.equal(claim.handled, true);
  assert.deepEqual(climbs[1], { name: 'ladders:climbUp', to: [2637, 2414, 0] });
  const otherRope = { player: p, objectId: core.ObjectIdentifiers.DARK_HOLE, handled: false };
  hooks['ladders:climb'](otherRope);
  assert.equal(otherRope.handled, false, 'other ropes and ladders are left to Ladders');
  p.varbits.clear();
  hooks.login({ player: p });
  assert.equal(p.varbits.get(VARBIT()), 1, 'sent again at login');
});

test('the hole and the rope are the cache\'s locs, and both landings are walkable tiles beside them', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init();
  const hole = core.CacheDefinitions.getObject(HOLE());
  assert.equal(hole.transformVarbit, VARBIT());
  for (const variant of hole.transforms.slice(0, 2)) assert.equal(core.CacheDefinitions.getObject(variant).actions[0], 'Climb-down');
  assert.equal(core.CacheDefinitions.getObject(core.CacheDefinitions.getLocId('sailing_islands_dragon_island_dungeon_exit')).actions[0], 'Climb-up');
  for (const [x, y, z] of [Charred._test.DUNGEON_LANDING, Charred._test.ISLAND_LANDING]) {
    RegionManager.loadMapFiles(x & ~63, y & ~63, false);
    assert.equal(RegionManager.getClipping(x, y, z, null) & 0x1200100, 0, `${x},${y} is walkable`);
  }
});

test('a rope used on the hole asks the same; other dark holes are left alone', (t) => {
  const p = player(t);
  p.getInventory().add(new core.Item(rope(), 1));
  prompts.length = 0;
  assert.equal(hooks['Rope on Dark hole']({ player: p, objectId: HOLE() }), true);
  assert.equal(prompts[0].title, 'Attach a rope to the top of the hole?');
  const lumbridge = core.ObjectIdentifiers.DARK_HOLE; // Lumbridge Swamp's, Misthalin.plugin.js
  assert.equal(climb(p, lumbridge), false);
  assert.equal(hooks['Rope on Dark hole']({ player: p, objectId: lumbridge }), false);
});

const chest = () => core.CacheDefinitions.getLocId('gerardus_charred_chest_closed');
const key = () => core.CacheDefinitions.getObjId('sailing_gerardus_unquiet_trinket');
const paint = () => core.CacheDefinitions.getObjId('sailing_paint_zamorakian');
const withLines = (p, t) => { p.lines = []; t.mock.method(p, 'sendMessage', (m) => p.lines.push(m)); return p; };

test('the Old chest is locked until the charred key is used on it', (t) => {
  const p = withLines(player(t), t);
  assert.equal(hooks['Old chest'].Open({ player: p, objectId: chest() }), true);
  assert.deepEqual(p.lines, [Charred._test.LOCKED]);
  assert.equal(p.getInventory().getAmount(paint()), 0);
});

test('the charred key breaks in the lock: the chest opens for good, with paint and its box; Open then gives more', (t) => {
  const p = withLines(player(t), t);
  p.getInventory().add(new core.Item(key(), 1));
  logged.length = 0;
  assert.equal(hooks['Charred key on Old chest']({ player: p, objectId: chest() }), true);
  assert.equal(p.getInventory().getAmount(key()), 0, 'the key breaks off in the lock');
  assert.equal(p.getInventory().getAmount(paint()), 1);
  assert.deepEqual(p.boxes, [Charred._test.KEY_BREAKS]);
  assert.deepEqual(logged, [{ name: 'collection-log:obtain', itemId: paint() }]);
  assert.equal(p.getAttribute(Charred._test.CHEST_UNLOCKED_ATTRIBUTE), true);
  assert.equal(persisted.get(Charred._test.CHEST_UNLOCKED_ATTRIBUTE), false, 'saved, starting locked');
  for (let i = 0; i < 3; i++) hooks['Old chest'].Open({ player: p, objectId: chest() });
  assert.equal(p.getInventory().getAmount(paint()), 4, 'without end');
  assert.deepEqual(p.lines, Array(3).fill(Charred._test.TAKE_PAINT));
});

test('a full inventory keeps the key and takes no paint; other Old chests are left alone', (t) => {
  const p = withLines(player(t), t);
  p.getInventory().add(new core.Item(key(), 1));
  for (let i = p.getInventory().getFreeSlots(); i > 0; i--) p.getInventory().add(new core.Item(core.ItemIdentifiers.LOGS, 1));
  hooks['Charred key on Old chest']({ player: p, objectId: chest() });
  assert.equal(p.getInventory().getAmount(key()), 1);
  assert.deepEqual(p.lines, [Charred._test.NO_SPACE]);
  assert.notEqual(p.getAttribute(Charred._test.CHEST_UNLOCKED_ATTRIBUTE), true);
  assert.equal(hooks['Old chest'].Open({ player: p, objectId: chest() + 1 }), false);
});
