const {
  restoreRunEnergy,
  curePoisonAndVenom,
  curePoison,
  boostSkill,
  lowerSkillByCurrent,
  lowerSkillByMax,
  restoreSkillToBaseWithFormula,
} = require("./ConsumableEffects");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { EffectTimer } = require("../../src/main/typescript/elvarg/game/model/EffectTimer");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { ItemIdentifiers: Items } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const {
  DragonfireProtectionTier,
  processDragonfireProtection,
  setDragonfireProtection,
  initDragonfireProtectionCoreAccess,
} = require("../combat/DragonfireProtection");

let pluginApi;

const DRINK_ANIMATION = new Animation(829);
const DEFAULT_EMPTY_ITEM = ItemIds.VIAL;
const NO_EMPTY_ITEM = -1;
/** Barcrawl reward: the guard's automatic vial-smashing toggle (barbarian guard). */
const AUTO_SMASH_VIALS_VARBIT = 5668;
const STAMINA_DURATION_MS = 2 * 60 * 1000;
/** Extended stamina potion (Wiki): 40% run energy and a 4-minute drain cut per dose. */
const EXTENDED_STAMINA_ENERGY = 40;
const EXTENDED_STAMINA_DURATION_MS = 4 * 60 * 1000;
/** A ring of endurance spends one charge per stamina dose and two per extended dose (Wiki). */
const EXTENDED_STAMINA_RING_CHARGES = 2;
const DIVINE_DURATION_MS = 5 * 60 * 1000;
const OVERLOAD_DURATION_MS = 5 * 60 * 1000;
const OVERLOAD_REFRESH_MS = 15 * 1000;
const OVERLOAD_DAMAGE_INTERVAL_MS = 600;

const ATTR_STAMINA_END = "potions:stamina:end";
const ATTR_STAMINA_ACC = "potions:stamina:acc";
const ATTR_DIVINE_STATE = "potions:divine:state";
const ATTR_OVERLOAD_STATE = "potions:overload:state";
const ATTR_MENAPHITE_STATE = "potions:menaphite:state";
const ATTR_PRAYER_REGEN_STATE = "potions:prayer-regen:state";
const ATTR_PRAYER_ENHANCE = "potions:prayer-enhance";
/** Prayer enhance: a prayer point every 6 ticks. */
const PRAYER_ENHANCE_INTERVAL_MS = 6 * 600;
/** Areas a potion can be limited to, and what a player is told outside them. */
const AREA_MESSAGES = { "chambers-of-xeric": "You can only sip this potion while inside the Chambers of Xeric." };
/** Shared 60-second cycle that decays every temporary skill boost by one (Wiki). */
const ATTR_BOOST_CYCLE = "potions:boost-cycle";
/** Whether Preserve has already stretched the current boost cycle. */
const ATTR_BOOST_CYCLE_PRESERVED = "potions:boost-cycle-preserved";
/** When Preserve was last switched on. */
const ATTR_PRESERVE_SINCE = "potions:preserve-since";
/** When the player logged out; timed effects are paused while offline. */
const ATTR_PAUSED_AT = "potions:paused-at";
const PERSISTED_ATTRIBUTES = [ATTR_STAMINA_END, ATTR_STAMINA_ACC, ATTR_DIVINE_STATE, ATTR_OVERLOAD_STATE, ATTR_MENAPHITE_STATE, ATTR_PRAYER_REGEN_STATE, ATTR_PRAYER_ENHANCE, ATTR_BOOST_CYCLE, ATTR_PAUSED_AT];

const BOOST_DECAY_MS = 60 * 1000;
/** Wiki (Temporary skill boost): Preserve stretches the cycle to 90 seconds once it has been on 15. */
const PRESERVE_EXTENSION_MS = 30 * 1000;
const PRESERVE_WARMUP_MS = 15 * 1000;
const MENAPHITE_DURATION_MS = 5 * 60 * 1000;
const MENAPHITE_RESTORE_INTERVAL_MS = 15 * 1000;
const PRAYER_REGEN_DURATION_MS = 8 * 60 * 1000;
/** Wiki: one Prayer point every 12 ticks (7.2s) for 8 minutes, 66 points total. */
const PRAYER_REGEN_INTERVAL_MS = 12 * 600;

const POTION_BY_ITEM_ID = new Map();
const REGISTERED_POTIONS = [];

function isItemId(value) {
  return Number.isInteger(value) && value > 0;
}

function byKey(key) {
  const value = ItemIds[key];
  return isItemId(value) ? value : null;
}

function doseChain(...keys) {
  return keys.map(byKey).filter(isItemId);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSkillManager(player) {
  return player.getSkillManager();
}

function getMaxLevel(player, skill) {
  return getSkillManager(player).getMaxLevel(skill);
}

function getCurrentLevel(player, skill) {
  return getSkillManager(player).getCurrentLevel(skill);
}

function setCurrentLevel(player, skill, level) {
  getSkillManager(player).setCurrentLevels(skill, level);
}

function heal(player, amount, extraCap = 0) {
  const current = getCurrentLevel(player, Skill.HITPOINTS);
  const baseMax = getMaxLevel(player, Skill.HITPOINTS);
  const max = Math.max(current, baseMax + Math.max(0, extraCap));
  player.setHitpoints(clamp(current + amount, 0, max));
}

function damageButKeepAlive(player, amount) {
  const current = getCurrentLevel(player, Skill.HITPOINTS);
  const next = Math.max(1, current - Math.max(0, amount));
  player.setHitpoints(next);
}

function applyPoisonImmunity(player, seconds, message = true, fullVenomCure = false) {
  if (player.isVenomed() && !fullVenomCure) {
    curePoison(player);
    if (message) player.sendMessage("The potion weakens the venom to poison.");
    return;
  }
  curePoisonAndVenom(player);
  // Wiki (7 April 2016): drinking any kind of antipoison will no longer
  // decrease your poison immunity, so a weaker dose never shortens the timer.
  const timer = player.getCombat().getPoisonImmunityTimer();
  const remaining = timer.secondsRemaining();
  if (remaining < seconds) {
    timer.start(seconds);
  }
  if (message) {
    player.sendMessage(`You are now immune to poison for another ${Math.max(remaining, seconds)} seconds.`);
  }
}

function applyAntifire(player, seconds, tier = DragonfireProtectionTier.ANTIFIRE, label = "antifire potion") {
  setDragonfireProtection(player, { tier, seconds, label });
  player.getPacketSender().sendEffectTimer(seconds, EffectTimer.ANTIFIRE);
}

const PRAYER_BONUS_WORN = [
  Items.RING_OF_THE_GODS_I_, Items.RING_OF_THE_GODS_I__2, Items.RING_OF_THE_GODS_I__3,
  Items.RING_OF_THE_GODS_I__4, Items.RING_OF_THE_GODS_I__5, Items.RING_OF_THE_GODS_I__6,
];

/** Wiki: a ring of the gods (i), a carried holy wrench, or a Prayer cape (or max cape) worn or
 * carried - it acts as a holy wrench - boosts prayer restores. */
function hasPrayerRestoreBonus(player) {
  const cape = { player, skill: "PRAYER", inventory: true, result: false };
  pluginApi?.emitCustomEvent("skillcape:has-perk", cape);
  return cape.result === true || player.getInventory?.()?.contains?.(Items.HOLY_WRENCH) === true ||
    PRAYER_BONUS_WORN.some((itemId) => player.getEquipment?.()?.contains?.(itemId) === true);
}

/** Prayer potion: 7 + 25% (27% with the bonus); super restore: 8 + 25% (27%). */
function applyPrayerRestore(player, isSuperRestore) {
  restorePrayer(player, isSuperRestore ? 8 : 7, hasPrayerRestoreBonus(player) ? 0.27 : 0.25);
}

function restorePrayer(player, flat, percent) {
  const max = getMaxLevel(player, Skill.PRAYER);
  const restored = Math.floor(flat + max * percent);
  const cap = Math.max(max, getCurrentLevel(player, Skill.PRAYER));
  getSkillManager(player).increaseCurrentLevel(Skill.PRAYER, restored, cap);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
}

/** Sanfew serum (Wiki): 4 + 30% to every stat, prayer 4 + 30% (32% with the bonus). */
function applySanfewRestore(player) {
  restorePrayer(player, 4, hasPrayerRestoreBonus(player) ? 0.32 : 0.3);
  for (const skill of Skill.values()) {
    if (skill === Skill.HITPOINTS || skill === Skill.PRAYER) {
      continue;
    }
    restoreSkillToBaseWithFormula(player, skill, 4, 0.3);
  }
}

function applyRestorePotion(player) {
  for (const skill of [Skill.ATTACK, Skill.DEFENCE, Skill.STRENGTH, Skill.RANGED, Skill.MAGIC]) {
    restoreSkillToBaseWithFormula(player, skill, 10, 0.3);
  }
}

function applySuperRestore(player) {
  applyPrayerRestore(player, true);
  for (const skill of Skill.values()) {
    if (skill === Skill.HITPOINTS || skill === Skill.PRAYER) {
      continue;
    }
    restoreSkillToBaseWithFormula(player, skill, 8, 0.25);
  }
}

function applySaradominBrew(player) {
  const hpBoost = Math.floor(2 + getMaxLevel(player, Skill.HITPOINTS) * 0.15);

  boostSkill(player, Skill.DEFENCE, 2, 0.2);
  heal(player, hpBoost, hpBoost);

  lowerSkillByCurrent(player, Skill.ATTACK, 2, 0.1, 0);
  lowerSkillByCurrent(player, Skill.STRENGTH, 2, 0.1, 0);
  lowerSkillByCurrent(player, Skill.RANGED, 2, 0.1, 0);
  lowerSkillByCurrent(player, Skill.MAGIC, 2, 0.1, 0);
}

/** Vampyrium supplies follow the same stat formulas as their Wiki equivalents. */
function applyRankFrothyPotion(player) {
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) {
    boostSkill(player, skill, 5, 0.15);
  }
}

function applyFoulChunkyPotion(player) {
  applySuperRestore(player);
  applyPrayerRegeneration(player);
}

function applyRancidSlimyPotion(player) {
  const hpBoost = Math.floor(2 + getMaxLevel(player, Skill.HITPOINTS) * 0.15);
  boostSkill(player, Skill.DEFENCE, 2, 0.2);
  heal(player, hpBoost, hpBoost);
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.MAGIC, Skill.RANGED]) {
    lowerSkillByCurrent(player, skill, 1, 0);
  }
}

function applyJarOfCongealedBlood(player) {
  for (const skill of [Skill.HITPOINTS, Skill.PRAYER]) {
    const max = getMaxLevel(player, skill);
    if (getCurrentLevel(player, skill) < max) setCurrentLevel(player, skill, max);
  }
  restoreRunEnergy(player, 100);
}

/** `hpDamage(currentHp)` is the brew's Hitpoints cost; the Zamorak mix passes its own (Wiki). */
function applyZamorakBrew(player, hpDamage = (hp) => Math.floor(2 + hp * 0.1)) {
  boostSkill(player, Skill.ATTACK, 2, 0.2);
  boostSkill(player, Skill.STRENGTH, 2, 0.12);

  lowerSkillByMax(player, Skill.DEFENCE, 2, 0.1, 0);

  damageButKeepAlive(player, hpDamage(getCurrentLevel(player, Skill.HITPOINTS)));

  const maxPrayer = getMaxLevel(player, Skill.PRAYER);
  const prayerBoost = Math.floor(maxPrayer * 0.1);
  getSkillManager(player).increaseCurrentLevel(Skill.PRAYER, prayerBoost, maxPrayer);
}

