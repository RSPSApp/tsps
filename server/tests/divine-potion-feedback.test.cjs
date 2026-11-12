// Run after `yarn build`: node --test tests/divine-potion-feedback.test.cjs
// Every divine potion's drink: 10 damage as a real hit (hitsplat, hurt voice), the electric shock
// graphic, and the locked Attack level kept for divineattack_potion_base.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const c = PluginManager.getCoreApi();
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { encodeSound } = require("../dist/net/protocol/ClientProtocol");
const Potions = require("../plugins/items/Potions.plugin");

before(async () => {
  await c.CachePipeline.initialize(path.resolve(__dirname, ".."));
  const api = PluginManager.createApi("DivinePotionFeedbackTest");
  require("../plugins/combat/PlayerHitSounds.plugin").register({ ...api, onServerStartup: (fn) => fn() });
  Potions.register(new Proxy({}, { get: (_, key) => (key === "core" ? c : () => {}) }));
});

const I = c.ItemIdentifiers;
const DIVINES = {
  "super attack": [I.DIVINE_SUPER_ATTACK_POTION_4_, true],
  "super strength": [I.DIVINE_SUPER_STRENGTH_POTION_4_, false],
  "super defence": [I.DIVINE_SUPER_DEFENCE_POTION_4_, false],
  ranging: [I.DIVINE_RANGING_POTION_4_, false],
  magic: [I.DIVINE_MAGIC_POTION_4_, false],
  bastion: [I.DIVINE_BASTION_POTION_4_, false],
  battlemage: [I.DIVINE_BATTLEMAGE_POTION_4_, false],
  "super combat": [I.DIVINE_SUPER_COMBAT_POTION_3_, true],
};
let nextIndex = 2400;

function drinker(t, hitpoints = 99) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new c.Location(3222, 3218));
  const frames = [];
  p.setIndex(nextIndex++); p.setUsername("divine" + p.getIndex()); p.setRegistered(true); p.setNeedsPlacement(false);
  for (const skill of c.Skill.values()) { p.getSkillManager().setMaxLevel(skill, 99); p.getSkillManager().setCurrentLevels(skill, 99); }
  p.setHitpoints(hitpoints);
  p.getAppearance().setLook(c.Appearance.GENDER, 0);
  p.getSession().sendClientPacket = (frame) => { if (frame[0] === 131) frames.push(Buffer.from(frame)); return true; };
  t.after(() => { p.setRegistered(false); p.getCombat().getHitQueue().clear(); });
  return { p, frames };
}

for (const [name, [itemId, locksAttack]] of Object.entries(DIVINES)) {
  test(`divine ${name}: a 10 hitsplat with the hurt voice under the electric shock`, (t) => {
    t.mock.method(c.Misc, "getRandom", () => 2);
    const { p, frames } = drinker(t);
    Potions._test.findPotionEntry(itemId).potion.effect(p);
    assert.equal(p.getGraphic()?.getId(), 560, "skeleton_killerwatt_electricshock");
    assert.equal(p.getHitpoints(), 99, "the damage lands with the hit, not before");
    c.World.processCycle++;
    p.getCombat().getHitQueue().process(c.World.processCycle);
    assert.equal(p.getHitpoints(), 89);
    assert.deepEqual(p.getTickHits().map((hit) => hit.getDamage()), [10], "one hitsplat of 10");
    assert.deepEqual(frames, [encodeSound(520, { loops: 1, delay: 20 })], "one of the hurt voices, to the drinker");
    const attack = p.getAttribute("potions:divine:state").targets.find((entry) => entry.skillIndex === c.Skill.ATTACK.getIndex());
    assert.equal(attack?.base, locksAttack ? 118 : undefined, "the locked Attack level, for divineattack_potion_base");
  });
}

test("a body type B drinker hears type B's voice", (t) => {
  t.mock.method(c.Misc, "getRandom", () => 0);
  const { p, frames } = drinker(t);
  p.getAppearance().setLook(c.Appearance.GENDER, 1);
  Potions._test.divineShock(p);
  c.World.processCycle++;
  p.getCombat().getHitQueue().process(c.World.processCycle);
  assert.deepEqual(frames, [encodeSound(509, { loops: 1, delay: 20 })]);
});

test("the potion still needs more than 10 Hitpoints", (t) => {
  const { p } = drinker(t, 10);
  const potion = Potions._test.findPotionEntry(I.DIVINE_SUPER_COMBAT_POTION_4_).potion;
  assert.equal(potion.canUse(p), false);
  p.setHitpoints(11);
  assert.equal(potion.canUse(p), true);
});

test("an enemy hit already on its way doesn't stop the drink", (t) => {
  const { p } = drinker(t, 40);
  p.getCombat().getHitQueue().addPendingDamage([new c.HitDamage(35, c.HitMask.RED)]);
  assert.equal(Potions._test.findPotionEntry(I.DIVINE_SUPER_COMBAT_POTION_4_).potion.canUse(p), true);
});

test("a second divine dose before the first one's hit lands counts that hit (chugging barrel)", (t) => {
  const { p } = drinker(t, 15);
  const potion = Potions._test.findPotionEntry(I.DIVINE_SUPER_COMBAT_POTION_4_).potion;
  assert.equal(potion.canUse(p), true);
  potion.effect(p);
  assert.equal(potion.canUse(p), false, "5 Hitpoints after the pending 10");
  c.World.processCycle++;
  p.getCombat().getHitQueue().process(c.World.processCycle);
  assert.equal(p.getHitpoints(), 5);
});
