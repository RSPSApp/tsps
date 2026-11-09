/**
 * Lightbearer (https://oldschool.runescape.wiki/w/Lightbearer).
 *
 * Special-attack energy restores every 50 ticks; while the ring is worn it
 * restores at double the rate, every 25 ticks. Putting the ring on restarts the
 * restore timer at 25 ticks only when more than that is left of it; taking it off
 * always restarts the full 50-tick timer. Facts: docs/special-attack-energy.md.
 */
let core;

/** Whether each player wore the ring at their last equipment change. */
const wornLightbearer = new WeakMap();

function wearsLightbearer(player) {
  const { Equipment, ItemIdentifiers } = core;
  const ringId = Number(player.getEquipment().get(Equipment.RING_SLOT)?.getId?.());
  return ringId === ItemIdentifiers.LIGHTBEARER || ringId === ItemIdentifiers.LIGHTBEARER_2;
}

function restoreDelay(entity, delayTicks) {
  if (!entity?.isPlayer?.()) {
    return delayTicks;
  }
  return wearsLightbearer(entity.getAsPlayer()) ? delayTicks / 2 : delayTicks;
}

/** Restarts the restore timer when the ring goes on or comes off. */
function restartTimerOnSwap({ player }) {
  const worn = wearsLightbearer(player);
  const previous = wornLightbearer.get(player);
  wornLightbearer.set(player, worn);
  if (previous === undefined || previous === worn) return;
  const { CombatSpecial } = core;
  const period = CombatSpecial.restoreDelayTicks(player);
  if (worn && CombatSpecial.restoreTicksRemaining(player) <= period) return;
  CombatSpecial.restartRestoreTimer(player, period);
}

function rememberOnLogin({ player }) {
  wornLightbearer.set(player, wearsLightbearer(player));
}

module.exports = {
  name: "Lightbearer",
  description: "Makes a worn Lightbearer ring restore special attack energy every 25 ticks instead of every 50.",
  members: true,
  _test: { restoreDelay, restartTimerOnSwap },
  register(api) {
    core = api.core;
    api.registerSpecialEnergyRestoreModifier(restoreDelay);
    api.onCustomEvent("equipment:changed", restartTimerOnSwap);
    api.onPlayerLogin(rememberOnLogin);
  },
};
