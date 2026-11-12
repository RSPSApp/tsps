const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
process.env.WORLD_ADMIN_PORT = '0';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core;
let I;
let nextIndex = 29000;
const fills = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi(); I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
  PM.createApi('SandPitTest').onCustomEvent('sand-pit:filled', e => fills.push(e));
});
after(() => PM.emitServerShutdown({}));
function fixture(t, id = 14890, mode = 'normal') {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername(`sand${nextIndex}`); p.setRegistered(true);
  p.setAttribute('ironman:mode', mode);
  p.setLocation(new core.Location(2541, 3103, 0));
  const messages = [], animations = [], sounds = [];
  p.sendMessage = text => messages.push(text);
  p.performAnimation = a => animations.push(a.getId());
  p.getPacketSender().sendSoundEffect = (...a) => sounds.push(a);
  const object = { getId: () => id, getType: () => 10, getLocation: () => new core.Location(2542, 3103, 0), getDefinition: () => core.ObjectDefinition.forId(id) };
  const use = (slot = 0, itemId = I.BUCKET) => PM.emitItemOnObject({ player: p, object, objectId: id, itemId,
    item: p.getInventory().getItems()[slot], itemSlot: slot, location: { x: 2542, y: 3103, z: 0 }, handled: false });
  const tick = n => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, use, tick, messages, animations, sounds };
}
// rsprox 3196: Dorgesh-Kaan repeats at +1,+3,+5 while standing; 4283: one bucket at Entrana.
for (const [id, name] of [[14890, 'Sand pit'], [22726, 'Sandpit'], [10814, 'Sandpit'], [50733, 'Sand pit']]) {
  test(`an ordinary player fills buckets at cache loc ${id} (${name}) every two ticks`, t => {
    const f = fixture(t, id);
    assert.equal(core.ObjectDefinition.forId(id).getName(), name);
    for (let s = 0; s < 3; s++) f.p.getInventory().setItem(s, new core.Item(I.BUCKET, 1));
    const xp = core.Skill.values().map(skill => f.p.getSkillManager().getExperience(skill));
    assert.equal(f.use(), true);
    assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 0, 'not immediate');
    f.tick(1); assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 1);
    f.tick(1); assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 1);
    f.tick(1); assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 2);
    f.tick(2); assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 3);
    f.tick(4); assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 3);
    assert.deepEqual(core.Skill.values().map(skill => f.p.getSkillManager().getExperience(skill)), xp);
    assert.deepEqual(f.messages, Array(3).fill('You fill the bucket with sand.'));
    assert.deepEqual(f.animations, [895, 895, 895]);
    assert.deepEqual(f.sounds, Array(3).fill([2584, 1, 0]));
  });
}
test('a full inventory converts the used slot and retains item metadata', t => {
  const f = fixture(t);
  for (let s = 0; s < 28; s++) f.p.getInventory().setItem(s, new core.Item(I.BUCKET, 1));
  f.p.getInventory().getItems()[17].setMetaValue(core.Item.PRESET_META, true);
  f.use(17); f.tick(1);
  assert.equal(f.p.getInventory().getItems()[17].getId(), I.BUCKET_OF_SAND);
  assert.equal(f.p.getInventory().getItems()[17].isPresetItem(), true);
  assert.equal(f.p.getInventory().getItems()[0].getId(), I.BUCKET);
});
test('walking or cancelling the player task stops automatic filling', t => {
  for (const move of [true, false]) {
    const f = fixture(t);
    for (let s = 0; s < 3; s++) f.p.getInventory().setItem(s, new core.Item(I.BUCKET, 1));
    f.use(); f.tick(1);
    if (move) f.p.setLocation(new core.Location(2540, 3103, 0));
    else core.TaskManager.cancelTasks(f.p.getIndex());
    f.tick(5);
    assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 1);
    assert.equal(f.p.getInventory().getAmount(I.BUCKET), 2);
  }
});
test('a stale slot, a noted bucket and an unrelated object cannot start filling', t => {
  const f = fixture(t);
  const noted = I.BUCKET_2;
  f.p.getInventory().setItem(0, new core.Item(noted, 3));
  assert.equal(f.use(0, noted), false);
  assert.equal(f.use(1), false);
  f.tick(4); assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 0);
  const unrelated = fixture(t, 1763);
  unrelated.p.getInventory().setItem(0, new core.Item(I.BUCKET, 1));
  unrelated.use(); unrelated.tick(4);
  assert.equal(unrelated.p.getInventory().getAmount(I.BUCKET_OF_SAND), 0);
});

test('UIM conversion uses the same cadence and credits the diary only after success', t => {
  const f = fixture(t, core.ObjectIdentifiers.SANDPIT, 'ultimate');
  const tasks = [];
  PM.createApi('SandPitDiaryTest').onCustomEvent('diary:task', e => { if (e.player === f.p) tasks.push(e); });
  f.p.getInventory().setItem(0, new core.Item(I.BUCKET, 1));
  f.p.getInventory().setItem(1, new core.Item(I.BUCKET, 1));
  f.use();
  assert.equal(tasks.length, 0, 'credit waits for the bucket conversion');
  f.tick(1); assert.equal(tasks.length, 1);
  assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 1);
  f.tick(1); assert.equal(tasks.length, 1);
  f.tick(1); assert.equal(tasks.length, 2);
  assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 2);
  assert.ok(tasks.every(e => e.diary === 'ardougne' && e.task === 'claim-buckets-of-sand-from-bert-in-yanille'));
  f.use(); f.tick(3); assert.equal(tasks.length, 2, 'no bucket means no further credit');
});

test('the chartable Sailing landmark sharing the sandpit name falls through', t => {
  const f = fixture(t, core.ObjectIdentifiers.SAND_PIT_6);
  assert.ok(core.ObjectDefinition.forId(core.ObjectIdentifiers.SAND_PIT_6).getInteractions().includes('Chart'));
  f.p.getInventory().setItem(0, new core.Item(I.BUCKET, 1));
  assert.equal(f.use(), false);
  f.tick(3);
  assert.equal(f.p.getInventory().getAmount(I.BUCKET), 1);
});

test('losing the used bucket or logging out before the first fill gives no sand or credit', t => {
  for (const leave of [true, false]) {
    const f = fixture(t, core.ObjectIdentifiers.SANDPIT, 'ultimate');
    f.p.getInventory().setItem(0, new core.Item(I.BUCKET, 1));
    f.use();
    const count = fills.length;
    if (leave) f.p.setRegistered(false);
    else f.p.getInventory().setItem(0, new core.Item(I.COINS, 1));
    f.tick(5);
    assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 0);
    assert.equal(fills.length, count);
    assert.deepEqual(f.messages, []);
  }
});
