/**
 * Demonic Pacts' ranged pacts (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Demonic_Pacts,
 * texts from the cache's talent_tree). Each acts only for a Demonic Pacts character with the pact
 * (Common.effect is 0 for anyone else). Weapon kinds come from the weapon's interface category
 * (bow 3, crossbow 5 with the ballistae and Karil's, thrown 19 with the blowpipe); the Eclipse
 * atlatl, a bow by its interface, counts as thrown and never as a bow (the pact texts).
 *
 * A Ranged echo (the pact texts) is an ordinary ranged attack (no special's traits, no ammo) of
 * the attacker's own accuracy against the target's ranged defence, queued at the arrow's flight
 * time, with the cache's leagues_6_echo_arrow projectile and leagues_6_ranged_mastery_vfx_left /
 * _right on the player (alternating, as the Raging Echoes melee echo did: no capture of either).
 * Never against a player, never from a special attack, and never from another echo except with
 * talent_ranged_echo_cyclical. Its XP is the usual (the Wiki does not say).
 *
 * - 8 talent_crossbow_echo_reproc_chance: a crossbow (or ballista) attack has the pact's % chance
 *   to fire an echo when its hit lands, hit or miss (onCombatHitResolved). Read as its own trigger;
 *   the text does not say whether it adds to the Regenerate trigger instead.
 * - 9 talent_bow_echo_pass_accuracy: with a bow, echoes never miss (onCombatHitRoll forceAccurate).
 * - 10 talent_thrown_maxhit_echoes: with a thrown weapon, echoes have the pact's % chance (20) to
 *   max hit (onCombatHitRoll forceMaxHit).
 * - 11 talent_ranged_regen_echo_chance: when ammo is Regenerated (`league:pact-regenerated`
 *   { player, kind: "ammo", target?, special? }), the pact's % chance to fire an echo at the
 *   payload's target, else the player's combat target.
 * - `league:pact-ranged-echo` { player, target, source, chance? }: one echo; source "melee"
 *   (talent_2h_melee_echos) rolls the player's melee accuracy and max hit against the target's
 *   ranged defence, and takes the bow and thrown echo pacts as if those were wielded.
 * - 15 talent_percentage_ranged_damage: +1% ranged max hit a node (registerRangedHitModifier),
 *   and each node's +10% accuracy in every style (General.LeaguePacts.js, summed with the rest).
 * - 17 talent_thrown_weapon_melee_str_scale: with a thrown weapon, ranged strength + 80% of the
 *   worn melee strength, rounded down (registerBonusProvider).
 * - 49 talent_ranged_strength_hp_difference: +1 ranged strength per 10 hitpoints between the
 *   current and the Hitpoints level (registerBonusProvider; the bonuses are refreshed before every
 *   ranged roll, so the max hit sees the current hitpoints; the equipment screen only on a change).
 * - 50 talent_crossbow_slow_big_hits: crossbows attack 2 ticks slower (onAttackSpeed) and their
 *   max hit is +70% (registerRangedHitModifier, after the % damage nodes).
 * - 51 talent_crossbow_max_hit: a crossbow hit that lands is a max hit (onCombatHitRoll forceMaxHit).
 * - 52 talent_ranged_echo_cyclical: an echo, when it lands, may fire another at half the chance
 *   that fired the first, up to four in a row (onCombatHitResolved).
 * - 53 talent_bow_fast_hits: bows attack a tick faster, never below 1 (onAttackSpeed).
 * - 55 talent_thrown_weapon_accuracy: with a thrown weapon, + the pact's ranged attack bonus (60)
 *   (registerBonusProvider).
 * - 56 talent_thrown_weapon_multi: a thrown attack (not a special) on an NPC throws once more at
 *   the nearest other NPC within 2 tiles of the target that a multi-target attack may hit
 *   (CombatFactory.canAttackSecondaryTarget), rolled on its own, with the weapon's projectile,
 *   when the attack's first hit is rolled (onCombatHitDamage). The radius is ours; no extra ammo.
 * - 58 talent_buffed_ranged_prayers: the ranged prayers' accuracy and strength boosts are 30%
 *   larger (Rigour 20% -> 26%, 23% -> 29.9%) (registerCombatEffectiveLevelModifier).
 * - 59 / 60 talent_bow_min_hit_stacking_increase / talent_bow_max_hit_stacking_increase: each
 *   landed bow hit (not an echo) adds a stack, up to 15% of the max hit without them; the max
 *   hit adds the stacks (registerRangedHitModifier), a roll below the stacks is raised to them
 *   (`combat:hit-rolled`); damage the player takes that its protection prayer did not or could
 *   not cover halves them (onCombatHitResolved). Sent in talent_bow_min_hit_stacks /
 *   talent_bow_max_hit_stacks, the counters the client shows.
 * - 82 talent_crossbow_double_accuracy_roll: a crossbow attack rolls accuracy a second time when
 *   the first misses (onCombatHitRoll: one roll of ours, then the core's).
 *
 * PvP (Wiki): stat boosts and attack speed apply; echoes never hit a player. Ours: the extra
 * throw, crossbow max hits and the second accuracy roll work against NPCs only too.
 *
 * Ours, beside the readings above: an echo's max hit is the ordinary ranged max hit; the
 * crossbow pact's echo chance is its own roll, not added to the Regenerate one's.
 */
