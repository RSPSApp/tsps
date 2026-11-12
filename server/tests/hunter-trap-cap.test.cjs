// Run after yarn build: node --test tests/hunter-trap-cap.test.cjs
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
let core, index = 8900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  H.data = require('../plugins/skills/hunter/Data.Hunter').build(core);
  H.api = { emitCustomEvent() {} };
  // Isolate placement physics; actor, skills, inventory, shared count and timed lay are real.
  H.core = { ...core,
    MapObjects: { getType: () => null }, RegionManager: { blocked: () => false },
    ObjectManager: { register() {}, deregister() {} },
    ItemOnGroundManager: { registerLocation(_player, item, location) {
      return { getItem: () => item, getLocation: () => location, isPendingRemoval: () => false };
    }, deregister() {} },
  };
});
afterEach(() => { H.traps.clear(); H.actions.clear(); H.players.clear(); });
function actor(t, level = 1) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('trapcap' + p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(3200, 3200, 0)); p.needsPlacement = false;
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, level).setMaxLevel(core.Skill.HUNTER, level);
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', text => { messages.push(text); return p.getPacketSender(); });
  t.mock.method(p.getMovementQueue(), 'canWalk', () => false);
  return { p, messages };
}
function lay(p, kind, x) {
  p.setLocation(new core.Location(x, 3200, 0));
  Traps.lay(p, kind, p.getLocation());
  for (let i = 0; i < 3; i++) { H.tick++; C.processActions(); }
}

test('current Hunter table applies to every shared multi-trap kind at each boundary', t => {
  const { p } = actor(t);
  for (const [level, expected] of [[1,2],[19,2],[20,2],[39,2],[40,3],[59,3],[60,4],[79,4],[80,5],[99,5]]) {
    p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, level);
    for (const kind of ['bird','box','swamp','orange','red','black','tecu','rabbit']) {
      assert.equal(Traps.limit(p, kind), expected, `${kind} at ${level}`);
    }
  }
});

test('current boosted level, Wilderness extra and fixed-method exceptions survive', t => {
  const { p } = actor(t, 39);
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 40);
  assert.equal(Traps.limit(p, 'bird'), 3, 'boost crosses the 40 threshold');
  p.getSkillManager().setMaxLevel(core.Skill.HUNTER, 99).setCurrentLevels(core.Skill.HUNTER, 19);
  assert.equal(Traps.limit(p, 'bird'), 2, 'drained current level controls capacity');
  p.setWildernessLevel(1);
  assert.equal(Traps.limit(p, 'black'), 3);
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 80);
  assert.equal(Traps.limit(p, 'box'), 6);
  assert.equal(Traps.limit(p, 'rabbit'), 5, 'existing rabbit exception has no Wilderness extra');
  assert.equal(Traps.limit(p, 'deadfall'), 2);
  assert.equal(Traps.limit(p, 'monkey'), 1);
});

test('a level1 real inventory can lay two bird snares; third refusal consumes nothing', t => {
  const { p, messages } = actor(t);
  p.getInventory().adds(core.ItemIdentifiers.BIRD_SNARE, 3);
  lay(p, 'bird', 3200); lay(p, 'bird', 3201);
  assert.equal([...H.traps].filter(trap => trap.player === p).length, 2);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BIRD_SNARE), 1);
  lay(p, 'bird', 3202);
  assert.equal(H.traps.size, 2);
  assert.equal(H.actions.size, 0);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BIRD_SNARE), 1);
  assert.equal(messages.at(-1), 'You may set up only 2 traps at a time at your Hunter level.');
});

test('mixed shared kinds count together, fixed kinds and other owners do not', t => {
  const { p, messages } = actor(t, 40), { p: other } = actor(t, 40);
  for (const kind of ['box','rabbit','deadfall','monkey']) H.traps.add({ player: p, kind });
  H.traps.add({ player: other, kind: 'bird' });
  p.getInventory().adds(core.ItemIdentifiers.BIRD_SNARE, 2);
  lay(p, 'bird', 3200);
  assert.equal([...H.traps].filter(trap => trap.player === p && !H.data.traps[trap.kind].max).length, 3);
  lay(p, 'bird', 3201);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BIRD_SNARE), 1);
  assert.equal(messages.at(-1), 'You may set up only 3 traps at a time at your Hunter level.');
});

test('the new cap does not bypass box, net or rabbit skill requirements', t => {
  const { p, messages } = actor(t);
  for (const [kind, level] of [['box',27],['swamp',29],['rabbit',27]]) {
    lay(p, kind, 3200);
    assert.equal(H.traps.size, 0);
    assert.equal(H.actions.size, 0);
    assert.equal(messages.at(-1), `You need level ${level} Hunter to do this.`);
  }
});

// rsprox captures (pyre-fur-and-smallpouch-1, rev 242; rsprox.net 1105, 1108, 1757): live leaves 5212 to
// play out after setting up a deadfall (no reset), and baiting says "You lay the jerboa tail beneath the
// deadfall as bait.".
test('a deadfall set up and baited keeps its animation running and lays the bait with the captured line', t => {
  const { p, messages } = actor(t, 99);
  const I = core.ItemIdentifiers;
  const maps = H.core.MapObjects;
  H.core.MapObjects = { ...maps, exists: () => true };
  t.after(() => { H.core.MapObjects = maps; });
  p.getInventory().adds(I.KNIFE, 1); p.getInventory().adds(I.LOGS, 1); p.getInventory().adds(I.JERBOA_TAIL, 1);
  const animations = [];
  t.mock.method(p, 'performAnimation', animation => { animations.push(animation.getId()); });
  const base = new core.GameObject(core.CacheDefinitions.getLocId('hunting_deadfall_boulder'), new core.Location(1613, 3002, 0), 10, 1, p.getPrivateArea());
  p.setLocation(new core.Location(1613, 3001, 0));
  Traps.lay(p, 'deadfall', base.getLocation(), base);
  for (let i = 0; i < 3; i++) { H.tick++; C.processActions(); }
  const trap = [...H.traps].find(entry => entry.player === p);
  assert.ok(trap, 'the deadfall stands');
  assert.deepEqual(animations, [5212], 'no reset after the setting-up animation');
  Traps.bait({ player: p, object: trap.objects.at(-1), itemId: I.JERBOA_TAIL, handled: false });
  assert.equal(messages.at(-1), 'You lay the jerboa tail beneath the deadfall as bait.');
  assert.deepEqual(animations, [5212, 5212]);
});

test('a bird snare still resets its animation when laid', t => {
  const { p } = actor(t);
  p.getInventory().adds(core.ItemIdentifiers.BIRD_SNARE, 1);
  const animations = [];
  t.mock.method(p, 'performAnimation', animation => { animations.push(animation.getId()); });
  lay(p, 'bird', 3200);
  assert.ok(animations.includes(core.Animation.DEFAULT_RESET_ANIMATION.getId()));
});
