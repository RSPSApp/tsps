// Run after `yarn build`: node --test tests/bloodbark-armour.test.cjs
// Bloodbark armour (Wiki: Bloodbark armour): each worn piece adds 2% of the damage to a Blood
// spell's 25% heal (35% with the set, 38.5% with an Ancient sceptre). Mod Ash: the 1/4 rounds
// down first, then the bloodbark scale applies.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");

let core, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

const SET = () => [
  [core.Equipment.HEAD_SLOT, I.BLOODBARK_HELM], [core.Equipment.BODY_SLOT, I.BLOODBARK_BODY],
  [core.Equipment.LEG_SLOT, I.BLOODBARK_LEGS], [core.Equipment.HANDS_SLOT, I.BLOODBARK_GAUNTLETS],
  [core.Equipment.FEET_SLOT, I.BLOODBARK_BOOTS],
];

function player({ weapon = I.ANCIENT_STAFF, pieces = 5, hitpoints = 99, current = 50 } = {}) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("bloodbark");
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, hitpoints, false).setCurrentLevels(core.Skill.HITPOINTS, current, false);
  p.setSpellbook(core.MagicSpellbook.ANCIENT);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  for (const [slot, id] of SET().slice(0, pieces)) p.getEquipment().setItem(slot, new core.Item(id, 1));
  WeaponInterfaceManager.assign(p);
  return p;
}

/** Registers the plugins under test and routes the core's custom events to them, in the given order. */
function plugins(t, { sceptreFirst = false } = {}) {
  const handlers = new Map();
  const api = { core, onCustomEvent: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]), registerMagicAccuracyPercentModifier() {} };
  const sceptre = () => require("../plugins/items/AncientSceptre.plugin").register(api);
  const bloodbark = () => require("../plugins/combat/effects/BloodbarkArmour.EquipmentEffects")(api);
  if (sceptreFirst) { sceptre(); bloodbark(); } else { bloodbark(); sceptre(); }
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => (handlers.get(name) ?? []).forEach((fn) => fn(event)));
}

const npc = () => ({ isPlayer: () => false, isNpc: () => true });
const hit = (cast, damage, accurate = true) => ({
  isAccurate: () => accurate, getAttacker: () => cast, getTarget: () => npc(), getTotalDamage: () => damage,
});

test("the cache names the bloodbark pieces", () => {
  for (const [, id] of SET()) assert.match(ItemDefinition.forId(id).getName(), /^Bloodbark /);
});

test("each worn piece scales a Blood spell's heal by 2% of the damage, after the quarter rounds down", (t) => {
  plugins(t);
  // 40 damage: base 10; pieces 0..5 heal floor(10 × (25 + 2n) / 25) = 10, 10, 11, 12, 13, 14.
  [10, 10, 11, 12, 13, 14].forEach((heal, pieces) => {
    const p = player({ pieces });
    core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 40));
    assert.equal(p.getHitpoints(), 50 + heal, `${pieces} pieces`);
  });
  // 15 damage: the quarter rounds to 3 first, so the set heals floor(3 × 1.4) = 4, not floor(15 × 0.35) = 5.
  const p = player();
  core.CombatSpells.BLOOD_RUSH.onHitCalc(hit(p, 15));
  assert.equal(p.getHitpoints(), 54);
  // Every Blood spell gets it; a miss heals nothing.
  for (const spell of ["BLOOD_RUSH", "BLOOD_BURST", "BLOOD_BLITZ", "BLOOD_BARRAGE"]) {
    const q = player();
    core.CombatSpells[spell].onHitCalc(hit(q, 20)); // floor(5 × 1.4) = 7
    assert.equal(q.getHitpoints(), 57, spell);
  }
  const missed = player();
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(missed, 0, false));
  assert.equal(missed.getHitpoints(), 50);
});

test("the heal stops at the Hitpoints level and never lowers a boost", (t) => {
  plugins(t);
  const near = player({ current: 95 });
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(near, 40));
  assert.equal(near.getHitpoints(), 99);
  const brewed = player({ current: 110 });
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(brewed, 40));
  assert.equal(brewed.getHitpoints(), 110);
});

test("an Ancient sceptre scales the armour's total: 38.5% with the set", (t) => {
  plugins(t);
  // 40 damage: base floor(40 × 0.275) = 11, then floor(11 × 1.4) = 15.
  const p = player({ weapon: I.ANCIENT_SCEPTRE });
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 40));
  assert.equal(p.getHitpoints(), 65);
});

test("the blood ancient sceptre overheals by the armour's total, in either plugin order", (t) => {
  for (const sceptreFirst of [false, true]) {
    plugins(t, { sceptreFirst });
    // 99 + floor(floor(20 × 0.275) × 1.4) = 99 + 7.
    const p = player({ weapon: I.BLOOD_ANCIENT_SCEPTRE_2, current: 99 });
    core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 20));
    assert.equal(p.getHitpoints(), 106, `sceptreFirst=${sceptreFirst}`);
    // Below full the whole heal lands once, not twice.
    const low = player({ weapon: I.BLOOD_ANCIENT_SCEPTRE_2, current: 80 });
    core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(low, 40)); // floor(11 × 1.4) = 15
    assert.equal(low.getHitpoints(), 95, `low sceptreFirst=${sceptreFirst}`);
    t.mock.restoreAll();
  }
});

test("other spells get nothing from the armour", (t) => {
  plugins(t);
  const p = player({ current: 90 });
  core.CombatSpells.ICE_BARRAGE.onHitCalc({ ...hit(p, 40), getTarget: () => ({ isPlayer: () => false, getTimers: () => ({ has: () => true }) }) });
  assert.equal(p.getHitpoints(), 90);
});

test("Zuriel's staff's 50% scales the armour's total: 52.5% with the set", (t) => {
  const handlers = new Map();
  const api = {
    core, onCustomEvent: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    onAttackSpeed() {}, registerMagicAccuracyPercentModifier() {},
  };
  require("../plugins/combat/effects/BloodbarkArmour.EquipmentEffects")(api);
  require("../plugins/items/ZurielsStaff.plugin").register(api);
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => (handlers.get(name) ?? []).forEach((fn) => fn(event)));
  // 40 damage: base floor(40 × 0.375) = 15, then floor(15 × 1.4) = 21.
  const p = player({ weapon: I.ZURIELS_STAFF_BH_ });
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 40));
  assert.equal(p.getHitpoints(), 71);
});

test("without EquipmentEffects registered, the blood sceptre's overheal gets no armour scale", (t) => {
  const bloodbark = require("../plugins/combat/effects/BloodbarkArmour.EquipmentEffects");
  bloodbark._test.reset();
  t.after(() => bloodbark({ core, onCustomEvent() {} }));
  const handlers = new Map();
  require("../plugins/items/AncientSceptre.plugin").register({ core, onCustomEvent: (name, fn) => handlers.set(name, fn), registerMagicAccuracyPercentModifier() {} });
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => handlers.get(name)?.(event));
  const p = player({ weapon: I.BLOOD_ANCIENT_SCEPTRE_2, current: 80 });
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 40)); // floor(40 × 0.275) = 11, no armour
  assert.equal(p.getHitpoints(), 91);
});
