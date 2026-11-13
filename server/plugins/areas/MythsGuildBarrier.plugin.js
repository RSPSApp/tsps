"use strict";

/**
 * The two Magical Barriers into the Myths' Guild: across the bridge to the front door
 * (ds2_guild_bridge_entrance, a row of three at y=2861) and in the basement, across the bridge
 * from the eastern Corsair Cove Dungeon (ds2_guild_dungeon_entrance, a column of two at x=1968).
 * Also the red Barriers of the Lithkren Vault (ds2_lithkren_vault_barrier, cache name "Barrier"),
 * rows and columns of 1x1 locs closing off the adamant (west) and rune (east) dragon wings.
 *
 * Wiki (Myths' Guild): entry needs Dragon Slayer II. Wiki (Lithkren Vault): "These barriers can
 * only be entered once Dragon Slayer II has been completed." How the quest was completed doesn't matter,
 * so a Leagues area unlock that completes it opens both barriers too.
 *
 * rsprox 224/01437, 230/00350 and 233/00778: the player stops beside the barrier and faces it
 * for a tick; on the next tick "You pass through the barrier." (spam) arrives and the player is
 * on the tile beyond it, two tiles on, in one move. The Lithkren barriers do the same
 * (rsprox 231/00722 tick 433, west through the x=1561 column; tick 499, south through the
 * y=5088 row).
 *
 * Not recorded: crossing out of the Myths' Guild (assumed the same, the other way), and the
 * refusal for a player without the quest at any of them; the Wiki gives no line for it either,
 * so REFUSED is our own.
 */

const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

const QUEST = "Dragon Slayer II";
const BARRIER_LOCS = ["ds2_guild_bridge_entrance", "ds2_guild_dungeon_entrance", "ds2_lithkren_vault_barrier"];
const PASS_MESSAGE = "You pass through the barrier.";
const REFUSED = "You need to complete Dragon Slayer II to pass through the barrier.";
/** The tick the player stands facing the barrier before the crossing (rsprox 224/01437). */
const FACE_TICKS = 1;

let api = null;
let core = null;

function isBarrier(objectId) {
  return BARRIER_LOCS.some((name) => core.CacheDefinitions.getLocId(name) === objectId);
}

function questComplete(player) {
  const request = { player, name: QUEST, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/**
 * The tile beyond a 1x1 barrier for a player standing beside it on a side (not a corner), or
 * null. Each barrier tile is crossed straight through, whichever row or column it sits in.
 */
function across(barrier, x, y, z) {
  if (z !== barrier.z) return null;
  const dx = barrier.x - x;
  const dy = barrier.y - y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  return [barrier.x + dx, barrier.y + dy];
}

function pass(event) {
  if (!isBarrier(event.objectId)) return false;
  const { player, object } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  if (!questComplete(player)) {
    player.sendMessage(REFUSED);
    return true;
  }
  const at = object.getLocation();
  const from = player.getLocation();
  const barrier = { x: at.getX(), y: at.getY(), z: at.getZ() };
  const to = across(barrier, from.getX(), from.getY(), from.getZ());
  if (!to) return true;
  ObstacleRunner.run({ player, object }, [
    { face: [barrier.x, barrier.y] },
    { wait: FACE_TICKS },
    { msg: { spam: PASS_MESSAGE } },
    { tele: to },
  ]);
  return true;
}

function bind(registry) {
  api = registry;
  core = registry.core;
  ObstacleRunner.init(registry);
}

module.exports = {
  name: "MythsGuildBarrier",
  description: "The Myths' Guild magical barriers (bridge and basement) and the Lithkren Vault barriers: open after Dragon Slayer II.",
  members: true,
  register(registry) {
    bind(registry);
    registry.onObjectInteraction("Magical Barrier", { Pass: pass });
    // Zalcano's prison barrier shares the name; each handler passes on the other's ids.
    registry.onObjectInteraction("Barrier", { Pass: pass });
  },
  across, pass, QUEST, PASS_MESSAGE, REFUSED,
};
