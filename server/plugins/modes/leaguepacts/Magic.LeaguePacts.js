/**
 * Demonic Pacts' magic pact effects (Wiki Demonic_Pacts_League/Demonic_Pacts, the cache's
 * talent_tree texts). Each asks `Common.effect(player, "talent_*")`, 0 for anyone but a Demonic
 * Pacts character. Elements: a spell's element is its standard-spellbook family (Wind/Water/Earth/
 * Fire Strike..Surge); with talent_smoke/ice/blood/shadow_counts_as_* the Ancient family counts as
 * air/water/fire/earth for every element pact below. A rune's element is its own, a combination rune
 * (mist, dust, mud, smoke, steam, lava) both of its elements, a sunfire rune fire.
 *
 * Regenerate (General.LeaguePacts.js owns the roll) arrives as `league:pact-regenerated`
 * { player, kind, itemId, amount, combat }; heals go out as `league:pact-heal` { player, amount }.
 *
 * - talent_airrune_regen_prayer_restore (`league:pact-regenerated`, rune, combat): a N% roll per proc
 *   restores 1 Prayer per air rune regenerated, up to the base level (one roll a proc: our reading).
 * - talent_waterrune_regen_healing (same): heals N per water rune.
 * - talent_firerune_regen_damage_boost (same; onCombatHitDamage): N per fire rune is added to the
 *   next landed magic hitsplat. The regen is rolled as the cast pays, so the next hit is that cast's.
 * - talent_earthrune_regen_defence_boost (same): Defence +N per earth rune for 30 ticks, the boost at
 *   most 20% of the base level; a retrigger resets the time. Expiry takes back only what is still
 *   above the resting level (base, plus talent_defence_boost's permanent boost).
 * - talent_regen_magic_level_boost (same, any rune): Magic +1 a Regenerate proc (a cast's runes come
 *   one event per rune id; the boost counts the cast's `first`) for 30 ticks, at most N, retrigger resets.
 * - talent_regen_stave_charges_water/_fire/_air/_earth (`league:pact-regenerated`, charge from a
 *   POWERED_STAFF weapon): one rune of that element into the inventory (skipped when it has no room:
 *   no plugin event adds to the rune pouch). These runes do not chain into the rune pacts above.
 * - talent_percentage_magic_damage (registerMagicDamageBonusModifier): +N% magic damage, x3 with
 *   Tumeken's shadow wielded (its passive; x4 in the Tombs is not modelled); and (Wiki, 23 April 2026)
 *   each such node +10% accuracy in all styles, which General.LeaguePacts.js sums with the rest.
 * - talent_water_spell_damage_high_hp (`combat:magic-max-hit`): water spells' max hit +20% x HP/max HP.
 * - talent_air_spell_damage_active_prayers (same): air spells' max hit +N% per active prayer.
 * - talent_earth_scale_defence_stat (same): earth spells' max hit +1 per N current Defence levels.
 * - talent_magic_attack_speed_powered (onAttackSpeed; `combat:magic-max-hit`): a powered staff's
 *   built-in spell N ticks faster, never below 1; with a one-handed powered staff its max hit -8.
 * - talent_magic_attack_speed_traditional (onAttackSpeed): a spellbook combat spell N ticks faster,
 *   never below 2 (a faster one stays as it is).
 * - talent_air_spell_max_hit_prayer_bonus (`combat:hit-rolled`): an air spell's landed roll becomes
 *   the max hit with N% per worn prayer bonus, doubled against an NPC weak to air.
 * - talent_fire_hp_consume_for_damage (`magic:cast-committed`; onCombatHitDamage): a fire cast burns
 *   up to 6% of max hitpoints (never the last one) as a hitsplat on the caster; that cast's landed
 *   hitsplats deal twice the burn more.
 * - talent_water_spell_bouce_heal (onCombatHitResolved): a landed water spell heals 60% of its damage.
 * - talent_fire_spell_burn_bounce (onCombatHitResolved): a landed fire spell gives its target a burn
 *   (Burning claws' burn: 1 damage every 4 ticks, 10 in all, 5 at most at once), and the burn bounces
 *   to up to 2 other attackable targets within a tile of it (our reading: the burn bounces, not the hit).
 * - talent_earth_reduce_defence (onCombatHitResolved): a landed earth spell lowers the target's
 *   Defence and Magic (an NPC's magic defence level) by 2.
 *
 * PvP: the Wiki names none of these; they all act on players too (ours), the max-hit and speed
 * ones as its stat boosts and attack speed. Ours as well: the water spells' +20% grows linearly
 * with the hitpoints fraction; the air rune prayer is one roll a proc.
 */
