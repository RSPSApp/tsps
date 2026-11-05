// Run after `yarn build`: node --test tests/movement-stopping.test.cjs
// Digging is a partial animation stall: it plays while the true tile keeps walking, and the
// walk queue is never cleared (Wiki: Animation stall; rsprox captures 1858, 3275, 1098).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Location } = require('../dist/game/model/Location');
const Spade = require('../plugins/items/Spade.plugin');

const SPADE = 952;
const actions = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Spade.register({
    core: PluginManager.getCoreApi(),
    onItemAction: (name, named) => actions.set(name, named),
  });
});

function digPlayer() {
  const movement = { resets: 0 };
  const animations = [];
  const sounds = [];
  const player = {
    isPlayer: () => true,
    isPlayerBot: () => false,
    getAsPlayer() { return this; },
    getMovementQueue: () => ({ reset: () => { movement.resets++; } }),
    performAnimation: (animation) => animations.push(animation.getId()),
    getPacketSender: () => ({
      sendSoundEffect: (id, loops, delay, volume) => sounds.push({ id, loops, delay, volume }),
    }),
  };
  return { player, movement, animations, sounds };
}

test('every spade registers the shared Dig handler', () => {
  assert.deepEqual([...actions.keys()], ['Spade', 'Large spade', 'Eastfloor spade']);
});

test('a Dig plays human_dig and its synth without clearing the walk', () => {
  const { player, movement, animations, sounds } = digPlayer();
  const event = { player, itemId: SPADE, slot: 0, clickType: 1, option: 'Dig', handled: false };
  assert.equal(actions.get('Spade').Dig(event), false, 'the event stays open for content dig handlers');
  assert.deepEqual(animations, [CacheDefinitions.getSeqId('human_dig') ?? 830]);
  assert.deepEqual(sounds, [{ id: 1470, loops: 0, delay: 0, volume: 1 }]);
  assert.equal(movement.resets, 0, 'a partial stall leaves the true tile walking');
  assert.equal(event.handled, false);
});

test('a real player keeps its queued route through a Dig and shows the sequence', () => {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => {} });
  player.setLocation(new Location(3200, 3200, 0));
  player.getMovementQueue().requestWalk(new Location(3205, 3200, 0));
  const queued = player.getMovementQueue().size();
  assert.ok(queued > 0);
  actions.get('Spade').Dig({ player, itemId: SPADE, slot: 0, clickType: 1, option: 'Dig', handled: false });
  assert.equal(player.getAnimation().getId(), CacheDefinitions.getSeqId('human_dig') ?? 830);
  assert.equal(player.getMovementQueue().size(), queued, 'the walk is not cleared by the dig');
});
