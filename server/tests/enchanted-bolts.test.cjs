// Run after `yarn build`: node --test tests/enchanted-bolts.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatType } = require("../dist/game/content/combat/CombatType");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { Graphic } = require("../dist/game/model/Graphic");
const { Skill } = require("../dist/game/model/Skill");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");

const EnchantedBolts = require("../plugins/combat/EnchantedBolts.plugin");

const NAMES = {
  [Items.RUBY_BOLTS_E_]: "Ruby bolts (e)",
  [Items.RUBY_DRAGON_BOLTS_E_]: "Ruby dragon bolts (e)",
  [Items.ONYX_BOLTS_E_]: "Onyx bolts (e)",
  [Items.DIAMOND_BOLTS_E_]: "Diamond bolts (e)",
  [Items.OPAL_BOLTS_E_]: "Opal bolts (e)",
  [Items.PEARL_BOLTS_E_]: "Pearl bolts (e)",
  [Items.DRAGONSTONE_BOLTS_E_]: "Dragonstone bolts (e)",
  [Items.EMERALD_BOLTS_E_]: "Emerald bolts (e)",
  [Items.SAPPHIRE_BOLTS_E_]: "Sapphire bolts (e)",
  [Items.TOPAZ_BOLTS_E_]: "Topaz bolts (e)",
  [Items.JADE_BOLTS_E_]: "Jade bolts (e)",
  [Items.RUNITE_BOLTS]: "Runite bolts",
};
const ZARYTE = { name: "zaryte crossbow" };
const RUNE_CROSSBOW = { name: "rune crossbow" };
const MAX_HIT = 40;

const world = { boltMultiplier: undefined, traits: null, kandarin: false, staffRunes: new Map(), boltEffects: true };
const calls = { poison: [], stun: [], rerolls: [] };

EnchantedBolts._test.attach({
  core: {
    CombatType,
    HitDamage,
    HitMask,
    Graphic,
    Skill,
    Equipment,
    ItemIdentifiers: Items,
    RangedWeapon: { ZARYTE_CROSSBOW: ZARYTE },
    WeaponProfiles: { get: () => (world.boltEffects ? { boltEffects: true, boltEffectChanceMultiplier: world.boltMultiplier } : {}) },
    CombatSpecial: { activeTraitsFor: () => world.traits },
    ItemDefinition: { forId: (id) => ({ getName: () => NAMES[id] }) },
    DamageFormulas: { sourceMaxHit: () => MAX_HIT },
    PluginManager: { modifyRangedMaxHit: (attacker, target, maxHit) => maxHit },
    CombatFactory: {
      getHitDamage: (attacker, target, type, bypass, bounds) => {
        calls.rerolls.push(bounds.maximumBonus);
        return new HitDamage(bounds.maximumBonus, HitMask.RED);
      },
      poisonEntity: (target, severity) => calls.poison.push(severity),
      stunTicks: (target, ticks) => calls.stun.push(ticks),
    },
    PrayerHandler: { PROTECT_FROM_MAGIC: 16, isActivated: (mob, prayer) => mob.prayers?.includes(prayer) === true },
    CombatEquipment: { hasDragonProtectionGear: (player) => player.antiDragonShield === true },
  },
  emitCustomEvent(name, request) {
    if (name === "diary:is-complete" && request.diary === "kandarin" && request.tier === "hard") request.complete = world.kandarin;
    if (name === "elemental-staves:runes") request.runes = world.staffRunes.get(request.player) ?? [];
  },
});

function skills(levels) {
  const current = new Map(levels);
  return {
    current,
    getCurrentLevel: (skill) => current.get(skill) ?? 1,
    getMaxLevel: () => 99,
    setCurrentLevels: (skill, level) => current.set(skill, level),
    decreaseCurrentLevel: (skill, amount, minimum) => current.set(skill, Math.max(minimum, current.get(skill) - amount)),
  };
}

