/**
 * The Nightmare staff's orbs (Wiki: Nightmare staff, Harmonised/Eldritch/Volatile nightmare staff).
 *
 * Combining: a Harmonised, Eldritch or Volatile orb used on the Nightmare staff (either way round)
 * makes that orb's staff, with "You add the orb to the staff." The Wiki lists no skill or quest
 * requirement for it; the 82 Magic is to wield the result. The upgraded staff takes the Nightmare
 * staff's slot and the orb's slot is emptied. The Wiki gives the Harmonised creation as 2 ticks;
 * no animation or delay is known, so it is done at once.
 *
 * Dismantle (Wiki: "it can be reverted to its tradeable components at any time"; the item pages'
 * transcript has "You remove the orb from the staff.") for the Eldritch and Volatile staves, the same
 * way HarmonisedNightmareStaff.plugin.js does the Harmonised one: the staff's slot takes the
 * Nightmare staff, a free slot the orb.
 *
 * Preset (and other untradeable or unbankable) copies are refused both ways, so a free preset staff
 * or orb can't be turned into tradeable parts.
 */
const ADD_TEXT = "You add the orb to the staff.";
const REMOVE_TEXT = "You remove the orb from the staff.";
const PRESET_TEXT = "Preset items cannot be used for this.";

let core;

/** Each orb, by its cache name, and the staff it makes. */
function orbs() {
  const I = core.ItemIdentifiers;
  return [
    { orbName: "Harmonised orb", orb: I.HARMONISED_ORB, staff: I.HARMONISED_NIGHTMARE_STAFF },
    { orbName: "Eldritch orb", orb: I.ELDRITCH_ORB, staff: I.ELDRITCH_NIGHTMARE_STAFF },
    { orbName: "Volatile orb", orb: I.VOLATILE_ORB, staff: I.VOLATILE_NIGHTMARE_STAFF },
  ];
}

function restricted(item) {
  const { Item } = core;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

/** The orb used on the Nightmare staff, or the staff on the orb: swaps the pair for the orb's staff. */
function combine(event) {
  const { player } = event;
  const I = core.ItemIdentifiers;
  const usedIsStaff = event.usedItemId === I.NIGHTMARE_STAFF;
  const staffItem = usedIsStaff ? event.usedItem : event.usedWithItem;
  const orbItem = usedIsStaff ? event.usedWithItem : event.usedItem;
  const staffSlot = usedIsStaff ? event.usedItemSlot : event.usedWithItemSlot;
  const orbSlot = usedIsStaff ? event.usedWithItemSlot : event.usedItemSlot;
  const entry = orbs().find(({ orb }) => orb === orbItem?.getId?.());
  if (!entry || staffItem?.getId?.() !== I.NIGHTMARE_STAFF) return false;

  const inventory = player.getInventory();
  const items = inventory.getItems();
  // Both must still be where the use said they were.
  if (items[staffSlot] !== staffItem || items[orbSlot] !== orbItem) return false;
  if (restricted(staffItem) || restricted(orbItem)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  inventory.deleteAtSlot(orbSlot, 1, false);
  inventory.setItem(staffSlot, new core.Item(entry.staff, 1));
  inventory.refreshItems();
  player.sendMessage(ADD_TEXT);
  return true;
}

/** Dismantle: the staff's own slot takes the Nightmare staff, a free slot the orb. */
function dismantle({ player, item }) {
  const { Item, ItemIdentifiers } = core;
  const entry = orbs().find(({ staff }) => staff === item?.getId?.());
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (!entry || slot < 0) return false;
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  if (inventory.getFreeSlots() < 1) {
    inventory.full();
    return true;
  }
  inventory.setItem(slot, new Item(ItemIdentifiers.NIGHTMARE_STAFF, 1));
  inventory.add(new Item(entry.orb, 1), false);
  inventory.refreshItems();
  player.sendMessage(REMOVE_TEXT);
  return true;
}

module.exports = {
  name: "NightmareStaffOrbs",
  description: "Adds the Harmonised, Eldritch and Volatile orbs to the Nightmare staff, and dismantles the Eldritch and Volatile staves back into the staff and orb.",
  members: true,
  register(api) {
    core = api.core;
    for (const { orbName } of orbs()) api.onItemOnItem("Nightmare staff", orbName, combine, { noted: false });
    api.onItemAction("Eldritch Nightmare staff", { Dismantle: dismantle });
    api.onItemAction("Volatile Nightmare staff", { Dismantle: dismantle });
  },
  _test: { combine, dismantle, ADD_TEXT, REMOVE_TEXT },
};
