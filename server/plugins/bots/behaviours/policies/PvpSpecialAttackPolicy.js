"use strict";

const { equipStyleGear } = require("./PvpCombatRuntimeCache");

const { CombatSpecial } = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatSpecial");
const { CombatType } = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { DamageFormulas } = require("../../../../src/main/typescript/elvarg/game/content/combat/formula/DamageFormulas");
const { ItemDefinition } = require("../../../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { PrayerHandler } = require("../../../../src/main/typescript/elvarg/game/content/PrayerHandler");
const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const { ItemIdentifiers } = require("../../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { EquipPacketListener } = require("../../../../src/main/typescript/elvarg/net/packet/impl/EquipPacketListener");
const { getPvpProfile } = require("../pvp/PvpAssignment");
const {
  getAmmoId,
  getPvpCombatSnapshot,
  getWeaponId,
  invalidatePvpCombatSnapshot,
  resolveInventorySlotByItemId,
  SUPPORTED_SPEC_WEAPONS,
} = require("./PvpCombatRuntimeCache");

const SWITCHABLE_SPEC_WEAPONS = new Set([
  ItemIdentifiers.ARMADYL_GODSWORD,
  ItemIdentifiers.ANCIENT_GODSWORD,
  ItemIdentifiers.BANDOS_GODSWORD,
  ItemIdentifiers.DARK_BOW,
  ItemIdentifiers.DRAGON_CLAWS,
  ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
  ItemIdentifiers.HEAVY_BALLISTA,
  ItemIdentifiers.GRANITE_MAUL,
  ItemIdentifiers.MAGIC_SHORTBOW,
  ItemIdentifiers.MAGIC_SHORTBOW_I_,
  ItemIdentifiers.MAGIC_SHORTBOW_3,
  ItemIdentifiers.SARADOMIN_GODSWORD,
  ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF,
  ItemIdentifiers.ZAMORAK_GODSWORD,
]);

const POST_SPEC_SWITCHBACK_DELAY_MS = 900;
const ONE_TICK_ATTACK_WINDOW_TICKS = 2;
const ONE_TICK_FAST_CHECK_COOLDOWN_MS = 450;
const SWITCHBACK_RETRY_COOLDOWN_MS = 450;

function getSpecialForWeaponId(weaponId) {
  if (!Number.isInteger(weaponId) || weaponId <= 0) {
    return null;
  }
  for (const value of Object.values(CombatSpecial)) {
    if (!(value instanceof CombatSpecial)) {
      continue;
    }
    if (value.getIdentifiers?.().includes?.(weaponId)) {
      return value;
    }
  }
  return null;
}

function getOwnHpRatio(player) {
  const current = Math.max(0, Number(player?.getHitpoints?.() ?? 0));
  const maxLevel = player?.getSkillManager?.()?.getMaxLevel?.(Skill.HITPOINTS);
  const max = Math.max(1, Number(maxLevel ?? current ?? 1));
  return current / max;
}

function isSpecFinisher(player, target, state, special, weaponId) {
  if (!special || !target) return false;
  const hp = Math.max(0, Number(target.getHitpoints()));
  if (hp === 0) return false;
  const type = special.getCombatMethod().type();
  const bonusIndex = type === CombatType.MELEE ? 0 : type === CombatType.RANGED ? 1 : 2;
  const equipped = player.getEquipment();
  const weapon = ItemDefinition.forId(weaponId);
  const bonusFor = (id) => id > 0 ? Number(ItemDefinition.forId(id).getBonuses()?.[10 + bonusIndex] ?? 0) : 0;
  const currentBonus = Number(player.getBonusManager().getOtherBonus()[bonusIndex] ?? 0);
  let projectedBonus = currentBonus;
  if (getWeaponId(player) !== weaponId) {
    projectedBonus += bonusFor(weaponId) - bonusFor(getWeaponId(player));
    if (weapon.isDoubleHanded()) projectedBonus -= bonusFor(equipped.get(Equipment.SHIELD_SLOT)?.getId());
  }
  const ammoId = Number(state?.pvp?.generatedSpecAmmoId ?? -1);
  if (type === CombatType.RANGED && ammoId > 0) {
    projectedBonus += bonusFor(ammoId) - bonusFor(getAmmoId(player));
  }
  let maxHit;
  if (type === CombatType.MAGIC) {
    if (weaponId !== ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF) return false;
    maxHit = DamageFormulas.getVolatileNightmareStaffBaseMaxHit(player) * (1 + projectedBonus / 100);
  } else {
    const base = type === CombatType.MELEE
      ? DamageFormulas.calculateMaxMeleeHit(player, false)
      : DamageFormulas.calculateMaxRangedHit(player, false);
    // ponytail: approximate switched gear from the existing max hit; set effects and
    // rounding can differ. Use a full equipment projection if exact prediction is needed.
    maxHit = Math.max(0, (base - 0.5) * Math.max(0, projectedBonus + 64) /
      Math.max(1, currentBonus + 64) + 0.5) * special.getStrengthMultiplier();
  }
  if ([CombatSpecial.DRAGON_CLAWS, CombatSpecial.DRAGON_DAGGER,
      CombatSpecial.DARK_BOW, CombatSpecial.MAGIC_SHORTBOW].includes(special)) maxHit *= 2;
  // A plausible high roll, not a guaranteed maximum; delayed godsword damage is excluded.
  return hp <= Math.floor(maxHit * 0.75);
}

function isVeteranOrEliteProfile(profile) {
  return profile?.id === "veteran" || profile?.id === "elite";
}

function isWithinMeleeRange(player, target) {
  const playerLoc = player?.getLocation?.();
  const targetLoc = target?.getLocation?.();
  if (!playerLoc || !targetLoc) {
    return false;
  }
  if (playerLoc.getZ?.() !== targetLoc.getZ?.()) {
    return false;
  }
  return Number(playerLoc.getDistance?.(targetLoc) ?? 99) <= 1;
}

function resolveInventoryWeapon(player, weaponId, snapshot = null) {
  if (!player || !Number.isInteger(weaponId) || weaponId <= 0) {
    return null;
  }
  const slot = resolveInventorySlotByItemId(player, weaponId, snapshot);
  if (slot < 0) {
    return null;
  }
  return {
    weaponId,
    slot,
    special: getSpecialForWeaponId(weaponId),
  };
}

function resolveInventorySpecWeapon(player, state, snapshot = null) {
  const cachedPreferred = snapshot?.preferredSpecCandidate ?? null;
  const preferredSlot = resolveInventorySlotByItemId(
    player,
    cachedPreferred?.weaponId ?? -1,
    snapshot,
    cachedPreferred?.slot ?? -1
  );
  if (preferredSlot >= 0) {
    return {
      weaponId: cachedPreferred.weaponId,
      slot: preferredSlot,
      special: getSpecialForWeaponId(cachedPreferred.weaponId),
    };
  }
  const cachedFallback = snapshot?.fallbackSpecCandidate ?? null;
  const fallbackSlot = resolveInventorySlotByItemId(
    player,
    cachedFallback?.weaponId ?? -1,
    snapshot,
    cachedFallback?.slot ?? -1
  );
  if (fallbackSlot >= 0) {
    return {
      weaponId: cachedFallback.weaponId,
      slot: fallbackSlot,
      special: getSpecialForWeaponId(cachedFallback.weaponId),
    };
  }
  const inventory = player?.getInventory?.();
  if (!inventory) {
    return null;
  }
  for (const weaponId of SUPPORTED_SPEC_WEAPONS) {
    const slot = inventory.getSlotForItemId?.(weaponId) ?? -1;
    if (slot >= 0) {
      return { weaponId, slot, special: getSpecialForWeaponId(weaponId) };
    }
  }
  return null;
}

function shouldPressureSpec(player, state, profile) {
  const ownHpRatio = getOwnHpRatio(player);
  if (ownHpRatio > Number(profile?.specPressureHpRatio ?? 0.3)) {
    return false;
  }
  const lastTaken = Number(state?.pvp?.lastDamageTakenAt ?? 0);
  return lastTaken > 0;
}

function canSpecTarget(player, target, special) {
  if (!target || !special) return false;
  const hp = Number(target.getHitpoints());
  if (hp <= 0) return false;
  const protection = PrayerHandler.getProtectingPrayer(special.getCombatMethod().type());
  return target.getPrayerActive?.()?.[protection] !== true &&
    player.getSpecialPercentage() >= special.getDrainAmount();
}

function shouldUseSpecNow(player, target, state, profile, special, weaponId) {
  if (!canSpecTarget(player, target, special)) return false;
  const finisher = isSpecFinisher(player, target, state, special, weaponId);
  const reliability = Number(profile?.specUseChance ?? 0.3);
  const chance = finisher ? reliability : reliability * (shouldPressureSpec(player, state, profile) ? 0.3 : 0.15);
  return Math.random() <= chance;
}

function equipWeaponFromInventory(player, state, slot, weaponId) {
  if (slot < 0 || weaponId <= 0) {
    return false;
  }
  EquipPacketListener.equip(
    player,
    weaponId,
    slot,
    require("../../../../src/main/typescript/elvarg/game/model/container/impl/Inventory").Inventory.INTERFACE_ID
  );
  const switched = getWeaponId(player) === weaponId;
  if (switched) {
    invalidatePvpCombatSnapshot(state);
  }
  return switched;
}

function equipAmmoFromInventory(player, state, ammoId, snapshot = null) {
  if (!player || !Number.isInteger(ammoId) || ammoId <= 0) {
    return false;
  }
  if (getAmmoId(player) === ammoId) {
    return true;
  }
  const slot = resolveInventorySlotByItemId(player, ammoId, snapshot);
  if (slot < 0) {
    return false;
  }
  EquipPacketListener.equip(
    player,
    ammoId,
    slot,
    require("../../../../src/main/typescript/elvarg/game/model/container/impl/Inventory").Inventory.INTERFACE_ID
  );
  const equipped =
    player?.getEquipment?.()?.get?.(Equipment.AMMUNITION_SLOT)?.getId?.() === ammoId
  if (equipped) {
    invalidatePvpCombatSnapshot(state);
  }
  return equipped;
}

function switchBackToPrimaryWeapon(player, state, snapshot = null) {
  const primaryWeaponId = Number(state?.pvp?.generatedPrimaryWeaponId ?? -1);
  if (primaryWeaponId <= 0 || getWeaponId(player) === primaryWeaponId) {
    return false;
  }
  const slot = resolveInventorySlotByItemId(player, primaryWeaponId, snapshot);
  if (slot < 0) {
    return false;
  }
  const switched = equipWeaponFromInventory(player, state, slot, primaryWeaponId);
  if (!switched) {
    return false;
  }
  const primaryAmmoId = Number(state?.pvp?.generatedPrimaryAmmoId ?? -1);
  if (primaryAmmoId > 0) {
    equipAmmoFromInventory(player, state, primaryAmmoId, snapshot);
  }
  return true;
}

function maybeSwitchBackToPrimaryWeapon(context) {
  const { player, state, nowMs } = context ?? {};
  const pvp = state?.pvp;
  if (!player || !pvp) {
    return false;
  }
  if (nowMs < Number(pvp.nextSwitchbackCheckAt ?? 0)) {
    return false;
  }
  const currentWeaponId = getWeaponId(player);
  const primaryWeaponId = Number(pvp.generatedPrimaryWeaponId ?? -1);
  if (
    currentWeaponId <= 0 ||
    primaryWeaponId <= 0 ||
    currentWeaponId === primaryWeaponId ||
    !SWITCHABLE_SPEC_WEAPONS.has(currentWeaponId)
  ) {
    pvp.nextSwitchbackCheckAt = 0;
    return false;
  }
  if (player?.isSpecialActivated?.() === true) {
    pvp.nextSwitchbackCheckAt = nowMs + SWITCHBACK_RETRY_COOLDOWN_MS;
    return false;
  }
  const earliestSwitchbackAt = Number(pvp.lastSpecAt ?? 0) + POST_SPEC_SWITCHBACK_DELAY_MS;
  if (nowMs < earliestSwitchbackAt) {
    pvp.nextSwitchbackCheckAt = earliestSwitchbackAt;
    return false;
  }
  const attackWindowOpen = player?.getCombat?.()?.willAttackBeReadyIn?.(1) === true;
  if (!attackWindowOpen) {
    pvp.nextSwitchbackCheckAt = nowMs + SWITCHBACK_RETRY_COOLDOWN_MS;
    return false;
  }
  const combatSnapshot = getPvpCombatSnapshot(player, state, nowMs);
  const switched = switchBackToPrimaryWeapon(player, state, combatSnapshot);
  pvp.nextSwitchbackCheckAt = switched ? 0 : nowMs + SWITCHBACK_RETRY_COOLDOWN_MS;
  return switched;
}

function tryActivateSpecial(player, target) {
  const special = player?.getCombatSpecial?.();
  if (!canSpecTarget(player, target, special)) {
    return false;
  }
  if (player?.isSpecialActivated?.() === true) {
    return true;
  }
  equipStyleGear(player, special.getCombatMethod().type());
  player.getCombat().setCastSpell(null);
  player.getCombat().setAutocastSpell(null);
  const before = player?.isSpecialActivated?.() === true;
  const beforePercentage = Number(player?.getSpecialPercentage?.() ?? 0);
  const beforeQueued =
    player?.getCombat?.()?.isGraniteMaulSpecialQueued?.() === true;
  CombatSpecial.activate(player);
  const afterActivated = player?.isSpecialActivated?.() === true;
  const afterPercentage = Number(player?.getSpecialPercentage?.() ?? 0);
  const afterQueued =
    player?.getCombat?.()?.isGraniteMaulSpecialQueued?.() === true;
  return (
    before !== afterActivated ||
    afterActivated === true ||
    afterQueued !== beforeQueued ||
    afterPercentage < beforePercentage
  );
}

function maybeUseOneTickAttack(context, profile) {
  const { player, state, target, nowMs, scheduleSpecReview } = context ?? {};
  const pvp = state?.pvp;
  if (!player || !pvp || !target || !isVeteranOrEliteProfile(profile)) {
    return false;
  }

  const cooldownMs = Math.max(600, Number(profile?.oneTickCooldownMs ?? 3000));
  if (nowMs < Number(pvp.lastOneTickAt ?? 0) + cooldownMs) {
    return false;
  }
  const attackWindowOpen =
    player?.getCombat?.()?.willAttackBeReadyIn?.(ONE_TICK_ATTACK_WINDOW_TICKS) === true;
  if (!attackWindowOpen) {
    if (nowMs >= Number(pvp.nextOneTickCheckAt ?? 0)) {
      pvp.nextOneTickCheckAt = nowMs + ONE_TICK_FAST_CHECK_COOLDOWN_MS;
    }
    return false;
  }
  if (nowMs < Number(pvp.nextOneTickCheckAt ?? 0)) {
    return false;
  }
  pvp.nextOneTickCheckAt = nowMs + ONE_TICK_FAST_CHECK_COOLDOWN_MS;

  const combatSnapshot = getPvpCombatSnapshot(player, state, nowMs);
  const oneTickBaseChance = Number(profile?.oneTickUseChance ?? 0);
  const gmaulChance = Math.min(
    0.98,
    oneTickBaseChance + Number(profile?.oneTickGmaulChance ?? 0)
  );
  const gmaulCandidate =
    getWeaponId(player) === ItemIdentifiers.GRANITE_MAUL
      ? {
          weaponId: ItemIdentifiers.GRANITE_MAUL,
          slot: -1,
          special: getSpecialForWeaponId(ItemIdentifiers.GRANITE_MAUL),
        }
      : resolveInventoryWeapon(player, ItemIdentifiers.GRANITE_MAUL, combatSnapshot);

  if (
    gmaulCandidate &&
    shouldUseSpecNow(player, target, state, profile, gmaulCandidate.special, gmaulCandidate.weaponId) &&
    isWithinMeleeRange(player, target) &&
    Math.random() <= Math.max(0.05, gmaulChance)
  ) {
    if (
      gmaulCandidate.slot >= 0 &&
      !equipWeaponFromInventory(player, state, gmaulCandidate.slot, gmaulCandidate.weaponId)
    ) {
      return false;
    }
    if (tryActivateSpecial(player, target)) {
      pvp.lastOneTickAt = nowMs;
      pvp.lastSpecAt = nowMs;
      scheduleSpecReview?.(state, nowMs);
      return true;
    }
  }

  const inventorySpec = resolveInventorySpecWeapon(player, state, combatSnapshot);
  if (!inventorySpec || inventorySpec.weaponId === ItemIdentifiers.GRANITE_MAUL) {
    return false;
  }
  if (!shouldUseSpecNow(player, target, state, profile, inventorySpec.special, inventorySpec.weaponId)) return false;
  if (Number(player?.getSpecialPercentage?.() ?? 0) < Number(inventorySpec.special?.getDrainAmount?.() ?? 101)) {
    return false;
  }

  let switchChance = Number(profile?.oneTickSwitchChance ?? 0);
  if (isSpecFinisher(player, target, state, inventorySpec.special, inventorySpec.weaponId)) {
    switchChance += 0.12;
  }
  if (Math.random() > Math.max(0.05, Math.min(0.98, switchChance))) {
    return false;
  }

  if (!equipWeaponFromInventory(player, state, inventorySpec.slot, inventorySpec.weaponId)) {
    return false;
  }
  const specAmmoId = Number(pvp.generatedSpecAmmoId ?? -1);
  if (specAmmoId > 0) {
    equipAmmoFromInventory(player, state, specAmmoId, combatSnapshot);
  }
  if (tryActivateSpecial(player, target)) {
    pvp.lastOneTickAt = nowMs;
    pvp.lastSpecAt = nowMs;
    scheduleSpecReview?.(state, nowMs);
    return true;
  }
  return false;
}

function maybeUseSpecialAttack(context) {
  const { player, state, target, nowMs, scheduleSpecReview } = context ?? {};
  const pvp = state?.pvp;
  if (!player || !pvp || !target) {
    return false;
  }

  // Recheck queued specials even while the review timer is cooling down.
  if (!canSpecTarget(player, target, player.getCombatSpecial?.()) &&
      (player.isSpecialActivated?.() || player.getCombat().isGraniteMaulSpecialQueued())) {
    player.setSpecialActivated(false);
    player.getCombat().setGraniteMaulSpecialQueued(false);
    player.getPacketSender().sendSpecialAttackState(false);
  }

  if (!player.getCombat().willAttackBeReadyIn(1)) return false;
  if (pvp.pressureAttackReviewed) return false;
  if (pvp.backstep && player.getCombat().getAttackDelay() > 1) return false;
  if (pvp.backstep) pvp.nextSpecReviewAt = 0;

  const profile = context?.profile ?? getPvpProfile(pvp.profileId);
  const canCheckOneTick =
    isVeteranOrEliteProfile(profile) &&
    nowMs >= Number(pvp.lastOneTickAt ?? 0) + Math.max(600, Number(profile?.oneTickCooldownMs ?? 3000)) &&
    nowMs >= Number(pvp.nextOneTickCheckAt ?? 0);
  if (canCheckOneTick && maybeUseOneTickAttack(context, profile)) {
    return true;
  }
  if (nowMs < Number(pvp.nextSpecReviewAt ?? 0)) {
    return false;
  }

  const currentWeaponId = getWeaponId(player);
  const currentSpecial = player?.getCombatSpecial?.() ?? getSpecialForWeaponId(currentWeaponId);

  if (shouldUseSpecNow(player, target, state, profile, currentSpecial, currentWeaponId)) {
    const activated = tryActivateSpecial(player, target);
    if (activated) {
      pvp.lastSpecAt = nowMs;
      scheduleSpecReview?.(state, nowMs);
      return true;
    }
  }

  const combatSnapshot = getPvpCombatSnapshot(player, state, nowMs);
  const inventorySpec = resolveInventorySpecWeapon(player, state, combatSnapshot);
  const switchChance = Number(profile?.specSwitchChance ?? 0.4);
  const finisher =
    inventorySpec && isSpecFinisher(player, target, state, inventorySpec.special, inventorySpec.weaponId);
  if (
    inventorySpec &&
    SWITCHABLE_SPEC_WEAPONS.has(inventorySpec.weaponId) &&
    (finisher || Math.random() <= switchChance) &&
    shouldUseSpecNow(player, target, state, profile, inventorySpec.special, inventorySpec.weaponId)
  ) {
    if (equipWeaponFromInventory(player, state, inventorySpec.slot, inventorySpec.weaponId)) {
      const specAmmoId = Number(pvp.generatedSpecAmmoId ?? -1);
      if (specAmmoId > 0) {
        equipAmmoFromInventory(player, state, specAmmoId, combatSnapshot);
      }
      const activated = tryActivateSpecial(player, target);
      if (activated) {
        pvp.lastSpecAt = nowMs;
      }
      scheduleSpecReview?.(state, nowMs);
      return true;
    }
  }

  if (
    currentWeaponId > 0 &&
    currentWeaponId !== Number(pvp.generatedPrimaryWeaponId ?? -1) &&
    currentSpecial &&
    !player?.isSpecialActivated?.()
  ) {
    switchBackToPrimaryWeapon(player, state, combatSnapshot);
  }

  scheduleSpecReview?.(state, nowMs);
  return false;
}

module.exports = {
  canSpecTarget,
  isSpecFinisher,
  resolveInventorySpecWeapon,
  maybeSwitchBackToPrimaryWeapon,
  maybeUseSpecialAttack,
};
