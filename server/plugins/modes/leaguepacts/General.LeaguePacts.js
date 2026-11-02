/**
 * Demonic Pacts' general pact effects (Wiki Demonic_Pacts_League/Demonic_Pacts; the texts are the
 * cache's talent_tree column 2, the values its effect column, which the Wiki's numbers match; the
 * recordings 237/01158, 01163, 01170 and 238/01219, 01223 for the Defence boost). Each is the
 * summed value of the character's pacts for that effect (Common.effect), nothing for anyone else.
 *
 * PvP (Wiki): "Stat boosts, attack speed increases, and melee range increases apply, but effects
 * like Thorns, Echoes, and Blindbag do not work against players." Here accuracy (12), Defence
 * (13), the off-hand's stats (16), Regenerate (1) and free specials (24) apply; prayer penetration
 * (40), the max accuracy roll (57) and the style swap (76) do not (ours: the Wiki names neither);
 * special energy from range (62) does (ours).
 *
 * - 1 `talent_regen_ammo_chance`, Regenerate: a value% chance that what a cast, a shot or a charged
 *   weapon spends is not spent. Runes: the whole cast's runes (`magic:spell-cost` says which,
 *   `magic:rune-saving` saves them, `magic:cast-committed` confirms the cast); a cast that spends no
 *   rune (a staff covers it) has nothing to Regenerate. Ammunition: each shot rolled on
 *   `ranged:ammo-saving` (quivers, thrown weapons, chinchompas, blowpipe scales). Charges:
 *   `combat:consume-charge`. Each proc then emits `league:pact-regenerated` { player, kind "rune" |
 *   "ammo" | "charge", itemId (the rune or ammunition, -1 for a charge), amount, combat, spell?,
 *   spellId?, weaponId?, first? }, one per rune id for a cast (`first` on the cast's first, so a
 *   once-a-proc effect acts once). Ours: a proc saves the whole cast's runes (the text: "generate
 *   an additional resource spent").
 * - 12 `talent_all_style_accuracy`: +value% to the three attack rolls (the accuracy modifiers),
 *   summed with the small damage nodes' "+10% accuracy in all combat styles" each (7, 14, 15), so
 *   every pact's accuracy adds up.
 * - 13 `talent_defence_boost`: a permanent, visible Defence boost of value levels, as recorded
 *   (237/01170 and 238/01223 log in at Defence 114 with 99 and 15; 238/01219 keeps 114 through 27
 *   stat updates; 237/01158 shows 109, 118 with a potion, 99 after the reset): the current level
 *   rises by the boost, and the core's resting level (registerRestingLevelModifier) is base + boost,
 *   so boost decay stops there and natural restoration climbs back to it. Every roll reads the
 *   current level, so nothing more is added in them. A pact change (a buy, a reset, a login after
 *   one) moves the current level by the difference, kept in `league:pact-defence-applied`; a
 *   reset leaves a drained level as it is (ours).
 * - 16 `talent_offhand_stat_boost`: with an off-hand (Common.hasOffhand: a shield-slot item that
 *   is not a shield, as the block-heal pact's text tells them apart), +5 melee strength, +5 ranged
 *   strength and +2% magic damage (a bonus provider, so the equipment stats show it).
 * - 18 `talent_overhealing_via_talents`: `league:pact-heal` { player, amount } heals, up to base
 *   Hitpoints plus value% of it with this pact (the base otherwise), and sets `healed`. Every pact
 *   heal goes through it; the core's Hitpoints timer brings an overheal down.
 * - 24 `talent_spec_for_free`: value% of specials drain no energy (`combat-special:cost`, drain).
 * - 40 `talent_prayer_pen_all`: value% (at most 100) of what a protection prayer would block gets
 *   through. A target whose prayer the core keeps (PrayerHandler) takes that share of the part the
 *   prayer would take off (the rest still reduced as the core reduces it); for
 *   one whose plugin keeps it (demonic gorillas ask the hit's bypass) the hit bypasses the prayer on
 *   value% of rolls - the same damage on average. Not against players (ours, see PvP above).
 * - 57 `talent_max_accuracy_roll_from_range`: 5% of attacks, +5% a tile of distance (edge to edge,
 *   as combat reach counts it), roll the maximum attack roll against a random defence roll
 *   (onCombatHitRoll, once per attack); a failed max roll leaves the ordinary roll. Not against
 *   players (ours). Ours too: an echo or extra hit on a later tick rolls it again, as it does 62.
 * - 61 `talent_prayer_restore_no_overhead`: a task per character with the pact restores a Prayer point
 *   every 15 ticks, a tick less per 7 worn prayer bonus (at least 1), when no protection prayer is on
 *   at that tick. Started at login and on the unlock, it ends with the pact.
 * - 62 `talent_restore_sa_energy_from_distance`: an attack from 2 or more tiles restores 2% special
 *   energy (onCombatHitRoll, once per attack).
 * - 76 `talent_max_hit_style_swap`: a max hit (the roll's maximum, `combat:hit-rolled`) from 3 or more
 *   tiles makes the next hit landed in another style deal +25%, before the target's defences. Not
 *   against players.
 */