function applyGuthixRest(player) {
  const current = getCurrentLevel(player, Skill.HITPOINTS);
  const base = getMaxLevel(player, Skill.HITPOINTS);
  const extraCap = current >= base ? 5 : 0;
  if (current < base + extraCap) heal(player, 5, extraCap);
  restoreRunEnergy(player, 5);
  curePoison(player, 1);
}

/** Prayer restore that may over-heal by up to `overPercent` above base (ancient/forgotten brew). */
function restorePrayerOverheal(player, flat, percent, overPercent = 0.05) {
  const max = getMaxLevel(player, Skill.PRAYER);
  const cap = max + Math.floor(max * overPercent);
  const restored = Math.floor(flat + max * percent);
  getSkillManager(player).increaseCurrentLevel(Skill.PRAYER, restored, cap);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
}

/** Ancient brew / forgotten brew (Wiki): Magic boost, prayer restore and an Attack/Strength/Defence drain. */
function applyAncientBrew(player, magicFlat, magicPercent) {
  boostSkill(player, Skill.MAGIC, magicFlat, magicPercent);
  restorePrayerOverheal(player, 2, 0.1);
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) {
    lowerSkillByCurrent(player, skill, 2, 0.1);
  }
}

const MENAPHITE_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS];

/** Menaphite remedy (Wiki): 6 + 16% of every combat stat, never above base. */
function restoreCombatStats(player) {
  for (const skill of MENAPHITE_SKILLS) {
    const max = getMaxLevel(player, skill);
    if (getCurrentLevel(player, skill) >= max) {
      continue;
    }
    getSkillManager(player).increaseCurrentLevel(skill, Math.floor(max * 0.16) + 6, max);
  }
}

function applyMenaphiteRemedy(player) {
  // Dispels locked divine boosts so they decay normally (Wiki).
  player.setAttribute(ATTR_DIVINE_STATE, null);
  restoreCombatStats(player);
  const now = Date.now();
  player.setAttribute(ATTR_MENAPHITE_STATE, {
    endsAt: now + MENAPHITE_DURATION_MS,
    nextRestoreAt: now + MENAPHITE_RESTORE_INTERVAL_MS,
  });
}

function processMenaphite(player) {
  const state = player.getAttribute(ATTR_MENAPHITE_STATE);
  if (!state) {
    return;
  }
  const now = Date.now();
  if (now >= state.endsAt) {
    player.setAttribute(ATTR_MENAPHITE_STATE, null);
    return;
  }
  if (now >= state.nextRestoreAt) {
    restoreCombatStats(player);
    state.nextRestoreAt = now + MENAPHITE_RESTORE_INTERVAL_MS;
    player.setAttribute(ATTR_MENAPHITE_STATE, state);
  }
}

/** Wiki: restores one Prayer point every 12 ticks for 8 minutes; never over max. */
function applyPrayerRegeneration(player) {
  const now = Date.now();
  player.setAttribute(ATTR_PRAYER_REGEN_STATE, {
    endsAt: now + PRAYER_REGEN_DURATION_MS,
    nextRestoreAt: now + PRAYER_REGEN_INTERVAL_MS,
  });
}

function clearPrayerRegeneration({ player }) {
  player.setAttribute(ATTR_PRAYER_REGEN_STATE, null);
}

function processPrayerRegeneration(player) {
  const state = player.getAttribute(ATTR_PRAYER_REGEN_STATE);
  if (!state) {
    return;
  }
  const now = Date.now();
  if (now >= state.endsAt) {
    player.setAttribute(ATTR_PRAYER_REGEN_STATE, null);
    return;
  }
  if (now < state.nextRestoreAt) {
    return;
  }
  const max = getMaxLevel(player, Skill.PRAYER);
  getSkillManager(player).increaseCurrentLevel(Skill.PRAYER, 1, max);
  state.nextRestoreAt = now + PRAYER_REGEN_INTERVAL_MS;
  player.setAttribute(ATTR_PRAYER_REGEN_STATE, state);
}

/** Skills pinned by an active overload/divine state; their controllers reset them every tick. */
function timedEffectSkillIndexes(player) {
  const pinned = new Set();
  if (player.getAttribute(ATTR_OVERLOAD_STATE)) {
    for (const skill of OVERLOAD_SKILLS) {
      pinned.add(skill.getIndex());
    }
  }
  const divine = player.getAttribute(ATTR_DIVINE_STATE);
  if (divine && Array.isArray(divine.targets)) {
    for (const entry of divine.targets) {
      if (Number.isInteger(entry?.skillIndex)) {
        pinned.add(entry.skillIndex);
      }
    }
  }
  // Other items can hold a boost (the saturated heart's Magic): "stats:boost-held" { player, held }.
  pluginApi.emitCustomEvent("stats:boost-held", { player, held: pinned });
  return pinned;
}

/**
 * Wiki: temporary boosts drop one point toward base (the core's resting level, with a permanent
 * boost) every minute on a continuous cycle, which Preserve stretches to 90 seconds. Prayer points
 * are not covered, and Hitpoints above base drop on the core's Hitpoints timer; lowered stats are
 * restored by the core (Player.processStatRestoration).
 */
function processBoostDecay(player) {
  // An area can hold temporary boosts indefinitely (Rogues' Den); the cycle resumes on leaving.
  const pause = { player, allowed: true };
  pluginApi.emitCustomEvent("stats:boost-decay", pause);
  if (!pause.allowed) return;
  const now = Date.now();
  const nextDecayAt = Number(player.getAttribute(ATTR_BOOST_CYCLE));
  if (!Number.isFinite(nextDecayAt) || nextDecayAt <= 0) {
    player.setAttribute(ATTR_BOOST_CYCLE, now + BOOST_DECAY_MS);
    return;
  }
  if (now < nextDecayAt) {
    return;
  }
  if (preserveStretchesCycle(player, now)) {
    player.setAttribute(ATTR_BOOST_CYCLE, nextDecayAt + PRESERVE_EXTENSION_MS);
    player.setAttribute(ATTR_BOOST_CYCLE_PRESERVED, true);
    return;
  }
  player.setAttribute(ATTR_BOOST_CYCLE_PRESERVED, false);
  const elapsed = now - nextDecayAt;
  player.setAttribute(ATTR_BOOST_CYCLE, nextDecayAt + BOOST_DECAY_MS * (Math.floor(elapsed / BOOST_DECAY_MS) + 1));

  const pinned = timedEffectSkillIndexes(player);
  for (const skill of Skill.values()) {
    const index = skill.getIndex();
    if (index === Skill.HITPOINTS.getIndex() || index === Skill.PRAYER.getIndex() || pinned.has(index)) {
      continue;
    }
    const current = getCurrentLevel(player, skill);
    // A permanent boost (the core's resting level) is where a boost stops decaying.
    const resting = getSkillManager(player).getRestingLevel(skill);
    if (current > resting) {
      setCurrentLevel(player, skill, current - 1);
    }
  }
}

/** Preserve stretches a cycle once, when it has been on for 15 seconds as the cycle ends. */
function preserveStretchesCycle(player, now) {
  if (player.getAttribute(ATTR_BOOST_CYCLE_PRESERVED)) return false;
  const { PrayerHandler } = pluginApi.core;
  if (!PrayerHandler.isActivated(player, PrayerHandler.PRESERVE)) return false;
  return now - Number(player.getAttribute(ATTR_PRESERVE_SINCE)) >= PRESERVE_WARMUP_MS;
}

function notePreserveActivated({ player, prayerId }) {
  if (prayerId === pluginApi.core.PrayerHandler.PRESERVE) player.setAttribute(ATTR_PRESERVE_SINCE, Date.now());
}

function startStamina(player) {
  player.setAttribute(ATTR_STAMINA_END, Date.now() + STAMINA_DURATION_MS);
  player.setAttribute(ATTR_STAMINA_ACC, 0);
}

function applyStamina(player) {
  applyStaminaRequest({player});
}

function applyExtendedStamina(player) {
  applyStaminaRequest({
    player, energy: EXTENDED_STAMINA_ENERGY, durationMs: EXTENDED_STAMINA_DURATION_MS,
    charges: EXTENDED_STAMINA_RING_CHARGES,
  });
}

function applyStaminaRequest({player,energy=20,durationMs=STAMINA_DURATION_MS,charges=1}) {
  // Ring of endurance doubles this by mutating the payload and spends `charges` (Wiki).
  const request = { player, energy, durationMs, charges };
  pluginApi.emitCustomEvent("potions:stamina-effect", request);
  restoreRunEnergy(player, request.energy);
  player.setAttribute(ATTR_STAMINA_END, Date.now() + request.durationMs);
  player.setAttribute(ATTR_STAMINA_ACC, 0);
  // Send the effect's remaining time now, so the orb/plugin know before the next running tick.
  player.getPacketSender().sendRunEnergy();
}

function applyDivine(player, baseEffect, affectedSkills, { damage = 10 } = {}) {
  baseEffect(player);
  if (damage > 0) damageButKeepAlive(player, damage);

  // Each divine potion keeps its own five minutes (Wiki: each lasts "for 5 minutes"): a second one (divine ranging after
  // divine super combat) adds its skills with their own end, rather than dropping the first one's pinned boosts.
  const now = Date.now();
  const endsAt = now + DIVINE_DURATION_MS;
  const fresh = affectedSkills
    .filter(Boolean)
    .map((skill) => ({
      skillIndex: skill.getIndex(),
      target: getCurrentLevel(player, skill),
      endsAt,
    }));
  const previous = player.getAttribute(ATTR_DIVINE_STATE);
  const kept = (previous && Array.isArray(previous.targets) ? previous.targets : [])
    .filter((entry) => Number.isInteger(entry?.skillIndex) && !fresh.some((next) => next.skillIndex === entry.skillIndex))
    .map((entry) => ({ ...entry, endsAt: Number.isFinite(entry.endsAt) ? entry.endsAt : previous.endsAt }))
    .filter((entry) => entry.endsAt > now);
  const targets = [...kept, ...fresh];
  player.setAttribute(ATTR_DIVINE_STATE, {
    endsAt: Math.max(...targets.map((entry) => entry.endsAt)),
    targets,
  });
}

const OVERLOAD_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC];

function applyOverloadBoost(player, flat, percent) {
  for (const skill of OVERLOAD_SKILLS) {
    boostSkill(player, skill, flat, percent);
  }
}

function applyOverload(player, flat = 5, percent = 0.15) {
  const now = Date.now();
  applyOverloadBoost(player, flat, percent);
  player.setAttribute(ATTR_OVERLOAD_STATE, {
    endsAt: now + OVERLOAD_DURATION_MS,
    nextBoostAt: now + OVERLOAD_REFRESH_MS,
    nextDamageAt: now + OVERLOAD_DAMAGE_INTERVAL_MS,
    damageHitsRemaining: 5,
    flat,
    percent,
  });
}

/** Barbarian mixes heal 6 Hitpoints a dose; the attack, antipoison, Relicym's, strength, restore, energy and combat mixes heal 3 (Wiki). */
function applyMix(baseEffect, healAmount = 6) {
  return (player) => {
    baseEffect(player);
    heal(player, healAmount);
  };
}

function canDrink(player, itemId) {
  return pluginApi.emitCanDrink(player, itemId) !== false;
}

function canEat(player, itemId) {
  return pluginApi.emitCanEat(player, itemId) !== false;
}

/**
 * Why `player` may not drink a dose of `entry` here, as the drink path decides it (the canDrink
 * hooks, the potion's area, food permission, content unlocks, its own canUse); null when they may.
 */
function drinkPermissionRefusal(player, entry) {
  const itemId = entry.itemId;
  if (!canDrink(player, itemId)) return "You cannot use potions here.";
  if (entry.potion.area && !inArea(player, entry.potion.area)) return AREA_MESSAGES[entry.potion.area] ?? "You cannot use that here.";
  if (entry.potion.requiresFoodPermission && !canEat(player, itemId)) return "You cannot eat here.";
  const permission = { player, itemId, allowed: true, message: null };
  pluginApi.emitCustomEvent("potions:validate-drink", permission);
  if (permission.allowed === false) return permission.message ?? "You cannot use that here.";
  return null;
}

