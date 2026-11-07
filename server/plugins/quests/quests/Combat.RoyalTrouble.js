"use strict";

const { LEVEL_TOO_LOW } = require("../../skills/slayer/Combat.Slayer");
let core;

function init(api) {
  core = api.core;
}

function canAttack(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || target.getId() !== core.NpcIdentifiers.GIANT_SEA_SNAKE) return;
  if (attacker.getSkillManager().getCurrentLevel(core.Skill.SLAYER) >= 40) return;
  attacker.sendMessage(LEVEL_TOO_LOW);
  event.allow = false;
}

function attach(api) {
  api.onCanAttack(canAttack);
}

module.exports = { init, attach, canAttack };
