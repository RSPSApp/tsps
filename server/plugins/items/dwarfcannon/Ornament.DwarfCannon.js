/**
 * The shattered cannon ornament kit (Wiki): one kit on each cannon part makes its (or) version;
 * "Dismantle" gives the part and the kit back. Ornament and plain parts don't mix in a cannon.
 */
const Cannon = require("./Common.DwarfCannon");

/** Ours (not captured). */
const NO_SPACE = "You need a free inventory slot to dismantle that.";

function applyKit(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const kit = Cannon.core.ItemIdentifiers.SHATTERED_CANNON_ORNAMENT_KIT;
  const partId = usedItemId === kit ? usedWithItemId : usedItemId;
  const index = Cannon.KINDS.plain.parts.indexOf(partId);
  if (index < 0) return false;
  const inventory = player.getInventory();
  inventory.delete(kit, 1);
  inventory.delete(partId, 1);
  inventory.add(new Cannon.core.Item(Cannon.KINDS.ornament.parts[index], 1), true);
  return true;
}

function dismantle({ player, itemId, slot }) {
  const index = Cannon.KINDS.ornament.parts.indexOf(itemId);
  if (index < 0) return false;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  inventory.deleteAtSlot(slot, 1);
  inventory.add(new Cannon.core.Item(Cannon.KINDS.plain.parts[index], 1), true);
  inventory.add(new Cannon.core.Item(Cannon.core.ItemIdentifiers.SHATTERED_CANNON_ORNAMENT_KIT, 1), true);
  return true;
}

module.exports = function attachOrnament(api) {
  api.onItemOnItem("Shattered cannon ornament kit", "Cannon base", applyKit);
  api.onItemOnItem("Shattered cannon ornament kit", "Cannon stand", applyKit);
  api.onItemOnItem("Shattered cannon ornament kit", "Cannon barrels", applyKit);
  api.onItemOnItem("Shattered cannon ornament kit", "Cannon furnace", applyKit);
  api.onItemAction("Cannon base (or)", { Dismantle: dismantle });
  api.onItemAction("Cannon stand (or)", { Dismantle: dismantle });
  api.onItemAction("Cannon barrels (or)", { Dismantle: dismantle });
  api.onItemAction("Cannon furnace (or)", { Dismantle: dismantle });
};

Object.assign(module.exports, { applyKit, dismantle });
