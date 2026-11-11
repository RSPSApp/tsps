const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { CombatPoisonEffect } = require('../dist/game/task/impl/CombatPoisonEffect');
const Food = require('../plugins/items/Food.plugin');
const Potions = require('../plugins/items/Potions.plugin');
let core;
before(async () => {
  await CachePipeline.initialize(process.cwd()); core = PluginManager.getCoreApi();
  Food.register(PluginManager.createApi('FoodPoisonTreatmentsTest'));
});

function fixture(t, initialHp = 50) {
  const player = new Player(null), tasks = []; let hp = initialHp;
  player.setRegistered(true); player.setRunEnergy(50);
  t.mock.method(player, 'getSkillManager', () => ({
    getCurrentLevel: skill => skill === core.Skill.HITPOINTS ? hp : 99,
    getMaxLevel: () => 99,
  }));
  t.mock.method(player, 'setHitpoints', value => { hp = value; return player; });
  t.mock.method(player, 'getPacketSender', () => ({ sendRunEnergy() {}, hasInterruptibleInterface: () => false }));
  t.mock.method(core.TaskManager, 'submit', task => { task.setRunning(true); tasks.push(task); });
  t.after(() => tasks.forEach(task => task.stop()));
  return { player, tasks, get hp() { return hp; }, set hp(value) { hp = value; },
    rest() { Potions._test.findPotionEntry(core.ItemIdentifiers.GUTHIX_REST_4_).potion.effect(player); },
    eat(key) { Food._test.applyFood(player, Food._test.foodBite(core.ItemIdentifiers[key]).food); },
    ticks(count) { for (let i = 0; i < count; i++) for (const task of tasks) task.tick(); } };
}