const Common = require("./Common.LeaguePacts");

const REGENERATE = "talent_regen_ammo_chance";
const ACCURACY = "talent_all_style_accuracy";
/** The small damage nodes, each also +10% accuracy in all combat styles (their text). */
const DAMAGE_NODE_EFFECTS = ["talent_percentage_magic_damage", "talent_percentage_melee_damage", "talent_percentage_ranged_damage"];
const ACCURACY_PER_DAMAGE_NODE = 10;
const DEFENCE_BOOST = "talent_defence_boost";
const OFFHAND = "talent_offhand_stat_boost";
const OVERHEAL = "talent_overhealing_via_talents";
const FREE_SPEC = "talent_spec_for_free";
const PRAYER_PENETRATION = "talent_prayer_pen_all";
const MAX_ACCURACY = "talent_max_accuracy_roll_from_range";
const PRAYER_RESTORE = "talent_prayer_restore_no_overhead";
const DISTANCE_SPEC = "talent_restore_sa_energy_from_distance";
const STYLE_SWAP = "talent_max_hit_style_swap";

/** The Defence the boost already added to the current level (13), saved with that level. */
const DEFENCE_APPLIED_ATTRIBUTE = "league:pact-defence-applied";
/** BonusManager's "other" bonuses start at 10 in the bonus array (melee, ranged, magic damage, prayer). */
const OTHER_BONUSES = 10;
const OFFHAND_MELEE_STRENGTH = 5;
const OFFHAND_RANGED_STRENGTH = 5;
const OFFHAND_MAGIC_DAMAGE = 2;
const MAX_ACCURACY_BASE = 5;
const MAX_ACCURACY_PER_TILE = 5;
const PRAYER_RESTORE_TICKS = 15;
const PRAYER_RESTORE_BONUS_STEP = 7;
const DISTANCE_SPEC_TILES = 2;
const DISTANCE_SPEC_ENERGY = 2;
const STYLE_SWAP_TILES = 3;
const STYLE_SWAP_PERCENT = 25;
const MAX_SPECIAL_ENERGY = 100;

let api;
let core;

/** Player -> the last `magic:spell-cost` request (its items are the cast's runes once the listeners are done). */
const spellCosts = new WeakMap();
/** Player -> the runes a Regenerate saved, until `magic:cast-committed`. */
const regenerating = new WeakMap();
/** Attacker -> the cycle of its last attack seen (57 and 62 act once an attack, not once a hitsplat). */
const maxAccuracyCycle = new WeakMap();
const maxAccuracyProc = new WeakMap();
const distanceSpecCycle = new WeakMap();
/** Attacker -> target whose protection prayer its last roll got through, for the damage share. */
const penetrating = new WeakMap();
/** Attacker -> the combat type of its last max hit from range (76). */
const styleSwap = new WeakMap();
/** Players with a prayer restore task running (61). */
const prayerTasks = new WeakMap();

function value(entity, effect) {
  return entity?.isPlayer?.() === true ? Common.effect(entity, effect) : 0;
}

function chance(percent) {
  return percent > 0 && Math.random() * 100 < percent;
}

function pvp(target) {
  return target?.isPlayer?.() === true;
}

const distance = (a, b) => Common.distance(a, b);

function emitRegenerated(payload) {
  api.emitCustomEvent("league:pact-regenerated", payload);
}

// ------------------------------------------------------------------ 1 Regenerate

function rememberSpellCost(cost) {
  if (cost?.player && value(cost.player, REGENERATE) > 0) spellCosts.set(cost.player, cost);
}

