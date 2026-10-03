const { CanAttackResponse } = require("../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");

const AGGRESSION_DISTANCE = 1;
const KEEP_AWAKE_DISTANCE = 2;
const SLEEP_AFTER_IDLE_MS = 5000;
const PLAYER_PROCESS_INTERVAL_MS = 600;
const WAKE_THROTTLE_MS = 250;

const ROCK_CRAB_VARIANTS = Object.freeze([
  {
    activeId: NpcIdentifiers.ROCK_CRAB,
    disguisedId: NpcIdentifiers.ROCKS,
    label: "rock_crab",
  },
  {
    activeId: NpcIdentifiers.ROCK_CRAB_2,
    disguisedId: NpcIdentifiers.ROCKS_2,
    label: "rock_crab_2",
  },
  {
    activeId: NpcIdentifiers.GIANT_ROCK_CRAB,
    disguisedId: NpcIdentifiers.BOULDER_7,
    label: "giant_rock_crab",
  },
  {
    activeId: NpcIdentifiers.GIANT_ROCK_CRAB_2,
    disguisedId: NpcIdentifiers.BOULDER_7,
    label: "giant_rock_crab_2",
  },
]);

const VARIANT_BY_ID = new Map();
for (const variant of ROCK_CRAB_VARIANTS) {
  VARIANT_BY_ID.set(variant.activeId, variant);
  VARIANT_BY_ID.set(variant.disguisedId, variant);
}

const ROCK_CRAB_NPC_IDS = Object.freeze(
  Array.from(
    new Set(
      ROCK_CRAB_VARIANTS.flatMap((variant) => [
        variant.activeId,
        variant.disguisedId,
      ])
    )
  )
);

function resolveVariant(npc) {
  if (!npc) {
    return null;
  }
  const currentId = npc.getId?.();
  if (Number.isInteger(currentId) && VARIANT_BY_ID.has(currentId)) {
    return VARIANT_BY_ID.get(currentId);
  }
  const realId = npc.getRealId?.();
  if (Number.isInteger(realId) && VARIANT_BY_ID.has(realId)) {
    return VARIANT_BY_ID.get(realId);
  }
  const transformationId = npc.getNpcTransformationId?.();
  if (Number.isInteger(transformationId) && VARIANT_BY_ID.has(transformationId)) {
    return VARIANT_BY_ID.get(transformationId);
  }
  return null;
}

function isAwake(npc, variant) {
  if (!npc || !variant) {
    return false;
  }
  return npc.getId?.() === variant.activeId;
}

function markActive(tracker, npc, nowMs) {
  if (!npc) {
    return;
  }
  const state = tracker.get(npc) ?? {};
  state.lastActiveAt = nowMs;
  tracker.set(npc, state);
}

function getLastActiveAt(tracker, npc, fallbackMs) {
  const state = tracker.get(npc);
  if (!state || !Number.isFinite(state.lastActiveAt)) {
    return fallbackMs;
  }
  return state.lastActiveAt;
}

function transformAwake(npc, variant, tracker, nowMs, api, reason) {
  if (!npc || !variant || isAwake(npc, variant)) {
    return false;
  }
  npc.setNpcTransformationId(variant.activeId);
  markActive(tracker, npc, nowMs);
  api?.log?.("rock_crab_transform_awake", {
    npcIndex: npc.getIndex?.(),
    realId: npc.getRealId?.(),
    activeId: variant.activeId,
    disguisedId: variant.disguisedId,
    reason,
  });
  return true;
}

function transformDisguised(npc, variant, tracker, api, reason) {
  if (!npc || !variant || !isAwake(npc, variant)) {
    return false;
  }
  if (npc.getRealId?.() === variant.disguisedId) {
    npc.setNpcTransformationId(-1);
  } else {
    npc.setNpcTransformationId(variant.disguisedId);
  }
  tracker.delete(npc);
  npc.setMobileInteraction?.(null);
  npc.setPositionToFace?.(null);
  api?.log?.("rock_crab_transform_disguised", {
    npcIndex: npc.getIndex?.(),
    realId: npc.getRealId?.(),
    activeId: variant.activeId,
    disguisedId: variant.disguisedId,
    reason,
  });
  return true;
}

function isValidPlayerTarget(player) {
  return (
    player &&
    player.isRegistered?.() === true &&
    (player.getHitpoints?.() ?? 0) > 0
  );
}

function canAggro(npc, player) {
  if (!npc || !player) {
    return false;
  }
  if (npc.getPrivateArea?.() != player.getPrivateArea?.()) {
    return false;
  }
  if (CombatFactory.inCombat(player) && !AreaManager.inMulti(player)) {
    return false;
  }
  const method = CombatFactory.getMethod(npc);
  const response = CombatFactory.canAttack(npc, method, player);
  return response === CanAttackResponse.CAN_ATTACK;
}

function tryAggroPlayer(npc, player, tracker, nowMs, api, reason) {
  if (!npc || !player || CombatFactory.inCombat(npc)) {
    return false;
  }
  if (!canAggro(npc, player)) {
    return false;
  }
  markActive(tracker, npc, nowMs);
  npc.setMobileInteraction?.(player);
  npc.setPositionToFace?.(player.getLocation?.());
  npc.getCombat?.().attack?.(player);
  api?.log?.("rock_crab_aggro", {
    npcIndex: npc.getIndex?.(),
    npcId: npc.getId?.(),
    player: player.getUsername?.() ?? null,
    reason,
  });
  return true;
}

