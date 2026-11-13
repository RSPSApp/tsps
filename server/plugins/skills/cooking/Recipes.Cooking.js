/**
 * Using one ingredient on another: flour and water into the four doughs, pastry dough into a pie
 * dish, the pie fillings and part pies, and the pizza steps and toppings. Recipes, levels and XP
 * are the Wiki's (plugins/skills/data/cooking.json); the menus, lines and timing are from rsprox
 * captures (recordings 75, 564, 1858). None of these steps plays an animation or sound.
 */
const Common = require("./Common.Cooking");
const FreeToPlay = require("../../modes/FreeToPlay.plugin");

/** The dough menu (rsprox captures): all four doughs, whatever the player's level. */
const DOUGH_TITLE = "What sort of dough do you wish to make?";
const MAKE_TITLE = "How many do you wish to make?";
/** clientscript skillmulti_setup's first argument on every captured dough, pie and wine menu. */
const MAKE_MENU_MODE = 0;
/**
 * Ticks before each item (rsprox captures): a dough a tick after the choice, the next a tick
 * after that and the rest every 2; a pie shell, filling or pizza step a tick after the choice
 * and then every 2. The last value repeats.
 */
const DOUGH_TIMING = [1, 1, 2];
const NO_SPACE_FOR_DOUGH_MESSAGE = "You don't have enough inventory space to make any dough.";
/** Half made bowl (chocolate bomb), whose cache gameval name is shared by other bowls. */
const CHOCOLATE_BOMB_BOWL = 9563;

function hasIngredients(inventory, recipe) {
  return recipe.ingredients.every(({ id, count }) => inventory.getAmount(id) >= count);
}

/** Room for what one item gives back: the dough, its pot and the emptied container need a slot more than flour and water. */
function freedSlots(inventory, ingredient) {
  const held = inventory.getAmount(ingredient.id);
  if (held <= 0) return 0;
  // A stack keeps its slot unless the recipe takes the whole stack. Treating every
  // ingredient as freeing one slot loses the returned pot when swamp tar is stacked.
  if (Common.core.ItemDefinition.forId(ingredient.id)?.isStackable?.()) return held <= ingredient.count ? 1 : 0;
  return Math.min(ingredient.count, held);
}

function hasRoom(inventory, recipe) {
  const freed = recipe.ingredients.reduce((slots, ingredient) => slots + freedSlots(inventory, ingredient), 0);
  return inventory.getFreeSlots() >= 1 + recipe.returns.length - freed;
}

/** How many of the recipe the inventory holds the ingredients for. */
function makeable(inventory, recipe) {
  return Math.min(...recipe.ingredients.map(({ id, count }) => Math.floor(inventory.getAmount(id) / count)));
}

function productName(recipe) {
  return Common.core.ItemDefinition.forId(recipe.productId).getName().toLowerCase();
}

/**
 * A recipe is members-only when its product is (cache definition), so a first step made only from
 * free items (a trout on a pie shell) is refused on a free world too. A row's own `members` field
 * overrides the cache when the two disagree.
 */
function isMembersRecipe(recipe) {
  return recipe.members ?? Common.core.CacheDefinitions.getItem(recipe.productId).isMembers === true;
}

function availableOnWorld(recipe) {
  return Common.core.WorldDefinition.isMembersWorld() || !isMembersRecipe(recipe);
}

/** Whether the player can make the recipe; says why not when it is members-only here or the level is too low. */
function canMake(player, recipe) {
  if (!availableOnWorld(recipe)) {
    player.sendMessage(FreeToPlay.ITEM_MESSAGE);
    return false;
  }
  if (Common.level(player) >= recipe.level) return true;
  Common.mesbox(player, `You need a Cooking level of ${recipe.level} to make ${Common.withArticle(productName(recipe))}.`);
  return false;
}

/** One item: the ingredients go, the product (and any emptied containers) come, with any XP. */
function makeOne(player, recipe) {
  const { Item, Skill } = Common.core;
  const inventory = player.getInventory();
  if (!availableOnWorld(recipe) || !hasIngredients(inventory, recipe)) return false;
  if (!hasRoom(inventory, recipe)) {
    inventory.full();
    return false;
  }
  for (const { id, count } of recipe.ingredients) inventory.deleteNumber(id, count);
  inventory.addItem(new Item(recipe.productId, 1));
  for (const { id, count } of recipe.returns) inventory.addItem(new Item(id, count));
  if (recipe.message) Common.spam(player, recipe.message);
  Common.addXp(player, recipe.xp);
  Common.api.emitCustomEvent("skills:produced", { player, skill: Skill.COOKING, itemId: recipe.productId, amount: 1, xp: recipe.xp, kind: "make" });
  return true;
}

