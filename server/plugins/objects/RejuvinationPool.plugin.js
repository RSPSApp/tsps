const { CombatSpecial } = require("../../src/main/typescript/elvarg/game/content/combat/CombatSpecial");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");

const ATTR_BLEED_TASK_KEY = "combat:bleed:task-key";
const POOL_USE_DELAY_MS = 1000;
const nextPoolUseAt = new WeakMap();

function isRecentPvpCombat(player) {
  if (!player) {
    return false;
  }
  const combat = player.getCombat?.();
  const participants = [combat?.getTarget?.(), combat?.getAttacker?.()];
  return participants.some((other) => {
    if (
      other?.isPlayer?.() !== true ||
      other?.isRegistered?.() !== true ||
      (other.getHitpoints?.() ?? 0) <= 0
    ) {
      return false;
    }
    return true;
  });
}

function restoreLoweredStats(player) {
  const skillManager = player.getSkillManager?.();
  if (!skillManager) {
    return;
  }
  for (const skill of Skill.values()) {
    if (skill === Skill.HITPOINTS || skill === Skill.PRAYER) continue;
    const current = Number(skillManager.getCurrentLevel?.(skill) ?? 0);
    const max = Number(skillManager.getMaxLevel?.(skill) ?? 0);
    if (current < max) {
      skillManager.setCurrentLevels?.(skill, max, true);
    }
  }
}

function restorePrayer(player) {
  const skillManager = player.getSkillManager?.();
  if (!skillManager) {
    return;
  }
  const maxPrayer = Number(skillManager.getMaxLevel?.(Skill.PRAYER) ?? 0);
  if (maxPrayer > (skillManager.getCurrentLevel(Skill.PRAYER) ?? 0)) {
    skillManager.setCurrentLevels?.(Skill.PRAYER, maxPrayer, true);
  }
}

function restoreHitpoints(player) {
  const skillManager = player.getSkillManager?.();
  const maxHp = Number(skillManager?.getMaxLevel?.(Skill.HITPOINTS) ?? 0);
  if (maxHp > (player.getHitpoints?.() ?? 0)) {
    player.setHitpoints?.(maxHp);
  }
}

function restoreSpecialAttack(player) {
  player.setSpecialActivated?.(false);
  player.setRecoveringSpecialAttack?.(false);
  player.setSpecialPercentage?.(100);
  player.getSpecialAttackRestore?.().stop?.();
  CombatSpecial.updateBar?.(player);
}

function restoreRunEnergy(player) {
  player.setRunEnergy?.(100);
  player.getPacketSender?.().sendRunEnergy?.();
}

function clearPoisonAndVenom(player) {
  player.setPoisonDamage?.(0);
  player.setVenomed?.(false);
  player.getPacketSender?.().sendPoisonType?.(0);
}

function clearBleed(player) {
  const bleedTaskKey = player.getAttribute?.(ATTR_BLEED_TASK_KEY);
  if (bleedTaskKey) {
    TaskManager.cancelTasks(bleedTaskKey);
    player.setAttribute?.(ATTR_BLEED_TASK_KEY, null);
  }
}

function restoreFromPool(player, tier) {
  restoreSpecialAttack(player);
  if (tier >= 1) restoreRunEnergy(player);
  if (tier >= 2) restorePrayer(player);
  if (tier >= 3) restoreLoweredStats(player);
  if (tier >= 4) {
    restoreHitpoints(player);
    clearPoisonAndVenom(player);
    clearBleed(player);
  }
}

let TaskManager;

function drinkFromPool(event, tier = 4) {
  const player = event.player;
  if (isRecentPvpCombat(player)) {
    player.sendMessage("You can't drink from the pool during combat.");
    event.handled = true;
    return;
  }
  const now = Date.now();
  if (now < (nextPoolUseAt.get(player) ?? 0)) {
    event.handled = true;
    return;
  }
  nextPoolUseAt.set(player, now + POOL_USE_DELAY_MS);
  restoreFromPool(player, tier);
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  player.sendMessage("You feel rejuvenated.");
  event.handled = true;
}

function restoration(event) { return drinkFromPool(event, 0); }
function revitalisation(event) { return drinkFromPool(event, 1); }
function rejuvenation(event) { return drinkFromPool(event, 2); }
function fancyRejuvenation(event) { return drinkFromPool(event, 3); }

module.exports = {
  name: "RejuvinationPool",
  register(api) {
    TaskManager = api.getTaskManager();
    api.onObjectInteraction("Pool of Restoration", { Drink: restoration });
    api.onObjectInteraction("Pool of Revitalisation", { Drink: revitalisation });
    api.onObjectInteraction("Pool of Rejuvenation", { Drink: rejuvenation });
    api.onObjectInteraction("Fancy pool of Rejuvenation", { Drink: fancyRejuvenation });
    api.onObjectInteraction("Ornate pool of Rejuvenation", { Drink: drinkFromPool });
  },
};
