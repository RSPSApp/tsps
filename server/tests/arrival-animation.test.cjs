// Run after `yarn build`: node --test tests/arrival-animation.test.cjs
// OSRS p_arrivedelay: the client drops a priority-1 seq sent with a step.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { getSequencePriority } = require('../dist/game/cache/NpcAnimationScanner');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Animation } = require('../dist/game/model/Animation');

test('a skilling seq started on a step is held a tick; combat seqs are not', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  assert.equal(getSequencePriority(621), 1, 'net fishing is dropped by movement');
  assert.equal(getSequencePriority(422), -1, 'punch is not');

  const played = [];
  let stepped = true;
  const player = Object.create(Player.prototype);
  Object.assign(player, {
    animation: null,
    getMovementQueue: () => ({ steppedThisWorldCycle: () => stepped }),
    getUpdateFlag: () => ({ flag: () => played.push(player.animation.getId()) }),
  });

  player.performAnimation(new Animation(621));
  assert.deepEqual(played, [], 'held on the arrival step');
  assert.equal(player.arrivalAnimation.getId(), 621);
  player.performAnimation(new Animation(422));
  assert.deepEqual(played, [422], 'combat plays at once');
  assert.equal(player.arrivalAnimation, null, 'a newer animation replaces the held one');

  stepped = false;
  player.performAnimation(new Animation(621));
  assert.deepEqual(played, [422, 621], 'standing still plays at once');
});

test('a sequence priority lookup reads the decoded archive, not a fresh decompress each time', async () => {
  const { preloadSequences } = require('../dist/game/cache/NpcAnimationScanner');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  preloadSequences();
  const start = performance.now();
  for (let id = 8000; id < 8200; id++) getSequencePriority(id);
  // Each fresh decompress took ~100 ms; 200 first-time lookups now take well under one.
  assert.ok(performance.now() - start < 50, `${(performance.now() - start).toFixed(1)} ms for 200 lookups`);
  assert.equal(getSequencePriority(733), 1, 'cooking is still dropped by movement');
});
