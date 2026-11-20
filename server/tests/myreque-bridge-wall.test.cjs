// Run after `yarn build`: node --test tests/myreque-bridge-wall.test.cjs
// In Search of the Myreque (#5488), the bridge climb and the hidden wall, through the real plugin dispatch.
// Mechanics from the revision-242 playthrough capture (docs/in-search-of-the-myreque.md): the climbs a tick after their
// animation, landing on (3502,3427) and (3502,3432); the wall's open look and one walk step, with no message. Tiles are
// the cache's (wall 5052 at (3480,9837) type 0 rotation 3, on that tile's south edge; trees 5003 at (3502,3426) and
// (3502,3431); rungs 26245-26247 at (3502,3428-3430)).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const STAGE = 'quest.in_search_of_the_myreque.stage';
const BRIDGE = 'quest.in_search_of_the_myreque.bridge';
const REACHED_HOLLOWS = 25, SHOWN_WAY_OUT = 90, IN_INN_BASEMENT = 95;
const WALL = 5052, TREE = 5003, RUNG_BOTTOM = 26245, RUNG_TOP = 26247;
let core, next = 2800;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, stage, x, y, bridge = 0) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('myrequebw' + next);
  p.setRegistered(true); p.setLocation(new core.Location(x, y, 0)); p.needsPlacement = false;
  p.setAttribute(STAGE, stage);
  if (bridge) p.setAttribute(BRIDGE, bridge);
  if (bridge) PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  p.messages = [];
  p.sendMessage = (text) => { p.messages.push(text); };
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p); moving = moving.filter((m) => m !== p); });
  moving.push(p);
  return p;
}
const at = (p) => { const l = p.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
function click(p, id, x, y, type, face) {
  const object = new core.GameObject(id, new core.Location(x, y, 0), type, face, null);
  const event = { player: p, object, objectId: id, location: object.getLocation(), clickType: 1 };
  PM.emitObjectInteraction(event);
  return event;
}
const wall = (p) => click(p, WALL, 3480, 9837, 0, 3);
const tree = (p, y, face) => click(p, TREE, 3502, y, 10, face);
const rung = (p, id, y) => click(p, id, 3502, y, 22, 3);
/** Ticks: tasks, then each player's movement (the wall pass is a walk step). */
let moving = [];
const tick = (n) => {
  for (let i = 0; i < n; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    for (const p of moving) { const q = p.getMovementQueue(); q.beginCycle?.(); if (q.hasPendingWork?.()) q.process(); p.setNeedsPlacement(false); p.setResetMovementQueue(false); }
  }
};

test('the wall passes from the south side to the north side (rotation 3 wall on the (3480,9837) south edge)', (t) => {
  const p = actor(t, SHOWN_WAY_OUT, 3480, 9836);
  const event = wall(p);
  assert.ok(event.handled);
  assert.equal(p.getAttribute(STAGE), IN_INN_BASEMENT, 'stage 90 moves to 95');
  tick(6);
  assert.deepEqual(at(p), [3480, 9837, 0]);
  assert.deepEqual(p.messages, [], 'live sends no message for the pass');
});

test('the wall passes from the north side to the south side, and the stage stays after the first pass', (t) => {
  const p = actor(t, IN_INN_BASEMENT, 3480, 9837);
  wall(p);
  tick(6);
  assert.deepEqual(at(p), [3480, 9836, 0]);
  assert.equal(p.getAttribute(STAGE), IN_INN_BASEMENT, 'a stage past 90 is not moved by the pass');
});

test('before the way out is shown the wall does nothing but a message', (t) => {
  const p = actor(t, SHOWN_WAY_OUT - 5, 3480, 9836);
  const event = wall(p);
  assert.ok(event.handled);
  tick(6);
  assert.deepEqual(at(p), [3480, 9836, 0]);
  assert.deepEqual(p.messages, ['You see nothing interesting with this wall.']);
  assert.equal(p.getAttribute(STAGE), SHOWN_WAY_OUT - 5);
});

test('the south tree climbs up from the bank onto the bridge and down again, each a tick after its animation', (t) => {
  const p = actor(t, REACHED_HOLLOWS, 3502, 3425);
  assert.ok(tree(p, 3426, 3).handled);
  assert.deepEqual(at(p), [3502, 3425, 0], 'not yet');
  tick(1);
  assert.deepEqual(at(p), [3502, 3427, 0], 'up: the bridge landing');
  assert.deepEqual(p.messages, ['You climb up the tree.']);
  tree(p, 3426, 3);
  tick(1);
  assert.deepEqual(at(p), [3502, 3425, 0], 'down from the bridge: the south bank');
  assert.deepEqual(p.messages, ['You climb up the tree.', 'You climb down the tree.']);
});

test('the north tree needs all three rungs (ours: no capture climbs it earlier)', (t) => {
  const statement = 'This bridge run looks broken; you would have nowhere to stand. The southern side of the rope bridge looks much less damaged.';
  for (const [label, rungs] of [['only the top rung', 0b100], ['only the bottom rung', 0b001], ['the two lower rungs', 0b011], ['no rung', 0]]) {
    const p = actor(t, REACHED_HOLLOWS, 3502, 3432, rungs);
    tree(p, 3431, 1);
    tick(1);
    assert.deepEqual(at(p), [3502, 3432, 0], label);
    assert.deepEqual(p.messages, [statement], label);
  }
});

test('the north tree with all three rungs repaired climbs up to the bridge top and down to the north bank (3502,3432)', (t) => {
  const p = actor(t, REACHED_HOLLOWS, 3502, 3432, 0b111);
  tree(p, 3431, 1);
  tick(1);
  assert.deepEqual(at(p), [3502, 3430, 0], 'up from the north bank: the bridge top');
  tree(p, 3431, 1);
  tick(1);
  assert.deepEqual(at(p), [3502, 3432, 0], 'down from the bridge: the north bank');
});

test('the trees have no reason to be climbed before the Hollows', (t) => {
  const p = actor(t, REACHED_HOLLOWS - 5, 3502, 3425);
  tree(p, 3426, 3);
  assert.deepEqual(at(p), [3502, 3425, 0]);
  assert.deepEqual(p.messages, ['You have no reason to cross here.']);
});

test('a rung is repaired with a plank, 75 steel nails and a hammer; the state is the attribute and varbit 178 for the top rung', (t) => {
  const p = actor(t, REACHED_HOLLOWS, 3502, 3429);
  const { ItemIdentifiers: I } = core;
  p.getInventory().adds(I.PLANK, 1); p.getInventory().adds(I.STEEL_NAILS, 75); p.getInventory().adds(I.HAMMER, 1);
  const event = rung(p, RUNG_TOP, 3430);
  assert.ok(event.handled);
  tick(8);
  assert.equal(Number(p.getAttribute(BRIDGE)) & 0b100, 0b100, 'the top rung bit');
  assert.equal(p.getPacketSender().getVarbit(178), 1);
  assert.equal(p.getInventory().getAmount(I.PLANK), 0);
  assert.equal(p.getInventory().getAmount(I.STEEL_NAILS), 0);
  assert.deepEqual(p.messages, ['You repair a section of the bridge.']);
  const again = actor(t, REACHED_HOLLOWS, 3502, 3429, 0b100);
  rung(again, RUNG_TOP, 3430);
  assert.ok(again.messages.includes("This bridge run already looks fixed, that's why you're able to stand on it."), again.messages.join('|'));
});
