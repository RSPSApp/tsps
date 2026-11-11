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
  // Ordinary poison stores severity (its hit is floor((severity + 4) / 5)); venom stores its damage directly.
  // A conversion keeps that hit at the lowest severity giving it, 5 x damage - 4, without also reducing it
  // during the same treatment (rsprox_transcripts/223/00014.txt tick 3125: an antipoison turns 6-damage
  // venom, poison varp 1000000, into 26).
  const stored = player.getPoisonDamage();
  const current = Number.isFinite(stored) ? Math.max(0, stored) : 0;
  const severity = player.isVenomed?.()
    ? Math.max(0, current * 5 - 4)
    : Math.max(0, current - damageReduction * 5);
  player.setPoisonDamage(severity);
  player.setVenomed(false);
}

/**
 * Adds a boost of flat + percent of base to the current level, never past base + that boost. A drained stat gains the
 * boost from where it stands, as recorded on normal worlds: a super combat potion at 97/99 gives 116, not 118
 * (rsprox_transcripts/226/01702.txt:105119-105678); a divine super combat at 96 gives 115 and at 98 gives 117
 * (226/01696.txt, ticks 827 and 977).
 */
function boostSkill(player, skill, flat, percent) {
  const skills = player.getSkillManager();
  const max = skills.getMaxLevel(skill);
  const current = skills.getCurrentLevel(skill);
  const boost = Math.floor(max * percent) + flat;
  const cap = max + boost;
  if (current < cap) {
    skills.increaseCurrentLevel(skill, boost, cap);
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
