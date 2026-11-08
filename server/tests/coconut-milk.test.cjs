// Run after `yarn build`: node --test tests/coconut-milk.test.cjs
// Wiki (Coconut, Half coconut, Coconut milk): a hammer on a coconut makes a half coconut, and the splitting continues
// by itself; a half coconut on an empty vial makes a vial of coconut milk and a coconut shell. Nothing made coconut
// milk, which antidote+, antidote++ and weapon poison(+)/(++) start from.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 9900;
const bots = process.env.DISABLE_PLAYER_BOTS;
const id = (name) => core.CacheDefinitions.getObjId(name);
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});
function cook(t, items) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('coconut' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  items.forEach((name, slot) => p.getInventory().setItem(slot, new core.Item(id(name), 1)));
  const use = async (from, to) => {
    const inv = p.getInventory();
    await c.dispatch([{ type: 'inventory_use_on', itemId: inv.forSlot(from).getId(), slot: from, target: { kind: 'inventory', slot: to } }]);
    c.processTurnPackets();
  };
  const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
  return { p, inv: p.getInventory(), use, ticks };
}
test('a hammer on a coconut splits it, and the rest split one a tick', async (t) => {
  const f = cook(t, ['hammer', 'coconut', 'coconut', 'coconut']);
  await f.use(0, 1);
  assert.equal(f.inv.forSlot(1).getId(), id('coconut_half'), 'the clicked coconut splits at once');
  assert.equal(f.inv.getAmount(id('coconut')), 2);
  f.ticks(3);
  assert.equal(f.inv.getAmount(id('coconut')), 0);
  assert.equal(f.inv.getAmount(id('coconut_half')), 3);
  assert.equal(f.inv.getAmount(id('hammer')), 1, 'the hammer stays');
});
test('a half coconut on an empty vial: coconut milk in the vial, a shell in the half coconut\'s slot', async (t) => {
  const f = cook(t, ['coconut_half', 'vial_empty']);
  await f.use(0, 1);
  assert.equal(f.inv.forSlot(1).getId(), id('vial_coconut_milk'));
  assert.equal(f.inv.forSlot(0).getId(), id('coconut_shell'));
});
