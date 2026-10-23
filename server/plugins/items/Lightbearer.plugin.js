/**
 * Lightbearer (https://oldschool.runescape.wiki/w/Lightbearer).
 *
 * Special-attack energy restores every 50 ticks; while the ring is worn it
 * restores at double the rate, every 25 ticks.
 */
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const LIGHTBEARER_IDS = new Set([ItemIdentifiers.LIGHTBEARER, ItemIdentifiers.LIGHTBEARER_2]);

function restoreDelay(entity, delayTicks) {
  if (!entity?.isPlayer?.()) {
    return delayTicks;
  }
  const ringId = entity.getAsPlayer().getEquipment().get(Equipment.RING_SLOT)?.getId?.();
  return LIGHTBEARER_IDS.has(Number(ringId)) ? delayTicks / 2 : delayTicks;
}

module.exports = {
  name: "Lightbearer",
  members: true,
  _test: { restoreDelay, LIGHTBEARER_IDS },
  register(api) {
    api.registerSpecialEnergyRestoreModifier(restoreDelay);
  },
};
