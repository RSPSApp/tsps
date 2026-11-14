// Run after `yarn build`: node --test tests/necklace-of-faith.test.cjs
// Wiki (Necklace of faith): below 20% Hitpoints it restores 25% of the Prayer level and degrades to
// dust; a hit from above 20% straight to 0 does nothing; with Redemption the restored points are
// used up by Redemption. rsprox captures (rsprox.net recording 3167, ticks 192-193): the message,
// the emptied amulet slot. Real Players, real hits through Mobile.decrementHealth.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { PrayerHandler } = require("../dist/game/content/PrayerHandler");

const NECKLACE_OF_FAITH = 21157;
const PHOENIX_NECKLACE = 11090;
const MESSAGE = "Your necklace of faith restores some prayer, but is destroyed in the process.";

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/items/NecklaceOfFaith.plugin").register(PluginManager.createApi("NecklaceOfFaithTest"));
});

function wearer(t, { hp = 99, prayer = 0, prayerLevel = 87, amulet = NECKLACE_OF_FAITH } = {}) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("faithtest");
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  const skills = p.getSkillManager();
  skills.setMaxLevels(core.Skill.HITPOINTS, 99, false);
  skills.setCurrentLevel(core.Skill.HITPOINTS, hp, false);
  skills.setMaxLevels(core.Skill.PRAYER, prayerLevel, false);
  skills.setCurrentLevel(core.Skill.PRAYER, prayer, false);
  if (amulet > 0) p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(amulet, 1));
  t.after(() => core.TaskManager.cancelTasks(p));
  return {
    p,
    messages,
    hit: (damage) => p.decrementHealth(new HitDamage(damage, HitMask.RED)),
    prayer: () => skills.getCurrentLevel(core.Skill.PRAYER),
    amulet: () => p.getEquipment().getItems()[core.Equipment.AMULET_SLOT]?.getId?.() ?? -1,
  };
}

test("a hit to 19 of 99 restores 25% of the Prayer level and the necklace crumbles", (t) => {
  const w = wearer(t, { hp: 29 });
  w.hit(10);
  assert.equal(w.p.getHitpoints(), 19);
  assert.equal(w.prayer(), 21, "floor(87 * 25%)");
  assert.equal(w.amulet(), -1, "the amulet slot is emptied");
  assert.deepEqual(w.messages, [MESSAGE]);
});

test("20 of 99 and above leave it worn; it only fires once", (t) => {
  const healthy = wearer(t, { hp: 30 });
  healthy.hit(10);
  assert.equal(healthy.p.getHitpoints(), 20, "20 is not below 19.8");
  assert.equal(healthy.amulet(), NECKLACE_OF_FAITH);
  assert.equal(healthy.prayer(), 0);
  healthy.hit(5);
  assert.equal(healthy.amulet(), -1);
  assert.equal(healthy.prayer(), 21);
  healthy.hit(5);
  assert.equal(healthy.prayer(), 21, "gone after one use");
  assert.equal(healthy.messages.length, 1);
});

test("a hit from above 20% straight to 0 does nothing", (t) => {
  const w = wearer(t, { hp: 50 });
  w.hit(60);
  assert.equal(w.p.getHitpoints(), 0);
  assert.equal(w.amulet(), NECKLACE_OF_FAITH);
  assert.equal(w.prayer(), 0);
  assert.deepEqual(w.messages, []);
});

test("the restore is capped at the Prayer level, and never lowers boosted prayer", (t) => {
  const nearlyFull = wearer(t, { hp: 29, prayer: 80 });
  nearlyFull.hit(10);
  assert.equal(nearlyFull.prayer(), 87);
  assert.equal(nearlyFull.amulet(), -1);
  const boosted = wearer(t, { hp: 29, prayer: 92 });
  boosted.hit(10);
  assert.equal(boosted.prayer(), 92);
});

test("another necklace, or none, is left alone", (t) => {
  const bare = wearer(t, { hp: 29, amulet: -1 });
  bare.hit(10);
  assert.equal(bare.prayer(), 0);
  assert.deepEqual(bare.messages, []);
  const other = wearer(t, { hp: 29, amulet: PHOENIX_NECKLACE });
  other.hit(25);
  assert.equal(other.prayer(), 0);
});

test("with Redemption active the necklace fires first and Redemption drains what it restored", (t) => {
  const w = wearer(t, { hp: 50, prayer: 10 });
  w.p.getPrayerActive()[PrayerHandler.REDEMPTION] = true;
  w.hit(45);
  assert.equal(w.amulet(), -1, "the necklace went first");
  assert.equal(w.prayer(), 31, "10 + 21 restored");
  CombatFactory.handleRedemption(w.p);
  assert.equal(w.prayer(), 0, "Redemption drains it all");
  assert.equal(w.p.getHitpoints(), 5 + 21, "Redemption heals a quarter of the Prayer level");
});