const Common = require("./Common.LeaguePacts");

const BOOST_TICKS = 30;
const EARTH_BOOST_CAP_FRACTION = 0.2;
const FIRE_BURN_FRACTION = 0.06;
const FIRE_BURN_DAMAGE_MULTIPLIER = 2;
const WATER_HP_DAMAGE_PERCENT = 20;
const WATER_HEAL_FRACTION = 0.6;
const SHADOW_DAMAGE_MULTIPLIER = 3;
const ONE_HANDED_POWERED_MAX_HIT_PENALTY = 8;
const TRADITIONAL_MIN_SPEED = 2;
const POWERED_MIN_SPEED = 1;
const EARTH_DRAIN = 2;
const AIR_WEAKNESS = 1;
const BURN_DAMAGE = 10;
const BURN_INTERVAL = 4;
const MAX_BURNS = 5;
const BURN_BOUNCES = 2;
const BURN_BOUNCE_RADIUS = 1;

/** Spell-name prefix -> element, and the pact an Ancient family needs to count. */
const FAMILIES = {
  WIND: { element: "air" }, WATER: { element: "water" }, EARTH: { element: "earth" }, FIRE: { element: "fire" },
  SMOKE: { element: "air", needs: "talent_smoke_counts_as_air" },
  ICE: { element: "water", needs: "talent_ice_counts_as_water" },
  BLOOD: { element: "fire", needs: "talent_blood_counts_as_fire" },
  SHADOW: { element: "earth", needs: "talent_shadow_counts_as_earth" },
};
const ELEMENT_SUFFIXES = new Set(["STRIKE", "BOLT", "BLAST", "WAVE", "SURGE", "RUSH", "BURST", "BLITZ", "BARRAGE"]);
/** Rune gameval names -> the elements each counts as. */
const RUNE_ELEMENTS = {
  AIR_RUNE: ["air"], WATER_RUNE: ["water"], EARTH_RUNE: ["earth"], FIRE_RUNE: ["fire"], SUNFIRE_RUNE: ["fire"],
  MIST_RUNE: ["air", "water"], DUST_RUNE: ["air", "earth"], MUD_RUNE: ["water", "earth"],
  SMOKE_RUNE: ["air", "fire"], STEAM_RUNE: ["water", "fire"], LAVA_RUNE: ["earth", "fire"],
};
/** The charge pacts: effect -> the rune it regenerates. */
const CHARGE_RUNES = {
  talent_regen_stave_charges_water: "WATER_RUNE", talent_regen_stave_charges_fire: "FIRE_RUNE",
  talent_regen_stave_charges_air: "AIR_RUNE", talent_regen_stave_charges_earth: "EARTH_RUNE",
};

let api;
let core;
/** CombatSpell -> { element, needs }; every spellbook combat spell (not the tridents') is in `spellbookSpells`. */
const spellElements = new Map();
const spellbookSpells = new Set();
/** Rune item id -> elements. */
const runeElements = new Map();
/** Player -> fire damage owed to the next landed magic hitsplat (talent_firerune_regen_damage_boost). */
const fireBonus = new WeakMap();
/** Player -> { cycle, bonus } of this tick's fire cast (talent_fire_hp_consume_for_damage). */
const burnedCast = new WeakMap();
/** Player -> boost key -> { amount, task } (the timed Defence and Magic boosts). */
const boosts = new WeakMap();
/** Target -> running burn tasks. */
const burns = new WeakMap();

function loadSpells() {
  if (spellbookSpells.size) return;
  for (const [name, spell] of Object.entries(core.CombatSpells)) {
    if (typeof spell?.spellId !== "function" || typeof spell?.maximumHit !== "function") continue;
    if (name.startsWith("TRIDENT_")) continue;
    spellbookSpells.add(spell);
    const [prefix, suffix] = name.split("_");
    if (FAMILIES[prefix] && ELEMENT_SUFFIXES.has(suffix) && name === `${prefix}_${suffix}`) spellElements.set(spell, FAMILIES[prefix]);
  }
  for (const [name, elements] of Object.entries(RUNE_ELEMENTS)) {
    const id = core.ItemIdentifiers[name];
    if (Number.isInteger(id)) runeElements.set(id, elements);
  }
}

function isPlayer(entity) {
  return entity?.isPlayer?.() === true;
}