test('Guthix rest reduces ordinary poison damage by one instead of fully curing it', t => {
  for (const severity of [30, 29, 6, 5, 1, 0]) {
    const f = fixture(t); f.player.setPoisonDamage(severity);
    f.rest(); assert.equal(f.player.getPoisonDamage(), Math.max(0, severity - 5));
    assert.equal(f.player.isVenomed(), false);
    assert.equal(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
    assert.equal(f.hp, 55); assert.equal(f.player.getRunEnergy(), 55);
  }
});

test('Guthix rest converts venom at matching damage, then reduces the resulting poison on later doses', t => {
  for (const damage of [6, 12, 20]) {
    const f = fixture(t); f.player.setPoisonDamage(damage); f.player.setVenomed(true);
    f.rest(); assert.equal(f.player.isVenomed(), false);
    assert.equal(CombatPoisonEffect.damageFromSeverity(f.player.getPoisonDamage()), damage);
    f.rest(); assert.equal(CombatPoisonEffect.damageFromSeverity(f.player.getPoisonDamage()), damage - 1);
    assert.equal(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
  }
});

test('Guthix rest overheals at full HP without reducing a higher existing boost', t => {
  for (const [initial, expected] of [[50, 55], [98, 99], [99, 104], [104, 104], [115, 115]]) {
    const f = fixture(t, initial); f.rest(); assert.equal(f.hp, expected, String(initial));
  }
});

test('moonlight antelope waits exactly seven task ticks to cure poison or downgrade venom', t => {
  for (const venom of [false, true]) {
    const f = fixture(t, 10); f.player.setPoisonDamage(venom ? 12 : 30); f.player.setVenomed(venom);
    f.eat('COOKED_MOONLIGHT_ANTELOPE'); assert.equal(f.hp, 24);
    f.ticks(6); assert.equal(f.hp, 24); assert.equal(f.player.getPoisonDamage(), venom ? 12 : 30);
    assert.equal(f.player.isVenomed(), venom);
    f.ticks(1); assert.equal(f.hp, 36); assert.equal(f.player.isVenomed(), false);
    assert.equal(f.player.getPoisonDamage(), venom ? 56 : 0, 'venom 12 becomes poison 5 x 12 - 4 (recorded conversion)');
    assert.equal(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
    f.ticks(5); assert.equal(f.hp, 36);
  }
});

test('a newer hunter meat replaces the old delayed cure; ordinary food and potions leave it pending', t => {
  const replaced = fixture(t, 10); replaced.player.setPoisonDamage(12); replaced.player.setVenomed(true);
  replaced.eat('COOKED_MOONLIGHT_ANTELOPE'); replaced.eat('COOKED_WILD_KEBBIT'); replaced.ticks(7);
  assert.equal(replaced.player.isVenomed(), true); assert.equal(replaced.player.getPoisonDamage(), 12);
  const retained = fixture(t, 10); retained.player.setPoisonDamage(30);
  retained.eat('COOKED_MOONLIGHT_ANTELOPE'); retained.eat('SHARK'); retained.rest();
  assert.equal(retained.player.getPoisonDamage(), 25);
  retained.ticks(7); assert.equal(retained.player.getPoisonDamage(), 0);
});

test('delayed food effects cannot heal or treat a dead actor', t => {
  const f = fixture(t, 10); f.player.setPoisonDamage(12); f.player.setVenomed(true);
  f.eat('COOKED_MOONLIGHT_ANTELOPE'); f.hp = 0; f.ticks(7);
  assert.equal(f.hp, 0); assert.equal(f.player.getPoisonDamage(), 12);
});

test('strange fruit keeps its explicit full venom cure and short protection', t => {
  const f = fixture(t); f.player.setPoisonDamage(12); f.player.setVenomed(true);
  f.eat('STRANGE_FRUIT'); assert.equal(f.player.getPoisonDamage(), 0);
  assert.equal(f.player.isVenomed(), false); assert.equal(f.hp, 50);
  assert.equal(f.player.getRunEnergy(), 80);
  assert.ok(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining() >= 17);
});

test('partial treatments preserve stronger existing protection', t => {
  const f = fixture(t); f.player.getCombat().getPoisonImmunityTimer().start(90);
  f.player.setPoisonDamage(30); f.rest();
  assert.ok(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining() >= 89);
  f.eat('COOKED_MOONLIGHT_ANTELOPE'); f.ticks(7);
  assert.equal(f.player.getCombat().getPoisonClock().getCounter(), 5);
  assert.equal(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 86,
    'seven game ticks count toward the original deadline without shortening its dose counter');
});

test('fresh unpoisoned actors never acquire an invalid severity from a treatment', t => {
  for (const treatment of ['rest', 'antelope']) {
    const f = fixture(t);
    if (treatment === 'rest') f.rest();
    else { f.eat('COOKED_MOONLIGHT_ANTELOPE'); f.ticks(7); }
    assert.equal(f.player.getPoisonDamage(), 0, treatment);
    assert.equal(f.player.isPoisoned(), false); assert.equal(f.player.isVenomed(), false);
  }
});

test('an Araxyte venom sac cures venom, deals 4 once and starts the 39-step poison dose', t => {
  const f = fixture(t); const hits = [], said = [];
  t.mock.method(f.player.getCombat().getHitQueue(), 'addPendingDamage', list => hits.push(...list.map(hit => hit.getDamage())));
  t.mock.method(f.player, 'sendMessage', text => said.push(text));
  f.player.setPoisonDamage(12); f.player.setVenomed(true);
  f.eat('ARAXYTE_VENOM_SAC');
  assert.equal(f.player.isVenomed(), false); assert.equal(f.player.getPoisonDamage(), 0);
  assert.deepEqual(hits, [4]);
  const clock = f.player.getCombat().getPoisonClock();
  assert.equal(clock.getCounter(), 39, '11.7 minutes: 39 steps of 18 seconds (Wiki)');
  assert.equal(clock.isVenomImmune(), true);
  f.ticks(29); assert.deepEqual(said, []);
  f.ticks(1);
  assert.equal(clock.getCounter(), 38); assert.equal(clock.isVenomImmune(), false);
  assert.equal(clock.finished(), false, 'still immune to poison');
  assert.deepEqual(said, ['<col=7f007f>Your venom resistance has worn off, but you are still resistant to poison.</col>']);
  f.ticks(60); assert.equal(said.length, 1);
});

test('an Araxyte venom sac keeps a stronger poison dose already running', t => {
  const f = fixture(t); t.mock.method(f.player.getCombat().getHitQueue(), 'addPendingDamage', () => {});
  f.player.getCombat().getPoisonImmunityTimer().start(1000);
  f.eat('ARAXYTE_VENOM_SAC');
  assert.equal(f.player.getCombat().getPoisonClock().getCounter(), Math.ceil(1000 / 18));
});
