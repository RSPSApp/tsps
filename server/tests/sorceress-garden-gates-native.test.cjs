// From server/: node --test tests/sorceress-garden-gates-native.test.cjs
// Real queued ClientConnection input, World turns, Player/MovementQueue, map locs and plugins.
// Capture 227/01863 (all four), 227/01843 (summer): busy on the first server response,
// placement + synth71 + busy clear on the next. Outward click is queued between turns.
const assert = require('node:assert/strict');
const { before, after, test, mock } = require('node:test');
const h = require('./quest-capture-harness.cjs');

const ENTRIES = [
  { name: 'winter', id: 12617, from: [2903, 5470, 0], to: [2902, 5470, 0], level: 1 },
  { name: 'spring', id: 12719, from: [2920, 5473, 0], to: [2921, 5473, 0], level: 25 },
  { name: 'autumn', id: 12639, from: [2913, 5463, 0], to: [2913, 5462, 0], level: 45 },
  { name: 'summer', id: 11987, from: [2910, 5480, 0], to: [2910, 5481, 0], level: 65 },
];
before(async () => {
  h.key = 'prince_ali_rescue';
  const worldConfig = require('../dist/game/definition/WorldDefinition');
  const readConfig = worldConfig.readWorldConfig;
  // Keep actual startup/lifecycle hooks, with the unrelated HTTP listener disabled in test config.
  const config = mock.method(worldConfig, 'readWorldConfig', (...args) => {
    const actual = readConfig(...args);
    return { ...actual, plugins: { ...actual.plugins, WorldAdmin: false } };
  });
  try { await h.setup([[2910, 5470]]); } finally { config.mock.restore(); }
});
after(() => h.teardown());

const position = (f) => {
  const at = f.player.getLocation();
  return [at.getX(), at.getY(), at.getZ()];
};
function tick(f) {
  f.tick++;
  h.core.World.process();
}

test('Spring uses current Thieving: 24 is refused and a boost from base24 to25 admits entry', async (t) => {
  const entry = ENTRIES[1];
  const low = actor(t, entry, { level: 24 });
  await open(low, entry);
  tick(low);
  tick(low);
  assert.deepEqual(position(low), entry.from);
  assert.deepEqual(busy(low), []);
  assert.ok(low.messages.some((m) => m.text === 'You need a Thieving level of 25 to enter this garden.'));
  const boosted = actor(t, entry, { base: 24, level: 25 });
  await open(boosted, entry);
  tick(boosted);
  tick(boosted);
  assert.deepEqual(position(boosted), entry.to);
  assert.equal(boosted.player.getArea()?.season?.key, 'spring', 'real seasonal postEnter accepts the boosted level');
});

test('entry has no invented reverse crossing, and a gate on another plane cannot be operated', async (t) => {
  for (const entry of ENTRIES) {
    const reverse = actor(t, entry, { at: entry.to });
    await open(reverse, entry);
    for (let i = 0; i < 4; i++) tick(reverse);
    assert.deepEqual(position(reverse), entry.to, `${entry.name}: no maze-to-gate teleport`);
    assert.deepEqual(reverse.placements, []);
    assert.deepEqual(busy(reverse), []);
  }
  const entry = ENTRIES[0];
  const upstairs = actor(t, entry, { at: [2903, 5470, 1] });
  await open(upstairs, entry);
  for (let i = 0; i < 3; i++) tick(upstairs);
  assert.deepEqual(position(upstairs), [2903, 5470, 1]);
  assert.deepEqual(upstairs.placements, []);
});

test('real approach routing reaches the gate tile before starting entry', async (t) => {
  const entry = ENTRIES[0];
  const f = actor(t, entry, { at: [2904, 5470, 0] });
  const sent = await open(f, entry);
  tick(f);
  assert.deepEqual(position(f), entry.from);
  assert.deepEqual(busy(f), [], 'ordinary wall operation follows the arrival turn');
  tick(f);
  assert.deepEqual(busy(f), [[sent + 2, 1]]);
  tick(f);
  assert.deepEqual(position(f), entry.to);
  assert.deepEqual(f.placements, [[sent + 3, entry.to]]);
});

test('duplicate native Open and movement queued during entry do not overlap it; ordinary walking works after landing', async (t) => {
  const entry = ENTRIES[3];
  const f = actor(t, entry);
  await open(f, entry);
  await open(f, entry);
  tick(f);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
  await f.connection.dispatch([{ type: 'move', worldX: 2911, worldY: 5480, modifierFlags: 0, run: false }]);
  tick(f);
  assert.deepEqual(position(f), entry.to, 'pending placement rejects the move arriving with completion');
  assert.equal(f.placements.length, 1);
  assert.deepEqual(busy(f).map(([, value]) => value), [1, 0]);
  await f.connection.dispatch([{ type: 'move', worldX: 2910, worldY: 5482, modifierFlags: 0, run: false }]);
  tick(f);
  assert.deepEqual(position(f), [2910, 5482, 0]);
  assert.equal(f.player.getArea()?.season?.key, 'summer', 'next ordinary step enters the existing summer Area');
});

