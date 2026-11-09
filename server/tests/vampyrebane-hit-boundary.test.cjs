// Run after `yarn build`: node --test tests/vampyrebane-hit-boundary.test.cjs
// An area hit's secondary victim, through the real hit boundary (rollHitDamage, specialRolls and the
// per-cycle roll cache), with real NPC definitions and the attacker's combat target on the other NPC.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { BonusManager } = require("../dist/game/model/equipment/BonusManager");

const GOBLIN = 3029, VYREWATCH = 3717;
const IVANDIS_FLAIL = 22398, RUNE_SCIMITAR = 1333, EFARITAYS_AID = 21140;

let core, rolledMax, index = 1650;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  PluginManager.emitServerStartup({});
  PluginManager.createApi("VampyrebaneHitBoundaryTest").onCustomEvent("combat:hit-rolled", (e) => { rolledMax = e.maximum; });
});
after(() => PluginManager.emitServerShutdown({}));

function fixture(t, weapon) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++);
  player.setUsername("vampyrebound" + index);
  player.setLocation(new core.Location(3600, 3200, 0));
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH]) player.getSkillManager().setMaxLevel(skill, 70).setCurrentLevel(skill, 70, false);
  const items = player.getEquipment().getItems();
  items[core.Equipment.WEAPON_SLOT] = new core.Item(weapon);
  items[core.Equipment.RING_SLOT] = new core.Item(EFARITAYS_AID);
  BonusManager.update(player);
  const goblin = new NPC(GOBLIN, new core.Location(3601, 3200, 0));
  const vyrewatch = new NPC(VYREWATCH, new core.Location(3600, 3201, 0));
  assert.equal(goblin.getCurrentDefinition().getName(), "Goblin");
  assert.equal(vyrewatch.getCurrentDefinition().getName(), "Vyrewatch");
  t.after(() => core.TaskManager.cancelTasks(player.getIndex()));
  return { player, goblin, vyrewatch };
}

/** The attack roll and max hit against `victim`, while `primary` stays the combat target. */
function roll(player, primary, victim) {
  player.getCombat().setTarget(primary);
  const attack = AccuracyFormulasDpsCalc.specialRolls(player, victim, core.CombatType.MELEE).attack;
  const random = Math.random;
  rolledMax = undefined;
  try {
    Math.random = () => 0;
    CombatFactory.rollHitDamage(player, victim, core.CombatType.MELEE, true, undefined, false, false);
  } finally {
    Math.random = random;
  }
  return { attack, max: rolledMax };
}

test("an Ivandis flail with Efaritay's aid rolls each victim's own accuracy and max hit, in either primary order", (t) => {
  const { player, goblin, vyrewatch } = fixture(t, IVANDIS_FLAIL);
  const alone = { goblin: roll(player, goblin, goblin), vyrewatch: roll(player, vyrewatch, vyrewatch) };
  assert.ok(alone.vyrewatch.attack > alone.goblin.attack, "Efaritay's aid raises the flail's accuracy on a vampyre");
  assert.ok(alone.vyrewatch.max > alone.goblin.max, "the flail's vampyrebane bonus raises its max hit");

  // Alternate victims within one cycle, so a cached roll for the other victim would show.
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(roll(player, goblin, vyrewatch), alone.vyrewatch, "Vyrewatch secondary under a Goblin primary");
    assert.deepEqual(roll(player, vyrewatch, goblin), alone.goblin, "Goblin secondary under a Vyrewatch primary");
  }
});

test("a rune scimitar does nothing to a Vyrewatch secondary and full damage to a Goblin secondary", (t) => {
  const { player, goblin, vyrewatch } = fixture(t, RUNE_SCIMITAR);
  assert.equal(roll(player, goblin, vyrewatch).max, 0);
  const goblinMax = roll(player, goblin, goblin).max;
  assert.ok(goblinMax > 0);
  assert.equal(roll(player, vyrewatch, goblin).max, goblinMax);
});
