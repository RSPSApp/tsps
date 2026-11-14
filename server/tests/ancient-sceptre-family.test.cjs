// Run after `yarn build`: node --test tests/ancient-sceptre-family.test.cjs
// Wiki (Ancient sceptre; Blood/Ice/Smoke/Shadow ancient sceptre): the sceptre and its quartz upgrades autocast
// Ancient Magicks and raise the Ancient effects by 10%; the blood sceptre's Blood spells overheal up to 10% over
// base Hitpoints (99 -> 108). Real Players, the cache's ids and the real spell callbacks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");

let core, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

const QUARTZ = () => [
  [I.BLOOD_ANCIENT_SCEPTRE_2, "Blood ancient sceptre"], [I.BLOOD_ANCIENT_SCEPTRE_L_, "Blood ancient sceptre (l)"],
  [I.ICE_ANCIENT_SCEPTRE_2, "Ice ancient sceptre"], [I.ICE_ANCIENT_SCEPTRE_L_, "Ice ancient sceptre (l)"],
  [I.SMOKE_ANCIENT_SCEPTRE_2, "Smoke ancient sceptre"], [I.SMOKE_ANCIENT_SCEPTRE_L_, "Smoke ancient sceptre (l)"],
  [I.SHADOW_ANCIENT_SCEPTRE_2, "Shadow ancient sceptre"], [I.SHADOW_ANCIENT_SCEPTRE_L_, "Shadow ancient sceptre (l)"],
];

function player(t, weaponId, { spellbook = core.MagicSpellbook.ANCIENT, hitpoints = 99 } = {}) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("sceptre");
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, hitpoints, false).setCurrentLevels(core.Skill.HITPOINTS, hitpoints, false);
  p.setSpellbook(spellbook);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weaponId, 1));
  WeaponInterfaceManager.assign(p);
  const lines = [];
  t.mock.method(p, "sendMessage", (m) => lines.push(m));
  return { p, lines };
}

function sceptrePlugin(t) {
  const handlers = new Map();
  require("../plugins/items/AncientSceptre.plugin").register({ core, onCustomEvent: (name, fn) => handlers.set(name, fn) });
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => handlers.get(name)?.(event));
}

const npc = () => ({ isPlayer: () => false, isNpc: () => true });
const hit = (cast, damage, accurate = true) => ({
  isAccurate: () => accurate, getAttacker: () => cast, getTarget: () => npc(), getTotalDamage: () => damage,
});

test("the cache names the quartz sceptres' ids, and each is wieldable", () => {
  for (const [id, name] of QUARTZ()) {
    assert.equal(ItemDefinition.forId(id).getName(), name, String(id));
    assert.ok(Autocasting.ancientSceptres().includes(id), name);
  }
  assert.ok(Autocasting.ancientSceptres().includes(I.ANCIENT_SCEPTRE));
  assert.ok(Autocasting.ancientSceptres().includes(I.ANCIENT_SCEPTRE_L_));
});

test("every Ancient sceptre autocasts Ancient Magicks from the Ancient staff's list", (t) => {
  const staff = player(t, I.ANCIENT_STAFF).p;
  Autocasting.handleWidgetAction(staff, 593, 23);
  Autocasting.handleWidgetAction(staff, 201, 1, 34);
  const expected = staff.getCombat().getAutocastSpell();
  assert.ok(expected, "the Ancient staff picks an Ancient spell from slot 34");
  for (const id of [I.ANCIENT_SCEPTRE, I.ANCIENT_SCEPTRE_L_, ...QUARTZ().map(([q]) => q)]) {
    const { p, lines } = player(t, id);
    Autocasting.handleWidgetAction(p, 593, 23);
    Autocasting.handleWidgetAction(p, 201, 1, 34);
    assert.deepEqual(lines, [], `${id}: no refusal`);
    assert.equal(p.getCombat().getAutocastSpell(), expected, `${id}: the staff's slot 34 spell`);
  }
  // Standard spells stay castable with a sceptre (only the Ancient staff refuses them).
  const { p, lines } = player(t, I.BLOOD_ANCIENT_SCEPTRE_2, { spellbook: core.MagicSpellbook.NORMAL });
  Autocasting.handleWidgetAction(p, 593, 23);
  assert.deepEqual(lines, []);
});

