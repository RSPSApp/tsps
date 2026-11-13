// Run after `yarn build`: node --test tests/echo-equipment-captured.test.cjs
// Demonic Pacts echo equipment: the Infernal tecpatl's demonbane and Brand, the Devil's element,
// the Lithic sceptre and its Explosive Shatter, and the crystal blessing. The Leagues VI effects
// apply to a Demonic Pacts character only; a main character with the same gear gets none of them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { GameConstants } = require("../dist/game/GameConstants");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const { DamageFormulas: Damage } = require("../dist/game/content/combat/formula/DamageFormulas");
const { AccuracyFormulasDpsCalc: Accuracy } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { TimerKey } = require("../dist/util/timers/TimerKey");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const Devils = require("../plugins/items/DevilsElement.plugin");
const Lithic = require("../plugins/items/LithicSceptre.plugin");
const CrystalArmour = require("../plugins/items/CrystalArmour.plugin");
const Demonbane = require("../plugins/combat/effects/Demonbane.EquipmentEffects");
const Shatter = require("../plugins/combat/specials/LithicSceptre.SpecialAttack");
const Brand = require("../plugins/combat/specials/InfernalTecpatl.SpecialAttack");

const realRandom = Math.random;
const specials = [];
const hooks = {};
let Pacts;
const BLACK_DEMON = 1432;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/combat/ElementalSpells.plugin").register(PluginManager.createApi("EchoElementalSpells"));
  require("../plugins/items/ElementalStaves.plugin").register(PluginManager.createApi("EchoElementalStaves"));
  require("../plugins/items/ShadowflameQuadrant.plugin").register(PluginManager.createApi("EchoQuadrant"));
  Devils.register(PluginManager.createApi("EchoDevilsElement"));
  // Plugin files load in path order: CrystalArmour's bonus provider runs before Tumeken's shadow's.
  CrystalArmour.register(PluginManager.createApi("EchoCrystalArmour"));
  require("../plugins/items/TumekensShadow.plugin").register(PluginManager.createApi("EchoTumekensShadow"));
  Lithic.register(PluginManager.createApi("EchoLithicSceptre"));
  Demonbane(PluginManager.createApi("EchoDemonbane"));
  const specialApi = PluginManager.createApi("EchoSpecials");
  const capture = new Proxy({ registerCombatSpecial: (definition) => specials.push(definition) }, {
    get: (target, key) => (key in target ? target[key] : specialApi[key]),
  });
  Shatter(capture);
  Brand(capture);

  // The league units on the real custom-event bus, so `league:profile` is answered as in game.
  GameConstants.setWorldProfile("league");
  const real = PluginManager.createApi("EchoLeague");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => { for (const attached of lists[name]) attached(event); };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getSkillManager: () => SkillManager,
    getPluginConfig: (key, fallback) => (key === "league:type" ? 6 : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    registerCommand() {},
    registerRestingLevelModifier: (modifier) => SkillManager.registerRestingLevelModifier(modifier),
    onCustomEvent: (name, handler) => real.onCustomEvent(name, handler),
    emitCustomEvent: (name, payload) => real.emitCustomEvent(name, payload),
  }, { get: (target, key) => (key in target ? target[key] : String(key).startsWith("register") ? () => {} : on(String(key))) });
  real.onCustomEvent("quest:is-complete", (request) => { request.complete = false; });
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
  require("../plugins/modes/Tasks.LeagueMode").register(api);
  require("../plugins/modes/Pacts.LeagueMode").register(api);
  Pacts = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
});

afterEach(() => {
  Math.random = realRandom;
});

