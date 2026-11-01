// OSRS Wiki: each shop rune pack opens into 100 of its named rune.
function openPack(core, rune, { player, item, slot }) {
  const inventory = player.getInventory();
  if (item.getDefinition().isNoted() || inventory.forSlot(slot) !== item) return false;
  const runes = new core.Item(core.ItemIdentifiers[rune], 100);
  inventory.setItem(slot, new core.Item(-1, 0));
  if (inventory.getAddableAmount(runes) < runes.getAmount()) {
    inventory.setItem(slot, item);
    player.sendMessage("You can't hold any more of those runes.");
    return;
  }
  inventory.addItem(runes);
}

module.exports = {
  name: "RunePacks",
  register(api) {
    api.onItemAction("Air rune pack", { Open: openPack.bind(null, api.core, "AIR_RUNE") });
    api.onItemAction("Water rune pack", { Open: openPack.bind(null, api.core, "WATER_RUNE") });
    api.onItemAction("Earth rune pack", { Open: openPack.bind(null, api.core, "EARTH_RUNE") });
    api.onItemAction("Fire rune pack", { Open: openPack.bind(null, api.core, "FIRE_RUNE") });
    api.onItemAction("Mind rune pack", { Open: openPack.bind(null, api.core, "MIND_RUNE") });
    api.onItemAction("Chaos rune pack", { Open: openPack.bind(null, api.core, "CHAOS_RUNE") });
  },
};