test("the quartz sceptres raise the Ancient effects by 10%; other staves don't", (t) => {
  sceptrePlugin(t);
  for (const [id, enhanced] of [...QUARTZ().map(([q]) => [q, true]), [I.ANCIENT_SCEPTRE, true], [I.ANCIENT_STAFF, false]]) {
    const { p } = player(t, id);
    for (const family of ["ICE", "SMOKE", "BLOOD", "SHADOW"]) {
      const spell = core.CombatSpells[`${family}_BARRAGE`];
      let multiplier = null;
      const effect = t.mock.method(spell, "spellEffectOnHitCalc", (_c, _t, _d, m) => { multiplier = m; });
      spell.onHitCalc(hit(p, 10));
      effect.mock.restore();
      assert.equal(multiplier, enhanced ? 1.1 : 1, `${id} ${family}`);
    }
  }
});

test("the blood ancient sceptre's Blood spells overheal to 110% of base Hitpoints", (t) => {
  sceptrePlugin(t);
  for (const id of [I.BLOOD_ANCIENT_SCEPTRE_2, I.BLOOD_ANCIENT_SCEPTRE_L_]) {
    const { p } = player(t, id);
    core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 20)); // heals floor(20 * 0.275) = 5
    assert.equal(p.getHitpoints(), 104, "99 + 5");
    core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 40)); // 11 more, capped at floor(99 * 1.1)
    assert.equal(p.getHitpoints(), 108, "capped at 108");
    core.CombatSpells.BLOOD_RUSH.onHitCalc(hit(p, 40));
    assert.equal(p.getHitpoints(), 108, "no further at the cap");
  }
  // Below full: the same heal runs on past the base cap.
  const { p: low } = player(t, I.BLOOD_ANCIENT_SCEPTRE_2);
  low.setHitpoints(95);
  core.CombatSpells.BLOOD_BLITZ.onHitCalc(hit(low, 40)); // 11
  assert.equal(low.getHitpoints(), 106);
  // A brew's boost above the cap is kept, not lowered.
  const { p: brewed } = player(t, I.BLOOD_ANCIENT_SCEPTRE_2);
  brewed.setHitpoints(115);
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(brewed, 40));
  assert.equal(brewed.getHitpoints(), 115);
  // A miss heals nothing.
  const { p: missed } = player(t, I.BLOOD_ANCIENT_SCEPTRE_2);
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(missed, 0, false));
  assert.equal(missed.getHitpoints(), 99);
});

test("other sceptres and non-Blood spells never overheal", (t) => {
  sceptrePlugin(t);
  for (const id of [I.ANCIENT_SCEPTRE, I.ICE_ANCIENT_SCEPTRE_2, I.SMOKE_ANCIENT_SCEPTRE_L_, I.SHADOW_ANCIENT_SCEPTRE_2, I.ANCIENT_STAFF]) {
    const { p } = player(t, id);
    core.CombatSpells.BLOOD_BARRAGE.onHitCalc(hit(p, 40));
    assert.equal(p.getHitpoints(), 99, String(id));
  }
  const { p } = player(t, I.BLOOD_ANCIENT_SCEPTRE_2);
  p.setHitpoints(90);
  core.CombatSpells.ICE_BARRAGE.onHitCalc({ ...hit(p, 40), getTarget: () => ({ isPlayer: () => false, getTimers: () => ({ has: () => true }) }) });
  assert.equal(p.getHitpoints(), 90, "Ice Barrage heals nothing");
});
