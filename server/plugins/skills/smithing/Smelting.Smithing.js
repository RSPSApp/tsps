/**
 * Smelting at a furnace: the Smelt menu (the shared skillmulti CreationMenu), ore used on a
 * furnace, and the smelt loop. A carried coal bag's coal is used after the inventory's
 * (docs/storage-items.md).
 *
 * Captured (rsprox, docs/smithing.md): choosing a bar plays human_furnace (899) with sound 2725
 * and the "You smelt ..." message on the same tick; the bar, "You retrieve a bar of ..." and
 * the XP come 4 ticks later with human_furnace again, and the next ore starts on the 5th. Iron
 * fails half the time: "The ore is too impure and you fail to refine it." These lines are on the
 * spam channel. With no ore at all the furnace says "You don't have any ore to smelt." in a
 * message box.
 *
 * Smithing catalyst (https://oldschool.runescape.wiki/w/Smithing_catalyst): carried while
 * smelting a bar that uses coal, at a furnace or with Superheat Item, one catalyst per bar
 * halves the bar's coal and doubles its experience. Without enough catalysts or coal for that,
 * the bar is smelted normally. The Wiki gives no message for it.
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const Common = require("./Common.Smithing");
const { animation, spam } = Common;

// Wiki: goldsmith gauntlets (or the Smithing or max cape) raise gold bar XP from 22.5 to 56.2.
const GOLDSMITH_GAUNTLETS_BONUS_XP = 33.7;
const SMELT_TITLE = "What would you like to smelt?";
const LOVAKITE_FURNACE = "Lovakite furnace";
const NO_ORE_MESSAGE = "You don't have any ore to smelt.";
const SMELT_INTERVAL_TICKS = 5;
const SMELT_FINISH_TICKS = 4;
/** The skillmulti list's quantity cap, also what the old menu clamped to. */
const MAX_QUANTITY = 28;

/** Every furnace loc, for the bots' object catalog. Filled in when the plugin registers. */
const FURNACE_OBJECT_IDS = new Set();

/** The list's op flags (Make 1/5/10/X/All, bits 1-5); the CreationMenu sends the same. */
const SMELTING_SKILLMULTI_OP_FLAGS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);

/** The skillmulti list sends the chosen quantity itself; a bare click sends 0 (make one). */
function quantityForSmeltAction(action) {
  return Number.isInteger(action) && action > 0 ? Math.min(action, MAX_QUANTITY) : 1;
}

/** What a carried container (the coal bag) holds of an ingredient ("storage:amount"). */
function storedAmount(player, itemId) {
  const request = { player, itemId, amount: 0 };
  Core.api.emitCustomEvent("storage:amount", request);
  return request.amount;
}

function available(player, itemId) {
  return player.getInventory().getAmount(itemId) + storedAmount(player, itemId);
}

function hasIngredients(player, recipe) {
  return recipe.ingredients.every(([itemId, amount]) => available(player, itemId) >= amount);
}

/** How many of a recipe the player's ore (and coal bag) covers: the catalysed bars first, then the rest. */
function batches(player, recipe) {
  const left = new Map();
  const have = (itemId) => (left.has(itemId) ? left.get(itemId) : available(player, itemId));
  const covered = (candidate) => Math.min(...candidate.ingredients.map(([itemId, amount]) => Math.floor(have(itemId) / amount)));
  const catalysed = withCatalyst(player, recipe);
  if (catalysed === recipe) return covered(recipe);
  const first = covered(catalysed);
  for (const [itemId, amount] of catalysed.ingredients) left.set(itemId, have(itemId) - amount * first);
  return first + covered(recipe);
}

