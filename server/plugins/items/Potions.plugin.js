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
const {
  DragonfireProtectionTier,
  processDragonfireProtection,
  setDragonfireProtection,
  initDragonfireProtectionCoreAccess,
} = require("../combat/DragonfireProtection");

let pluginApi;

const DRINK_ANIMATION = new Animation(829);
const DEFAULT_EMPTY_ITEM = ItemIds.VIAL;
const STAMINA_DURATION_MS = 2 * 60 * 1000;
const DIVINE_DURATION_MS = 5 * 60 * 1000;
const OVERLOAD_DURATION_MS = 5 * 60 * 1000;
const OVERLOAD_REFRESH_MS = 15 * 1000;
const OVERLOAD_DAMAGE_INTERVAL_MS = 600;

const ATTR_STAMINA_END = "potions:stamina:end";
const ATTR_STAMINA_ACC = "potions:stamina:acc";
const ATTR_DIVINE_STATE = "potions:divine:state";
const ATTR_OVERLOAD_STATE = "potions:overload:state";

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

function boostSkill(player, skill, flat, percent) {
  const max = getMaxLevel(player, skill);
  const current = getCurrentLevel(player, skill);
  const boost = Math.floor(max * percent) + flat;
  const cap = max + boost;
  if (current < cap) {
    getSkillManager(player).increaseCurrentLevel(skill, cap - current, cap);
  }
}

function lowerSkillByCurrent(player, skill, flat, percent, minimum = 0) {
  const current = getCurrentLevel(player, skill);
  const amount = Math.floor(current * percent) + flat;
  if (amount > 0) {
    getSkillManager(player).decreaseCurrentLevel(skill, amount, minimum);
  }
}

function lowerSkillByMax(player, skill, flat, percent, minimum = 0) {
  const max = getMaxLevel(player, skill);
  const amount = Math.floor(max * percent) + flat;
  if (amount > 0) {
    getSkillManager(player).decreaseCurrentLevel(skill, amount, minimum);
  }
}

function restoreSkillToBaseWithFormula(player, skill, flat, percent) {
  const max = getMaxLevel(player, skill);
  const current = getCurrentLevel(player, skill);
  if (current >= max) {
    return;
  }
  const amount = Math.floor(flat + max * percent);
  if (amount > 0) {
    getSkillManager(player).increaseCurrentLevel(skill, amount, max);
  }
}

function heal(player, amount, extraCap = 0) {
  const current = getCurrentLevel(player, Skill.HITPOINTS);
  const baseMax = getMaxLevel(player, Skill.HITPOINTS);
  const max = baseMax + Math.max(0, extraCap);
  player.setHitpoints(clamp(current + amount, 0, max));
}

function damageButKeepAlive(player, amount) {
  const current = getCurrentLevel(player, Skill.HITPOINTS);
  const next = Math.max(1, current - Math.max(0, amount));
  player.setHitpoints(next);
}

function restoreRunEnergy(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }
  const next = clamp(Math.floor(player.getRunEnergy() + amount), 0, 100);
  player.setRunEnergy(next);
  player.getPacketSender().sendRunEnergy();
}

function curePoisonAndVenom(player) {
  player.setPoisonDamage(0);
  player.getPacketSender().sendPoisonType(0);
}

function applyPoisonImmunity(player, seconds, message = true) {
  curePoisonAndVenom(player);
  player.getCombat().getPoisonImmunityTimer().start(seconds);
  if (message) {
    player.sendMessage(`You are now immune to poison for another ${seconds} seconds.`);
  }
}

function applyAntifire(player, seconds, tier = DragonfireProtectionTier.ANTIFIRE, label = "antifire potion") {
  setDragonfireProtection(player, { tier, seconds, label });
  player.getPacketSender().sendEffectTimer(seconds, EffectTimer.ANTIFIRE);
}

function applyPrayerRestore(player, isSuperRestore) {
  const max = getMaxLevel(player, Skill.PRAYER);
  const restored = Math.floor((isSuperRestore ? 8 : 7) + max / 4);
  getSkillManager(player).increaseCurrentLevel(Skill.PRAYER, restored, max);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
}

