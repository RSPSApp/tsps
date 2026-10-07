const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");

const TWISTED_BOW_ID = ItemIdentifiers.TWISTED_BOW;
const MAGIC_CAP = 250;
/** Chambers of Xeric monsters (the "xerician" attribute) raise the cap to 350. */
const XERICIAN_MAGIC_CAP = 350;

function getEquippedWeaponId(player) {
  return Number(player?.getEquipment?.()?.get?.(Equipment.WEAPON_SLOT)?.getId?.() ?? -1);
}

function isUsingTwistedBow(attacker) {
  if (!attacker?.isPlayer?.()) {
    return false;
  }
  return getEquippedWeaponId(attacker.getAsPlayer()) === TWISTED_BOW_ID;
}

function getTargetMagicLevel(target) {
  if (!target) {
    return 0;
  }
  if (target.isPlayer?.()) {
    return Number(target.getAsPlayer()?.getSkillManager?.()?.getCurrentLevel?.(Skill.MAGIC) ?? 0);
  }
  if (target.isNpc?.()) {
    return Number(target.getAsNpc()?.getCurrentDefinition?.()?.getStats?.()?.[4] ?? 0);
  }
  return 0;
}

/** Players' worn magic attack bonus; NPCs' magic accuracy is stats[7]. */
function getTargetMagicAccuracy(target) {
  if (target?.isPlayer?.()) {
    return Number(
      target.getAsPlayer()?.getBonusManager?.()?.getAttackBonus?.()?.[BonusManager.ATTACK_MAGIC] ?? 0
    );
  }
  if (target?.isNpc?.()) {
    return Number(target.getAsNpc()?.getCurrentDefinition?.()?.getStats?.()?.[7] ?? 0);
  }
  return 0;
}

function isXerician(target) {
  return target?.isNpc?.() === true
    && target.getAsNpc()?.getCurrentDefinition?.()?.hasAttribute?.("xerician") === true;
}

/**
 * The target's Magic level or magic accuracy, whichever is higher, capped at 250,
 * or 350 against Chambers of Xeric monsters (Wiki: Twisted bow).
 */
function getTwistedBowScaleValue(target) {
  const cap = isXerician(target) ? XERICIAN_MAGIC_CAP : MAGIC_CAP;
  const scale = Math.max(getTargetMagicLevel(target), getTargetMagicAccuracy(target));
  return Math.max(0, Math.min(cap, Math.floor(scale)));
}

function twistedBowDamagePercent(scale) {
  const x = Math.max(0, scale);
  const value =
    250 +
    ((3 * x - 14) / 100) -
    ((((3 * x) / 10) - 140) * (((3 * x) / 10) - 140)) / 100;
  return Math.max(0, Math.min(250, Math.floor(value)));
}

function twistedBowAccuracyPercent(scale) {
  const x = Math.max(0, scale);
  const value =
    140 +
    ((3 * x - 10) / 100) -
    ((((3 * x) / 10) - 100) * (((3 * x) / 10) - 100)) / 100;
  return Math.max(0, Math.min(140, Math.floor(value)));
}

function applyPercent(base, percent) {
  return Math.max(0, Math.floor((Math.max(0, base) * Math.max(0, percent)) / 100));
}

let BonusManager;

module.exports = {
  name: "TwistedBow",
  _test: { twistedBowDamagePercent, twistedBowAccuracyPercent, getTwistedBowScaleValue },
  members: true,
  register(api) {
    BonusManager = api.getBonusManager();
    api.registerRangedCombatModifier({
      modifyMaxHit(attacker, target, maxHit) {
        if (!isUsingTwistedBow(attacker)) {
          return null;
        }
        return applyPercent(maxHit, twistedBowDamagePercent(getTwistedBowScaleValue(target)));
      },
      modifyAttackRoll(attacker, target, attackRoll) {
        if (!isUsingTwistedBow(attacker)) {
          return null;
        }
        return applyPercent(attackRoll, twistedBowAccuracyPercent(getTwistedBowScaleValue(target)));
      },
    });
  },
};
