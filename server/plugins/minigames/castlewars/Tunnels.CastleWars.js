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
 * Nothing may end up inside the rocks: barricades can't be set up on a patch, and a standard
 * dropped there (a crushed carrier, or rocks falling on a dropped one) comes out on the nearest
 * open tunnel tile, so it stays in play (issue 1929).
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

/** The open tunnel tiles touching a patch, nearest to `from` first. */
function tilesBeside(patch, from) {
  const [x, y] = patch.rocks;
  const tiles = [];
  for (let dx = -1; dx <= PATCH_SIZE; dx++) {
    for (let dy = -1; dy <= PATCH_SIZE; dy++) {
      const tile = new core.Location(x + dx, y + dy, 0);
      if (!inPatch(patch, tile) && !core.RegionManager.blocked(tile, null)) tiles.push(tile);
    }
  }
  const distance = (tile) => Math.abs(tile.getX() - from.getX()) + Math.abs(tile.getY() - from.getY());
  return tiles.sort((a, b) => distance(a) - distance(b));
}

/** Where to put something dropped on `location` instead, when rocks bury that tile; else null. */
function unburiedTiles(location) {
  const patch = patches().find((candidate) => inPatch(candidate, location));
  return patch && isBlocked(patch) ? tilesBeside(patch, location) : null;
}

/** Rocks falling on a dropped standard push it out to the tunnel beside them. */
function unburyStandards(patch) {
  for (const teamId of Object.values(game.TEAM)) {
    const dropped = game.getDroppedFlagObject(teamId);
    if (dropped && inPatch(patch, dropped.getLocation())) {
      game.moveDroppedFlag(teamId, tilesBeside(patch, dropped.getLocation()));
    }
  }
}

function collapseTunnel(player, patch, slot) {
  if (isBlocked(patch)) {
    player.sendMessage("The tunnel is already blocked.");
    return;
  }
  if (slot !== undefined) player.getInventory().deleteAtSlot(slot, 1);
  const [x, y, face] = patch.rocks;
  // Standards come out before the rocks go in: removing a standard clears its tile's clipping
  // and sends a type-10 removal for the tile, which would otherwise hit the new rocks.
  unburyStandards(patch);
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
  game.unburiedTiles = unburiedTiles;
  api.onObjectInteraction("Rocks", { Mine: mineRocks });
  api.onObjectInteraction("Cave wall", { Collapse: collapseWall });
  api.onItemOnObject("Explosive potion", "Rocks", blastRocks);
  api.onItemOnObject("Explosive potion", "Cave wall", blastWall);
};