/** The element a player's spell counts as for the pacts, or null. */
function elementOf(player, spell) {
  loadSpells();
  const entry = spellElements.get(spell);
  if (!entry || (entry.needs && !Common.effect(player, entry.needs))) return null;
  return entry.element;
}

function selectedSpell(player) {
  return player.getCombat().getSelectedSpell?.() ?? null;
}

function weaponOf(player) {
  return player.getEquipment().get(core.Equipment.WEAPON_SLOT) ?? null;
}

function isPoweredStaffItem(item) {
  return item != null && item.getId() > 0 && item.getDefinition()?.getWeaponInterface?.() === core.WeaponInterfaces.POWERED_STAFF;
}

/** A powered staff's own spell: the weapon is one and the spell is no spellbook's. */
function castsPoweredStaff(player, spell) {
  loadSpells();
  return isPoweredStaffItem(weaponOf(player)) && !spellbookSpells.has(spell);
}

function activePrayers(player) {
  return player.getPrayerActive().filter(Boolean).length;
}

function skills(player) {
  return player.getSkillManager();
}

function heal(player, amount) {
  if (amount > 0) api.emitCustomEvent("league:pact-heal", { player, amount });
}

// ------------------------------------------------------------------ damage and accuracy

/** talent_percentage_magic_damage: permille of magic damage, tripled by Tumeken's shadow's passive. */
function magicDamageBonus(entity, permille) {
  if (!isPlayer(entity)) return permille;
  const percent = Common.effect(entity, "talent_percentage_magic_damage");
  if (!percent) return permille;
  const shadow = weaponOf(entity)?.getId?.() === core.ItemIdentifiers.TUMEKENS_SHADOW ? SHADOW_DAMAGE_MULTIPLIER : 1;
  return permille + percent * 10 * shadow;
}


/** The max-hit pacts: water by hitpoints, air by prayers, earth by Defence, a one-handed powered staff's -8. */
function maxHit(request) {
  const { attacker, spell } = request ?? {};
  if (!isPlayer(attacker)) return;
  const element = elementOf(attacker, spell);
  let percent = 0;
  let flat = 0;
  if (element === "water" && Common.effect(attacker, "talent_water_spell_damage_high_hp")) {
    const hitpoints = Math.min(1, attacker.getHitpoints() / Math.max(1, skills(attacker).getMaxLevel(core.Skill.HITPOINTS)));
    percent += WATER_HP_DAMAGE_PERCENT * hitpoints;
  }
  if (element === "air") percent += Common.effect(attacker, "talent_air_spell_damage_active_prayers") * activePrayers(attacker);
  const perDefence = element === "earth" ? Common.effect(attacker, "talent_earth_scale_defence_stat") : 0;
  if (perDefence) flat += Math.floor(skills(attacker).getCurrentLevel(core.Skill.DEFENCE) / perDefence);
  if (Common.effect(attacker, "talent_magic_attack_speed_powered") && castsPoweredStaff(attacker, spell)
    && !weaponOf(attacker).getDefinition().isDoubleHanded()) flat -= ONE_HANDED_POWERED_MAX_HIT_PENALTY;
  if (!percent && !flat) return;
  request.maxHit = Math.max(0, Math.floor((request.maxHit * (100 + percent)) / 100) + flat);
}

/** talent_air_spell_max_hit_prayer_bonus: a landed air roll may become the max hit. */
function rolled(event) {
  if (event.combatType !== core.CombatType.MAGIC || !isPlayer(event.attacker)) return;
  const perPrayer = Common.effect(event.attacker, "talent_air_spell_max_hit_prayer_bonus");
  if (!perPrayer || elementOf(event.attacker, selectedSpell(event.attacker)) !== "air") return;
  const prayer = event.attacker.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER] ?? 0;
  const weak = event.target?.isNpc?.() && event.target.getAsNpc().getCurrentDefinition().getElementalWeakness()?.type === AIR_WEAKNESS;
  const chance = perPrayer * prayer * (weak ? 2 : 1);
  if (chance > 0 && Math.random() * 100 < chance) event.damage = event.maximum;
}

/** The flat damage owed to a landed magic hitsplat: the fire runes regenerated, this tick's burned hitpoints. */
function hitDamage(event) {
  const { attacker, damage } = event;
  if (!event.accurate || event.combatType !== core.CombatType.MAGIC || !isPlayer(attacker) || !damage) return;
  let bonus = 0;
  const owed = fireBonus.get(attacker);
  if (owed) {
    fireBonus.delete(attacker);
    if (Common.effect(attacker, "talent_firerune_regen_damage_boost")) bonus += owed;
  }
  const burned = burnedCast.get(attacker);
  if (burned && burned.cycle === core.World.getProcessCycle()) bonus += burned.bonus;
  if (bonus > 0) damage.setDamage(damage.getDamage() + bonus);
}

