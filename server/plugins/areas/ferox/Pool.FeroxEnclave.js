/**
 * Ferox Enclave's Pool of Refreshment: everything but special attack, and prayers off (Wiki);
 * the animation and message as captured.
 */
const Ferox = require("./Common.FeroxEnclave");

const POOL_ANIMATION = 7305; // poh_pool_drink
const POOL_BUSY_TICKS = 3; // ours: the capture ends with busy still set

function drink({ player }) {
  player.performAnimation(new Ferox.core.Animation(POOL_ANIMATION));
  Ferox.restore(player, { prayersOff: true });
  player.sendMessage("You feel reinvigorated after drinking from the pool.");
  Ferox.later(player, 1, () => player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 1));
  Ferox.later(player, POOL_BUSY_TICKS, () => player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 0));
}

module.exports = function attachPool(api) {
  api.onObjectInteraction("Pool of Refreshment", { Drink: drink });
};

Object.assign(module.exports, { drink });
