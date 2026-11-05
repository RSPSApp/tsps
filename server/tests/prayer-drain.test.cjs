// Run after `yarn build`: node --test tests/prayer-drain.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PrayerHandler, PrayerData } = require('../dist/game/content/PrayerHandler');
const { Skill } = require('../dist/game/model/Skill');

const RUN_OUT = 'You have run out of prayer points, you can recharge at an altar.';

/** Wiki (Prayer): the drain effect each prayer adds to the drain counter per tick. */
const DRAIN_EFFECTS = {
  THICK_SKIN: 1, BURST_OF_STRENGTH: 1, CLARITY_OF_THOUGHT: 1, SHARP_EYE: 1, MYSTIC_WILL: 1,
  ROCK_SKIN: 6, SUPERHUMAN_STRENGTH: 6, IMPROVED_REFLEXES: 6, RAPID_RESTORE: 1, RAPID_HEAL: 2,
  PROTECT_ITEM: 2, HAWK_EYE: 6, MYSTIC_LORE: 6, STEEL_SKIN: 12, ULTIMATE_STRENGTH: 12,
  INCREDIBLE_REFLEXES: 12, PROTECT_FROM_MAGIC: 12, PROTECT_FROM_MISSILES: 12, PROTECT_FROM_MELEE: 12,
  EAGLE_EYE: 12, MYSTIC_MIGHT: 12, RETRIBUTION: 3, REDEMPTION: 6, SMITE: 18, PRESERVE: 2,
  CHIVALRY: 12, PIETY: 24, RIGOUR: 24, AUGURY: 24,
};

before(async () => {
  await CachePipeline.initialize(process.cwd());
});

function fixture(t, { points = 50 } = {}) {
  const player = new Player(null), messages = [], sounds = [];
  const sender = new Proxy({ sendSoundEffect(...args) { sounds.push(args); return sender; } }, { get: (target,key) => target[key] ?? (() => sender) });
  t.mock.method(player, 'getPacketSender', () => sender);
  t.mock.method(player, 'sendMessage', (text) => messages.push(text));
  player.setRegistered(true);
  player.getSkillManager().setMaxLevel(Skill.PRAYER, 99);
  player.getSkillManager().setCurrentLevel(Skill.PRAYER, points, false);
  player.getSkillManager().setMaxLevel(Skill.HITPOINTS, 99);
  player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 99, false);
  return { player, messages, sounds, points: () => player.getSkillManager().getCurrentLevel(Skill.PRAYER) };
}

/** Switches a prayer on and lets the free activation tick pass. */
function activate(player, prayer) {
  player.setPrayerActive(PrayerHandler[prayer], true);
  PrayerHandler.startDrain(player);
  player.markPrayerActivatedThisTick();
  PrayerHandler.processDrain(player);
}

function tick(player, ticks) {
  for (let i = 0; i < ticks; i++) PrayerHandler.processDrain(player);
}

test('every prayer adds the drain effect the Wiki lists', () => {
  for (const [name, effect] of Object.entries(DRAIN_EFFECTS)) {
    assert.equal(PrayerData[name].drainEffect, effect, name);
  }
});

test('locked prayers report their own name and exact Prayer requirement', (t) => {
  t.mock.method(PluginManager, 'emitPrayerDisabled', () => null);
  const f = fixture(t);
  f.player.getSkillManager().setMaxLevel(Skill.PRAYER, 1);
  for (const [name, prayer] of Object.entries(PrayerData)) {
    if (!(prayer instanceof PrayerData)) continue;
    const formatted = name.toLowerCase().split('_').map(word => ['of', 'from'].includes(word) ? word : word[0].toUpperCase() + word.slice(1)).join(' ');
    assert.equal(prayer.getPrayerName(), formatted);
    if (prayer.requirement === 1) continue;
    assert.equal(PrayerHandler.canUse(f.player, prayer, true), false);
    assert.equal(f.messages.at(-1), `You need a Prayer level of at least ${prayer.requirement} to use ${formatted}.`);
  }
});

test('Chivalry also needs 65 Defence, not the 60 the old check used', (t) => {
  t.mock.method(PluginManager, 'emitPrayerDisabled', () => null);
  const f = fixture(t);
  f.player.getSkillManager().setMaxLevel(Skill.PRAYER, 60);
  f.player.getSkillManager().setMaxLevel(Skill.DEFENCE, 64);
  assert.equal(PrayerHandler.canUse(f.player, PrayerData.CHIVALRY, true), false);
  assert.equal(f.messages.at(-1), 'You need a Defence level of at least 65 to use Chivalry.');
  f.player.getSkillManager().setMaxLevel(Skill.DEFENCE, 65);
  assert.equal(PrayerHandler.canUse(f.player, PrayerData.CHIVALRY, true), true);
});

test('a prayer costs a point every 60 / drain effect ticks at 0 prayer bonus', (t) => {
  for (const [prayer, ticksPerPoint] of [['PROTECT_FROM_MELEE', 5], ['THICK_SKIN', 60], ['PIETY', 2.5], ['SMITE', 10 / 3]]) {
    const f = fixture(t, { points: 99 });
    activate(f.player, prayer);
    const ticks = 120;
    tick(f.player, ticks);
    assert.equal(99 - f.points(), Math.floor(ticks / ticksPerPoint), prayer);
  }
});

