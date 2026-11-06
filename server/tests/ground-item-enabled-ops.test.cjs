const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets, encodeGroundItems, GROUND_ITEM_BYTES } = require('../dist/net/protocol/ClientProtocol');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const { ItemOnGround, State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
const { ItemOnGroundManager: manager, World, Item, Location, ItemIdentifiers: I } = core;
const { PickupItemPacketListener } = require('../dist/net/packet/impl/PickupItemPacketListener');
before(async () => { await CachePipeline.initialize(); core.RegionManager.init(); core.RegionManager.loadMapFiles(2822, 3355); });
function fixture(t) {
  const old = World.getItems().splice(0);
  t.after(() => World.getItems().splice(0, World.getItems().length, ...old));
  const players = [], frames = [];
  for (let n = 0; n < 2; n++) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: b => { frames.push([n, Buffer.from(b)]); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(new PlayerSession(channel));
    player.setUsername(`opsviewer${n}`); player.setIndex(9000 + n); player.setRegistered(true);
    player.setLocation(new Location(2822, 3355)); player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99, false);
    player.needsPlacement = false;
    const connection = new ClientConnection(channel); connection.player = player;
    players.push({ player, connection });
    t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  }
  t.mock.method(World, 'forEachNetworkPlayer', f => players.forEach(({ player }) => f(player)));
  const pile = (id = I.GLASSBLOWING_PIPE, quantity = 1) => {
    const ground = new ItemOnGround(State.SEEN_BY_EVERYONE, undefined, players[0].player.getLocation().clone(), new Item(id, quantity), false, -1, null);
    manager.register(ground); return ground;
  };
  return { ...players[0], other: players[1].player, pile, frames };
}
function op3(id) { const x = 2822, y = 3355; return Buffer.from([103, id & 255, id >>> 8, (x + 128) & 255, x >>> 8, y >>> 8, (y + 128) & 255, 128]); }
test('native Take honours disabled bit 2 per viewer, then succeeds after reset', async t => {
  const f = fixture(t), ground = f.pile();
  ground.setEnabledOps(31 & ~(1 << 2), f.player);
  await f.connection.dispatch(decodeClientPackets(op3(ground.getItem().getId())), true);
  assert.equal(f.player.getInventory().getAmount(I.GLASSBLOWING_PIPE), 0);
  assert.equal(ground.isPendingRemoval(), false);
  assert.equal(ground.getEnabledOps(f.other), 31);
  ground.resetEnabledOps(f.player);
  await f.connection.dispatch(decodeClientPackets(op3(ground.getItem().getId())), true);
  assert.equal(f.player.getInventory().getAmount(I.GLASSBLOWING_PIPE), 1);
  assert.equal(ground.isPendingRemoval(), true);
});
test('a queued Take rechecks the same real stack after its flags change', t => {
  const f = fixture(t), ground = f.pile(); let arrival;
  // Only delay movement; the real stack, policy, inventory and pickup remain intact.
  t.mock.method(f.player.getMovementQueue(), 'walkToGroundItem', (_position, action) => { arrival = action; });
  PickupItemPacketListener.pickup(f.player, ground.getItem().getId(), 2822, 3355, ground.getId());
  assert.equal(typeof arrival, 'function');
  ground.setEnabledOps(0); arrival();
  assert.equal(f.player.getInventory().getAmount(I.GLASSBLOWING_PIPE), 0);
  ground.setEnabledOps(31); arrival();
  assert.equal(f.player.getInventory().getAmount(I.GLASSBLOWING_PIPE), 1);
});
test('different operation policies prevent real stack merges; respawn clone resets viewer overrides', t => {
  const f = fixture(t), a = f.pile(I.COINS, 2);
  a.setEnabledOps(0);
  const b = f.pile(I.COINS, 3);
  assert.ok(World.getItems().includes(b)); assert.equal(a.getItem().getAmount(), 2);
  b.setEnabledOps(0, f.player);
  const copy = b.clone();
  assert.equal(copy.getEnabledOps(f.player), 31);
  const baseCopy = a.clone(); assert.equal(baseCopy.getEnabledOps(f.player), 0);
  assert.notEqual(baseCopy.getId(), a.getId());
});
test('recipient snapshots and deltas carry the exact mask including zero', t => {
  const f = fixture(t), ground = f.pile();
  f.player.getSession().flushPackets(); f.frames.length = 0; ground.setEnabledOps(0, f.player); f.player.getSession().flushPackets();
  assert.equal(f.frames.length, 1); assert.equal(f.frames[0][0], 0);
  const delta = f.frames[0][1];
  assert.equal(GROUND_ITEM_BYTES, 34); assert.equal(delta[3 + 6 + 33], 0);
  f.frames.length = 0; manager.onRegionChange(f.player); f.player.getSession().flushPackets(); manager.onRegionChange(f.other); f.other.getSession().flushPackets();
  assert.equal(f.frames[0][1][3 + 6 + 33], 0);
  assert.equal(f.frames[1][1][3 + 6 + 33], 31);
  const frame = encodeGroundItems(1, [{ id: 1, itemId: 1785, quantity: 1, x: 2822, y: 3355, level: 0 }]);
  assert.equal(frame.at(-1), 31);
});
test('native same-id piles select an enabled candidate; an exact disabled stack cannot retarget', async t => {
  const f = fixture(t), disabled = f.pile(I.COINS, 2);
  disabled.setEnabledOps(0);
  const enabled = f.pile(I.COINS, 3);
  enabled.getItem().setMeta({ source: 'enabled-pile' });
  PickupItemPacketListener.pickup(f.player, I.COINS, 2822, 3355, disabled.getId());
  assert.equal(f.player.getInventory().getAmount(I.COINS), 0);
  await f.connection.dispatch(decodeClientPackets(op3(I.COINS)), true);
  assert.equal(f.player.getInventory().getAmount(I.COINS), 3);
  assert.deepEqual(f.player.getInventory().getItems().find(i => i.getId() === I.COINS).getMeta(), { source: 'enabled-pile' });
  assert.equal(disabled.isPendingRemoval(), false);
  assert.equal(enabled.isPendingRemoval(), true);
});
test('Take uses the cache slot for giant bones and rejects invalid masks without mutation', t => {
  const f = fixture(t), ground = f.pile(I.GIANT_BONES);
  assert.equal(manager.takeOperation(I.GIANT_BONES), 4);
  ground.setEnabledOps(1 << 2);
  assert.equal(manager.getOperableGroundItem(f.player, I.GIANT_BONES, f.player.getLocation(), 4), null);
  assert.equal(manager.getOperableGroundItem(f.player, I.GIANT_BONES, f.player.getLocation(), 3), ground);
  for (const invalid of [-1, 32, 1.5, NaN]) assert.throws(() => ground.setEnabledOps(invalid), RangeError);
  assert.equal(ground.getEnabledOps(), 4);
});
