"use strict";

/**
 * Castle Wars tunnels.
 *
 * Each of the four tunnel mouths starts blocked by rocks. Clearing them takes two goes with a
 * pickaxe or an explosive potion (Rocks 4437 -> 4438 -> gone); an explosive potion on any of
 * the cave walls around a mouth brings the rocks back down, killing whoever stands under them
 * (OSRS Wiki: Explosive potion, Castle Wars). The owning team's overlay shows each pair of
 * tunnels as clear or blocked (varbits 138/139).
 *
 * Cache locs: rocks at the four patches below, cave walls 4448 on the corners of each patch.
 * RSPS-only (Near-Reality): which team owns which patch and the clear/collapse messages.
 */

const Mining = require("../../skills/Mining.plugin");

let game;
let core;

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
    game.swapObject(object, new core.GameObject(O.ROCKS_22, object.getLocation(), object.getType(), object.getFace(), null));
    player.sendMessage("You manage to remove some of the rocks.");
    return;
  }
  game.swapObject(object, null);
  game.setTeamVar(patch.team, patch.varbit, 1);
  player.sendMessage("You manage to clear the rest of the rocks.");
}

function mineRocks({ player, object }) {
  const patch = patchAtRocks(object);
  if (!patch) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  const pickaxe = Mining.findBestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You need a pickaxe to mine these rocks.");
    return true;
  }
  // ponytail: each click clears a layer at once; real OSRS mines it over a few ticks.
  player.performAnimation(pickaxe.animation);
  clearRocks(player, object, patch);
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

function crushedBy(patch, player) {
  const location = player.getLocation();
  const [x, y] = patch.rocks;
  return location.getZ() === 0
    && location.getX() >= x && location.getX() < x + PATCH_SIZE
    && location.getY() >= y && location.getY() < y + PATCH_SIZE;
}

function collapseTunnel(player, patch, slot) {
  if (isBlocked(patch)) {
    player.sendMessage("The tunnel is already blocked.");
    return;
  }
  player.getInventory().deleteAtSlot(slot, 1);
  const [x, y, face] = patch.rocks;
  game.swapObject(null, new core.GameObject(core.ObjectIdentifiers.ROCKS_21, new core.Location(x, y, 0), 10, face, null));
  game.setTeamVar(patch.team, patch.varbit, 0);
  player.sendMessage("You've collapsed the tunnel!");
  for (const victim of game.gameArea.getPlayers().filter((other) => crushedBy(patch, other))) {
    victim.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(victim.getHitpoints(), core.HitMask.RED)]);
  }
}

function collapseWall({ player, object }) {
  const patch = patchAtWall(object);
  if (!patch) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  const slot = player.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION);
  if (slot < 0) {
    player.sendMessage("You need an explosive potion to collapse the tunnel.");
    return true;
  }
  collapseTunnel(player, patch, slot);
  return true;
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

module.exports = function attachCastleWarsTunnels(api, castleWars) {
  game = castleWars;
  core = api.core;
  api.onObjectInteraction("Rocks", { Mine: mineRocks });
  api.onObjectInteraction("Cave wall", { Collapse: collapseWall });
  api.onItemOnObject("Explosive potion", "Rocks", blastRocks);
  api.onItemOnObject("Explosive potion", "Cave wall", blastWall);
};
