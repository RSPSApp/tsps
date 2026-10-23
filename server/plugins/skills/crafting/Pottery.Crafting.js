/**
 * Soft clay, the potter's wheel and the pottery oven.
 *
 * Wiki (Crafting#Pottery): soft clay is shaped on a potter's wheel and the unfired piece
 * fired in a pottery oven, which has no Crafting level requirement. One soft clay shapes four
 * unfired cups. One Small Favour teaches and fires pot lids itself.
 * ponytail: firing always succeeds; the crack chance below level 14 can be added with the
 * wiki's success curve if failing pottery ever matters.
 */
const Shared = require("./Shared.Crafting");

const POTTER_WHEEL_NAMES = new Set(["Potter's Wheel", "Potter's wheel"]);
const POTTERY_OVEN_NAMES = new Set(["Pottery Oven"]);

let tables = null;

/** The pottery recipes and water containers from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { Animation } = Shared.getCore();
  const { pottery } = Shared.DATA;
  const recipes = pottery.recipes.map((recipe) => ({
    ...recipe, unfiredId: Shared.itemId(recipe.unfired), firedId: Shared.itemId(recipe.fired),
  }));
  return tables = {
    pottery: recipes,
    byUnfired: new Map(recipes.map((recipe) => [recipe.unfiredId, recipe])),
    // Wiki (Soft clay): a container of water on clay makes soft clay and leaves it empty.
    waterContainers: new Map(pottery.waterContainers.map(([full, empty]) => [Shared.itemId(full), Shared.itemId(empty)])),
    wheelAnimation: new Animation(pottery.seq),
  };
}

/** Using a container of water on clay softens it and returns the empty container. */
function makeSoftClay(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const { ItemIds: I, Item } = Shared.getCore();
  const { waterContainers } = data();
  const waterId = waterContainers.has(usedItemId) ? usedItemId : usedWithItemId;
  const clayId = usedItemId === I.CLAY ? usedItemId : usedWithItemId;
  if (!waterContainers.has(waterId) || clayId !== I.CLAY) return;

  const inventory = player.getInventory();
  if (!inventory.contains(I.CLAY) || !inventory.contains(waterId)) {
    event.handled = true;
    return;
  }
  inventory.deleteNumber(I.CLAY, 1);
  inventory.deleteNumber(waterId, 1);
  inventory.addItem(new Item(I.SOFT_CLAY, 1));
  inventory.addItem(new Item(waterContainers.get(waterId), 1));
  event.handled = true;
}

function craftUnfired(player, recipe) {
  const { ItemIds: I, Item } = Shared.getCore();
  const inventory = player.getInventory();
  if (!inventory.contains(I.SOFT_CLAY)) return;
  player.performAnimation(data().wheelAnimation);
  inventory.deleteNumber(I.SOFT_CLAY, 1);
  inventory.addItem(new Item(recipe.unfiredId, recipe.shaped ?? 1));
  Shared.addCraftingXp(player, recipe.shapingXp);
}

/** Wheel Use (or soft clay used on it): shape one soft clay into an unfired item. */
function usePotterWheel(event) {
  const { player } = event;
  event.handled = true;
  if (!player.getInventory().contains(Shared.getCore().ItemIds.SOFT_CLAY)) {
    player.sendMessage("You need soft clay to make pottery.");
    return;
  }
  const craftingLevel = Shared.craftingLevel(player);
  const recipes = Shared.available(data().pottery).filter((recipe) => craftingLevel >= recipe.level);
  if (recipes.length === 1) {
    craftUnfired(player, recipes[0]);
    return;
  }
  Shared.getApi().sendMultiChatboxPrompt(
    player,
    "What would you like to make?",
    ...recipes.flatMap((recipe) => [recipe.name, () => craftUnfired(player, recipe)])
  );
}

function firePottery(player, recipe) {
  const { Item } = Shared.getCore();
  const inventory = player.getInventory();
  if (!inventory.contains(recipe.unfiredId)) return;
  inventory.deleteNumber(recipe.unfiredId, 1);
  inventory.addItem(new Item(recipe.firedId, 1));
  Shared.addCraftingXp(player, recipe.firingXp);
}

/** Oven Fire (or an unfired item used on it): fire one unfired item, no level needed. */
function usePotteryOven(event) {
  const { player } = event;
  event.handled = true;
  const inventory = player.getInventory();
  const recipes = data().pottery.filter((recipe) => inventory.contains(recipe.unfiredId));
  if (recipes.length === 0) {
    player.sendMessage("You have no unfired pottery to fire.");
    return;
  }
  if (recipes.length === 1) {
    firePottery(player, recipes[0]);
    return;
  }
  Shared.getApi().sendMultiChatboxPrompt(
    player,
    "What would you like to fire?",
    ...recipes.flatMap((recipe) => [recipe.name, () => firePottery(player, recipe)])
  );
}

/** Soft clay on a wheel, unfired pottery on a pottery oven. */
function handlePotteryItemOnObject(event) {
  const objectName = event.object?.getDefinition?.()?.getName?.();
  const { byUnfired } = data();
  if (POTTER_WHEEL_NAMES.has(objectName) && event.itemId === Shared.getCore().ItemIds.SOFT_CLAY) {
    usePotterWheel(event);
  } else if (POTTERY_OVEN_NAMES.has(objectName) && byUnfired.has(event.itemId)) {
    event.handled = true;
    firePottery(event.player, byUnfired.get(event.itemId));
  }
}

module.exports = function attach(api) {
  api.onItemOnItem(makeSoftClay, { noted: false });
  api.onItemOnObject(handlePotteryItemOnObject, { noted: false });
  api.onObjectInteraction("Potter's Wheel", { Use: usePotterWheel });
  api.onObjectInteraction("Potter's wheel", { Use: usePotterWheel });
  api.onObjectInteraction("Pottery Oven", { Fire: usePotteryOven });
};
