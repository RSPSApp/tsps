"use strict";

const Shared = require("./ZulrahShared");
const Fight = require("./ZulrahFight");

/** ::zulrah - to the Zul-Andra pier, beside the boat. */
function toZulAndra({ player }) {
  player.moveTo(Shared.loc(Shared.ZUL_ANDRA));
  return true;
}

/** ::zulrahfight [1-4] - straight onto the shrine, optionally forcing the first rotation. */
function startFight({ player, parts }) {
  const rotation = Number(parts?.[1]);
  const forced = Number.isInteger(rotation) && rotation >= 1 && rotation <= 4 ? rotation - 1 : null;
  Fight.start(player, { rotation: forced });
  player.sendMessage(forced == null ? "Zulrah rises when you move." : `Zulrah rises when you move; rotation ${forced + 1} first.`);
  return true;
}

/** ::zulrahkill - kills the Zulrah you are fighting. */
function killZulrah({ player }) {
  const fight = Fight.fightOf(player);
  if (!fight?.zulrah || fight.zulrah.getHitpoints() <= 0) {
    player.sendMessage("You are not fighting Zulrah.");
    return true;
  }
  const { HitDamage, HitMask } = Shared.core();
  fight.zulrah.getCombat().getHitQueue().addPendingDamage([new HitDamage(fight.zulrah.getHitpoints(), HitMask.RED)]);
  return true;
}

module.exports = function registerZulrahCommands(api) {
  const { PlayerRights } = api.core;
  api.registerCommand("zulrah", toZulAndra, PlayerRights.DEVELOPER, "Teleport to Zul-Andra");
  api.registerCommand("zulrahfight", startFight, PlayerRights.DEVELOPER, "Start a Zulrah fight (optional rotation 1-4)");
  api.registerCommand("zulrahkill", killZulrah, PlayerRights.DEVELOPER, "Kill your active Zulrah");
};
