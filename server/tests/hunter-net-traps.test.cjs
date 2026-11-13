// Run after yarn build: node --test tests/hunter-net-traps.test.cjs
// Net traps on young trees: the closing, caught and failed loc covers both tiles from the south-west one, a catch
// plays 739 with the trapping sound at the net, Reset's timing, the dismantle sound's delay, no animation reset,
// and a collapsed trap's rope and net on the net tile.
const assert = require('node:assert/strict');
const { before, afterEach, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const C = require('../plugins/skills/hunter/Context.Hunter');
const { H } = C;
const Traps = require('../plugins/skills/hunter/Traps.Hunter');
let core, index = 9300, areaSounds = [], objects = [], drops = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  H.data = require('../plugins/skills/hunter/Data.Hunter').build(core);
  H.api = { emitCustomEvent() {} };
  // Isolate the map and the world's fan-out; the actor, inventory, locs, timers and trap logic are real.
  H.core = { ...core,
    MapObjects: { exists: object => objects.includes(object), getType: () => null }, RegionManager: { blocked: () => false },
    ObjectManager: { register(object) { objects.push(object); }, deregister(object) { objects = objects.filter(o => o !== object); } },
    ItemOnGroundManager: { registerLocation(_player, item, location) { drops.push([item.getId(), location]); }, deregister() {} },
    Sounds: { playAreaSound: options => areaSounds.push(options) },
    World: { ...core.World, getRemovedObjects: () => [], getNearbyNpcsForUpdate: () => [], getNearbyPlayersForUpdate: () => [] },
  };
});
afterEach(() => { H.traps.clear(); H.actions.clear(); H.players.clear(); H.reserved.clear(); H.hidden.clear();
  areaSounds = []; objects = []; drops = []; });

const loc = name => core.CacheDefinitions.getLocId(name);
const name = object => core.CacheDefinitions.getLocNames().get(object.getId());
const xy = at => [at.getX(), at.getY()];

function actor(t, level = 99) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('nettrap' + p.getIndex()); p.setRegistered(true);
  p.needsPlacement = false;
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, level).setMaxLevel(core.Skill.HUNTER, level);
  const spam = [], sounds = [], animations = [], events = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendMessage', () => sender);
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { if (type === core.ChatType.SPAM) { spam.push(text); events.push([H.tick, text]); } return sender; });
  t.mock.method(sender, 'sendSound', (id, _loops, delay) => { sounds.push([id, delay]); return sender; });
  t.mock.method(sender, 'sendObjectAnimation', () => { events.push([H.tick, 'loc_anim']); return sender; });
  t.mock.method(sender, 'sendClientScript', () => sender);
  t.mock.method(p, 'performAnimation', animation => { animations.push(animation.getId()); events.push([H.tick, `seq ${animation.getId()}`]); });
  return { p, spam, sounds, animations, events };
}

function tick() { H.tick++; C.processActions(); Traps.process(); }

/** A young swamp tree at (x, y) facing `face`, with the player two tiles south; sets the trap and returns it. */
function setTrap(t, face, x = 3548, y = 3437, level = 99) {
  const f = actor(t, level);
  const tree = new core.GameObject(loc('hunting_sapling_up_swamp'), new core.Location(x, y, 0), 10, face, null);
  objects.push(tree);
  f.p.setLocation(new core.Location(x, y - 2, 0));
  f.p.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  f.p.getInventory().adds(core.ItemIdentifiers.SMALL_FISHING_NET, 1);
  assert.equal(Traps.build({ player: f.p, object: tree, objectId: tree.getId() }), true);
  for (let i = 0; i < 3 && !H.traps.size; i++) tick();
  const trap = [...H.traps][0];
  assert.ok(trap, 'net trap stands');
  return { ...f, tree, trap };
}

function lizard(at) {
  return { getId: () => core.NpcIdentifiers.SWAMP_LIZARD, getLocation: () => at, getPrivateArea: () => null, isRegistered: () => true,
    isVisible: () => true, getHitpoints: () => 10, isDyingFunction: () => false, setVisible() {},
    getCombat: () => ({ getTarget: () => null, getAttacker: () => null, reset() {} }),
    getMovementQueue: () => ({ reset() {}, isMovementBlocked: () => false, setBlockMovement() {} }) };
}

/** Puts a swamp lizard on the net and lets the trap try for it; `success` picks the roll. */
function spring(t, trap, success) {
  const roll = t.mock.method(Math, 'random', () => success ? 0 : 0.9999);
  trap.npc = lizard(trap.location); trap.state = 'luring'; trap.luredAt = H.tick;
  H.reserved.set(trap.npc, trap);
  areaSounds = [];
  Traps.process();
  roll.mock.restore();
}

test('a set net trap keeps the set tree on its tile and the net beside it', t => {
  const { trap } = setTrap(t, 1);
  assert.deepEqual(trap.objects.map(o => [name(o), ...xy(o.getLocation())]),
    [['hunting_sapling_set_swamp', 3548, 3437], ['hunting_sapling_net_set_swamp', 3549, 3437]]);
});

