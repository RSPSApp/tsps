"use strict";

/**
 * The maze's tick rules, from the Wiki's trap and obstacle pages:
 *
 * - A floor or wall trap fires when you stand on/in front of it, or walk over it without the
 *   run trick (running straight across avoids it). Searching it drains one Thieving and holds
 *   only while you stay on that tile.
 * - Spinning blades on pedestals cannot be disarmed; touching their 3x3 pedestal is a catch.
 * - A pendulum or floor blade carries you one tile past it for 3 Agility.
 * - A wall blade or saw carries you past it for 10 Agility (the Wiki's temporary-drain table).
 * - A wall crusher is a 50/50 pass: success costs 1 Thieving, failure 5 Agility and the maze.
 * - Rogue guards throw you out within two tiles unless a flash powder has blinded them.
 *
 * A failed pass always ejects: no damage is taken in the maze.
 */
const Common = require("./Common.RoguesDen");
const Run = require("./Run.RoguesDen");

const GUARD_RANGE = 2;
const FLASH_STUN_TICKS = 10;

function localNpcs(player) {
  const list = player.getLocalNpcs?.();
  return Array.isArray(list) ? list : list ? [...list.values()] : [];
}

function near(guard, player) {
  const a = guard.getLocation?.();
  const b = player.getLocation();
  return a && a.getZ() === b.getZ() && Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY())) <= GUARD_RANGE;
}

// Guard blindness belongs to the guard, not to a run: one shared deadline that every nearby
// player compares against the same world clock, whatever their own run's age.
function guardStunned(guard) {
  return (guard.__roguesDenStunnedUntil ?? 0) > Common.core().World.getProcessCycle();
}

function stunGuard(npc, ticks) {
  const until = Common.core().World.getProcessCycle() + ticks;
  npc.__roguesDenStunnedUntil = Math.max(npc.__roguesDenStunnedUntil ?? 0, until);
}

function guardsCatch(run) {
  const { player } = run;
  for (const npc of localNpcs(player)) {
    if (!Common.npcIds.guards.includes(npc.getId?.())) continue;
    if (!near(npc, player)) continue;
    if (guardStunned(npc)) continue;
    Run.caught(player, Common.message("guardEject"));
    return true;
  }
  return false;
}

function straightBeyond(run, from, dir, limit = 3) {
  const { Location } = Common.core();
  const here = run.player.getLocation();
  for (let step = 1; step <= limit; step++) {
    const x = here.getX() + dir[0] * step;
    const y = here.getY() + dir[1] * step;
    // The destination only has to be a real walkable tile; object clipping is bypassed because
    // the obstacle itself is what we are jumping past.
    if (x > 0 && y > 0 && Common.walkable(x, y, here.getZ())) return new Location(x, y, here.getZ());
  }
  return null;
}

function carryPast(run, drainAmount, direction, messageKey) {
  const runState = run;
  if (!runState.drain("AGILITY", drainAmount)) {
    Run.caught(runState.player, Common.message("noAgility"));
    return true;
  }
  const dir = direction ?? runState.lastMove;
  const to = straightBeyond(runState, runState.player.getLocation(), dir, 2);
  if (!to) {
    Run.caught(runState.player, Common.message(messageKey ?? "bladeEject"));
    return true;
  }
  const { player } = runState;
  player.getMovementQueue().reset();
  runState.teleporting = true;
  player.moveTo(to);
  runState.teleporting = false;
  runState.ignoreTrapUntil = runState.ticks + 1;
  runState.prev = to.clone();
  return true;
}

function floorTrap(run, here) {
  const trap = Common.floorTraps.get(here);
  if (!trap || trap.id === Common.ids.floorTrapdoor) return false;
  if (trap.disarmedBy) return false;
  if (run.ignoreTrapUntil > run.ticks) return false;
  const running = run.player.isRunningReturn();
  const moving = run.moved;
  if (running && moving) return false;
  Run.caught(run.player, Common.message("trapEject"));
  return true;
}

