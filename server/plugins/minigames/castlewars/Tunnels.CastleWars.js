"use strict";

/**
 * Castle Wars tunnels.
 *
 * Each of the four tunnel mouths starts blocked by rocks. Mining gradually clears both layers;
 * explosive potions each clear one (Rocks 4437 -> 4438 -> gone). An explosive potion on any of
 * the cave walls around a mouth brings the rocks back down, killing whoever stands under them
 * (OSRS Wiki: Explosive potion, Castle Wars). The owning team's overlay shows each pair of
 * tunnels as clear or blocked (varbits 138/139).
 *
 * Nothing may end up inside the rocks (issue 1929): barricades can't be set up on a patch, and a
 * standard dropped on one goes home while either rock layer stands; once both are cleared it is
 * placed on the inside floor corner just outside the patch (Game.CastleWars.js), so rocks never
 * fall on a dropped one.
 *
 * Cache locs: rocks at the four patches below, cave walls 4448 on the corners of each patch.
 * RSPS-only (Near-Reality): which team owns which patch and the clear/collapse messages.
 */

let game;
let core;
let api;
const miners = new WeakMap();

const PATCH_SIZE = 2;

function patches() {
  const { SARADOMIN, ZAMORAK } = game.TEAM;
  const { TUNNEL_NS_CLEAR, TUNNEL_EW_CLEAR } = game.TEAM_VARBIT;
  return [
    { team: SARADOMIN, varbit: TUNNEL_NS_CLEAR, rocks: [2401, 9494, 0], walls: [[2400, 9493], [2403, 9493], [2400, 9496], [2403, 9496]] },
    { team: SARADOMIN, varbit: TUNNEL_EW_CLEAR, rocks: [2409, 9503, 1], walls: [[2408, 9502], [2408, 9505], [2411, 9502], [2411, 9505]] },
    { team: ZAMORAK, varbit: TUNNEL_NS_CLEAR, rocks: [2400, 9512, 0], walls: [[2399, 9511], [2402, 9511], [2399, 9514], [2402, 9514]] },
    { team: ZAMORAK, varbit: TUNNEL_EW_CLEAR, rocks: [2391, 9501, 1], walls: [[2390, 9500], [2393, 9500], [2390, 9503], [2393, 9503]] },
  ];
}

function rocksLocation(patch) {
  return new core.Location(patch.rocks[0], patch.rocks[1], 0);
}

function patchAtRocks(object) {
  const location = object.getLocation();
  return patches().find(({ rocks }) => rocks[0] === location.getX() && rocks[1] === location.getY());
}

function patchAtWall(object) {
  const location = object.getLocation();
  return patches().find(({ walls }) => walls.some(([x, y]) => x === location.getX() && y === location.getY()));
}

// One layer of rock comes away: the full pile drops to the half pile, the half pile clears.
function clearRocks(player, object, patch) {
  const O = core.ObjectIdentifiers;
  if (object.getId() === O.ROCKS_21) {
    const remaining = new core.GameObject(O.ROCKS_22, object.getLocation(), object.getType(), object.getFace(), null);
    game.swapObject(object, remaining);
    player.sendMessage("You manage to remove some of the rocks.");
    return remaining;
  }
  game.swapObject(object, null);
  game.setTeamVar(patch.team, patch.varbit, 1);
  player.sendMessage("You manage to clear the rest of the rocks.");
  return null;
}

function bestPickaxe(player) {
  const request = { player, pickaxe: null };
  api.emitCustomEvent("mining:best-pickaxe", request);
  return request.pickaxe;
}

function miningInterval(pickaxe) {
  const request = { pickaxe, ticks: null };
  api.emitCustomEvent("mining:roll-interval", request);
  return request.ticks ?? pickaxe.attemptIntervalTicks;
}

