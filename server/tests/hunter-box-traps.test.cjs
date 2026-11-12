// Run after yarn build: node --test tests/hunter-box-traps.test.cjs
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
const Runtime = require('../plugins/skills/hunter/Runtime.Hunter');
let core, index = 9100, areaSounds = [], nearbyNpcs = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  H.data = require('../plugins/skills/hunter/Data.Hunter').build(core);
  H.api = { emitCustomEvent() {} };
  // Isolate placement physics and the world's NPC/sound fan-out; actor, inventory, timers and trap logic are real.
  H.core = { ...core,
    MapObjects: { getType: () => null }, RegionManager: { blocked: () => false },
    ObjectManager: { register() {}, deregister() {} },
    ItemOnGroundManager: { registerLocation(_player, item, location) {
      return { getItem: () => item, getLocation: () => location, isPendingRemoval: () => false };
    }, deregister() {} },
    Sounds: { playAreaSound: options => areaSounds.push(options) },
    World: { ...core.World, getRemovedObjects: () => [], getNearbyNpcsForUpdate: () => nearbyNpcs,
      getNearbyPlayersForUpdate: () => [] },
  };
});
afterEach(() => { H.traps.clear(); H.actions.clear(); H.players.clear(); H.reserved.clear(); H.hidden.clear(); areaSounds = []; nearbyNpcs = []; });

function actor(t, level = 99) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('boxtrap' + p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(3200, 3200, 0)); p.needsPlacement = false;
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, level).setMaxLevel(core.Skill.HUNTER, level);
  p.setAttribute('quest.eagles_peak.stage', 8);
  const messages = [], spam = [], sounds = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendMessage', text => { messages.push(text); return sender; });
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { (type === core.ChatType.SPAM ? spam : messages).push(text); return sender; });
  t.mock.method(sender, 'sendSound', id => { sounds.push(id); return sender; });
  t.mock.method(p.getMovementQueue(), 'canWalk', () => false);
  return { p, messages, spam, sounds };
}

function tick() { H.tick++; C.processActions(); }

/** Lays a trap from the inventory where the player stands, then steps off it; returns the trap and the tick it stood. */
function layTrap(p, kind, item) {
  p.getInventory().adds(item, 1);
  Traps.lay(p, kind, p.getLocation());
  for (let i = 0; i < 4 && ![...H.traps].some(trap => trap.player === p); i++) tick();
  const trap = [...H.traps].find(entry => entry.player === p);
  assert.ok(trap, `${kind} trap stands`);
  p.setLocation(trap.location.clone().add(0, -1));
  return trap;
}

function prey(npcId, at) {
  return { getId: () => npcId, getLocation: () => at, getPrivateArea: () => null, isRegistered: () => true, isVisible: () => true,
    getHitpoints: () => 10, isDyingFunction: () => false, getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
    getMovementQueue: () => ({ reset() {} }) };
}

test('an idle box trap looks for prey every 3 ticks; bird snares keep 5', t => {
  const { p } = actor(t);
  const box = layTrap(p, 'box', core.ItemIdentifiers.BOX_TRAP);
  assert.equal(box.next - H.tick, 3, 'first look 3 ticks after the box stands');
  H.tick = box.next;
  Traps.process();
  assert.equal(box.next - H.tick, 3);
  const { p: other } = actor(t);
  other.setLocation(new core.Location(3210, 3200, 0));
  const bird = layTrap(other, 'bird', core.ItemIdentifiers.BIRD_SNARE);
  assert.equal(bird.next - H.tick, 5);
});

test('a box trap lures prey within 2 tiles (a 5x5 square), not 3', t => {
  const { p } = actor(t);
  const box = layTrap(p, 'box', core.ItemIdentifiers.BOX_TRAP);
  t.mock.method(core.PathFinder, 'calculateWalkRoute', () => {});
  const at = box.location;
  nearbyNpcs = [prey(core.NpcIdentifiers.FERRET, at.clone().add(3, 0))];
  H.tick = box.next; Traps.process();
  assert.equal(box.state, 'idle', '3 tiles away is out of range');
  nearbyNpcs = [prey(core.NpcIdentifiers.FERRET, at.clone().add(2, -2))];
  H.tick = box.next; Traps.process();
  assert.equal(box.state, 'luring', 'a 5x5 corner is in range');
});

