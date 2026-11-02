/**
 * Demonic Pacts' melee pact effects (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Demonic_Pacts,
 * texts from the cache's `talent_tree` rows). Every value is the summed value of the character's
 * pacts for that effect (Common.effect), so a node bought twice counts twice; nobody but a Demonic
 * Pacts character has any. Weights are the cache's, in grams: "light" is under 1kg, "heavy" 1kg up.
 * Distances are between footprints (adjacent = 1 tile).
 *
 * - 14 talent_percentage_melee_damage: +1% melee max hit per point (`registerMeleeHitModifier`).
 *   Each node's +10% accuracy in all combat styles is General.LeaguePacts.js's, summed with the rest.
 * - 73 talent_melee_strength_prayer_bonus (+50% of the worn prayer bonus) and 77
 *   talent_multi_hit_str_increase (+20% of the current Strength level, with a weapon under 1kg or
 *   one-handed) add to the melee strength bonus as the max hit is worked out
 *   (registerMeleeStrengthBonusModifier), so the max-hit formula, a special's multiplier and the
 *   hit modifiers after it (Dharok's, the salve's, the slayer helmet's) all see it, as they see the
 *   worn bonus. Each rounded down (ours); 77 reads the current (boosted) Strength level (ours: the
 *   text says "your Strength level"), and an empty hand is no melee weapon (ours).
 * - 25 talent_distance_melee_minhit (+N min hit, +N per tile past the first), 67
 *   talent_overheal_consumption_boost (5 overhealed hitpoints spent for +5 min hit) and 70
 *   talent_percentage_melee_maxhit_distance (+N% max hit, +N% more per 3 tiles) change the roll's
 *   range on the core's `combat:hit-rolled` and roll it again in it; so they act on landed rolls
 *   only (a miss stays 0), and the overheal is spent only by a hit that passed its accuracy roll.
 *   A raised minimum above the max hit is the hit: 237/01098, with only this pact, landed 3 at
 *   Strength 1 (unarmed, max hit 1; the target left alive, tracking_damage_dealt_to_npcs +3) and
 *   missed for 0; later hits ranged 3 up to the rising max.
 * - 20 talent_melee_range_multiplier (two-handed melee range times the value) and 69
 *   talent_melee_range_conditional_boost (range 4+ becomes 7) on `onCombatAttackDistance`; 69's
 *   halberds slower than 5 ticks and 65 talent_light_weapon_faster (a tick faster under 1kg) on
 *   `onAttackSpeed`. These apply in PvP too (Wiki).
 * - 43 talent_light_weapon_doublehit: a melee attack (not a special) with a weapon under 1kg is
 *   followed by an ordinary melee hit of its own accuracy rolled from 40% of the max hit (at least
 *   1), with the same delay; on `onPlayerDealtDamage` (once per attack: the first hit queued that
 *   cycle). Ours: "40% of your base max hit" read as 40% of the max hit rolled, and the hit
 *   works against players too (the Wiki names Thorns, Echoes and Blindbag as off in PvP, not this).
 * - 44 talent_free_random_weapon_attack_chance (N% per heavy-weapon attack, not a special), 72
 *   talent_unique_blindbag_chance (+2% per unique heavy melee weapon in the inventory, up to 10%)
 *   and 68 talent_unique_blindbag_damage (+N% Blindbag max hit per unique one, up to 10%): Blindbag
 *   puts a random heavy melee weapon from the inventory (not the Dramen staff: Wiki, 6 May 2026) in
 *   the weapon slot (bonuses recounted),
 *   rolls an ordinary melee hit with it and puts the weapon back; the hit may Blindbag again (a
 *   guard stops a chain at MAX_BLINDBAG_CHAIN). A "melee weapon" is a weapon-slot item with a melee
 *   attack or strength bonus above its ranged attack bonus. No animation or graphic: none recorded.
 * - 71 talent_2h_melee_echos: a landed two-handed melee hit (not a special, not on a player) has a
 *   5% chance to emit `league:pact-ranged-echo` { player, target, source: "melee" } (Ranged unit).
 * - 66 talent_hit_restore_spec_energy: each melee hitsplat that deals damage restores N% energy.
 * - 26 talent_melee_distance_healing_chance: each melee attack (once per attack) and each Thorns
 *   trigger has an N% chance to heal the distance in tiles, through `league:pact-heal`.
 * - 19 talent_thorns_damage (with a shield, on `onCombatHitResolved` of an NPC's hit on the
 *   player, once per hitsplat, also on 0), 84 talent_thorns_double_hit (a second hit of 50%) and 64
 *   talent_defence_recoil_scaling (+N% of the summed defence bonuses on Thorns, and on reflected
 *   damage landing (`combat:damage-apply`) from a wearer of a ring of recoil or suffering:
 *   approximation, a vengeance at the same time is counted as well). Thorns is reflected damage
 *   (no XP, respects `combat:recoil-immune`) and never hits players.
 * - 23 talent_shield_reflect: with a shield, 0.1% per Defence level (current, with
 *   talent_defence_boost's visible boost) that an NPC's hit is
 *   reflected whole: the player takes 0 and the attacker the damage (`onPlayerHitModify`, after
 *   protection prayers). Ours: not against players, as Thorns.
 * - 75 talent_shield_block_heal: an attack dealing 0 with Dinh's bulwark (a two-handed shield) or
 *   an off-hand (a shield-slot item that is not a shield) heals 2 (`league:pact-heal`) and restores
 *   2 Prayer. Shields and off-hands are Common's (a shield by name: shield, buckler, ward,
 *   Toktz-ket-xil, the bulwark; an off-hand any other shield-slot item); ours, as no category
 *   plugins can read tells them apart (the cache's category 18 agrees but for the crystal shield).
 */