/** The recipe with a catalyst: half the coal, one catalyst, double XP. Unchanged for bars without coal. */
function withCatalyst(player, recipe) {
  const { COAL, SMITHING_CATALYST } = Core.ItemIdentifiers;
  if (recipe.catalysed || !recipe.ingredients.some(([itemId]) => itemId === COAL)) return recipe;
  if (!player.getInventory().contains(SMITHING_CATALYST)) return recipe;
  const ingredients = recipe.ingredients.map(([itemId, amount]) => [itemId, itemId === COAL ? Math.ceil(amount / 2) : amount]);
  return { ...recipe, ingredients: [...ingredients, [SMITHING_CATALYST, 1]], catalysed: true };
}

/** The catalyst's recipe when the player has its ingredients, otherwise the recipe itself. */
function resolveCatalyst(player, recipe) {
  const catalysed = withCatalyst(player, recipe);
  return catalysed !== recipe && hasIngredients(player, catalysed) ? catalysed : recipe;
}

/** Wiki (Coal bag): the inventory's coal goes first, then the bag's ("storage:take"). */
function consumeIngredients(player, recipe) {
  const inventory = player.getInventory();
  for (const [itemId, amount] of recipe.ingredients) {
    const held = Math.min(amount, inventory.getAmount(itemId));
    if (held > 0) inventory.deleteNumber(itemId, held);
    if (amount > held) Core.api.emitCustomEvent("storage:take", { player, itemId, amount: amount - held, taken: 0 });
  }
}

