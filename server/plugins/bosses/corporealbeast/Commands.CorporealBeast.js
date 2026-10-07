"use strict";

const Shared = require("./CorpShared");

/** The living Beast in the same copy of the room as the player, if any. */
function beastNear(player) {
  const y = player.getLocation().getY();
  let found = null;
  Shared.core().World.getNpcs().forEach((npc) => {
    if (npc?.getId?.() === Shared.NPC.CORP && npc.getHitpoints() > 0 && Math.abs(npc.getLocation().getY() - y) < 64) found = npc;
  });
  return found;
}

/** ::corpkill - finishes the Beast in your room, credited to you so the drop is yours. */
function killBeast({ player }) {
  if (!Shared.inRoom(player.getLocation())) {
    player.sendMessage("Use this in the Corporeal Beast's room.");
    return true;
  }
  const npc = beastNear(player);
  if (!npc) {
    player.sendMessage("The Corporeal Beast isn't here.");
    return true;
  }
  const { HitDamage, HitMask } = Shared.core();
  const remaining = npc.getHitpoints();
  npc.getCombat().addDamage(player, remaining);
  npc.getCombat().getHitQueue().addPendingDamage([new HitDamage(remaining, HitMask.RED)]);
  return true;
}

module.exports = function registerCorporealBeastCommands(api) {
  Shared.bind(api);
  api.registerCommand("corpkill", killBeast, api.core.PlayerRights.DEVELOPER, "Kill the Corporeal Beast encounter");
};

module.exports.killBeast = killBeast;