function createPlayer({ ammo, hp = 90, weapon = RUNE_CROSSBOW, ranged = 99 } = {}) {
  const selfHits = [];
  const sounds = [];
  const skillLevels = skills([[Skill.RANGED, ranged], [Skill.PRAYER, 50], [Skill.AGILITY, 1], [Skill.MAGIC, 99]]);
  const attributes = new Map();
  const player = {
    hp,
    selfHits,
    sounds,
    healed: 0,
    skillLevels,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    isPlayerBot: () => false,
    graphics: [],
    performGraphic(graphic) { this.graphics.push(graphic); },
    getHitpoints() { return this.hp; },
    heal(amount) { this.healed += amount; },
    getSkillManager: () => skillLevels,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({ get: () => ({ getId: () => -1 }) }),
    getPacketSender: () => ({ sendSoundEffect: (id, loops, delay) => sounds.push({ id, delay }) }),
    getCombat: () => ({
      getAmmunition: () => ({ getItemId: () => ammo }),
      getRangedWeapon: () => weapon,
      getHitQueue: () => ({ addPendingDamage: (hits) => selfHits.push(...hits.map((h) => h.getDamage())) }),
      getFireImmunityTimer: () => ({ finished: () => true }),
    }),
  };
  return player;
}

function createNpc({ hp = 300, attributes = [], ranged = 1 } = {}) {
  return {
    hp,
    graphics: [],
    isPlayer: () => false,
    getAsNpc() { return this; },
    getHitpoints() { return this.hp; },
    getBaseAttack: () => ranged,
    getCurrentDefinition: () => ({ hasAttribute: (attribute) => attributes.includes(attribute) }),
    performGraphic(graphic) { this.graphics.push(graphic); },
  };
}

function shoot(player, target, { damage = 10, accurate = true, delay = 2 } = {}) {
  const hit = { getDelay: () => delay };
  const event = {
    attacker: player,
    target,
    combatType: CombatType.RANGED,
    hit,
    damage: new HitDamage(accurate ? damage : 0, accurate ? HitMask.RED : HitMask.BLUE),
    accurate,
  };
  EnchantedBolts._test.rollBoltEffect(event);
  return { event, land: () => EnchantedBolts._test.landBoltEffect({ attacker: player, target, hit }) };
}

let random;
function rollRandom(value) {
  Math.random = () => value;
}

beforeEach(() => {
  random = Math.random;
  world.traits = null;
  world.boltMultiplier = undefined;
  world.kandarin = false;
  world.boltEffects = true;
  world.staffRunes.clear();
  calls.poison.length = 0;
  calls.stun.length = 0;
  calls.rerolls.length = 0;
});
afterEach(() => {
  Math.random = random;
});

test("Blood Forfeit: 20% of the target's hitpoints, paid with 10% of the shooter's, on the hit's landing", () => {
  rollRandom(0);
  const player = createPlayer({ ammo: Items.RUBY_BOLTS_E_ });
  const npc = createNpc({ hp: 300 });
  const { event, land } = shoot(player, npc, { damage: 30, delay: 2 });
  assert.equal(event.damage.getDamage(), 60);
  assert.equal(event.accurate, true);
  assert.deepEqual(npc.graphics.map((g) => [g.getId(), g.getDelay()]), [[754, 2]], "captured spotanim, delayed by the flight time");
  assert.deepEqual(player.sounds, [{ id: 2911, delay: 2 }], "captured synth 2911");
  assert.deepEqual(player.selfHits, [], "the cost waits for the bolt to land");
  land();
  assert.deepEqual(player.selfHits, [9]);
});

test("Blood Forfeit ignores accuracy, caps at 100 (110 with a Zaryte crossbow) and needs a spare hitpoint", () => {
  rollRandom(0);
  assert.equal(shoot(createPlayer({ ammo: Items.RUBY_DRAGON_BOLTS_E_ }), createNpc({ hp: 2000 }), { accurate: false }).event.damage.getDamage(), 100);
  assert.equal(shoot(createPlayer({ ammo: Items.RUBY_BOLTS_E_, weapon: ZARYTE }), createNpc({ hp: 400 })).event.damage.getDamage(), 88);
  assert.equal(shoot(createPlayer({ ammo: Items.RUBY_BOLTS_E_, weapon: ZARYTE }), createNpc({ hp: 2000 })).event.damage.getDamage(), 110);
  const weak = createPlayer({ ammo: Items.RUBY_BOLTS_E_, hp: 9 });
  const npc = createNpc();
  assert.equal(shoot(weak, npc, { damage: 7 }).event.damage.getDamage(), 7);
  assert.equal(npc.graphics.length, 0);
});