function applyRestorePotion(player) {
  for (const skill of Skill.values()) {
    if (skill === Skill.HITPOINTS || skill === Skill.PRAYER) {
      continue;
    }
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

function applyZamorakBrew(player) {
  boostSkill(player, Skill.ATTACK, 2, 0.2);
  boostSkill(player, Skill.STRENGTH, 2, 0.12);

  lowerSkillByMax(player, Skill.DEFENCE, 2, 0.1, 0);

  const hpCurrent = getCurrentLevel(player, Skill.HITPOINTS);
  const hpDamage = Math.floor(2 + hpCurrent * 0.1);
  damageButKeepAlive(player, hpDamage);

  const maxPrayer = getMaxLevel(player, Skill.PRAYER);
  const prayerBoost = Math.floor(maxPrayer * 0.1);
  getSkillManager(player).increaseCurrentLevel(Skill.PRAYER, prayerBoost, maxPrayer);
}

function applyGuthixRest(player) {
  heal(player, 5);
  restoreRunEnergy(player, 5);
  curePoisonAndVenom(player);
}

function startStamina(player) {
  player.setAttribute(ATTR_STAMINA_END, Date.now() + STAMINA_DURATION_MS);
  player.setAttribute(ATTR_STAMINA_ACC, 0);
}

function applyStamina(player) {
  restoreRunEnergy(player, 20);
  startStamina(player);
}

function applyDivine(player, baseEffect, affectedSkills) {
  baseEffect(player);
  damageButKeepAlive(player, 10);

  const targets = affectedSkills
    .filter(Boolean)
    .map((skill) => ({
      skill,
      target: getCurrentLevel(player, skill),
    }));

  player.setAttribute(ATTR_DIVINE_STATE, {
    endsAt: Date.now() + DIVINE_DURATION_MS,
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

function applyMix(baseEffect) {
  return (player) => {
    baseEffect(player);
    heal(player, 3);
  };
}

function canDrink(player, itemId) {
  return pluginApi.emitCanDrink(player, itemId) !== false;
}

function canEat(player, itemId) {
  return pluginApi.emitCanEat(player, itemId) !== false;
}

function registerPotion(definition) {
  if (!definition || typeof definition.effect !== "function") {
    return;
  }

  const normalized = {
    name: definition.name,
    effect: definition.effect,
    canUse: typeof definition.canUse === "function" ? definition.canUse : null,
    requiresFoodPermission: Boolean(definition.requiresFoodPermission),
    emptyItemId: isItemId(definition.emptyItemId)
      ? definition.emptyItemId
      : DEFAULT_EMPTY_ITEM,
    entries: [],
  };

  for (const chain of definition.chains || []) {
    if (!Array.isArray(chain) || chain.length === 0) {
      continue;
    }

    for (let index = 0; index < chain.length; index++) {
      const itemId = chain[index];
      if (!isItemId(itemId)) {
        continue;
      }

      const replacementId = index + 1 < chain.length
        ? chain[index + 1]
        : normalized.emptyItemId;

      const entry = {
        potion: normalized,
        itemId,
        replacementId: isItemId(replacementId)
          ? replacementId
          : normalized.emptyItemId,
      };

      POTION_BY_ITEM_ID.set(itemId, entry);
      normalized.entries.push(entry);
    }
  }

  if (normalized.entries.length > 0) {
    REGISTERED_POTIONS.push(normalized);
  }
}

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
    doseChain("COMBAT_POTION_4_3", "COMBAT_POTION_3_3", "COMBAT_POTION_2_3", "COMBAT_POTION_1_3"),
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
    doseChain("SUPER_COMBAT_POTION_4_3", "SUPER_COMBAT_POTION_3_3", "SUPER_COMBAT_POTION_2_3", "SUPER_COMBAT_POTION_1_3"),
  ],
  effect: (player) => {
    boostSkill(player, Skill.ATTACK, 5, 0.15);
    boostSkill(player, Skill.STRENGTH, 5, 0.15);
    boostSkill(player, Skill.DEFENCE, 5, 0.15);
  },
});
registerPotion({
  name: "Ranging potion",
  chains: [
    doseChain("RANGING_POTION_4_", "RANGING_POTION_3_", "RANGING_POTION_2_", "RANGING_POTION_1_"),
    doseChain("RANGING_POTION_4_3", "RANGING_POTION_3_3", "RANGING_POTION_2_3", "RANGING_POTION_1_3"),
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
    doseChain("PRAYER_POTION_4_3", "PRAYER_POTION_3_3", "PRAYER_POTION_2_3", "PRAYER_POTION_1_3"),
    doseChain("PRAYER_POTION_4_4", "PRAYER_POTION_3_4", "PRAYER_POTION_2_4", "PRAYER_POTION_1_4"),
  ],
  effect: (player) => applyPrayerRestore(player, false),
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
    doseChain("SUPER_RESTORE_4_3", "SUPER_RESTORE_3_3", "SUPER_RESTORE_2_3", "SUPER_RESTORE_1_3"),
    doseChain("BLIGHTED_SUPER_RESTORE_4_", "BLIGHTED_SUPER_RESTORE_3_", "BLIGHTED_SUPER_RESTORE_2_", "BLIGHTED_SUPER_RESTORE_1_"),
  ],
  effect: applySuperRestore,
});
registerPotion({
  name: "Saradomin brew",
  chains: [
    doseChain("SARADOMIN_BREW_4_", "SARADOMIN_BREW_3_", "SARADOMIN_BREW_2_", "SARADOMIN_BREW_1_"),
    doseChain("SARADOMIN_BREW_4_3", "SARADOMIN_BREW_3_3", "SARADOMIN_BREW_2_3", "SARADOMIN_BREW_1_3"),
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
  chains: [doseChain("GUTHIX_REST_4_", "GUTHIX_REST_3_", "GUTHIX_REST_2_", "GUTHIX_REST_1_", "GUTHIX_REST")],
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
  effect: (player) => restoreRunEnergy(player, 10),
});
registerPotion({
  name: "Super energy",
  chains: [
    doseChain("SUPER_ENERGY_4_", "SUPER_ENERGY_3_", "SUPER_ENERGY_2_", "SUPER_ENERGY_1_"),
    doseChain("SUPER_ENERGY_4_3", "SUPER_ENERGY_3_3", "SUPER_ENERGY_2_3", "SUPER_ENERGY_1_3"),
  ],
  effect: (player) => restoreRunEnergy(player, 20),
});
registerPotion({
  name: "Stamina potion",
  chains: [doseChain("STAMINA_POTION_4_", "STAMINA_POTION_3_", "STAMINA_POTION_2_", "STAMINA_POTION_1_")],
  effect: applyStamina,
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
  chains: [doseChain("ANTIDOTE_PLUS_4_", "ANTIDOTE_PLUS_3_", "ANTIDOTE_PLUS_2_", "ANTIDOTE_PLUS_1_")],
  effect: (player) => applyPoisonImmunity(player, 600),
});
registerPotion({
  name: "Antidote++",
  chains: [doseChain("ANTIDOTE_PLUS_PLUS_4_", "ANTIDOTE_PLUS_PLUS_3_", "ANTIDOTE_PLUS_PLUS_2_", "ANTIDOTE_PLUS_PLUS_1_")],
  effect: (player) => applyPoisonImmunity(player, 720),
});
registerPotion({
  name: "Sanfew serum",
  chains: [
    doseChain("SANFEW_SERUM_4_", "SANFEW_SERUM_3_", "SANFEW_SERUM_2_", "SANFEW_SERUM_1_"),
    doseChain("SANFEW_SERUM_4_3", "SANFEW_SERUM_3_3", "SANFEW_SERUM_2_3", "SANFEW_SERUM_1_3"),
  ],
  effect: (player) => {
    applySuperRestore(player);
    applyPoisonImmunity(player, 360, false);
  },
});
registerPotion({
  name: "Anti-venom",
  chains: [doseChain("ANTI_VENOM_4_", "ANTI_VENOM_3_", "ANTI_VENOM_2_", "ANTI_VENOM_1_")],
  effect: (player) => applyPoisonImmunity(player, 180),
});
registerPotion({
  name: "Anti-venom+",
  chains: [doseChain("ANTI_VENOM_PLUS_4_", "ANTI_VENOM_PLUS_3_", "ANTI_VENOM_PLUS_2_", "ANTI_VENOM_PLUS_1_")],
  effect: (player) => applyPoisonImmunity(player, 360),
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
  effect: applyMix((player) => applyPoisonImmunity(player, 90, false)),
});
registerPotion({
  name: "Restore mix",
  chains: [doseChain("RESTORE_MIX_2_", "RESTORE_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix(applyRestorePotion),
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
  chains: [doseChain("ANTIDOTE_PLUS_MIX_2_", "ANTIDOTE_PLUS_MIX_1_")],
  requiresFoodPermission: true,
  effect: applyMix((player) => applyPoisonImmunity(player, 600, false)),
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

registerPotion({
  name: "Divine super attack potion",
  chains: [doseChain("DIVINE_SUPER_ATTACK_POTION_4_", "DIVINE_SUPER_ATTACK_POTION_3_", "DIVINE_SUPER_ATTACK_POTION_2_", "DIVINE_SUPER_ATTACK_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.ATTACK, 5, 0.15), [Skill.ATTACK]),
});
registerPotion({
  name: "Divine super strength potion",
  chains: [doseChain("DIVINE_SUPER_STRENGTH_POTION_4_", "DIVINE_SUPER_STRENGTH_POTION_3_", "DIVINE_SUPER_STRENGTH_POTION_2_", "DIVINE_SUPER_STRENGTH_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.STRENGTH, 5, 0.15), [Skill.STRENGTH]),
});
registerPotion({
  name: "Divine super defence potion",
  chains: [doseChain("DIVINE_SUPER_DEFENCE_POTION_4_", "DIVINE_SUPER_DEFENCE_POTION_3_", "DIVINE_SUPER_DEFENCE_POTION_2_", "DIVINE_SUPER_DEFENCE_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.DEFENCE, 5, 0.15), [Skill.DEFENCE]),
});
registerPotion({
  name: "Divine ranging potion",
  chains: [doseChain("DIVINE_RANGING_POTION_4_", "DIVINE_RANGING_POTION_3_", "DIVINE_RANGING_POTION_2_", "DIVINE_RANGING_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.RANGED, 4, 0.1), [Skill.RANGED]),
});
registerPotion({
  name: "Divine magic potion",
  chains: [doseChain("DIVINE_MAGIC_POTION_4_", "DIVINE_MAGIC_POTION_3_", "DIVINE_MAGIC_POTION_2_", "DIVINE_MAGIC_POTION_1_")],
  effect: (player) => applyDivine(player, (p) => boostSkill(p, Skill.MAGIC, 4, 0), [Skill.MAGIC]),
});
registerPotion({
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
registerPotion({
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
registerPotion({
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
registerPotion({
  name: "Overload",
  chains: [doseChain("OVERLOAD_4_", "OVERLOAD_3_", "OVERLOAD_2_", "OVERLOAD_1_")],
  canUse: (player) => getCurrentLevel(player, Skill.HITPOINTS) > 50,
  effect: applyOverload,
});
registerPotion({
  name: "Overload (+)",
  chains: [doseChain("OVERLOAD_4__5", "OVERLOAD_3__5", "OVERLOAD_2__5", "OVERLOAD_1__5")],
  canUse: (player) => getCurrentLevel(player, Skill.HITPOINTS) > 50,
  effect: (player) => applyOverload(player, 6, 0.16),
});

function processStamina(player) {
  const endsAt = player.getAttribute(ATTR_STAMINA_END);
  if (!Number.isFinite(endsAt)) {
    return;
  }

  if (Date.now() >= endsAt) {
    player.setAttribute(ATTR_STAMINA_END, null);
    player.setAttribute(ATTR_STAMINA_ACC, 0);
    return;
  }

  if (!player.isRunningReturn() || !player.getMovementQueue().isMovings()) {
    return;
  }

  let acc = Number(player.getAttribute(ATTR_STAMINA_ACC));
  if (!Number.isFinite(acc)) {
    acc = 0;
  }
  acc += 0.7;

  let gained = 0;
  while (acc >= 1) {
    acc -= 1;
    if (player.getRunEnergy() < 100) {
      player.setRunEnergy(player.getRunEnergy() + 1);
      gained++;
    }
  }

  player.setAttribute(ATTR_STAMINA_ACC, acc);

  if (gained > 0) {
    player.getPacketSender().sendRunEnergy();
  }
}

function processDivine(player) {
  const state = player.getAttribute(ATTR_DIVINE_STATE);
  if (!state || !Array.isArray(state.targets)) {
    return;
  }

  if (Date.now() >= state.endsAt) {
    player.setAttribute(ATTR_DIVINE_STATE, null);
    for (const entry of state.targets) {
      if (entry?.skill) {
        setCurrentLevel(player, entry.skill, getMaxLevel(player, entry.skill));
      }
    }
    player.sendMessage("Your divine potion effect has worn off.");
    return;
  }

  for (const entry of state.targets) {
    if (!entry || !entry.skill) {
      continue;
    }
    setCurrentLevel(player, entry.skill, entry.target);
  }
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

  if (!canDrink(player, itemId)) {
    player.sendMessage("You cannot use potions here.");
    return true;
  }

  if (entry.potion.requiresFoodPermission && !canEat(player, itemId)) {
    player.sendMessage("You cannot eat here.");
    return true;
  }

  const timers = player.getTimers();
  if (timers.has(TimerKey.STUN)) {
    player.sendMessage("You're currently stunned and cannot use potions.");
    return true;
  }

  if (timers.has(TimerKey.POTION)) {
    return true;
  }

  if (entry.potion.canUse && !entry.potion.canUse(player)) {
    player.sendMessage("You need more than 50 Hitpoints to drink this potion.");
    return true;
  }

  timers.extendOrRegister(TimerKey.POTION, 3);
  timers.extendOrRegister(TimerKey.FOOD, 3);

  player.getPacketSender().sendInterfaceRemoval();
  player.getCombat().reset();
  player.performAnimation(DRINK_ANIMATION);
  Sounds.sendSound(player, Sound.DRINK);

  inventory.setItem(slot, new Item(entry.replacementId)).refreshItems();
  entry.potion.effect(player);

  const share = player.getAttribute("lunar:potion-share");
  if (share && Date.now() < share.expiresAt) {
    const restorative = /restore|prayer|energy|stamina|antipoison|antidote|antifire|guthix rest/i.test(entry.potion.name);
    if ((share.type === "restore") === restorative) {
      entry.potion.effect(share.target);
      share.target.sendMessage(`${player.getUsername()} shares their ${entry.potion.name}.`);
      player.setAttribute("lunar:potion-share", null);
    }
  }

  if (entry.replacementId === entry.potion.emptyItemId) {
    player.sendMessage("You have finished your potion.");
  }

  return true;
}

module.exports = {
  name: "Potions",
  isPotionItem(itemId) {
    return POTION_BY_ITEM_ID.has(itemId);
  },
  getPotionName(itemId) {
    return POTION_BY_ITEM_ID.get(itemId)?.potion?.name ?? null;
  },
  register(api) {
    pluginApi = api;
    initDragonfireProtectionCoreAccess(api);
    api.onItemFirstAction((event) => {
      const { player, itemId, slot } = event;
      return handlePotionDrink(player, itemId, slot);
    });

    api.onPlayerProcess(({ player }) => {
      if (player?.isPlayerBot?.()) {
        return;
      }
      processStamina(player);
      processDivine(player);
      processOverload(player);
      processDragonfireProtection(player);
    });

    api.log("registered", {
      potionEntries: POTION_BY_ITEM_ID.size,
      potionGroups: REGISTERED_POTIONS.length,
    });
  },
};
