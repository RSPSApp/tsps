// Run after `yarn build`: node --test tests/redemption-sounds.test.cjs
// The Redemption prayer's two sounds, each at its own moment:
//   2680 (redemption)       on switching the prayer on. It is a 97 Hz bass tone, in the cache and
//                           in the OSRS Wiki's recording alike, so small speakers do not play it.
//   2681 (redemption_heal)  when the prayer heals: with the heal and its graphic (436), once.
// Real Players, real hits through the HitQueue's own apply path.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { PrayerHandler } = require("../dist/game/content/PrayerHandler");
const { Sound } = require("../dist/game/Sound");

const ACTIVATION = 2680;
const HEAL = 2681;
const TURN_OFF = 2663;
const HEAL_GRAPHIC = 436;

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

function praying(t, { hp = 99, prayer = 60, prayerLevel = 80 } = {}) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("redemptiontest");
  p.sendMessage = () => {};
  const skills = p.getSkillManager();
  skills.setMaxLevels(core.Skill.HITPOINTS, 99, false);
  skills.setCurrentLevel(core.Skill.HITPOINTS, hp, false);
  skills.setMaxLevels(core.Skill.PRAYER, prayerLevel, false);
  skills.setCurrentLevel(core.Skill.PRAYER, prayer, false);
  // What the player hears and sees, in the order it is sent.
  const heard = [];
  p.getPacketSender().sendSoundEffect = (id, _loops, delay) => { heard.push({ id, delay }); return p.getPacketSender(); };
  const graphics = [];
  const perform = p.performGraphic.bind(p);
  p.performGraphic = (graphic) => { graphics.push({ id: graphic.getId(), hp: p.getHitpoints(), heard: heard.length }); return perform(graphic); };
  t.after(() => core.TaskManager.cancelTasks(p));
  return {
    p, heard, graphics,
    ids: () => heard.map((sound) => sound.id),
    count: (id) => heard.filter((sound) => sound.id === id).length,
    hit: (damage) => p.getCombat().getHitQueue().applyDamage(new HitDamage(damage, HitMask.RED)),
    prayer: () => skills.getCurrentLevel(core.Skill.PRAYER),
  };
}

test("the two sounds are the cache's redemption and redemption_heal", () => {
  assert.equal(Sound.PRAYER_REDEMPTION.getId(), ACTIVATION);
  assert.equal(Sound.PRAYER_REDEMPTION_HEAL.getId(), HEAL);
});

test("switching Redemption on plays 2680 once, and not the heal sound", (t) => {
  const w = praying(t);
  PrayerHandler.activatePrayerPrayerId(w.p, PrayerHandler.REDEMPTION);
  assert.equal(w.p.getPrayerActive()[PrayerHandler.REDEMPTION], true, "the prayer is on");
  assert.deepEqual(w.ids(), [ACTIVATION]);
});

test("the heal plays 2681 once, with the graphic and the heal, on the hit that triggers it", (t) => {
  const w = praying(t, { hp: 30, prayer: 40, prayerLevel: 80 });
  w.p.getPrayerActive()[PrayerHandler.REDEMPTION] = true;

  w.hit(10); // 20 of 99: not under a tenth
  assert.deepEqual(w.ids(), [], "no sound while the prayer has not healed");
  assert.deepEqual(w.graphics, []);

  w.hit(12); // 8 of 99: under a tenth
  assert.equal(w.p.getHitpoints(), 8 + 20, "a quarter of the Prayer level is healed");
  assert.equal(w.prayer(), 0);
  assert.equal(w.count(HEAL), 1);
  assert.equal(w.count(ACTIVATION), 0, "the switch-on sound is not played again");
  assert.deepEqual(w.graphics.map((graphic) => graphic.id), [HEAL_GRAPHIC]);
  assert.equal(w.heard[0].id, HEAL, "the heal sound comes first, beside its graphic");
  assert.equal(w.heard[0].delay, 0, "and is not delayed");
  assert.equal(w.graphics[0].heard, 0, "nothing was played before the graphic");

  w.hit(1);
  assert.equal(w.count(HEAL), 1, "the prayer is off now: no second heal sound");
});

test("the prayers that were on go off with one sound, not one each", (t) => {
  const w = praying(t, { hp: 12, prayer: 40 });
  for (const prayer of [PrayerHandler.REDEMPTION, PrayerHandler.PIETY, PrayerHandler.PROTECT_ITEM]) w.p.getPrayerActive()[prayer] = true;
  w.hit(5);
  assert.deepEqual(w.ids(), [HEAL, TURN_OFF]);
  assert.ok(!w.p.getPrayerActive().some(Boolean), "every prayer is off");
});

test("a hit that kills plays nothing: Redemption cannot save from it", (t) => {
  const w = praying(t, { hp: 12, prayer: 40 });
  w.p.getPrayerActive()[PrayerHandler.REDEMPTION] = true;
  w.hit(12);
  assert.equal(w.count(HEAL), 0);
  assert.deepEqual(w.graphics, []);
});

test("without the prayer on nothing plays under a tenth", (t) => {
  const w = praying(t, { hp: 12, prayer: 40 });
  w.hit(5);
  assert.deepEqual(w.ids(), []);
});