test('Prayer at 0 switches every prayer off with the live message on the next tick', (t) => {
  const f = fixture(t, { points: 1 });
  activate(f.player, 'PROTECT_FROM_MELEE');
  f.player.setPrayerActive(PrayerHandler.THICK_SKIN, true);
  tick(f.player, 5);
  assert.equal(f.points(), 0);
  assert.equal(PrayerHandler.isActivated(f.player, PrayerHandler.PROTECT_FROM_MELEE), true);
  assert.deepEqual(f.messages, []);
  tick(f.player, 1);
  assert.equal(PrayerHandler.isActivated(f.player, PrayerHandler.PROTECT_FROM_MELEE), false);
  assert.equal(PrayerHandler.isActivated(f.player, PrayerHandler.THICK_SKIN), false);
  assert.deepEqual(f.messages, [RUN_OUT]);
  assert.equal(f.player.isDrainingPrayer(), false);
  assert.deepEqual(f.sounds.map(args => args.slice(0,3)), [[2672,0,0]], 'raw3167 tick136: one depletion synth, no per-prayer off whooshes');
});

test('Prayer drained to 0 by something else shuts the prayers off on the next tick too', (t) => {
  const f = fixture(t, { points: 10 });
  activate(f.player, 'THICK_SKIN');
  f.player.getSkillManager().setCurrentLevel(Skill.PRAYER, 0, false);
  tick(f.player, 1);
  assert.equal(PrayerHandler.isActivated(f.player, PrayerHandler.THICK_SKIN), false);
  assert.deepEqual(f.messages, [RUN_OUT]);
});


test('captured missing Prayer activations use private immediate synths and automatic replacements stay quiet', t => {
  t.mock.method(PluginManager,'emitPrayerDisabled',()=>null);
  const expected = { SHARP_EYE:2685,RIGOUR:2685,MYSTIC_WILL:2670,AUGURY:2670,PROTECT_ITEM:1982,HAWK_EYE:2666,
    MYSTIC_LORE:2668,EAGLE_EYE:2665,MYSTIC_MIGHT:2669,RETRIBUTION:2682,REDEMPTION:2680,SMITE:2686,
    PRESERVE:2679,CHIVALRY:3826,PIETY:3825 };
  for (const [prayer,id] of Object.entries(expected)) {
    const f=fixture(t); f.player.getSkillManager().setMaxLevel(Skill.DEFENCE,99);
    PrayerHandler.activatePrayerPrayerId(f.player,PrayerHandler[prayer]);
    assert.equal(f.player.getPrayerActive()[PrayerHandler[prayer]],true,prayer);
    assert.deepEqual(f.sounds.map(args=>args.slice(0,3)),[[id,0,0]],prayer+' raw2990/selected prayer recordings');
    PrayerHandler.activatePrayerPrayerId(f.player,PrayerHandler[prayer]);
    assert.equal(f.sounds.length,1,'already-active prayer adds no sound');
    PrayerHandler.deactivatePrayer(f.player,PrayerHandler[prayer]);
    assert.deepEqual(f.sounds.at(-1).slice(0,3),[2663,0,0],'manual off is retained');
  }
  const f=fixture(t); f.player.getSkillManager().setMaxLevel(Skill.DEFENCE,99);
  PrayerHandler.activatePrayerPrayerId(f.player,PrayerHandler.PROTECT_FROM_MELEE); f.sounds.length=0;
  PrayerHandler.activatePrayerPrayerId(f.player,PrayerHandler.SMITE);
  assert.deepEqual(f.sounds.map(args=>args[0]),[2686],'raw2990: replacing an incompatible prayer plays only its new activation');
});


test('a stale drain flag after the last manual off cannot emit a depletion sound or repeat shutdown', t => {
  const f=fixture(t,{points:1}); activate(f.player,'THICK_SKIN');
  f.player.getSkillManager().setCurrentLevel(Skill.PRAYER,0,false);
  PrayerHandler.deactivatePrayer(f.player,PrayerHandler.THICK_SKIN);
  tick(f.player,3);
  assert.deepEqual(f.sounds.map(args=>args[0]),[2663]);
  assert.deepEqual(f.messages,[]);
  assert.equal(f.player.isDrainingPrayer(),false);
});


test('actual quick-prayer toggles play four activations but one manual group-off, with a quiet preset preclear', t => {
  t.mock.method(PluginManager,'emitPrayerDisabled',()=>null);
  const f=fixture(t);f.player.getSkillManager().setMaxLevel(Skill.DEFENCE,99);
  const selected=Array(30).fill(null);
  for(const name of ['STEEL_SKIN','ULTIMATE_STRENGTH','INCREDIBLE_REFLEXES','PROTECT_FROM_MELEE']) selected[PrayerHandler[name]]=PrayerData[name];
  const quick=f.player.getQuickPrayers();quick.setPrayers(selected);
  assert.equal(quick.handleWidgetAction(541,4,1),true);
  assert.deepEqual(f.sounds.map(args=>args[0]),[2687,2691,2667,2676],'raw3277 quick-enable');
  f.sounds.length=0;quick.handleWidgetAction(541,4,1);
  assert.deepEqual(f.sounds.map(args=>args[0]),[2663],'raw3277 tick5053 has one off for four active prayers');
  assert.equal(f.player.getPrayerActive().some(Boolean),false);
  PrayerHandler.activatePrayerPrayerId(f.player,PrayerHandler.PROTECT_ITEM);f.sounds.length=0;
  quick.handleWidgetAction(541,4,1);
  assert.deepEqual(f.sounds.map(args=>args[0]),[2687,2691,2667,2676],'replacing the existing prayers adds no off sound');
  quick.handleWidgetAction(541,4,1);quick.setPrayers(Array(30).fill(null));f.sounds.length=0;
  quick.handleWidgetAction(541,4,1);
  assert.deepEqual(f.sounds,[],'empty-preset refusal adds no activation/off');
});
