"use strict";

/**
 * Castle Wars barricades. Set up from the inventory on your own tile during a game, up to a cap
 * per team; they never fight back (combat:no-retaliate), so they never turn to their attacker.
 *
 * A tinderbox sets one alight and it burns down; a bucket of water puts it out. An explosive
 * potion blows one up outright, but not while it is burning (OSRS Wiki: Barricade).
 *
 * Lighting and blasting require explicit item use; the burning forms still offer Extinguish.
 */

// ponytail: the Wiki says burning barricades "take time to collapse" without a figure.
const BURN_TICKS = 10;
const burns = new WeakMap();

let game;
let core;
let data;
let RegionManager;
let World;

function setupBarricade({ player }) {
  const location = player.getLocation();
  const teamId = game.getTeamId(player);
  if (!game.isPlaying(player) || !game.inGameBounds(location)) {
    player.sendMessage("You can only set up barricades during a Castle Wars game.");
    return true;
  }
  if (
    RegionManager.blocked(location, player.getPrivateArea()) ||
    game.isSteppingStone(game.getLocationTile(location)) ||
    World.isNpcOccupyingTile(location, null, 1, player.getPrivateArea())
  ) {
    player.sendMessage("You can't set up a barricade here.");
    return true;
  }
  const limit = game.getBarricadeLimit?.() ?? data.MAX_BARRICADES;
  if (game.teamBarricadeCount(teamId) >= limit) {
    player.sendMessage(`Your team already has ${limit} barricades set up.`);
    return true;
  }
  const barricade = new core.NPC(data.BARRICADE_NPC[teamId], location.clone());
  barricade.setFlag("combat:no-retaliate");
  barricade.__skipDefaultRespawn = true;
  if (!World.getNpcs().add(barricade)) {
    player.sendMessage("You can't set up another barricade right now.");
    return true;
  }
  game.trackBarricade(barricade, teamId);
  player.getInventory().delete(core.ItemIdentifiers.BARRICADE, 1);
  return true;
}

function releaseDeadBarricade({ npc }) {
  if (!game.isBarricade(npc)) {
    return;
  }
  npc.__skipDefaultRespawn = true;
  game.releaseBarricade(npc);
}

function preventBarricadeShove(event) {
  if (game.isBarricade(event.target)) event.allow = false;
}

function isBurning(npc) {
  return npc.getNpcTransformationId() !== -1;
}

/** Resolve an overlapping barricade interaction from a free adjacent tile. */
function stepBesideBarricade(player, npc, onArrival) {
  if (!player.getLocation().equals(npc.getLocation())) return true;
  const movement = player.getMovementQueue();
  // Match clippedStep's cardinal order; collision decides which side is available.
  const step = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => movement.canWalk(dx, dy)
    && !World.isNpcOccupyingTile(player.getLocation().transform(dx, dy), null, 1, player.getPrivateArea()));
  if (!step) {
    player.sendMessage("You need room to stand beside the barricade.");
    return false;
  }
  if (onArrival) {
    movement.walkToTile(player.getLocation().transform(step[0], step[1]), onArrival);
    return false;
  }
  movement.walkStep(step[0], step[1]);
  return true;
}

function blowUp(player, npc, slot) {
  if (!game.isBarricade(npc) || !npc.isRegistered() || npc.getHitpoints() <= 0) return;
  if (isBurning(npc)) {
    player.sendMessage("You can't blow up a burning barricade.");
    return;
  }
  const item = player.getInventory().getItems()[slot];
  if (!stepBesideBarricade(player, npc, () => {
    if (player.getPrivateArea() === npc.getPrivateArea() && player.getLocation().getZ() === npc.getLocation().getZ()
        && core.PathFinder.reachedEntity(player, npc) && player.getInventory().getItems()[slot] === item
        && item?.getId() === core.ItemIdentifiers.EXPLOSIVE_POTION && item.getAmount() > 0) blowUp(player, npc, slot);
  })) return;
  player.getInventory().deleteAtSlot(slot, 1);
  const explosion = core.CacheDefinitions.getSpotanimId("explodingvial");
  player.getPacketSender().sendGlobalGraphic(new core.Graphic(explosion), npc.getLocation());
  game.removeBarricade(npc);
}

function burnDown(npc, burn) {
  if (burns.get(npc) === burn && game.isBarricade(npc) && isBurning(npc)) {
    burns.delete(npc);
    game.removeBarricade(npc);
  }
}

function burnBarricade({ player, npc }) {
  if (!game.isBarricade(npc) || isBurning(npc)) {
    return false;
  }
  if (!player.getInventory().contains(core.ItemIdentifiers.TINDERBOX)) {
    return false;
  }
  if (!stepBesideBarricade(player, npc)) return true;
  const burn = {};
  burns.set(npc, burn);
  npc.setNpcTransformationId(npc.getId() + 1);
  game.later(BURN_TICKS, () => burnDown(npc, burn));
  return true;
}

function requireManualBurn({ player, npc }) {
  if (!game.isBarricade(npc)) {
    return false;
  }
  player.sendMessage("Use a tinderbox or explosive potion on the barricade.");
  return true;
}

function extinguishBarricade({ player, npc }) {
  if (!game.isBarricade(npc) || !isBurning(npc)) {
    return false;
  }
  const { BUCKET_OF_WATER, BUCKET } = core.ItemIdentifiers;
  if (!player.getInventory().contains(BUCKET_OF_WATER)) {
    player.sendMessage("You need a bucket of water to put out the fire.");
    return true;
  }
  if (!stepBesideBarricade(player, npc)) return true;
  player.getInventory().delete(BUCKET_OF_WATER, 1);
  player.getInventory().adds(BUCKET, 1);
  npc.setNpcTransformationId(-1);
  burns.delete(npc);
  return true;
}

function useItemOnBarricade(event) {
  const { player, target, itemId, slot } = event;
  if (!game.isBarricade(target)) {
    return;
  }
  const { TINDERBOX, EXPLOSIVE_POTION, BUCKET_OF_WATER } = core.ItemIdentifiers;
  if (itemId === EXPLOSIVE_POTION) {
    blowUp(player, target, slot);
  } else if (itemId === TINDERBOX) {
    burnBarricade({ player, npc: target });
  } else if (itemId === BUCKET_OF_WATER) {
    extinguishBarricade({ player, npc: target });
  } else {
    return;
  }
  event.handled = true;
}

module.exports = function attachCastleWarsBarricades(api, castleWars) {
  game = castleWars;
  core = api.core;
  data = castleWars.data;
  RegionManager = api.getRegionManager();
  World = api.getWorld();
  api.onItemAction("Barricade", { "Set-up": setupBarricade });
  api.onNpcDeath(releaseDeadBarricade);
  api.onCustomEvent("combat:shove-rules", preventBarricadeShove);
  api.onNpcInteraction("Barricade", { Burn: requireManualBurn, Extinguish: extinguishBarricade });
  api.onItemOnNpc(useItemOnBarricade);
};
