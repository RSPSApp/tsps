"use strict";

/**
 * Monsters with a Slayer level can't be attacked below it, on a task or not (Wiki: Slayer).
 * The level is the NPC definition's (NpcDefinitionLoader); the message is captured. A refused
 * attack resets combat, so the message is sent once per attempt.
 */
const LEVEL_TOO_LOW = "You need a higher Slayer level to know how to wound this monster.";

let core = null;

function init(api) {
  core = api.core;
}

function slayerLevel(npc) {
  return (npc.getCurrentDefinition?.() ?? npc.getDefinition?.())?.getSlayerLevel?.() ?? 0;
}

function canAttack(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return;
  const required = slayerLevel(target);
  if (required <= 1) return;
  if (attacker.getSkillManager().getCurrentLevel(core.Skill.SLAYER) >= required) return;
  attacker.sendMessage(LEVEL_TOO_LOW);
  event.allow = false;
}

function attach(api) {
  api.onCanAttack(canAttack);
}

module.exports = { init, attach, canAttack, LEVEL_TOO_LOW };