function smeltingXp(player, recipe) {
  if (recipe.catalysed) return recipe.xp * 2;
  if (recipe.barId !== Core.ItemIdentifiers.GOLD_BAR) return recipe.xp;
  const gloves = player.getEquipment().get(Core.Equipment.HANDS_SLOT)?.getId?.();
  const cape = { player, skill: "SMITHING", result: false };
  Core.api.emitCustomEvent("skillcape:has-perk", cape);
  const boosted = gloves === Core.ItemIdentifiers.GOLDSMITH_GAUNTLETS || cape.result === true;
  return boosted ? recipe.xp + GOLDSMITH_GAUNTLETS_BONUS_XP : recipe.xp;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = Core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function levelOf(player, recipe) {
  if (!recipe.skill || recipe.skill === Core.Skill.SMITHING) return Common.smithingLevel(player);
  return player.getSkillManager().getCurrentLevel(recipe.skill);
}

/**
 * The Gold bar choice smelts Family Crest's 'perfect' gold ore when that is all the gold ore
 * the player has.
 */
function resolveRecipe(player, recipe) {
  if (recipe.barId !== Core.ItemIdentifiers.GOLD_BAR || hasIngredients(player, recipe)) return recipe;
  const perfect = Data.SMELTING_RECIPES.find((candidate) => candidate.barId === Core.ItemIdentifiers.PERFECT_GOLD_BAR);
  return perfect && hasIngredients(player, perfect) ? perfect : recipe;
}

/** Opens the cycle: the message, animation and sound; the ore goes in on the finish tick. */
function beginSmelt(player, recipe) {
  if (!hasIngredients(player, resolveCatalyst(player, recipe))) {
    player.sendMessage(recipe.missingMessage);
    return false;
  }
  if (recipe.smeltMessage) spam(player, recipe.smeltMessage);
  player.performAnimation(animation("human_furnace"));
  Core.Sounds.sendSound(player, Core.Sound.SMELTING);
  return true;
}

function finishSmelt(player, chosen, furnaceId) {
  const recipe = resolveCatalyst(player, chosen);
  if (!hasIngredients(player, recipe)) {
    player.sendMessage(recipe.missingMessage);
    return false;
  }
  consumeIngredients(player, recipe);
  player.performAnimation(animation("human_furnace"));
  const inventory = player.getInventory();
  for (const [itemId, amount] of recipe.byproducts ?? []) inventory.addItem(new Core.Item(itemId, amount));
  // A second bar (Varrock armour) sets `secondRecipe`, the recipe its ingredients were taken by.
  const outcome = { player, recipe, base: chosen, furnaceId, success: Math.random() < (recipe.successChance ?? 1), bars: 1 };
  Core.api.emitCustomEvent("smithing:smelt-outcome", outcome);
  if (!outcome.success) {
    spam(player, recipe.failMessage);
    return true;
  }
  const skill = recipe.skill ?? Core.Skill.SMITHING;
  inventory.addItem(new Core.Item(recipe.barId, outcome.bars));
  const extraXp = (outcome.bars - 1) * smeltingXp(player, outcome.secondRecipe ?? recipe);
  player.getSkillManager().addExperiences(skill, smeltingXp(player, recipe) + extraXp);
  if (recipe.retrieveMessage) spam(player, recipe.retrieveMessage);
  Core.api.emitCustomEvent("smelting:success", { player, skill, itemId: recipe.barId });
  Common.produced(player, skill, recipe.barId, outcome.bars, smeltingXp(player, recipe) + extraXp, "smelt");
  return true;
}

function startSmelting(player, chosen, amount, furnaceId = -1) {
  if (!chosen || !Number.isInteger(amount) || amount <= 0) return false;
  if (chosen.members && !Core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("You need to be on a members world to smelt that bar.");
    return false;
  }
  const recipe = resolveRecipe(player, chosen);
  if (recipe.quest && !Core.questComplete(player, recipe.quest)) {
    player.sendMessage(`You need to complete ${Data.questName(recipe.quest)} to smelt ${recipe.barPhrase}.`);
    return false;
  }
  if (levelOf(player, recipe) < recipe.level) {
    statement(player, `You need a Smithing level of ${recipe.level} to smelt ${recipe.barPhrase}.`);
    return false;
  }
  if (!hasIngredients(player, resolveCatalyst(player, recipe))) {
    player.sendMessage(recipe.missingMessage);
    return false;
  }
  Sessions.start(player, {
    type: "smelt",
    // Molten glass is a Crafting recipe at the same furnace: its batching is Crafting's question.
    skill: recipe.skill ?? Core.Skill.SMITHING,
    remaining: amount,
    interval: SMELT_INTERVAL_TICKS,
    finishDelay: SMELT_FINISH_TICKS,
    begin: (smelter) => beginSmelt(smelter, recipe),
    step: (smelter) => finishSmelt(smelter, recipe, furnaceId),
  });
  return true;
}

function isSmeltingActive(player) {
  return Sessions.typeOf(player) === "smelt";
}

/** Other furnace products (cannonballs) offered beside the bars: (player) => [{ itemId, most, start }]. */
const MENU_EXTRAS = [];

function addMenuEntries(provider) {
  MENU_EXTRAS.push(provider);
}

function extraEntries(player) {
  return MENU_EXTRAS.flatMap((provider) => provider(player));
}

/** entries: [{ itemId, most, start(player, amount) }], shown in order. */
function openMenu(player, entries) {
  const { CreationMenu } = Core;
  const byItem = new Map(entries.map((entry) => [entry.itemId, entry]));
  const most = Math.max(1, ...entries.map((entry) => entry.most));
  player.getPacketSender().sendCreationMenu(
    new CreationMenu(SMELT_TITLE, [...byItem.keys()], { execute: (itemId, amount) => byItem.get(itemId)?.start(player, amount) }, {
      maxAmount: Math.min(most, MAX_QUANTITY),
    })
  );
}

function recipeEntries(player, recipes, furnaceId) {
  return recipes.map((recipe) => ({
    itemId: recipe.barId,
    most: batches(player, resolveRecipe(player, recipe)),
    start: (smelter, amount) => startSmelting(smelter, recipe, amount, furnaceId),
  }));
}

/** "Smelt" on a furnace: the menu lists every bar; with nothing to smelt, a message box instead. */
function smelt({ player, objectId }) {
  const hasOre = Data.SMELTING_RECIPES.some((recipe) => !recipe.skill && !recipe.furnace && recipe.ingredients.some(([id]) => id !== Core.ItemIdentifiers.COAL && available(player, id) > 0));
  const extras = extraEntries(player);
  if (!hasOre && extras.length === 0) {
    statement(player, NO_ORE_MESSAGE);
    return;
  }
  openMenu(player, [...recipeEntries(player, Data.smeltMenuRecipes(), objectId), ...extras]);
}

/**
 * An item used on a furnace: ore opens the Smelt menu; sand, soda ash and 'perfect' gold ore,
 * which aren't on it, open a menu of their own product.
 */
function useOnFurnace(event) {
  const furnace = event.object.getDefinition().getName();
  if (furnace === LOVAKITE_FURNACE) return smeltLovakite(event);
  const recipes = Data.SMELTING_RECIPES.filter((recipe) => !recipe.furnace && recipe.ingredients.some(([id]) => id === event.itemId));
  if (recipes.length === 0) return;
  event.handled = true;
  const offMenu = recipes.filter((recipe) => recipe.notInMenu);
  if (offMenu.length > 0) openMenu(event.player, recipeEntries(event.player, offMenu, furnaceIdOf(event)));
  else smelt({ player: event.player, objectId: furnaceIdOf(event) });
}

function furnaceIdOf(event) {
  return event.objectId ?? event.object?.getId?.() ?? -1;
}

/** The Lovakengj furnace smelts lovakite only (Wiki: Lovakite bar). */
function smeltLovakite(event) {
  const recipes = Data.SMELTING_RECIPES.filter((recipe) => recipe.furnace === LOVAKITE_FURNACE);
  if (event.itemId !== undefined && !recipes.some((recipe) => recipe.ingredients.some(([id]) => id === event.itemId))) return;
  if (event.itemId !== undefined) event.handled = true;
  if (!recipes.some((recipe) => available(event.player, recipe.ingredients[0][0]) > 0)) {
    statement(event.player, NO_ORE_MESSAGE);
    return;
  }
  openMenu(event.player, recipeEntries(event.player, recipes, furnaceIdOf(event)));
}

function fillFurnaceIds() {
  for (const [name, id] of Object.entries(Core.ObjectIdentifiers)) {
    if (/^(SMALL_)?FURNACE(_\d+)?$/.test(name) && Number.isInteger(id)) FURNACE_OBJECT_IDS.add(id);
  }
}

/**
 * "smithing:bar-for-ore": the bar an ore smelts into and its XP, for content that smelts as it mines (a
 * league relic): the furnace recipe whose main ore it is (its first ingredient), so coal, a steel bar's
 * second ingredient, smelts into nothing. An optional outputId selects that bar's recipe.
 */
function answerBarForOre(request) {
  const recipe = Data.SMELTING_RECIPES.find((candidate) =>
    !candidate.furnace && candidate.ingredients[0]?.[0] === request.oreId &&
    (request.outputId == null || candidate.barId === request.outputId));
  if (!recipe) return;
  request.barId = recipe.barId;
  request.xp = recipe.xp;
}

module.exports = function attach(api) {
  api.onServerStartup(fillFurnaceIds);
  api.onCustomEvent("smithing:bar-for-ore", answerBarForOre);
  // Some furnaces (e.g. Tutorial Island 10082) only offer "Use".
  api.onObjectInteraction("Furnace", { Smelt: smelt, Use: smelt });
  api.onObjectInteraction("Small furnace", { Smelt: smelt });
  api.onObjectInteraction(LOVAKITE_FURNACE, { Smelt: smeltLovakite });
};

Object.assign(module.exports, {
  answerBarForOre,
  FURNACE_OBJECT_IDS,
  SMELTING_SKILLMULTI_OP_FLAGS,
  quantityForSmeltAction,
  hasIngredients,
  consumeIngredients,
  batches,
  withCatalyst,
  resolveCatalyst,
  smeltingXp,
  startSmelting,
  isSmeltingActive,
  useOnFurnace,
  addMenuEntries,
  openMenu,
  statement,
});
