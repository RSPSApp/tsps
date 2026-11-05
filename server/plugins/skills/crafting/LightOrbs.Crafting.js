/**
 * Complete an empty light orb with cave goblin wire (Wiki:
 * https://oldschool.runescape.wiki/w/Empty_light_orb). The 87 Crafting requirement, 104 XP,
 * materials, and product come from the Wiki; the cache contains all four items. The skill action
 * also exposes a focused event for Sherlock's Dorgesh-Kaan task.
 */
const Shared = require("./Shared.Crafting");

const CRAFTING_LEVEL = 87;
const CRAFTING_XP = 104;

function makeLightOrb(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const { ItemIds: I, Item } = Shared.getCore();
  const pair = new Set([usedItemId, usedWithItemId]);
  if (!pair.has(I.EMPTY_LIGHT_ORB) || !pair.has(I.CAVE_GOBLIN_WIRE) || !Shared.isMembersWorld()) return;

  event.handled = true;
  Shared.stopCrafting(player);
  if (Shared.craftingLevel(player) < CRAFTING_LEVEL) {
    player.sendMessage(`You need a Crafting level of ${CRAFTING_LEVEL} to do that.`);
    return;
  }

  const inventory = player.getInventory();
  if (!inventory.contains(I.EMPTY_LIGHT_ORB) || !inventory.contains(I.CAVE_GOBLIN_WIRE)) return;
  inventory.deleteNumber(I.EMPTY_LIGHT_ORB, 1);
  inventory.deleteNumber(I.CAVE_GOBLIN_WIRE, 1);
  inventory.addItem(new Item(I.LIGHT_ORB, 1));
  Shared.addCraftingXp(player, CRAFTING_XP);
  Shared.produced(player, I.LIGHT_ORB, 1, CRAFTING_XP, "light-orb", [[I.EMPTY_LIGHT_ORB, 1], [I.CAVE_GOBLIN_WIRE, 1]]);
  Shared.getApi().emitCustomEvent("crafting:light-orb-made", { player, itemId: I.LIGHT_ORB });
}

module.exports = function attach(api) {
  api.onItemOnItem(makeLightOrb, { noted: false });
};
