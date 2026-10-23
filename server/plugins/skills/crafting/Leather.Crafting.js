/**
 * Sewing leather, snakeskin, Xerician fabric and hides with a needle, and the armour made by
 * adding something to a finished piece: studs, kebbit claws, and hides nailed onto a shield.
 *
 * Wiki (Leather, Thread, Crafting#Armour) and rsprox captures (recordings 1854, 1857, 1858,
 * 3276): a needle on leather, hard leather or dragon leather opens the skillmulti menu
 * ("How many do you wish to make?", up to the leather carried). Every 3 ticks the player
 * makes one item ("You make ..."), the first 2 ticks after choosing it. A reel of thread lasts
 * five items ("You use up one of your reels of thread."); a costume needle needs none. Items
 * above the player's level stay in the menu and answer with a message box when chosen.
 */
const Shared = require("./Shared.Crafting");

const THREAD_USES_ATTRIBUTE = "crafting:thread-uses";
const CRAFTS_PER_THREAD = 5;
const LEATHER_MENU_TITLE = "How many do you wish to make?";
// skillmulti_setup's first argument for leather menus, as captured.
const LEATHER_MENU_MODE = 0;
/** human_leather_crafting. */
const LEATHER_CRAFTING_ANIMATION_ID = 1249;

let tables = null;

/** The needles and recipes from crafting.json, with cache ids, built on first use. */
function data() {
  if (tables) return tables;
  const { ItemIds: I, Animation } = Shared.getCore();
  const { leather, combine } = Shared.DATA;
  const needle = (recipe) => ({ ...recipe, itemId: Shared.itemId(recipe.item) });
  return tables = {
    needles: new Set([I.NEEDLE, I.COSTUME_NEEDLE]),
    leather: new Map(Object.entries(leather).filter(([key]) => key !== "$comment")
      .map(([material, recipes]) => [Shared.itemId(material), recipes.map(needle)])),
    combine: combine.recipes.map((recipe) => ({
      ...recipe,
      itemId: Shared.itemId(recipe.item),
      pair: recipe.pair.map(Shared.itemId),
      materials: (recipe.materials ?? []).map(([name, amount]) => [Shared.itemId(name), amount]),
      tools: (recipe.tools ?? []).map(Shared.itemId),
      animation: new Animation(recipe.seq),
    })),
    animation: new Animation(LEATHER_CRAFTING_ANIMATION_ID),
  };
}

function carriedNeedle(inventory) {
  return [...data().needles].find((id) => inventory.contains(id));
}

function hasLeatherMaterials(player, materialId, recipe) {
  const I = Shared.getCore().ItemIds;
  const inventory = player.getInventory();
  const needle = carriedNeedle(inventory);
  return needle !== undefined &&
    (needle === I.COSTUME_NEEDLE || inventory.contains(I.THREAD)) &&
    inventory.getAmount(materialId) >= recipe.leather;
}

/** One use of the carried reel; the fifth uses it up. A costume needle needs no thread. */
function useThread(player) {
  const I = Shared.getCore().ItemIds;
  const inventory = player.getInventory();
  if (carriedNeedle(inventory) === I.COSTUME_NEEDLE) return;
  const uses = (player.getAttribute(THREAD_USES_ATTRIBUTE) ?? 0) + 1;
  if (uses < CRAFTS_PER_THREAD) {
    player.setAttribute(THREAD_USES_ATTRIBUTE, uses);
    return;
  }
  player.setAttribute(THREAD_USES_ATTRIBUTE, 0);
  inventory.deleteNumber(I.THREAD, 1);
  player.sendMessage("You use up one of your reels of thread.");
}

function craftLeatherItem(player, materialId, recipe) {
  if (!hasLeatherMaterials(player, materialId, recipe)) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(materialId, recipe.leather);
  inventory.addItem(new (Shared.getCore().Item)(recipe.itemId, 1));
  Shared.addCraftingXp(player, recipe.xp);
  player.sendMessage(`You make ${recipe.made}.`);
  useThread(player);
  return true;
}

/** The captured message box for an item above the player's level. */
function tooLowStatement(player, level, made) {
  const { DialogueChainBuilder, StatementDialogue } = Shared.getCore();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, `You need a Crafting level of ${level} to make ${made}.`)));
}

function startLeatherCrafting(player, materialId, recipe, amount) {
  if (Shared.craftingLevel(player) < recipe.level) {
    tooLowStatement(player, recipe.level, recipe.made);
    return;
  }
  // Items on ticks 2, 5, 8 ... after the choice; the animation restarts with each one.
  Shared.startMaking(player, {
    amount, startTick: 0, firstTick: 2, interval: 3, animation: data().animation, resetAnimation: true,
    has: () => hasLeatherMaterials(player, materialId, recipe),
    make: () => craftLeatherItem(player, materialId, recipe),
  });
}