let index = 3300;
/** A Demonic Pacts character (`league`), or a main character. */
function player({ league = true } = {}) {
  const p = new Player(null);
  const name = `echo${index}`;
  p.setUsername(name);
  p.setIndex(index++);
  p.varbits = [];
  const sender = new Proxy({}, {
    get: (target, key) => (key === "isSubInterfaceOpen" ? () => true
      : key === "sendVarbit" ? (id, value) => { p.varbits.push([id, value]); return sender; } : () => sender),
  });
  p.getPacketSender = () => sender;
  p.getSession = () => ({ sendClientPacket: () => true });
  p.messages = [];
  p.sendMessage = (message) => p.messages.push(message);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.getDialogueManager = () => ({ startDialogues() {} });
  if (league) {
    p.setProfile("league");
    p.setRegistered(true);
    hooks.onPlayerLogin({ player: p, username: name, isNewAccount: true, profile: "league" });
    p.getInventory().resetItems();
  }
  const skills = p.getSkillManager();
  for (const skill of [core.Skill.MAGIC, core.Skill.HITPOINTS, core.Skill.PRAYER, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE]) {
    skills.setMaxLevel(skill, 99);
    skills.setCurrentLevel(skill, 99, false);
  }
  return p;
}

function wear(p, slot, id, meta) {
  const item = new core.Item(id, 1);
  if (meta) for (const [key, value] of Object.entries(meta)) item.setMetaValue(key, value);
  p.getEquipment().getItems()[slot] = item;
  return item;
}

const WEAPON = () => core.Equipment.WEAPON_SLOT;
const SHIELD = () => core.Equipment.SHIELD_SLOT;
const AMMO = () => core.Equipment.AMMUNITION_SLOT;

/** An NPC with the given weakness (type 1 air .. 4 fire, or none), the player's target. */
function weakTarget(t, p, type = 0, percent = 0) {
  const definition = Object.assign(new NpcDefinition(), { elementalWeaknessType: type, elementalWeaknessPercent: percent });
  const target = new NPC(12204, new core.Location(3203, 3200));
  t.mock.method(target, "getCurrentDefinition", () => definition);
  t.mock.method(p.getCombat(), "getTarget", () => target);
  return target;
}

function caster(t, spellName, { type = 1, percent = 30, league = true } = {}) {
  const p = player({ league });
  const target = weakTarget(t, p, type, percent);
  p.getCombat().setCastSpell(core.CombatSpells[spellName]);
  p.getBonusManager().getAttackBonus()[core.BonusManager.ATTACK_MAGIC] = 100;
  p.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH] = 0;
  return { p, target, max: () => Damage.getMagicMaxhit(p), roll: () => Accuracy.attackMagicRoll(p, target) };
}

// ------------------------------------------------------------------ Devil's element

test("the Devil's element adds 30% weakness to every element, on top of the existing one", (t) => {
  const none = caster(t, "FIRE_SURGE", { type: 0, percent: 0 });
  assert.equal(none.max(), 24);
  wear(none.p, SHIELD(), I.DEVILS_ELEMENT);
  assert.equal(none.max(), 24 + Math.floor(24 * 30 / 100), "no natural weakness: 30%");
  const air = caster(t, "WIND_SURGE", { type: 1, percent: 30 });
  wear(air.p, SHIELD(), I.DEVILS_ELEMENT);
  assert.equal(air.max(), 24 + Math.floor(24 * 60 / 100), "30% natural + 30%");
  const other = caster(t, "EARTH_SURGE", { type: 1, percent: 30 });
  wear(other.p, SHIELD(), I.DEVILS_ELEMENT);
  assert.equal(other.max(), 24 + Math.floor(24 * 30 / 100), "another element: the 30% alone");
  wear(other.p, WEAPON(), I.SHADOWFLAME_QUADRANT);
  assert.equal(other.max(), 24 + Math.floor(24 * 60 / 100), "the quadrant counts it as the air weakness, plus 30%");
});

test("the Devil's element's accuracy bonus follows the weakness", (t) => {
  const f = caster(t, "FIRE_SURGE", { type: 0, percent: 0 });
  const base = f.roll();
  wear(f.p, SHIELD(), I.DEVILS_ELEMENT);
  assert.equal(f.roll(), base + Math.floor(base * 30 / 100));
});

test("a main character's Devil's element adds no weakness and supplies no runes", (t) => {
  const main = caster(t, "FIRE_SURGE", { type: 0, percent: 0, league: false });
  wear(main.p, SHIELD(), I.DEVILS_ELEMENT);
  assert.equal(main.max(), 24);
  assert.notEqual(PluginManager.emitSpellRuneBypass(main.p, core.MagicSpellbook.NORMAL, 0, I.FIRE_RUNE), true);
});

