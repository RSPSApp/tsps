const assert = require('node:assert/strict'), path = require('node:path');
const { before, after, test } = require('node:test');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
const { PluginManager: PM } = require(root + '/dist/plugins/PluginManager');
const { Player } = require(root + '/dist/game/entity/impl/player/Player');
const { PlayerSession } = require(root + '/dist/net/PlayerSession');
const { ObjectDefinition } = require(root + '/dist/game/definition/ObjectDefinition');

// The desert habitat's cactus Touch, as rsprox capture 2792 (ticks 768-890) and the Wiki
// (Desert habitat) give it: human_pickuptable, then "That was unwise." (spam) and a 2 hit a tick later.
let core, CACTUS, next = 1720;
before(async () => {
  await CachePipeline.initialize(root);
  PM.loadFromDirectory(root + '/plugins');
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
  CACTUS = core.CacheDefinitions.getLocId('poh_menagerie_habitat_feature_3');
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername('cactus' + next);
  p.setRegistered(true);
  p.setLocation(new core.Location(1960, 5700, 0));
  p.needsPlacement = false;
  const sender = p.getPacketSender(), typed = [], animations = [], hits = [];
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { typed.push([type, text]); return sender; });
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, 'performAnimation', (animation) => { animations.push(animation.getId()); return perform(animation); });
  const queue = p.getCombat().getHitQueue(), add = queue.addPendingDamage.bind(queue);
  t.mock.method(queue, 'addPendingDamage', (list) => { hits.push(...list.map(hit => [hit.getDamage(), hit.getHitmask()])); return add(list); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  return { p, typed, animations, hits };
}

function touch(f, id = CACTUS) {
  const object = new core.GameObject(id, new core.Location(1961, 5700, 0), 10, 0);
  const definition = ObjectDefinition.forId(id);
  const event = { player: f.p, object, objectId: id, definition, location: object.getLocation(), clickType: 1, handled: false };
  return PM.emitObjectInteraction(event);
}

const tick = () => core.TaskManager.process();

test('the cactus is the cache\'s Touch loc', () => {
  assert.equal(ObjectDefinition.forId(CACTUS).getName(), 'Cactus');
  assert.equal(ObjectDefinition.forId(CACTUS).getInteractions()[0], 'Touch');
});

test('Touch plays human_pickuptable, then says "That was unwise." and hits for 2 a tick later', (t) => {
  const f = actor(t);
  assert.equal(touch(f), true);
  assert.deepEqual(f.animations, [core.CacheDefinitions.getSeqId('human_pickuptable')]);
  assert.deepEqual(f.typed, []);
  assert.deepEqual(f.hits, []);
  tick();
  const { ChatType } = core;
  assert.deepEqual(f.typed, [[ChatType.SPAM, 'That was unwise.']]);
  assert.deepEqual(f.hits, [[2, core.HitMask.RED]]);
});

test('a touch under way swallows another; the next one starts after the sting', (t) => {
  const f = actor(t);
  touch(f);
  assert.equal(touch(f), true);
  assert.equal(f.animations.length, 1);
  tick();
  assert.equal(f.hits.length, 1);
  touch(f);
  assert.equal(f.animations.length, 2);
  tick();
  assert.equal(f.hits.length, 2);
  assert.equal(f.typed.length, 2);
});

test('a player who logs out before the sting takes no damage', (t) => {
  const f = actor(t);
  touch(f);
  f.p.setRegistered(false);
  tick();
  assert.deepEqual(f.hits, []);
  assert.deepEqual(f.typed, []);
});

test('at 1 hitpoint the sting is a blue 0 and the player lives; at 3 it takes 2', (t) => {
  const f = actor(t);
  f.p.setHitpoints(1);
  touch(f);
  tick();
  assert.deepEqual(f.hits, [[0, core.HitMask.BLUE]]);
  assert.deepEqual(f.typed.map(([, text]) => text), ['That was unwise.']);
  f.p.getCombat().getHitQueue().process(Number.MAX_SAFE_INTEGER);
  assert.equal(f.p.getHitpoints(), 1);
  f.hits.length = 0;
  f.p.setHitpoints(3);
  touch(f);
  tick();
  assert.deepEqual(f.hits, [[2, core.HitMask.RED]]);
});