/** Rune id -> amount. */
function runeTotals(items) {
  const totals = new Map();
  for (const item of items ?? []) {
    const id = item?.getId?.() ?? item?.id;
    const amount = item?.getAmount?.() ?? item?.amount ?? 0;
    if (Number.isInteger(id) && id > 0 && amount > 0) totals.set(id, (totals.get(id) ?? 0) + amount);
  }
  return totals;
}

function regenerateRunes(request) {
  const player = request?.player;
  if (!player || request.saved) return;
  const cost = spellCosts.get(player);
  spellCosts.delete(player);
  const runes = runeTotals(cost?.items);
  if (runes.size === 0 || !chance(value(player, REGENERATE))) return;
  request.saved = true;
  regenerating.set(player, { spell: cost.spell, runes, combat: request.offensive === true });
}

function castCommitted({ player, spell, runesSaved }) {
  const saved = regenerating.get(player);
  if (!saved) return;
  regenerating.delete(player);
  if (!runesSaved || saved.spell !== spell) return;
  const spellId = spell?.spellId?.();
  const spellName = typeof spell?.name === "string" ? spell.name : undefined;
  let first = true;
  for (const [itemId, amount] of saved.runes) {
    emitRegenerated({ player, kind: "rune", itemId, amount, combat: saved.combat, spell, spellId, spellName, first });
    first = false;
  }
}

function regenerateAmmo(request) {
  const player = request?.player;
  const percent = value(player, REGENERATE);
  if (percent <= 0) return;
  const amount = Math.max(0, request.amount | 0);
  const saved = Math.min(amount, Math.max(0, request.saved | 0));
  let regenerated = 0;
  for (let shot = saved; shot < amount; shot++) if (chance(percent)) regenerated++;
  if (regenerated === 0) return;
  request.saved = saved + regenerated;
  // The shot's target and whether a special fired it (the ammo event carries neither; Ranged's echo needs both).
  const target = player.getCombat?.()?.getTarget?.() ?? null;
  emitRegenerated({ player, kind: "ammo", itemId: request.itemId ?? -1, amount: regenerated, combat: true, target, special: player.isSpecialActivated?.() === true });
}

function regenerateCharge(request) {
  const player = request?.player;
  if (!player || request.skip || !chance(value(player, REGENERATE))) return;
  request.skip = true;
  emitRegenerated({ player, kind: "charge", itemId: -1, weaponId: request.itemId ?? -1, amount: 1, combat: true });
}

// ------------------------------------------------------------------ 12 accuracy, 13 Defence, 16 off-hand

/**
 * Every pact's accuracy as one sum, so they add up rather than multiply: talent_all_style_accuracy's
 * percent, and each small magic, melee and ranged damage node's own "+10% accuracy in all combat
 * styles" (a node gives its damage effect 1, so the effect is the node count).
 */
function accuracy(entity, roll) {
  const nodes = DAMAGE_NODE_EFFECTS.reduce((sum, name) => sum + value(entity, name), 0);
  const percent = value(entity, ACCURACY) + nodes * ACCURACY_PER_DAMAGE_NODE;
  return percent > 0 ? Math.floor((roll * (100 + percent)) / 100) : roll;
}

/** 13: the level Defence rests at, base plus the boost. */
function restingLevel(player, skill, level) {
  if (skill !== core.Skill.DEFENCE) return level;
  return level + value(player, DEFENCE_BOOST);
}

/**
 * 13: the current Defence moved by what the boost changed since it was last applied. A rise adds
 * it; a fall takes it back only down to the new resting level (a drained level stays drained).
 */
function applyDefenceBoost(player) {
  if (!player?.isPlayer?.()) return;
  const boost = value(player, DEFENCE_BOOST);
  const applied = Number(player.getAttribute(DEFENCE_APPLIED_ATTRIBUTE)) || 0;
  if (boost === applied) return;
  const skills = player.getSkillManager();
  const { DEFENCE } = core.Skill;
  const current = skills.getCurrentLevel(DEFENCE);
  const delta = boost - applied;
  const next = delta > 0 ? current + delta : Math.max(current + delta, Math.min(current, skills.getMaxLevel(DEFENCE) + boost));
  player.setAttribute(DEFENCE_APPLIED_ATTRIBUTE, boost);
  if (next !== current) skills.setCurrentLevel(DEFENCE, Math.max(1, next), true);
}

