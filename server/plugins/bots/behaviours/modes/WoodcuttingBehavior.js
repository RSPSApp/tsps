const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Flag } = require("../../../../src/main/typescript/elvarg/game/model/Flag");
const { resolveBotNodeContext } = require("../nodes/context/BotNodeContext");
const {
  setModeBankRun,
  setModeFiremaking,
  setModeWoodcutting,
} = require("../state/PlayerBotState");
const {
  queueRouteAndFlagAppearance,
  randomInRange,
} = require("../navigation/BotNavigation");
const {
  handlePlayerAttackReaction,
} = require("../policies/PlayerAttackReactionPolicy");
const Woodcutting = require("../../../skills/Woodcutting.plugin");
const {Item} = require("../../../../src/main/typescript/elvarg/game/model/Item");

const RETRY_SEARCH_MS = 1500;
const WALK_COMMAND_COOLDOWN_MS = 900;
const DROP_LOGS_RETRY_MS = 650;
const GAME_TICK_MS = 600;
const MAX_NEXT_TREE_DISTANCE_TILES = 10;
// Keep target acquisition aligned with local region scanning so bots can
// actually walk to visible trees rather than rejecting nearly all targets.
const MAX_TREE_TARGET_DISTANCE_TILES = 64;
const RESPAWN_WAIT_LOOK_ELSEWHERE_CHANCE = 1 / 7;
const RESPAWN_WAIT_NEARBY_DISTANCE_TILES = 8;
const TOO_FAR_STREAK_WINDOW_MS = 12000;
const TOO_FAR_STREAK_THRESHOLD = 4;
const TOO_FAR_AVOID_MS = 25000;
const TOO_FAR_AVOID_MAX_ENTRIES = 12;
const TREE_SEARCH_REGION_RADIUS = 1;
const SEARCH_WALK_ATTEMPTS = 12;
const FULL_INV_CHANCE_DROP_LOGS = 0.34;
const FULL_INV_CHANCE_FIREMAKING = 0.33;

