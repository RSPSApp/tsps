/**
 * Blowing molten glass with a glassblowing pipe.
 *
 * rsprox capture (recording 1842): the pipe on molten glass, in either order, opens skillmulti
 * mode 0, "How many do you wish to make?", with all eight items whatever the player's level.
 * Choosing one above it answers "You need level 87 Crafting to make a light orb." and makes
 * nothing. Otherwise human_glassblowing and sound 2724 start at once, and every 3 ticks from
 * the second the player makes one ("You make a beer glass."), the animation and sound replayed.
 *
 * Wiki (Crafting#Glass): levels and XP; every item is members. Recipes in data/crafting.json.
 */
const Shared = require("./Shared.Crafting");

const GLASS_MENU_TITLE = "How many do you wish to make?";
const GLASS_MENU_MODE = 0;

let tables = null;

/** The glassblowing recipes from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { Animation, Sound } = Shared.getCore();
  const { glassblowing } = Shared.DATA;
  return tables = {
    recipes: glassblowing.recipes.map((recipe) => ({ ...recipe, itemId: Shared.itemId(recipe.item) })),
    animation: new Animation(glassblowing.seq),
    sound: new Sound(glassblowing.sound, 1, glassblowing.soundDelay, 0),
  };
}

function hasGlass(player) {
  const I = Shared.getCore().ItemIds;
  const inventory = player.getInventory();
  return inventory.contains(I.GLASSBLOWING_PIPE) && inventory.contains(I.MOLTEN_GLASS);
}

function blowOne(player, recipe) {
  const { ItemIds: I, Item } = Shared.getCore();
  if (!hasGlass(player)) return false;
  player.getInventory().deleteNumber(I.MOLTEN_GLASS, 1);
  player.getInventory().addItem(new Item(recipe.itemId, 1));
  Shared.addCraftingXp(player, recipe.xp);
  player.sendMessage(`You make ${Shared.withArticle(recipe.name)}.`);
  return true;
}

function startBlowing(player, recipe, amount) {
  if (Shared.craftingLevel(player) < recipe.level) {
    player.sendMessage(`You need level ${recipe.level} Crafting to make ${Shared.withArticle(recipe.name)}.`);
    return;
  }
  const { animation, sound } = data();
  Shared.startMaking(player, {
    amount, startTick: 0, firstTick: 2, interval: 3, animation, sound,
    has: () => hasGlass(player),
    make: () => blowOne(player, recipe),
  });
}

function blowGlass(event) {
  const I = Shared.getCore().ItemIds;
  const ids = new Set([event.usedItemId, event.usedWithItemId]);
  if (!ids.has(I.GLASSBLOWING_PIPE) || !ids.has(I.MOLTEN_GLASS) || !Shared.isMembersWorld()) return;
  event.handled = true;
  const { player } = event;
  Shared.stopCrafting(player);
  Shared.openMakeMenu(player, {
    title: GLASS_MENU_TITLE,
    mode: GLASS_MENU_MODE,
    items: data().recipes,
    maxAmount: player.getInventory().getAmount(I.MOLTEN_GLASS),
    choose: (recipe, amount) => startBlowing(player, recipe, amount),
  });
}

module.exports = function attach(api) {
  api.onItemOnItem(blowGlass, { noted: false });
};