/** A needle (or costume needle) used on leather, in either order, opens the skillmulti menu. */
function handleNeedleOnLeather(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const I = Shared.getCore().ItemIds;
  const { needles, leather } = data();
  const needleId = needles.has(usedItemId) ? usedItemId : usedWithItemId;
  const materialId = needleId === usedItemId ? usedWithItemId : usedItemId;
  if (!needles.has(needleId) || !leather.has(materialId)) return;
  event.handled = true;

  const inventory = player.getInventory();
  if (needleId !== I.COSTUME_NEEDLE && !inventory.contains(I.THREAD)) {
    // ponytail: not in the captures or on the Wiki; replace with the live text when captured.
    player.sendMessage("You need some thread to sew leather.");
    return;
  }

  Shared.stopCrafting(player);
  const recipes = Shared.available(leather.get(materialId));
  Shared.openMakeMenu(player, {
    title: LEATHER_MENU_TITLE,
    mode: LEATHER_MENU_MODE,
    items: recipes,
    maxAmount: inventory.getAmount(materialId),
    choose: (recipe, amount) => startLeatherCrafting(player, materialId, recipe, amount),
  });
}

function combineAmounts(recipe) {
  return recipe.pairAmounts ?? [1, 1];
}

function hasCombineMaterials(player, recipe) {
  const inventory = player.getInventory();
  const [first, second] = combineAmounts(recipe);
  return inventory.getAmount(recipe.pair[0]) >= first && inventory.getAmount(recipe.pair[1]) >= second &&
    (recipe.materials ?? []).every(([id, amount]) => inventory.getAmount(id) >= amount) &&
    (recipe.tools ?? []).every((id) => inventory.contains(id));
}

function combine(player, recipe) {
  if (!hasCombineMaterials(player, recipe)) return false;
  const inventory = player.getInventory();
  const [first, second] = combineAmounts(recipe);
  inventory.deleteNumber(recipe.pair[0], first);
  inventory.deleteNumber(recipe.pair[1], second);
  for (const [id, amount] of recipe.materials ?? []) inventory.deleteNumber(id, amount);
  inventory.addItem(new (Shared.getCore().Item)(recipe.itemId, 1));
  Shared.addCraftingXp(player, recipe.xp);
  return true;
}

/** The first tool or material short for one item, as [id, amount needed]. */
function missingCombineItem(player, recipe) {
  const inventory = player.getInventory();
  const tool = (recipe.tools ?? []).find((id) => !inventory.contains(id));
  if (tool !== undefined) return [tool, 1];
  const needs = [...recipe.pair.map((id, index) => [id, combineAmounts(recipe)[index]]), ...(recipe.materials ?? [])];
  return needs.find(([id, amount]) => inventory.getAmount(id) < amount);
}

function maxCombines(player, recipe) {
  const inventory = player.getInventory();
  const [first, second] = combineAmounts(recipe);
  return Math.min(
    Math.floor(inventory.getAmount(recipe.pair[0]) / first),
    Math.floor(inventory.getAmount(recipe.pair[1]) / second),
    ...(recipe.materials ?? []).map(([id, amount]) => Math.floor(inventory.getAmount(id) / amount))
  );
}

function startCombining(player, recipe, amount) {
  const name = Shared.itemName(recipe.itemId).toLowerCase();
  if (Shared.craftingLevel(player) < recipe.level) {
    tooLowStatement(player, recipe.level, `a ${name}`);
    return;
  }
  Shared.startMaking(player, {
    amount, startTick: 0, firstTick: recipe.ticks - 1, interval: recipe.ticks,
    animation: recipe.animation, resetAnimation: true,
    has: () => hasCombineMaterials(player, recipe),
    make: () => combine(player, recipe),
  });
}

/** Studs, claws or a hide used on the piece it goes onto, in either order. */
function handleCombine(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const recipe = Shared.available(data().combine).find(({ pair }) =>
    (pair[0] === usedItemId && pair[1] === usedWithItemId) || (pair[1] === usedItemId && pair[0] === usedWithItemId));
  if (!recipe) return;
  event.handled = true;
  if (!hasCombineMaterials(player, recipe)) {
    // ponytail: not captured; names what is missing, and how many when more than one is needed.
    const [id, amount] = missingCombineItem(player, recipe);
    const name = Shared.itemName(id).toLowerCase();
    player.sendMessage(`You need ${amount > 1 ? `${amount} ${name}` : Shared.withArticle(name)} to make this.`);
    return;
  }
  Shared.stopCrafting(player);
  Shared.openMakeMenu(player, {
    title: LEATHER_MENU_TITLE,
    mode: LEATHER_MENU_MODE,
    items: [recipe],
    maxAmount: maxCombines(player, recipe),
    choose: (chosen, amount) => startCombining(player, chosen, amount),
  });
}

module.exports = function attach(api) {
  api.onItemOnItem(handleNeedleOnLeather, { noted: false });
  api.onItemOnItem(handleCombine, { noted: false });
};