test('Player-key task cancellation unlocks without crossing and a later native Open still works', async (t) => {
  const entry = ENTRIES[0];
  const f = actor(t, entry);
  await open(f, entry);
  tick(f);
  h.core.TaskManager.cancelTasks(f.player);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  tick(f);
  assert.deepEqual(position(f), entry.from);
  assert.deepEqual(f.placements, []);
  await open(f, entry);
  tick(f);
  tick(f);
  assert.deepEqual(position(f), entry.to);
  assert.deepEqual(busy(f).map(([, value]) => value), [1, 0, 1, 0]);
});

test('pending logout safely clears the gate before later turns can move the player', async (t) => {
  const entry = ENTRIES[0];
  const f = actor(t, entry);
  await open(f, entry);
  tick(f);
  // World removal uses Player.onLogout; bot-skip-persistence prevents this unit test writing a save.
  f.player.onLogout();
  // Existing Quests logout hooks cancel Player-key tasks before Agility.completeNow runs.
  // No capture establishes a different mid-entry logout outcome; preserve safe cancellation.
  assert.deepEqual(position(f), entry.from);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.getAttribute('agility.obstacle'), null);
  assert.equal(h.core.TaskManager.hasActiveTask(f.player), false);
  assert.equal(busy(f)[0][1], 1);
  assert.ok(busy(f).length >= 2);
  assert.ok(busy(f).slice(1).every(([, value]) => value === 0), 'later logout hooks may repeat the clear, never relock');
  tick(f);
  assert.deepEqual(position(f), entry.from);
  assert.deepEqual(f.placements, []);
});
function actor(t, entry, { at = entry.from, level = entry.level, base = level } = {}) {
  const f = h.actor(t, { at, done: [], stage: 0 });
  f.player.getSession().setTurnPacketProcessor(() => f.connection.processTurnPackets());
  f.player.getSkillManager().setMaxLevels(h.core.Skill.THIEVING, base);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.THIEVING, level, false);
  f.scenery = [];
  f.placements = [];
  const sender = f.player.getPacketSender();
  for (const method of ['sendObject', 'sendObjectRemoval']) {
    const send = sender[method].bind(sender);
    sender[method] = (object, ...rest) => {
      if (ENTRIES.some((gate) => gate.id === object.getId())) f.scenery.push([f.tick, method, object.getId()]);
      return send(object, ...rest);
    };
  }
  const move = f.player.moveTo.bind(f.player);
  f.player.moveTo = (location) => {
    f.placements.push([f.tick, [location.getX(), location.getY(), location.getZ()]]);
    return move(location);
  };
  tick(f); // Settle login/scene state before measuring the outbound click.
  f.calls.length = f.messages.length = f.scenery.length = f.placements.length = 0;
  return f;
}
async function open(f, entry) {
  const sent = f.tick;
  await f.connection.dispatch([{ type: 'object_option', id: entry.id, x: entry.from[0], y: entry.from[1], clickType: 1 }]);
  return sent;
}
const busy = (f) => f.calls.filter((c) => c.name === 'sendVarbit' && c.args[0] === 12393).map((c) => [c.tick, c.args[1]]);

for (const entry of ENTRIES) {
  test(`${entry.name}: native Open places across the real gate with captured busy/sound and unchanged scenery`, async (t) => {
    const f = actor(t, entry);
    const object = h.core.MapObjects.getPrivateArea(f.player, entry.id, new h.core.Location(...entry.from));
    assert.ok(object, 'real cache map gate exists');
    assert.equal(object.getDefinition().getInteractions()[0], 'Open');
    const sent = await open(f, entry);
    assert.deepEqual(position(f), entry.from, 'outward packet is queued, not synchronous gameplay');
    tick(f);
    assert.deepEqual(position(f), entry.from, 'first response holds position');
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
    assert.deepEqual(busy(f), [[sent + 1, 1]]);
    tick(f);
    assert.deepEqual(position(f), entry.to);
    assert.deepEqual(f.placements, [[sent + 2, entry.to]], 'instant placement, not a forced walk');
    assert.deepEqual(busy(f), [[sent + 1, 1], [sent + 2, 0]]);
    assert.deepEqual(f.calls.filter((c) => c.name === 'sendSoundEffect' && c.args[0] === 71).map((c) => [c.tick, c.args.slice(0, 3)]),
      [[sent + 2, [71, 1, 0]]]);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    assert.deepEqual(f.scenery, [], 'gate is neither hidden nor replaced');
    assert.equal(f.messages.some((m) => m.text === 'You open the gate.'), false);
    assert.equal(h.core.MapObjects.getPrivateArea(f.player, entry.id, new h.core.Location(...entry.from)), object);
  });
}