test("the Devil's element supplies all four elemental runes, with a staff's too", () => {
  const p = player();
  wear(p, SHIELD(), I.DEVILS_ELEMENT);
  for (const rune of [I.AIR_RUNE, I.WATER_RUNE, I.EARTH_RUNE, I.FIRE_RUNE]) {
    assert.equal(PluginManager.emitSpellRuneBypass(p, core.MagicSpellbook.NORMAL, 0, rune), true, String(rune));
  }
  assert.notEqual(PluginManager.emitSpellRuneBypass(p, core.MagicSpellbook.NORMAL, 0, I.DEATH_RUNE), true);
  const request = { player: p, runes: [] };
  PluginManager.emitCustomEvent("elemental-staves:runes", request);
  assert.equal(new Set(request.runes).size, 4);
});

test("the air pact counts a target made weak to air by the Devil's element", (t) => {
  const p = player();
  Pacts.save(p, Pacts.nodes.filter((node) => node.varbit === "talent_air_spell_max_hit_prayer_bonus").map((node) => node.index));
  const target = weakTarget(t, p, 4, 20); // weak to fire only
  p.getCombat().setCastSpell(core.CombatSpells.WIND_WAVE);
  p.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER] = 10;
  const roll = () => {
    const event = { attacker: p, target, combatType: core.CombatType.MAGIC, damage: 3, minimum: 0, maximum: 20 };
    PluginManager.emitCustomEvent("combat:hit-rolled", event);
    return event.damage;
  };
  Math.random = () => 0.15; // outside 10%, inside the doubled 20%
  assert.equal(roll(), 3, "not weak to air: 10%");
  wear(p, SHIELD(), I.DEVILS_ELEMENT);
  assert.equal(roll(), 20, "weak to air through the Devil's element: doubled");
});

// ------------------------------------------------------------------ Infernal tecpatl

test("the tecpatl's 10% demonbane, for a Demonic Pacts character against demons", (t) => {
  for (const [league, expected] of [[true, 110], [false, 100]]) {
    const p = player({ league });
    wear(p, WEAPON(), I.INFERNAL_TECPATL);
    const demon = new NPC(BLACK_DEMON, new core.Location(3201, 3200));
    t.mock.method(p.getCombat(), "getTarget", () => demon);
    assert.equal(Demonbane._test.meleeDemonbane(p, 100), expected, `league ${league}`);
    assert.equal(Demonbane.isDemonbaneAttack(p), league);
    const guard = new NPC(397, new core.Location(3201, 3200));
    t.mock.method(p.getCombat(), "getTarget", () => guard);
    assert.equal(Demonbane._test.meleeDemonbane(p, 100), 100, "not a demon");
  }
});

test("Brand: 50% energy, four hits at +25% accuracy and max hit", () => {
  const brand = specials.find((definition) => definition.id === "infernal_tecpatl");
  assert.ok(brand);
  assert.equal(brand.drainAmount, 50);
  assert.deepEqual(brand.itemIds, [I.INFERNAL_TECPATL]);
  assert.deepEqual(brand.traits, { hitCount: 4, accuracyMultiplier: 1.25, damageMultiplier: 1.25 });
});

test("Brand's split: the first landed roll in whole shares, the remainder on the later hits, misses 0", () => {
  const { share, splitAcrossAccurate } = Brand._test;
  assert.deepEqual([0, 1, 2].map((i) => share(10, i, 3)), [3, 3, 4]);
  const splats = [7, 0, 5, 9].map((value) => new core.HitDamage(value, core.HitMask.RED));
  const events = splats.map((damage, i) => ({ damage, accurate: i !== 1 }));
  const target = { getHitpoints: () => 100 };
  let total = 0;
  const hit = { getHits: () => splats, getTarget: () => target, updateTotalDamage: () => { total = splats.reduce((sum, s) => sum + s.getDamage(), 0); } };
  splitAcrossAccurate(hit, events);
  assert.deepEqual(splats.map((s) => s.getDamage()), [2, 0, 2, 3], "7 over three landed hits");
  assert.equal(total, 7);
});

// ------------------------------------------------------------------ Lithic sceptre

