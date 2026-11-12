// Run after `yarn build`: node --test tests/stat-restoration.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
const { Skill } = require('../dist/game/model/Skill');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const registerRegenBraceletEffects = require('../plugins/combat/effects/RegenBracelet.EquipmentEffects');
const Passive = require('../plugins/items/skillcapes/Passive.SkillCapes');

before(async () => {
  await CachePipeline.initialize(process.cwd());
  registerRegenBraceletEffects({ core: PluginManager.getCoreApi(), onCustomEvent() {} });
});

/** A player on 99s whose `levels` are set as given; `gear` answers "stats:hitpoints-regen". */
function fixture(t, levels = {}, gear = () => {}) {
  const player = new Player(null);
  const scripts = [];
  const sender = new Proxy({}, {
    get: (_, name) => (name === 'sendClientScript' ? (...args) => { scripts.push(args); return sender; } : () => sender),
  });
  t.mock.method(player, 'getPacketSender', () => sender);
  const skills = player.getSkillManager();
  for (const skill of Skill.values()) {
    skills.setMaxLevel(skill, 99);
    skills.setCurrentLevel(skill, 99, false);
  }
  for (const [name, level] of Object.entries(levels)) skills.setCurrentLevel(Skill[name], level, false);
  const emit = PluginManager.emitCustomEvent.bind(PluginManager);
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => (name === 'stats:hitpoints-regen' ? gear(payload) : emit(name, payload)));
  return {
    player,
    scripts,
    level: (name) => skills.getCurrentLevel(Skill[name]),
    /** Runs the restoration for each cycle from `from` to `to`, inclusive. */
    run(from, to) {
      for (let cycle = from; cycle <= to; cycle++) player.processStatRestoration(cycle);
    },
  };
}

test('a lowered stat restores one point a minute, not two', (t) => {
  const f = fixture(t, { ATTACK: 80, PRAYER: 50 });
  f.run(0, 99);
  assert.equal(f.level('ATTACK'), 80, 'nothing before the minute is up');
  f.run(100, 100);
  assert.equal(f.level('ATTACK'), 81);
  f.run(101, 300);
  assert.equal(f.level('ATTACK'), 83, 'one point per 100 ticks');
  assert.equal(f.level('PRAYER'), 50, 'prayer points never restore on their own');
});

test('Rapid Restore adds a point a minute on its own timer from when it is switched on', (t) => {
  const f = fixture(t, { STRENGTH: 70 });
  f.run(0, 39);
  f.player.setPrayerActive(PrayerHandler.RAPID_RESTORE, true);
  f.run(40, 100);
  assert.equal(f.level('STRENGTH'), 71, 'the normal timer at 100');
  f.run(101, 139);
  assert.equal(f.level('STRENGTH'), 71);
  f.run(140, 140);
  assert.equal(f.level('STRENGTH'), 72, 'the prayer\'s own minute ends at 140');
  f.run(141, 300);
  assert.equal(f.level('STRENGTH'), 75, 'two points a minute in all, not three');
});

test('Hitpoints heal a point a minute, or every 30 seconds with Rapid Heal', (t) => {
  const f = fixture(t, { HITPOINTS: 50 });
  f.run(0, 99);
  assert.equal(f.level('HITPOINTS'), 50);
  f.run(100, 100);
  assert.equal(f.level('HITPOINTS'), 51);

  const fast = fixture(t, { HITPOINTS: 50 });
  fast.player.setPrayerActive(PrayerHandler.RAPID_HEAL, true);
  fast.run(0, 49);
  assert.equal(fast.level('HITPOINTS'), 50);
  fast.run(50, 50);
  assert.equal(fast.level('HITPOINTS'), 51, 'one point after 30 seconds');
  fast.run(51, 199);
  assert.equal(fast.level('HITPOINTS'), 53, 'one point per 50 ticks, not two per 100');
});

test('switching Rapid Heal on or off restarts the Hitpoints countdown', (t) => {
  const f = fixture(t, { HITPOINTS: 50 });
  f.run(0, 90);
  f.player.setPrayerActive(PrayerHandler.RAPID_HEAL, true);
  f.run(91, 140);
  assert.equal(f.level('HITPOINTS'), 50, 'switched on at 91: the minute in progress is gone');
  f.run(141, 141);
  assert.equal(f.level('HITPOINTS'), 51, '50 ticks after switching it on');
  f.run(142, 160);
  f.player.setPrayerActive(PrayerHandler.RAPID_HEAL, false);
  f.run(161, 260);
  assert.equal(f.level('HITPOINTS'), 51, 'switched off at 161: a full minute again');
  f.run(261, 261);
  assert.equal(f.level('HITPOINTS'), 52);
});