function offhandBonuses({ player, bonuses }) {
  if (value(player, OFFHAND) <= 0 || !Common.hasOffhand(player)) return;
  bonuses[OTHER_BONUSES + core.BonusManager.STRENGTH] += OFFHAND_MELEE_STRENGTH;
  bonuses[OTHER_BONUSES + core.BonusManager.RANGED_STRENGTH] += OFFHAND_RANGED_STRENGTH;
  bonuses[OTHER_BONUSES + core.BonusManager.MAGIC_STRENGTH] += OFFHAND_MAGIC_DAMAGE;
}

// ------------------------------------------------------------------ 18 pact heals

/** `league:pact-heal` { player, amount } -> `healed`: what the heal added, overhealing with the pact. */
function pactHeal(request) {
  const player = request?.player;
  request.healed = 0;
  const amount = Math.max(0, Math.floor(Number(request?.amount) || 0));
  if (!player?.isPlayer?.() || amount === 0 || player.getHitpoints() <= 0) return;
  const skills = player.getSkillManager();
  const base = skills.getMaxLevel(core.Skill.HITPOINTS);
  const current = skills.getCurrentLevel(core.Skill.HITPOINTS);
  const cap = Math.max(current, base + Math.floor((base * value(player, OVERHEAL)) / 100));
  player.setHitpoints(Math.min(current + amount, cap));
  request.healed = Math.max(0, skills.getCurrentLevel(core.Skill.HITPOINTS) - current);
}

// ------------------------------------------------------------------ 24 free specials

function specialCost(request) {
  if (request?.phase !== "drain" || !(request.cost > 0)) return;
  if (chance(value(request.player, FREE_SPEC))) request.cost = 0;
}

// ------------------------------------------------------------------ 40 prayer penetration, 57, 62

function protects(target, combatType) {
  return core.PrayerHandler.isActivated(target, core.PrayerHandler.getProtectingPrayer(combatType));
}

function penetrate(roll, percent) {
  if (roll.bypassProtectionPrayer) return;
  const share = Math.min(100, percent);
  if (protects(roll.target, roll.combatType)) {
    roll.bypassProtectionPrayer = true;
    if (share < 100) penetrating.set(roll.attacker, roll.target);
  } else if (share >= 100 || chance(share)) {
    // A prayer the core does not keep (a plugin's): the hit bypasses it on that share of rolls.
    roll.bypassProtectionPrayer = true;
  }
}

function penetratedDamage({ attacker, target, damage }) {
  if (penetrating.get(attacker) !== target) return;
  penetrating.delete(attacker);
  const percent = Math.min(100, value(attacker, PRAYER_PENETRATION));
  // What the core leaves of a player's hit through a protection prayer (applyHitTimeDefences).
  const reduced = core.CombatConstants.PRAYER_DAMAGE_REDUCTION_AGAINST_PLAYERS;
  const factor = percent / 100 + (1 - percent / 100) * reduced;
  damage.setDamage(Math.floor(damage.getDamage() * factor));
}

/** Whether a maximum attack roll beats a random defence roll (the core's roll: attack > defence). */
function maxRollLands(attacker, target, combatType) {
  const rolls = core.AccuracyFormulasDpsCalc.specialRolls(attacker, target, combatType);
  return !!rolls && core.Misc.randomInclusive(0, Math.max(0, Math.floor(rolls.defence))) < rolls.attack;
}

function maxAccuracy(roll, tiles) {
  const cycle = core.World.getProcessCycle();
  if (maxAccuracyCycle.get(roll.attacker) !== cycle) {
    maxAccuracyCycle.set(roll.attacker, cycle);
    maxAccuracyProc.set(roll.attacker, chance(MAX_ACCURACY_BASE + MAX_ACCURACY_PER_TILE * tiles));
  }
  if (!roll.forceAccurate && maxAccuracyProc.get(roll.attacker) && maxRollLands(roll.attacker, roll.target, roll.combatType)) roll.forceAccurate = true;
}

function distanceSpecial(attacker) {
  const cycle = core.World.getProcessCycle();
  if (distanceSpecCycle.get(attacker) === cycle) return;
  distanceSpecCycle.set(attacker, cycle);
  const energy = attacker.getSpecialPercentage();
  if (energy >= MAX_SPECIAL_ENERGY) return;
  attacker.setSpecialPercentage(Math.min(MAX_SPECIAL_ENERGY, energy + DISTANCE_SPEC_ENERGY));
  core.CombatSpecial.updateBar(attacker);
}

