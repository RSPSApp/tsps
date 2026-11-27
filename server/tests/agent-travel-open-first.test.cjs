// From server/: node --test tests/agent-travel-open-first.test.cjs (after yarn build).
// The live data's Edgeville trapdoor row is the open trapdoor's Climb-down; a player meeting it
// closed opens it first, as live (Open only swaps the loc), then climbs down.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
const { createContext } = require('../plugins/agent/mcp/Context.AgentMcp');
const travel = require('../plugins/agent/mcp/Travel.AgentMcp');

const TRAPDOOR = { x: 3097, y: 3468, z: 0 };
const ROW = [[3096, 3468, 0], [3096, 9867, 0], 'Climb-down Trapdoor', 1581, 1];
let core; let nextIndex = 1700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi(); core.RegionManager.init();
  PluginManager.createApi('TravelOpenFirstRefusal').onObjectInteraction((event) => {
    if (event.objectId === core.ObjectIdentifiers.TRAPDOOR_4 && event.player.getAttribute('travel-test:stuck')) event.handled = true;
  });
  for (const name of ['world/LocTeleports', 'areas/Misthalin', 'objects/Ladders']) {
    require(`../plugins/${name}.plugin`).register(PluginManager.createApi(`TravelOpenFirst${name}`));
  }
});

const objectsAt = () => {
  core.RegionManager.getClipping(TRAPDOOR.x, TRAPDOOR.y, TRAPDOOR.z, null);
  return (core.MapObjects.mapObjects.get(core.MapObjects.getHash(TRAPDOOR.x, TRAPDOOR.y, TRAPDOOR.z)) ?? [])
    .filter((o) => o.getLocation().getX() === TRAPDOOR.x && o.getLocation().getY() === TRAPDOOR.y);
};
const trapdoorId = () => objectsAt().map((o) => o.getId()).find((id) => id === core.ObjectIdentifiers.TRAPDOOR_4 || id === core.ObjectIdentifiers.TRAPDOOR_6);

function setup() {
  const p = new Player(new PlayerSession({ kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} }));
  p.setUsername(`openfirst${nextIndex}`).setIndex(nextIndex++); p.setRegistered(true); p.setLocation(new core.Location(3096, 3468, 0));
  const sent = []; let handler;
  const ctx = createContext(core, { registerTool() {} });
  ctx.find = () => p; ctx.tool = (_n, _d, _s, h) => handler = h;
  ctx.sleepTicks = async (count) => { for (let i = 0; i < count; i++) { core.World.processCycle++; core.TaskManager.process(); p.getMovementQueue().process(); core.TaskManager.processRemainingWalkTo(); p.resetUpdating(); } };
  ctx.send = (player, packet) => { sent.push(packet); assert.equal(packet.type, 'object_option'); new ObjectActionPacketListener().executeAction(player, packet.id, packet.x, packet.y, undefined, packet.action); };
  travel._test.setTransports({ columns: ['from', 'to', 'menu', 'id', 'ticks'], transports: { transports: [ROW] } });
  travel(ctx, { areas: { get: () => null } });
  return { p, sent, go: () => handler({ player: p.getUsername(), x: 3096, y: 9867, z: 0, exact: false, run: false, budgetTicks: 60, retryFailed: true, skipWalks: false }) };
}

test('a closed trapdoor on a Climb-down row is opened, then climbed down to the row\'s landing', async () => {
  assert.equal(trapdoorId(), core.ObjectIdentifiers.TRAPDOOR_4);
  const h = setup();
  const r = await h.go();
  assert.equal(r.result, 'arrived');
  assert.deepEqual(h.sent.map((packet) => packet.action), ['Open', 'Climb-down']);
  assert.deepEqual([h.p.getLocation().getX(), h.p.getLocation().getY(), h.p.getLocation().getZ()], [3096, 9867, 0]);
  assert.equal(trapdoorId(), core.ObjectIdentifiers.TRAPDOOR_6, 'it stays open, as live');
});

test('an open trapdoor is climbed down without opening', async () => {
  assert.equal(trapdoorId(), core.ObjectIdentifiers.TRAPDOOR_6);
  const h = setup();
  const r = await h.go();
  assert.equal(r.result, 'arrived');
  assert.deepEqual(h.sent.map((packet) => packet.action), ['Climb-down']);
});

test('a closed loc that does not open blocks the leg after the one Open', async () => {
  const closer = setup();
  new ObjectActionPacketListener().executeAction(closer.p, core.ObjectIdentifiers.TRAPDOOR_6, TRAPDOOR.x, TRAPDOOR.y, undefined, 'Close');
  for (let i = 0; i < 5; i++) {
    core.World.processCycle++; core.TaskManager.process(); closer.p.getMovementQueue().process(); core.TaskManager.processRemainingWalkTo();
  }
  assert.equal(trapdoorId(), core.ObjectIdentifiers.TRAPDOOR_4);
  const h = setup();
  h.p.setAttribute('travel-test:stuck', true);
  const r = await h.go();
  assert.equal(r.result, 'blocked');
  assert.deepEqual(h.sent.map((packet) => packet.action), ['Open']);
  assert.match(r.reason, /did not open/);
});
