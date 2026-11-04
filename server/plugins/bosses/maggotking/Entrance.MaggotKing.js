"use strict";

const Common = require("./Common.MaggotKing");
const Instance = require("./Instance.MaggotKing");

const EXIT_CAVE_ID = Common.data.exit.id; // cache loc 61994, Escape / Quick-escape in the lair
const NO_ACCESS = "You need to complete The Blood Moon Rises to enter the Maggot King's lair.";

function enterLair({ player, objectId }) {
  if (objectId !== Common.core().ObjectIdentifiers.DARKWOOD_TREES_4) return false;
  if (!Common.questComplete(player)) {
    player.sendMessage(NO_ACCESS);
    return true;
  }
  if (Instance.enter(player)) return true;
  player.sendMessage("You cannot enter the Maggot King's lair right now.");
  return true;
}

function exitLair({ player, objectId }) {
  if (objectId !== EXIT_CAVE_ID) return false;
  const session = Instance.sessionOf(player);
  if (!session) return false;
  player.moveTo(Common.loc(Common.data.outside));
  session.area.leave(player, false);
  return true;
}

function recoverOnLogin({ player }) {
  if (!player.getAttribute(Instance._test.INSTANCE_ATTRIBUTE)) return;
  player.setAttribute(Instance._test.INSTANCE_ATTRIBUTE, null);
  player.moveTo(Common.loc(Common.data.outside));
}

function attach(api) {
  Common.init(api);
  api.persistAttribute(Instance._test.INSTANCE_ATTRIBUTE, false);
  api.onObjectInteraction("Darkwood trees", { Enter: enterLair });
  api.onObjectInteraction("Cave", { Escape: exitLair, "Quick-escape": exitLair });
  api.onPlayerLogin(recoverOnLogin);
  api.onNpcDeath(Instance.onBossDeath);
}

module.exports = { attach, enterLair, exitLair, recoverOnLogin, NO_ACCESS, EXIT_CAVE_ID };
