const { Animation } = require("../../../../../src/main/typescript/elvarg/game/model/Animation");
const { Skill } = require("../../../../../src/main/typescript/elvarg/game/model/Skill");
const { TimerKey } = require("../../../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { getPvpProfile } = require("../../pvp/PvpAssignment");
const { isFoodItem } = require("../../../../items/Food.plugin");
const { computeEatThreshold } = require("../../state/PlayerBotState");
const { resolveBotNodeContext } = require("../context/BotNodeContext");

const EAT_ANIMATION = new Animation(829);

function findFoodSlots(inventory) {
  return (inventory?.getItems?.() ?? [])
    .map((item, slot) => (isFoodItem(item?.getId?.()) ? slot : -1))
    .filter((slot) => slot >= 0);
}

class EatFoodActionNode {
  constructor(botStatesByName, api, options = {}) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.lowHpRatio = Math.max(0.05, Math.min(0.95, Number(options.lowHpRatio ?? 0.45)));
    this.minHeal = Math.max(1, Number(options.minHeal ?? 12));
    this.maxHeal = Math.max(this.minHeal, Number(options.maxHeal ?? 18));
    this.maxCharges = Math.max(1, Math.floor(Number(options.maxCharges ?? 16)));
  }

  randomHealAmount() {
    const range = this.maxHeal - this.minHeal;
    if (range <= 0) {
      return this.minHeal;
    }
    return this.minHeal + Math.floor(Math.random() * (range + 1));
  }

  resolvePvpProfile(state) {
    if (state?.mode !== "pvp" || !state?.pvp) {
      return null;
    }
    return getPvpProfile(state.pvp.profileId);
  }

  getCachedPvpEatAtHpRatio(state) {
    const pvp = state?.pvp;
    if (!pvp) {
      return this.lowHpRatio;
    }
    const profileId = pvp.profileId ?? "standard";
    if (pvp.cachedEatAtHpRatioProfileId !== profileId) {
      pvp.cachedEatAtHpRatioProfileId = profileId;
      pvp.cachedEatAtHpRatio = Number(getPvpProfile(profileId)?.eatAtHpRatio ?? this.lowHpRatio);
    }
    return Number(pvp.cachedEatAtHpRatio ?? this.lowHpRatio);
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requireNotBusy: false,
      requireNotInCombat: false,
      requireNoTraversalTransition: false,
    });
    if (!resolved) {
      return "failure";
    }

    const { player, state, nowMs } = resolved;
    const skillManager = player.getSkillManager?.();
    if (!skillManager || !state) {
      return "failure";
    }

    const currentHp = Number(skillManager.getCurrentLevel?.(Skill.HITPOINTS) ?? 0);
    const maxHp = Number(skillManager.getMaxLevel?.(Skill.HITPOINTS) ?? 0);
    if (currentHp <= 0 || maxHp <= 0) {
      return "failure";
    }

    const pvpProfile = this.resolvePvpProfile(state);
    const isF2pPvp = state?.mode === "pvp" && state.pvp?.loadoutId?.startsWith("f2p_");
    const lowHpRatio = state?.mode === "pvp" ? this.getCachedPvpEatAtHpRatio(state) : this.lowHpRatio;
    const lowHpThreshold = computeEatThreshold(maxHp, lowHpRatio, isF2pPvp);
    if (currentHp > lowHpThreshold) {
      if (isF2pPvp) {
        state.pvp.f2pFoodPending = false;
        state.pvp.f2pFoodPendingHp = null;
      }
      return "failure";
    }

    if (isF2pPvp) {
      const combat = player.getCombat?.();
      const engaged = Boolean(
        combat?.getTarget?.() || combat?.getAttacker?.() || player.getCombatFollowing?.()
      );
      if (!engaged) {
        state.pvp.f2pFoodPending = false;
        state.pvp.f2pFoodPendingHp = null;
      } else if (state.pvp.f2pFoodPending !== true) {
        state.pvp.f2pFoodPending = true;
        state.pvp.f2pFoodPendingHp = currentHp;
        return "failure";
      } else if (currentHp >= Number(state.pvp.f2pFoodPendingHp ?? currentHp)) {
        return "failure";
      } else {
        state.pvp.f2pFoodPending = false;
        state.pvp.f2pFoodPendingHp = null;
      }
    }

    if (!Number.isFinite(state.virtualFoodChargesRemaining)) {
      const profileCharges = Number(pvpProfile?.foodCharges);
      state.virtualFoodChargesRemaining = Number.isFinite(profileCharges)
        ? Math.max(1, Math.floor(profileCharges))
        : this.maxCharges;
    }
    if (!Number.isFinite(state.nextNoFoodLogAt)) {
      state.nextNoFoodLogAt = 0;
    }
    if (state.virtualFoodChargesRemaining <= 0) {
      if ((nowMs ?? Date.now()) >= state.nextNoFoodLogAt) {
        this.api?.log?.("bot_imaginary_food_empty", {
          username: player.getUsername?.(),
          currentHp,
          maxHp,
          threshold: lowHpThreshold,
        });
        state.nextNoFoodLogAt = (nowMs ?? Date.now()) + 10000;
      }
      return "failure";
    }

    const inventory = player.getInventory?.();
    const foodSlots = findFoodSlots(inventory);
    if (foodSlots.length === 0) {
      if (Number(state.virtualFoodChargesRemaining) > 0) {
        state.virtualFoodChargesRemaining = 0;
      }
      return "failure";
    }

    const timers = player.getTimers?.();
    if (!timers || timers.has?.(TimerKey.FOOD) || timers.has?.(TimerKey.STUN)) {
      return "failure";
    }

    timers.extendOrRegister?.(TimerKey.FOOD, 3);
    player.getCombat?.().extendAttackDelay?.(5);
    player.getPacketSender?.().sendInterfaceRemoval?.();
    skillManager.stopSkillable?.();
    player.performAnimation?.(EAT_ANIMATION);

    let healAmount = this.randomHealAmount();
    let comboEatTriggered = false;
    if (
      pvpProfile &&
      foodSlots.length > 1 &&
      Math.random() < Number(pvpProfile.comboEatChance ?? 0) &&
      currentHp <= Math.max(1, Math.ceil(maxHp * Math.max(0.1, lowHpRatio * 0.72)))
    ) {
      healAmount += 6 + Math.floor(Math.random() * 7);
      comboEatTriggered = true;
      if (state?.pvp) {
        state.pvp.lastComboEatAt = nowMs ?? Date.now();
      }
    }
    const foodItemsConsumed = comboEatTriggered ? 2 : 1;
    for (const slot of foodSlots.slice(0, foodItemsConsumed)) {
      inventory.deleteAtSlot?.(slot, 1, false);
    }
    inventory.refreshItems?.();
    state.virtualFoodChargesRemaining = Math.max(
      0,
      Number(state.virtualFoodChargesRemaining) - foodItemsConsumed
    );
    player.heal?.(healAmount);
    if (state?.pvp) {
      state.pvp.lastFoodAt = nowMs ?? Date.now();
    }
    const nextHp = Number(skillManager.getCurrentLevel?.(Skill.HITPOINTS) ?? currentHp);
    this.api?.log?.("bot_imaginary_food_eat", {
      username: player.getUsername?.(),
      currentHp,
      nextHp,
      healAmount,
      comboEatTriggered,
      foodItemsConsumed,
      chargesRemaining: state.virtualFoodChargesRemaining,
      maxHp,
      threshold: lowHpThreshold,
    });
    return "success";
  }
}

module.exports = {
  EatFoodActionNode,
};