test("the Lithic sceptre's max hit is max(10, floor(Magic / 3) - 10)", () => {
  const p = player();
  for (const [level, expected] of [[99, 23], [75, 15], [60, 10], [30, 10]]) {
    p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, level, false);
    assert.equal(Lithic._test.maxHit(p), expected, String(level));
  }
});

test("the sceptre charges with 1 body rune and 3 earth runes a charge, and Check reads them", () => {
  const p = player();
  const inventory = p.getInventory();
  inventory.add(new core.Item(I.LITHIC_SCEPTRE_UNCHARGED_, 1));
  inventory.add(new core.Item(I.BODY_RUNE, 10));
  inventory.add(new core.Item(I.EARTH_RUNE, 20));
  const held = inventory.getItems().find((item) => item?.getId() === I.LITHIC_SCEPTRE_UNCHARGED_);
  Lithic._test.chargeOption({ player: p, item: held });
  assert.equal(held.getId(), I.LITHIC_SCEPTRE, "charged");
  assert.equal(held.getMetaValue(Lithic._test.CHARGES_KEY), 6, "20 earth runes pay for 6");
  assert.equal(inventory.getAmount(I.BODY_RUNE), 4);
  assert.equal(inventory.getAmount(I.EARTH_RUNE), 2);
  held.setMetaValue(Lithic._test.CHARGES_KEY, 3015);
  Lithic._test.checkSceptre({ player: p, item: held });
  assert.equal(p.messages.at(-1), "The Lithic sceptre currently has 3,015 charges.");
  const method = Lithic._test.staff().method();
  assert.equal(method.attackSpeed(), 4);
  assert.equal(method.attackDistance(p), 7);
});

test("the cast's projectile and impact: 51 to 51 + 5 a tile past the first, the glaive impact or a splash", () => {
  const p = player();
  const near = new NPC(12204, new core.Location(3205, 3200));
  assert.equal(Lithic._test.projectileEnd(p, near), 71, "5 tiles");
  const hit = Lithic._test.impact(p, near, true);
  assert.equal(hit.graphic.getId(), core.CacheDefinitions.getSpotanimId("vfx_glaive_01_impact_regular_01"));
  assert.equal(hit.graphic.getDelay(), 71);
  assert.deepEqual(hit.areaSound, { id: 11410, delay: 71 });
  const splash = Lithic._test.impact(p, near, false);
  assert.equal(splash.graphic.getId(), 85);
  assert.equal(splash.areaSound.id, 227);
});

test("Shatter stacks: one an attack up to 14, shown in the varbit; teleporting, instances and decay lose them", () => {
  const p = player();
  Lithic._test.setStacks(p, 0);
  const attack = () => Lithic._test.gainStack({ getAttacker: () => p });
  for (let i = 0; i < 16; i++) attack();
  assert.equal(Lithic._test.stacks(p), 14);
  const varbit = core.CacheDefinitions.getVarbitId("lithic_sceptre_shatter_stacks");
  assert.deepEqual(p.varbits.filter(([id]) => id === varbit).at(-1), [varbit, 14]);
  const take = { player: p, stacks: 0, consume: 5, consumed: false };
  PluginManager.emitCustomEvent("lithic-sceptre:stacks", take);
  assert.equal(take.consumed, true);
  assert.equal(Lithic._test.stacks(p), 9);
  Lithic._test.setStacks(p, 3);
  const short = { player: p, stacks: 0, consume: 5, consumed: false };
  PluginManager.emitCustomEvent("lithic-sceptre:stacks", short);
  assert.equal(short.consumed, false);
  assert.equal(Lithic._test.stacks(p), 3, "fewer than 5 are kept");
  attack();
  for (let i = 0; i < 50; i++) core.TaskManager.process();
  assert.equal(Lithic._test.stacks(p), 3, "one lost after 50 ticks out of combat");
  PluginManager.emitCustomEvent("teleport:landed", { player: p });
  assert.equal(Lithic._test.stacks(p), 0, "teleporting loses them");
});