test('Hitpoints above base drop a point a minute, and Rapid Heal restarts that timer', (t) => {
  const f = fixture(t, { HITPOINTS: 115 });
  f.run(0, 99);
  assert.equal(f.level('HITPOINTS'), 115);
  f.run(100, 100);
  assert.equal(f.level('HITPOINTS'), 114, 'overhealed Hitpoints decay');
  f.run(101, 190);
  f.player.setPrayerActive(PrayerHandler.RAPID_HEAL, true);
  f.run(191, 290);
  assert.equal(f.level('HITPOINTS'), 114, 'switched on at 191: no drop at 200');
  f.run(291, 291);
  assert.equal(f.level('HITPOINTS'), 113, 'a minute after switching it on');
  f.run(292, 1000);
  assert.equal(f.level('HITPOINTS'), 106, 'still a point a minute with Rapid Heal on');
});

test('a Hitpoints cape heals every 30 seconds and does not stack with Rapid Heal', (t) => {
  const capeOnly = (regen) => Passive._test.hitpointsRegen(regen);
  t.mock.method(require('../plugins/items/skillcapes/Common.SkillCapes'), 'hasPerk', (_, skill) => skill === 'HITPOINTS');
  const f = fixture(t, { HITPOINTS: 50 }, capeOnly);
  f.run(0, 199);
  assert.equal(f.level('HITPOINTS'), 53, 'points at 50, 100 and 150');
  const both = fixture(t, { HITPOINTS: 50 }, capeOnly);
  both.player.setPrayerActive(PrayerHandler.RAPID_HEAL, true);
  both.run(0, 199);
  assert.equal(both.level('HITPOINTS'), 53, 'Rapid Heal on top of the cape changes nothing');
});

test('a regen bracelet doubles each regeneration, with or without Rapid Heal', (t) => {
  const bracelet = (regen) => require('../plugins/combat/effects/RegenBracelet.EquipmentEffects')._test.applyRegenBracelet(regen);
  const f = fixture(t, { HITPOINTS: 50 }, bracelet);
  f.player.getEquipment().setItem(Equipment.HANDS_SLOT, new (require('../dist/game/model/Item').Item)(ItemIdentifiers.REGEN_BRACELET, 1));
  f.run(0, 100);
  assert.equal(f.level('HITPOINTS'), 52, '2 Hitpoints a minute');
  f.player.setPrayerActive(PrayerHandler.RAPID_HEAL, true);
  f.run(101, 201);
  assert.equal(f.level('HITPOINTS'), 56, '2 Hitpoints every 30 seconds with Rapid Heal');
});

test('the regen bracelet counts while worn when the Hitpoints regen lands', (t) => {
  const bracelet = (regen) => require('../plugins/combat/effects/RegenBracelet.EquipmentEffects')._test.applyRegenBracelet(regen);
  const f = fixture(t, { HITPOINTS: 50 }, bracelet);
  const equipment = f.player.getEquipment();
  equipment.setItem(Equipment.HANDS_SLOT, new (require('../dist/game/model/Item').Item)(ItemIdentifiers.REGEN_BRACELET, 1));
  f.run(0, 50);
  equipment.setItem(Equipment.HANDS_SLOT, new (require('../dist/game/model/Item').Item)(-1)).refreshItems();
  f.run(51, 100);
  assert.equal(f.level('HITPOINTS'), 51, 'removed before the regen: 1 Hitpoint');
  f.run(101, 150);
  equipment.setItem(Equipment.HANDS_SLOT, new (require('../dist/game/model/Item').Item)(ItemIdentifiers.REGEN_BRACELET, 1)).refreshItems();
  f.run(151, 200);
  assert.equal(f.level('HITPOINTS'), 53, 'worn before the regen: 2 Hitpoints');
});

test('the modified stats overlay gets the restore timer every 25 ticks of its cycle', (t) => {
  const f = fixture(t);
  const sent = [];
  const emit = PluginManager.emitCustomEvent;
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name === 'stats:restore-timer-sent') sent.push(payload.player);
    return emit(name, payload);
  });
  f.run(10, 135);
  assert.deepEqual(f.scripts, [
    [4517, 0, 100, 100], [4517, 0, 100, 75], [4517, 0, 100, 50], [4517, 0, 100, 25],
    [4517, 0, 100, 100], [4517, 0, 100, 75],
  ], 'at the first process, then each quarter: 35, 60, 85, the restore at 110, and 135');
  assert.deepEqual(sent, Array(6).fill(f.player), 'each one asks for the boost drain timer too');
});

test("Rapid Restore's own overlay timer starts, restarts on its restore and stops", (t) => {
  const f = fixture(t);
  f.run(0, 0);
  f.player.setPrayerActive(PrayerHandler.RAPID_RESTORE, true);
  f.run(1, 101);
  f.player.setPrayerActive(PrayerHandler.RAPID_RESTORE, false);
  f.run(102, 102);
  assert.deepEqual(f.scripts.filter((args) => args[1] === 1), [[4517, 1, 100, 100], [4517, 1, 100, 100], [4517, 1, 0, 0]],
    'switched on at 1, its restore at 101, switched off at 102');
});
