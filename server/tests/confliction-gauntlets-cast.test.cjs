// Run after `yarn build`: node --test tests/confliction-gauntlets-cast.test.cjs
// The confliction gauntlets' passive on real casts (MagicCombatMethod.hits with a real Player and NPC):
// a splash on the combat target makes the next cast of that spell roll accuracy a second time.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { MagicCombatMethod } = require("../dist/game/content/combat/method/impl/MagicCombatMethod");
const registerGauntlets = require("../plugins/combat/effects/ConflictionGauntlets.EquipmentEffects");
const core = PluginManager.getCoreApi();


before(async () => {
  await CachePipeline.initialize(process.cwd());
  // Runs before the passive: forces the first accuracy roll's outcome. "splash" can never be beaten by a
  // second roll; "beatable" is a miss any second attack roll beats.
  PluginManager.createApi("ConflictionCastTest").onCustomEvent("combat:accuracy-rolled", (rolled) => {
    const mode = rolled.attacker.getAttribute?.("confliction-test:roll");
    if (mode === "splash") { rolled.accurate = false; rolled.defenceRolled = Number.MAX_SAFE_INTEGER; }
    if (mode === "beatable") { rolled.accurate = false; rolled.defenceRolled = -1; }
  });
  registerGauntlets(PluginManager.createApi("ConflictionGauntletsUnderTest"));
});

function caster(t, { hands = ItemIdentifiers.CONFLICTION_GAUNTLETS, weapon = ItemIdentifiers.KODAI_WAND } = {}) {
  const p = new Player(null);
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write() {} }));
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99).setCurrentLevels(core.Skill.MAGIC, 99, false);
  p.setLocation(new core.Location(3200, 3200, 0));
  t.mock.method(core.Sounds, "sendSound", () => {});
  const items = p.getEquipment().getItems();
  items[Equipment.HANDS_SLOT] = new core.Item(hands, 1);
  items[Equipment.WEAPON_SLOT] = new core.Item(weapon, 1);
  return p;
}

function npc(t) {
  const definition = Object.assign(new NpcDefinition(), { stats: new Array(5).fill(1) });
  const value = new NPC(1, new core.Location(3201, 3200, 0));
  t.mock.method(value, "getCurrentDefinition", () => definition);
  return value;
}

function cast(p, target, spell, mode) {
  p.setAttribute("confliction-test:roll", mode);
  p.getCombat().setTarget(target);
  p.getCombat().setCastSpell(spell);
  return new MagicCombatMethod().hits(p, target)[0].isAccurate();
}

test("a splash on the target makes the next cast of the spell roll a second time", (t) => {
  const p = caster(t);
  const target = npc(t);
  assert.equal(cast(p, target, core.CombatSpells.FIRE_SURGE, "beatable"), false, "no miss before it: one roll");
  assert.equal(cast(p, target, core.CombatSpells.FIRE_SURGE, "beatable"), true, "after the miss: the second roll lands");
  assert.equal(cast(p, target, core.CombatSpells.FIRE_SURGE, "beatable"), false, "after a landed cast: one roll again");
});

test("another spell after the splash rolls once", (t) => {
  const p = caster(t);
  const target = npc(t);
  cast(p, target, core.CombatSpells.FIRE_SURGE, "splash");
  assert.equal(cast(p, target, core.CombatSpells.WIND_SURGE, "beatable"), false);
});

test("the tormented bracelet, or a two-handed staff, has no passive", (t) => {
  const target = npc(t);
  const twoHanded = ItemIdentifiers.TUMEKENS_SHADOW;
  for (const p of [caster(t, { hands: ItemIdentifiers.TORMENTED_BRACELET }), caster(t, { weapon: twoHanded })]) {
    cast(p, target, core.CombatSpells.FIRE_SURGE, "splash");
    assert.equal(cast(p, target, core.CombatSpells.FIRE_SURGE, "beatable"), false);
  }
});