const Common = require("./Common.LeaguePacts");

const EFFECTS = {
  meleeDamage: "talent_percentage_melee_damage",
  thorns: "talent_thorns_damage",
  rangeMultiplier: "talent_melee_range_multiplier",
  shieldReflect: "talent_shield_reflect",
  distanceMinHit: "talent_distance_melee_minhit",
  distanceHealing: "talent_melee_distance_healing_chance",
  doubleHit: "talent_light_weapon_doublehit",
  blindbag: "talent_free_random_weapon_attack_chance",
  recoilScaling: "talent_defence_recoil_scaling",
  lightFaster: "talent_light_weapon_faster",
  specRestore: "talent_hit_restore_spec_energy",
  overheal: "talent_overheal_consumption_boost",
  blindbagDamage: "talent_unique_blindbag_damage",
  rangeBoost: "talent_melee_range_conditional_boost",
  distanceMaxHit: "talent_percentage_melee_maxhit_distance",
  echoes: "talent_2h_melee_echos",
  blindbagChance: "talent_unique_blindbag_chance",
  prayerStrength: "talent_melee_strength_prayer_bonus",
  shieldBlockHeal: "talent_shield_block_heal",
  strengthLevel: "talent_multi_hit_str_increase",
  thornsDouble: "talent_thorns_double_hit",
};

const LIGHT_WEIGHT = 1000;
/** An item's bonus array: the five attack bonuses, the five defence ones, then BonusManager's others. */
const OTHER_BONUSES = 10;
const PRAYER_STRENGTH_FRACTION = 0.5;
const STRENGTH_LEVEL_FRACTION = 0.2;
const MAX_HIT_DISTANCE_STEP = 3;
const OVERHEAL_COST = 5;
const OVERHEAL_MIN_HIT = 5;
const DOUBLE_HIT_FRACTION = 0.4;
const BLINDBAG_CHANCE_PER_WEAPON = 2;
const BLINDBAG_BONUS_CAP = 10;
const MAX_BLINDBAG_CHAIN = 20;
const ECHO_CHANCE = 0.05;
const BOOSTED_RANGE_FROM = 4;
const BOOSTED_RANGE = 7;
const HALBERD_SPEED = 5;
const REFLECT_CHANCE_PER_LEVEL = 0.001;
const THORNS_SECOND_FRACTION = 0.5;
const BLOCK_HEAL = 2;
const BLOCK_PRAYER = 2;
/** Heavy melee weapons that are no Blindbag weapon (Wiki, 6 May 2026). */
const NOT_BLINDBAG_WEAPONS = new Set(["Dramen staff"]);
const RECOIL_RING_NAME = /recoil|suffering/i;
const PACT_HEAL_EVENT = "league:pact-heal";
const RANGED_ECHO_EVENT = "league:pact-ranged-echo";

