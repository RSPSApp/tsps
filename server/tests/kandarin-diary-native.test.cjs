// Run after yarn build. Native farming producers and mapped Church organ operations for #6546.
const assert = require('node:assert/strict');
const { before, after, test, mock } = require('node:test');
const h = require('./quest-capture-harness.cjs');
const Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
const diary = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('kandarin');
const JUTE_TASK = 'plant-some-jute-seeds-in-the-patch-north-of-mcgr';
const ORGAN_TASK = 'play-the-organ-in-seers-church';
let Data, Patches;
before(async () => {
  h.key = 'the_dig_site';
  const world = require('../dist/game/definition/WorldDefinition'), read = world.readWorldConfig;
  const config = mock.method(world, 'readWorldConfig', (...args) => {
    const actual = read(...args);
    return { ...actual, plugins: { ...actual.plugins, WorldAdmin: false } };
  });
  try { await h.setup([[2666, 3525], [2691, 3461], [2813, 3463], [3240, 3208]]); }
  finally { config.mock.restore(); }
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
});
after(() => h.teardown());
const done = (f, task) => Progress.doneTasks(f.player, diary).has(task);
const position = f => { const p = f.player.getLocation(); return [p.getX(), p.getY(), p.getZ()]; };
function actor(t, at) { return h.actor(t, { at, done: [] }); }
function patchActor(t, patch) {
  h.core.RegionManager.loadMapFiles(patch.x, patch.y);
  const f = actor(t, [patch.x - 1, patch.y + 1, patch.z]);
  f.player.getSkillManager().setMaxLevels(h.core.Skill.FARMING, 99, false);
  f.player.getSkillManager().setCurrentLevels(h.core.Skill.FARMING, 99, false);
  Object.assign(Patches.stateFor(f.player, patch), { crop: null, weeds: 0, nextAt: Date.now() + 60000 });
  Patches.syncPatch(f.player, patch);
  return f;
}
async function plant(f, patch, cropKey) {
  const crop = Data.CROPS.get(cropKey), inventory = f.player.getInventory();
  inventory.add(new h.core.Item(Data.itemId('Seed dibber'), 1), false);
  inventory.add(new h.core.Item(crop.seed, crop.seedCount), false);
  const slot = inventory.getSlotForItemId(crop.seed);
  await h.dispatch(f, { type: 'item_on_object', widgetId: 149 << 16, objectId: patch.id,
    itemId: crop.seed, slot, x: patch.x, y: patch.y });
  h.ticks(f, 10);
  assert.equal(Patches.stateFor(f.player, patch).crop, cropKey, 'the actual farming producer planted the crop');
  assert.equal(inventory.getAmount(crop.seed), 0);
}
const jutePatch = () => Data.CACHE.patches.find(p => p.type === 'HOPS' && p.x >= 2664 && p.x <= 2669 && p.y >= 3523 && p.y <= 3528);

test('native jute planting completes Kandarin only after the real planting producer succeeds', async t => {
  const patch = jutePatch(); assert.ok(patch);
  const f = patchActor(t, patch);
  await plant(f, patch, 'JUTE');
  assert.equal(done(f, JUTE_TASK), true);
});

test('a different crop in McGrubor hops and jute in another hops patch do not count', async t => {
  const patch = jutePatch(), f = patchActor(t, patch);
  await plant(f, patch, 'HAMMERSTONE');
  assert.equal(done(f, JUTE_TASK), false);
  const other = Data.CACHE.patches.find(p => p.type === 'HOPS' && p.x > 2800 && p.y < 3400);
  assert.ok(other);
  const elsewhere = patchActor(t, other);
  await plant(elsewhere, other, 'JUTE');
  assert.equal(done(elsewhere, JUTE_TASK), false);
});

function organNear(x, y) {
  for (const objects of h.core.MapObjects.mapObjects.values()) for (const object of objects) {
    const at = object.getLocation();
    if (object.getDefinition().getName() === 'Church organ' && Math.abs(at.getX() - x) < 8 && Math.abs(at.getY() - y) < 8) return object;
  }
  assert.fail(`no mapped Church organ near${x},${y}`);
}
async function play(f, organ) {
  const at = organ.getLocation();
  await h.dispatch(f, { type: 'object_option', id: organ.getId(), x: at.getX(), y: at.getY(), clickType: 1 });
  h.ticks(f, 4);
}

test('mapped Seers organ animates, sends normal organ music, credits diary and permits walking away', async t => {
  const organ = organNear(2691, 3461), at = organ.getLocation();
  const f = actor(t, [at.getX() - 1, at.getY(), at.getZ()]);
  h.ticks(f, 2);
  const packets = [], session = f.player.getSession(), send = session.sendClientPacket.bind(session);
  t.mock.method(session, 'sendClientPacket', frame => { packets.push(frame); return send(frame); });
  await play(f, organ);
  assert.ok(f.animations.some(a => a.id === 3675), 'human_use_chapel_organ');
  assert.ok(packets.some(p => p[0] === 133 && [39, 40].includes(p.readUInt16BE(p.length - 10))), 'normal PLAY_SONG carries an organ track');
  assert.equal(done(f, ORGAN_TASK), true);
  const from = position(f);
  await h.dispatch(f, { type: 'move', worldX: from[0], worldY: from[1] + 1, modifierFlags: 0, run: false });
  h.ticks(f, 8);
  assert.notDeepEqual(position(f), from, 'ordinary movement cancels the playing action without a forced lock');
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});


test('other churches play both cache organ songs without Seers credit or changing muted/manual preferences', async t => {
  const organ = organNear(3240, 3208), at = organ.getLocation();
  for (const [random, track] of [[0, 39], [0.999, 40]]) {
    const f = actor(t, [at.getX() - 1, at.getY(), at.getZ()]);
    f.player.setAudioSetting(168, 0);
    f.player.setAudioSetting(18, 2);
    h.ticks(f, 2);
    const settings = { ...f.player.getAudioSettings() }, packets = [];
    const session = f.player.getSession(), send = session.sendClientPacket.bind(session);
    t.mock.method(session, 'sendClientPacket', frame => { packets.push(frame); return send(frame); });
    const roll = t.mock.method(Math, 'random', () => random);
    try { await play(f, organ); } finally { roll.mock.restore(); }
    assert.ok(f.animations.some(a => a.id === 3675));
    assert.ok(packets.some(p => p[0] === 133 && p.readUInt16BE(p.length - 10) === track));
    assert.deepEqual(f.player.getAudioSettings(), settings, 'normal song packet preserves volume, mode and playlist settings');
    assert.equal(done(f, ORGAN_TASK), false);
  }
});