/** talent_fire_hp_consume_for_damage: a fire cast burns up to 6% of max hitpoints, never the last. */
function castCommitted({ player, spell }) {
  burnedCast.delete(player);
  if (!Common.effect(player, "talent_fire_hp_consume_for_damage") || elementOf(player, spell) !== "fire") return;
  const burn = Math.min(Math.floor(skills(player).getMaxLevel(core.Skill.HITPOINTS) * FIRE_BURN_FRACTION), player.getHitpoints() - 1);
  if (burn <= 0) return;
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(burn, core.HitMask.RED)]);
  burnedCast.set(player, { cycle: core.World.getProcessCycle(), bonus: burn * FIRE_BURN_DAMAGE_MULTIPLIER });
}

// ------------------------------------------------------------------ landed spells

function endBurns(target) {
  const running = burns.get(target);
  if (!running) return;
  burns.delete(target);
  for (const task of running) task.stop();
}

/** One burn: 1 damage every 4 ticks, 10 in all; a target holds 5 at most. Its damage is the caster's, so a burn's kill is theirs. */
function applyBurn(attacker, target) {
  let running = burns.get(target);
  if (!running) burns.set(target, (running = new Set()));
  if (running.size >= MAX_BURNS) return;
  const task = new (class extends core.Task {
    constructor() {
      super(BURN_INTERVAL);
      this.remaining = BURN_DAMAGE;
    }

    execute() {
      if (!target.isRegistered() || target.getHitpoints() <= 0) {
        endBurns(target);
        return;
      }
      target.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(1, core.HitMask.RED).setSource(attacker)
        .onApplied((dealt) => target.getCombat().addDamage(attacker, dealt))]);
      if (--this.remaining > 0) return;
      running.delete(this);
      this.stop();
    }
  })();
  running.add(task);
  core.TaskManager.submit(task);
}

/** The burn bounces to up to two other attackable targets next to the one hit. */
function bounceBurn(attacker, target) {
  const candidates = target.isNpc() ? attacker.getLocalNpcs() : attacker.getLocalPlayers();
  let bounced = 0;
  for (const candidate of candidates) {
    if (bounced >= BURN_BOUNCES) break;
    if (!core.CombatFactory.canAttackSecondaryTarget(attacker, target, candidate, BURN_BOUNCE_RADIUS)) continue;
    applyBurn(attacker, candidate);
    bounced++;
  }
}

function drain(target, skill) {
  if (isPlayer(target)) skills(target).decreaseCurrentLevel(skill, EARTH_DRAIN, 0);
  else target.setCurrentLevels(skill, Math.max(0, target.getCurrentLevel(skill) - EARTH_DRAIN));
}

/** A landed water, fire or earth spell: the heal, the burn and its bounce, the drain. */
function hitResolved({ attacker, target, hit }) {
  if (!isPlayer(attacker) || hit.getCombatType() !== core.CombatType.MAGIC || !hit.isAccurate()) return;
  const element = elementOf(attacker, hit.getSpell?.());
  if (!element) return;
  if (element === "water" && Common.effect(attacker, "talent_water_spell_bouce_heal")) {
    heal(attacker, Math.floor(hit.getTotalDamage() * WATER_HEAL_FRACTION));
  }
  if (element === "fire" && Common.effect(attacker, "talent_fire_spell_burn_bounce") && target.getHitpoints() > 0) {
    applyBurn(attacker, target);
    bounceBurn(attacker, target);
  }
  if (element === "earth" && Common.effect(attacker, "talent_earth_reduce_defence")) {
    drain(target, core.Skill.DEFENCE);
    drain(target, core.Skill.MAGIC);
  }
}

// ------------------------------------------------------------------ attack rates

function attackSpeed(event) {
  if (event.combatType !== core.CombatType.MAGIC || !isPlayer(event.attacker)) return;
  const spell = selectedSpell(event.attacker);
  loadSpells();
  if (spellbookSpells.has(spell)) {
    const faster = Common.effect(event.attacker, "talent_magic_attack_speed_traditional");
    if (faster) event.speed = Math.min(event.speed, Math.max(TRADITIONAL_MIN_SPEED, event.speed - faster));
  } else if (castsPoweredStaff(event.attacker, spell)) {
    const faster = Common.effect(event.attacker, "talent_magic_attack_speed_powered");
    if (faster) event.speed = Math.max(POWERED_MIN_SPEED, event.speed - faster);
  }
}

