/**
 * Pickable scenery: Wheat, Flax and Nettles.
 *
 * Each entry picks one item with the shared flax picking animation (827).
 * The yielded item comes from ItemIdentifiers. Matched by object name + "Pick"
 * so decorative variants without the option fall through.
 */
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const PICK_ANIMATION = 827;

const PICKABLES = [
  { name: "Wheat", itemId: ItemIdentifiers.GRAIN, message: "You pick some wheat." },
  { name: "Flax", itemId: ItemIdentifiers.FLAX, message: "You pick some flax." },
  { name: "Nettles", itemId: ItemIdentifiers.NETTLES, message: "You pick the nettles." },
];

function pick(player, pickable) {
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("Your inventory is too full to hold any more.");
    return;
  }
  player.performAnimation(new Animation(PICK_ANIMATION));
  player.getInventory().adds(pickable.itemId, 1);
  player.sendMessage(pickable.message);
}

module.exports = {
  name: "Pickable",
  register(api) {
    for (const pickable of PICKABLES) {
      const handler = (event) => pick(event.player, pickable);
      api.onObjectInteraction(pickable.name, {
        Pick: handler,
        pick: handler,
        "pick-flax": handler,
      });
    }
  },
};