let api;
let core;

/** Hits this unit made: "double" or "blindbag" (with its chain depth in `chains`). */
const derived = new WeakMap();
const chains = new WeakMap();
/** Hits queued while their attacker's special was armed. */
const specials = new WeakSet();
/** Thorns hits (their recoil scaling is already in them). */
const thornsHits = new WeakSet();
/** The cycle of each player's last attack that rolled the once-per-attack effects. */
const lastAttack = new WeakMap();
/** The derived hit being built, read by the roll hooks: { player, kind, uniques }. */
let building = null;

const value = (player, key) => (player?.isPlayer?.() ? Common.effect(player, EFFECTS[key]) : 0);

function definition(item) {
  const id = Number(item?.getId?.() ?? -1);
  return id > 0 ? core.ItemDefinition.forId(id) : null;
}

function slotDefinition(player, slot) {
  return definition(player.getEquipment().getItems()[slot]);
}

const weapon = (player) => slotDefinition(player, core.Equipment.WEAPON_SLOT);
const isLight = (item) => item !== null && item.getWeight() < LIGHT_WEIGHT;
const isHeavy = (item) => item !== null && item.getWeight() >= LIGHT_WEIGHT;
const isTwoHanded = (item) => item !== null && item.isDoubleHanded();

const hasShield = (player) => Common.hasShield(player);
const hasTwoHandedShieldOrOffhand = (player) => Common.twoHandedShield(player) || Common.hasOffhand(player);

function isMeleeWeapon(item) {
  if (item === null || item.getEquipmentType?.()?.getSlot?.() !== core.Equipment.WEAPON_SLOT) return false;
  const bonuses = item.getBonuses() ?? [];
  const { BonusManager } = core;
  const melee = Math.max(bonuses[BonusManager.ATTACK_STAB] ?? 0, bonuses[BonusManager.ATTACK_SLASH] ?? 0, bonuses[BonusManager.ATTACK_CRUSH] ?? 0, bonuses[OTHER_BONUSES + BonusManager.STRENGTH] ?? 0);
  return melee > 0 && melee > (bonuses[BonusManager.ATTACK_RANGE] ?? 0);
}

/** Distinct heavy melee weapons in the inventory (item ids). */
function heavyWeaponsCarried(player) {
  const ids = new Set();
  for (const item of player.getInventory().getItems()) {
    const each = definition(item);
    if (isHeavy(each) && isMeleeWeapon(each) && !NOT_BLINDBAG_WEAPONS.has(each.getName())) ids.add(each.getId());
  }
  return [...ids];
}

/** Tiles between two footprints (Common.distance); no tile or another plane counts as none. */
function distance(a, b) {
  const tiles = Common.distance(a, b);
  return Number.isFinite(tiles) ? tiles : 0;
}

const isMelee = (combatType) => combatType === core.CombatType.MELEE;
const isPlayerTarget = (target) => target?.isPlayer?.() === true;
const chance = (percent) => percent > 0 && Math.random() < percent / 100;

function heal(player, amount) {
  if (amount > 0) api.emitCustomEvent(PACT_HEAL_EVENT, { player, amount });
}

/** 26: an N% chance to heal the tiles between the player and the target. */
function distanceHeal(player, other) {
  if (chance(value(player, "distanceHealing"))) heal(player, distance(player, other));
}

/** 73, 77: the melee strength bonus the pacts add, at roll time. */
function meleeStrengthBonus(entity, strengthBonus) {
  if (!entity?.isPlayer?.()) return strengthBonus;
  const prayer = value(entity, "prayerStrength");
  const strength = value(entity, "strengthLevel");
  if (!prayer && !strength) return strengthBonus;
  let extra = 0;
  if (prayer) {
    const worn = Number(entity.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER]) || 0;
    extra += Math.floor(Math.max(0, worn) * PRAYER_STRENGTH_FRACTION * prayer);
  }
  const held = weapon(entity);
  if (strength && held !== null && (isLight(held) || !isTwoHanded(held))) {
    extra += Math.floor(entity.getSkillManager().getCurrentLevel(core.Skill.STRENGTH) * STRENGTH_LEVEL_FRACTION * strength);
  }
  return strengthBonus + extra;
}