test('a catch shows one catching loc on the south-west tile, then the full trap there', t => {
  // Face 1: the net is east of the tree, so the tree's tile is the south-west one.
  const { trap } = setTrap(t, 1);
  spring(t, trap, true);
  assert.deepEqual(trap.objects.map(o => [name(o), ...xy(o.getLocation())]), [['hunting_sapling_catching_green', 3548, 3437]]);
  assert.equal(objects.some(o => name(o) === 'hunting_sapling_set_swamp'), false, 'no set tree beside it');
  tick(); tick();
  assert.equal(trap.state, 'caught');
  assert.deepEqual(trap.objects.map(o => [name(o), ...xy(o.getLocation())]), [['hunting_sapling_full_green', 3548, 3437]]);
});

test('a miss on a west-facing net shows the failing then failed loc on the net tile', t => {
  // Face 3: the net is west of the tree, so the net's tile is the south-west one.
  const { trap } = setTrap(t, 3, 1479, 3099, 29);
  spring(t, trap, false);
  assert.deepEqual(trap.objects.map(o => [name(o), ...xy(o.getLocation())]), [['hunting_sapling_failing_swamp', 1478, 3099]]);
  tick(); tick();
  assert.equal(trap.state, 'failed');
  assert.deepEqual(trap.objects.map(o => [name(o), ...xy(o.getLocation())]), [['hunting_sapling_failed_swamp', 1478, 3099]]);
});

test('a catch plays 739 then 2652 at the net tile; a miss plays 2652 alone', t => {
  const { trap } = setTrap(t, 3, 1479, 3099);
  spring(t, trap, true);
  assert.deepEqual(areaSounds.map(s => [s.soundId, s.x, s.y, s.radius]), [[739, 1478, 3099, 5], [2652, 1478, 3099, 5]]);
  H.traps.clear(); objects = [];
  const other = setTrap(t, 1, 3548, 3437, 29);
  spring(t, other.trap, false);
  assert.deepEqual(areaSounds.map(s => [s.soundId, s.x, s.y]), [[2652, 3549, 3437]]);
});

test('Reset of a full net: setting loc 4 ticks after the dismantle, animation, sound and line a tick later, the trap a tick after', t => {
  const { p, trap, events } = setTrap(t, 1);
  spring(t, trap, true);
  tick(); tick();
  events.length = 0;
  areaSounds = [];
  const start = H.tick;
  assert.equal(Traps.reset({ player: p, object: trap.objects[0] }), true);
  let setting = null, stood = null;
  for (let i = 1; i <= 10 && stood === null; i++) {
    tick();
    if (setting === null && objects.some(o => name(o) === 'hunting_sapling_setting_swamp')) setting = H.tick;
    if ([...H.traps].some(entry => entry !== trap && entry.state === 'idle')) stood = H.tick;
  }
  const at = text => events.find(([, entry]) => entry === text)?.[0];
  const dismantled = at('You dismantle the trap.');
  assert.equal(dismantled - start, 2);
  assert.equal(setting - dismantled, 4, 'setting loc');
  assert.equal(at('You begin setting up a trap.') - dismantled, 5, 'set-up line');
  assert.equal(at('seq 5215') - dismantled, 5, 'set-up animation');
  assert.equal(at('loc_anim') - dismantled, 5, 'setting loc animation');
  assert.equal(areaSounds.find(s => s.soundId === 2644) && true, true, 'set-up sound');
  assert.equal(stood - dismantled, 6, 'set trap');
});

test("the dismantle sound is 25 cycles late only on a full net trap", t => {
  const { p, trap, sounds } = setTrap(t, 1);
  Traps.dismantle({ player: p, object: trap.objects.at(-1) });
  assert.deepEqual(sounds.filter(([id]) => id === 2632), [[2632, 0]]);
  tick(); tick();
  H.traps.clear(); objects = [];
  const other = setTrap(t, 1);
  spring(t, other.trap, true);
  tick(); tick();
  Traps.check({ player: other.p, object: other.trap.objects[0] });
  assert.deepEqual(other.sounds.filter(([id]) => id === 2632), [[2632, 25]]);
});

test('setting up and dismantling a net trap end without an animation reset', t => {
  const { p, trap, animations } = setTrap(t, 1);
  assert.deepEqual(animations, [5215]);
  Traps.dismantle({ player: p, object: trap.objects.at(-1) });
  tick(); tick(); tick();
  assert.equal(H.traps.size, 0);
  assert.deepEqual(animations, [5215, 5207]);
});

test("a collapsed net trap leaves its rope and net on the net tile", t => {
  const { trap, tree } = setTrap(t, 1);
  H.tick = trap.expires;
  Traps.process();
  assert.deepEqual(drops.map(([id, at]) => [id, ...xy(at)]),
    [[core.ItemIdentifiers.ROPE, 3549, 3437], [core.ItemIdentifiers.SMALL_FISHING_NET, 3549, 3437]]);
  assert.deepEqual(objects, [tree], 'the young tree is back');
});