const Common = require("./Common.LeaguePacts");

let core;

const BOW_CATEGORY = 3;
const CROSSBOW_CATEGORY = 5;
const THROWN_CATEGORY = 19;
const ECLIPSE_ATLATL = "Eclipse atlatl";

const ECHO_PROJECTILE = "leagues_6_echo_arrow";
const ECHO_GRAPHICS = ["leagues_6_ranged_mastery_vfx_left", "leagues_6_ranged_mastery_vfx_right"];
/** The usual arrow's projanim (RangedCombatMethod's default profile): delay 41, end 46 + 5 a tile. */
const ECHO_PROJECTILE_DELAY = 41;
const ECHO_PROJECTILE_LENGTH = 5;
const ECHO_PROJECTILE_STEP = 5;
const ECHO_PROJECTILE_HEIGHTS = [43, 31];
/** Echoes a cyclical chain may add after the first (the pact text: up to 4 times). */
const ECHO_CHAIN_LIMIT = 4;
/** talent_2h_melee_echos' chance (its text), for chains from a melee echo that names none. */
const MELEE_ECHO_CHANCE = 0.05;

const CROSSBOW_DAMAGE_PERCENT = 70;
const CROSSBOW_SLOWER_TICKS = 2;
const BOW_FASTER_TICKS = 1;
const MELEE_STRENGTH_SHARE = 0.8;
const HITPOINTS_PER_STRENGTH = 10;
const PRAYER_BOOST_PERMILLE = 1300;
const STACK_CAP_FRACTION = 0.15;
const EXTRA_THROW_RADIUS = 2;

/** BonusManager.update's bonus array: the five attack bonuses, the five defence ones, then the others. */
const OTHER_BONUSES = 10;
let RANGED_ATTACK_BONUS;
let MELEE_STRENGTH_BONUS;
let RANGED_STRENGTH_BONUS;
/** Player -> the hitpoints-difference strength its bonuses were last counted with. */
const hpStrengthCounted = new WeakMap();

/** Echo hits: { depth, chance, source }. */
const echoes = new WeakMap();
/** Hits rolled while a special attack was armed. */
const specialHits = new WeakSet();
/** Extra throws (talent_thrown_weapon_multi). */
const extraThrows = new WeakSet();
/** The echo or throw being built: its PendingHit rolls inside the constructor. */
let building = null;
/** Player -> which echo graphic it sent last. */
const graphicSide = new WeakMap();
/** Player -> { min, max } bow stacks. */
const bowStacks = new WeakMap();
/** Player -> the cycle of its last extra throw (one an attack). */
const lastThrow = new WeakMap();
/** The player whose max hit is measured without its bow stacks. */
let measuring = null;

const effect = (player, name) => (player?.isPlayer?.() ? Common.effect(player, name) : 0);