/** 14: +1% melee max hit a node. */
function meleeMaxHit(entity, maxHit) {
  const percent = value(entity, "meleeDamage");
  return percent ? Math.floor((maxHit * (100 + percent)) / 100) : maxHit;
}

/** The overheal 67 spends: 5 hitpoints above the base level, if there are. */
/** Player -> the tick its overheal was last spent, and what that bought: once per attack, however many rolls it makes. */
const overhealSpent = new WeakMap();

function spendOverheal(player) {
  if (!value(player, "overheal")) return 0;
  const cycle = core.World.getProcessCycle?.() ?? 0;
  const spent = overhealSpent.get(player);
  // The same attack's other rolls (best-of rolls, a special's re-rolls) keep the bonus already paid for.
  if (spent?.cycle === cycle) return spent.bonus;
  const hitpoints = player.getHitpoints();
  const base = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  if (hitpoints - base < OVERHEAL_COST) return 0;
  player.setHitpoints(hitpoints - OVERHEAL_COST);
  overhealSpent.set(player, { cycle, bonus: OVERHEAL_MIN_HIT });
  return OVERHEAL_MIN_HIT;
}

/** 25, 67, 68, 70 (and 43's own range): the landed melee roll's new range, rolled again. */
function rolled(event) {
  const { attacker, target } = event;
  if (!isMelee(event.combatType) || !attacker?.isPlayer?.()) return;
  const own = building?.player === attacker ? building : null;
  if (own?.kind === "double") {
    const maximum = Math.max(1, Math.floor(event.maximum * DOUBLE_HIT_FRACTION));
    event.damage = core.Misc.randomInclusive(Math.min(event.minimum, maximum), maximum);
    return;
  }
  const tiles = distance(attacker, target);
  let percent = 0;
  const maxHitDistance = value(attacker, "distanceMaxHit");
  if (maxHitDistance) percent += maxHitDistance * (1 + Math.floor(tiles / MAX_HIT_DISTANCE_STEP));
  if (own?.kind === "blindbag") percent += Math.min(BLINDBAG_BONUS_CAP, own.uniques * value(attacker, "blindbagDamage"));
  let minimumBonus = 0;
  const minHit = value(attacker, "distanceMinHit");
  if (minHit) minimumBonus += minHit * Math.max(1, tiles);
  minimumBonus += spendOverheal(attacker);
  if (!percent && !minimumBonus) return;
  const maximum = Math.floor((event.maximum * (100 + percent)) / 100);
  // Not capped by the max hit (237/01098: Strength 1, unarmed, max hit 1, a landed hit of 3).
  const minimum = event.minimum + minimumBonus;
  const top = Math.max(maximum, minimum);
  event.damage = event.damage >= event.maximum && event.maximum > 0 ? top : core.Misc.randomInclusive(minimum, top);
  event.minimum = minimum;
  event.maximum = top;
}

/** 20, 69: the melee reach. */
function attackDistance(event) {
  const { attacker } = event;
  if (!isMelee(event.combatType) || !attacker?.isPlayer?.()) return;
  const multiplier = value(attacker, "rangeMultiplier");
  if (multiplier && isTwoHanded(weapon(attacker))) event.distance *= multiplier;
  if (value(attacker, "rangeBoost") && event.distance >= BOOSTED_RANGE_FROM && event.distance < BOOSTED_RANGE) event.distance = BOOSTED_RANGE;
}

/** 65, 69: light weapons a tick faster per point; halberds slower than 5 ticks at 5. */
function attackSpeed(event) {
  const { attacker } = event;
  if (!isMelee(event.combatType) || !attacker?.isPlayer?.()) return;
  if (value(attacker, "rangeBoost") && attacker.getWeapon?.() === core.WeaponInterfaces.HALBERD && event.speed > HALBERD_SPEED) {
    event.speed = HALBERD_SPEED;
  }
  const faster = value(attacker, "lightFaster");
  if (faster && isLight(weapon(attacker))) event.speed = Math.max(1, event.speed - faster);
}

