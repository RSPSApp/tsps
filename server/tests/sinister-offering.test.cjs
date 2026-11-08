// Run after `yarn build`: node --test tests/sinister-offering.test.cjs
// Wiki (Sinister Offering): up to three bones at 300% of their burying experience - bones 40.5 a cast, not 45 - from
// its table (wyrm, drake, hydra, superior dragon, monkey and frost dragon bones included; long and curved bones not
// since 2023). One prayer point a set, two for ourg, dagannoth, hydra and superior dragon bones, and 70 Prayer only to
// offer superior dragon bones. Real Player and inventory.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { ArceuusOfferings } = require("../dist/game/content/combat/magic/ArceuusOfferings");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.EXPERIENCE_MULTIPLIER = 1;
});

function caster(prayer = 99, bones = []) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("sinister");
  p.getSkillManager().setMaxLevels(core.Skill.PRAYER, prayer, false).setCurrentLevels(core.Skill.PRAYER, 1, false);
  bones.forEach((id, slot) => p.getInventory().setItem(slot, new core.Item(id, 1)));
  return p;
}
const prayerXp = (p) => p.getSkillManager().skills.experience[core.Skill.PRAYER.getIndex()];

test("three bones give 40.5 and three hydra bones restore two points each", () => {
  const I = core.ItemIdentifiers;
  const bones = caster(99, [I.BONES, I.BONES, I.BONES]);
  assert.equal(ArceuusOfferings.sinister(bones), true);
  assert.equal(prayerXp(bones), 40.5);
  assert.equal(bones.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 4, "1 + one a bone");
  const hydra = caster(99, [I.HYDRA_BONES, I.HYDRA_BONES, I.HYDRA_BONES]);
  ArceuusOfferings.sinister(hydra);
  assert.equal(prayerXp(hydra), 990);
  assert.equal(hydra.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 7, "1 + two a hydra bone");
});

test("the table's newer bones are offered; long and curved bones and noted wyvern bones are not", () => {
  const I = core.ItemIdentifiers;
  for (const [id, xp] of [[I.WYRM_BONES, 150], [I.DRAKE_BONES, 240], [I.MONKEY_BONES, 15], [I.FROST_DRAGON_BONES, 300], [I.WYVERN_BONES, 216]]) {
    const p = caster(99, [id]);
    assert.equal(ArceuusOfferings.sinister(p), true, `${id}`);
    assert.equal(prayerXp(p), xp, `${id}`);
  }
  for (const id of [I.LONG_BONE, I.CURVED_BONE, 6816]) assert.equal(ArceuusOfferings.sinister(caster(99, [id])), false, `${id}`);
});

test("70 Prayer is needed for superior dragon bones only", () => {
  const I = core.ItemIdentifiers;
  assert.equal(ArceuusOfferings.sinisterRefusal(caster(60, [I.SUPERIOR_DRAGON_BONES])), "You require a Prayer level of 70 to do that.");
  const mixed = caster(60, [I.SUPERIOR_DRAGON_BONES, I.BONES]);
  assert.equal(ArceuusOfferings.sinisterRefusal(mixed), null, "the spell itself needs no 70 Prayer");
  ArceuusOfferings.sinister(mixed);
  assert.equal(mixed.getInventory().getAmount(I.SUPERIOR_DRAGON_BONES), 1, "the superior bone is kept");
  assert.equal(prayerXp(mixed), 13.5);
  const high = caster(70, [I.SUPERIOR_DRAGON_BONES]);
  ArceuusOfferings.sinister(high);
  assert.equal(prayerXp(high), 450);
});

test("Demonic Offering pays its ashes too: three infernal ashes give 990 and six prayer points", () => {
  const I = core.ItemIdentifiers;
  const p = caster(99, [I.INFERNAL_ASHES, I.INFERNAL_ASHES, I.INFERNAL_ASHES]);
  assert.equal(ArceuusOfferings.demonic(p), true);
  assert.equal(prayerXp(p), 990, "300% of 110 each");
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 7);
});