/** A sceptre wielder with 7 stacks, whose combat target is `target`, and what a press spends. */
function shatterer(t, target) {
  const p = player();
  p.setNeedsPlacement(false);
  const sceptre = wear(p, WEAPON(), I.LITHIC_SCEPTRE, { [Lithic._test.CHARGES_KEY]: 50 });
  t.mock.method(p.getCombat(), "getTarget", () => target);
  Lithic._test.setStacks(p, 7);
  const performed = [];
  const listener = PluginManager.createApi("EchoPerformedCheck");
  listener.onCustomEvent("combat-special:performed", (event) => { if (event.player === p) performed.push(event); });
  const spent = () => ({ stacks: Lithic._test.stacks(p), charges: sceptre.getMetaValue(Lithic._test.CHARGES_KEY), performed: performed.length });
  return { p, spent };
}

function registeredNpc(t, id = 12204) {
  const npc = new NPC(id, new core.Location(3203, 3200));
  npc.setRegistered(true);
  npc.setNeedsPlacement?.(false);
  t.after(() => npc.setRegistered(false));
  return npc;
}

test("Explosive Shatter is refused, spending nothing, when the cast could not attack the target", (t) => {
  const queued = [];
  t.mock.method(core.CombatFactory, "addPendingHit", (hit) => queued.push(hit));
  const untouched = { stacks: 7, charges: 50, performed: 0 };

  // Another player, outside any PvP area.
  const other = player();
  other.setNeedsPlacement(false);
  other.setLocation(new core.Location(3203, 3200, 0));
  const pvp = shatterer(t, other);
  assert.deepEqual(Shatter._test.explode(pvp.p), []);
  assert.deepEqual(pvp.spent(), untouched, "a player outside PvP");

  // An NPC that is immune to attacks for now.
  const immune = registeredNpc(t);
  immune.getTimers().registers(TimerKey.ATTACK_IMMUNITY, 10);
  const blocked = shatterer(t, immune);
  assert.deepEqual(Shatter._test.explode(blocked.p), []);
  assert.deepEqual(blocked.spent(), untouched, "an immune NPC");

  // Content that refuses the attack (an instance's owner rule, a boss phase).
  const refused = registeredNpc(t);
  const policy = shatterer(t, refused);
  let refuse = true;
  PluginManager.createApi("EchoRefuse").onCanAttack((event) => { if (refuse && event.target === refused) event.allow = false; });
  assert.deepEqual(Shatter._test.explode(policy.p), []);
  assert.deepEqual(policy.spent(), untouched, "an attack content refuses");
  refuse = false;
  assert.equal(queued.length, 0, "nothing was hit");

  // The same target once the attack is allowed.
  assert.equal(Shatter._test.explode(policy.p).length, 2);
  assert.deepEqual(policy.spent(), { stacks: 2, charges: 49, performed: 1 });
});

test("Explosive Shatter hits the target and up to 11 more within 3 tiles: magic at 150%, typeless 10 to 75% of the max", (t) => {
  const p = player();
  p.setNeedsPlacement(false);
  const sceptre = wear(p, WEAPON(), I.LITHIC_SCEPTRE, { [Lithic._test.CHARGES_KEY]: 50 });
  const target = weakTarget(t, p);
  target.setRegistered(true);
  t.after(() => target.setRegistered(false));
  const others = Array.from({ length: 15 }, () => new NPC(12204, new core.Location(3204, 3200)));
  p.getLocalNpcs = () => [target, ...others];
  t.mock.method(core.CombatFactory, "canAttackSecondaryTarget", () => true);
  assert.equal(Shatter._test.victims(p, target).length, 12);
  p.getLocalNpcs = () => [];
  const queued = [];
  t.mock.method(core.CombatFactory, "addPendingHit", (hit) => queued.push(hit));
  Lithic._test.setStacks(p, 7);
  Math.random = () => 0;
  const performed = [];
  PluginManager.createApi("EchoPerformed").onCustomEvent("combat-special:performed", (event) => { if (event.player === p) performed.push(event); });
  const hits = Shatter._test.explode(p);
  assert.equal(performed.length, 1, "a special attack performed");
  assert.equal(Lithic._test.stacks(p), 2, "exactly 5 used");
  assert.equal(sceptre.getMetaValue(Lithic._test.CHARGES_KEY), 49, "one charge");
  assert.equal(p.getSpecialPercentage(), 100, "no energy");
  assert.equal(queued.length, 2);
  assert.deepEqual(hits, queued);
  const [magic, typeless] = hits;
  assert.equal(magic.getCombatType(), core.CombatType.MAGIC);
  assert.ok(magic.getSpell() != null, "the built-in spell");
  assert.equal(magic.getDelay(), 0, "with the NPC's own tick in the hit queue, it lands the next tick");
  assert.equal(typeless.getTotalDamage(), 10, "the typeless part is at least 10");
  Math.random = () => 0.999;
  Lithic._test.setStacks(p, 5);
  const [, high] = Shatter._test.explode(p);
  const max = Damage.getMagicMaxhit(p, Lithic._test.staff().spellFor(p), target);
  assert.equal(high.getTotalDamage(), Math.max(10, Math.floor(max * 0.75)), "up to 75% of the max hit");
  Lithic._test.setStacks(p, 5);
  t.mock.method(p.getCombat(), "getTarget", () => null);
  assert.deepEqual(Shatter._test.explode(p), [], "no target: nothing");
  assert.equal(Lithic._test.stacks(p), 5, "and the stacks are kept");
});