function weaponKind(player) {
  const weapon = player.getEquipment?.().getItems?.()[core.Equipment.WEAPON_SLOT];
  if (!weapon || weapon.getId() <= 0) return null;
  const definition = weapon.getDefinition?.() ?? core.ItemDefinition.forId(weapon.getId());
  if (definition?.getName?.() === ECLIPSE_ATLATL) return "thrown";
  const category = definition?.getWeaponInterface?.()?.getCategory?.() ?? player.getWeapon?.()?.getCategory?.();
  if (category === BOW_CATEGORY) return "bow";
  if (category === CROSSBOW_CATEGORY) return "crossbow";
  if (category === THROWN_CATEGORY) return "thrown";
  return null;
}

const wields = (player, kind) => player?.isPlayer?.() && weaponKind(player) === kind;
const isRanged = (type) => type === core.CombatType.RANGED;
const againstNpc = (target) => target?.isNpc?.() === true;

function prayerPercents(player) {
  const { PrayerHandler } = core;
  if (PrayerHandler.isActivated(player, PrayerHandler.SHARP_EYE)) return { accuracy: 105, damage: 105 };
  if (PrayerHandler.isActivated(player, PrayerHandler.HAWK_EYE)) return { accuracy: 110, damage: 110 };
  if (PrayerHandler.isActivated(player, PrayerHandler.EAGLE_EYE)) return { accuracy: 115, damage: 115 };
  if (PrayerHandler.isActivated(player, PrayerHandler.RIGOUR)) return { accuracy: 120, damage: 123 };
  return null;
}

/** talent_buffed_ranged_prayers: the prayer's share of the effective level, 30% larger. */
function rangedPrayerLevel(entity, level, context) {
  if (!isRanged(context?.combatType) || !effect(entity, "talent_buffed_ranged_prayers")) return level;
  const percents = prayerPercents(entity);
  if (!percents) return level;
  const percent = percents[context.purpose] ?? percents.accuracy;
  const visible = entity.getSkillManager().getCurrentLevel(core.Skill.RANGED);
  const prayed = Math.floor((visible * percent) / 100);
  const boosted = Math.floor((visible * (1000 + ((percent - 100) * PRAYER_BOOST_PERMILLE) / 100)) / 1000);
  return level + boosted - prayed;
}


function stacksOf(player) {
  let stacks = bowStacks.get(player);
  if (!stacks) bowStacks.set(player, (stacks = { min: 0, max: 0 }));
  return stacks;
}

/** The ranged max hit: the bow stacks (capped at 15% of it), the % damage nodes, then crossbows' +70%. */
function rangedMaxHit(entity, maxHit) {
  if (!entity?.isPlayer?.() || measuring === entity) return maxHit;
  let hit = maxHit;
  if (effect(entity, "talent_bow_max_hit_stacking_increase") && wields(entity, "bow")) {
    hit += Math.min(stacksOf(entity).max, Math.floor(maxHit * STACK_CAP_FRACTION));
  }
  const percent = effect(entity, "talent_percentage_ranged_damage");
  if (percent) hit = Math.floor((hit * (100 + percent)) / 100);
  if (effect(entity, "talent_crossbow_slow_big_hits") && wields(entity, "crossbow")) {
    hit = Math.floor((hit * (100 + CROSSBOW_DAMAGE_PERCENT)) / 100);
  }
  return hit;
}

/** Thrown weapons' accuracy and melee-strength share, and the hitpoints difference's strength. */
function applyBonuses({ player, bonuses }) {
  if (!player?.isPlayer?.()) return;
  if (wields(player, "thrown")) {
    bonuses[RANGED_ATTACK_BONUS] += effect(player, "talent_thrown_weapon_accuracy");
    if (effect(player, "talent_thrown_weapon_melee_str_scale")) {
      bonuses[RANGED_STRENGTH_BONUS] += Math.floor(Math.max(0, bonuses[MELEE_STRENGTH_BONUS]) * MELEE_STRENGTH_SHARE);
    }
  }
  if (effect(player, "talent_ranged_strength_hp_difference")) {
    const strength = hpStrength(player);
    hpStrengthCounted.set(player, strength);
    bonuses[RANGED_STRENGTH_BONUS] += strength;
  }
}

/** talent_ranged_strength_hp_difference: +1 ranged strength per 10 hitpoints between current and level. */
function hpStrength(player) {
  const skills = player.getSkillManager();
  return Math.floor(Math.abs(skills.getCurrentLevel(core.Skill.HITPOINTS) - skills.getMaxLevel(core.Skill.HITPOINTS)) / HITPOINTS_PER_STRENGTH);
}

