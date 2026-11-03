/**
 * The area interface's teleport: a free home-teleport cast to an unlocked area's hub (the cache
 * table's area_teleport_coord, the captured landings), within the captured spread of two tiles.
 * Raging Echoes plays its own captured animation set (data `teleportCast`); a league without one
 * plays the standard home teleport cast. Interrupted like a home teleport; no cooldown (the
 * capture has some ninety casts in one session). Other teleports may play the same cast: they ask
 * `league:teleport-cast` { player } -> cast (the league's `teleportCast`, null without one).
 */
const Common = require("./Common.LeagueAreaUnlocks");
const { startHomeTeleport, castOf } = require("../../combat/HomeTeleportSequence");

function destination(area) {
  const { Location } = Common.core;
  const spread = Common.data.interface.teleportSpread;
  const offset = () => Math.floor(Math.random() * (2 * spread + 1)) - spread;
  const { x, y, z } = area.teleport;
  return new Location(x + offset(), y + offset(), z);
}

/**
 * Starts the cast to the area's hub; false when it is refused. The modal closes first (as captured;
 * an open one also counts as busy for the teleport rules), so a refusal by those rules closes it too.
 */
function cast(player, type, area) {
  const { TeleportHandler, CombatFactory } = Common.core;
  if (CombatFactory.inCombat(player)) {
    player.sendMessage(Common.message("inCombat"));
    return false;
  }
  const target = destination(area);
  player.getPacketSender().sendInterfaceRemoval();
  if (!TeleportHandler.checkReqs(player, target)) return false;
  startHomeTeleport(Common.core, player, target, null, castOf(Common.league(type).teleportCast));
  return true;
}

/** `league:teleport-cast` { player } -> cast: the character's league's own area-teleport cast, if it has one. */
function answerTeleportCast(query) {
  if (!query?.player) return;
  const type = Common.leagueOf(query.player);
  const own = type === null ? null : Common.league(type)?.teleportCast;
  if (own) query.cast = own;
}

module.exports = { cast, destination, answerTeleportCast };