// ------------------------------------------------------------------ Crystal blessing

const FULL_SET = () => [[core.Equipment.HEAD_SLOT, I.CRYSTAL_HELM], [core.Equipment.BODY_SLOT, I.CRYSTAL_BODY], [core.Equipment.LEG_SLOT, I.CRYSTAL_LEGS]];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} vs ${expected}`);

test("the crystal blessing extends the armour's bonus to melee (unarmed too) and powered staves", () => {
  const p = player();
  for (const [slot, id] of FULL_SET()) wear(p, slot, id);
  near(CrystalArmour._test.blessedMeleeAccuracy(p, 100), 100, "no blessing");
  wear(p, AMMO(), I.CRYSTAL_BLESSING);
  near(CrystalArmour._test.blessedMeleeAccuracy(p, 100), 130);
  near(CrystalArmour._test.blessedMeleeDamage(p, 100), 115);
  wear(p, WEAPON(), I.DRAGON_SCIMITAR);
  near(CrystalArmour._test.blessedMeleeDamage(p, 100), 115);
  p.getCombat().setCastSpell(core.CombatSpells.FIRE_SURGE);
  near(CrystalArmour._test.blessedMagicAccuracy(p, 100), 100, "not a spellbook spell");
  wear(p, WEAPON(), I.LITHIC_SCEPTRE, { [Lithic._test.CHARGES_KEY]: 5 });
  p.getCombat().setCastSpell(Lithic._test.staff().spellFor(p));
  near(CrystalArmour._test.blessedMagicAccuracy(p, 100), 130);
  near(CrystalArmour._test.blessedMagicDamage(p, 100), 115);
  near(CrystalArmour._test.applyCrystalDamage(p, 100), 100, "ranged still needs a crystal bow");
  const main = player({ league: false });
  for (const [slot, id] of FULL_SET()) wear(main, slot, id);
  wear(main, AMMO(), I.CRYSTAL_BLESSING);
  near(CrystalArmour._test.blessedMeleeAccuracy(main, 100), 100, "a main character");
});

test("the crystal blessing adds +20 magic attack and +2% magic damage a piece, which Tumeken's shadow multiplies", () => {
  const p = player();
  for (const [slot, id] of FULL_SET()) wear(p, slot, id);
  const magic = () => [p.getBonusManager().getAttackBonus()[core.BonusManager.ATTACK_MAGIC], p.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH]];
  core.BonusManager.update(p);
  const [attack, damage] = magic();
  wear(p, AMMO(), I.CRYSTAL_BLESSING);
  core.BonusManager.update(p);
  assert.deepEqual(magic(), [attack + 60, damage + 6]);
  wear(p, WEAPON(), I.TUMEKENS_SHADOW);
  core.BonusManager.update(p);
  const shadow = core.ItemDefinition.forId(I.TUMEKENS_SHADOW).getBonuses();
  assert.deepEqual(magic(), [(attack + 60 + shadow[3]) * 3, Math.min(100, (damage + 6 + shadow[12]) * 3)]);
});
