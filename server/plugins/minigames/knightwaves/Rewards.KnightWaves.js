"use strict";

/**
 * Completion rewards (Wiki, Knight Waves Training Ground): 20,000 XP in Attack, Strength,
 * Defence and Hitpoints, the Chivalry/Piety unlock, and the Camelot respawn point. The activity
 * can only be completed once because the squire refuses re-entry, and the reward attribute keeps
 * a server restart in the middle of the final kill from paying twice.
 */
const Common = require("./Common.KnightWaves");

function complete({ player }) {
  if (!player || player.getAttribute(Common.REWARD_ATTRIBUTE) === true) return;
  player.setAttribute(Common.REWARD_ATTRIBUTE, true);
  const skills = player.getSkillManager?.();
  if (skills) {
    for (const name of ["ATTACK", "STRENGTH", "DEFENCE", "HITPOINTS"]) {
      const skill = Common.core.Skill?.[name];
      if (skill !== undefined) skills.addExperiences(skill, Common.REWARD_XP);
    }
  }
  player.sendMessage?.(Common.MESSAGES.reward);
  Common.api.emitCustomEvent("respawn-point:grant", {
    player, key: Common.CAMELOT_RESPAWN, set: true,
  });
  Common.api.emitCustomEvent("prayer:sync-unlocks", { player });
}

function attachRewards(api) {
  api.persistAttribute(Common.REWARD_ATTRIBUTE, false);
  api.onCustomEvent("knight-waves:completed", complete);
}

module.exports = { attachRewards, complete };
