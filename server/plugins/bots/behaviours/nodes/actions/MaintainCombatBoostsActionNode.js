const { Skill } = require("../../../../../src/main/typescript/elvarg/game/model/Skill");
const { getPvpProfile } = require("../../pvp/PvpAssignment");
const { resolveBotNodeContext } = require("../context/BotNodeContext");

function freezeBoostRules(entries) {
  return Object.freeze(
    entries.map(([skill, rule]) =>
      Object.freeze([skill, Object.freeze({ ...rule })])
    )
  );
}

const BOOST_RULES_BY_PROFILE = Object.freeze({
  standard: freezeBoostRules([
    [Skill.ATTACK, { flat: 3, percent: 0.1 }],
    [Skill.STRENGTH, { flat: 3, percent: 0.1 }],
    [Skill.DEFENCE, { flat: 3, percent: 0.1 }],
    [Skill.RANGED, { flat: 4, percent: 0.1 }],
    [Skill.MAGIC, { flat: 4, percent: 0 }],
  ]),
  veteran: freezeBoostRules([
    [Skill.ATTACK, { flat: 5, percent: 0.15 }],
    [Skill.STRENGTH, { flat: 5, percent: 0.15 }],
    [Skill.DEFENCE, { flat: 5, percent: 0.15 }],
    [Skill.RANGED, { flat: 5, percent: 0.15 }],
    [Skill.MAGIC, { flat: 4, percent: 0.15 }],
  ]),
  elite: freezeBoostRules([
    [Skill.ATTACK, { flat: 5, percent: 0.15 }],
    [Skill.STRENGTH, { flat: 5, percent: 0.15 }],
    [Skill.DEFENCE, { flat: 5, percent: 0.15 }],
    [Skill.RANGED, { flat: 5, percent: 0.15 }],
    [Skill.MAGIC, { flat: 4, percent: 0.15 }],
  ]),
});

function getSkillManager(player) {
  return player.getSkillManager?.() ?? null;
}

function getTargetBoostLevel(player, skill, rule) {
  const skillManager = getSkillManager(player);
  const max = Number(skillManager?.getMaxLevel?.(skill) ?? 0);
  if (max <= 0) {
    return 0;
  }
  return max + Math.floor(max * Number(rule.percent ?? 0)) + Number(rule.flat ?? 0);
}

function ensureBoostLevel(player, skill, rule) {
  const skillManager = getSkillManager(player);
  if (!skillManager) {
    return false;
  }
  const current = Number(skillManager.getCurrentLevel?.(skill) ?? 0);
  const target = getTargetBoostLevel(player, skill, rule);
  if (target <= 0 || current >= target) {
    return false;
  }
  skillManager.increaseCurrentLevel?.(skill, target - current, target);
  return true;
}

class MaintainCombatBoostsActionNode {
  constructor(botStatesByName) {
    this.botStatesByName = botStatesByName;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: "pvp",
      requireNotBusy: false,
      requireNotInCombat: false,
      requireNoTraversalTransition: false,
    });
    if (!resolved) {
      return "failure";
    }

    const { player, state } = resolved;
    if (!state?.pvp || player.getHitpoints() <= 0 || player.isDyingReturn()) {
      return "failure";
    }

    const profile = getPvpProfile(state.pvp.profileId);
    const rules = BOOST_RULES_BY_PROFILE[profile?.id];
    if (!rules) {
      return "failure";
    }

    for (const [skill, rule] of rules) {
      ensureBoostLevel(player, skill, rule);
    }

    return "failure";
  }
}

module.exports = {
  MaintainCombatBoostsActionNode,
};
