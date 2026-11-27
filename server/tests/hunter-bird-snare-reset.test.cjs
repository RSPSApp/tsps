// Run after yarn build: node --test tests/hunter-bird-snare-reset.test.cjs
// Issue 6832: bird snares stack (cache), so a snare laid onto a tile that already holds the player's snare
// joins that stack. The trap must use up one snare from the stack the floor really holds.
const assert = require('node:assert/strict');
const { before, afterEach, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { World } = require('../dist/game/World');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const C = require('../plugins/skills/hunter/Context.Hunter');
const { H } = C;
const Traps = require('../plugins/skills/hunter/Traps.Hunter');
let core, index = 9400, saved = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  H.data = require('../plugins/skills/hunter/Data.Hunter').build(core);
  H.api = { emitCustomEvent() {} };
  // Placement physics and the world's NPC fan-out are isolated; ground items, inventory and trap logic are real.
  H.core = { ...core,
    MapObjects: { getType: () => null }, RegionManager: { blocked: () => false },
    ObjectManager: { register() {}, deregister() {}, objectsAt: () => [] },
    World: { ...core.World, getRemovedObjects: () => [], getNearbyNpcsForUpdate: () => [], getNearbyPlayersForUpdate: () => [] },
  };
  saved = World.getItems().splice(0);
});
afterEach(() => {
  H.traps.clear(); H.actions.clear(); H.players.clear(); H.reserved.clear();
  World.getItems().splice(0);
});

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('snaredupe' + p.getIndex()); p.setRegistered(true);
  p.setLocation(new core.Location(2540, 2890, 0)); p.needsPlacement = false;
  p.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 99).setMaxLevel(core.Skill.HUNTER, 99);
  t.mock.method(p.getMovementQueue(), 'canWalk', () => false);
  return p;
}

const tick = () => { H.tick++; C.processActions(); Traps.process(); };
const SNARE = () => core.ItemIdentifiers.BIRD_SNARE;
const held = p => p.getInventory().getAmount(SNARE());
const floor = at => World.getItems().filter(item => !item.isPendingRemoval() && item.getItem().getId() === SNARE()
  && item.getPosition().equals(at)).reduce((sum, item) => sum + item.getItem().getAmount(), 0);
const standing = p => [...H.traps].filter(trap => trap.player === p && trap.state !== 'laying').length;
const total = (p, at) => held(p) + floor(at) + standing(p);

function layHere(p) {
  Traps.activate({ player: p, itemId: SNARE() });
  for (let i = 0; i < 5 && !standing(p); i++) tick();
  return [...H.traps].find(trap => trap.player === p);
}

test('bird snares stack in the cache', () => {
  assert.equal(core.ItemDefinition.forId(SNARE()).isStackable(), true);
});

test('a snare laid onto its own snare stack returns that stack', t => {
  const p = actor(t);
  const at = p.getLocation().clone();
  const first = ItemOnGroundManager.registerLocation(p, new core.Item(SNARE(), 1), at.clone());
  const second = ItemOnGroundManager.registerLocation(p, new core.Item(SNARE(), 1), at.clone());
  assert.equal(second, first, 'the merged stack, not the discarded copy');
  assert.equal(first.getItem().getAmount(), 2);
  assert.equal(floor(at), 2);
});

test('walking onto the tile while Reset lays the snare, then laying from the inventory, makes no snare', t => {
  const p = actor(t);
  p.getInventory().adds(SNARE(), 5);
  const trap = layHere(p);
  assert.ok(trap, 'snare stands');
  const at = trap.location.clone();
  p.setLocation(at.clone().add(1, 0));
  Traps.setState(trap, 'failed');
  assert.equal(total(p, at), 5);

  Traps.reset({ player: p, object: trap.objects.at(-1) });
  for (let i = 0; i < 8 && floor(at) === 0; i++) tick();
  assert.equal(floor(at), 1, 'Reset put the snare down on the trap tile');
  assert.equal(held(p), 4);
  // The player clicks the tile: the walk interrupts the set-up and the snare stays on the floor.
  p.setLocation(at.clone());
  tick();
  assert.equal(H.actions.has(p), false, 'set-up interrupted');
  assert.equal(standing(p), 0);
  assert.equal(total(p, at), 5);

  const relaid = layHere(p);
  assert.ok(relaid, 'the inventory snare stands');
  assert.equal(held(p), 3);
  assert.equal(floor(at), 1, 'one snare left on the floor');
  assert.equal(total(p, at), 5, 'no snare made or lost');
});

test('laying the floor stack by its Lay option takes one snare and leaves the rest', t => {
  const p = actor(t);
  const at = p.getLocation().clone();
  ItemOnGroundManager.registerLocation(p, new core.Item(SNARE(), 1), at.clone());
  ItemOnGroundManager.registerLocation(p, new core.Item(SNARE(), 1), at.clone());
  const stack = World.getItems().find(item => item.getItem().getId() === SNARE() && !item.isPendingRemoval());
  assert.equal(stack.getItem().getAmount(), 2);
  Traps.groundActivate({ player: p, groundItem: stack, groundItemId: SNARE() });
  for (let i = 0; i < 5 && !standing(p); i++) tick();
  assert.equal(standing(p), 1);
  assert.equal(floor(at), 1);
});