function drinkCanUseRefusal(player, entry) {
  if (entry.potion.canUse && !entry.potion.canUse(player)) {
    return entry.potion.canUseMessage ?? "You need more than 50 Hitpoints to drink this potion.";
  }
  return null;
}

/** Every potion-specific restriction, including a potion's HP requirement. */
function drinkRefusal(player, entry) {
  const permissionRefusal = drinkPermissionRefusal(player, entry);
  if (permissionRefusal) return permissionRefusal;
  return drinkCanUseRefusal(player, entry);
}

/** Shared action timer and stun gates for ordinary drinks and the chugging barrel. */
function drinkTimerRefusal(player) {
  const timers = player.getTimers();
  if (timers.has(TimerKey.STUN)) return { kind: "stun", message: "You're currently stunned and cannot use potions." };
  if (timers.has(TimerKey.POTION)) return { kind: "potion", message: null };
  return null;
}

function registerPotion(definition) {
  if (!definition || typeof definition.effect !== "function") {
    return;
  }

  const normalized = {
    name: definition.name,
    effect: definition.effect,
    canUse: typeof definition.canUse === "function" ? definition.canUse : null,
    canUseMessage: definition.canUseMessage ?? null,
    area: definition.area ?? null,
    requiresFoodPermission: Boolean(definition.requiresFoodPermission),
    shareable: definition.shareable !== false,
    // Drinks with their own animation and messages: { animation, messages(itemId) } in place of
    // the potion swig and "You have finished your potion.".
    drink: definition.drink ?? null,
    // null: nothing is left once the last dose is drunk.
    emptyItemId: definition.emptyItemId === null
      ? NO_EMPTY_ITEM
      : isItemId(definition.emptyItemId)
        ? definition.emptyItemId
        : DEFAULT_EMPTY_ITEM,
    entries: [],
  };

  for (const chain of definition.chains || []) addChain(normalized, chain, normalized.emptyItemId);

  if (normalized.entries.length > 0) {
    REGISTERED_POTIONS.push(normalized);
  }
}

/** One dose chain (most doses first) of a potion; the last dose leaves `emptyItemId`. */
function addChain(potion, chain, emptyItemId) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return;
  }

  for (let index = 0; index < chain.length; index++) {
    const itemId = chain[index];
    if (!isItemId(itemId)) {
      continue;
    }

    const replacementId = index + 1 < chain.length
      ? chain[index + 1]
      : emptyItemId;

    const entry = {
      potion,
      itemId,
      chain,
      doses: chain.length - index,
      replacementId: isItemId(replacementId)
        ? replacementId
        : emptyItemId,
    };

    POTION_BY_ITEM_ID.set(itemId, entry);
    potion.entries.push(entry);
  }
}

/**
 * "potions:register-copy" `{ name, chain, emptyItemId? }`: a minigame's own copies of a potion's
 * doses (Last Man Standing's), drunk as the potion called `name`, each dose leading to the copy's
 * next and the last to `emptyItemId` (the potion's own vessel when left out). Sets `registered`.
 */
function registerCopy(request) {
  const potion = REGISTERED_POTIONS.find((candidate) => candidate.name === request?.name);
  if (!potion || !Array.isArray(request.chain) || request.chain.some((id) => POTION_BY_ITEM_ID.has(id))) return;
  addChain(potion, request.chain, isItemId(request.emptyItemId) ? request.emptyItemId : potion.emptyItemId);
  request.registered = true;
}

/** Content plugins register their drinks here to share dose handling, cooldowns and permissions. */
function registerContentPotion(request) {
  if (!Array.isArray(request?.chains) || !request.chains.every(Array.isArray)) return;
  const ids = request.chains.flat();
  if (typeof request?.name !== "string" || typeof request.effect !== "function" || !ids.length ||
      ids.some((id) => !isItemId(id) || POTION_BY_ITEM_ID.has(id)) || new Set(ids).size !== ids.length) return;
  registerPotion(request);
  request.registered = true;
}

// https://oldschool.runescape.wiki/w/Free-to-play_Ironman_guide#Boosts
registerPotion({ name: "Beer", chains: [[Items.BEER]], emptyItemId: Items.BEER_GLASS,
  drink: { messages: () => ["You drink the beer. You feel slightly reinvigorated...", "...and slightly dizzy too."] },
  requiresFoodPermission: true, shareable: false, effect: (player) => {
    heal(player, 1);
    boostSkill(player, Skill.STRENGTH, 1, 0.02);
    lowerSkillByCurrent(player, Skill.ATTACK, 1, 0.06);
  } });

// https://oldschool.runescape.wiki/w/Cider and /w/Brewing
registerPotion({ name: "Cider", chains: [[Items.CIDER]], emptyItemId: Items.BEER_GLASS,
  drink: { messages: () => ["You drink the cider. You feel slightly reinvigorated...", "...and slightly dizzy too."] },
  requiresFoodPermission: true, shareable: false, effect: player => {
    heal(player, 1);
    boostSkill(player, Skill.FARMING, 1, 0);
    lowerSkillByCurrent(player, Skill.ATTACK, 2, 0.02);
    lowerSkillByCurrent(player, Skill.STRENGTH, 2, 0.02);
  } });

// POH refreshments use the same consumption, cooldown and stat-boost rules as potions, with the
// cup's own drinking animation and messages (rsprox captures: human_drink_from_teacup_*, "You drink
// the cup of (milky) tea.", "You feel refreshed and ready for more building.").
for (const [id, cup, boost, animation] of [[Items.CUP_OF_TEA_9, Items.EMPTY_CUP_3, 1, 3702],
  [Items.CUP_OF_TEA_11, Items.PORCELAIN_CUP_2, 2, 3703], [Items.CUP_OF_TEA_13, Items.PORCELAIN_CUP_3, 3, 3704]]) {
  registerPotion({ name: "Cup of tea", chains: [[id], [id + 1]], emptyItemId: cup,
    requiresFoodPermission: true, effect: player => boostSkill(player, Skill.CONSTRUCTION, boost, 0),
    drink: { animation, messages: (itemId) => [itemId === id ? "You drink the cup of tea." : "You drink the cup of milky tea.", "You feel refreshed and ready for more building."] } });
}
for (const [id, effect, emptyItemId = Items.BEER_GLASS_4] of [
  [Items.BEER_3, player => { boostSkill(player, Skill.STRENGTH, 1, 0.02); lowerSkillByCurrent(player, Skill.ATTACK, 1, 0.06); }],
  [Items.CIDER_3, player => { boostSkill(player, Skill.FARMING, 1, 0); lowerSkillByCurrent(player, Skill.ATTACK, 2, 0); lowerSkillByCurrent(player, Skill.STRENGTH, 2, 0); }],
  [Items.ASGARNIAN_ALE_3, player => { boostSkill(player, Skill.STRENGTH, 2, 0); lowerSkillByCurrent(player, Skill.ATTACK, 2, 0.05); }],
  [Items.GREENMANS_ALE_3, player => { boostSkill(player, Skill.HERBLORE, 1, 0); for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) lowerSkillByCurrent(player, skill, 3, 0); }],
  [Items.DRAGON_BITTER_3, player => { boostSkill(player, Skill.STRENGTH, 2, 0); lowerSkillByCurrent(player, Skill.ATTACK, 2, 0.05); }],
  [Items.CHEFS_DELIGHT_3, player => { boostSkill(player, Skill.COOKING, 1, 0.05); lowerSkillByCurrent(player, Skill.ATTACK, 2, 0.05); lowerSkillByCurrent(player, Skill.STRENGTH, 2, 0.05); }],
  // Wiki: Wizard's mind bomb +2/+3 Magic, -1/-5 Attack, Strength and Defence.
  [Items.WIZARDS_MIND_BOMB, player => { boostSkill(player, Skill.MAGIC, 2, 0.02); for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) lowerSkillByCurrent(player, skill, 1, 0.05); }, Items.BEER_GLASS],
  // Wiki: Dwarven stout +1 Mining and Smithing, -4% - 2 Attack, Strength and Defence.
  [Items.DWARVEN_STOUT, player => { boostSkill(player, Skill.MINING, 1, 0); boostSkill(player, Skill.SMITHING, 1, 0); for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) lowerSkillByCurrent(player, skill, 2, 0.04); }, Items.BEER_GLASS],
  // Wiki: Axeman's folly +1 Woodcutting, -3 Attack and Strength.
  [Items.AXEMANS_FOLLY, player => { boostSkill(player, Skill.WOODCUTTING, 1, 0); for (const skill of [Skill.ATTACK, Skill.STRENGTH]) lowerSkillByCurrent(player, skill, 3, 0); }, Items.BEER_GLASS],
  // Wiki: Bandit's brew +1 Thieving and Attack, -6% - 3 Strength and Defence.
  [Items.BANDITS_BREW, player => { boostSkill(player, Skill.THIEVING, 1, 0); boostSkill(player, Skill.ATTACK, 1, 0); for (const skill of [Skill.STRENGTH, Skill.DEFENCE]) lowerSkillByCurrent(player, skill, 3, 0.06); }, Items.BEER_GLASS],
]) {
  registerPotion({ name: "House ale", chains: [[id]], emptyItemId,
    requiresFoodPermission: true, effect: player => { heal(player, 1); effect(player); } });
}

// Wiki: Moonlight mead heals 4 (mature 6) with no boosts or drains.
registerPotion({ name: "Moonlight mead", chains: [[Items.MOONLIGHT_MEAD]], emptyItemId: Items.BEER_GLASS,
  requiresFoodPermission: true, effect: (player) => heal(player, 4) });
registerPotion({ name: "Moonlight mead(m)", chains: [[Items.MOONLIGHT_MEAD_M_]], emptyItemId: Items.BEER_GLASS,
  requiresFoodPermission: true, effect: (player) => heal(player, 6) });
// Wiki: Slayer's respite boosts Slayer by 2 (mature 4) and drains Attack and
// Strength by floor(current * 0.02) + 2 (mature + 3); it heals 1 (mature 2).
registerPotion({ name: "Slayer's respite", chains: [[Items.SLAYERS_RESPITE]], emptyItemId: Items.BEER_GLASS,
  requiresFoodPermission: true, effect: (player) => {
    heal(player, 1);
    boostSkill(player, Skill.SLAYER, 2, 0);
    for (const skill of [Skill.ATTACK, Skill.STRENGTH]) lowerSkillByCurrent(player, skill, 2, 0.02);
  } });
registerPotion({ name: "Slayer's respite(m)", chains: [[Items.SLAYERS_RESPITE_M_]], emptyItemId: Items.BEER_GLASS,
  requiresFoodPermission: true, effect: (player) => {
    heal(player, 2);
    boostSkill(player, Skill.SLAYER, 4, 0);
    for (const skill of [Skill.ATTACK, Skill.STRENGTH]) lowerSkillByCurrent(player, skill, 3, 0.02);
  } });

