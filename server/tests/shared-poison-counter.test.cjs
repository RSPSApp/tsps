const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { CombatPoisonEffect: Effect } = require('../dist/game/task/impl/CombatPoisonEffect');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const Potions = require('../plugins/items/Potions.plugin');
before(async () => require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd()));

function fixture(t, severity = 0) {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const player = new Player(null), tasks = [], hits = [];
  player.setRegistered(true); player.setPoisonDamage(severity);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(player, 'sendMessage', () => {});
  t.mock.method(player.getCombat().getHitQueue(), 'addPendingDamage', values => hits.push(...values));
  t.mock.method(TaskManager, 'submit', task => { task.setRunning(true); tasks.push(task); });
  if (severity) TaskManager.submit(new Effect(player));
  t.after(() => { tasks.forEach(task => task.stop()); player.setRegistered(false); });
  return { player, tasks, hits, timer: player.getCombat().getPoisonImmunityTimer(),
    drink(id) { Potions._test.findPotionEntry(id).potion.effect(player); },
    value() { return Effect.orbValue(player); },
    step(count = 1) { for (let i = 0; i < count; i++) for (const task of tasks.slice()) task.tick(); },
    advanceWall(ms) { now += ms; } };
}

test('anti-venom+ retains an existing poison pulse instead of starting an independent stopwatch', t => {
  const f = fixture(t, 20);
  f.step(30); assert.equal(f.value(), 19);
  f.step(5); f.drink(I.ANTI_VENOM_4__3); assert.equal(f.value(), -50);
  f.step(24); assert.equal(f.value(), -50);
  f.step(); assert.equal(f.value(), -49, 'the existing deadline is only25ticks after treatment');
  f.step(30); assert.equal(f.value(), -48);
});

test('actual anti-venom+ and the captured modal schedule reproduce all observed protection counters', t => {
  const capture = require('./fixtures/poison-protection-clock-1637.json'), f = fixture(t, 19);
  const sender = f.player.getPacketSender();
  for (let tick = 4976; tick <= 5380; tick++) {
    const events = capture.events.filter(e => e.tick === tick);
    if (tick === 4980) f.drink(I.ANTI_VENOM_4__3);
    for (const event of events) {
      if (event.event === 'openInterface') sender.sendChatboxInterface(event.group);
      if (event.event === 'closeInterface' && sender.getChatboxGroupId() >= 0) sender.closeInterface(sender.getChatboxGroupId());
    }
    f.step();
    const observed = events.find(e => e.event === 'poison' && e.value < 0);
    if (observed) assert.equal(f.value(), observed.value, 'counter at recorded tick '+tick);
  }
  assert.equal(f.hits.length, 0, 'protection is not a damaging affliction');
});

test('a protection-only player owns one task; renewal and weaker doses never reset the phase', t => {
  const f = fixture(t); f.drink(I.SUPERANTIPOISON_4_);
  assert.equal(f.tasks.length, 1); f.step(10);
  f.drink(I.SUPERANTIPOISON_4_); f.drink(I.ANTIPOISON_4_);
  assert.equal(f.tasks.length, 1); f.step(19); assert.equal(f.value(), -20);
  f.step(); assert.equal(f.value(), -19);
  f.advanceWall(3600000); assert.equal(f.value(), -19, 'only game pulses consume counter protection');
});

test('the final due counter stays protective while modal and releases once when closed', t => {
  const f = fixture(t); f.timer.start(18);
  f.player.getPacketSender().sendChatboxInterface(231); f.step(200);
  assert.equal(f.value(), -1); assert.equal(f.timer.finished(), false);
  CombatFactory.poisonEntity(f.player, 30, 1); assert.equal(f.player.isPoisoned(), false);
  f.player.getPacketSender().closeInterface(231); f.step();
  assert.equal(f.value(), 0); assert.equal(f.timer.finished(), true);
  assert.ok(f.tasks.every(task => !task.isRunning()));
});

test('ordinary antipoison downgrades venom first, then a second dose cures and protects', t => {
  const f = fixture(t, 12); f.player.setVenomed(true); f.player.setLastVenomDamage(10);
  f.drink(I.ANTIPOISON_4_);
  // From the last hit dealt, 5 x 10 - 4 (rsprox_transcripts/234/03280.txt:69820: 1000003 -> 1000002 -> 46).
  assert.equal(f.player.isVenomed(), false); assert.equal(f.value(), 46);
  assert.equal(f.timer.finished(), true, 'positive poison and a new negative dose counter are mutually exclusive');
  f.step(5); f.drink(I.ANTIPOISON_4_); assert.equal(f.value(), -5);
  f.step(25); assert.equal(f.value(), -4);
});

