// Run after `yarn build`: node --test tests/ranged-ammo-refusals.test.cjs
//
// The ammo refusals as recorded: a bow with an empty ammo slot, "There is no ammo left in your quiver."
// (rsprox_transcripts/229/02760.txt:7555, 227/00096.txt:101707); the wrong ammo, "You can't use that ammo with your
// bow." (227/00550.txt:395792) / "...with your crossbow." (230/00356.txt:8615), also for an ammo-slot item no launcher
// fires (237/01156.txt:729513, a crossbow with an Honourable blessing). Seeking arrows fire from their normal
// counterparts' bows (Wiki, Seeking arrows). A real Player and its equipment.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

let core, I;
before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
});

function archer(t, weapon, ammo = null) {
  const p = new Player(new BotPlayerSession());
  p.setUsername("archer");
  const messages = [];
  t.mock.method(p, "sendMessage", (m) => messages.push(m));
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  if (ammo) p.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new core.Item(ammo, 50));
  CombatFactory.getMethod(p);
  return { p, messages };
}

test("an empty ammo slot: 'There is no ammo left in your quiver.'", (t) => {
  const { p, messages } = archer(t, I.MAGIC_SHORTBOW);
  assert.equal(CombatFactory.checkAmmo(p, 1), false);
  assert.deepEqual([...new Set(messages)], ["There is no ammo left in your quiver."]);
});

test("the wrong ammo: 'You can't use that ammo with your bow.' / '...crossbow.'", (t) => {
  const bow = archer(t, I.OAK_SHORTBOW, I.RUNE_ARROW);
  assert.equal(CombatFactory.checkAmmo(bow.p, 1), false);
  assert.deepEqual([...new Set(bow.messages)], ["You can't use that ammo with your bow."]);
  const crossbow = archer(t, I.BRONZE_CROSSBOW, I.RUNITE_BOLTS);
  assert.equal(CombatFactory.checkAmmo(crossbow.p, 1), false);
  assert.deepEqual([...new Set(crossbow.messages)], ["You can't use that ammo with your crossbow."]);
});

test("the right ammo still fires", (t) => {
  const { p, messages } = archer(t, I.MAGIC_SHORTBOW, I.RUNE_ARROW);
  assert.equal(CombatFactory.checkAmmo(p, 1), true);
  assert.deepEqual(messages, []);
});

test("an ammo-slot item no launcher fires is the wrong ammo, not an empty quiver (237/01156.txt:729513)", (t) => {
  const cases = [
    [I.CROSSBOW, I.HONOURABLE_BLESSING, "crossbow"],
    [I.MAGIC_SHORTBOW, I.HOLY_BLESSING, "bow"],
    [I.MAPLE_SHORTBOW, I.BRONZE_FIRE_ARROW, "bow"], // unlit: only the lit ones (942) fire
    [I.MITHRIL_CROSSBOW, I.MITH_GRAPPLE_2, "crossbow"],
  ];
  for (const [weapon, ammo, launcher] of cases) {
    const { p, messages } = archer(t, weapon, ammo);
    assert.equal(CombatFactory.checkAmmo(p, 1), false, `${weapon} with ${ammo}`);
    assert.deepEqual([...new Set(messages)], [`You can't use that ammo with your ${launcher}.`], `${weapon} with ${ammo}`);
  }
});

test("seeking arrows fire from the bows their normal counterparts need (Wiki, Seeking arrows)", (t) => {
  assert.equal(core.Ammunition.getForItem(I.SEEKING_BRONZE_ARROW), core.Ammunition.BRONZE_ARROW);
  assert.equal(core.Ammunition.getForItem(I.SEEKING_BROAD_ARROWS), core.Ammunition.BROAD_ARROW);
  for (const [weapon, ammo] of [[I.SHORTBOW, I.SEEKING_BRONZE_ARROW], [I.OAK_SHORTBOW, I.SEEKING_STEEL_ARROW], [I.YEW_LONGBOW, I.SEEKING_RUNE_ARROW],
    [I.MAGIC_SHORTBOW, I.SEEKING_AMETHYST_ARROW], [I.MAGIC_SHORTBOW, I.SEEKING_BROAD_ARROWS]]) {
    const { p, messages } = archer(t, weapon, ammo);
    assert.equal(CombatFactory.checkAmmo(p, 1), true, `${weapon} fires ${ammo}`);
    assert.deepEqual(messages, []);
  }
  const low = archer(t, I.OAK_SHORTBOW, I.SEEKING_RUNE_ARROW);
  assert.equal(CombatFactory.checkAmmo(low.p, 1), false, "seeking rune arrows need a yew bow or better");
  assert.deepEqual([...new Set(low.messages)], ["You can't use that ammo with your bow."]);
});

test("every seeking arrow's successful hit is at least three (Wiki, Seeking arrows)", (t) => {
  let handler;
  require("../plugins/items/SeekingArrows.plugin").register({ core, onCombatHitDamage: (entry) => { handler = entry; } });
  const { p } = archer(t, I.SHORTBOW, I.SEEKING_BRONZE_ARROW);
  const damage = new core.HitDamage(1, core.HitMask.RED);
  handler({ attacker: p, damage, accurate: true, combatType: core.CombatType.RANGED });
  assert.equal(damage.getDamage(), 3);
  const plain = archer(t, I.SHORTBOW, I.BRONZE_ARROW);
  const normal = new core.HitDamage(1, core.HitMask.RED);
  handler({ attacker: plain.p, damage: normal, accurate: true, combatType: core.CombatType.RANGED });
  assert.equal(normal.getDamage(), 1, "a normal bronze arrow is untouched");
});

test("a seeking arrow only worn, not fired, gives no minimum: darts, a crystal bow; a quiver's fired seeking arrow does", (t) => {
  let handler;
  require("../plugins/items/SeekingArrows.plugin").register({ core, onCombatHitDamage: (entry) => { handler = entry; } });
  const land = (p) => {
    const damage = new core.HitDamage(1, core.HitMask.RED);
    handler({ attacker: p, damage, accurate: true, combatType: core.CombatType.RANGED });
    return damage.getDamage();
  };
  const darts = archer(t, I.RUNE_DART, I.SEEKING_BRONZE_ARROW);
  darts.p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(I.RUNE_DART, 100));
  CombatFactory.getMethod(darts.p);
  assert.equal(land(darts.p), 1, "rune darts with seeking arrows worn");
  assert.equal(land(archer(t, I.CRYSTAL_BOW, I.SEEKING_RUNE_ARROW).p), 1, "a crystal bow with seeking arrows worn");

  // Dizana's quiver firing its stored seeking arrows (the worn ammo doesn't fit the bow), and the reverse:
  // the worn normal arrows fit, so the quiver's seeking arrows are not what fires.
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/items/DizanasQuiver.plugin").register(PluginManager.createApi("DizanasQuiver"));
  const quivered = (worn) => {
    const f = archer(t, I.MAGIC_SHORTBOW, worn);
    f.p.getEquipment().setItem(Equipment.CAPE_SLOT, new core.Item(I.DIZANAS_QUIVER, 1));
    f.p.setAttribute("dizanas-quiver", { id: I.SEEKING_BRONZE_ARROW, amount: 50 });
    CombatFactory.getMethod(f.p);
    return f.p;
  };
  assert.equal(land(quivered(I.RUNITE_BOLTS)), 3, "the quiver fires its seeking arrows");
  assert.equal(land(quivered(I.RUNE_ARROW)), 1, "the worn rune arrows fire, not the quiver's seeking ones");
});
