/**
 * Coconut milk, the base of antidote+, antidote++ and weapon poison(+)/(++) (herblore.json's vial_coconut_milk).
 *
 * Wiki (Coconut, Half coconut, Coconut milk; members):
 * - "A hammer can be used on a coconut to create a half coconut." 0 ticks, no level or XP; since 21 February 2019
 *   "the process of splitting open coconuts will automatically continue once start[ed]".
 * - A half coconut "can be used on an empty vial": a vial of coconut milk and a coconut shell, 0 ticks, no XP.
 * No rsprox recording makes either and no page quotes a message, so both are silent. The continuing split is one
 * coconut a tick until none are left or the hammer goes, as a task keyed to the player (a walk or click stops it).
 */
const Common = require("./Common.Herblore");

const obj = (name) => Common.gameval("obj", name);

/** Hammer on a coconut (either way round): the clicked coconut splits now, the rest one a tick. */
function splitCoconut(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const hammer = obj("hammer"), coconut = obj("coconut");
  if (!((usedItemId === hammer && usedWithItemId === coconut) || (usedItemId === coconut && usedWithItemId === hammer))) return false;
  event.handled = true;
  if (!Common.core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("To use this item please login to a members' world.");
    return true;
  }
  Common.core.TaskManager.cancelTasks(player.getIndex());
  const split = () => {
    const inventory = player.getInventory();
    if (!inventory.contains(hammer)) return false;
    const slot = inventory.getItems().findIndex((item) => item?.getId() === coconut && !Common.restricted(item));
    if (slot < 0) return false;
    inventory.setItem(slot, new Common.core.Item(obj("coconut_half"), 1));
    inventory.refreshItems();
    return true;
  };
  if (split()) Common.run(player, () => split());
  return true;
}

/** Half coconut on an empty vial (either way round): coconut milk in the vial's slot, a shell in the half's. */
function pourMilk(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const half = obj("coconut_half"), vial = obj("vial_empty");
  if (!((usedItemId === half && usedWithItemId === vial) || (usedItemId === vial && usedWithItemId === half))) return false;
  event.handled = true;
  const inventory = player.getInventory();
  const halfSlot = usedItemId === half ? event.usedItemSlot : event.usedWithItemSlot;
  const vialSlot = usedItemId === vial ? event.usedItemSlot : event.usedWithItemSlot;
  if (inventory.forSlot(halfSlot)?.getId() !== half || inventory.forSlot(vialSlot)?.getId() !== vial) return true;
  if (Common.restricted(inventory.forSlot(halfSlot)) || Common.restricted(inventory.forSlot(vialSlot))) {
    player.sendMessage(Common.PRESET_REFUSAL);
    return true;
  }
  inventory.setItem(vialSlot, new Common.core.Item(obj("vial_coconut_milk"), 1));
  inventory.setItem(halfSlot, new Common.core.Item(obj("coconut_shell"), 1));
  inventory.refreshItems();
  return true;
}

module.exports = function attachCoconut(api) {
  api.onItemOnItem((event) => splitCoconut(event) || pourMilk(event), { noted: false });
};
