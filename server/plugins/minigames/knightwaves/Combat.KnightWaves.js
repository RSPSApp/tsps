"use strict";

/**
 * A knight's damaging hit lowers the stats its Wiki page names. The activity page lists the
 * melee stats; the individual pages add Ranged and Magic (unusable here, but still lowered).
 * Only Sir Lancelot's amount is on the Wiki ("by 5 each"); the same five is used everywhere and
 * disclosed in docs/knight-waves.md.
 */
const Common = require("./Common.KnightWaves");

function drain(event) {
  const { attacker, target, hit } = event;
  const tag = attacker?.__knightWaves;
  if (!tag || !target?.isPlayer?.() || target !== tag.player) return;
  if (hit?.isAccurate?.() !== true || (hit.getTotalDamage?.() ?? 0) <= 0) return;
  const knight = Common.knightAt(tag.index);
  if (!knight) return;
  const skills = target.getSkillManager?.();
  if (!skills) return;
  for (const name of knight.drains) {
    const skill = Common.core.Skill?.[name];
    if (skill === undefined) continue;
    const current = skills.getCurrentLevel(skill);
    skills.setCurrentLevel(skill, Math.max(0, current - Common.DRAIN_PER_HIT), true);
  }
}

function attachCombat(api) {
  api.onCombatHitResolved(drain);
}

module.exports = { attachCombat, drain };