function hitRoll(roll) {
  const { attacker, target } = roll ?? {};
  if (attacker?.isPlayer?.() !== true || !target || !Common.isPacts(attacker)) return;
  const tiles = distance(attacker, target);
  if (Common.effect(attacker, DISTANCE_SPEC) > 0 && tiles >= DISTANCE_SPEC_TILES && Number.isFinite(tiles)) distanceSpecial(attacker);
  if (pvp(target)) return;
  const penetration = Common.effect(attacker, PRAYER_PENETRATION);
  if (penetration > 0) penetrate(roll, penetration);
  if (Common.effect(attacker, MAX_ACCURACY) > 0 && Number.isFinite(tiles)) maxAccuracy(roll, tiles);
}

// ------------------------------------------------------------------ 76 style swap

function hitRolled(event) {
  const { attacker, target, combatType } = event ?? {};
  if (pvp(target) || value(attacker, STYLE_SWAP) <= 0) return;
  const original = event.damage;
  const pending = styleSwap.get(attacker);
  if (pending !== undefined && pending !== combatType && original > 0) {
    styleSwap.delete(attacker);
    event.damage = Math.floor((event.damage * (100 + STYLE_SWAP_PERCENT)) / 100);
  }
  if (event.maximum > 0 && original >= event.maximum && distance(attacker, target) >= STYLE_SWAP_TILES) styleSwap.set(attacker, combatType);
}

// ------------------------------------------------------------------ 61 prayer restore

function protectionActive(player) {
  const { PrayerHandler } = core;
  return [PrayerHandler.PROTECT_FROM_MELEE, PrayerHandler.PROTECT_FROM_MISSILES, PrayerHandler.PROTECT_FROM_MAGIC]
    .some((prayer) => PrayerHandler.isActivated(player, prayer));
}

function prayerRestoreTicks(player) {
  const bonus = Number(player.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER]) || 0;
  return Math.max(1, PRAYER_RESTORE_TICKS - Math.floor(Math.max(0, bonus) / PRAYER_RESTORE_BONUS_STEP));
}

function restorePrayer(player) {
  if (protectionActive(player)) return;
  const skills = player.getSkillManager();
  const max = skills.getMaxLevel(core.Skill.PRAYER);
  if (skills.getCurrentLevel(core.Skill.PRAYER) < max) skills.increaseCurrentLevel(core.Skill.PRAYER, 1, max);
}

function startPrayerRestore(player) {
  if (!player || prayerTasks.has(player) || value(player, PRAYER_RESTORE) <= 0) return;
  const { Task, TaskManager } = core;
  const task = new (class extends Task {
    constructor() {
      super(prayerRestoreTicks(player), player, false);
    }

    execute() {
      if (player.isRegistered?.() === false || value(player, PRAYER_RESTORE) <= 0) {
        prayerTasks.delete(player);
        this.stop();
        return;
      }
      restorePrayer(player);
      this.setDelay(prayerRestoreTicks(player));
    }
  })();
  prayerTasks.set(player, task);
  TaskManager.submit(task);
}

// ------------------------------------------------------------------ pacts changing

function refresh(player) {
  if (!player) return;
  applyDefenceBoost(player);
  core.BonusManager.update(player);
  startPrayerRestore(player);
}

function login({ player, league }) {
  if (Number(league) === Common.data.league) refresh(player);
}

function changed({ player }) {
  refresh(player);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onCustomEvent("magic:spell-cost", rememberSpellCost);
  api.onCustomEvent("magic:rune-saving", regenerateRunes);
  api.onCustomEvent("magic:cast-committed", castCommitted);
  api.onCustomEvent("ranged:ammo-saving", regenerateAmmo);
  api.onCustomEvent("combat:consume-charge", regenerateCharge);
  api.registerMeleeAttackAccuracyModifier(accuracy);
  api.registerRangedAttackAccuracyModifier(accuracy);
  api.registerMagicAttackAccuracyModifier(accuracy);
  api.persistAttribute(DEFENCE_APPLIED_ATTRIBUTE, 0);
  api.registerRestingLevelModifier(restingLevel);
  api.registerBonusProvider({ apply: offhandBonuses });
  api.onCustomEvent("league:pact-heal", pactHeal);
  api.onCustomEvent("combat-special:cost", specialCost);
  api.onCombatHitRoll(hitRoll);
  api.onCombatHitDamage(penetratedDamage);
  api.onCustomEvent("combat:hit-rolled", hitRolled);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:pact-unlocked", changed);
  api.onCustomEvent("league:pacts-reset", changed);
};
