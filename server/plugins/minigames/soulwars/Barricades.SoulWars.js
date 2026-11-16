"use strict";

/**
 * Soul Wars barricades (Wiki: Barricade (Soul Wars)). The barricade item's Set-up option places an
 * attackable, 50-hitpoint barricade on the player's tile; a team may have ten set up at once, and a
 * destroyed barricade is gone. The cache's soul_wars_barricade_red/blue NPCs (10540/10539) are the
 * attackable forms, as Castle Wars does with its own barricade NPCs.
 *
 * The cap and placement refusals are our wording; the Wiki gives the mechanic, not the lines.
 */
const Common = require("./Common.SoulWars");
const Match = require("./Match.SoulWars");

let core = null;
let regionManager = null;
let world = null;

function teamItem(team) {
  return Common.data.barricades.items[team];
}

/** The barricade item's Set-up: spawn the team's barricade on the player's tile. */
function setup(event) {
  const game = Match.gameOf(event.player);
  if (!game) return false;
  const team = game.teamOf(event.player);
  if (!team || event.itemId !== teamItem(team)) return false;
  const { max, npcs } = Common.data.barricades;
  if (game.teamBarricadeCount(team) >= max) {
    event.player.sendMessage(`Your team already has ${max} barricades set up.`);
    return true;
  }
  const location = event.player.getLocation();
  const area = event.player.getPrivateArea();
  if (regionManager?.blocked?.(location, area) === true
    || world?.isNpcOccupyingTile?.(location, null, 1, area) === true) {
    event.player.sendMessage("You can't set up a barricade here.");
    return true;
  }
  const npc = game.spawn(npcs[team], [location.getX(), location.getY(), location.getZ()]);
  npc.setFlag(core.NPC.BLOCKS_PLAYERS_FLAG);
  npc.setFlag(core.NPC.BLOCKS_PROJECTILES_FLAG);
  npc.setFlag("combat:no-retaliate");
  npc.__soulWarsBarricade = true;
  game.trackBarricade(npc, team);
  event.player.getInventory().delete(event.itemId, 1);
  return true;
}

/** A destroyed barricade leaves the team's count; the engine removes the NPC itself. */
function died(event) {
  const npc = event.npc;
  if (!npc?.__soulWarsBarricade) return;
  npc.__soulWars?.releaseBarricade(npc);
}

function attachBarricades(api) {
  core = api.core;
  regionManager = api.getRegionManager?.() ?? null;
  world = api.getWorld?.() ?? null;
  api.onItemAction("Barricade", { "Set-up": setup });
  api.onNpcDeath(died);
}

module.exports = { attachBarricades };
