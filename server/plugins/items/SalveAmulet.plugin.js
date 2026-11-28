/** Salve scroll imbues: https://oldschool.runescape.wiki/w/Salve_amulet(i).
 * Nightmare Zone and Soul Wars own their separate item IDs and refunds.
 */
let api;
function conversions() {
  const I = api.core.ItemIdentifiers;
  return [[I.SALVE_AMULET, I.SALVE_AMULET_I__5], [I.SALVE_AMULET_E_, I.SALVE_AMULET_EI__5]];
}
function imbue(event) {
  if (event.handled) return;
  const I = api.core.ItemIdentifiers;
  const scroll = id => id === I.SCROLL_OF_IMBUING || id === I.SCROLL_OF_IMBUING_2;
  const first = scroll(event.usedItemId), second = scroll(event.usedWithItemId);
  if (first === second) return;
  const item = first ? event.usedWithItem : event.usedItem;
  const scrollItem = first ? event.usedItem : event.usedWithItem;
  const pair = conversions().find(([base]) => base === item?.getId());
  if (!pair) return;
  const inventory = event.player.getInventory();
  if (!inventory.getItems().includes(item) || !inventory.getItems().includes(scrollItem) || scrollItem.getAmount() < 1) return;
  inventory.deleteNumber(scrollItem.getId(), 1);
  item.setId(pair[1]);
  inventory.refreshItems();
  event.handled = true;
  event.player.sendMessage("You imbue the salve amulet with the scroll.");
}
function removeImbue(player, item, slot) {
  const inventory = player.getInventory();
  const pair = conversions().find(([, imbued]) => imbued === item.getId());
  if (!pair || inventory.getItems()[slot] !== item) return;
  const scroll = new api.core.Item(api.core.ItemIdentifiers.SCROLL_OF_IMBUING, 1);
  if (inventory.getAddableAmount(scroll) < 1) { inventory.full(); return; }
  inventory.add(scroll, false);
  item.setId(pair[0]);
  inventory.refreshItems();
}
function uncharge({ player, item }) {
  if (!conversions().some(([, id]) => id === item?.getId())) return false;
  const slot = player.getInventory().getItems().indexOf(item);
  if (slot < 0) return false;
  api.sendMultiChatboxPrompt(player, "Remove the imbue?", "Yes.", () => removeImbue(player, item, slot), "No.", () => {});
  return true;
}
module.exports = {
  name: "SalveAmulet",
  description: "Salve amulet scroll imbuing and returning the scroll on uncharge.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onItemOnItem(imbue, { noted: false });
    api.onItemAction("Salve amulet(i)", { Uncharge: uncharge });
    api.onItemAction("Salve amulet(ei)", { Uncharge: uncharge });
  },
};
