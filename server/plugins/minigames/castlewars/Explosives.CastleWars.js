"use strict";

// Wiki: Explosive potion. A dropped vial explodes for 15 damage to its owner, including lethal hits.
const DROP_DAMAGE = 15;
let core;
let game;

function dropExplosive(event) {
  const { player, itemId, slot } = event;
  if (itemId !== core.ItemIdentifiers.EXPLOSIVE_POTION || !game.isPlaying(player) || player.getArea() !== game.gameArea) return;
  player.getInventory().deleteAtSlot(slot, 1);
  event.dropToGround = false;
  event.handled = true;
  const graphic = core.CacheDefinitions.getSpotanimId("explode");
  player.getPacketSender().sendGlobalGraphic(new core.Graphic(graphic), player.getLocation());
  player.forceChat("Ow!");
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(DROP_DAMAGE, core.HitMask.RED).setSource(player)]);
}

module.exports = function attachCastleWarsExplosives(api, castleWars) {
  core = api.core;
  game = castleWars;
  api.onItemDropPolicy(dropExplosive);
};
