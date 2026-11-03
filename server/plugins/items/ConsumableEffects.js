"use strict";

// Shared canonical effects for potions and restorative food.
function restoreRunEnergy(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (typeof player.addRunEnergyUnits === "function") {
    player.addRunEnergyUnits(Math.round(amount * 100));
  } else {
    player.setRunEnergy(Math.max(0, Math.min(100, Math.floor(player.getRunEnergy() + amount))));
  }
  player.getPacketSender().sendRunEnergy();
}

function curePoisonAndVenom(player) {
  player.setPoisonDamage(0);
  // Venom remains sticky until explicitly cured.
  if (typeof player.setVenomed === "function") player.setVenomed(false);
}

/** Cure/reduce poison damage without immunity; venom is only converted to poison. */
function curePoison(player, damageReduction = Infinity) {
  // Ordinary poison stores five severity points per starting damage; venom
  // stores its damage directly. A conversion retains that damage, without also
  // reducing it during the same treatment.
  const stored = player.getPoisonDamage();
  const current = Number.isFinite(stored) ? Math.max(0, stored) : 0;
  const severity = player.isVenomed?.()
    ? current * 5
    : Math.max(0, current - damageReduction * 5);
  player.setPoisonDamage(severity);
  player.setVenomed(false);
}

/** Raises a skill to base + flat + percent of base, unless it is already there. */
function boostSkill(player, skill, flat, percent) {
  const skills = player.getSkillManager();
  const max = skills.getMaxLevel(skill);
  const current = skills.getCurrentLevel(skill);
  const cap = max + Math.floor(max * percent) + flat;
  if (current < cap) {
    skills.increaseCurrentLevel(skill, cap - current, cap);
  }
}

function lowerSkillByCurrent(player, skill, flat, percent, minimum = 0) {
  const skills = player.getSkillManager();
  const amount = Math.floor(skills.getCurrentLevel(skill) * percent) + flat;
  if (amount > 0) {
    skills.decreaseCurrentLevel(skill, amount, minimum);
  }
}

function lowerSkillByMax(player, skill, flat, percent, minimum = 0) {
  const skills = player.getSkillManager();
  const amount = Math.floor(skills.getMaxLevel(skill) * percent) + flat;
  if (amount > 0) {
    skills.decreaseCurrentLevel(skill, amount, minimum);
  }
}

/** Restores a skill toward its base level, never above it. */
function restoreSkillToBaseWithFormula(player, skill, flat, percent) {
  const skills = player.getSkillManager();
  const max = skills.getMaxLevel(skill);
  if (skills.getCurrentLevel(skill) >= max) {
    return;
  }
  const amount = Math.floor(flat + max * percent);
  if (amount > 0) {
    skills.increaseCurrentLevel(skill, amount, max);
  }
}

module.exports = {
  restoreRunEnergy,
  curePoisonAndVenom,
  curePoison,
  boostSkill,
  lowerSkillByCurrent,
  lowerSkillByMax,
  restoreSkillToBaseWithFormula,
};
