/**
 * A Hardcore Ironman has one life: a dangerous death (items lost) makes them a standard Ironman,
 * with the varbits the captures show for a fallen Hardcore (ironman_hardcore_dead,
 * ironman_downgradepermitted, ironman_hardcore_downgradedate). A safe death (a minigame) changes
 * nothing.
 */
const Common = require("./Common.Ironman");

/** The downgrade date counts days; RuneScape's day counter starts on 27 February 2002. */
const DAY_ZERO = Date.UTC(2002, 1, 27);

function death(event) {
  const { player, itemsLost } = event;
  if (Common.modeOf(player) !== "hardcore" || itemsLost === false) return;
  player.setAttribute(Common.HARDCORE_DEAD_ATTRIBUTE, Math.floor((Date.now() - DAY_ZERO) / 86400000));
  Common.setMode(player, "ironman");
  Common.api.emitCustomEvent("persistence:save", { player, reason: "hardcore-death" });
  player.sendMessage(Common.message("hardcoreDeath"));
  Common.api.emitCustomEvent("ironman:hardcore-death", { player });
}

module.exports = function attach(api) {
  api.onPlayerDeath(death);
};