test("chances: ruby is 6% against monsters, 11% against players, x1.1 with the Hard Kandarin Diary, x2 on the Armadyl Eye", () => {
  const player = createPlayer({ ammo: Items.RUBY_BOLTS_E_ });
  const procs = (value, target) => {
    rollRandom(value);
    return shoot(player, target, { damage: 3 }).event.damage.getDamage() !== 3;
  };
  assert.equal(procs(0.0599, createNpc()), true);
  assert.equal(procs(0.0601, createNpc()), false);
  assert.equal(procs(0.1099, createPlayer({ ammo: -1, hp: 99 })), true);
  world.kandarin = true;
  assert.equal(procs(0.0659, createNpc()), true);
  assert.equal(procs(0.0661, createNpc()), false);
  world.kandarin = false;
  world.traits = { enchantedBoltEffectChanceMultiplier: 2 };
  assert.equal(procs(0.1199, createNpc()), true);
});

test("a weapon's boltEffectChanceMultiplier scales the chance (Ascension crossbows: x0.5)", () => {
  const player = createPlayer({ ammo: Items.RUBY_BOLTS_E_ });
  world.boltMultiplier = 0.5;
  const procs = (value) => {
    rollRandom(value);
    return shoot(player, createNpc(), { damage: 3 }).event.damage.getDamage() !== 3;
  };
  assert.equal(procs(0.0299), true);
  assert.equal(procs(0.0301), false);
});

test("the Zaryte crossbow special guarantees the effect only on a successful hit", () => {
  rollRandom(0.99);
  world.traits = { guaranteedEnchantedBoltEffect: true };
  const player = createPlayer({ ammo: Items.ONYX_BOLTS_E_, weapon: ZARYTE });
  assert.equal(shoot(player, createNpc()).event.damage.getDamage(), 52, "132% of a 40 max hit");
  assert.equal(shoot(player, createNpc(), { accurate: false }).event.damage.getDamage(), 0);
});

test("Life Leech needs an accurate hit and a living target; it rerolls up to 120% and heals a quarter of the damage", () => {
  rollRandom(0);
  const player = createPlayer({ ammo: Items.ONYX_BOLTS_E_ });
  assert.equal(shoot(player, createNpc(), { accurate: false }).event.damage.getDamage(), 0);
  assert.equal(shoot(player, createNpc({ attributes: ["undead"] }), { damage: 5 }).event.damage.getDamage(), 5);
  const { event, land } = shoot(player, createNpc(), { damage: 5 });
  assert.deepEqual(calls.rerolls.slice(-1), [48]);
  assert.equal(event.damage.getDamage(), 48);
  land();
  assert.equal(player.healed, 12);
});

test("Armour Piercing makes a missed roll a hit of up to 115% (126% with a Zaryte crossbow)", () => {
  rollRandom(0);
  const { event } = shoot(createPlayer({ ammo: Items.DIAMOND_BOLTS_E_ }), createNpc(), { accurate: false });
  assert.equal(event.accurate, true);
  assert.deepEqual(calls.rerolls, [46]);
  shoot(createPlayer({ ammo: Items.DIAMOND_BOLTS_E_, weapon: ZARYTE }), createNpc());
  assert.deepEqual(calls.rerolls, [46, 50]);
});

test("Lucky Lightning, Sea Curse and Dragon's Breath add a share of the visible Ranged level", () => {
  rollRandom(0);
  assert.equal(shoot(createPlayer({ ammo: Items.OPAL_BOLTS_E_ }), createNpc(), { accurate: false }).event.damage.getDamage(), 9);
  assert.equal(shoot(createPlayer({ ammo: Items.OPAL_BOLTS_E_, weapon: ZARYTE }), createNpc(), { damage: 1 }).event.damage.getDamage(), 12);
  assert.equal(shoot(createPlayer({ ammo: Items.PEARL_BOLTS_E_ }), createNpc(), { damage: 1 }).event.damage.getDamage(), 5);
  assert.equal(shoot(createPlayer({ ammo: Items.PEARL_BOLTS_E_ }), createNpc({ attributes: ["fiery"] }), { damage: 1 }).event.damage.getDamage(), 7);
  assert.equal(shoot(createPlayer({ ammo: Items.DRAGONSTONE_BOLTS_E_ }), createNpc(), { damage: 1 }).event.damage.getDamage(), 20);
  // Wiki: 22% with the Zaryte crossbow, rounded down: 99 -> 21 extra (2/9 gave 22), 112 -> 24; plus the 1 hit.
  assert.equal(shoot(createPlayer({ ammo: Items.DRAGONSTONE_BOLTS_E_, weapon: ZARYTE }), createNpc(), { damage: 1 }).event.damage.getDamage(), 22);
  assert.equal(shoot(createPlayer({ ammo: Items.DRAGONSTONE_BOLTS_E_, weapon: ZARYTE, ranged: 112 }), createNpc(), { damage: 1 }).event.damage.getDamage(), 25);
  assert.equal(shoot(createPlayer({ ammo: Items.DRAGONSTONE_BOLTS_E_ }), createNpc({ attributes: ["dragon"] }), { damage: 1 }).event.damage.getDamage(), 1);
  assert.equal(shoot(createPlayer({ ammo: Items.DRAGONSTONE_BOLTS_E_ }), createNpc(), { accurate: false }).event.damage.getDamage(), 0);
});

