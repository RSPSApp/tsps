/**
 * Using one ingredient on another: herb into a vial, secondary into an unfinished potion, and
 * the potions finished potions upgrade into. Recipes, levels, XP and ticks are the Wiki's
 * (plugins/skills/data/herblore.json); animation, sound and messages are from rsprox captures.
 */
const Common = require("./Common.Herblore");

/** Mixing a secondary into a potion (rsprox captures; the vial and unfinished potion steps). */
const COMBINE_LEVEL_MESSAGE = (level) => `You need a Herblore level of ${level} to combine those.`;
/** Adding to a finished potion (rsprox captures). */
const UPGRADE_LEVEL_MESSAGE = (level) => `You need level ${level} Herblore to upgrade the potion.`;
/** Super antifire before Dragon Slayer II (rsprox captures). */
const SUPER_ANTIFIRE_QUEST_MESSAGE = "You don't know how to make super antifire potions yet. Maybe someone can teach you.";

const PRESET_REFUSAL = "Preset items cannot be used for this.";

/** Preset, untradeable and unbankable copies keep their restrictions, so a mix never takes them. */
function restricted(item) {
  const { Item } = Common.core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

/** How many of `id` the inventory holds as unrestricted copies. */
function plainAmount(inventory, id) {
  return inventory.getItems().reduce((sum, item) => (item && item.getId() === id && !restricted(item) ? sum + item.getAmount() : sum), 0);
}

/** Takes `count` unrestricted copies of `id`, by slot, so a restricted copy of the same id stays put. */
function takePlain(inventory, id, count) {
  let left = count;
  inventory.getItems().forEach((item, slot) => {
    if (left <= 0 || !item || item.getId() !== id || restricted(item)) return;
    const take = Math.min(item.getAmount(), left);
    inventory.deleteAtSlot(slot, take, false);
    left -= take;
  });
}

function hasIngredients(inventory, recipe) {
  return recipe.ingredients.every(({ id, count }) => plainAmount(inventory, id) >= count);
}

/** Whether restricted copies are all that keeps the inventory from the recipe. */
function onlyRestrictedShort(inventory, recipe) {
  return recipe.ingredients.every(({ id, count }) => inventory.getAmount(id) >= count);
}

/** The product's dose count, from its name ("Sanfew serum(4)"). */
function doses(productId) {
  const match = /\((\d)\)$/.exec(Common.core.ItemDefinition.forId(productId).getName());
  return match ? Number(match[1]) : 1;
}

function message(recipe) {
  return recipe.message
    .replace("{count}", String(recipe.ingredients[recipe.ingredients.length - 1].count))
    .replace("{doses}", String(doses(recipe.productId)));
}

/**
 * One potion: the ingredients go, the product (and any emptied vials) come, with XP. A grimy herb
 * the Herblore cape cleans on the way in says so and gives its cleaning XP, without the mixing
 * animation or sound (rsprox captures).
 */
function makeOne(player, recipe) {
  const inventory = player.getInventory();
  if (!hasIngredients(inventory, recipe)) return false;
  // Content may keep an ingredient or change the product ("herblore:mix", a league relic's saved secondaries and 4-dose potions).
  const mix = {
    player, recipe, productId: recipe.productId,
    consume: recipe.ingredients.map((item) => ({ ...item })), returns: recipe.returns.map((item) => ({ ...item })),
  };
  Common.api.emitCustomEvent("herblore:mix", mix);
  // A listener may have changed what is taken: it still has to be there as unrestricted copies.
  if (!mix.consume.every(({ id, count }) => count <= 0 || plainAmount(inventory, id) >= count)) return false;
  for (const { id, count } of mix.consume) if (count > 0) takePlain(inventory, id, count);
  inventory.refreshItems();
  inventory.addItem(new Common.core.Item(mix.productId, 1));
  for (const { id, count } of mix.returns) if (count > 0) inventory.addItem(new Common.core.Item(id, count));
  if (recipe.cleaned) {
    Common.spam(player, `You clean the ${Common.core.ItemDefinition.forId(recipe.cleaned.grimyId).getName()}.`);
    Common.addXp(player, recipe.cleaned.xp);
  } else {
    Common.animate(player, Common.MIX_ANIMATION);
    Common.sound(player, Common.MIX_SOUND);
  }
  Common.spam(player, message(recipe));
  Common.addXp(player, recipe.xp);
  Common.api.emitCustomEvent("herblore:made", { player, itemId: mix.productId });
  Common.api.emitCustomEvent("skills:produced", { player, skill: Common.core.Skill.HERBLORE, itemId: mix.productId, amount: 1, xp: recipe.xp, kind: "mix" });
  return true;
}

/**
 * Wiki (Herblore cape): wearing it, a grimy herb goes straight into the vial if the player could
 * clean it; these are the clean herb's recipes taking the grimy herb instead.
 */
function capeRecipes(player, firstId, secondId) {
  for (const [grimyId, otherId] of [[firstId, secondId], [secondId, firstId]]) {
    const herb = Common.herbFor(grimyId);
    if (!herb || Common.level(player) < herb.level || !Common.wearsHerbloreCape(player)) continue;
    return Common.recipesWith(herb.cleanId, otherId).map((recipe) => ({
      ...recipe,
      cleaned: herb,
      ingredients: recipe.ingredients.map((item) => item.id === herb.cleanId ? { ...item, id: grimyId } : item),
    }));
  }
  return [];
}

/**
 * What a recipe takes, when the player is short of something (rsprox captures, recording 1438:
 * one araxyte venom sac on an anti-venom+(4)).
 */
function missingIngredients(recipe) {
  const { ItemDefinition } = Common.core;
  const list = recipe.ingredients.map(({ id, count }) => `${count} x ${ItemDefinition.forId(id).getName()}`);
  return `You don't have the right ingredients: ${list.join(" ")}`;
}

/** The recipe these two items make for this player, or null after saying why not. */
function chooseRecipe(player, recipes) {
  if (!Common.canUseHerblore(player)) return null;
  const known = recipes.filter((recipe) => (!recipe.quest || Common.questDone(player, recipe.quest))
    && (!recipe.unlock || Common.unlocked(player, recipe.unlock))
    && (recipe.questStage == null || (Common.questStage(player, recipe.questKey) ?? 0) >= recipe.questStage));
  if (known.length === 0) {
    player.sendMessage(recipes.some((recipe) => recipe.quest === "dragon_slayer_ii")
      ? SUPER_ANTIFIRE_QUEST_MESSAGE : "Nothing interesting happens.");
    return null;
  }
  const level = Common.level(player);
  const able = known.filter((recipe) => level >= recipe.level);
  if (able.length === 0) {
    const lowest = known[0];
    player.sendMessage((lowest.upgrade ? UPGRADE_LEVEL_MESSAGE : COMBINE_LEVEL_MESSAGE)(lowest.level));
    return null;
  }
  const recipe = able.find((candidate) => hasIngredients(player.getInventory(), candidate));
  if (!recipe) {
    // The right ingredients, but some only as preset copies: refuse rather than turn them into plain ones.
    if (able.some((candidate) => onlyRestrictedShort(player.getInventory(), candidate))) player.sendMessage(PRESET_REFUSAL);
    else Common.mesbox(player, missingIngredients(able[0]));
  }
  return recipe ?? null;
}

/** How many of the recipe the inventory holds the ingredients for. */
function makeable(inventory, recipe) {
  return Math.min(...recipe.ingredients.map(({ id, count }) => Math.floor(plainAmount(inventory, id) / count)));
}

/**
 * Makes `amount` (rsprox captures): the animation and sound as the menu closes, the first potion
 * a tick later and the next every `ticks` (1 for unfinished potions, 2 for most, 3 for forgotten
 * brew and extended anti-venom+). A grimy herb the cape cleans starts at once and goes every tick
 * (its recipes are unfinished potions, 1 tick), without the animation. Common.run's first step is
 * the tick after the confirm, so a `wait` of 1 makes the first potion there.
 */
function start(player, recipe, amount) {
  Common.core.TaskManager.cancelTasks(player.getIndex());
  let remaining = amount;
  if (recipe.cleaned) {
    if (!makeOne(player, recipe) || --remaining <= 0) return;
  } else {
    Common.animate(player, Common.MIX_ANIMATION);
    Common.sound(player, Common.MIX_SOUND);
  }
  let wait = 1;
  Common.run(player, () => {
    if (--wait > 0) return true;
    // Content may make several potions in the one cycle ("skills:actions-per-cycle").
    const actions = Common.actionsPerCycle(player, "mix", recipe);
    for (let done = 0; done < actions; done++) {
      if (!makeOne(player, recipe)) return false;
      if (--remaining <= 0) return false;
    }
    wait = recipe.ticks;
    return remaining > 0;
  });
}

/**
 * The skillmulti menus as captured: "How many do you wish to make?" (clientscript 2046's first
 * argument 0) showing the product, or for a recipe with `"menu": "upgrade"` (amylase, crushed
 * crystal) "How many would you like to upgrade?" (15) showing the potion it upgrades; the most
 * the inventory makes is both the limit and the amount it opens on. With only one to make, or a
 * manual recipe such as a Sanfew step, it is made at once.
 */
const MAKE_MENU = { title: "How many do you wish to make?", mode: 0 };
const UPGRADE_MENU = { title: "How many would you like to upgrade?", mode: 15 };

function offer(player, recipe) {
  const most = makeable(player.getInventory(), recipe);
  if (recipe.manual || most <= 1) {
    makeOne(player, recipe);
    return;
  }
  const { CreationMenu } = Common.core;
  const upgrade = recipe.menu === "upgrade";
  const { title, mode } = upgrade ? UPGRADE_MENU : MAKE_MENU;
  const shownId = upgrade ? recipe.ingredients[0].id : recipe.productId;
  player.getPacketSender().sendCreationMenu(new CreationMenu(
    title,
    [shownId],
    { execute: (_itemId, amount) => start(player, recipe, Math.min(amount, makeable(player.getInventory(), recipe))) },
    { mode, maxAmount: most, lastAmount: most },
  ));
}

function mix(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const refusal = Common.repeatMessage(usedItemId, usedWithItemId);
  if (refusal) {
    event.handled = true;
    player.sendMessage(refusal);
    return;
  }
  const found = Common.recipesWith(usedItemId, usedWithItemId);
  const recipes = found.length > 0 ? found : capeRecipes(player, usedItemId, usedWithItemId);
  if (recipes.length === 0) return;
  event.handled = true;
  const recipe = chooseRecipe(player, recipes);
  if (recipe) offer(player, recipe);
}

module.exports = function attachMixing(api) {
  api.onItemOnItem(mix, { noted: false });
};