function processRockCrab(npc, player, tracker, nowMs, api) {
  const variant = resolveVariant(npc);
  if (!variant) {
    return;
  }
  if (!npc?.isRegistered?.() || npc?.isDyingFunction?.() || (npc?.getHitpoints?.() ?? 0) <= 0) {
    tracker.delete(npc);
    return;
  }
  if (!isValidPlayerTarget(player)) {
    return;
  }

  if (CombatFactory.inCombat(npc)) {
    transformAwake(npc, variant, tracker, nowMs, api, "npc_in_combat");
    markActive(tracker, npc, nowMs);
    return;
  }

  const playerDistance = npc.getLocation?.().getDistance?.(player.getLocation?.()) ?? Number.MAX_SAFE_INTEGER;
  if (playerDistance <= AGGRESSION_DISTANCE) {
    transformAwake(npc, variant, tracker, nowMs, api, "player_in_range");
    tryAggroPlayer(npc, player, tracker, nowMs, api, "player_in_range");
    return;
  }

  if (!isAwake(npc, variant)) {
    return;
  }

  if (playerDistance <= KEEP_AWAKE_DISTANCE) {
    markActive(tracker, npc, nowMs);
    return;
  }

  const interacting = npc.getMobileInteraction?.();
  if (isValidPlayerTarget(interacting)) {
    markActive(tracker, npc, nowMs);
    return;
  }

  const lastActiveAt = getLastActiveAt(tracker, npc, nowMs);
  if (nowMs - lastActiveAt >= SLEEP_AFTER_IDLE_MS) {
    transformDisguised(npc, variant, tracker, api, "idle_timeout");
  }
}

let CombatFactory;
let AreaManager;

module.exports = {
  name: "RockCrabs",
  members: true,
  register(api) {
    CombatFactory = api.getCombatFactory();
    AreaManager = api.getAreaManager();
    const npcState = new WeakMap();
    const playerProcessAt = new WeakMap();
    const wakeAttemptAt = new WeakMap();

    function wakeRockCrab(event) {
      const npc = event.npc;
      const variant = resolveVariant(npc);
      if (!variant) {
        return false;
      }
      const nowMs = Date.now();
      transformAwake(npc, variant, npcState, nowMs, api, "npc_interaction");
      const player = event.player;
      if (isValidPlayerTarget(player)) {
        tryAggroPlayer(npc, player, npcState, nowMs, api, "npc_interaction");
      }
      return false;
    }
    for (let clickType = 1; clickType <= 4; clickType++) {
      api.onNpcClick(ROCK_CRAB_NPC_IDS, clickType, wakeRockCrab);
    }

    api.onCanAttack((event) => {
      if (event.allow !== null) {
        return;
      }
      if (event.attacker.isPlayer?.() !== true || event.target.isNpc?.() !== true) {
        return;
      }
      const npc = event.target.getAsNpc?.() ?? event.target;
      const currentId = npc?.getId?.();
      if (!Number.isInteger(currentId)) {
        return;
      }
      const variant = VARIANT_BY_ID.get(currentId);
      if (!variant) {
        return;
      }
      if (currentId === variant.activeId) {
        return;
      }
      const nowMs = Date.now();
      const lastWakeAt = wakeAttemptAt.get(npc) ?? 0;
      // Prevent repeated wake attempts in the same short combat-check window.
      if (nowMs - lastWakeAt < WAKE_THROTTLE_MS) {
        return;
      }
      wakeAttemptAt.set(npc, nowMs);
      transformAwake(
        npc,
        variant,
        npcState,
        nowMs,
        api,
        "player_attack_attempt"
      );
    });

    api.onNpcAggressionTolerance((event) => {
      const variant = resolveVariant(event?.npc);
      if (!variant) {
        return;
      }
      event.override = true;
    });

    api.onNpcDeath(({ npc }) => {
      if (!resolveVariant(npc)) {
        return;
      }
      npcState.delete(npc);
    });

    api.onPlayerProcess(({ player }) => {
      if (!isValidPlayerTarget(player)) {
        return;
      }
      if (player?.isPlayerBot?.() === true) {
        return;
      }
      const nowMs = Date.now();
      const lastProcessAt = playerProcessAt.get(player) ?? 0;
      if (nowMs - lastProcessAt < PLAYER_PROCESS_INTERVAL_MS) {
        return;
      }
      playerProcessAt.set(player, nowMs);
      const localNpcs = player.getLocalNpcs?.();
      if (!Array.isArray(localNpcs) || localNpcs.length === 0) {
        return;
      }
      for (const npc of localNpcs) {
        if (!npc) {
          continue;
        }
        processRockCrab(npc, player, npcState, nowMs, api);
      }
    });

    api.log("registered", {
      npcIds: ROCK_CRAB_NPC_IDS,
      aggressionDistance: AGGRESSION_DISTANCE,
      sleepAfterIdleMs: SLEEP_AFTER_IDLE_MS,
    });
  },
};