test("player targets: water staves stop Sea Curse, anti-dragon shields stop Dragon's Breath", () => {
  rollRandom(0);
  const target = createPlayer({ ammo: -1 });
  world.staffRunes.set(target, [Items.WATER_RUNE]);
  assert.equal(shoot(createPlayer({ ammo: Items.PEARL_BOLTS_E_ }), target, { damage: 1 }).event.damage.getDamage(), 1);
  world.staffRunes.set(target, [Items.FIRE_RUNE]);
  assert.equal(shoot(createPlayer({ ammo: Items.PEARL_BOLTS_E_ }), target, { damage: 1 }).event.damage.getDamage(), 7, "a fire staff makes the wielder fiery");
  target.antiDragonShield = true;
  assert.equal(shoot(createPlayer({ ammo: Items.DRAGONSTONE_BOLTS_E_ }), target, { damage: 1 }).event.damage.getDamage(), 1);
});

test("Magical Poison, Clear Mind, Down to Earth and Earth's Fury act when the bolt lands", () => {
  rollRandom(0);
  shoot(createPlayer({ ammo: Items.EMERALD_BOLTS_E_ }), createNpc()).land();
  shoot(createPlayer({ ammo: Items.EMERALD_BOLTS_E_, weapon: ZARYTE }), createNpc()).land();
  assert.deepEqual(calls.poison, [25, 27]);

  const shooter = createPlayer({ ammo: Items.SAPPHIRE_BOLTS_E_ });
  shooter.skillLevels.current.set(Skill.PRAYER, 40);
  shoot(shooter, createNpc({ ranged: 300 })).land();
  assert.equal(shooter.skillLevels.current.get(Skill.PRAYER), 43, "an eighth of a tenth of the monster's Ranged level");

  const victim = createPlayer({ ammo: -1, hp: 99 });
  const pvpShooter = createPlayer({ ammo: Items.SAPPHIRE_BOLTS_E_ });
  pvpShooter.skillLevels.current.set(Skill.PRAYER, 40);
  shoot(pvpShooter, victim, { damage: 10 }).land();
  assert.equal(victim.skillLevels.current.get(Skill.PRAYER), 46, "a twentieth of the shooter's Ranged level");
  assert.equal(pvpShooter.skillLevels.current.get(Skill.PRAYER), 42, "half of it, rounded down");

  const topazNpc = createNpc();
  shoot(createPlayer({ ammo: Items.TOPAZ_BOLTS_E_ }), topazNpc).land();
  assert.equal(topazNpc.graphics.length, 0, "Down to Earth only works on players");
  shoot(createPlayer({ ammo: Items.TOPAZ_BOLTS_E_ }), victim, { accurate: false }).land();
  assert.equal(victim.skillLevels.current.get(Skill.MAGIC), 98);

  shoot(createPlayer({ ammo: Items.JADE_BOLTS_E_ }), createNpc()).land();
  assert.deepEqual(calls.stun, [], "Earth's Fury only works on players");
  victim.prayers = [16];
  shoot(createPlayer({ ammo: Items.JADE_BOLTS_E_ }), victim).land();
  assert.deepEqual(calls.stun, [], "Protect from Magic blocks it");
  victim.prayers = [];
  shoot(createPlayer({ ammo: Items.JADE_BOLTS_E_ }), victim).land();
  assert.deepEqual(calls.stun, [8], "an Agility 1 target never dodges");
});

test("only crossbows trigger bolt effects, and plain bolts have none", () => {
  rollRandom(0);
  assert.equal(shoot(createPlayer({ ammo: Items.RUNITE_BOLTS }), createNpc(), { damage: 3 }).event.damage.getDamage(), 3);
  world.boltEffects = false;
  assert.equal(shoot(createPlayer({ ammo: Items.RUBY_BOLTS_E_ }), createNpc(), { damage: 3 }).event.damage.getDamage(), 3);
});
