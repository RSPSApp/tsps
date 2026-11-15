// #5693: repairing a Myreque bridge rung puts the player on the repaired rung (void SearchMyreque.kt walkTo(target.tile)),
// so the next rung is within reach. Real walk-to-object route from the landing; run after `yarn build`.
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
  p.messages = [];
  p.sendMessage = (text) => { p.messages.push(text); };
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
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
const tick = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };

const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { RegionManager } = require('../dist/game/collision/RegionManager');

function step(p) { core.World.processCycle++; core.TaskManager.process(); const q = p.getMovementQueue(); q.beginCycle?.(); if (q.hasPendingWork?.()) q.process(); core.TaskManager.processWalkTo(p.getIndex()); p.setNeedsPlacement(false); p.setResetMovementQueue(false); /* the player update clears these at the end of every cycle */ }
const objectsAt = (x, y) => MapObjects.getObjectsAt(new core.Location(x, y, 0), null);

/** Click the real placed rung object the way the packet does: walk to it, then dispatch the Repair option. */
function repairRung(p, y) {
  const object = objectsAt(3502, y).find((o) => o.getId() >= 26245 && o.getId() <= 26247);
  assert.ok(object, `real rung at (3502,${y})`);
  const clickType = ObjectDefinition.forPlayer(object.getId(), p).getActions().indexOf('Repair') + 1;
  assert.ok(clickType > 0, 'the real rung offers Repair');
  p.getMovementQueue().walkToObject(object, { execute: () => {
    PM.emitObjectInteraction({ player: p, object, objectId: object.getId(), location: object.getLocation(), clickType,
      definition: ObjectDefinition.forPlayer(object.getId(), p), handled: false });
  } }, clickType);
  for (let i = 0; i < 12; i++) step(p);
}

test('repairing the three rungs one after another walks the player along the bridge', (t) => {
  RegionManager.init();
  const p = actor(t, REACHED_HOLLOWS, 3502, 3427);
  const { ItemIdentifiers: I } = core;
  p.getInventory().adds(I.PLANK, 3); p.getInventory().adds(I.STEEL_NAILS, 225); p.getInventory().adds(I.HAMMER, 1);
  for (const [y, bits] of [[3428, 0b001], [3429, 0b011], [3430, 0b111]]) {
    repairRung(p, y);
    assert.equal(Number(p.getAttribute(BRIDGE)), bits, `rung at ${y} repaired; at=${JSON.stringify(at(p))} msgs=${p.messages.join('|')}`);
    assert.deepEqual(at(p), [3502, y, 0], `the player stands on the repaired rung at ${y}`);
  }
  assert.ok(!p.messages.includes("I can't reach that!"), p.messages.join('|'));
  assert.ok(p.messages.includes('The rope bridge is now fully repaired.'));
  assert.equal(p.getInventory().getAmount(I.PLANK), 0);
});

test('an already repaired rung does not move the player', (t) => {
  RegionManager.init();
  const p = actor(t, REACHED_HOLLOWS, 3502, 3427, 0b001);
  repairRung(p, 3428);
  assert.deepEqual(at(p), [3502, 3427, 0]);
  assert.ok(p.messages.includes("This bridge run already looks fixed, that's why you're able to stand on it."), p.messages.join('|'));
});

test('without the materials the rung is not repaired and the player stays put', (t) => {
  RegionManager.init();
  const p = actor(t, REACHED_HOLLOWS, 3502, 3427);
  repairRung(p, 3428);
  assert.deepEqual(at(p), [3502, 3427, 0]);
  assert.equal(Number(p.getAttribute(BRIDGE) ?? 0), 0);
  assert.ok(p.messages.includes("You don't have the required materials to fix this part of the bridge."), p.messages.join('|'));
});
