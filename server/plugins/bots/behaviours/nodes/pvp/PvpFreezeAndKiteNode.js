"use strict";

const { CombatSpells } = require("../../../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { MagicSpellbook } = require("../../../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { CombatType } = require("../../../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { canSpecTarget, isSpecFinisher, resolveInventorySpecWeapon } = require("../../policies/PvpSpecialAttackPolicy");
const { World } = require("../../../../../src/main/typescript/elvarg/game/World");
const { Location } = require("../../../../../src/main/typescript/elvarg/game/model/Location");
const { TimerKey } = require("../../../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { WeaponInterfaces } = require("../../../../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces");
const { requestMovement, peekMovementRequest, dispatchMovementRequest, clearMovementRequest } = require("../../navigation/BotNavigation");

const RANGED_WEAPON_INTERFACES = new Set([
  WeaponInterfaces.SHORTBOW,
  WeaponInterfaces.LONGBOW,
  WeaponInterfaces.DARK_BOW,
  WeaponInterfaces.CROSSBOW,
  WeaponInterfaces.KARILS_CROSSBOW,
  WeaponInterfaces.KNIFE,
  WeaponInterfaces.OBBY_RINGS,
  WeaponInterfaces.THROWNAXE,
  WeaponInterfaces.DART,
  WeaponInterfaces.JAVELIN,
]);

const PROFILE_FREEZE_SPELLS = Object.freeze({
  standard: CombatSpells.BIND,
  veteran: CombatSpells.SNARE,
  elite: CombatSpells.ENTANGLE,
});

class PvpFreezeAndKiteNode {
  constructor(options = {}) {
    this.setPhase = options.setPhase;
    this.getProfile = options.getProfile;
    this.scheduleCombatAction = options.scheduleCombatAction;
    this.scheduleFreezeReview = options.scheduleFreezeReview;
    this.regionManager = options.regionManager;
    this.pvpPhase = options.pvpPhase;
  }

  tick(context) {
    const { player, state, nowMs, target } = context ?? {};
    const pvp = state?.pvp;
    if (!player || !state || !pvp || !target) {
      return { handled: false, status: "failure" };
    }
    if (typeof pvp.loadoutId === "string" && pvp.loadoutId.startsWith("f2p_")) {
      return { handled: false, status: "running" };
    }

    const profile = this.getProfile?.(state) ?? null;
    const openerFreeze = this.shouldOpenWithFreeze(player, state, target, profile);

    if (!openerFreeze && nowMs < Number(pvp.nextFreezeReviewAt ?? 0)) {
      return { handled: false, status: "running" };
    }

    const finish = (handled = false, status = "running") => {
      this.scheduleFreezeReview?.(state, nowMs);
      return { handled, status };
    };

    if (!openerFreeze && nowMs < Number(pvp.nextActionAt ?? 0)) {
      return finish(false, "running");
    }

    if (!this.isMeleeOpponent(target)) {
      return finish(false, "running");
    }
    if (!this.hasBindableMagic(player)) {
      return finish(false, "running");
    }
    if (target.getTimers?.().has?.(TimerKey.FREEZE) || target.getTimers?.().has?.(TimerKey.FREEZE_IMMUNITY)) {
      return finish(false, "running");
    }

    const freezeSpell = PROFILE_FREEZE_SPELLS[profile?.id ?? ""] ?? null;
    if (!freezeSpell) {
      return finish(false, "running");
    }

    const freezeUseChance = Number(profile?.freezeUseChance ?? 0);
    if (!openerFreeze && (freezeUseChance <= 0 || Math.random() > freezeUseChance)) {
      return finish(false, "running");
    }

    const combat = player.getCombat?.();
    if (!combat) {
      return finish(false, "failure");
    }

    const currentTarget = combat.getTarget?.();
    if (currentTarget && currentTarget !== target) {
      combat.reset?.();
    }

    combat.castSpellOn?.(target, freezeSpell);
    pvp.lastFreezeAt = nowMs;
    this.scheduleCombatAction?.(state, nowMs);
    this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
    return finish(true, "running");
  }

  maybeMoveBetweenHits(player, state, target, profile, nowMs) {
    const combat = player?.getCombat?.();
    const playerLoc = player?.getLocation?.();
    const targetLoc = target?.getLocation?.();
    if (!combat || !playerLoc || !targetLoc || playerLoc.getZ() !== targetLoc.getZ()) return false;
    if (player.getTimers?.().has?.(TimerKey.FREEZE)) {
      state.pvp.backstep = null;
      if (state.pvp.lastCombatStep) state.pvp.lastCombatStep.holding = false;
      combat.preserveMovementForTicks(0);
      return false;
    }
    if (combat.getTarget?.() !== target && combat.getAttacker?.() !== target) return false;

    if (this.maybeBackstep(player, state, target, profile, nowMs)) return true;

    const delay = combat.getAttackDelay();
    const distance = Math.max(Math.abs(playerLoc.getX() - targetLoc.getX()),
      Math.abs(playerLoc.getY() - targetLoc.getY()));
    const method = combat.resolveMethodForCurrentCycle();
    const melee = method.type() === CombatType.MELEE;
    const range = method.attackDistance(player);
    const opponentCombat = target.getCombat();
    const opponentMethod = opponentCombat.resolveMethodForCurrentCycle();
    const opponentMelee = opponentMethod.type() === CombatType.MELEE;
    const opponentRange = opponentMethod.attackDistance(target);
    const freezeTicks = target.getTimers().left(TimerKey.FREEZE);
    const opponentDelay = opponentCombat.getAttackDelay();
    // Judge the position now, not a guaranteed escape from every possible chase.
    const inMeleeReach = (tile) => {
      const dx = Math.abs(tile.getX() - targetLoc.getX());
      const dy = Math.abs(tile.getY() - targetLoc.getY());
      return opponentRange === 1 ? dx + dy === 1 : Math.max(dx, dy) <= opponentRange;
    };
    const lastStep = state.pvp.lastCombatStep;
    const targetUnchanged = lastStep?.target === target &&
      lastStep.targetX === targetLoc.getX() && lastStep.targetY === targetLoc.getY();
    // Reassess when the opponent moves or thaws instead of holding a stale position.
    if (lastStep?.holding && targetUnchanged && delay > 1 &&
        (lastStep.reason !== "pvp_death_dot" || freezeTicks > 1) &&
        playerLoc.getX() === lastStep.x && playerLoc.getY() === lastStep.y) {
      player.getMovementQueue().reset();
      combat.preserveMovementForTicks();
      return false;
    }
    if (lastStep) lastStep.holding = false;
    combat.preserveMovementForTicks(0);

    const steppingOut = distance === 0;
    const canDeathDot = Number(profile?.confidenceTier ?? 0) >= 3 &&
      state.pvp.preferredCombatStyle === "hybrid" && distance <= 1 && freezeTicks > 1;
    let reason;
    if (canDeathDot && delay > 1) {
      if (steppingOut) {
        player.getMovementQueue().reset();
        combat.preserveMovementForTicks();
        return false;
      }
      reason = "pvp_death_dot";
    } else if (steppingOut) {
      reason = "pvp_death_dot_step_out";
    } else if (opponentMelee && delay > 1 &&
        (melee ? delay > 2 && opponentDelay < delay && inMeleeReach(playerLoc) : distance <= 2)) {
      reason = melee ? "pvp_deny_melee" : "pvp_kite";
    } else {
      return false;
    }

    if (!steppingOut && World.getProcessCycle() < (lastStep?.nextMoveCycle ?? 0)) return false;

    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    const candidates = offsets.map(([dx, dy]) => {
      const tile = new Location(playerLoc.getX() + dx, playerLoc.getY() + dy, playerLoc.getZ());
      const tx = Math.abs(tile.getX() - targetLoc.getX());
      const ty = Math.abs(tile.getY() - targetLoc.getY());
      return { tile, distance: Math.max(tx, ty), diagonal: tx > 0 && ty > 0,
        returnSteps: Math.max(tx, ty) + (tx === ty ? 1 : 0) - 1 };
    }).filter((candidate) => {
      if (this.regionManager.blocked(candidate.tile, player.getPrivateArea()) ||
          this.regionManager.isWater(candidate.tile)) return false;
      if (reason === "pvp_death_dot") return candidate.distance === 0;
      if (reason === "pvp_death_dot_step_out") {
        // Melee needs a shared edge; ranged/magic can step diagonally to avoid melee.
        if (candidate.distance !== 1 || (melee && candidate.diagonal)) return false;
        if (!melee && opponentMelee && opponentRange === 1 && !candidate.diagonal) return false;
      } else {
        // Force a melee opponent to reposition, while retaining our next hit.
        // A diagonal sidestep is useful even if they can follow it.
        if (candidate.distance === 0 || inMeleeReach(candidate.tile) ||
            candidate.distance > (melee ? 2 : range)) return false;
        if (melee && candidate.returnSteps > (player.getMovementQueue().isRunToggled() ? 2 : 1)) return false;
        if (!melee && candidate.distance < distance) return false;
        if (lastStep?.target === target && candidate.tile.getX() === lastStep.fromX &&
            candidate.tile.getY() === lastStep.fromY) return false;
      }
      return melee || this.regionManager.canProjectileAttack(player, candidate.tile, targetLoc) &&
        this.regionManager.canProjectileAttack(target, targetLoc, candidate.tile);
    });
    if (!candidates.length) return false;
    if (!steppingOut) {
      // One skill roll per attack opportunity, not repeated rolls until every bot moves.
      const attackCycle = World.getProcessCycle() + delay;
      const review = state.pvp.movementReview;
      if (review?.target === target && review.attackCycle === attackCycle) return false;
      state.pvp.movementReview = { target, attackCycle };
      if (Math.random() > Number(profile?.combatMoveChance ?? 0)) return false;
    }
    // Skilled melee bots favour a short sidestep over giving up more distance.
    if (melee && reason === "pvp_deny_melee" && Number(profile?.confidenceTier ?? 0) >= 3 &&
        candidates.some((candidate) => candidate.distance === 1)) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].distance > 1) candidates.splice(i, 1);
      }
    }
    while (candidates.length > 0) {
      const [{ tile }] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
      if (this.moveCombatStep(player, tile.getX(), tile.getY(), {
        state, nowMs, basicPather: false, maxRouteSegmentTiles: 1, reason,
      })) {
        state.pvp.lastCombatStep = {
          target, targetX: targetLoc.getX(), targetY: targetLoc.getY(), reason,
          fromX: playerLoc.getX(), fromY: playerLoc.getY(),
          x: tile.getX(), y: tile.getY(), holding: delay > 1,
          nextMoveCycle: World.getProcessCycle() + 6 + Math.floor(Math.random() * 5),
        };
        return true;
      }
    }
    return false;
  }

  maybeBackstep(player, state, target, profile, nowMs) {
    const pvp = state.pvp;
    const combat = player.getCombat();
    const location = player.getLocation();
    const targetLocation = target.getLocation();
    const cycle = World.getProcessCycle();
    const delay = combat.getAttackDelay();
    const distance = location.getDistance(targetLocation);
    const plan = pvp.backstep;
    if (plan) {
      if (plan.target !== target || pvp.retreat || cycle > plan.expiresAt || distance > 4 ||
          targetLocation.getX() !== plan.targetX || targetLocation.getY() !== plan.targetY) {
        pvp.backstep = null;
        combat.preserveMovementForTicks(0);
        return false;
      }
      if (delay <= 1) {
        // Combat following resumes now; run can cover the two-tile return before a hit.
        pvp.backstep = null;
        pvp.nextSpecReviewAt = 0;
        combat.preserveMovementForTicks(0);
        return true;
      }
      player.getMovementQueue().reset();
      combat.preserveMovementForTicks();
      return true;
    }
    if (pvp.retreat || delay < 3 || distance !== 1 ||
        !player.getMovementQueue().isRunToggled() || player.isSpecialActivated() ||
        cycle < (pvp.nextBackstepCycle ?? 0) ||
        cycle < (pvp.lastCombatStep?.nextMoveCycle ?? 0)) return false;
    const candidate = resolveInventorySpecWeapon(player, state);
    if (!candidate || candidate.special?.getCombatMethod().type() !== CombatType.MELEE ||
        !canSpecTarget(player, target, candidate.special) ||
        !isSpecFinisher(player, target, state, candidate.special, candidate.weaponId)) return false;
    // Space attempts across several attacks, with difficulty affecting execution.
    pvp.nextBackstepCycle = cycle + 12 + Math.floor(Math.random() * 9);
    if (Math.random() > Number(profile.combatMoveChance ?? 0) * 0.5) return false;
    const choices = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const tile = new Location(location.getX() + dx, location.getY() + dy, location.getZ());
        // End three tiles away, allowing a two-step run back into melee range.
        if (tile.getDistance(targetLocation) !== 3 ||
            (tile.getX() !== targetLocation.getX() && tile.getY() !== targetLocation.getY()) ||
            this.regionManager.blocked(tile, player.getPrivateArea()) || this.regionManager.isWater(tile)) continue;
        choices.push(tile);
      }
    }
    while (choices.length) {
      const [tile] = choices.splice(Math.floor(Math.random() * choices.length), 1);
      if (!this.moveCombatStep(player, tile.getX(), tile.getY(), {
        state, nowMs, basicPather: false, maxRouteSegmentTiles: 2, reason: "pvp_backstep_combo",
      })) continue;
      pvp.backstep = {
        target, targetX: targetLocation.getX(), targetY: targetLocation.getY(),
        expiresAt: cycle + delay + 1,
      };
      pvp.lastCombatStep = null;
      return true;
    }
    return false;
  }

  moveCombatStep(player, x, y, options) {
    if (!requestMovement(player, x, y, options)) return false;
    const request = peekMovementRequest(player);
    const result = dispatchMovementRequest(player, request, options.state);
    if (peekMovementRequest(player) === request) clearMovementRequest(player);
    if (!result?.hasRoute) return false;
    // A blocked adjacent tile must not turn a combat step into a long detour.
    let previous = player.getLocation();
    let steps = 0;
    for (const point of player.getMovementQueue().pointsReturn()) {
      steps += Math.max(Math.abs(point.position.getX() - previous.getX()),
        Math.abs(point.position.getY() - previous.getY()));
      previous = point.position;
    }
    if (steps > options.maxRouteSegmentTiles) {
      player.getMovementQueue().reset();
      return false;
    }
    player.getCombat().preserveMovementForTicks();
    return true;
  }

  shouldOpenWithFreeze(player, state, target, profile) {
    const profileId = profile?.id ?? "";
    if (profileId !== "veteran" && profileId !== "elite") {
      return false;
    }
    if (state?.pvp?.preferredCombatStyle === "melee") {
      return false;
    }
    const combat = player?.getCombat?.();
    const currentTarget = combat?.getTarget?.() ?? null;
    const attacker = combat?.getAttacker?.() ?? null;
    const alreadyEngaged =
      currentTarget === target ||
      attacker === target ||
      player?.getFollowing?.() === target ||
      player?.getCombatFollowing?.() === target;
    if (alreadyEngaged) {
      return false;
    }
    if (target?.getTimers?.().has?.(TimerKey.FREEZE) || target?.getTimers?.().has?.(TimerKey.FREEZE_IMMUNITY)) {
      return false;
    }
    return true;
  }

  hasBindableMagic(player) {
    if (!player) {
      return false;
    }
    if (player.getSpellbook?.() !== MagicSpellbook.NORMAL) {
      return false;
    }

    const autocastSpell = player.getCombat?.().getAutocastSpell?.() ?? null;
    if (autocastSpell?.spellId?.() === CombatSpells.ICE_BARRAGE.spellId()) {
      return false;
    }
    if (autocastSpell) {
      return true;
    }
    if (player.getEquipment?.().hasStaffEquipped?.()) {
      return true;
    }

    const inventoryItems = player.getInventory?.().getItems?.() ?? [];
    for (const item of inventoryItems) {
      const itemId = item?.getId?.() ?? -1;
      if (itemId <= 0) {
        continue;
      }
      const weaponInterface = item.getDefinition?.()?.getWeaponInterface?.();
      if (weaponInterface === WeaponInterfaces.STAFF || weaponInterface === WeaponInterfaces.ANCIENT_STAFF) {
        return true;
      }
    }
    return false;
  }

  isMeleeOpponent(target) {
    if (!target?.isPlayer?.()) {
      return false;
    }
    if (target.getEquipment?.().hasStaffEquipped?.()) {
      return false;
    }
    const weaponInterface = target.getWeapon?.();
    return !RANGED_WEAPON_INTERFACES.has(weaponInterface);
  }
}

module.exports = {
  PvpFreezeAndKiteNode,
};