function catchIn(trap) {
  const creature = H.data.creatures.find(c => c.npc === core.NpcIdentifiers.FERRET);
  Traps.setState(trap, 'caught', creature);
  return trap.objects.at(-1);
}

test('checking a caught box trap plays the dismantle sound as an area sound at the trap', t => {
  const { p, sounds, spam } = actor(t);
  const box = layTrap(p, 'box', core.ItemIdentifiers.BOX_TRAP);
  const object = catchIn(box);
  areaSounds = [];
  assert.equal(Traps.check({ player: p, object }), true);
  tick(); tick();
  assert.deepEqual(spam.slice(-2), ['You dismantle the trap.', "You've caught a ferret."]);
  assert.equal(sounds.includes(2632), false, 'no private dismantle sound');
  const sound = areaSounds.find(entry => entry.soundId === 2632);
  assert.ok(sound, 'area sound 2632');
  assert.deepEqual([sound.x, sound.y, sound.level, sound.radius], [box.location.getX(), box.location.getY(), 0, 5]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.HUNTER) > 0, true);
});

test('a caught ferret gives 115 Hunter xp', () => {
  assert.equal(H.data.creatures.find(c => c.npc === core.NpcIdentifiers.FERRET).xp, 115);
});

test('dismantling an empty box trap keeps the private dismantle sound', t => {
  const { p, sounds } = actor(t);
  const box = layTrap(p, 'box', core.ItemIdentifiers.BOX_TRAP);
  areaSounds = [];
  Traps.dismantle({ player: p, object: box.objects.at(-1) });
  tick(); tick();
  assert.ok(sounds.includes(2632));
  assert.equal(areaSounds.some(entry => entry.soundId === 2632), false);
});

test('Reset of a caught box trap lays it again 3 ticks after the dismantle, and the box stands 3 ticks later', t => {
  const { p, spam } = actor(t);
  const box = layTrap(p, 'box', core.ItemIdentifiers.BOX_TRAP);
  p.setLocation(box.location.clone());
  const object = catchIn(box);
  spam.length = 0;
  Traps.reset({ player: p, object });
  const timeline = [];
  for (let i = 1; i <= 10; i++) {
    tick();
    const lines = spam.splice(0);
    const stood = [...H.traps].some(trap => trap.player === p && trap !== box && trap.state === 'idle');
    timeline.push([i, lines.join('|'), stood]);
    if (stood) break;
  }
  const at = text => timeline.find(([, lines]) => lines.includes(text))?.[0];
  const dismantled = at('You dismantle the trap.'), laid = at('You begin setting up the trap.');
  assert.equal(laid - dismantled, 3);
  assert.equal(timeline.find(([, , stood]) => stood)[0] - laid, 3);
});

test('a box trap from the inventory still stands 2 ticks after the set-up line', t => {
  const { p, spam } = actor(t);
  p.getInventory().adds(core.ItemIdentifiers.BOX_TRAP, 1);
  Traps.lay(p, 'box', p.getLocation());
  assert.equal(spam.at(-1), 'You begin setting up the trap.');
  tick();
  assert.equal(H.traps.size, 0);
  tick();
  assert.equal(H.traps.size, 1);
});

test('releasing a caught creature names it in a spam line', t => {
  const I = core.ItemIdentifiers;
  for (const [item, line] of [
    [I.FERRET, 'You release the ferret and it runs away.'],
    [I.SWAMP_LIZARD, 'You release the lizard and it darts away.'],
    [I.ORANGE_SALAMANDER, 'You release the salamander and it darts away.'],
    [I.IMMATURE_TECU_SALAMANDER, 'You release the salamander and it darts away.'],
  ]) {
    const { p, spam, messages } = actor(t);
    p.getInventory().adds(item, 1);
    assert.equal(Runtime.release({ player: p, itemId: item }), true);
    assert.equal(p.getInventory().getAmount(item), 0);
    assert.deepEqual(spam, [line]);
    assert.deepEqual(messages, []);
  }
  const { p } = actor(t);
  assert.equal(Runtime.release({ player: p, itemId: I.BOX_TRAP }), false);
});
