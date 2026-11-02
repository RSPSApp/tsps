const assert = require('node:assert/strict'), path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PlayerOptionPacketListener } = require('../dist/net/packet/impl/PlayerOptionPacketListener');
const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');

let core, next = 2200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3240, 3218);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, x = 3240, y = 3218) {
  const channel = {
    kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setUsername('follower' + next++);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendMessage', (message) => { messages.push(message); return sender; });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.World.getPlayers().remove(p);
  });
  return { p, c, messages };
}

const tick = (e, count = 1) => {
  for (let i = 0; i < count; i++) {
    e.p.getMovementQueue().process();
    e.p.needsPlacement = false;
  }
};
const gap = (a, b) => Math.max(
  Math.abs(a.p.getLocation().getX() - b.p.getLocation().getX()),
  Math.abs(a.p.getLocation().getY() - b.p.getLocation().getY()),
);
const follow = (follower, leader) =>
  PlayerOptionPacketListener.executeClientOption(follower.p, leader.p.getIndex(), 3);

test('the Follow option walks the follower to the target and keeps it adjacent', async (t) => {
  const follower = actor(t, 3240, 3218);
  const leader = actor(t, 3246, 3218);

  follow(follower, leader);
  assert.equal(follower.p.getFollowing(), leader.p);
  assert.equal(follower.p.getInteractingMobile(), leader.p);

  tick(follower, 12);
  assert.equal(gap(follower, leader), 1);
  assert.equal(follower.p.getFollowing(), leader.p);
});

test('a follower keeps up with a moving leader and settles one tile behind', async (t) => {
  const follower = actor(t, 3240, 3218);
  const leader = actor(t, 3242, 3218);
  follow(follower, leader);

  leader.p.getMovementQueue().requestWalk(new core.Location(3250, 3218, 0));
  for (let i = 0; i < 20; i++) {
    leader.p.getMovementQueue().process();
    follower.p.getMovementQueue().process();
  }

  assert.notEqual(leader.p.getLocation().getX(), 3242, 'the leader should have walked');
  assert.equal(gap(follower, leader), 1);
  assert.equal(follower.p.getFollowing(), leader.p);
});

test('follow does not end when the leader outruns the 15-tile player view', async (t) => {
  const follower = actor(t, 3240, 3218);
  const leader = actor(t, 3262, 3218);
  assert.ok(gap(follower, leader) > 15);

  follow(follower, leader);
  const start = follower.p.getLocation().getX();
  tick(follower, 12);

  assert.ok(follower.p.getLocation().getX() > start, 'the follower should start walking');
  assert.equal(follower.p.getFollowing(), leader.p);
  assert.deepEqual(follower.messages, [], 'a far leader is not "unable to find"');
});

test('a leader teleport ends the follow silently instead of pathing after them', async (t) => {
  const follower = actor(t, 3240, 3218);
  const leader = actor(t, 3242, 3218);
  follow(follower, leader);
  tick(follower, 2);

  const before = follower.p.getLocation().clone();
  leader.p.moveTo(new core.Location(3210, 3424, 0));
  tick(follower, 2);

  assert.equal(follower.p.getFollowing(), null);
  assert.equal(follower.p.getInteractingMobile(), null);
  assert.ok(follower.p.getLocation().equals(before), 'the follower must not walk to the landing tile');
  assert.deepEqual(follower.messages, []);
});

test('a leader changing plane ends the follow', async (t) => {
  const moves = [
    ['teleport', (p) => p.moveTo(new core.Location(3242, 3218, 1))],
    ['direct', (p) => p.setLocation(new core.Location(3242, 3218, 1))],
  ];
  for (const [name, move] of moves) {
    const follower = actor(t, 3240, 3218);
    const leader = actor(t, 3242, 3218);
    follow(follower, leader);
    tick(follower, 2);

    move(leader.p);
    tick(follower, 1);

    assert.ok(!follower.p.getFollowing(), `${name}: follow should stop`);
    assert.equal(follower.p.getInteractingMobile(), null, `${name}: interaction should clear`);
  }
});

test('a leader that logs out ends the follow', async (t) => {
  const follower = actor(t, 3240, 3218);
  const leader = actor(t, 3242, 3218);
  follow(follower, leader);

  leader.p.setRegistered(false);
  tick(follower, 1);

  assert.equal(follower.p.getFollowing(), null);
});

test('walking, inventory items and equipping all cancel the follow', async (t) => {
  const cases = [
    ['walk', (f) => f.p.getMovementQueue().requestWalk(new core.Location(3244, 3218, 0))],
    ['item', (f) => f.p.clearPendingAction()],
    ['equip', (f) => {
      f.p.getInventory().add(new core.Item(1205), true);
      EquipPacketListener.equip(f.p, 1205, 0, Inventory.INTERFACE_ID);
    }],
  ];
  for (const [name, cancel] of cases) {
    const follower = actor(t, 3240, 3218);
    const leader = actor(t, 3242, 3218);
    follow(follower, leader);
    tick(follower, 2);
    assert.ok(follower.p.getFollowing(), `${name}: should be following first`);

    cancel(follower);

    assert.equal(follower.p.getFollowing(), null, `${name}: follow should stop`);
    assert.equal(follower.p.getInteractingMobile(), null, `${name}: interaction should clear`);
  }
});

test('trading with the followed player cancels the follow', async (t) => {
  const follower = actor(t, 3240, 3218);
  const leader = actor(t, 3242, 3218);
  follow(follower, leader);
  tick(follower, 2);

  PlayerOptionPacketListener.executeClientOption(follower.p, leader.p.getIndex(), 2);

  assert.equal(follower.p.getFollowing(), null);
});

test('Follow ignores yourself and a dead or unregistered target', async (t) => {
  const follower = actor(t, 3240, 3218);
  const other = actor(t, 3242, 3218);

  PlayerOptionPacketListener.executeClientOption(follower.p, follower.p.getIndex(), 3);
  assert.ok(!follower.p.getFollowing());

  other.p.setHitpoints(0);
  PlayerOptionPacketListener.executeClientOption(follower.p, other.p.getIndex(), 3);
  assert.ok(!follower.p.getFollowing());

  other.p.setHitpoints(10);
  core.World.getPlayers().remove(other.p);
  PlayerOptionPacketListener.executeClientOption(follower.p, other.p.getIndex(), 3);
  assert.ok(!follower.p.getFollowing());
});