// Core combat/stat potions.
registerPotion({
  name: "Attack potion",
  chains: [doseChain("ATTACK_POTION_4_", "ATTACK_POTION_3_", "ATTACK_POTION_2_", "ATTACK_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.ATTACK, 3, 0.1),
});
registerPotion({
  name: "Strength potion",
  chains: [doseChain("STRENGTH_POTION_4_", "STRENGTH_POTION_3_", "STRENGTH_POTION_2_", "STRENGTH_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.STRENGTH, 3, 0.1),
});
registerPotion({
  name: "Defence potion",
  chains: [doseChain("DEFENCE_POTION_4_", "DEFENCE_POTION_3_", "DEFENCE_POTION_2_", "DEFENCE_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.DEFENCE, 3, 0.1),
});
registerPotion({
  name: "Combat potion",
  chains: [
    doseChain("COMBAT_POTION_4_", "COMBAT_POTION_3_", "COMBAT_POTION_2_", "COMBAT_POTION_1_"),
    doseChain("COMBAT_POTION_4__2", "COMBAT_POTION_3__2", "COMBAT_POTION_2__2", "COMBAT_POTION_1__2"),
  ],
  effect: (player) => {
    boostSkill(player, Skill.ATTACK, 3, 0.1);
    boostSkill(player, Skill.STRENGTH, 3, 0.1);
  },
});
registerPotion({
  name: "Super attack",
  chains: [doseChain("SUPER_ATTACK_4_", "SUPER_ATTACK_3_", "SUPER_ATTACK_2_", "SUPER_ATTACK_1_")],
  effect: (player) => boostSkill(player, Skill.ATTACK, 5, 0.15),
});
registerPotion({
  name: "Super strength",
  chains: [doseChain("SUPER_STRENGTH_4_", "SUPER_STRENGTH_3_", "SUPER_STRENGTH_2_", "SUPER_STRENGTH_1_")],
  effect: (player) => boostSkill(player, Skill.STRENGTH, 5, 0.15),
});
registerPotion({
  name: "Super defence",
  chains: [doseChain("SUPER_DEFENCE_4_", "SUPER_DEFENCE_3_", "SUPER_DEFENCE_2_", "SUPER_DEFENCE_1_")],
  effect: (player) => boostSkill(player, Skill.DEFENCE, 5, 0.15),
});
registerPotion({
  name: "Super combat potion",
  chains: [
    doseChain("SUPER_COMBAT_POTION_4_", "SUPER_COMBAT_POTION_3_", "SUPER_COMBAT_POTION_2_", "SUPER_COMBAT_POTION_1_"),
    doseChain("SUPER_COMBAT_POTION_4__2", "SUPER_COMBAT_POTION_3__2", "SUPER_COMBAT_POTION_2__2", "SUPER_COMBAT_POTION_1__2"),
  ],
  effect: (player) => {
    boostSkill(player, Skill.ATTACK, 5, 0.15);
    boostSkill(player, Skill.STRENGTH, 5, 0.15);
    boostSkill(player, Skill.DEFENCE, 5, 0.15);
  },
});
registerPotion({
  name: "Rank frothy potion",
  chains: [doseChain("RANK_FROTHY_POTION_4_", "RANK_FROTHY_POTION_3_", "RANK_FROTHY_POTION_2_", "RANK_FROTHY_POTION_1_")],
  emptyItemId: null,
  area: "vampyrium",
  effect: applyRankFrothyPotion,
});
registerPotion({
  name: "Foul chunky potion",
  chains: [doseChain("FOUL_CHUNKY_POTION_4_", "FOUL_CHUNKY_POTION_3_", "FOUL_CHUNKY_POTION_2_", "FOUL_CHUNKY_POTION_1_")],
  emptyItemId: null,
  area: "vampyrium",
  effect: applyFoulChunkyPotion,
});
registerPotion({
  name: "Rancid slimy potion",
  chains: [doseChain("RANCID_SLIMY_POTION_4_", "RANCID_SLIMY_POTION_3_", "RANCID_SLIMY_POTION_2_", "RANCID_SLIMY_POTION_1_")],
  emptyItemId: null,
  area: "vampyrium",
  effect: applyRancidSlimyPotion,
});
registerPotion({
  name: "Jar of congealed blood",
  chains: [[Items.JAR_OF_CONGEALED_BLOOD]],
  emptyItemId: null,
  area: "vampyrium",
  effect: applyJarOfCongealedBlood,
});
registerPotion({
  name: "Ranging potion",
  chains: [
    doseChain("RANGING_POTION_4_", "RANGING_POTION_3_", "RANGING_POTION_2_", "RANGING_POTION_1_"),
    doseChain("RANGING_POTION_4__2", "RANGING_POTION_3__2", "RANGING_POTION_2__2", "RANGING_POTION_1__2"),
  ],
  effect: (player) => boostSkill(player, Skill.RANGED, 4, 0.1),
});
registerPotion({
  name: "Super ranging potion",
  chains: [doseChain("SUPER_RANGING_4_", "SUPER_RANGING_3_", "SUPER_RANGING_2_", "SUPER_RANGING_1_")],
  effect: (player) => boostSkill(player, Skill.RANGED, 5, 0.15),
});
registerPotion({
  name: "Magic potion",
  chains: [doseChain("MAGIC_POTION_4_", "MAGIC_POTION_3_", "MAGIC_POTION_2_", "MAGIC_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.MAGIC, 4, 0),
});
registerPotion({
  name: "Super magic potion",
  chains: [doseChain("SUPER_MAGIC_POTION_4_", "SUPER_MAGIC_POTION_3_", "SUPER_MAGIC_POTION_2_", "SUPER_MAGIC_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.MAGIC, 5, 0.15),
});
registerPotion({
  name: "Bastion potion",
  chains: [doseChain("BASTION_POTION_4_", "BASTION_POTION_3_", "BASTION_POTION_2_", "BASTION_POTION_1_")],
  effect: (player) => {
    boostSkill(player, Skill.RANGED, 5, 0.15);
    boostSkill(player, Skill.DEFENCE, 5, 0.15);
  },
});
registerPotion({
  name: "Battlemage potion",
  chains: [doseChain("BATTLEMAGE_POTION_4_", "BATTLEMAGE_POTION_3_", "BATTLEMAGE_POTION_2_", "BATTLEMAGE_POTION_1_")],
  effect: (player) => {
    boostSkill(player, Skill.MAGIC, 4, 0.15);
    boostSkill(player, Skill.DEFENCE, 5, 0.15);
  },
});

registerPotion({
  name: "Prayer potion",
  chains: [
    doseChain("PRAYER_POTION_4_", "PRAYER_POTION_3_", "PRAYER_POTION_2_", "PRAYER_POTION_1_"),
    doseChain("PRAYER_POTION_4__2", "PRAYER_POTION_3__2", "PRAYER_POTION_2__2", "PRAYER_POTION_1__2"),
    doseChain("PRAYER_POTION_4__3", "PRAYER_POTION_3__3", "PRAYER_POTION_2__3", "PRAYER_POTION_1__3"),
  ],
  effect: (player) => applyPrayerRestore(player, false),
});
// Wiki: one Prayer point every 12 ticks for 8 minutes; cannot be shared or mixed.
registerPotion({
  name: "Prayer regeneration potion",
  chains: [[
    Items.PRAYER_REGENERATION_POTION_4_,
    Items.PRAYER_REGENERATION_POTION_3_,
    Items.PRAYER_REGENERATION_POTION_2_,
    Items.PRAYER_REGENERATION_POTION_1_,
  ]],
  shareable: false,
  effect: applyPrayerRegeneration,
});
registerPotion({
  name: "Restore potion",
  chains: [doseChain("RESTORE_POTION_4_", "RESTORE_POTION_3_", "RESTORE_POTION_2_", "RESTORE_POTION_1_")],
  effect: applyRestorePotion,
});
registerPotion({
  name: "Super restore",
  chains: [
    doseChain("SUPER_RESTORE_4_", "SUPER_RESTORE_3_", "SUPER_RESTORE_2_", "SUPER_RESTORE_1_"),
    doseChain("SUPER_RESTORE_4__2", "SUPER_RESTORE_3__2", "SUPER_RESTORE_2__2", "SUPER_RESTORE_1__2"),
    doseChain("BLIGHTED_SUPER_RESTORE_4_", "BLIGHTED_SUPER_RESTORE_3_", "BLIGHTED_SUPER_RESTORE_2_", "BLIGHTED_SUPER_RESTORE_1_"),
  ],
  effect: applySuperRestore,
});
registerPotion({
  name: "Saradomin brew",
  chains: [
    doseChain("SARADOMIN_BREW_4_", "SARADOMIN_BREW_3_", "SARADOMIN_BREW_2_", "SARADOMIN_BREW_1_"),
    doseChain("SARADOMIN_BREW_4__2", "SARADOMIN_BREW_3__2", "SARADOMIN_BREW_2__2", "SARADOMIN_BREW_1__2"),
  ],
  requiresFoodPermission: true,
  effect: applySaradominBrew,
});
registerPotion({
  name: "Zamorak brew",
  chains: [doseChain("ZAMORAK_BREW_4_", "ZAMORAK_BREW_3_", "ZAMORAK_BREW_2_", "ZAMORAK_BREW_1_")],
  effect: applyZamorakBrew,
});
registerPotion({
  name: "Guthix rest",
  chains: [doseChain("GUTHIX_REST_4_", "GUTHIX_REST_3_", "GUTHIX_REST_2_", "GUTHIX_REST_1_")],
  emptyItemId: Items.EMPTY_CUP,
  requiresFoodPermission: true,
  effect: applyGuthixRest,
});

registerPotion({
  name: "Fishing potion",
  chains: [doseChain("FISHING_POTION_4_", "FISHING_POTION_3_", "FISHING_POTION_2_", "FISHING_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.FISHING, 3, 0),
});
registerPotion({
  name: "Hunter potion",
  chains: [doseChain("HUNTER_POTION_4_", "HUNTER_POTION_3_", "HUNTER_POTION_2_", "HUNTER_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.HUNTER, 3, 0),
});
registerPotion({
  name: "Agility potion",
  chains: [doseChain("AGILITY_POTION_4_", "AGILITY_POTION_3_", "AGILITY_POTION_2_", "AGILITY_POTION_1_")],
  effect: (player) => boostSkill(player, Skill.AGILITY, 3, 0),
});
registerPotion({
  name: "Energy potion",
  chains: [doseChain("ENERGY_POTION_4_", "ENERGY_POTION_3_", "ENERGY_POTION_2_", "ENERGY_POTION_1_")],
  // Wiki: 15% a dose since 19 August 2026 (was 10%); the energy mix follows it.
  effect: (player) => restoreRunEnergy(player, 15),
});
registerPotion({
  name: "Super energy",
  chains: [
    doseChain("SUPER_ENERGY_4_", "SUPER_ENERGY_3_", "SUPER_ENERGY_2_", "SUPER_ENERGY_1_"),
    doseChain("SUPER_ENERGY_4__2", "SUPER_ENERGY_3__2", "SUPER_ENERGY_2__2", "SUPER_ENERGY_1__2"),
  ],
  effect: (player) => restoreRunEnergy(player, 20),
});
// The Gauntlet's potion (Wiki): restores prayer like a prayer potion, 40% run energy, and works
// as a stamina potion. Made with 3 doses; the guides' one vial per potion suggests no vial is left.
registerPotion({
  name: "Egniol potion",
  chains: [doseChain("EGNIOL_POTION_4_", "EGNIOL_POTION_3_", "EGNIOL_POTION_2_", "EGNIOL_POTION_1_")],
  emptyItemId: null,
  effect: (player) => {
    applyPrayerRestore(player, false);
    restoreRunEnergy(player, 40);
    startStamina(player);
  },
});
registerPotion({
  name: "Stamina potion",
  chains: [doseChain("STAMINA_POTION_4_", "STAMINA_POTION_3_", "STAMINA_POTION_2_", "STAMINA_POTION_1_")],
  effect: applyStamina,
});
registerPotion({
  name: "Extended stamina potion",
  chains: [doseChain("EXTENDED_STAMINA_POTION_4_", "EXTENDED_STAMINA_POTION_3_", "EXTENDED_STAMINA_POTION_2_", "EXTENDED_STAMINA_POTION_1_")],
  effect: applyExtendedStamina,
});

registerPotion({
  name: "Antipoison",
  chains: [doseChain("ANTIPOISON_4_", "ANTIPOISON_3_", "ANTIPOISON_2_", "ANTIPOISON_1_")],
  effect: (player) => applyPoisonImmunity(player, 90),
});
registerPotion({
  name: "Superantipoison",
  chains: [doseChain("SUPERANTIPOISON_4_", "SUPERANTIPOISON_3_", "SUPERANTIPOISON_2_", "SUPERANTIPOISON_1_")],
  effect: (player) => applyPoisonImmunity(player, 360),
});
registerPotion({
  name: "Antidote+",
  chains: [doseChain("ANTIDOTE_4_", "ANTIDOTE_3_", "ANTIDOTE_2_", "ANTIDOTE_1_")],
  effect: (player) => applyPoisonImmunity(player, 540),
});
registerPotion({
  name: "Antidote++",
  chains: [doseChain("ANTIDOTE_4__3", "ANTIDOTE_3__3", "ANTIDOTE_2__3", "ANTIDOTE_1__3")],
  effect: (player) => applyPoisonImmunity(player, 720),
});
registerPotion({
  name: "Sanfew serum",
  chains: [
    doseChain("SANFEW_SERUM_4_", "SANFEW_SERUM_3_", "SANFEW_SERUM_2_", "SANFEW_SERUM_1_"),
    doseChain("SANFEW_SERUM_4__2", "SANFEW_SERUM_3__2", "SANFEW_SERUM_2__2", "SANFEW_SERUM_1__2"),
  ],
  effect: (player) => {
    applySanfewRestore(player);
    applyPoisonImmunity(player, 360, false);
  },
});
registerPotion({
  name: "Anti-venom",
  chains: [doseChain("ANTI_VENOM_4_", "ANTI_VENOM_3_", "ANTI_VENOM_2_", "ANTI_VENOM_1_")],
  effect: (player) => applyPoisonImmunity(player, 738, true, true),
});
registerPotion({
  name: "Anti-venom+",
  chains: [doseChain("ANTI_VENOM_4__3", "ANTI_VENOM_3__3", "ANTI_VENOM_2__3", "ANTI_VENOM_1__3")],
  effect: (player) => applyPoisonImmunity(player, 900, true, true),
});
registerPotion({
  name: "Extended anti-venom+",
  chains: [doseChain("EXTENDED_ANTI_VENOM_4_", "EXTENDED_ANTI_VENOM_3_", "EXTENDED_ANTI_VENOM_2_", "EXTENDED_ANTI_VENOM_1_")],
  effect: (player) => applyPoisonImmunity(player, 1062, true, true),
});

registerPotion({
  name: "Antifire potion",
  chains: [doseChain("ANTIFIRE_POTION_4_", "ANTIFIRE_POTION_3_", "ANTIFIRE_POTION_2_", "ANTIFIRE_POTION_1_")],
  effect: (player) => applyAntifire(player, 360, DragonfireProtectionTier.ANTIFIRE, "antifire potion"),
});
registerPotion({
  name: "Extended antifire",
  chains: [doseChain("EXTENDED_ANTIFIRE_4_", "EXTENDED_ANTIFIRE_3_", "EXTENDED_ANTIFIRE_2_", "EXTENDED_ANTIFIRE_1_")],
  effect: (player) => applyAntifire(player, 720, DragonfireProtectionTier.ANTIFIRE, "antifire potion"),
});
registerPotion({
  name: "Super antifire",
  chains: [doseChain("SUPER_ANTIFIRE_POTION_4_", "SUPER_ANTIFIRE_POTION_3_", "SUPER_ANTIFIRE_POTION_2_", "SUPER_ANTIFIRE_POTION_1_")],
  effect: (player) => applyAntifire(player, 180, DragonfireProtectionTier.SUPER_ANTIFIRE, "super antifire potion"),
});
registerPotion({
  name: "Extended super antifire",
  chains: [doseChain("EXTENDED_SUPER_ANTIFIRE_4_", "EXTENDED_SUPER_ANTIFIRE_3_", "EXTENDED_SUPER_ANTIFIRE_2_", "EXTENDED_SUPER_ANTIFIRE_1_")],
  effect: (player) => applyAntifire(player, 360, DragonfireProtectionTier.SUPER_ANTIFIRE, "super antifire potion"),
});

registerPotion({
  name: "Antipoison mix",
  chains: [doseChain("ANTIPOISON_MIX_2_", "ANTIPOISON_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyPoisonImmunity(player, 90, false), 3),
});
registerPotion({
  name: "Anti-poison supermix",
  chains: [doseChain("ANTI_POISON_SUPERMIX_2_", "ANTI_POISON_SUPERMIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyPoisonImmunity(player, 360, false)),
});
registerPotion({
  name: "Restore mix",
  chains: [doseChain("RESTORE_MIX_2_", "RESTORE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix(applyRestorePotion, 3),
});
registerPotion({
  name: "Super energy mix",
  chains: [doseChain("SUPER_ENERGY_MIX_2_", "SUPER_ENERGY_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => restoreRunEnergy(player, 20)),
});
registerPotion({
  name: "Super restore mix",
  chains: [doseChain("SUPER_RESTORE_MIX_2_", "SUPER_RESTORE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix(applySuperRestore),
});
registerPotion({
  name: "Antidote+ mix",
  chains: [doseChain("ANTIDOTE_MIX_2_", "ANTIDOTE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyPoisonImmunity(player, 540, false)),
});
registerPotion({
  name: "Antifire mix",
  chains: [doseChain("ANTIFIRE_MIX_2_", "ANTIFIRE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyAntifire(player, 360, DragonfireProtectionTier.ANTIFIRE, "antifire potion")),
});
registerPotion({
  name: "Extended antifire mix",
  chains: [doseChain("EXTENDED_ANTIFIRE_MIX_2_", "EXTENDED_ANTIFIRE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyAntifire(player, 720, DragonfireProtectionTier.ANTIFIRE, "antifire potion")),
});
registerPotion({
  name: "Super antifire mix",
  chains: [doseChain("SUPER_ANTIFIRE_MIX_2_", "SUPER_ANTIFIRE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyAntifire(player, 180, DragonfireProtectionTier.SUPER_ANTIFIRE, "super antifire potion")),
});
registerPotion({
  name: "Extended super antifire mix",
  chains: [doseChain("EXTENDED_SUPER_ANTIFIRE_MIX_2_", "EXTENDED_SUPER_ANTIFIRE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyAntifire(player, 360, DragonfireProtectionTier.SUPER_ANTIFIRE, "super antifire potion")),
});
registerPotion({
  name: "Stamina mix",
  chains: [doseChain("STAMINA_MIX_2_", "STAMINA_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix(applyStamina),
});

/**
 * Moonlight potion (Wiki): its strength comes from the drinker's Herblore level. Prayer: the
 * greater of 7 + 25% of the Prayer level and 7 + 30% of the Herblore level, nothing below 38
 * Herblore. Attack, Strength and Defence: 3 + 10% from 33 Herblore, 5 + 15% from 45 (Attack),
 * 55 (Strength) and 66 (Defence); from 70 Defence is 7 + 20% and held like a divine potion's for
 * five minutes, without the divine potions' damage.
 */
function applyMoonlightPotion(player) {
  const herblore = getCurrentLevel(player, Skill.HERBLORE);
  if (herblore >= 38) {
    const prayer = getMaxLevel(player, Skill.PRAYER);
    restorePrayer(player, Math.max(Math.floor(prayer * 0.25), Math.floor(herblore * 0.3)) + 7, 0);
  }
  if (herblore < 33) return;
  const tier = (from) => (herblore >= from ? [5, 0.15] : [3, 0.1]);
  boostSkill(player, Skill.ATTACK, ...tier(45));
  boostSkill(player, Skill.STRENGTH, ...tier(55));
  if (herblore >= 70) {
    applyDivine(player, (p) => boostSkill(p, Skill.DEFENCE, 7, 0.2), [Skill.DEFENCE], { damage: 0 });
  } else {
    boostSkill(player, Skill.DEFENCE, ...tier(66));
  }
}

registerPotion({
  name: "Moonlight potion",
  chains: [doseChain("MOONLIGHT_POTION_4_", "MOONLIGHT_POTION_3_", "MOONLIGHT_POTION_2_", "MOONLIGHT_POTION_1_")],
  effect: applyMoonlightPotion,
});
function registerDivinePotion(definition) {
  registerPotion({
    ...definition,
    canUse: (player) => getCurrentLevel(player, Skill.HITPOINTS) > 10,
    canUseMessage: "You need more than 10 hitpoints to survive the power of a divine potion.",
  });
}

registerDivinePotion({
  name: "Divine super attack potion",
  chains: [doseChain("DIVINE_SUPER_ATTACK_POTION_4_", "DIVINE_SUPER_ATTACK_POTION_3_", "DIVINE_SUPER_ATTACK_POTION_2_", "DIVINE_SUPER_ATTACK_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.ATTACK, 5, 0.15), [Skill.ATTACK]),
});
registerDivinePotion({
  name: "Divine super strength potion",
  chains: [doseChain("DIVINE_SUPER_STRENGTH_POTION_4_", "DIVINE_SUPER_STRENGTH_POTION_3_", "DIVINE_SUPER_STRENGTH_POTION_2_", "DIVINE_SUPER_STRENGTH_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.STRENGTH, 5, 0.15), [Skill.STRENGTH]),
});
registerDivinePotion({
  name: "Divine super defence potion",
  chains: [doseChain("DIVINE_SUPER_DEFENCE_POTION_4_", "DIVINE_SUPER_DEFENCE_POTION_3_", "DIVINE_SUPER_DEFENCE_POTION_2_", "DIVINE_SUPER_DEFENCE_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.DEFENCE, 5, 0.15), [Skill.DEFENCE]),
});
registerDivinePotion({
  name: "Divine ranging potion",
  chains: [doseChain("DIVINE_RANGING_POTION_4_", "DIVINE_RANGING_POTION_3_", "DIVINE_RANGING_POTION_2_", "DIVINE_RANGING_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.RANGED, 4, 0.1), [Skill.RANGED]),
});
registerDivinePotion({
  name: "Divine magic potion",
  chains: [doseChain("DIVINE_MAGIC_POTION_4_", "DIVINE_MAGIC_POTION_3_", "DIVINE_MAGIC_POTION_2_", "DIVINE_MAGIC_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.MAGIC, 4, 0), [Skill.MAGIC]),
});
registerDivinePotion({
  name: "Divine bastion potion",
  chains: [doseChain("DIVINE_BASTION_POTION_4_", "DIVINE_BASTION_POTION_3_", "DIVINE_BASTION_POTION_2_", "DIVINE_BASTION_POTION_1_")],
  effect: (player) =>
    applyDivine(
      player,
      (p) => {
        boostSkill(p, Skill.RANGED, 5, 0.15);
        boostSkill(p, Skill.DEFENCE, 5, 0.15);
      },
      [Skill.RANGED, Skill.DEFENCE]
    ),
});
registerDivinePotion({
  name: "Divine battlemage potion",
  chains: [doseChain("DIVINE_BATTLEMAGE_POTION_4_", "DIVINE_BATTLEMAGE_POTION_3_", "DIVINE_BATTLEMAGE_POTION_2_", "DIVINE_BATTLEMAGE_POTION_1_")],
  effect: (player) =>
    applyDivine(
      player,
      (p) => {
        boostSkill(p, Skill.MAGIC, 4, 0.15);
        boostSkill(p, Skill.DEFENCE, 5, 0.15);
      },
      [Skill.MAGIC, Skill.DEFENCE]
    ),
});
registerDivinePotion({
  name: "Divine super combat potion",
  chains: [doseChain("DIVINE_SUPER_COMBAT_POTION_4_", "DIVINE_SUPER_COMBAT_POTION_3_", "DIVINE_SUPER_COMBAT_POTION_2_", "DIVINE_SUPER_COMBAT_POTION_1_")],
  effect: (player) =>
    applyDivine(
      player,
      (p) => {
        boostSkill(p, Skill.ATTACK, 5, 0.15);
        boostSkill(p, Skill.STRENGTH, 5, 0.15);
        boostSkill(p, Skill.DEFENCE, 5, 0.15);
      },
      [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]
    ),
});
// Nightmare Zone's Overload (11730-11733) is drunk only in a dream: NightmareZone.plugin.js owns it.
registerPotion({
  name: "Overload (+)",
  chains: [doseChain("OVERLOAD_4__5", "OVERLOAD_3__5", "OVERLOAD_2__5", "OVERLOAD_1__5")],
  canUse: (player) => getCurrentLevel(player, Skill.HITPOINTS) > 50,
  effect: (player) => applyOverload(player, 6, 0.16),
});

registerPotion({
  name: "Ancient brew",
  chains: [doseChain("ANCIENT_BREW_4_", "ANCIENT_BREW_3_", "ANCIENT_BREW_2_", "ANCIENT_BREW_1_")],
  effect: (player) => applyAncientBrew(player, 2, 0.05),
});
registerPotion({
  name: "Forgotten brew",
  chains: [doseChain("FORGOTTEN_BREW_4_", "FORGOTTEN_BREW_3_", "FORGOTTEN_BREW_2_", "FORGOTTEN_BREW_1_")],
  effect: (player) => applyAncientBrew(player, 3, 0.08),
});
registerPotion({
  name: "Menaphite remedy",
  chains: [doseChain("MENAPHITE_REMEDY_4_", "MENAPHITE_REMEDY_3_", "MENAPHITE_REMEDY_2_", "MENAPHITE_REMEDY_1_")],
  effect: applyMenaphiteRemedy,
});

// Relicym's balm can be drunk for the Nightmare parasite. Player disease itself is not modelled.
registerPotion({
  name: "Relicym's balm",
  chains: [doseChain("RELICYMS_BALM_4_", "RELICYMS_BALM_3_", "RELICYMS_BALM_2_", "RELICYMS_BALM_1_")],
  effect: () => {},
});

// ---------------------------------------------------------------- barbarian mixes of the potions above
// Wiki (Barbarian Training's mix table): a mix drinks as its potion and heals 3 or 6 per dose.
// Relicym's and magic essence mixes are left out; their mix effects are not implemented.

/** A mix drinking as the registered potion `potionName` (or `effect`), healing `healAmount` per dose. */
function registerMix(name, potionName, healAmount, twoDose, oneDose, effect) {
  const potion = REGISTERED_POTIONS.find((candidate) => candidate.name === potionName);
  if (!potion) return;
  registerPotion({
    name,
    chains: [doseChain(twoDose, oneDose)],
    requiresFoodPermission: true,
    canUse: potion.canUse ?? undefined,
    canUseMessage: potion.canUseMessage ?? undefined,
    area: potion.area ?? undefined,
    effect: applyMix(effect ?? potion.effect, healAmount),
  });
}

/** Wiki (Zamorak mix): the brew's boosts and Prayer, but floor((HP - 1) / 8) damage, then the 6 heal. */
const zamorakMix = (player) => applyZamorakBrew(player, (hp) => Math.floor((hp - 1) / 8));

for (const [name, potionName, healAmount, key, effect] of [
  ["Attack mix", "Attack potion", 3, "ATTACK_MIX"],
  ["Strength mix", "Strength potion", 3, "STRENGTH_MIX"],
  ["Energy mix", "Energy potion", 3, "ENERGY_MIX"],
  ["Defence mix", "Defence potion", 6, "DEFENCE_MIX"],
  ["Agility mix", "Agility potion", 6, "AGILITY_MIX"],
  ["Combat mix", "Combat potion", 3, "COMBAT_MIX"],
  ["Prayer mix", "Prayer potion", 6, "PRAYER_MIX"],
  ["Superattack mix", "Super attack", 6, "SUPERATTACK_MIX"],
  ["Fishing mix", "Fishing potion", 6, "FISHING_MIX"],
  ["Hunting mix", "Hunter potion", 6, "HUNTING_MIX"],
  ["Super str. mix", "Super strength", 6, "SUPER_STR_MIX"],
  ["Super def. mix", "Super defence", 6, "SUPER_DEF_MIX"],
  ["Ranging mix", "Ranging potion", 6, "RANGING_MIX"],
  ["Magic mix", "Magic potion", 6, "MAGIC_MIX"],
  ["Zamorak mix", "Zamorak brew", 6, "ZAMORAK_MIX", zamorakMix],
  ["Ancient mix", "Ancient brew", 6, "ANCIENT_MIX"],
]) registerMix(name, potionName, healAmount, `${key}_2_`, `${key}_1_`, effect);

// ---------------------------------------------------------------- Chambers of Xeric gourd potions
// Not on the Wiki (to check against a capture): the boosts by strength (weak / normal / strong). Wiki:
// they can only be sipped inside the raid, and the gourd breaks when finished.

/** Gourd potion ids are 1-4 doses ascending; the chain runs 4 down to 1. */
function gourdChain(oneDose) {
  return [oneDose + 3, oneDose + 2, oneDose + 1, oneDose];
}

function registerGourd(name, oneDose, effect, canUse) {
  registerPotion({ name, chains: [gourdChain(oneDose)], emptyItemId: null, area: "chambers-of-xeric", effect, canUse });
}

const GOURD_STRENGTHS = [
  { suffix: " (-)", flat: 4, percent: 0.1, restore: [6, 0.2], enhanceTicks: 268, aid: [0.1, 0.05], overload: [4, 0.1] },
  { suffix: "", flat: 5, percent: 0.13, restore: [8, 0.25], enhanceTicks: 375, aid: [0.15, 0.075], overload: [5, 0.13] },
  { suffix: " (+)", flat: 6, percent: 0.16, restore: [11, 0.3], enhanceTicks: 483, aid: [0.2, 0.1], overload: [6, 0.16] },
];
const GOURD_FIRST_DOSE = {
  elder: [20913, 20917, 20921], twisted: [20925, 20929, 20933], kodai: [20937, 20941, 20945],
  revitalisation: [20949, 20953, 20957], prayerEnhance: [20961, 20965, 20969], xericsAid: [20973, 20977, 20981],
  overload: [20985, 20989, 20993], antipoison: [25754, 25758, 25762],
};
/** Wiki: the raid's antipoisons give 90 seconds, six minutes and nine minutes of immunity. */
const GOURD_ANTIPOISON_SECONDS = [90, 360, 540];

/** Xeric's aid: Defence and Hitpoints up (past the maximum), the other combat stats down. */
function applyXericsAid(player, [up, down]) {
  boostSkill(player, Skill.DEFENCE, 5, up);
  heal(player, Math.floor(getMaxLevel(player, Skill.HITPOINTS) * up), Math.floor(getMaxLevel(player, Skill.HITPOINTS) * up));
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.MAGIC, Skill.RANGED]) lowerSkillByCurrent(player, skill, 2, down);
}

GOURD_STRENGTHS.forEach((strength, tier) => {
  const { suffix, flat, percent } = strength;
  registerGourd(`Elder${suffix}`, GOURD_FIRST_DOSE.elder[tier], (player) => {
    for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) boostSkill(player, skill, flat, percent);
  });
  registerGourd(`Twisted${suffix}`, GOURD_FIRST_DOSE.twisted[tier], (player) => boostSkill(player, Skill.RANGED, flat, percent));
  registerGourd(`Kodai${suffix}`, GOURD_FIRST_DOSE.kodai[tier], (player) => boostSkill(player, Skill.MAGIC, flat, percent));
  registerGourd(`Revitalisation${suffix}`, GOURD_FIRST_DOSE.revitalisation[tier], (player) => {
    for (const skill of Skill.values()) {
      if (skill !== Skill.HITPOINTS) restoreSkillToBaseWithFormula(player, skill, strength.restore[0], strength.restore[1]);
    }
  });
  registerGourd(`Prayer enhance${suffix}`, GOURD_FIRST_DOSE.prayerEnhance[tier], (player) => {
    const now = Date.now();
    player.setAttribute(ATTR_PRAYER_ENHANCE, { endsAt: now + strength.enhanceTicks * 600, nextAt: now + PRAYER_ENHANCE_INTERVAL_MS });
  });
  registerGourd(`Xeric's aid${suffix}`, GOURD_FIRST_DOSE.xericsAid[tier], (player) => applyXericsAid(player, strength.aid));
  const antipoison = suffix ? `Antipoison${suffix}` : "Antipoison potion";
  registerGourd(antipoison, GOURD_FIRST_DOSE.antipoison[tier], (player) => applyPoisonImmunity(player, GOURD_ANTIPOISON_SECONDS[tier]));
  registerGourd(`Overload${suffix} (Chambers of Xeric)`, GOURD_FIRST_DOSE.overload[tier],
    (player) => applyOverload(player, strength.overload[0], strength.overload[1]),
    // Wiki (Overload (Chambers of Xeric)): more than 50 Hitpoints, as Overload (+) and the refusal text say.
    (player) => getCurrentLevel(player, Skill.HITPOINTS) > 50);
});

/** Wiki: the stamina effect only slows the drain; MovementQueue applies the 30% modifier. */
function processStamina(player) {
  const endsAt = player.getAttribute(ATTR_STAMINA_END);
  if (!Number.isFinite(endsAt)) {
    return;
  }

  if (Date.now() >= endsAt) {
    player.setAttribute(ATTR_STAMINA_END, null);
    player.setAttribute(ATTR_STAMINA_ACC, 0);
    // Clear the client's stamina marker even if the player is standing still at full energy.
    player.getPacketSender().sendRunEnergy();
  }
}

/** Wiki: with a stamina potion active, run energy drains at 30% of its normal rate. */
function staminaDrainModifier(entity, amount) {
  if (!entity?.isPlayer?.()) {
    return amount;
  }
  const endsAt = Number(entity.getAsPlayer().getAttribute(ATTR_STAMINA_END));
  return Number.isFinite(endsAt) && Date.now() < endsAt ? Math.floor(amount * 0.3) : amount;
}

/** Tells the client how long the stamina effect has left, so the run orb and Run Energy plugin agree. */
function staminaStatus(entity, status) {
  if (!entity?.isPlayer?.()) {
    return;
  }
  const endsAt = Number(entity.getAsPlayer().getAttribute(ATTR_STAMINA_END));
  const remainingMs = endsAt - Date.now();
  if (Number.isFinite(endsAt) && remainingMs > 0) {
    status.staminaTicks = Math.max(1, Math.ceil(remainingMs / 600));
    status.staminaMultiplier = 1;
  }
}

/** Remember drains as they happen, before the player's next restoration phase. */
function noteDivineDrain({ player, skill, previous, current }) {
  const state = player?.getAttribute(ATTR_DIVINE_STATE);
  if (!(current < previous) || !(state?.endsAt > Date.now()) || !Array.isArray(state.targets)) return;
  const entry = state.targets.find((target) => target?.skillIndex === skill?.getIndex());
  if (entry && current < entry.target) entry.target = current;
}

function processDivine(player) {
  const state = player.getAttribute(ATTR_DIVINE_STATE);
  if (!state || !Array.isArray(state.targets)) {
    return;
  }

  // Each skill ends at its own potion's time (an older save holds one endsAt for all of them).
  const now = Date.now();
  const endOf = (entry) => (Number.isFinite(entry?.endsAt) ? entry.endsAt : state.endsAt);
  const expired = state.targets.filter((entry) => now >= endOf(entry));
  if (expired.length > 0) {
    for (const entry of expired) {
      const skill = Skill.values()[entry?.skillIndex];
      if (skill) {
        setCurrentLevel(player, skill, getMaxLevel(player, skill));
      }
    }
    state.targets = state.targets.filter((entry) => now < endOf(entry));
    if (state.targets.length === 0) player.setAttribute(ATTR_DIVINE_STATE, null);
    else player.setAttribute(ATTR_DIVINE_STATE, { ...state, endsAt: Math.max(...state.targets.map(endOf)) });
    player.sendMessage("Your divine potion effect has worn off.");
    if (state.targets.length === 0) return;
  }

  for (const entry of state.targets) {
    const skill = Skill.values()[entry?.skillIndex];
    if (skill) {
      const current = getCurrentLevel(player, skill);
      if (current !== entry.target) {
        // Drains, restoration and later boosts change the level being maintained.
        entry.target = current;
      }
    }
  }
}

/**
 * Whether a player is somewhere an area-limited potion works: the area's plugin answers
 * potions:area { player, area } by setting `inside`.
 */
function inArea(player, area) {
  const request = { player, area, inside: false };
  pluginApi.emitCustomEvent("potions:area", request);
  return request.inside === true;
}

function processPrayerEnhance(player) {
  const state = player.getAttribute(ATTR_PRAYER_ENHANCE);
  if (!state) return;
  const now = Date.now();
  if (now >= state.endsAt) {
    player.setAttribute(ATTR_PRAYER_ENHANCE, null);
    player.sendMessage("<col=ef1020>Your prayer enhance effect has worn off.</col>");
    return;
  }
  if (now < state.nextAt) return;
  state.nextAt = now + PRAYER_ENHANCE_INTERVAL_MS;
  const max = getMaxLevel(player, Skill.PRAYER);
  if (getCurrentLevel(player, Skill.PRAYER) < max) getSkillManager(player).increaseCurrentLevel(Skill.PRAYER, 1, max);
}

function processOverload(player) {
  const state = player.getAttribute(ATTR_OVERLOAD_STATE);
  if (!state) {
    return;
  }

  const now = Date.now();
  if (now >= state.endsAt) {
    player.setAttribute(ATTR_OVERLOAD_STATE, null);
    for (const skill of OVERLOAD_SKILLS) {
      setCurrentLevel(player, skill, getMaxLevel(player, skill));
    }
    heal(player, 50);
    player.sendMessage("The effects of the overload have worn off, and you feel normal again.");
    return;
  }

  if (state.damageHitsRemaining > 0 && now >= state.nextDamageAt) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(10, HitMask.RED)]);
    state.damageHitsRemaining--;
    state.nextDamageAt = now + OVERLOAD_DAMAGE_INTERVAL_MS;
  }
  if (now >= state.nextBoostAt) {
    applyOverloadBoost(player, state.flat, state.percent);
    state.nextBoostAt = now + OVERLOAD_REFRESH_MS;
  }
  player.setAttribute(ATTR_OVERLOAD_STATE, state);
}

function handlePotionDrink(player, itemId, slot) {
  const entry = POTION_BY_ITEM_ID.get(itemId);
  if (!entry || !player) {
    return false;
  }

  const inventory = player.getInventory();
  if (
    slot < 0 ||
    slot >= inventory.capacity() ||
    inventory.getItems()[slot]?.getId?.() !== itemId
  ) {
    return true;
  }

  const permissionRefusal = drinkPermissionRefusal(player, entry);
  if (permissionRefusal) {
    player.sendMessage(permissionRefusal);
    return true;
  }

  const timerRefusal = drinkTimerRefusal(player);
  if (timerRefusal) {
    if (timerRefusal.message) player.sendMessage(timerRefusal.message);
    return true;
  }

  const canUseRefusal = drinkCanUseRefusal(player, entry);
  if (canUseRefusal) {
    player.sendMessage(canUseRefusal);
    return true;
  }

  const timers = player.getTimers();

  timers.extendOrRegister(TimerKey.POTION, 3);
  timers.extendOrRegister(TimerKey.FOOD, 3);

  player.getPacketSender().sendInterfaceRemoval();
  player.performAnimation(entry.potion.drink?.animation ? new Animation(entry.potion.drink.animation) : DRINK_ANIMATION);
  Sounds.sendSound(player, Sound.DRINK);

  const meta = inventory.getItems()[slot]?.getMeta();
  const smashVial = entry.replacementId === ItemIds.VIAL
    && entry.replacementId === entry.potion.emptyItemId
    && player.getPacketSender().getVarbit?.(AUTO_SMASH_VIALS_VARBIT) === 1;
  const replacement = smashVial ? NO_EMPTY_ITEM : entry.replacementId;
  inventory.setItem(slot, new Item(replacement, replacement === NO_EMPTY_ITEM ? 0 : 1, meta)).refreshItems();
  entry.potion.effect(player);

  if (entry.potion.drink?.messages) {
    for (const message of entry.potion.drink.messages(itemId)) player.sendMessage(message);
  } else if (smashVial) {
    player.sendMessage("You quickly smash the empty vial using the trick a Barbarian taught you.");
  } else if (entry.replacementId === entry.potion.emptyItemId) {
    player.sendMessage(entry.potion.area === "chambers-of-xeric"
      ? "You have finished your potion. The gourd vial disintegrates."
      : "You have finished your potion.");
  }
  pluginApi.emitCustomEvent("potions:drunk", { player, itemId, name: entry.potion.name, meta });

  return true;
}

/** The potions each Lunar share spell works on (Wiki: Stat Restore Pot Share, Boost Potion Share). */
const SHAREABLE = {
  restore: new Set([
    "Energy potion", "Prayer potion", "Restore potion", "Super energy", "Super restore", "Anti-venom",
    "Anti-venom+", "Extended anti-venom+", "Sanfew serum", "Stamina potion",
  ]),
  boost: new Set([
    "Agility potion", "Attack potion", "Bastion potion", "Battlemage potion", "Defence potion", "Fishing potion",
    "Magic potion", "Ranging potion", "Strength potion", "Super attack", "Super combat potion", "Super defence",
    "Super strength",
  ]),
};

/**
 * "potions:share" `{ player, slot, kind, targets }` from the Lunar share spells: the potion in
 * `slot` gives one dose to each of `targets` while it has doses, and the caster drinks one free.
 * Sets `valid` and `apply` (run once the spell is paid for), or `message` when it can't be shared.
 */
function sharePotion(request) {
  const { player, slot, kind, targets } = request;
  const item = player.getInventory().getItems()[slot];
  const entry = item ? POTION_BY_ITEM_ID.get(item.getId()) : null;
  if (!entry || !entry.potion.shareable || !SHAREABLE[kind]?.has(entry.potion.name)) {
    request.message = kind === "restore"
      ? "This spell can only be cast on restore-type potions."
      : "This spell can only be cast on stat-boosting potions.";
    return;
  }
  // Every drinker passes the rules a normal drink does (a duel's No Drinks among them).
  const refusal = drinkRefusal(player, entry);
  if (refusal) {
    request.message = refusal;
    return;
  }
  // Only the other players' doses come out of the potion, so the spell needs one of them (Wiki).
  const eligible = targets.filter((target) => drinkRefusal(target, entry) === null);
  if (eligible.length === 0) {
    request.message = "There is nobody nearby to share your potion with.";
    return;
  }
  request.valid = true;
  request.apply = () => {
    const sharers = eligible.slice(0, entry.doses);
    let current = entry;
    for (const target of sharers) {
      current.potion.effect(target);
      target.sendMessage(`${player.getDisplayName()} shares a dose of ${entry.potion.name} with you.`);
      const next = POTION_BY_ITEM_ID.get(current.replacementId);
      player.getInventory().setItem(slot, new Item(current.replacementId, current.replacementId === NO_EMPTY_ITEM ? 0 : 1, item.getMeta()));
      if (!next) break;
      current = next;
    }
    entry.potion.effect(player);
    player.getInventory().refreshItems();
  };
}

/** Cache enum 5583: every potion, mix and unfinished potion to its dose enum (0 = the empty vial, 1-4 doses). */
const POTION_DOSE_ENUM = 5583;
/** Pouring between vessels (rsprox captures: combining, dividing). */
const POUR_SOUND = 2401;
const DOSE_WORDS = ["", "one", "two", "three", "four"];

/**
 * The vessels of a potion's family by dose, `byDose[0]` the empty one, from the cache's dose enum;
 * drinks it lacks (Guthix rest, the CoX gourds) use their registered chain.
 */
function doseFamily(itemId) {
  const { CacheDefinitions } = pluginApi.core;
  const enumId = CacheDefinitions.getEnumValues(POTION_DOSE_ENUM).get(itemId);
  if (Number.isInteger(enumId)) {
    const values = CacheDefinitions.getEnumValues(enumId);
    const byDose = [0, 1, 2, 3, 4].map((dose) => values.get(dose) ?? -1);
    return { key: enumId, byDose, doses: byDose.indexOf(itemId), max: byDose.slice(1).filter((id) => id > 0).length };
  }
  const entry = POTION_BY_ITEM_ID.get(itemId);
  if (!entry || entry.potion.emptyItemId <= 0 || entry.chain.length !== 4) return null;
  return { key: entry.chain, byDose: [entry.potion.emptyItemId, ...[...entry.chain].reverse()], doses: entry.doses, max: 4 };
}

const PRESET_REFUSAL = "Preset items cannot be used for this.";

/** Preset, untradeable and unbankable copies carry restrictions that pouring must neither shed nor invent. */
function restrictedVessel(item) {
  const { Item } = pluginApi.core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

const sameMeta = (a, b) => JSON.stringify(a.getMeta() ?? null) === JSON.stringify(b.getMeta() ?? null);

function pourMessage(player, text) {
  player.getPacketSender().sendSound(POUR_SOUND, 1, 0).sendTypedMessage(pluginApi.core.ChatType.SPAM, text);
}

/**
 * One potion used on another of its kind pours into the target, leaving any excess in the source
 * ("You have combined the liquid into four doses."); used on its empty vessel it is shared out,
 * the larger half staying ("You divide the liquid between the vessels."). rsprox captures.
 */
function pourPotion(event) {
  const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot } = event;
  const inventory = player.getInventory();
  const sourceItem = inventory.getItems()[usedItemSlot];
  const targetItem = inventory.getItems()[usedWithItemSlot];
  if (usedItemSlot === usedWithItemSlot || sourceItem?.getId() !== usedItemId || targetItem?.getId() !== usedWithItemId ||
      sourceItem.getAmount() !== 1 || targetItem.getAmount() !== 1) return;
  const source = doseFamily(usedItemId);
  const target = doseFamily(usedWithItemId);
  const { Item } = pluginApi.core;
  const potion = source ?? target;
  const potionSlot = source ? usedItemSlot : usedWithItemSlot;
  const emptySlot = source ? usedWithItemSlot : usedItemSlot;
  if (potion && potion.max > 1 && potion.doses >= 2 && inventory.getItems()[emptySlot].getId() === potion.byDose[0]) {
    event.handled = true;
    // Both halves carry the potion's marks, as drinking does. An empty vessel with marks of its own
    // would lose them, so only an unmarked one (or one marked alike) takes part.
    const potionItem = inventory.getItems()[potionSlot];
    const vessel = inventory.getItems()[emptySlot];
    if ((restrictedVessel(potionItem) || restrictedVessel(vessel)) && vessel.getMeta() != null && !sameMeta(potionItem, vessel)) {
      player.sendMessage(PRESET_REFUSAL);
      return;
    }
    inventory.setItem(potionSlot, new Item(potion.byDose[Math.ceil(potion.doses / 2)], 1, potionItem.getMeta()));
    inventory.setItem(emptySlot, new Item(potion.byDose[Math.floor(potion.doses / 2)], 1, potionItem.getMeta()));
    inventory.refreshItems();
    pourMessage(player, "You divide the liquid between the vessels.");
    return;
  }
  if (!source || !target || source.key !== target.key || source.max < 2 || source.doses < 1 || target.doses < 1) return;
  event.handled = true;
  const transferred = Math.min(source.doses, source.max - target.doses);
  if (transferred === 0) return;
  // Doses from a marked vessel into an unmarked one (or the reverse) would shed or invent marks.
  if ((restrictedVessel(sourceItem) || restrictedVessel(targetItem)) && !sameMeta(sourceItem, targetItem)) {
    player.sendMessage(PRESET_REFUSAL);
    return;
  }
  inventory.setItem(usedItemSlot, new Item(source.byDose[source.doses - transferred], 1, sourceItem.getMeta()));
  inventory.setItem(usedWithItemSlot, new Item(target.byDose[target.doses + transferred], 1, targetItem.getMeta()));
  inventory.refreshItems();
  pourMessage(player, `You have combined the liquid into ${DOSE_WORDS[target.doses + transferred]} doses.`);
}

/** Vials of water, coconut milk and blood empty to a vial too, though no dose enum lists them. */
const EMPTYABLE_VIALS = ["vial_water", "vial_coconut_milk", "vial_blood"];

/** "Empty" on a potion or a filled vial: the empty vessel, "You empty the vial." (rsprox captures). */
function emptyVessel(event) {
  const { player, itemId, slot, clickType } = event;
  const { CacheDefinitions, Item } = pluginApi.core;
  if (CacheDefinitions.getItem(itemId)?.inventoryActions?.[clickType - 1] !== "Empty") return;
  const family = doseFamily(itemId);
  const empty = family && family.doses >= 1 ? family.byDose[0]
    : EMPTYABLE_VIALS.some((name) => CacheDefinitions.getObjId(name) === itemId) ? CacheDefinitions.getObjId("vial_empty") : -1;
  const inventory = player.getInventory();
  if (empty <= 0 || inventory.getItems()[slot]?.getId() !== itemId) return;
  event.handled = true;
  inventory.setItem(slot, new Item(empty, 1, inventory.getItems()[slot].getMeta())).refreshItems();
  player.getPacketSender().sendTypedMessage(pluginApi.core.ChatType.SPAM, "You empty the vial.");
}

function pauseTimedEffects({ player }) {
  player.setAttribute(ATTR_PAUSED_AT, Date.now());
}

/** Shifts every running effect by the time spent offline, so a relog resumes it. */
function resumeTimedEffects({ player }) {
  const pausedAt = Number(player.getAttribute(ATTR_PAUSED_AT));
  player.setAttribute(ATTR_PAUSED_AT, null);
  if (!Number.isFinite(pausedAt) || pausedAt <= 0) return;
  const offline = Math.max(0, Date.now() - pausedAt);
  const staminaEnd = Number(player.getAttribute(ATTR_STAMINA_END));
  if (Number.isFinite(staminaEnd) && staminaEnd > 0) player.setAttribute(ATTR_STAMINA_END, staminaEnd + offline);
  const boostCycle = Number(player.getAttribute(ATTR_BOOST_CYCLE));
  if (Number.isFinite(boostCycle) && boostCycle > 0) player.setAttribute(ATTR_BOOST_CYCLE, boostCycle + offline);
  for (const key of [ATTR_DIVINE_STATE, ATTR_OVERLOAD_STATE, ATTR_MENAPHITE_STATE, ATTR_PRAYER_REGEN_STATE, ATTR_PRAYER_ENHANCE]) {
    const state = player.getAttribute(key);
    if (!state || typeof state !== "object") continue;
    for (const field of ["endsAt", "nextBoostAt", "nextDamageAt", "nextRestoreAt", "nextAt"]) {
      if (Number.isFinite(state[field])) state[field] += offline;
    }
    // A divine state's skills each carry their own end.
    for (const entry of Array.isArray(state.targets) ? state.targets : []) {
      if (Number.isFinite(entry?.endsAt)) entry.endsAt += offline;
    }
    player.setAttribute(key, state);
  }
}

/** The hitpoints orb's "Cure", on the desktop orbs and the mobile toplevel's (gameval names). */
const HEALTH_ORB_CURE_COMPONENTS = ["orbs:healthbutton", "orbs_osm:healthbutton"];
/** Packed ids of interface components, by gameval name; ones this cache lacks are left out. */
function componentIds(api, names) {
  return names.map((name) => api.core.CacheDefinitions.getComponentId(name)).filter(Number.isInteger);
}

/** Wiki Poison/Venom: prefer stronger treatment, including partial Guthix rest. */
const CURE_POTIONS = new Map([
  ["Guthix rest", 0],
  ["Antipoison", 1], ["Antipoison mix", 1],
  ["Superantipoison", 2], ["Sanfew serum", 2], ["Anti-poison supermix", 2],
  ["Antidote+", 3], ["Antidote+ mix", 3],
  ["Antidote++", 4], ["Anti-venom", 5], ["Anti-venom+", 6],
  ["Extended anti-venom+", 7],
]);

/**
 * Prefer the strongest potion, then the least-dosed vessel of that family,
 * keeping the first slot for a dose tie. Different equally strong families
 * retain their existing inventory order pending captured priority evidence.
 * Consumption still uses the ordinary drink handler and its restrictions.
 */
function cureFromHealthOrb({ player }) {
  if (!player) return;
  const poisoned = player.isPoisoned?.() || player.isVenomed?.();
  const parasite = { player, active: false };
  pluginApi.emitCustomEvent("nightmare:parasite-orb-eligible", parasite);
  const items = player.getInventory().getItems();
  if (parasite.active) {
    // The Wiki supports either remedy; balm-first is the TSPS selection policy.
    let selected = null;
    for (let slot = 0; slot < items.length; slot++) {
      const itemId = items[slot]?.getId?.() ?? -1;
      const entry = POTION_BY_ITEM_ID.get(itemId);
      if (!entry || pluginApi.core.ItemDefinition.forId(itemId).isNoted()) continue;
      const priority = entry.potion.name === "Relicym's balm" ? 2 : entry.potion.name === "Sanfew serum" ? 1 : 0;
      if (!priority) continue;
      if (!selected || priority > selected.priority ||
          (entry.potion === selected.entry.potion && entry.doses < selected.entry.doses)) {
        selected = { entry, priority, itemId, slot };
      }
    }
    if (selected) {
      handlePotionDrink(player, selected.itemId, selected.slot);
      return;
    }
  }
  if (!poisoned) return;
  let selected = null;
  for (let slot = 0; slot < items.length; slot++) {
    const itemId = items[slot]?.getId?.() ?? -1;
    if (itemId <= 0) continue;
    const entry = POTION_BY_ITEM_ID.get(itemId);
    const strength = entry && CURE_POTIONS.get(entry.potion.name);
    if (strength === undefined || !entry || pluginApi.core.ItemDefinition.forId(itemId).isNoted()) continue;
    if (!selected || strength > selected.strength ||
        (entry.potion === selected.entry.potion && entry.doses < selected.entry.doses)) {
      selected = { entry, strength, itemId, slot };
    }
  }
  if (selected) {
    handlePotionDrink(player, selected.itemId, selected.slot);
    return;
  }
  const fallback = { player, handled: false };
  pluginApi.emitCustomEvent("poison:cure-from-orb", fallback);
  if (!fallback.handled) player.sendMessage("You haven't got anything capable of curing your poison.");
}

/**
 * "potions:dose-family" `{ itemId, family }`: an unnoted potion's family for decanting, from the cache's
 * dose enum where it has one (`doseFamily`): `{ byDose, doses, max }`, `byDose[0]` the empty vessel.
 * Left null for anything else.
 */
function answerDoseFamily(request) {
  const family = request?.itemId > 0 ? doseFamily(request.itemId) : null;
  if (!family || family.doses <= 0) return;
  request.family = { byDose: [...family.byDose], doses: family.doses, max: family.max };
}

module.exports = {
  name: "Potions",
  isPotionItem(itemId) {
    return POTION_BY_ITEM_ID.has(itemId);
  },
  _test: {
    applyPrayerRestore, applySanfewRestore, applyAncientBrew, restorePrayerOverheal, applyDivine, processDivine,
    applyMenaphiteRemedy, processMenaphite, applyPrayerRegeneration, processPrayerRegeneration, clearPrayerRegeneration,
    applyRankFrothyPotion, applyFoulChunkyPotion, applyRancidSlimyPotion, applyJarOfCongealedBlood,
    processBoostDecay, notePreserveActivated, curePoisonAndVenom, pauseTimedEffects, resumeTimedEffects,
    processStamina, staminaDrainModifier, staminaStatus,
    findPotionEntry: (itemId) => POTION_BY_ITEM_ID.get(itemId) ?? null,
    registerCopy,
    cureFromHealthOrb,
  },
  getPotionName(itemId) {
    return POTION_BY_ITEM_ID.get(itemId)?.potion?.name ?? null;
  },
  /** `{ potion, entry, doses, emptyItemId }` for a dose item; `emptyItemId` respects copied potions. */
  doseOf(itemId) {
    const entry = POTION_BY_ITEM_ID.get(itemId);
    if (!entry) return null;
    const lastDose = POTION_BY_ITEM_ID.get(entry.chain[entry.chain.length - 1]);
    return {
      potion: entry.potion,
      entry,
      doses: entry.doses,
      emptyItemId: lastDose?.replacementId ?? entry.potion.emptyItemId,
    };
  },
  drinkRefusal,
  drinkPermissionRefusal,
  drinkCanUseRefusal,
  drinkTimerRefusal,
  register(api) {
    api.registerRunEnergyDrainModifier(staminaDrainModifier);
    api.registerRunEnergyStatusModifier(staminaStatus);
    api.onCustomEvent("potions:apply-stamina", applyStaminaRequest);
    api.onCustomEvent("potions:dose-family", answerDoseFamily);
    api.onCustomEvent("potions:register-copy", registerCopy);
    api.onCustomEvent("potions:register", registerContentPotion);
    api.onCustomEvent("potions:share", sharePotion);
    api.onCustomEvent("prayer:activated", notePreserveActivated);
    pluginApi = api;
    initDragonfireProtectionCoreAccess(api);
    PERSISTED_ATTRIBUTES.forEach((key) => api.persistAttribute(key));
    api.persistAttribute(ATTR_PRAYER_REGEN_STATE, null);
    api.onPlayerLogout(pauseTimedEffects);
    api.onPlayerLogin(resumeTimedEffects);
    api.onPlayerDeath(clearPrayerRegeneration);
    api.onItemOnItem(pourPotion, { noted: false });
    api.onItemAction(emptyVessel);
    api.onItemFirstAction((event) => {
      const { player, itemId, slot } = event;
      return handlePotionDrink(player, itemId, slot);
    });
    api.onInterfaceActionButton(componentIds(api, HEALTH_ORB_CURE_COMPONENTS), cureFromHealthOrb);
    api.onCustomEvent("skills:current-level-changed", noteDivineDrain);

    api.onPlayerProcess(({ player }) => {
      if (player?.isPlayerBot?.()) {
        return;
      }
      processStamina(player);
      processDivine(player);
      processOverload(player);
      processMenaphite(player);
      processPrayerRegeneration(player);
      processPrayerEnhance(player);
      processBoostDecay(player);
      processDragonfireProtection(player);
    });

    api.log("registered", {
      potionEntries: POTION_BY_ITEM_ID.size,
      potionGroups: REGISTERED_POTIONS.length,
    });
  },
};
