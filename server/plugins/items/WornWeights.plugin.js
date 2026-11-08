"use strict";

/**
 * Items that weigh less once worn (Wiki: Boots of lightness, Penance gloves; Weight). The cache keeps the worn weight on
 * a separate item - boots of lightness 88 weigh 0.34 kg and 89 -4.535 kg, penance gloves 10553 / 10554 the same - and
 * nothing swaps the id on equip, so the worn total used the inventory weight. Answering "equipment:weights" gives the
 * equipment panel, the run-energy packet and the drain the worn weight (as GracefulOutfit does for graceful).
 */
const WORN_WEIGHT_ID = new Map([
  [88, 89], // Boots of lightness
  [10553, 10554], // Penance gloves
]);

let core;

function addWornWeights(request) {
  const player = request?.player;
  if (!player || !request.slotWeights) return;
  const equipment = player.getEquipment().getItems();
  for (let slot = 0; slot < equipment.length; slot++) {
    const wornId = WORN_WEIGHT_ID.get(equipment[slot]?.getId?.());
    if (wornId === undefined || Number.isFinite(request.slotWeights[slot])) continue;
    request.slotWeights[slot] = core.ItemDefinition.forId(wornId).getWeight() / 1000;
  }
}

module.exports = {
  name: "WornWeights",
  register(api) {
    core = api.core;
    api.onCustomEvent("equipment:weights", addWornWeights);
  },
  _test: { WORN_WEIGHT_ID, addWornWeights },
};