function wallTrap(run, here) {
  const trap = Common.wallTraps.get(here);
  if (!trap) return false;
  if (trap.disarmedBy) return false;
  if (run.ignoreTrapUntil > run.ticks) return false;
  if (trap.id === Common.ids.wallCrusher) {
    if (run.player.isRunningReturn() && run.moved) return false;
    if (Math.random() < 0.5) {
      if (!run.drain("THIEVING", Common.DATA.drains.wallCrusherSuccess)) {
        Run.caught(run.player, Common.message("noThieving"));
        return true;
      }
      const to = straightBeyond(run, run.player.getLocation(), run.lastMove, 2);
      if (to) {
        run.player.getMovementQueue().reset();
        run.teleporting = true;
        run.player.moveTo(to);
        run.teleporting = false;
        run.ignoreTrapUntil = run.ticks + 1;
        run.prev = to.clone();
      }
      return true;
    }
    if (!run.drain("AGILITY", Common.DATA.drains.wallCrusherFail)) {
      Run.caught(run.player, Common.message("noAgility"));
      return true;
    }
    Run.caught(run.player, Common.message("trapEject"));
    return true;
  }
  if (run.player.isRunningReturn() && run.moved) return false;
  Run.caught(run.player, Common.message(trap.id === Common.ids.wallGas ? "trapEject" : "trapEject"));
  return true;
}

function autoObstacle(run, here, moved) {
  if (!moved) return false;
  const running = run.player.isRunningReturn();
  if (Common.spinningTiles.has(here)) {
    Run.caught(run.player, Common.message("bladeEject"));
    return true;
  }
  if (Common.pendulumTiles.has(here)) {
    return carryPast(run, Common.DATA.drains.pendulum, run.lastMove, "bladeEject");
  }
  if (Common.floorBladeTiles.has(here)) {
    return carryPast(run, Common.DATA.drains.floorBlade, run.lastMove, "bladeEject");
  }
  if (Common.wallBlades.has(here)) {
    return carryPast(run, Common.DATA.drains.wallBlade, run.lastMove, "bladeEject");
  }
  if (Common.wallSaws.has(here)) {
    return carryPast(run, Common.DATA.drains.wallSaw, run.lastMove, "bladeEject");
  }
  return false;
}

function tick(run, movement) {
  run.ticks = (run.ticks ?? 0) + 1;
  run.moved = !movement.teleported && (movement.dx !== 0 || movement.dy !== 0);
  if (run.ignoreTrapUntil > run.ticks) return;
  if (guardsCatch(run)) return;
  if (autoObstacle(run, movement.here, run.moved)) return;
  if (Common.spinningTiles.has(movement.here)) {
    Run.caught(run.player, Common.message("bladeEject"));
    return;
  }
  if (wallTrap(run, movement.here)) return;
  floorTrap(run, movement.here);
}

/** Flash powder on a Rogue Guard blinds it for ten ticks. */
function useFlashPowder(event) {
  // Item-on-NPC carries the clicked NPC as `target` (UseItemPacketListener); `npc` only exists on
  // the NPC-option route events, so reading it here made every normal powder use a no-op.
  const { player, target: npc, itemId } = event;
  if (itemId !== Common.itemIds.flashPowder) return false;
  if (!Common.npcIds.guards.includes(npc?.getId?.())) return false;
  if (!npc || npc.getLocation().getDistance(player.getLocation()) > 6) return false;
  if (!Common.hasItem(player, Common.itemIds.flashPowder)) return false;
  Common.take(player, Common.itemIds.flashPowder, 1);
  stunGuard(npc, FLASH_STUN_TICKS);
  player.sendMessage(Common.message("flashBlind"));
  player.sendMessage(Common.message("guardBlinded"));
  event.handled = true;
  return true;
}

module.exports = { tick, useFlashPowder, stunGuard };
