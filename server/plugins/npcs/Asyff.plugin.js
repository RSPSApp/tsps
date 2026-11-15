/**
 * Asyff's Custom Fur Clothing in south-east Varrock
 * (https://oldschool.runescape.wiki/w/Asyff, revision 15006217).
 *
 * The right-click "Fur Clothing" option and the transcript's "Custom Fur Clothing" action
 * open the made-to-order trade. Each row of the wiki table is one recipe in
 * data/asyff-custom-fur.json: the furs and the coin fee go in, one piece comes out. Sets
 * with several pieces (Larupia, Graahk, Kyatt, the camo sets) open a second menu. Only Asyff
 * runs this service; Nia and Pellem share the transcript target but keep their own trade.
 * A spottier cape emits the success event the Varrock diary listens for.
 */
const DATA = require("./data/asyff-custom-fur.json");

const ASYFF_NPC_ID = 2887;
const CUSTOM_FUR_TARGET = "Custom Fur Clothing";
const SPOTTIER_CAPE_TRADED_EVENT = "asyff:spottier-cape-traded";
const RECIPES = DATA.recipes;
const SOURCE = DATA.source;
const RECIPE_BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));
const SPOTTIER = RECIPE_BY_ID.get("spottier-cape");
const SPOTTIER_CAPE = SPOTTIER.output.id;
const DASHING_KEBBIT_FUR = SPOTTIER.fur.ids[0];
const SPOTTIER_FURS = SPOTTIER.fur.amount;
const SPOTTIER_COST = SPOTTIER.fee;
const SPOTTIER_HUNTER_LEVEL = SPOTTIER.level;

function tradeRecipe(api, player, recipe) {
  const inventory = player.getInventory();
  const coins = api.core.ItemIdentifiers.COINS;
  if (recipe.level && player.getSkillManager().getCurrentLevel(api.core.Skill.HUNTER) < recipe.level) {
    player.sendMessage(`You need ${recipe.level} Hunter to make a ${recipe.output.label.toLowerCase()}.`);
    return false;
  }
  const furId = recipe.fur.ids.find((id) => inventory.getAmount(id) >= recipe.fur.amount);
  if (furId === undefined) {
    player.sendMessage(`You need ${recipe.fur.amount} ${recipe.fur.label}.`);
    return false;
  }
  if (inventory.getAmount(coins) < recipe.fee) {
    player.sendMessage(`You need ${recipe.fee} coins.`);
    return false;
  }
  inventory.deleteNumber(furId, recipe.fur.amount);
  inventory.deleteNumber(coins, recipe.fee);
  inventory.adds(recipe.output.id, 1);
  player.sendMessage(`Asyff makes you a ${recipe.output.label.toLowerCase()}.`);
  if (recipe.output.id === SPOTTIER_CAPE) {
    api.emitCustomEvent(SPOTTIER_CAPE_TRADED_EVENT, { player, capeId: SPOTTIER_CAPE });
  }
  return true;
}

/** The spottier cape trade on its own, kept for the diary test and existing callers. */
function tradeSpottierCape(api, player) {
  return tradeRecipe(api, player, SPOTTIER);
}

/** Asyff's own "Fur Clothing" option opens the same made-to-order trade. */
function onAsyffFurClothing(api, event) {
  const { player } = event ?? {};
  if (!player) return false;
  event.handled = true;
  openSetMenu(api, player);
  return true;
}

function openSetMenu(api, player) {
  const sets = [...new Set(RECIPES.map((recipe) => recipe.set))];
  const menu = new api.core.OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      const set = sets[Number(option) - 1];
      if (set) openPieceMenu(api, player, set);
    },
  }, ...sets, "Cancel").setTitle("Custom Fur Clothing");
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(menu));
}

function openPieceMenu(api, player, set) {
  const pieces = RECIPES.filter((recipe) => recipe.set === set);
  const menu = new api.core.OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      const recipe = pieces[Number(option) - 1];
      if (recipe) tradeRecipe(api, player, recipe);
    },
  }, ...pieces.map((recipe) => `${recipe.output.label} (${recipe.fee} coins)`), "Cancel")
    .setTitle(`${set}: ${pieces[0].fur.amount} ${pieces[0].fur.label} each`);
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(menu));
}

function onDialogueAction(api, event) {
  const { player } = event ?? {};
  if (!player || event.handled) return;
  if (event.npcId === ASYFF_NPC_ID && event.action === "open_interface" && event.target === CUSTOM_FUR_TARGET) {
    event.handled = true;
    openSetMenu(api, player);
  }
}

module.exports = {
  name: "Asyff",
  description: "Adds Asyff's Custom Fur Clothing in Varrock: the wiki's kebbit, camo, Larupia, Graahk and Kyatt sets, gloves and capes for their fur and coin fees.",
  members: true,
  register(api) {
    api.onNpcInteraction("Asyff", { "Fur Clothing": onAsyffFurClothing.bind(null, api) });
    api.onCustomEvent("npc-dialogue:action", onDialogueAction.bind(null, api));
  },
  _test: {
    ASYFF_NPC_ID, CUSTOM_FUR_TARGET, DASHING_KEBBIT_FUR, SPOTTIER_CAPE, SPOTTIER_FURS,
    SPOTTIER_COST, SPOTTIER_HUNTER_LEVEL, SPOTTIER_CAPE_TRADED_EVENT, RECIPES, SOURCE,
    tradeRecipe, tradeSpottierCape, onAsyffFurClothing, openSetMenu, openPieceMenu, onDialogueAction,
  },
};
