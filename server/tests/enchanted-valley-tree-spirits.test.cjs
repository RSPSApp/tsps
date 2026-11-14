// Run after `yarn build`: node --test tests/enchanted-valley-tree-spirits.test.cjs
//
// Enchanted Valley's trees with every plugin loaded, so Woodcutting's generic "Tree" handler is
// in play: Chop down wakes a level-matched tree spirit and never yields logs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { World } = require('../dist/game/World');

// Two cache trees in the valley, one per test, so a spirit left standing at one cannot mask
// whether the other test's click spawned its own (each tree has one guardian).
const FIRST = { tree: { x: 3029, y: 4500 }, player: { x: 3028, y: 4500 } };
const SECOND = { tree: { x: 3029, y: 4509 }, player: { x: 3028, y: 4509 } };
let core, Plugin, next = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(FIRST.tree.x, FIRST.tree.y);
  PM.emitServerStartup({});
  Plugin = require('../plugins/areas/EnchantedValley.plugin');
});

after(() => PM.emitServerShutdown({}));

function player(t, at) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setUsername(`enchanted${++next}`);
  p.setLocation(new Location(at.x, at.y, 0));
  p.messages = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'sendMessage', (text) => { p.messages.push(text); });
  t.mock.method(p, 'isRegistered', () => true);
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.after(() => { TaskManager.cancelTasks(p); });
  return p;
}

const tree = (at) => {
  const object = MapObjects.get(core.ObjectIdentifiers.TREE_101, new Location(at.x, at.y, 0), null);
  assert.ok(object, `an Enchanted Valley tree stands at ${at.x},${at.y}`);
  return object;
};

function click(p, at) {
  const object = tree(at);
  const event = { player: p, object, objectId: object.getId(), clickType: 1, location: { x: at.x, y: at.y, z: 0 }, handled: false };
  return PM.emitObjectInteraction(event);
}

const spiritOf = (p) => {
  const found = [];
  World.getNpcs().forEach((npc) => {
    if (npc.getOwner?.() === p && npc.getId() >= 1861 && npc.getId() <= 1866) found.push(npc);
  });
  return found;
};

test('Enchanted Valley: Chop down wakes a spirit for the player combat level and gives no logs', (t) => {
  const p = player(t, FIRST.player);
  p.getInventory().adds(core.ItemIdentifiers.BRONZE_AXE, 1);
  assert.equal(click(p, FIRST.tree), true, 'the tree click is handled by the valley, not Woodcutting');

  const spirits = spiritOf(p);
  assert.equal(spirits.length, 1, 'exactly one spirit wakes');
  const spirit = spirits[0];
  assert.equal(spirit.getForcedChat(), Plugin._test.SPAWN_LINE);
  assert.equal(spirit.getCombat().getTarget(), p, 'the spirit attacks the player who chopped');

  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.LOGS), 0, 'no logs');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BRONZE_AXE), 1, 'the axe stays');

  click(p, FIRST.tree);
  assert.equal(spiritOf(p).length, 1, 'a second chop does not stack a second spirit');
  assert.ok(p.messages.includes(Plugin._test.SPIRIT_ALREADY_OUT), 'the Wiki line for a live spirit');
});

test('Enchanted Valley: the spirit level follows the Wiki bands', () => {
  const bands = [[3, 1861], [10, 1861], [11, 1862], [20, 1862], [21, 1863], [40, 1863],
    [41, 1864], [60, 1864], [61, 1865], [90, 1865], [91, 1866], [126, 1866]];
  for (const [level, expected] of bands) {
    assert.equal(Plugin._test.spiritId(level), expected, `combat level ${level}`);
  }
});

test('Enchanted Valley: the spirit leaves when the player walks more than three tiles off', (t) => {
  const p = player(t, SECOND.player);
  p.getInventory().adds(core.ItemIdentifiers.BRONZE_AXE, 1);
  click(p, SECOND.tree);
  const [spirit] = spiritOf(p);
  assert.ok(spirit);

  // Relative to where it spawned, so a diagonal spawn tile cannot already be 4 tiles off.
  const at = spirit.getLocation();
  p.setLocation(new Location(at.getX() + 3, at.getY(), at.getZ()));
  TaskManager.process();
  assert.ok(spirit.isRegistered(), 'three tiles away still keeps it');

  p.setLocation(new Location(at.getX() + 4, at.getY(), at.getZ()));
  TaskManager.process();
  TaskManager.process();
  assert.equal(spirit.isRegistered(), false);
  assert.equal(spiritOf(p).length, 0);
});