/**
 * Makes `amount` on the recipe's timing. `hooks.cycle(remaining)` runs as each item is started
 * (the choice, then each item that has another after it), `hooks.canMake()` before spending
 * each item's ingredients, `hooks.made()` after each item and
 * `hooks.done()` after the last one made.
 */
function start(player, recipe, amount, hooks = {}) {
  Common.core.TaskManager.cancelTasks(player.getIndex());
  if (hooks.canMake?.() === false) return;
  let remaining = amount;
  let made = 0;
  let wait = recipe.timing[0];
  hooks.cycle?.(remaining);
  Common.run(player, () => {
    if (--wait > 0) return true;
    const actions = Common.actionsPerCycle(player, "make");
    for (let done = 0; done < actions && remaining > 0; done++) {
      if (hooks.canMake?.() === false || !makeOne(player, recipe)) {
        if (made > 0) hooks.done?.();
        return false;
      }
      made++;
      remaining--;
      hooks.made?.();
    }
    if (remaining <= 0 || !hasIngredients(player.getInventory(), recipe) || hooks.canMake?.() === false) {
      hooks.done?.();
      return false;
    }
    hooks.cycle?.(remaining);
    wait = recipe.timing[Math.min(made, recipe.timing.length - 1)];
    return true;
  });
}

/**
 * "How many do you wish to make?" showing the product, offering as many as the inventory makes
 * (rsprox captures). One to make is made without a menu.
 */
function offer(player, recipe, hooks) {
  if (!canMake(player, recipe)) return;
  if (!hasRoom(player.getInventory(), recipe)) {
    player.getInventory().full();
    return;
  }
  const most = makeable(player.getInventory(), recipe);
  if (most <= 0) return;
  if (most === 1) {
    start(player, recipe, 1, hooks);
    return;
  }
  const { CreationMenu } = Common.core;
  player.getPacketSender().sendCreationMenu(new CreationMenu(
    MAKE_TITLE,
    [recipe.productId],
    { execute: (_itemId, amount) => start(player, recipe, Math.min(amount, makeable(player.getInventory(), recipe)), hooks) },
    { mode: MAKE_MENU_MODE, maxAmount: most, lastAmount: most },
  ));
}

/** The dough recipe for this product with this water: flour and water in, a pot and the empty container out. */
function doughRecipe(dough, water, product) {
  return {
    productId: product.productId,
    members: product.members,
    level: product.level,
    xp: 0,
    message: product.message,
    ingredients: [{ id: dough.flourId, count: 1 }, { id: water.id, count: 1 }],
    returns: [{ id: dough.potId, count: 1 }, { id: water.emptyId, count: 1 }],
    timing: DOUGH_TIMING,
  };
}

/**
 * Flour on water (or water on flour) always opens the dough menu (rsprox captures 564, 1858, even
 * for one pot of flour), but not without a free slot (rsprox capture 564).
 */
function offerDough(player, water) {
  const dough = Common.doughData();
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage(NO_SPACE_FOR_DOUGH_MESSAGE);
    return;
  }
  const most = Math.min(inventory.getAmount(dough.flourId), inventory.getAmount(water.id));
  const { CreationMenu } = Common.core;
  player.getPacketSender().sendCreationMenu(new CreationMenu(
    DOUGH_TITLE,
    dough.products.map(({ productId }) => productId),
    {
      execute: (itemId, amount) => {
        const product = dough.products.find(({ productId }) => productId === itemId);
        if (!product) return;
        const recipe = doughRecipe(dough, water, product);
        if (canMake(player, recipe)) start(player, recipe, Math.min(amount, makeable(inventory, recipe)));
      },
    },
    { mode: MAKE_MENU_MODE, maxAmount: most, lastAmount: most },
  ));
}

function waterFor(firstId, secondId) {
  const dough = Common.doughData();
  if (firstId !== dough.flourId && secondId !== dough.flourId) return null;
  const otherId = firstId === dough.flourId ? secondId : firstId;
  return dough.waters.find(({ id }) => id === otherId) ?? null;
}

function useItemOnItem(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const water = waterFor(usedItemId, usedWithItemId);
  if (water) {
    event.handled = true;
    offerDough(player, water);
    return;
  }
  const recipe = Common.recipeWith(usedItemId, usedWithItemId);
  if (!recipe) return;
  event.handled = true;
  offer(player, recipe);
}

/** A half baked gnomebowl's Prepare option opens the same chocolate-bomb recipe its bars make. */
function prepareGnomebowl(event) {
  const recipe = Common.recipeForProduct(CHOCOLATE_BOMB_BOWL);
  if (!recipe || event.itemId !== Common.gameval("obj", "half_baked_bowl")) return;
  event.handled = true;
  offer(event.player, recipe);
}

module.exports = Object.assign(function attachRecipes(api) {
  api.onItemOnItem(useItemOnItem, { noted: false });
  api.onItemAction("Half baked bowl", { Prepare: prepareGnomebowl });
}, { offer, makeable });
