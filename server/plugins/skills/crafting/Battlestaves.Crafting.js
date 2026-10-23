/**
 * Battlestaves: a charged orb used on a battlestaff, in either order.
 *
 * Wiki (Crafting#Battlestaves and silver bolts, Water battlestaff ...): levels and XP; the
 * first staff takes 3 ticks after the choice and each one after it 2. No capture, so the menu
 * follows the other item-on-item Crafting menus and no message is sent.
 */
const Shared = require("./Shared.Crafting");

const BATTLESTAFF_MENU_TITLE = "How many do you wish to make?";
const BATTLESTAFF_MENU_MODE = 0;

let tables = null;

/** The battlestaff recipes from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { Animation } = Shared.getCore();
  const { battlestaves } = Shared.DATA;
  return tables = {
    staves: new Map(battlestaves.recipes.map((recipe) => {
      const orbId = Shared.itemId(recipe.orb);
      return [orbId, { ...recipe, orbId, itemId: Shared.itemId(recipe.item) }];
    })),
    animation: new Animation(battlestaves.seq),
  };
}

function hasMaterials(player, recipe) {
  const inventory = player.getInventory();
  return inventory.contains(recipe.orbId) && inventory.contains(Shared.getCore().ItemIds.BATTLESTAFF);
}

function makeStaff(player, recipe) {
  const { ItemIds: I, Item } = Shared.getCore();
  if (!hasMaterials(player, recipe)) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(recipe.orbId, 1);
  inventory.deleteNumber(I.BATTLESTAFF, 1);
  inventory.addItem(new Item(recipe.itemId, 1));
  Shared.addCraftingXp(player, recipe.xp);
  return true;
}

function startStaves(player, recipe, amount) {
  if (Shared.craftingLevel(player) < recipe.level) {
    // ponytail: not captured; follows the glassblowing message.
    player.sendMessage(`You need level ${recipe.level} Crafting to make ${Shared.withArticle(Shared.itemName(recipe.itemId).toLowerCase())}.`);
    return;
  }
  Shared.startMaking(player, {
    amount, startTick: 0, firstTick: 3, interval: 2, animation: data().animation,
    has: () => hasMaterials(player, recipe),
    make: () => makeStaff(player, recipe),
  });
}

function attachOrb(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const I = Shared.getCore().ItemIds;
  const orbId = usedItemId === I.BATTLESTAFF ? usedWithItemId : usedWithItemId === I.BATTLESTAFF ? usedItemId : null;
  const recipe = data().staves.get(orbId);
  if (!recipe || !Shared.isMembersWorld()) return;
  event.handled = true;
  const inventory = player.getInventory();
  Shared.stopCrafting(player);
  Shared.openMakeMenu(player, {
    title: BATTLESTAFF_MENU_TITLE,
    mode: BATTLESTAFF_MENU_MODE,
    items: [recipe],
    maxAmount: Math.min(inventory.getAmount(recipe.orbId), inventory.getAmount(I.BATTLESTAFF)),
    choose: (chosen, amount) => startStaves(player, chosen, amount),
  });
}

module.exports = function attach(api) {
  api.onItemOnItem(attachOrb, { noted: false });
};
