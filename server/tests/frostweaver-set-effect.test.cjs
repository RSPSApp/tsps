// node --test tests/frostweaver-set-effect.test.cjs
// Frostweaver (OSRS Wiki Blue Moon armour, set effects): full Blue Moon armour (broken pieces count) and the Blue Moon
// spear; a Bind/Snare/Entangle/Ancient ice cast has a 20% chance, an Arceuus grasp 50%, of an instant melee spear attack.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server"); Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(require("node:path").resolve(__dirname, "../plugins")); // the real loader: the unit is found, or absent
});

function fixture(t, spellName, { armour = "normal", weapon = "BLUE_MOON_SPEAR", roll = 0 } = {}) {
  t.mock.method(core.Sounds, "sendSound", () => {});
  t.mock.method(Math, "random", () => roll);
  const queued = [];
  t.mock.method(core.CombatFactory, "addPendingHit", (hit) => queued.push(hit));
  const p = new Player(null);
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true }));
  t.mock.method(p, "sendMessage", () => {});
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99);
  p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  const target = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3200, 3200));
  t.mock.method(target, "getHitpoints", () => 200);
  t.mock.method(target, "isRegistered", () => true);
  t.mock.method(p.getCombat(), "getTarget", () => target);
  const I = core.ItemIdentifiers, E = core.Equipment, items = p.getEquipment().getItems();
  const sets = { normal: ["", ""], broken: ["_BROKEN_", "_BROKEN_"], mixed: ["_6", "_BROKEN_"], missing: ["", ""], none: ["", ""] };
  const [a, b] = sets[armour];
  if (armour !== "none") {
    items[E.HEAD_SLOT] = new core.Item(I[`BLUE_MOON_HELM${a}`]);
    items[E.BODY_SLOT] = new core.Item(I[`BLUE_MOON_CHESTPLATE${b}`]);
    items[E.LEG_SLOT] = new core.Item(I[`BLUE_MOON_TASSETS${a}`]);
  }
  if (armour === "missing") items[E.LEG_SLOT] = new core.Item(-1);
  if (weapon) items[E.WEAPON_SLOT] = new core.Item(I[weapon]);
  const spell = core.CombatSpells[spellName];
  p.setSpellbook(spell.getSpellbook());
  p.getCombat().setCastSpell(spell);
  for (const rune of spell.itemsRequired(p)) p.getInventory().add(new core.Item(rune.getId(), rune.getAmount() * 10));
  return { p, target, spell, queued, cast: () => spell.canCast(p, true) };
}

function swings(f) {
  return f.queued.filter((h) => h.getAttacker() === f.p && h.getCombatType() === core.CombatType.MELEE);
}

test("a committed binding or ice cast in the full set with the spear queues one instant melee hit", (t) => {
  for (const name of ["BIND", "SNARE", "ENTANGLE", "ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"]) {
    const f = fixture(t, name);
    assert.equal(f.cast(), true, name);
    assert.equal(swings(f).length, 1, name);
  }
});

test("broken and mixed-tier pieces still count", (t) => {
  for (const armour of ["broken", "mixed"]) {
    const f = fixture(t, "BIND", { armour });
    assert.equal(f.cast(), true);
    assert.equal(swings(f).length, 1, armour);
  }
});

test("Arceuus grasps proc at 50%, the others at 20% (boundary rolls)", (t) => {
  for (const [name, chance] of [["GHOSTLY_GRASP", 0.5], ["SKELETAL_GRASP", 0.5], ["UNDEAD_GRASP", 0.5], ["BIND", 0.2], ["ICE_BARRAGE", 0.2]]) {
    for (const [roll, expected] of [[chance - 0.001, 1], [chance, 0]]) {
      const f = fixture(t, name, { roll });
      f.cast();
      assert.equal(swings(f).length, expected, `${name} roll ${roll}`);
    }
  }
});

test("a missing piece, no armour or another weapon gives no attack", (t) => {
  for (const options of [{ armour: "missing" }, { armour: "none" }, { weapon: null }, { weapon: "BLUE_MOON_SPEAR_4", armour: "missing" }]) {
    const f = fixture(t, "ENTANGLE", options);
    f.cast();
    assert.equal(swings(f).length, 0, JSON.stringify(options));
  }
});

test("other spells in the full set give no attack", (t) => {
  const f = fixture(t, "FIRE_STRIKE");
  f.cast();
  assert.equal(swings(f).length, 0);
});

test("an armed special is neither used nor spent by the attack", (t) => {
  const f = fixture(t, "BIND");
  f.p.setSpecialActivated(true);
  f.cast();
  assert.equal(swings(f).length, 1);
  assert.equal(f.p.isSpecialActivated(), true);
});