class WoodcuttingBehavior {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.behaviorMode = options.behaviorMode;
    this.searchWalkRadius = options.botWalkRadius ?? 6;
    this.objectSearch = options.objectSearch ?? null;
    this.treeTierByObjectId = new Map();
    this.treeIdsByTier = new Map();
    this.sortedEligibleTiersByLevel = new Map();
    for (const tree of Woodcutting.TREES) {
      this.treeIdsByTier.set(tree, [...(tree.objectIds ?? [])]);
      for (const objectId of tree.objectIds ?? []) {
        if (!this.treeTierByObjectId.has(objectId)) {
          this.treeTierByObjectId.set(objectId, tree);
        }
      }
    }
  }

  activateMode({ player, state }) {
    if (!player || !state) {
      return false;
    }
    setModeWoodcutting(player, state, this.behaviorMode);
    if (state.woodcutting) {
      state.woodcutting.nextActionAt = 0;
      state.woodcutting.tooFarTracker = null;
      state.woodcutting.avoidedTargets = [];
    }
    return true;
  }
  onNpcAggroAttempt({ event }) {
    if (!event || event.allow !== null) {
      return false;
    }
    event.allow = false;
    return true;
  }

  onNpcCombatDetected({ player, combat, attacker, target }) {
    const attackerIsNpc = attacker?.isNpc?.() === true;
    const targetIsNpc = target?.isNpc?.() === true;
    if (!attackerIsNpc && !targetIsNpc) {
      return false;
    }
    combat?.reset?.();
    player?.setFollowing?.(null);
    player?.setMobileInteraction?.(null);
    player?.setPositionToFace?.(null);
    return true;
  }

  onPlayerAttackReaction(payload) {
    return handlePlayerAttackReaction({
      ...payload,
      behaviorMode: this.behaviorMode,
      api: this.api,
    });
  }

  collectTrackedObjectIds() {
    const ids = [];
    for (const tree of Woodcutting.TREES ?? []) {
      for (const objectId of tree?.objectIds ?? []) {
        if (Number.isFinite(objectId)) {
          ids.push(objectId);
        }
      }
    }
    return ids;
  }

  appendStatusLines({ lines, state, nowMs, helpers = {} }) {
    if (!Array.isArray(lines) || !state?.woodcutting) {
      return;
    }
    const formatPoint = helpers?.formatPoint ?? (() => "n/a");
    const msRemainingLabel = helpers?.msRemainingLabel ?? (() => "n/a");
    lines.push(
      `woodcutting target=${formatPoint(
        state.woodcutting.target
      )} nextAction=${msRemainingLabel(state.woodcutting.nextActionAt, nowMs)}`
    );
  }

  startMode({ player, state, nowMs, activeForMs, reason = "auto_switch" }) {
    if (!this.activateMode({ player, state })) {
      return false;
    }
    if (!state.autonomy) {
      state.autonomy = {
        nextDecisionAt: 0,
        modeEndsAt: 0,
        pvpCooldownUntil: 0,
        manualMode: null,
      };
    }
    if (Number.isInteger(nowMs) && Number.isInteger(activeForMs) && activeForMs > 0) {
      state.autonomy.modeEndsAt = nowMs + activeForMs;
    }
    this.api?.log?.("bot_mode_switch", {
      username: player.getUsername?.(),
      mode: this.behaviorMode.WOODCUTTING,
      reason,
      activeForMs: Number.isInteger(activeForMs) ? activeForMs : null,
    });
    return true;
  }

  onBankRunResume({ state, nowMs, bankRun }) {
    if (!state?.woodcutting) {
      return false;
    }
    const resumeTarget = bankRun?.resumeWoodcuttingTarget
      ? {
          objectId: bankRun.resumeWoodcuttingTarget.objectId,
          x: bankRun.resumeWoodcuttingTarget.x,
          y: bankRun.resumeWoodcuttingTarget.y,
          z: bankRun.resumeWoodcuttingTarget.z,
        }
      : null;
    state.woodcutting.target = resumeTarget;
    state.woodcutting.nextActionAt = nowMs;
    state.woodcutting.nextSearchAt = nowMs;
    state.woodcutting.tooFarTracker = null;
    state.woodcutting.avoidedTargets = [];
    return true;
  }

  getTraversalTarget(state) {
    return state?.woodcutting?.target ?? null;
  }

  setTraversalTarget(stateOrPayload, maybeTarget) {
    const state = stateOrPayload?.state ?? stateOrPayload;
    const target = stateOrPayload?.target ?? maybeTarget;
    if (!state?.woodcutting) {
      return false;
    }
    state.woodcutting.target = target;
    return true;
  }

  handleBlocked({
    player,
    state,
    event,
    nowMs,
    traversalService,
    blockedRetargetMinDelayMs,
    blockedRetargetMaxDelayMs,
  }) {
    const target = state?.woodcutting?.target;
    if (!target) {
      return true;
    }

    const traversalObject = traversalService.findObjectOnRoute(
      player,
      event.from,
      target
    );
    if (!traversalObject) {
      state.woodcutting.target = null;
      state.woodcutting.nextSearchAt = nowMs + blockedRetargetMaxDelayMs;
      state.woodcutting.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      return true;
    }

    const currentY = player.getLocation().getY();
    const targetY = target.y;
    const objectY = traversalObject.getLocation().getY();
    if (!traversalService.isObjectBetween(currentY, targetY, objectY)) {
      state.woodcutting.target = null;
      state.woodcutting.nextSearchAt = nowMs + blockedRetargetMaxDelayMs;
      state.woodcutting.nextActionAt = nowMs + blockedRetargetMinDelayMs;
      return true;
    }

    traversalService.requestCross(player, state, traversalObject, nowMs);
    return true;
  }

  tick(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.behaviorMode.WOODCUTTING,
      requireNotBusy: false,
    });
    if (!resolved) {
      return "failure";
    }
    const { player, state, nowMs } = resolved;
    if (!state.woodcutting) {
      return "failure";
    }

    if (Woodcutting.isWoodcuttingActive(player)) {
      return "running";
    }

    if (nowMs < (state.woodcutting.nextActionAt ?? 0)) {
      return "running";
    }

    if (player.getInventory().isFull()) {
      this.handleFullInventory(player, state, nowMs);
      return "running";
    }

    const axe = this.equipBestAxeForWoodcutting(player);
    if (!axe) {
      state.woodcutting.nextActionAt = nowMs + RETRY_SEARCH_MS;
      return "failure";
    }

    let targetTree = this.resolveTargetTreeObject(player, state);
    if (!targetTree) {
      if (nowMs < (state.woodcutting.nextSearchAt ?? 0)) {
        return "running";
      }
      if (this.scheduleRespawnWaitIfNear(player, state, nowMs)) {
        return "running";
      }
      state.woodcutting.nextSearchAt = nowMs + RETRY_SEARCH_MS;

      const treeTiers = this.resolveBestTreeTiersForLevel(
        this.getWoodcuttingLevel(player)
      );
      if (!treeTiers || treeTiers.length === 0) {
        return "failure";
      }
      for (const treeTier of treeTiers) {
        targetTree = this.findNearestTreeObjectForTier(
          player,
          treeTier,
          state,
          nowMs
        );
        if (targetTree) {
          break;
        }
      }
      if (!targetTree) {
        state.woodcutting.target = null;
        if (this.queueSearchWalk(player, state)) {
          state.woodcutting.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
        }
        this.api.log("woodcutting_no_tree_found", {
          username: player.getUsername(),
          level: this.getWoodcuttingLevel(player),
          visibleTrees,
        });
        return "running";
      }

      const distanceToTarget = this.getDistanceToTree(player, targetTree);
      if (distanceToTarget > MAX_TREE_TARGET_DISTANCE_TILES) {
        const tooFar = this.noteTooFarTarget(state, targetTree, nowMs);
        state.woodcutting.target = null;
        if (this.queueSearchWalk(player, state)) {
          state.woodcutting.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
        } else {
          state.woodcutting.nextActionAt = nowMs + RETRY_SEARCH_MS;
        }
        state.woodcutting.nextSearchAt = tooFar.avoidApplied
          ? nowMs
          : nowMs + RETRY_SEARCH_MS;
        this.api.log("woodcutting_target_too_far", {
          username: player.getUsername(),
          targetX: targetTree.getLocation().getX(),
          targetY: targetTree.getLocation().getY(),
          targetZ: targetTree.getLocation().getZ(),
          distance: distanceToTarget,
          maxDistance: MAX_TREE_TARGET_DISTANCE_TILES,
          repeatCount: tooFar.count,
          avoidApplied: tooFar.avoidApplied,
        });
        if (tooFar.avoidApplied) {
          this.api.log("woodcutting_target_temporarily_avoided", {
            username: player.getUsername(),
            targetX: targetTree.getLocation().getX(),
            targetY: targetTree.getLocation().getY(),
            targetZ: targetTree.getLocation().getZ(),
            objectId: targetTree.getId(),
            avoidForMs: TOO_FAR_AVOID_MS,
          });
        }
        return "running";
      }

      // If the next available tree is too far away, keep waiting at the
      // previous tree location for its respawn instead of running off.
      if (
        state.woodcutting.target &&
        distanceToTarget > MAX_NEXT_TREE_DISTANCE_TILES &&
        !this.isLowerTierFallbackTarget(state.woodcutting.target, targetTree)
      ) {
        state.woodcutting.nextActionAt = nowMs + RETRY_SEARCH_MS;
        state.woodcutting.nextSearchAt = nowMs + RETRY_SEARCH_MS;
        return "running";
      }

      state.woodcutting.target = {
        objectId: targetTree.getId(),
        x: targetTree.getLocation().getX(),
        y: targetTree.getLocation().getY(),
        z: targetTree.getLocation().getZ(),
      };
      state.woodcutting.tooFarTracker = null;
    }

    if (player.getForceMovement() != null) {
      return "running";
    }
    if (player.getMovementQueue()?.size?.() > 0) {
      return "running";
    }

    const targetLocation = targetTree.getLocation();
    player.getMovementQueue().walkToObject(targetTree, {
      execute: () => {
        this.api.emitObjectInteraction({
          player,
          object: targetTree,
          objectId: targetTree.getId(),
          clickType: 1,
          location: {
            x: targetLocation.getX(),
            y: targetLocation.getY(),
            z: targetLocation.getZ(),
          },
          sourceLocation: {
            x: player.getLocation().getX(),
            y: player.getLocation().getY(),
            z: player.getLocation().getZ(),
          },
          handled: false,
        });
      },
    });
    state.woodcutting.nextActionAt = nowMs + WALK_COMMAND_COOLDOWN_MS;
    return "running";
  }

  getWoodcuttingLevel(player) {
    return player.getSkillManager().getCurrentLevel(Skill.WOODCUTTING);
  }

  resolveBestTreeTiersForLevel(level) {
    const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    const cached = this.sortedEligibleTiersByLevel.get(safeLevel);
    if (cached) {
      return cached;
    }
    const tiers = Woodcutting.TREES.filter(
      (tree) => tree.objectIds?.length && tree.requiredLevel <= safeLevel
    ).sort((a, b) => b.requiredLevel - a.requiredLevel);
    this.sortedEligibleTiersByLevel.set(safeLevel, tiers);
    return tiers;
  }

  findNearestTreeObjectForTier(player, treeTier, state = null, nowMs = Date.now()) {
    if (!player || !treeTier) {
      return null;
    }
    this.pruneAvoidedTargets(state, nowMs);
    const loc = player.getLocation();
    const privateArea = player.getPrivateArea();
    const treeIds = this.treeIdsByTier.get(treeTier) ?? [];
    let bestObject = null;
    let bestDistSq = Number.MAX_SAFE_INTEGER;

    const candidateObjects =
      this.objectSearch?.findCandidatesByIds?.(player, treeIds, {
        regionRadius: TREE_SEARCH_REGION_RADIUS,
        z: loc.getZ(),
        privateArea,
      }) ?? [];

    for (const object of candidateObjects) {
      if (!object) {
        continue;
      }
      const objectLoc = object.getLocation();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - loc.getX();
      const dy = objectLoc.getY() - loc.getY();
      const distSq = dx * dx + dy * dy;
      if (this.isTreeTemporarilyAvoided(state, object, nowMs)) {
        continue;
      }
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestObject = object;
      }
    }

    return bestObject;
  }

  equipBestAxeForWoodcutting(player) {
    const level = this.getWoodcuttingLevel(player);
    const axe = Woodcutting.findBestUsableAxeByLevel(level);
    if (!axe) {
      return null;
    }

    const equipment = player.getEquipment();
    const equipped = equipment.getItems()[Equipment.WEAPON_SLOT];
    if (equipped && equipped.getId() === axe.id) {
      return axe;
    }

    equipment.set(Equipment.WEAPON_SLOT, new Item(axe.id, 1));
    equipment.refreshItems();
    player.getUpdateFlag().flag(Flag.APPEARANCE);
    return axe;
  }

  resolveTargetTreeObject(player, state) {
    const target = state?.woodcutting?.target;
    if (!target) {
      return null;
    }
    const location = player.getLocation().clone();
    location.set(target.x, target.y, target.z);
    return MapObjects.get(target.objectId, location, player.getPrivateArea());
  }

  scheduleRespawnWaitIfNear(player, state, nowMs) {
    const target = state?.woodcutting?.target;
    if (!player || !target) {
      return false;
    }
    const treeTier = this.treeTierByObjectId.get(target.objectId);
    if (!treeTier) {
      return false;
    }
    const loc = player.getLocation();
    if (!loc || loc.getZ() !== target.z) {
      return false;
    }
    const dx = Math.abs(loc.getX() - target.x);
    const dy = Math.abs(loc.getY() - target.y);
    const distance = Math.max(dx, dy);
    if (distance > RESPAWN_WAIT_NEARBY_DISTANCE_TILES) {
      return false;
    }

    if (Math.random() < RESPAWN_WAIT_LOOK_ELSEWHERE_CHANCE) {
      state.woodcutting.target = null;
      return false;
    }

    const respawnTicks = Math.max(1, Number(treeTier.respawnTicks ?? 1));
    const waitMs = Math.max(RETRY_SEARCH_MS, respawnTicks * GAME_TICK_MS);
    state.woodcutting.nextActionAt = nowMs + waitMs;
    state.woodcutting.nextSearchAt = nowMs + waitMs;
    this.api?.log?.("woodcutting_waiting_for_respawn", {
      username: player.getUsername?.(),
      objectId: target.objectId,
      x: target.x,
      y: target.y,
      z: target.z,
      respawnTicks,
      waitMs,
    });
    return true;
  }

  getDistanceToTree(player, treeObject) {
    if (!player || !treeObject) {
      return Number.MAX_SAFE_INTEGER;
    }
    return player.getLocation().getDistance(treeObject.getLocation());
  }

  treeKey(objectId, x, y, z) {
    return `${objectId}:${x}:${y}:${z}`;
  }

  pruneAvoidedTargets(state, nowMs) {
    const woodcutting = state?.woodcutting;
    if (!woodcutting) {
      return;
    }
    const avoided = Array.isArray(woodcutting.avoidedTargets)
      ? woodcutting.avoidedTargets
      : [];
    woodcutting.avoidedTargets = avoided.filter(
      (entry) => Number(entry?.expiresAt) > nowMs
    );
  }

  isTreeTemporarilyAvoided(state, treeObject, nowMs) {
    const avoided = state?.woodcutting?.avoidedTargets;
    if (!Array.isArray(avoided) || avoided.length === 0 || !treeObject) {
      return false;
    }
    const loc = treeObject.getLocation();
    const key = this.treeKey(
      treeObject.getId(),
      loc.getX(),
      loc.getY(),
      loc.getZ()
    );
    return avoided.some((entry) => entry?.key === key && Number(entry?.expiresAt) > nowMs);
  }

  noteTooFarTarget(state, treeObject, nowMs) {
    const woodcutting = state?.woodcutting;
    if (!woodcutting || !treeObject) {
      return { count: 1, avoidApplied: false };
    }
    const loc = treeObject.getLocation();
    const key = this.treeKey(treeObject.getId(), loc.getX(), loc.getY(), loc.getZ());
    const previous = woodcutting.tooFarTracker;
    const count =
      previous &&
      previous.key === key &&
      nowMs - Number(previous.lastAt ?? 0) <= TOO_FAR_STREAK_WINDOW_MS
        ? Number(previous.count ?? 0) + 1
        : 1;
    woodcutting.tooFarTracker = { key, count, lastAt: nowMs };

    if (count < TOO_FAR_STREAK_THRESHOLD) {
      return { count, avoidApplied: false };
    }

    const avoided = Array.isArray(woodcutting.avoidedTargets)
      ? woodcutting.avoidedTargets
      : [];
    const expiresAt = nowMs + TOO_FAR_AVOID_MS;
    const nextAvoided = avoided.filter((entry) => entry?.key !== key);
    nextAvoided.push({
      key,
      expiresAt,
    });
    if (nextAvoided.length > TOO_FAR_AVOID_MAX_ENTRIES) {
      nextAvoided.splice(0, nextAvoided.length - TOO_FAR_AVOID_MAX_ENTRIES);
    }
    woodcutting.avoidedTargets = nextAvoided;
    woodcutting.tooFarTracker = null;
    return { count, avoidApplied: true };
  }

  isLowerTierFallbackTarget(previousTarget, nextTreeObject) {
    if (!previousTarget || !nextTreeObject) {
      return false;
    }
    const previousTier = this.treeTierByObjectId.get(previousTarget.objectId);
    const nextTier = this.treeTierByObjectId.get(nextTreeObject.getId());
    if (!previousTier || !nextTier) {
      return false;
    }
    return nextTier.requiredLevel < previousTier.requiredLevel;
  }

  queueSearchWalk(player, state) {
    if (!player || !state?.woodcutting) {
      return false;
    }
    if (player.getForceMovement() != null) {
      return false;
    }
    const queue = player.getMovementQueue?.();
    if (!queue || queue.size() > 0) {
      return false;
    }

    const loc = player.getLocation();
    const centerX = state?.home?.x ?? loc.getX();
    const centerY = state?.home?.y ?? loc.getY();
    const centerZ = state?.home?.z ?? loc.getZ();
    const radius = this.searchWalkRadius;
    const radiusSq = radius * radius;

    for (let attempt = 0; attempt < SEARCH_WALK_ATTEMPTS; attempt++) {
      const dx = randomInRange(-radius, radius);
      const dy = randomInRange(-radius, radius);
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }
      const targetX = centerX + dx;
      const targetY = centerY + dy;
      if (
        targetX === loc.getX() &&
        targetY === loc.getY() &&
        centerZ === loc.getZ()
      ) {
        continue;
      }

      queueRouteAndFlagAppearance(player, targetX, targetY);
      state.woodcutting.searchTarget = { x: targetX, y: targetY, z: centerZ };
      return true;
    }

    return false;
  }

  handleFullInventory(player, state, nowMs) {
    if (!this.hasAnyInventoryLogs(player)) {
      this.startBankRunForFullInventory(player, state, "inventory_full_no_logs_bank_run");
      return;
    }
    const roll = Math.random();
    if (roll < FULL_INV_CHANCE_DROP_LOGS) {
      const dropped = this.dropInventoryLogs(player);
      if (dropped > 0) {
        state.woodcutting.nextActionAt = nowMs + DROP_LOGS_RETRY_MS;
        this.api.log("bot_mode_switch", {
          username: player.getUsername(),
          mode: this.behaviorMode.WOODCUTTING,
          reason: "inventory_full_drop_logs",
          droppedLogs: dropped,
        });
        return;
      }
    }

    if (roll < FULL_INV_CHANCE_DROP_LOGS + FULL_INV_CHANCE_FIREMAKING) {
      setModeFiremaking(player, state, this.behaviorMode);
      if (state.firemaking) {
        state.firemaking.nextActionAt = nowMs;
      }
      this.api.log("bot_mode_switch", {
        username: player.getUsername(),
        mode: this.behaviorMode.FIREMAKING,
        reason: "inventory_full_firemaking",
      });
      return;
    }

    this.startBankRunForFullInventory(player, state);
  }

  dropInventoryLogs(player) {
    const inventory = player?.getInventory?.();
    if (!inventory) {
      return 0;
    }
    let dropped = 0;
    for (const logId of Woodcutting.TREE_LOG_IDS) {
      const amount = inventory.getAmount(logId);
      if (amount <= 0) {
        continue;
      }
      inventory.deleteNumber(logId, amount);
      dropped += amount;
    }
    return dropped;
  }

  hasAnyInventoryLogs(player) {
    const inventory = player?.getInventory?.();
    if (!inventory) {
      return false;
    }
    for (const logId of Woodcutting.TREE_LOG_IDS) {
      if (inventory.getAmount(logId) > 0) {
        return true;
      }
    }
    return false;
  }

  startBankRunForFullInventory(player, state, reason = "inventory_full_bank_run") {
    const woodcutTarget = state.woodcutting?.target;
    const currentLoc = player.getLocation();
    const returnTo = {
      x: currentLoc.getX(),
      y: currentLoc.getY(),
      z: currentLoc.getZ(),
    };
    setModeBankRun(player, state, this.behaviorMode, {
      returnMode: this.behaviorMode.WOODCUTTING,
      returnTo,
      resumeWoodcuttingTarget: woodcutTarget
        ? {
            objectId: woodcutTarget.objectId,
            x: woodcutTarget.x,
            y: woodcutTarget.y,
            z: woodcutTarget.z,
          }
        : null,
    });
    this.api.log("bot_mode_switch", {
      username: player.getUsername(),
      mode: this.behaviorMode.BANK_RUN,
      reason,
    });
  }
}

const WOODCUTTING_MODE_DESCRIPTOR = Object.freeze({
  key: "woodcutting",
  assignable: true,
  modeProperty: "WOODCUTTING",
  autonomous: Object.freeze({
    strategy: "start",
    weight: 0.3,
    minMs: 30000,
    maxMs: 105000,
    priority: 30,
  }),
  requiredHooks: [
    "activateMode",
    "startMode",
    "onBankRunResume",
    "getTraversalTarget",
    "setTraversalTarget",
    "handleBlocked",
  ],
  create({ botStatesByName, api, behaviorMode, options = {}, objectSearch }) {
    return new WoodcuttingBehavior(botStatesByName, api, {
      behaviorMode,
      botWalkRadius: options.botWalkRadius,
      objectSearch,
    });
  },
});

module.exports = {
  WoodcuttingBehavior,
  WOODCUTTING_MODE_DESCRIPTOR,
};