function attackSpeed(event) {
  const { attacker } = event;
  if (!isRanged(event.combatType) || !attacker?.isPlayer?.()) return;
  const kind = weaponKind(attacker);
  if (kind === "crossbow" && effect(attacker, "talent_crossbow_slow_big_hits")) event.speed += CROSSBOW_SLOWER_TICKS;
  if (kind === "bow" && effect(attacker, "talent_bow_fast_hits")) event.speed = Math.max(1, event.speed - BOW_FASTER_TICKS);
}

/** Every roll: an echo's own pacts, crossbows' max hit and second accuracy roll, and the hitpoints strength. */
function hitRoll(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.()) return;
  if (building?.echo && building.player === attacker) {
    const asMelee = building.source === "melee";
    if (effect(attacker, "talent_bow_echo_pass_accuracy") && (asMelee || wields(attacker, "bow"))) event.forceAccurate = true;
    const maxChance = effect(attacker, "talent_thrown_maxhit_echoes");
    if (maxChance && (asMelee || wields(attacker, "thrown")) && Math.random() < maxChance / 100) event.forceMaxHit = true;
  }
  if (!isRanged(event.combatType)) return;
  // The bonuses are counted again only when the hitpoints have moved the strength since the last count.
  if (effect(attacker, "talent_ranged_strength_hp_difference") && hpStrengthCounted.get(attacker) !== hpStrength(attacker)) {
    core.BonusManager.update(attacker);
  }
  if (!againstNpc(target) || !wields(attacker, "crossbow")) return;
  if (effect(attacker, "talent_crossbow_max_hit")) event.forceMaxHit = true;
  if (!event.forceAccurate && effect(attacker, "talent_crossbow_double_accuracy_roll")
    && core.AccuracyFormulasDpsCalc.rollAccuracy(attacker, target, core.CombatType.RANGED)) {
    event.forceAccurate = true;
  }
}

/** The bow's minimum-hit stacks raise a roll below them, before the target's defences. */
function hitRolled(event) {
  const { attacker } = event;
  if (!isRanged(event.combatType) || !effect(attacker, "talent_bow_min_hit_stacking_increase") || !wields(attacker, "bow")) return;
  const floor = Math.min(stacksOf(attacker).min, event.maximum);
  if (event.damage < floor) event.damage = floor;
}

/** Marks special-attack hits, and throws the extra thrown attack with the first hit of one. */
function hitDamage(event) {
  const { attacker, target, hit } = event;
  if (!attacker?.isPlayer?.() || !hit) return;
  if (attacker.isSpecialActivated?.()) {
    specialHits.add(hit);
    return;
  }
  if (building || !isRanged(event.combatType) || !againstNpc(target)) return;
  if (!effect(attacker, "talent_thrown_weapon_multi") || !wields(attacker, "thrown")) return;
  const cycle = core.World.getProcessCycle();
  if (lastThrow.get(attacker) === cycle) return;
  lastThrow.set(attacker, cycle);
  const extra = nearestOtherTarget(attacker, target);
  if (extra) throwAt(attacker, extra);
}