/** Builds and queues an ordinary melee hit of this unit's (no armed special shapes it). */
function queueDerived(player, target, parent, kind, extra = {}) {
  building = { player, kind, ...extra };
  try {
    const hit = new core.PendingHit(player, target, core.CombatFactory.MELEE_COMBAT, { delay: parent.getDelay(), ordinary: true });
    derived.set(hit, kind);
    return hit;
  } finally {
    building = null;
  }
}

/** 44, 68, 72: an attack with a random heavy melee weapon from the inventory, as though wielded. */
function blindbag(player, target, parent) {
  const carried = heavyWeaponsCarried(player);
  if (carried.length === 0) return;
  const percent = value(player, "blindbag") + (value(player, "blindbagChance")
    ? Math.min(BLINDBAG_BONUS_CAP, carried.length * BLINDBAG_CHANCE_PER_WEAPON * value(player, "blindbagChance"))
    : 0);
  if (!chance(percent)) return;
  const depth = (chains.get(parent) ?? 0) + 1;
  if (depth > MAX_BLINDBAG_CHAIN) return;
  const equipment = player.getEquipment();
  const slot = core.Equipment.WEAPON_SLOT;
  const held = equipment.getItems()[slot];
  const chosen = carried[Math.floor(Math.random() * carried.length)];
  let hit;
  equipment.setItem(slot, new core.Item(chosen, 1));
  core.BonusManager.update(player);
  try {
    hit = queueDerived(player, target, parent, "blindbag", { uniques: carried.length });
  } finally {
    equipment.setItem(slot, held);
    core.BonusManager.update(player);
  }
  chains.set(hit, depth);
  core.CombatFactory.addPendingHit(hit);
}

/** A melee hit queued: once per attack, 26's heal, 43's extra hit and 44's Blindbag. */
/** A Ranged echo a two-handed melee pact fired is a melee hit, but no swing of the player's own (Ranged.LeaguePacts). */
function isRangedEcho(hit) {
  return require("./Ranged.LeaguePacts").isEcho(hit);
}

function dealt({ player, target, hit }) {
  if (!isMelee(hit?.getCombatType?.()) || !target || isRangedEcho(hit)) return;
  const kind = derived.get(hit);
  if (kind === "double") return;
  if (player.isSpecialActivated() && !kind) {
    specials.add(hit);
    return;
  }
  if (!kind) {
    const cycle = core.World.getProcessCycle();
    if (lastAttack.get(player) === cycle) return;
    lastAttack.set(player, cycle);
  }
  distanceHeal(player, target);
  const held = weapon(player);
  if (!kind && isLight(held) && value(player, "doubleHit")) core.CombatFactory.addPendingHit(queueDerived(player, target, hit, "double"));
  if (!isPlayerTarget(target) && (kind === "blindbag" || isHeavy(held)) && value(player, "blindbag")) blindbag(player, target, hit);
}

/** Thorns' damage: N, with 64's share of the defence bonuses. */
function thornsDamage(player) {
  return value(player, "thorns") + recoilBonus(player);
}

/** 64: N% of the summed defence bonuses. */
function recoilBonus(player) {
  const percent = value(player, "recoilScaling");
  if (!percent) return 0;
  const total = player.getBonusManager().getDefenceBonus().reduce((sum, each) => sum + each, 0);
  return Math.max(0, Math.floor((total * percent) / 100));
}

function reflect(player, attacker, damage) {
  const hit = new core.HitDamage(damage, core.HitMask.RED).markReflected().setSource(player);
  attacker.getCombat().getHitQueue().addPendingDamage([hit]);
  return hit;
}

/** 19, 84, 26: Thorns once per hitsplat of an NPC's attack, a second hit at 50%, and the heal chance. */
function thorns(player, attacker, hit) {
  if (!value(player, "thorns") || !hasShield(player) || !core.CombatFactory.canReceiveRecoil(attacker)) return;
  const damage = thornsDamage(player);
  const second = value(player, "thornsDouble") ? Math.floor(damage * THORNS_SECOND_FRACTION) : 0;
  const splats = Math.max(1, hit.getHits?.()?.length ?? 1);
  for (let i = 0; i < splats; i++) {
    if (attacker.getHitpoints() <= 0) return;
    thornsHits.add(reflect(player, attacker, damage));
    if (second > 0) thornsHits.add(reflect(player, attacker, second));
    distanceHeal(player, attacker);
  }
}

