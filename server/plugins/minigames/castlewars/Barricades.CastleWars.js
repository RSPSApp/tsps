"use strict";

/**
 * Castle Wars barricades. Set up from the inventory on your own tile during a game, up to a cap
 * per team; they never fight back (combat:no-retaliate), so they never turn to their attacker.
 *
 * A tinderbox sets one alight and it burns down; a bucket of water puts it out. An explosive
 * potion blows one up outright, but not while it is burning (OSRS Wiki: Barricade).
 *
 * Cache npcs: 5722 (Saradomin) / 5724 (Zamorak) offer Burn, their burning forms 5723 / 5725
 * offer Extinguish.
 */

// ponytail: the Wiki says burning barricades "take time to collapse" without a figure.
const BURN_TICKS = 10;

let game;
let core;
let data;
let RegionManager;
let ObjectManager;
let World;

function setupBarricade({ player, slot }) {
  const location = player.getLocation();
  const teamId = game.getTeamId(player);
  if (!game.isPlaying(player) || !game.inGameBounds(location)) {
    player.sendMessage("You can only set up barricades during a Castle Wars game.");
    return true;
  }
  if (
    RegionManager.blocked(location, player.getPrivateArea()) ||
    ObjectManager.existsLocation(location) ||
    World.isNpcOccupyingTile(location, null, 1, player.getPrivateArea())
  ) {
    player.sendMessage("You can't set up a barricade here.");
    return true;
  }
  if (game.teamBarricadeCount(teamId) >= data.MAX_BARRICADES) {
    player.sendMessage(`Your team already has ${data.MAX_BARRICADES} barricades set up.`);
    return true;
  }
  const barricade = new core.NPC(data.BARRICADE_NPC[teamId], location.clone());
  barricade.setFlag("combat:no-retaliate");
  barricade.__skipDefaultRespawn = true;
  game.trackBarricade(barricade, teamId);
  World.getAddNPCQueue().push(barricade);
  player.getInventory().deleteAtSlot(slot, 1);
  return true;
}

function releaseDeadBarricade({ npc }) {
  if (!game.isBarricade(npc)) {
    return;
  }
  npc.__skipDefaultRespawn = true;
  game.releaseBarricade(npc);
}

function isBurning(npc) {
  return npc.getNpcTransformationId() !== -1;
}

function blowUp(player, npc, slot) {
  if (isBurning(npc)) {
    player.sendMessage("You can't blow up a burning barricade.");
    return;
  }
  player.getInventory().deleteAtSlot(slot, 1);
  game.removeBarricade(npc);
}

function burnDown(npc) {
  if (game.isBarricade(npc) && isBurning(npc)) {
    game.removeBarricade(npc);
  }
}

function burnBarricade({ player, npc }) {
  if (!game.isBarricade(npc) || isBurning(npc)) {
    return false;
  }
  const { TINDERBOX, EXPLOSIVE_POTION } = core.ItemIdentifiers;
  if (player.getInventory().contains(TINDERBOX)) {
    npc.setNpcTransformationId(npc.getId() + 1);
    game.later(BURN_TICKS, () => burnDown(npc));
    return true;
  }
  const potionSlot = player.getInventory().getSlotForItemId(EXPLOSIVE_POTION);
  if (potionSlot >= 0) {
    blowUp(player, npc, potionSlot);
    return true;
  }
  player.sendMessage("You need a tinderbox or an explosive potion to burn the barricade.");
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
  player.getInventory().delete(BUCKET_OF_WATER, 1);
  player.getInventory().adds(BUCKET, 1);
  npc.setNpcTransformationId(-1);
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
  ObjectManager = api.getObjectManager();
  World = api.getWorld();
  api.onItemAction("Barricade", { "Set-up": setupBarricade });
  api.onNpcDeath(releaseDeadBarricade);
  api.onNpcInteraction("Barricade", { Burn: burnBarricade, Extinguish: extinguishBarricade });
  api.onItemOnNpc(useItemOnBarricade);
};
