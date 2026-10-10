"use strict";

/**
 * The arena itself: an Area on plane 3 so only players in it pay for the work. The obstacles
 * with no click option (floor spikes, pressure pads, spinning blades) are walked over; every
 * tile change is tested against the cache's trap tiles.
 */

const Shared = require("./Shared.BrimhavenAgilityArena");

function createArea() {
  const { Area, Boundary } = Shared.core();
  class BrimhavenAgilityArena extends Area {
    process(mobile) {
      processPlayer(mobile);
    }

    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      Shared.stateOf(player).lastTile = null;
      Shared.sendArrow(player);
    }

    postLeave(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      // The tag lock outlives a visit: only logout clears it. The arrow does not.
      Shared.stateOf(player).lastTile = null;
      player.getPacketSender().clearHintArrow?.();
    }
  }
  return new BrimhavenAgilityArena([
    new Boundary(Shared.ARENA.minX, Shared.ARENA.maxX, Shared.ARENA.minY, Shared.ARENA.maxY, Shared.ARENA_PLANE),
  ]);
}

/** One trap roll per tile change, feet planted or not. */
function processPlayer(mobile) {
  if (!mobile.isPlayer()) return;
  const player = mobile.getAsPlayer();
  const at = player.getLocation();
  const key = Shared.tileKey(at.getX(), at.getY());
  const state = Shared.stateOf(player);
  if (state.lastTile === key) return;
  state.lastTile = key;
  if (at.getZ() !== Shared.ARENA_PLANE) return;
  const trap = Shared.trapAt(at.getX(), at.getY());
  if (trap) stepTrap(player, trap);
  if (Shared.isBladeHit(at.getX(), at.getY())) stepBlades(player);
}

function stepTrap(player, kind) {
  const state = Shared.stateOf(player);
  if (kind === "PRESSURE_PAD" && Shared.cycle.tick < state.padCooldownUntil) return;
  const requirement = Shared.OBSTACLE_LEVEL[kind];
  if (Shared.agilityLevel(player) < requirement) {
    player.sendMessage(Shared.levelRefusal(requirement));
    return;
  }
  if (kind === "PRESSURE_PAD") {
    state.padUses = (state.lastTrap === kind ? state.padUses : 0) + 1;
    state.lastTrap = kind;
    if (state.padUses >= Shared.PRESSURE_PAD_USES) {
      state.padUses = 0;
      state.padCooldownUntil = Shared.cycle.tick + Shared.PRESSURE_PAD_COOLDOWN_TICKS;
    }
    Shared.addXp(player, Shared.OBSTACLE_XP.PRESSURE_PAD);
    return;
  }
  state.lastTrap = kind;
  const level = Shared.agilityLevel(player);
  // Floor spikes never fail at 50+ (Wiki); below that the same dodge chart as the darts applies.
  // ponytail: the Wiki publishes no spike curve, only the darts chart; swap in a capture if one shows up.
  const success = level >= Shared.FLOOR_SPIKES_NEVER_FAIL
    || Shared.roll(Shared.successChance(Shared.DARTS_SUCCESS.low, Shared.DARTS_SUCCESS.high, level));
  if (success) {
    Shared.addXp(player, Shared.OBSTACLE_XP.FLOOR_SPIKES);
  } else {
    Shared.hit(player, Shared.trapDamage(player.getHitpoints()));
  }
}

/** The blades themselves block the tile, so being one step off one is the dangerous part. */
function stepBlades(player) {
  const state = Shared.stateOf(player);
  if (Shared.cycle.tick < state.bladeCooldownUntil) return;
  state.bladeCooldownUntil = Shared.cycle.tick + Shared.BLADE_COOLDOWN_TICKS;
  const level = Shared.agilityLevel(player);
  if (level < Shared.OBSTACLE_LEVEL.SPINNING_BLADES) {
    player.sendMessage(Shared.levelRefusal(Shared.OBSTACLE_LEVEL.SPINNING_BLADES));
    return;
  }
  const success = Shared.roll(Shared.successChance(Shared.DARTS_SUCCESS.low, Shared.DARTS_SUCCESS.high, level));
  if (success) {
    Shared.addXp(player, Shared.OBSTACLE_XP.SPINNING_BLADES);
  } else {
    player.sendMessage(Shared.BLADES_FAIL_MESSAGE);
    Shared.hit(player, Shared.trapDamage(player.getHitpoints()));
  }
}

module.exports = (api) => {
  api.registerArea(createArea());
};
module.exports.createArea = createArea;
module.exports.processPlayer = processPlayer;
module.exports.stepTrap = stepTrap;
module.exports.stepBlades = stepBlades;
