const {
  CanAttackResponse,
} = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { callModeHook } = require("../hooks/ModeHookContract");
const {
  handlePlayerAttackReaction,
} = require("../policies/PlayerAttackReactionPolicy");

class CombatReactionTrigger {
  constructor({ botStatesByName, playerBotUsernames, modeHandlers, api, options }) {
    this.botStatesByName = botStatesByName;
    this.playerBotUsernames = playerBotUsernames;
    this.modeHandlers = modeHandlers ?? {};
    this.api = api;
    this.followBackDurationMs = options.followBackDurationMs;
    this.playerRunAwayChance = Math.max(
      0,
      Math.min(1, Number(options.playerRunAwayChance ?? 0.5))
    );
    this.behaviorMode = options.behaviorMode;
  }

  handlePlayerAttack({ player, target }, nowMs = Date.now()) {
    if (!player) {
      return;
    }

    const followed = target;
    const followedUsername = followed?.getUsername?.();
    if (
      !followed ||
      followed === player ||
      !followedUsername ||
      !this.playerBotUsernames.has(followedUsername) ||
      !followed.isRegistered()
    ) {
      return;
    }

    const state = this.botStatesByName.get(followedUsername);
    if (!state) {
      return;
    }

    const combatFactory = this.api.getCombatFactory();
    const combatMethod = combatFactory.getMethod(player);
    if (
      combatFactory.canAttackPermission(player, followed, false, combatMethod) !==
      CanAttackResponse.CAN_ATTACK
    ) {
      return;
    }

    const attackerIsPlayerBot = player.isPlayerBot?.() === true;
    const handledByMode = callModeHook({
      modeHandlers: this.modeHandlers,
      mode: state.mode,
      hookName: "onPlayerAttackReaction",
      payload: {
        bot: followed,
        state,
        attacker: player,
        attackerIsPlayerBot,
        nowMs,
        followBackDurationMs: this.followBackDurationMs,
        playerRunAwayChance: this.playerRunAwayChance,
      },
      fallback: null,
      api: this.api,
      errorEvent: "bot_mode_player_attack_reaction_error",
    });

    if (handledByMode === true || handledByMode === false) {
      return;
    }

    handlePlayerAttackReaction({
      bot: followed,
      state,
      attacker: player,
      attackerIsPlayerBot,
      nowMs,
      followBackDurationMs: this.followBackDurationMs,
      playerRunAwayChance: this.playerRunAwayChance,
      behaviorMode: this.behaviorMode,
      api: this.api,
    });
  }
}

module.exports = {
  CombatReactionTrigger,
};