// ------------------------------------------------------------------ Regenerate

/** Takes back what a timed boost still holds above the base level. */
function expireBoost(player, key, skill) {
  const held = boosts.get(player)?.get(key);
  if (!held) return;
  boosts.get(player).delete(key);
  const current = skills(player).getCurrentLevel(skill);
  const above = Math.max(0, current - skills(player).getRestingLevel(skill));
  const back = Math.min(held.amount, above);
  if (back > 0) skills(player).setCurrentLevel(skill, current - back, true);
}

/** A timed boost of `increase`, the boost at most `cap`; any trigger restarts the 30 ticks. */
function boost(player, key, skill, increase, cap) {
  if (cap <= 0) return;
  let held = boosts.get(player);
  if (!held) boosts.set(player, (held = new Map()));
  const state = held.get(key) ?? { amount: 0, task: null };
  const amount = Math.min(cap, state.amount + increase);
  const delta = amount - state.amount;
  if (delta > 0) skills(player).setCurrentLevel(skill, skills(player).getCurrentLevel(skill) + delta, true);
  state.amount = amount;
  state.task?.stop();
  state.task = new (class extends core.Task {
    constructor() {
      super(BOOST_TICKS);
    }

    execute() {
      this.stop();
      if (held.get(key) === state) expireBoost(player, key, skill);
    }
  })();
  held.set(key, state);
  core.TaskManager.submit(state.task);
}

/** A combat spell's regenerated runes: the element pacts by rune, Magic by proc. */
function runesRegenerated(player, itemId, amount, first) {
  const elements = runeElements.get(itemId) ?? [];
  const prayerChance = elements.includes("air") ? Common.effect(player, "talent_airrune_regen_prayer_restore") : 0;
  if (prayerChance && Math.random() * 100 < prayerChance) {
    const max = skills(player).getMaxLevel(core.Skill.PRAYER);
    if (skills(player).getCurrentLevel(core.Skill.PRAYER) < max) skills(player).increaseCurrentLevel(core.Skill.PRAYER, amount, max);
  }
  if (elements.includes("water")) heal(player, amount * Common.effect(player, "talent_waterrune_regen_healing"));
  const fire = elements.includes("fire") ? Common.effect(player, "talent_firerune_regen_damage_boost") : 0;
  if (fire) fireBonus.set(player, (fireBonus.get(player) ?? 0) + amount * fire);
  const earth = elements.includes("earth") ? Common.effect(player, "talent_earthrune_regen_defence_boost") : 0;
  if (earth) {
    const cap = Math.floor(skills(player).getMaxLevel(core.Skill.DEFENCE) * EARTH_BOOST_CAP_FRACTION);
    boost(player, "defence", core.Skill.DEFENCE, amount * earth, cap);
  }
  const magicCap = Common.effect(player, "talent_regen_magic_level_boost");
  if (magicCap && first) boost(player, "magic", core.Skill.MAGIC, 1, magicCap);
}

/** A powered staff's regenerated charge: one rune of each charge pact's element. */
function chargeRegenerated(player, itemId) {
  if (!isPoweredStaffItem(new core.Item(itemId, 1))) return;
  const inventory = player.getInventory();
  for (const [effect, rune] of Object.entries(CHARGE_RUNES)) {
    if (!Common.effect(player, effect)) continue;
    const item = new core.Item(core.ItemIdentifiers[rune], 1);
    if (inventory.canTake(item)) inventory.add(item, true);
  }
}

/** `league:pact-regenerated`: a rune's id in `itemId`; a charge names its weapon in `weaponId` (General's shape). */
function regenerated({ player, kind, itemId, weaponId, amount = 1, combat, first = true }) {
  if (!isPlayer(player)) return;
  loadSpells();
  if (kind === "rune" && combat) runesRegenerated(player, itemId, Math.max(1, Math.floor(amount)), first !== false);
  else if (kind === "charge") chargeRegenerated(player, weaponId ?? itemId);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.registerMagicDamageBonusModifier(magicDamageBonus);
  api.onCustomEvent("combat:magic-max-hit", maxHit);
  api.onCustomEvent("combat:hit-rolled", rolled);
  api.onCustomEvent("magic:cast-committed", castCommitted);
  api.onCustomEvent("league:pact-regenerated", regenerated);
  api.onCombatHitDamage(hitDamage);
  api.onCombatHitResolved(hitResolved);
  api.onAttackSpeed(attackSpeed);
};
