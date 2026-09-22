"use strict";

const { CombatType } = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { WeaponInterfaces } = require("../../../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces");
const { ItemIdentifiers } = require("../../../../src/main/typescript/elvarg/util/ItemIdentifiers");

const { MagicSpellbook } = require("../../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const { PVP_LOADOUT_DEFINITIONS } = require("../pvp/PvpLoadoutRegistry");

// Resolve from the loadout, not autocast: Wilderness weapon switches clear autocast.
function resolveOffensiveSpell(player) {
  const { CombatSpells } = require("../../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
  const presetSpell = CombatSpells.getCombatSpell(player.getCurrentPreset?.()?.getAutocastSpellId?.() ?? -1);
  const spells = presetSpell ? [presetSpell] : player.getSpellbook() === MagicSpellbook.ANCIENT
    ? [CombatSpells.ICE_BARRAGE, CombatSpells.ICE_BLITZ, CombatSpells.ICE_BURST, CombatSpells.ICE_RUSH]
    : [];
  return spells.find((spell) => spell.getSpellbook() === player.getSpellbook() &&
    spell.levelRequired() <= player.getSkillManager().getCurrentLevel(Skill.MAGIC) &&
    player.getInventory().containsAllItem(spell.itemsToConsume(player)) &&
    player.getEquipment().containsAllItem(spell.equipmentRequired(player) ?? [])) ?? null;
}

function equipStyleGear(player, combatType) {
  const { EquipPacketListener } = require("../../../../src/main/typescript/elvarg/net/packet/impl/EquipPacketListener");
  const { Inventory } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Inventory");
  const equipment = player.getEquipment();
  const twoHanded = equipment.get(Equipment.WEAPON_SLOT).getDefinition().isDoubleHanded();
  // ponytail: individual bonuses approximate switch sets; explicit sets are needed
  // if future loadouts carry competing armour with full-set effects.
  const score = (item) => {
    const b = item.getDefinition().getBonuses() ?? [];
    const attack = combatType === CombatType.MAGIC ? (b[3] ?? 0) :
      combatType === CombatType.RANGED ? (b[4] ?? 0) : Math.max(...b.slice(0, 3), 0);
    const strength = b[combatType === CombatType.MAGIC ? 12 : combatType === CombatType.RANGED ? 11 : 10] ?? 0;
    return attack + strength * 2 + b.slice(5, 10).reduce((sum, value) => sum + value, 0) * 0.01;
  };
  const bestBySlot = new Map();
  for (const item of [...equipment.getItems(), ...player.getInventory().getItems()]) {
    if (!item || item.getId() <= 0) continue;
    const definition = item.getDefinition();
    const slot = definition.getEquipmentType().getSlot();
    if (slot < 0 || slot === Equipment.WEAPON_SLOT || slot === Equipment.AMMUNITION_SLOT ||
        (slot === Equipment.SHIELD_SLOT && twoHanded)) continue;
    const requirements = definition.getRequirements();
    if (requirements && Skill.values().some((skill) =>
      (requirements[skill.getIndex()] ?? 0) > player.getSkillManager().getMaxLevel(skill))) continue;
    const best = bestBySlot.get(slot);
    if (!best || score(item) > score(best)) bestBySlot.set(slot, item);
  }
  let changed = false;
  for (const [slot, item] of bestBySlot) {
    const id = item.getId();
    if (equipment.get(slot).getId() === id) continue;
    // Every equip can move inventory entries; resolve the live slot each time.
    const inventorySlot = resolveInventorySlotByItemId(player, id);
    if (inventorySlot >= 0) {
      EquipPacketListener.equip(player, id, inventorySlot, Inventory.INTERFACE_ID);
      changed ||= equipment.get(slot).getId() === id;
    }
  }
  return changed;
}

const STAFF_INTERFACES = new Set([
  WeaponInterfaces.STAFF,
  WeaponInterfaces.ANCIENT_STAFF,
]);
const RANGED_INTERFACES = new Set([
  WeaponInterfaces.SHORTBOW,
  WeaponInterfaces.LONGBOW,
  WeaponInterfaces.DARK_BOW,
  WeaponInterfaces.CROSSBOW,
  WeaponInterfaces.KARILS_CROSSBOW,
  WeaponInterfaces.KNIFE,
  WeaponInterfaces.OBBY_RINGS,
  WeaponInterfaces.THROWNAXE,
  WeaponInterfaces.DART,
  WeaponInterfaces.JAVELIN,
  WeaponInterfaces.BLOWPIPE,
]);
const BOW_INTERFACES = new Set([
  WeaponInterfaces.SHORTBOW,
  WeaponInterfaces.LONGBOW,
  WeaponInterfaces.DARK_BOW,
]);
const CROSSBOW_INTERFACES = new Set([
  WeaponInterfaces.CROSSBOW,
  WeaponInterfaces.KARILS_CROSSBOW,
]);
function resolveConfiguredItemIds(keys, label) {
  if (!Array.isArray(keys)) throw new Error("[pvp bot loadouts] " + label + " must be an array");
  return keys.map((key) => {
    const id = ItemIdentifiers[key];
    if (!Number.isInteger(id)) throw new Error("[pvp bot loadouts] " + label + " has unknown ItemIdentifiers key " + key);
    return id;
  });
}

const combatDefinitions = PVP_LOADOUT_DEFINITIONS.combat ?? {};
const ARROW_IDS = new Set(resolveConfiguredItemIds(combatDefinitions.arrows, "combat.arrows"));
const BOLT_IDS = new Set(resolveConfiguredItemIds(combatDefinitions.bolts, "combat.bolts"));
const SPEC_WEAPON_IDS = new Set(resolveConfiguredItemIds(combatDefinitions.specWeapons, "combat.specWeapons"));
const SUPPORTED_SPEC_WEAPONS = Object.freeze([...SPEC_WEAPON_IDS]);
const COMBAT_ITEM_IDS = Object.freeze(Object.fromEntries(
  Object.entries(combatDefinitions.specialCases ?? {}).map(([name, key]) => [
    name,
    resolveConfiguredItemIds([key], "combat.specialCases." + name)[0],
  ])
));
const START_COMBAT_POTION_NAMES = new Set(combatDefinitions.startCombatPotions ?? []);

function getWeaponId(player) {
  return player?.getEquipment?.()?.get?.(Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
}

function getAmmoId(player) {
  return player?.getEquipment?.()?.get?.(Equipment.AMMUNITION_SLOT)?.getId?.() ?? -1;
}

function resolveInventorySlotByItemId(player, itemId, snapshot = null, preferredSlot = -1) {
  if (!player || !Number.isInteger(itemId) || itemId <= 0) {
    return -1;
  }
  const inventoryItems = player?.getInventory?.()?.getItems?.() ?? [];
  const validatedPreferredSlot = Number.isInteger(preferredSlot) ? preferredSlot : -1;
  if (validatedPreferredSlot >= 0) {
    const item = inventoryItems[validatedPreferredSlot];
    if (item?.getId?.() === itemId) {
      return validatedPreferredSlot;
    }
  }
  const snapshotSlot = snapshot?.slotByItemId?.get?.(itemId);
  if (Number.isInteger(snapshotSlot) && snapshotSlot >= 0) {
    const item = inventoryItems[snapshotSlot];
    if (item?.getId?.() === itemId) {
      return snapshotSlot;
    }
  }
  return player?.getInventory?.()?.getSlotForItemId?.(itemId) ?? -1;
}

function isStaffInterface(weaponInterface) {
  return STAFF_INTERFACES.has(weaponInterface);
}

function isRangedInterface(weaponInterface) {
  return RANGED_INTERFACES.has(weaponInterface);
}

function classifyWeaponInterface(weaponInterface) {
  if (!weaponInterface) {
    return null;
  }
  if (isStaffInterface(weaponInterface)) {
    return CombatType.MAGIC;
  }
  if (isRangedInterface(weaponInterface)) {
    return CombatType.RANGED;
  }
  if (weaponInterface === WeaponInterfaces.UNARMED) {
    return null;
  }
  return CombatType.MELEE;
}

function resolveCurrentCombatType(player, weaponInterface, currentWeaponId) {
  const combat = player?.getCombat?.();
  if (
    combat?.getCastSpell?.() != null ||
    (combat?.getAutocastSpell?.() != null &&
      (isStaffInterface(weaponInterface) || player?.getEquipment?.()?.hasStaffEquipped?.() === true))
  ) {
    return CombatType.MAGIC;
  }
  if (SPEC_WEAPON_IDS.has(currentWeaponId) && player?.isSpecialActivated?.() === true) {
    const specialCombatMethod = player?.getCombatSpecial?.()?.getCombatMethod?.();
    const specialType = specialCombatMethod?.type?.();
    if (Number.isInteger(specialType)) {
      return specialType;
    }
  }
  return classifyWeaponInterface(weaponInterface);
}

function cloneAmmoCandidate(ammo) {
  if (!ammo) {
    return null;
  }
  return {
    ammoId: ammo.ammoId,
    slot: ammo.slot,
  };
}

function buildCombatSnapshot(player, state, nowMs) {
  const pvp = state?.pvp;
  const inventoryItems = player?.getInventory?.()?.getItems?.() ?? [];
  const currentWeaponInterface = player?.getWeapon?.() ?? null;
  const currentWeaponId = getWeaponId(player);
  const currentAmmoId = getAmmoId(player);
  const currentCombatType = resolveCurrentCombatType(
    player,
    currentWeaponInterface,
    currentWeaponId
  );
  const generatedPrimaryWeaponId = Number(pvp?.generatedPrimaryWeaponId ?? -1);
  const generatedSpecWeaponId = Number(pvp?.generatedSpecWeaponId ?? -1);
  const slotByItemId = new Map();
  const styleCandidatesByType = new Map();
  let firstArrow = null;
  let firstBolt = null;
  let preferredSpecCandidate = null;
  let fallbackSpecCandidate = null;

  firstArrow = ARROW_IDS.has(currentAmmoId) ? { ammoId: currentAmmoId, slot: -1 } : null;
  firstBolt = BOLT_IDS.has(currentAmmoId) ? { ammoId: currentAmmoId, slot: -1 } : null;
  for (let slot = 0; slot < inventoryItems.length; slot++) {
    const id = inventoryItems[slot]?.getId?.();
    if (!firstArrow && ARROW_IDS.has(id)) firstArrow = { ammoId: id, slot };
    if (!firstBolt && BOLT_IDS.has(id)) firstBolt = { ammoId: id, slot };
  }

  for (let slot = 0; slot < inventoryItems.length; slot++) {
    const item = inventoryItems[slot];
    const itemId = item?.getId?.() ?? -1;
    if (itemId <= 0) {
      continue;
    }

    if (!slotByItemId.has(itemId)) {
      slotByItemId.set(itemId, slot);
    }

    if (!preferredSpecCandidate && itemId === generatedSpecWeaponId) {
      preferredSpecCandidate = { weaponId: itemId, slot };
    } else if (!fallbackSpecCandidate && SUPPORTED_SPEC_WEAPONS.includes(itemId)) {
      fallbackSpecCandidate = { weaponId: itemId, slot };
    }

    const weaponInterface = item?.getDefinition?.()?.getWeaponInterface?.();
    const combatType = classifyWeaponInterface(weaponInterface);
    if (combatType == null) {
      continue;
    }

    let ammo = null;
    if (BOW_INTERFACES.has(weaponInterface)) {
      ammo =
        currentAmmoId > 0 && ARROW_IDS.has(currentAmmoId)
          ? { ammoId: currentAmmoId, slot: -1 }
          : cloneAmmoCandidate(firstArrow);
    } else if (CROSSBOW_INTERFACES.has(weaponInterface)) {
      ammo =
        currentAmmoId > 0 && BOLT_IDS.has(currentAmmoId)
          ? { ammoId: currentAmmoId, slot: -1 }
          : cloneAmmoCandidate(firstBolt);
    }

    const candidate = {
      combatType,
      weaponId: itemId,
      slot,
      weaponInterface,
      ammo,
      current: false,
    };
    const existing = styleCandidatesByType.get(combatType);
    if (!existing || itemId === generatedPrimaryWeaponId ||
        (SPEC_WEAPON_IDS.has(existing.weaponId) && !SPEC_WEAPON_IDS.has(itemId))) {
      styleCandidatesByType.set(combatType, candidate);
    }
  }

  const currentWeaponType = classifyWeaponInterface(currentWeaponInterface);
  if (currentWeaponId > 0 && currentWeaponType != null) {
    let currentAmmo = null;
    if (BOW_INTERFACES.has(currentWeaponInterface)) {
      currentAmmo =
        currentAmmoId > 0 && ARROW_IDS.has(currentAmmoId)
          ? { ammoId: currentAmmoId, slot: -1 }
          : cloneAmmoCandidate(firstArrow);
    } else if (CROSSBOW_INTERFACES.has(currentWeaponInterface)) {
      currentAmmo =
        currentAmmoId > 0 && BOLT_IDS.has(currentAmmoId)
          ? { ammoId: currentAmmoId, slot: -1 }
          : cloneAmmoCandidate(firstBolt);
    }
    const alternative = styleCandidatesByType.get(currentWeaponType);
    if (!alternative || !SPEC_WEAPON_IDS.has(currentWeaponId) || currentWeaponId === generatedPrimaryWeaponId) {
      styleCandidatesByType.set(currentWeaponType, {
        combatType: currentWeaponType,
        weaponId: currentWeaponId,
        slot: -1,
        weaponInterface: currentWeaponInterface,
        ammo: currentAmmo,
        current: currentWeaponType === currentCombatType,
      });
    }
  }

  // Ancients can be manually cast without a staff (notably the NH pure preset).
  if (!styleCandidatesByType.has(CombatType.MAGIC) && player.getSpellbook() === MagicSpellbook.ANCIENT) {
    styleCandidatesByType.set(CombatType.MAGIC, {
      combatType: CombatType.MAGIC, weaponId: currentWeaponId, slot: -1,
      weaponInterface: currentWeaponInterface, ammo: null, current: false,
    });
  }

  return {
    nowMs,
    currentWeaponId,
    currentAmmoId,
    currentWeaponInterface,
    currentCombatType,
    slotByItemId,
    styleCandidatesByType,
    preferredSpecCandidate,
    fallbackSpecCandidate,
  };
}

function getPvpCombatSnapshot(player, state, nowMs) {
  const pvp = state?.pvp;
  if (!player || !pvp) {
    return null;
  }
  const cached = pvp.runtimeCombatSnapshot ?? null;
  const currentWeaponId = getWeaponId(player);
  const currentAmmoId = getAmmoId(player);
  const currentWeaponInterface = player?.getWeapon?.() ?? null;
  const combat = player?.getCombat?.();
  const castSpellId = combat?.getCastSpell?.()?.spellId?.() ?? null;
  const autocastSpellId = combat?.getAutocastSpell?.()?.spellId?.() ?? null;
  const specialActive = player?.isSpecialActivated?.() === true;
  if (
    cached &&
    cached.currentWeaponId === currentWeaponId &&
    cached.currentAmmoId === currentAmmoId &&
    cached.currentWeaponInterface === currentWeaponInterface &&
    cached.castSpellId === castSpellId &&
    cached.autocastSpellId === autocastSpellId &&
    cached.specialActive === specialActive &&
    cached.generatedPrimaryWeaponId === Number(pvp?.generatedPrimaryWeaponId ?? -1) &&
    cached.generatedPrimaryAmmoId === Number(pvp?.generatedPrimaryAmmoId ?? -1) &&
    cached.generatedSpecWeaponId === Number(pvp?.generatedSpecWeaponId ?? -1) &&
    cached.generatedSpecAmmoId === Number(pvp?.generatedSpecAmmoId ?? -1)
  ) {
    cached.nowMs = nowMs;
    return cached.snapshot;
  }
  const snapshot = buildCombatSnapshot(player, state, nowMs);
  pvp.runtimeCombatSnapshot = {
    nowMs,
    currentWeaponId,
    currentAmmoId,
    currentWeaponInterface,
    castSpellId,
    autocastSpellId,
    specialActive,
    generatedPrimaryWeaponId: Number(pvp?.generatedPrimaryWeaponId ?? -1),
    generatedPrimaryAmmoId: Number(pvp?.generatedPrimaryAmmoId ?? -1),
    generatedSpecWeaponId: Number(pvp?.generatedSpecWeaponId ?? -1),
    generatedSpecAmmoId: Number(pvp?.generatedSpecAmmoId ?? -1),
    snapshot,
  };
  return snapshot;
}

function invalidatePvpCombatSnapshot(state) {
  if (state?.pvp) {
    state.pvp.runtimeCombatSnapshot = null;
  }
}

module.exports = {
  equipStyleGear,
  resolveOffensiveSpell,
  ARROW_IDS,
  BOLT_IDS,
  COMBAT_ITEM_IDS,
  BOW_INTERFACES,
  CROSSBOW_INTERFACES,
  SPEC_WEAPON_IDS,
  SUPPORTED_SPEC_WEAPONS,
  START_COMBAT_POTION_NAMES,
  classifyWeaponInterface,
  getAmmoId,
  getPvpCombatSnapshot,
  getWeaponId,
  invalidatePvpCombatSnapshot,
  resolveInventorySlotByItemId,
  isRangedInterface,
  isStaffInterface,
  resolveCurrentCombatType,
};
