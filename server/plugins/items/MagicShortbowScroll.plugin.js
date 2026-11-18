let core;

function imbue({ player, usedItem, usedWithItem, usedItemSlot, usedWithItemSlot }) {
  const { MAGIC_SHORTBOW, MAGIC_SHORTBOW_SCROLL, MAGIC_SHORTBOW_I_ } = core.ItemIdentifiers;
  const scrollFirst = usedItem.getId() === MAGIC_SHORTBOW_SCROLL;
  const scroll = scrollFirst ? usedItem : usedWithItem;
  const bow = scrollFirst ? usedWithItem : usedItem;
  const scrollSlot = scrollFirst ? usedItemSlot : usedWithItemSlot;
  const bowSlot = scrollFirst ? usedWithItemSlot : usedItemSlot;
  if (scroll.getId() !== MAGIC_SHORTBOW_SCROLL || bow.getId() !== MAGIC_SHORTBOW) return false;

  const inventory = player.getInventory();
  const items = inventory.getItems();
  if (items[scrollSlot] !== scroll || items[bowSlot] !== bow || bow.getAmount() !== 1) return false;
  if ([scroll, bow].some((item) => item.isPresetItem() || item.isUntradeable() || item.isUnbankable())) {
    player.sendMessage("You cannot use restricted items to imbue a magic shortbow.");
    return true;
  }

  inventory.deleteAtSlot(scrollSlot, 1, false);
  bow.setId(MAGIC_SHORTBOW_I_);
  inventory.refreshItems();
  player.sendMessage("You imbue your magic shortbow.");
  return true;
}

module.exports = {
  name: "MagicShortbowScroll",
  description: "Imbue a magic shortbow by using a magic shortbow scroll on it.",
  members: true,
  register(api) {
    core = api.core;
    api.onItemOnItem("Magic shortbow scroll", "Magic shortbow", imbue, { noted: false });
  },
};
