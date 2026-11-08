// Run after `yarn build`: node --test tests/soulreaper-axe.test.cjs
// Soulreaper axe (Wiki, after the 22 July 2026 update): soul stacks add 6% Strength each, additive with
// Piety, up to five; Behead consumes them all for +12% accuracy, +6% max hit and a 6% minimum hit each.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { FightStyle } = require("../dist/game/content/combat/FightStyle");
const core = PluginManager.getCoreApi();
const { BonusManager, CombatSpecial, CombatType, DamageFormulas, Equipment, Item, ItemIdentifiers, PrayerHandler, Skill } = core;

const registerSoulreaperAxe = require("../plugins/combat/specials/SoulreaperAxe.SpecialAttack");
const { _test: { stacks, afterHitRolled } } = registerSoulreaperAxe;
const SOULREAPER_STACKS_VARP = 3784;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  registerSoulreaperAxe(PluginManager.createApi("SoulreaperAxeTest"));
});

function fighter(weaponId = ItemIdentifiers.SOULREAPER_AXE_2) {
  const player = new Player(null);
  const varps = new Map();
  const sender = new Proxy({}, {
    get: (_, name) => name === "sendConfig" ? (id, value) => { varps.set(id, value); return sender; } : () => sender,
  });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getFightType = () => ({ getStyle: () => FightStyle.AGGRESSIVE, getBonusType: () => 1 });
  player.getSkillManager().setMaxLevels(Skill.STRENGTH, 99, false);
  player.getSkillManager().setCurrentLevel(Skill.STRENGTH, 99, false);
  player.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(weaponId, 1));
  BonusManager.update(player);
  player.setCombatSpecial(CombatSpecial.getForWeaponId(weaponId));
  return { player, varps };
}

function swing(player) {
  afterHitRolled({ attacker: player, combatType: CombatType.MELEE });
}

test("every axe attack adds a soul stack, up to five, shown in its varp", () => {
  const { player, varps } = fighter();
  for (let expected = 1; expected <= 5; expected++) {
    swing(player);
    assert.equal(stacks(player), expected);
    assert.equal(varps.get(SOULREAPER_STACKS_VARP), expected);
  }
  swing(player);
  assert.equal(stacks(player), 5);
});

test("other weapons gain no stacks and keep no Strength boost from them", () => {
  const { player } = fighter(ItemIdentifiers.ABYSSAL_WHIP);
  const maxHit = DamageFormulas.calculateMaxMeleeHit(player);
  swing(player);
  assert.equal(stacks(player), 0);
  player.setAttribute(registerSoulreaperAxe._test.STACKS_ATTRIBUTE, 5);
  assert.equal(DamageFormulas.calculateMaxMeleeHit(player), maxHit);
});

test("five stacks add 30% to the Strength level, additively with Piety", () => {
  const { player } = fighter();
  player.getPrayerActive()[PrayerHandler.PIETY] = true;
  // 99 Strength, Piety, aggressive, +125: floor(99 * 1.23) + 3 + 8 = 132 -> 39.
  assert.equal(DamageFormulas.calculateMaxMeleeHit(player), 39);
  for (let i = 0; i < 5; i++) swing(player);
  // floor(99 * 1.53) + 3 + 8 = 162 -> 48, not floor(121 * 1.3).
  assert.equal(DamageFormulas.calculateMaxMeleeHit(player), 48);
});

test("Behead is the axe's special, free, and scales with the stacks it consumes", () => {
  const special = CombatSpecial.getForWeaponId(ItemIdentifiers.SOULREAPER_AXE_2);
  assert.equal(special.getId(), "soulreaper_axe");
  for (const id of [ItemIdentifiers.SOULREAPER_AXE, ItemIdentifiers.SOULREAPER_AXE_O_]) {
    assert.equal(CombatSpecial.getForWeaponId(id), special, `${id}`);
  }
  assert.equal(special.getDrainAmount(), 0);
  assert.equal(special.getCombatMethod().type(), CombatType.MELEE);

  const { player } = fighter();
  for (let i = 0; i < 5; i++) swing(player);
  player.setSpecialActivated(true);
  const traits = CombatSpecial.activeTraitsFor(player);
  assert.ok(Math.abs(traits.accuracyMultiplier - 1.6) < 1e-9);
  assert.ok(Math.abs(traits.damageMultiplier - 1.3) < 1e-9);
  assert.ok(Math.abs(traits.minimumDamageMultiplier - 0.3) < 1e-9);
  // The stacks' Strength boost is consumed first: 99 Strength, no prayer, aggressive, +125 is
  // 99 + 3 + 8 = 110 -> 32, and Behead's +30% makes it floor(32 * 1.3) = 41.
  assert.equal(DamageFormulas.calculateMaxMeleeHit(player), 41);
});

test("Behead consumes every stack after its roll and gains none", () => {
  const { player, varps } = fighter();
  for (let i = 0; i < 3; i++) swing(player);
  player.setSpecialActivated(true);
  swing(player);
  assert.equal(stacks(player), 0);
  assert.equal(varps.get(SOULREAPER_STACKS_VARP), 0);
  player.setSpecialActivated(false);
  swing(player);
  assert.equal(stacks(player), 1);
});

test("the Soulreaper axe is two-handed", () => {
  const { player } = fighter();
  assert.equal(player.getEquipment().get(Equipment.WEAPON_SLOT).getDefinition().isDoubleHanded(), true);
});

test("Behead counts as a special attack performed, and costs no energy (league deeds)", (t) => {
  const performed = [];
  const original = PluginManager.emitCustomEvent.bind(PluginManager);
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    if (name === "combat-special:performed") performed.push(event);
    return original(name, event);
  });
  const { player } = fighter();
  player.setSpecialPercentage?.(100);
  player.setSpecialActivated(true);
  CombatSpecial.getForWeaponId(ItemIdentifiers.SOULREAPER_AXE_2).getCombatMethod().start(player, player);
  assert.equal(performed.length, 1, "one combat-special:performed");
  assert.equal(performed[0].player, player);
  assert.equal(player.getSpecialPercentage(), 100, "no energy spent");
});