test('ordinary poison protection does not block venom, whereas -39 does and -38 does not', t => {
  for (const counter of [5, 38, 39, 40, 41, 50]) {
    const f = fixture(t); f.timer.start(counter * 18);
    CombatFactory.poisonEntity(f.player, 6, 2);
    assert.equal(f.player.isVenomed(), counter <= 38, 'venom boundary at counter '+counter);
  }
});

test('short poison/venom flags coexist with a stronger dose and do not cure existing affliction', t => {
  const f = fixture(t, 30); f.timer.start(90);
  f.timer.protectBriefly(18, true);
  assert.equal(f.value(), 30); assert.equal(f.timer.isVenomImmune(), true);
  f.advanceWall(18000); assert.equal(f.timer.isVenomImmune(), false);
  assert.equal(f.timer.finished(), false); f.step(30);
  assert.equal(f.value(), 29); assert.deepEqual(f.hits.map(h => h.getDamage()), [6]);
});

test('actual JSON save codec preserves a held counter and its phase through logout/load', t => {
  const f = fixture(t); f.timer.start(90); f.step(10);
  let codec;
  require('../plugins/persistence/JsonPlayerPersistence.plugin').register({
    getSkillManager: () => require('../dist/game/content/skill/SkillManager').SkillManager,
    setPlayerPersistence: value => { codec = value; }, log() {},
  });
  Effect.suspend(f.player);
  const saved = PlayerSave.fromPlayer(f.player);
  const data = JSON.parse(JSON.stringify(saved, codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const loaded = new Player(null); codec.hydratePlayerSave(data).applyToPlayer(loaded);
  loaded.setRegistered(true); t.after(() => Effect.suspend(loaded));
  Effect.resume(loaded); Effect.resume(loaded);
  assert.equal(f.tasks.filter(task => task.isRunning()).length, 1);
  for (let i = 0; i < 19; i++) f.tasks.at(-1).tick();
  assert.equal(Effect.orbValue(loaded), -5);
  f.tasks.at(-1).tick(); assert.equal(Effect.orbValue(loaded), -4);
});

test('positive poison also resumes its saved phase and unaffected saves omit the optional snapshot', t => {
  const f = fixture(t, 30); f.step(11);
  const save = PlayerSave.fromPlayer(f.player), loaded = new Player(null);
  save.applyToPlayer(loaded); loaded.setRegistered(true);
  const hits = []; t.mock.method(loaded.getCombat().getHitQueue(), 'addPendingDamage', values => hits.push(...values));
  Effect.resume(loaded); t.after(() => Effect.suspend(loaded));
  for (let i = 0; i < 18; i++) f.tasks.at(-1).tick(); assert.equal(hits.length, 0);
  f.tasks.at(-1).tick(); assert.equal(hits.length, 1);
  assert.equal(PlayerSave.fromPlayer(new Player(null)).poisonClock, undefined);
});

test('death reset synchronously resets the phase even if a new dose arrives before old task cleanup', t => {
  const f = fixture(t); f.timer.start(90); f.step(29);
  assert.equal(f.player.getCombat().getPoisonClock().snapshot().ticksUntilPulse, 1);
  f.player.resetAttributes(); f.timer.start(90);
  f.step(29); assert.equal(f.value(), -5);
  f.step(); assert.equal(f.value(), -4);
});

test('canonical extended anti-venom and supermix dose chains apply their proper protection tiers', t => {
  const f = fixture(t);
  for (const key of ['EXTENDED_ANTI_VENOM_4_', 'EXTENDED_ANTI_VENOM_3_', 'EXTENDED_ANTI_VENOM_2_', 'EXTENDED_ANTI_VENOM_1_']) {
    const entry = Potions._test.findPotionEntry(I[key]); assert.ok(entry, key+' registered');
    f.timer.stop(); f.player.setPoisonDamage(12); f.player.setVenomed(true);
    f.drink(I[key]); assert.equal(f.value(), -59); assert.equal(f.player.isVenomed(), false);
  }
  f.timer.stop(); f.drink(I.ANTI_POISON_SUPERMIX_2_); assert.equal(f.value(), -20);
});

test('snapshot restoration retains independent brief durations and rejects malformed counter/phase state', t => {
  const f = fixture(t); f.timer.protectBriefly(18); f.timer.protectBriefly(2, true);
  const state = f.player.getCombat().getPoisonClock().snapshot();
  const loaded = new Player(null), timer = loaded.getCombat().getPoisonClock();
  timer.restore(state); f.advanceWall(2000);
  assert.equal(timer.isVenomImmune(), false); assert.equal(timer.finished(), false);
  assert.equal(timer.secondsRemaining(), 16);
  for (const invalid of [{counter:-1,ticksUntilPulse:0}, {counter:5,ticksUntilPulse:31}, {counter:5,ticksUntilPulse:NaN}, {counter:5,ticksUntilPulse:1,briefVenomSeconds:20,briefPoisonSeconds:2},
    {counter:5,ticksUntilPulse:20,protectionTicksRemaining:0},
    {counter:5,ticksUntilPulse:20,protectionTicksRemaining:Infinity},
    {counter:5,ticksUntilPulse:20,protectionTicksRemaining:30}]) {
    timer.restore(invalid, 88);
    assert.equal(timer.getCounter(), 5); assert.equal(timer.snapshot().ticksUntilPulse, 27);
  }
});

// rsprox_transcripts/223/00014.txt ticks 1748/1778 (poison) and 224/01443.txt ticks 151/181 (venom): purple
// lines, one 30-tick pulse before each resistance ends and at its end.
test('the resistance lines come one pulse before and at each end, once each', t => {
  const f = fixture(t); const lines = [];
  f.drink(I.ANTI_VENOM_4__3);
  t.mock.method(f.player, 'sendMessage', m => lines.push(m));
  const venomWarnAt = -f.value() - 39, poisonWarnAt = -f.value() - 1;
  assert.ok(venomWarnAt > 0, 'anti-venom+ protects from venom for more than one pulse');
  f.step(30 * venomWarnAt);
  assert.equal(f.value(), -39);
  assert.deepEqual(lines, ['<col=7f007f>Your venom resistance is about to wear off.</col>']);
  f.step(30);
  assert.deepEqual(lines.slice(1), ['<col=7f007f>Your venom resistance has worn off, but you are still resistant to poison.</col>']);
  f.step(30 * (poisonWarnAt - venomWarnAt - 1));
  assert.equal(f.value(), -1);
  assert.deepEqual(lines.slice(2), ['<col=7f007f>Your poison resistance is about to wear off.</col>']);
  f.step(30);
  assert.equal(f.value(), 0);
  assert.deepEqual(lines.slice(3), ['<col=7f007f>Your poison resistance has worn off.</col>']);
  f.step(90);
  assert.equal(lines.length, 4, 'nothing more');
});

test('protection duration reduction retains the shared nonboundary pulse and roundtrips its fractional dose', t => {
  const { PoisonClock } = require('../dist/game/content/combat/PoisonClock');
  const clock = new PoisonClock(() => {});
  clock.restore({ counter: 10, ticksUntilPulse: 20 }); // supplied nonboundary clock checkpoint
  assert.equal(clock.secondsRemaining(), 174);
  clock.reduceProtection(45);
  assert.equal(clock.secondsRemaining(), 129, 'exact75ticks removed without rounding to whole18second dose units');
  assert.equal(clock.snapshot().ticksUntilPulse, 20, 'next status pulse did not move to5ticks');
  const state = clock.snapshot();
  const restored = new PoisonClock(() => {});
  restored.restore(state);
  assert.deepEqual(restored.snapshot(), state, 'new optional precision state survives save/load');
  const pulses = [];
  for (let tick = 1; tick <= 230; tick++) {
    if (restored.tickPulse(false)) pulses.push(tick);
    if (tick === 214) assert.equal(restored.finished(), false);
    if (tick === 215) {
      assert.equal(restored.finished(), true, 'remaining129seconds expires at215ticks');
      assert.equal(restored.snapshot().ticksUntilPulse, 15, 'expiry preserves the pending shared pulse too');
    }
  }
  assert.deepEqual(pulses, [20, 50, 80, 110, 140, 170, 200, 230]);
  clock.reduceProtection(45);
  assert.equal(clock.secondsRemaining(), 84, 'repeated reductions retain their exact remainder');
  assert.equal(clock.snapshot().ticksUntilPulse, 20);
});

test('duration reduction safely exhausts a dose, preserves no-dose phase and independently reduces brief protection', t => {
  const { PoisonClock } = require('../dist/game/content/combat/PoisonClock');
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const clock = new PoisonClock(() => {});
  clock.restore({ counter: 1, ticksUntilPulse: 20 });
  clock.reduceProtection(45);
  assert.equal(clock.getCounter(), 0);
  assert.equal(clock.finished(), true);
  assert.equal(clock.snapshot().ticksUntilPulse, 20);
  clock.reduceProtection(45);
  assert.equal(clock.snapshot().ticksUntilPulse, 20, 'empty protection is no status reset');
  clock.protectBriefly(60, true);
  clock.reduceProtection(45);
  assert.equal(clock.secondsRemaining(), 15);
  assert.equal(clock.isVenomImmune(), true);
  assert.equal(clock.snapshot().ticksUntilPulse, 20);
  now += 15000;
  assert.equal(clock.isVenomImmune(), false);
  assert.equal(clock.finished(), true);
  clock.protectBriefly(2, true);
  clock.reduceProtection(45);
  assert.equal(clock.finished(), true);
  assert.equal(clock.isVenomImmune(), false);
  for (const seconds of [NaN, Infinity, -1, 0]) clock.reduceProtection(seconds);
  assert.equal(clock.snapshot().ticksUntilPulse, 20);
});

test('reduced protection emits warning and expiry through the actual Effect between status pulses', t => {
  const f = fixture(t), lines = [];
  const clock = f.player.getCombat().getPoisonClock();
  clock.restore({ counter: 10, ticksUntilPulse: 20 });
  clock.reduceProtection(45);
  t.mock.method(f.player, 'sendMessage', line => lines.push(line));
  f.step(184);
  assert.equal(f.value(), -2);
  assert.deepEqual(lines, []);
  f.step();
  assert.equal(f.value(), -1);
  assert.equal(clock.snapshot().ticksUntilPulse, 15, 'warning transition is between native status pulses');
  assert.deepEqual(lines, ['<col=7f007f>Your poison resistance is about to wear off.</col>']);
  f.step(29);
  assert.equal(f.value(), -1);
  f.step();
  assert.equal(f.value(), 0);
  assert.deepEqual(lines, ['<col=7f007f>Your poison resistance is about to wear off.</col>',
    '<col=7f007f>Your poison resistance has worn off.</col>']);
  assert.ok(f.tasks.every(task => !task.isRunning()), 'protection-only task closes after delivering the end line');
  f.step(60);
  assert.equal(lines.length, 2, 'no duplicate end transition');
  assert.equal(f.hits.length, 0);
});

test('a reduced final dose holds its due transition while modal and releases once on close', t => {
  const f = fixture(t), lines = [];
  const clock = f.player.getCombat().getPoisonClock();
  clock.restore({ counter: 10, ticksUntilPulse: 20 });
  clock.reduceProtection(45);
  t.mock.method(f.player, 'sendMessage', line => lines.push(line));
  f.step(200);
  assert.equal(clock.snapshot().protectionTicksRemaining, 15, 'real reduced dose reaches the reviewed final checkpoint');
  f.player.getPacketSender().sendChatboxInterface(231);
  f.step(200);
  assert.equal(f.value(), -1);
  assert.equal(clock.finished(), false);
  assert.equal(clock.snapshot().ticksUntilPulse, 0, 'the status pulse itself becomes due without being advanced');
  assert.equal(lines.length, 1, 'only the prior warning was delivered');
  CombatFactory.poisonEntity(f.player, 30, 1);
  assert.equal(f.player.isPoisoned(), false, 'modal-held final protection still blocks poison');
  f.player.getPacketSender().closeInterface(231);
  f.step();
  assert.equal(f.value(), 0);
  assert.equal(clock.finished(), true);
  assert.deepEqual(lines, ['<col=7f007f>Your poison resistance is about to wear off.</col>',
    '<col=7f007f>Your poison resistance has worn off.</col>']);
  assert.ok(f.tasks.every(task => !task.isRunning()));
  f.step(60);
  assert.equal(lines.length, 2);
});

test('reduced venom-tier transitions use the Effect feedback path between unchanged status pulses', t => {
  const f = fixture(t), lines = [];
  const clock = f.player.getCombat().getPoisonClock();
  clock.restore({ counter: 42, ticksUntilPulse: 20 });
  clock.reduceProtection(45);
  assert.equal(f.value(), -40);
  t.mock.method(f.player, 'sendMessage', line => lines.push(line));
  f.step(4);
  assert.deepEqual(lines, []);
  f.step();
  assert.equal(f.value(), -39);
  assert.equal(clock.snapshot().ticksUntilPulse, 15);
  assert.equal(clock.isVenomImmune(), true);
  f.step(30);
  assert.equal(f.value(), -38);
  assert.equal(clock.snapshot().ticksUntilPulse, 15);
  assert.equal(clock.isVenomImmune(), false);
  assert.deepEqual(lines, ['<col=7f007f>Your venom resistance is about to wear off.</col>',
    '<col=7f007f>Your venom resistance has worn off, but you are still resistant to poison.</col>']);
});

test('duration reduction leaves the existing affliction on its native Effect pulse', t => {
  const f = fixture(t, 20);
  const clock = f.player.getCombat().getPoisonClock();
  clock.restore({ counter: 10, ticksUntilPulse: 20 });
  clock.reduceProtection(45);
  f.step(19);
  assert.equal(f.hits.length, 0);
  f.step();
  assert.equal(f.hits.length, 1);
  f.step(29);
  assert.equal(f.hits.length, 1);
  f.step();
  assert.equal(f.hits.length, 2);
  assert.equal(f.player.getPoisonDamage(), 18, 'dose reduction does not cure or reset the affliction');
});
