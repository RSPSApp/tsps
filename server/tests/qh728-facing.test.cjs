// Run after `yarn build`: node --test tests/qh728-facing.test.cjs
// Stable Mobile facing: a compass direction that survives resetUpdating(), unlike the
// per-tick walkingDirection/runningDirection used for the update packet.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});

const { Player } = require('../dist/game/entity/impl/player/Player');
const { Location } = require('../dist/game/model/Location');
const { Direction } = require('../dist/game/model/Direction');
const { Flag } = require('../dist/game/model/Flag');
const { RegionManager } = require('../dist/game/collision/RegionManager');

function makePlayer(x = 3204, y = 3204) {
  const player = new Player(null, new Location(x, y, 0));
  // Keep the movement dispatch free of client packets; this test owns no session.
  player.isPlayerBot = () => true;
  return player;
}

test('explicit facing updates the stable compass direction and survives reset ticks', () => {
  const player = makePlayer();
  assert.equal(player.getFacingDirection(), Direction.NONE, 'no spawn direction is established');

  player.setDirection(Direction.NORTH);
  assert.equal(player.getFacingDirection(), Direction.NORTH);

  player.resetUpdating();
  assert.equal(player.getWalkingDirection(), Direction.NONE);
  assert.equal(player.getRunningDirection(), Direction.NONE);
  assert.equal(player.getFacingDirection(), Direction.NORTH, 'idle reset keeps the known facing');

  player.setPositionToFace(null);
  assert.equal(player.getFacingDirection(), Direction.NORTH, 'clearing the target does not erase orientation');

  player.setPositionToFace(player.getLocation());
  assert.equal(player.getFacingDirection(), Direction.NORTH, 'facing your own tile does not erase orientation');

  player.forcePositionToFace(new Location(3200, 3207, 0));
  assert.equal(player.getFacingDirection(), Direction.NORTH_WEST);

  player.setPositionToFaceCoordinates(3210, 3204, 0);
  assert.equal(player.getFacingDirection(), Direction.EAST);
});

test('an active interaction target overrides movement and follows the target', () => {
  const actor = makePlayer();
  const target = makePlayer(3204, 3206);

  actor.setMobileInteraction(target);
  assert.equal(actor.getUpdateFlag().flagged(Flag.ENTITY_INTERACTION), true);
  assert.equal(actor.getFacingDirection(), Direction.NORTH);

  actor.setWalkingDirection(Direction.WEST);
  actor.resetUpdating();
  assert.equal(actor.getWalkingDirection(), Direction.NONE);
  assert.equal(actor.getFacingDirection(), Direction.NORTH, 'interaction wins over the movement heading');

  target.setLocation(new Location(3206, 3204, 0));
  assert.equal(actor.getFacingDirection(), Direction.EAST, 'getter follows a moved target');

  actor.setMobileInteraction(null);
  assert.equal(actor.getFacingDirection(), Direction.EAST, 'clearing retains the last target direction');

  actor.setMobileInteraction(target);
  assert.equal(actor.getFacingDirection(), Direction.EAST, 'replacing with the same target keeps its direction');

  const northTarget = makePlayer(3204, 3206);
  actor.setMobileInteraction(northTarget);
  assert.equal(actor.getFacingDirection(), Direction.NORTH, 'replacement caches the new target direction');

  actor.setMobileInteraction(null);
  assert.equal(actor.getFacingDirection(), Direction.NORTH, 'clearing the replacement retains north');
});

test('an unchanged ordinary face target is a no-op; force re-applies that same point', () => {
  const player = makePlayer();
  const point = new Location(3204, 3205, 0);

  player.setPositionToFace(point);
  player.resetUpdating();
  assert.equal(player.getFacingDirection(), Direction.NORTH);

  player.setWalkingDirection(Direction.EAST);
  player.resetUpdating();
  assert.equal(player.getFacingDirection(), Direction.EAST, 'later movement is the known facing');

  player.setPositionToFace(new Location(3204, 3205, 0));
  assert.equal(player.getUpdateFlag().flagged(Flag.FACE_POSITION), false, 'unchanged point emits no face update');
  assert.equal(player.getFacingDirection(), Direction.EAST, 'no-op setter must not resurrect the old point direction');

  player.setPositionToFaceCoordinates(3204, 3205, 0);
  assert.equal(player.getUpdateFlag().flagged(Flag.FACE_POSITION), false, 'unchanged coordinates emit no face update');
  assert.equal(player.getFacingDirection(), Direction.EAST, 'no-op coordinate setter keeps the known facing');

  player.forcePositionToFace(new Location(3204, 3205, 0));
  assert.equal(player.getUpdateFlag().flagged(Flag.FACE_POSITION), true, 'force always flags the face update');
  assert.equal(player.getFacingDirection(), Direction.NORTH, 'force re-applies the same point direction');
});

test('real movement dispatch sets walk and run facing, which outlives the per-tick reset', () => {
  const originalCanMovestart = RegionManager.canMovestart;
  RegionManager.canMovestart = () => true;
  try {
    const player = makePlayer();
    const movement = player.getMovementQueue();

    movement.walkStep(0, 1);
    movement.process();
    assert.equal(player.getWalkingDirection(), Direction.NORTH);
    player.resetUpdating();
    assert.equal(player.getWalkingDirection(), Direction.NONE, 'per-tick walk direction still resets');
    assert.equal(player.getFacingDirection(), Direction.NORTH, 'stable facing kept the walk direction');

    player.setRunning(true);
    movement.walkStep(1, 1);
    movement.walkStep(1, 2);
    movement.process();
    assert.equal(player.getWalkingDirection(), Direction.NORTH_EAST);
    assert.equal(player.getRunningDirection(), Direction.NORTH);
    player.resetUpdating();
    assert.equal(player.getWalkingDirection(), Direction.NONE);
    assert.equal(player.getRunningDirection(), Direction.NONE);
    assert.equal(player.getFacingDirection(), Direction.NORTH, 'stable facing follows the run step');
  } finally {
    RegionManager.canMovestart = originalCanMovestart;
  }
});