function nearestOtherTarget(player, target) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of core.World.getNpcsNear(target.getLocation(), EXTRA_THROW_RADIUS, target.getPrivateArea?.() ?? null)) {
    if (candidate === target || !core.CombatFactory.canAttackSecondaryTarget(player, target, candidate, EXTRA_THROW_RADIUS)) continue;
    const distance = candidate.getLocation().getDistance(target.getLocation());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function build(context, create) {
  const previous = building;
  building = context;
  try {
    return create();
  } finally {
    building = previous;
  }
}

function hitDelay(player, target) {
  const distance = player.getLocation().getDistance(target.getLocation());
  return core.WeaponProfiles.hitDelays(player, distance)[0] ?? 1;
}

/** The extra thrown attack: the weapon's own projectile and flight time, its own rolls. */
function throwAt(player, target) {
  const { CombatFactory, PendingHit, Projectile, RangedCombatMethod, WeaponProfiles } = core;
  const extra = build({ player, throw: true }, () =>
    new PendingHit(player, target, CombatFactory.RANGED_COMBAT, { delay: hitDelay(player, target), ordinary: true }));
  extraThrows.add(extra);
  CombatFactory.addPendingHit(extra);
  const profile = WeaponProfiles.ranged(player);
  const projectileId = profile?.projectileId ?? player.getCombat().getAmmunition?.()?.getProjectileId?.();
  const projectile = profile?.projectiles?.[0];
  if (projectileId == null || projectileId < 0 || !projectile) return;
  const distance = player.getLocation().getDistance(target.getLocation());
  Projectile.createProjectile(player, target, projectileId, projectile.delay, RangedCombatMethod.projectileEnd(projectile, distance),
    projectile.startHeight, projectile.endHeight).sendProjectile();
}

let meleeEchoMethod = null;

/** A melee echo: the melee method's rolls against the target's ranged defence. */
function meleeEcho() {
  if (meleeEchoMethod) return meleeEchoMethod;
  class MeleeEchoMethod extends core.MeleeCombatMethod {
    accuracyDefenceType() {
      return core.CombatType.RANGED;
    }
  }
  meleeEchoMethod = new MeleeEchoMethod();
  return meleeEchoMethod;
}

/** Fires one Ranged echo at an NPC: { source, chance (that fired it), depth (echoes before it) }. */
function fireEcho(player, target, { source = "ranged", chance = 0, depth = 0 } = {}) {
  if (!player?.isPlayer?.() || !againstNpc(target) || target.getHitpoints() <= 0) return null;
  const { CombatFactory, PendingHit, Projectile, CacheDefinitions, Graphic } = core;
  const method = source === "melee" ? meleeEcho() : CombatFactory.RANGED_COMBAT;
  const distance = player.getLocation().getDistance(target.getLocation());
  const echo = build({ player, echo: true, source }, () =>
    new PendingHit(player, target, method, { delay: 1 + Math.floor((3 + distance) / 6), ordinary: true }));
  echoes.set(echo, { depth, chance, source });
  CombatFactory.addPendingHit(echo);
  const side = graphicSide.get(player) ?? 0;
  graphicSide.set(player, side + 1);
  const graphic = CacheDefinitions.getSpotanimId(ECHO_GRAPHICS[side % ECHO_GRAPHICS.length]);
  if (graphic !== null) player.performGraphic(new Graphic(graphic));
  const projectile = CacheDefinitions.getSpotanimId(ECHO_PROJECTILE);
  if (projectile !== null) {
    Projectile.createProjectile(player, target, projectile, ECHO_PROJECTILE_DELAY,
      ECHO_PROJECTILE_DELAY + ECHO_PROJECTILE_LENGTH + ECHO_PROJECTILE_STEP * distance,
      ECHO_PROJECTILE_HEIGHTS[0], ECHO_PROJECTILE_HEIGHTS[1]).sendProjectile();
  }
  return echo;
}

function rollEcho(player, target, chance, source = "ranged") {
  if (chance > 0 && Math.random() < chance) fireEcho(player, target, { source, chance });
}

/** A hit landed: echo chains, crossbow echoes, bow stacks; and on the player, the halving. */
function hitResolved({ attacker, target, hit }) {
  if (target?.isPlayer?.()) halveStacks(target, hit);
  if (!attacker?.isPlayer?.() || !hit) return;
  const echo = echoes.get(hit);
  if (echo) {
    if (effect(attacker, "talent_ranged_echo_cyclical") && echo.depth < ECHO_CHAIN_LIMIT && againstNpc(target) && target.getHitpoints() > 0
      && Math.random() < echo.chance / 2) {
      fireEcho(attacker, target, { source: echo.source, chance: echo.chance, depth: echo.depth + 1 });
    }
    return;
  }
  if (!isRanged(hit.getCombatType()) || specialHits.has(hit) || extraThrows.has(hit)) return;
  const kind = weaponKind(attacker);
  if (kind === "bow" && hit.isAccurate()) addStack(attacker);
  if (kind !== "crossbow" || !againstNpc(target) || target.getHitpoints() <= 0) return;
  rollEcho(attacker, target, effect(attacker, "talent_crossbow_echo_reproc_chance") / 100);
}

function addStack(player) {
  const min = effect(player, "talent_bow_min_hit_stacking_increase");
  const max = effect(player, "talent_bow_max_hit_stacking_increase");
  if (!min && !max) return;
  measuring = player;
  let base;
  try {
    base = core.DamageFormulas.calculateMaxRangedHit(player);
  } finally {
    measuring = null;
  }
  const cap = Math.floor(base * STACK_CAP_FRACTION);
  const stacks = stacksOf(player);
  if (min) stacks.min = Math.min(cap, stacks.min + 1);
  if (max) stacks.max = Math.min(cap, stacks.max + 1);
  sendStacks(player);
}

/** Damage its protection prayer did not (or could not) stop halves the bow stacks. */
function halveStacks(player, hit) {
  const stacks = bowStacks.get(player);
  if (!stacks || (!stacks.min && !stacks.max) || !(hit?.getTotalDamage?.() > 0)) return;
  if (!hit.bypassesProtectionPrayer?.() && prayedAgainst(player, hit.getProtectionType?.() ?? hit.getCombatType?.())) return;
  stacks.min = Math.floor(stacks.min / 2);
  stacks.max = Math.floor(stacks.max / 2);
  sendStacks(player);
}

function prayedAgainst(player, type) {
  const { CombatType, PrayerHandler } = core;
  if (type !== CombatType.MELEE && type !== CombatType.RANGED && type !== CombatType.MAGIC) return false;
  return PrayerHandler.isActivated(player, PrayerHandler.getProtectingPrayer(type));
}

function sendStacks(player) {
  const stacks = bowStacks.get(player) ?? { min: 0, max: 0 };
  const sender = player.getPacketSender();
  sender.sendVarbit(core.CacheDefinitions.getVarbitId("talent_bow_min_hit_stacks"), stacks.min);
  sender.sendVarbit(core.CacheDefinitions.getVarbitId("talent_bow_max_hit_stacks"), stacks.max);
}

/** talent_ranged_regen_echo_chance: Regenerated ammo may fire an echo (never from a special). */
function regenerated({ player, kind, target, special }) {
  if (kind !== "ammo" || special || player?.isSpecialActivated?.()) return;
  const chance = effect(player, "talent_ranged_regen_echo_chance") / 100;
  if (chance > 0) rollEcho(player, target ?? player.getCombat().getTarget(), chance);
}

/** Another unit's echo (talent_2h_melee_echos sends source "melee"). */
function rangedEcho({ player, target, source = "ranged", chance }) {
  if (!player?.isPlayer?.() || !Common.isPacts(player)) return;
  fireEcho(player, target, { source, chance: chance ?? (source === "melee" ? MELEE_ECHO_CHANCE : 0) });
}

/** The bonuses follow the pacts; the stacks start empty. */
function pactsChanged({ player }) {
  if (!player?.isPlayer?.()) return;
  bowStacks.delete(player);
  core.BonusManager.update(player);
  if (Common.isPacts(player)) sendStacks(player);
}

module.exports = function attach(api) {
  core = api.core;
  RANGED_ATTACK_BONUS = core.BonusManager.ATTACK_RANGE;
  MELEE_STRENGTH_BONUS = OTHER_BONUSES + core.BonusManager.STRENGTH;
  RANGED_STRENGTH_BONUS = OTHER_BONUSES + core.BonusManager.RANGED_STRENGTH;
  api.registerCombatEffectiveLevelModifier(rangedPrayerLevel);
  api.registerRangedHitModifier(rangedMaxHit);
  api.registerBonusProvider({ apply: applyBonuses });
  api.onAttackSpeed(attackSpeed);
  api.onCombatHitRoll(hitRoll);
  api.onCustomEvent("combat:hit-rolled", hitRolled);
  api.onCombatHitDamage(hitDamage);
  api.onCombatHitResolved(hitResolved);
  api.onCustomEvent("league:pact-regenerated", regenerated);
  api.onCustomEvent("league:pact-ranged-echo", rangedEcho);
  api.onCustomEvent("league:pact-unlocked", pactsChanged);
  api.onCustomEvent("league:pacts-reset", pactsChanged);
  api.onCustomEvent("league:login", pactsChanged);
};

module.exports.isEcho = (hit) => echoes.has(hit);
