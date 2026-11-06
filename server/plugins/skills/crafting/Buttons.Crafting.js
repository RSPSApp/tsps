// https://oldschool.runescape.wiki/w/Buttons: level 3, 5 XP, one pair per Polish.
const Shared = require("./Shared.Crafting");

function polish({ player, itemId, slot }) {
  if (!Shared.isMembersWorld()) return false;
  const { ItemIds } = Shared.getCore();
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (itemId !== ItemIds.BUTTONS || item?.getId() !== itemId) return false;
  if (Shared.craftingLevel(player) < 3) {
    Shared.spam(player, "You rub the buttons on your clothes but they aren't improved by the process.");
    return true;
  }
  item.setId(ItemIds.POLISHED_BUTTONS);
  inventory.refreshItems();
  Shared.addCraftingXp(player, 5);
  Shared.spam(player, "You rub the buttons on your clothes and they become more shiny.");
  return true;
}

module.exports = function attach(api) {
  api.onItemAction("Buttons", { Polish: polish });
};