/** 75: an attack that dealt 0 with a two-handed shield or an off-hand: heal 2, restore 2 Prayer. */
function blockHeal(player, hit) {
  const points = value(player, "shieldBlockHeal");
  if (!points || hit.getTotalDamage() > 0 || !hasTwoHandedShieldOrOffhand(player)) return;
  heal(player, BLOCK_HEAL * points);
  const skills = player.getSkillManager();
  const { PRAYER } = core.Skill;
  const current = skills.getCurrentLevel(PRAYER);
  const max = skills.getMaxLevel(PRAYER);
  if (current < max) skills.setCurrentLevel(PRAYER, Math.min(max, current + BLOCK_PRAYER * points), true);
}

/** 66, 71: a landed melee hit's energy and its two-handed Ranged echo chance. */
function meleeLanded(player, target, hit) {
  const restore = value(player, "specRestore");
  if (restore) {
    const damaging = (hit.getHits?.() ?? []).filter((each) => each.getDamage() > 0).length;
    if (damaging > 0 && player.getSpecialPercentage() < 100) {
      player.incrementSpecialPercentage(restore * damaging);
      core.CombatSpecial.updateBar(player);
    }
  }
  const echoes = value(player, "echoes");
  if (!echoes || specials.has(hit) || isPlayerTarget(target) || target.getHitpoints?.() <= 0) return;
  if (!isTwoHanded(weapon(player)) || Math.random() >= ECHO_CHANCE * echoes) return;
  api.emitCustomEvent(RANGED_ECHO_EVENT, { player, target, source: "melee" });
}

function resolved({ attacker, target, hit }) {
  if (!hit || !attacker || !target) return;
  if (attacker.isPlayer?.() && isMelee(hit.getCombatType?.()) && !isRangedEcho(hit)) meleeLanded(attacker, target, hit);
  if (!target.isPlayer?.()) return;
  blockHeal(target, hit);
  if (attacker.isNpc?.()) thorns(target, attacker, hit);
}

/** 23: an NPC's hit on a shield wearer reflected whole, 0.1% per Defence level. */
function hitModify({ player, hit }) {
  const points = value(player, "shieldReflect");
  const attacker = hit.getAttacker?.();
  if (!points || !attacker?.isNpc?.() || !hasShield(player)) return;
  const damage = hit.getTotalDamage();
  if (damage <= 0) return;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.DEFENCE);
  if (Math.random() >= REFLECT_CHANCE_PER_LEVEL * level * points) return;
  for (const each of hit.getHits()) {
    each.setDamage(0);
    each.setHitmask(core.HitMask.BLUE);
  }
  hit.updateTotalDamage();
  if (core.CombatFactory.canReceiveRecoil(attacker)) reflect(player, attacker, damage);
}

/** 64: recoil from a ring of recoil or suffering lands with N% of the wearer's defence bonuses. */
function damageApply({ target, hit }) {
  if (!hit?.isReflected?.() || thornsHits.has(hit) || hit.getDamage() <= 0) return;
  const source = hit.getSource?.();
  if (!source?.isPlayer?.() || source === target) return;
  const ring = slotDefinition(source, core.Equipment.RING_SLOT);
  if (ring === null || !RECOIL_RING_NAME.test(ring.getName() ?? "")) return;
  const bonus = recoilBonus(source);
  if (bonus > 0) hit.setDamage(hit.getDamage() + bonus);
}


module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.registerMeleeStrengthBonusModifier(meleeStrengthBonus);
  api.registerMeleeHitModifier(meleeMaxHit);
  api.onCustomEvent("combat:hit-rolled", rolled);
  api.onCombatAttackDistance(attackDistance);
  api.onAttackSpeed(attackSpeed);
  api.onPlayerDealtDamage(dealt);
  api.onCombatHitResolved(resolved);
  api.onPlayerHitModify(hitModify);
  api.onCustomEvent("combat:damage-apply", damageApply);
};

module.exports._test = { meleeStrengthBonus, meleeMaxHit, distance, hasShield, hasTwoHandedShieldOrOffhand, isMeleeWeapon, heavyWeaponsCarried, thornsDamage, derived, MAX_BLINDBAG_CHAIN };
