const {
  ActionNode,
  CooldownNode,
  SelectorNode,
} = require("../../../../src/main/typescript/elvarg/game/bot/BehaviorTree");
const { FollowBackActionNode } = require("../nodes/actions/FollowBackActionNode");
const { EatFoodActionNode } = require("../nodes/actions/EatFoodActionNode");
const {
  MaintainCombatBoostsActionNode,
} = require("../nodes/actions/MaintainCombatBoostsActionNode");
const {
  ProcessPendingMovementActionNode,
} = require("../nodes/actions/ProcessPendingMovementActionNode");
const {
  ClanRecruitActionNode,
} = require("../nodes/actions/ClanRecruitActionNode");
const { ReturnHomeActionNode } = require("../nodes/actions/ReturnHomeActionNode");
const { peekMovementRequest } = require("../navigation/BotNavigation");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
} = require("../../runtime/BotRecruitConstants");

function requireModeBehavior(modeHandlers, modeValue, label) {
  const behavior = modeHandlers?.[modeValue];
  if (!behavior || typeof behavior.tick !== "function") {
    throw new Error(
      `PlayerBotBehaviorTreeFactory missing mode handler for ${label} (${modeValue}) with tick(context).`
    );
  }
  return behavior;
}

class PlayerBotBehaviorTreeFactory {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.behaviorMode = options.behaviorMode;
    this.botEatLowHpRatio = options.botEatLowHpRatio;
    this.botEatHealMin = options.botEatHealMin;
    this.botEatHealMax = options.botEatHealMax;
    this.botEatMaxCharges = options.botEatMaxCharges;
    this.botHomeRadius = options.botHomeRadius;
    this.blockedRetargetMinDelayMs = options.blockedRetargetMinDelayMs;
    this.modeHandlers = options.modeHandlers;
    this.traversalService = options.traversalService ?? null;
    this.roamingBehavior = requireModeBehavior(
      this.modeHandlers,
      this.behaviorMode.ROAMING,
      "ROAMING"
    );
    this.pvpBehavior = requireModeBehavior(
      this.modeHandlers,
      this.behaviorMode.PVP,
      "PVP"
    );
    this.woodcuttingBehavior = requireModeBehavior(
      this.modeHandlers,
      this.behaviorMode.WOODCUTTING,
      "WOODCUTTING"
    );
    this.miningBehavior = requireModeBehavior(
      this.modeHandlers,
      this.behaviorMode.MINING,
      "MINING"
    );
    this.smeltingBehavior = requireModeBehavior(
      this.modeHandlers,
      this.behaviorMode.SMELTING,
      "SMELTING"
    );
    this.bankRunBehavior = requireModeBehavior(
      this.modeHandlers,
      this.behaviorMode.BANK_RUN,
      "BANK_RUN"
    );
    this.firemakingBehavior = requireModeBehavior(
      this.modeHandlers,
      this.behaviorMode.FIREMAKING,
      "FIREMAKING"
    );
    this.eatFoodActionNode = new EatFoodActionNode(botStatesByName, api, {
      lowHpRatio: this.botEatLowHpRatio,
      minHeal: this.botEatHealMin,
      maxHeal: this.botEatHealMax,
      maxCharges: this.botEatMaxCharges,
    });
    this.maintainCombatBoostsActionNode = new MaintainCombatBoostsActionNode(
      botStatesByName
    );
  }

  create(cooldownMs, initialDelayMs) {
    const processPendingMovementActionNode = new ProcessPendingMovementActionNode(
      this.botStatesByName,
      this.api,
      {
        traversalService: this.traversalService,
      }
    );
    const returnHomeActionNode = new ReturnHomeActionNode(
      this.botStatesByName,
      this.api,
      {
        behaviorMode: this.behaviorMode,
        botHomeRadius: this.botHomeRadius,
        blockedRetargetMinDelayMs: this.blockedRetargetMinDelayMs,
      }
    );
    const followBackActionNode = new FollowBackActionNode(
      this.botStatesByName,
      this.api,
      {
        behaviorMode: this.behaviorMode,
      }
    );
    const clanRecruitActionNode = new ClanRecruitActionNode(
      this.botStatesByName,
      this.api,
      {
        behaviorMode: this.behaviorMode,
      }
    );
    const roamingCooldownNode = new CooldownNode(
      cooldownMs,
      new ActionNode((context) => this.roamingBehavior.tick(context)),
      initialDelayMs
    );
    const resolveState = (context) => {
      const player = context?.player;
      const username = player?.getUsername?.();
      return username ? this.botStatesByName.get(username) : null;
    };
    const tickCurrentMode = (context) => {
      const state = resolveState(context);
      switch (state?.mode) {
        case this.behaviorMode.RETURN_HOME:
          return returnHomeActionNode.tick(context);
        case this.behaviorMode.FOLLOW_BACK:
          return followBackActionNode.tick(context);
        case this.behaviorMode.BANK_RUN:
          return this.bankRunBehavior.tick({
            ...context,
            traversalService: this.traversalService,
          });
        case this.behaviorMode.WOODCUTTING:
          return this.woodcuttingBehavior.tick(context);
        case this.behaviorMode.MINING:
          return this.miningBehavior.tick(context);
        case this.behaviorMode.SMELTING:
          return this.smeltingBehavior.tick(context);
        case this.behaviorMode.FIREMAKING:
          return this.firemakingBehavior.tick(context);
        case this.behaviorMode.PVP:
          return this.pvpBehavior.tick(context);
        case this.behaviorMode.ROAMING:
          return roamingCooldownNode.tick(context);
        default:
          return "failure";
      }
    };
    return new SelectorNode([
      new ActionNode((context) => this.maintainCombatBoostsActionNode.tick(context)),
      new ActionNode((context) => {
        // Escape decisions must run before queued chasing, food, or target selection.
        const defensive = this.pvpBehavior.tickDefensive(context);
        if (!defensive.handled) return "failure";
        if (resolveState(context)?.pvp?.retreat && !context.player.isTeleportingReturn()) {
          this.eatFoodActionNode.tick(context);
          processPendingMovementActionNode.tick(context);
        }
        return defensive.status;
      }),
      new ActionNode((context) => {
        if (!peekMovementRequest(context?.player)) {
          return "failure";
        }
        return processPendingMovementActionNode.tick(context);
      }),
      new ActionNode((context) => this.eatFoodActionNode.tick(context)),
      new ActionNode((context) => {
        if (!context?.player?.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME)) {
          return "failure";
        }
        return clanRecruitActionNode.tick(context);
      }),
      new ActionNode((context) => tickCurrentMode(context)),
    ]);
  }
}

module.exports = {
  PlayerBotBehaviorTreeFactory,
};
