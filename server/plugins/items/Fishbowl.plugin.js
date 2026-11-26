/**
 * Fishbowls (https://oldschool.runescape.wiki/w/Fishbowl, /w/Fishbowl_(water)).
 *
 * A fishbowl of water (6668) takes one seaweed to become a fishbowl with seaweed (6669), the item
 * the Kandarin diary "Fish-in" aquarium task needs. Both have an "Empty" option (cache iop3)
 * that gives back the empty fishbowl (6667). Filling an empty bowl is plugins/world/WaterSources.
 * The Wiki and the rsprox captures give no message, sound or animation for either step, so none
 * is sent, and the Wiki does not say what becomes of the seaweed when its bowl is emptied: it is
 * lost, as the water is.
 */

let core;

const BOWL_NAME = "Fishbowl";
const SEAWEED_NAME = "Seaweed";

function ids() {
  const { ItemIdentifiers: Items } = core;
  return {
    empty: Items.EMPTY_FISHBOWL,
    water: Items.FISHBOWL,
    seaweedBowl: Items.FISHBOWL_2,
    seaweed: Items.SEAWEED,
  };
}

/** Seaweed on a fishbowl of water: one seaweed into the bowl. */
function seaweedOnBowl(event) {
  const { player, usedItemId, usedItemSlot, usedWithItemId, usedWithItemSlot } = event;
  const id = ids();
  let bowlSlot;
  let weedSlot;
  if (usedItemId === id.seaweed && usedWithItemId === id.water) {
    weedSlot = usedItemSlot;
    bowlSlot = usedWithItemSlot;
  } else if (usedItemId === id.water && usedWithItemId === id.seaweed) {
    bowlSlot = usedItemSlot;
    weedSlot = usedWithItemSlot;
  } else {
    return false;
  }
  const inventory = player.getInventory();
  inventory.setItem(weedSlot, new core.Item(-1, 0));
  inventory.setItem(bowlSlot, new core.Item(id.seaweedBowl, 1)).refreshItems();
  return true;
}

/** "Empty" on a fishbowl of water or of water and seaweed: the empty bowl is left. */
function empty(event) {
  const { player, itemId, slot } = event;
  const id = ids();
  if (itemId !== id.water && itemId !== id.seaweedBowl) return false;
  player.getInventory().setItem(slot, new core.Item(id.empty, 1)).refreshItems();
  return true;
}

module.exports = {
  name: "Fishbowl",
  description: "Seaweed on a fishbowl of water, and Empty on a fishbowl of water or seaweed.",
  members: true,
  register(api) {
    core = api.core;
    api.onItemOnItem(SEAWEED_NAME, BOWL_NAME, seaweedOnBowl, { noted: false });
    api.onItemAction(BOWL_NAME, { Empty: empty });
  },
  _test: { seaweedOnBowl, empty },
};