function mineRocks({ player, object }, collapse = false) {
  const patch = collapse ? patchAtWall(object) : patchAtRocks(object);
  if (!patch) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  if (collapse && isBlocked(patch)) {
    player.sendMessage("The tunnel is already blocked.");
    return true;
  }
  const pickaxe = bestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You need a pickaxe to mine these rocks.");
    return true;
  }
  miners.get(player)?.stop();
  const start = player.getLocation().clone();
  const area = player.getPrivateArea();
  let remaining = object;
  // shortcut: the Wiki confirms faster pickaxes here but gives no CW-specific timing;
  // use Mining's canonical interval per layer until a live capture establishes it.
  let ticks = miningInterval(pickaxe);
  const task = new core.Task(1, player.getIndex(), false);
  task.stop = () => {
    core.Task.prototype.stop.call(task);
    if (miners.get(player) === task) {
      miners.delete(player);
      player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
    }
  };
  task.execute = () => {
    const tool = bestPickaxe(player);
    const movement = player.getMovementQueue();
    if (!player.isRegistered() || player.getHitpoints() <= 0 || !game.isPlaying(player)
      || player.getPrivateArea() !== area || !player.getLocation().equals(start)
      || movement.size() > 0 || player.getForceMovement() != null || !tool
      || core.MapObjects.get(remaining.getId(), remaining.getLocation(), area) !== remaining) {
      task.stop();
      return;
    }
    if (--ticks > 0) return;
    if (collapse) {
      collapseTunnel(player, patch);
      task.stop();
      return;
    }
    remaining = clearRocks(player, remaining, patch);
    if (!remaining) {
      task.stop();
      return;
    }
    ticks = miningInterval(tool);
    player.performAnimation(tool.animation);
  };
  miners.set(player, task);
  player.performAnimation(pickaxe.animation);
  api.getTaskManager().submit(task);
  return true;
}

function blastRocks(event) {
  const { player, object, itemSlot } = event;
  const patch = patchAtRocks(object);
  if (!patch) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  player.getInventory().deleteAtSlot(itemSlot, 1);
  clearRocks(player, object, patch);
  return true;
}

function isBlocked(patch) {
  const O = core.ObjectIdentifiers;
  const at = rocksLocation(patch);
  return [O.ROCKS_21, O.ROCKS_22].some((id) => core.MapObjects.get(id, at, null) != null);
}

function inPatch(patch, location) {
  const [x, y] = patch.rocks;
  return location.getZ() === 0
    && location.getX() >= x && location.getX() < x + PATCH_SIZE
    && location.getY() >= y && location.getY() < y + PATCH_SIZE;
}

function crushedBy(patch, player) {
  return inPatch(patch, player.getLocation());
}

/** Whether a tile lies where a tunnel's rocks stand, or fall when it collapses. */
function isRockTile(location) {
  return patches().some((patch) => inPatch(patch, location));
}

/**
 * The tile a standard dropped on a tunnel patch belongs on (issue 2355). Outside every footprint
 * it stays where the carrier is. While either rock layer stands the standard goes home (null).
 * A cleared 2x2 patch uses the inside floor corner in the patch's own orientation, keeping the
 * carrier's across-axis tile. Evidence limits are in server/docs/castle-wars-flags.md.
 */
function flagDropTile(location) {
  const patch = patches().find((candidate) => inPatch(candidate, location));
  if (!patch) {
    return location;
  }
  if (isBlocked(patch)) {
    return null;
  }
  const [x, y, face] = patch.rocks;
  // North-south (face 0) moves along y; east-west (face 1) moves along x.
  return face === 0
    ? new core.Location(location.getX(), location.getY() === y ? y - 1 : y + PATCH_SIZE, 0)
    : new core.Location(location.getX() === x ? x - 1 : x + PATCH_SIZE, location.getY(), 0);
}

function collapseTunnel(player, patch, slot) {
  if (isBlocked(patch)) {
    player.sendMessage("The tunnel is already blocked.");
    return;
  }
  if (slot !== undefined) player.getInventory().deleteAtSlot(slot, 1);
  const [x, y, face] = patch.rocks;
  game.swapObject(null, new core.GameObject(core.ObjectIdentifiers.ROCKS_21, new core.Location(x, y, 0), 10, face, null));
  game.setTeamVar(patch.team, patch.varbit, 0);
  player.sendMessage("You've collapsed the tunnel!");
  for (const victim of game.gameArea.getPlayers().filter((other) => crushedBy(patch, other))) {
    victim.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(victim.getHitpoints(), core.HitMask.RED)]);
  }
}

function collapseWall(event) {
  return mineRocks(event, true);
}

function blastWall({ player, object, itemSlot }) {
  const patch = patchAtWall(object);
  if (!patch) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  collapseTunnel(player, patch, itemSlot);
  return true;
}

module.exports = function attachCastleWarsTunnels(pluginApi, castleWars) {
  api = pluginApi;
  game = castleWars;
  core = api.core;
  game.isTunnelRockTile = isRockTile;
  game.tunnelFlagDropTile = flagDropTile;
  api.onObjectInteraction("Rocks", { Mine: mineRocks });
  api.onObjectInteraction("Cave wall", { Collapse: collapseWall });
  api.onItemOnObject("Explosive potion", "Rocks", blastRocks);
  api.onItemOnObject("Explosive potion", "Cave wall", blastWall);
};
