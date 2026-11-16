/** Pellem's mixed-hide service, using the existing dialogue transcript for its prompts. */
const PELLEM_NPC_ID = 13130;
const MIXED_HIDE = {
  wzrRaR: { fur: "SUNLIGHT_ANTELOPE_FUR", amount: 2, coins: 20000, output: "MIXED_HIDE_TOP" },
  XCL9V0: { fur: "FOX_FUR", amount: 3, coins: 20000, output: "MIXED_HIDE_LEGS" },
  TRR_6n: { fur: "SUNLIGHT_ANTELOPE_FUR", amount: 1, coins: 17500, output: "MIXED_HIDE_BOOTS" },
  q8AtCP: { fur: "JAGUAR_FUR", amount: 1, coins: 20000, output: "MIXED_HIDE_CAPE" },
};

function recipeForCondition(stepId) {
  return Object.hasOwn(MIXED_HIDE, stepId) ? MIXED_HIDE[stepId] : undefined;
}

const MESSAGE_RECIPE = { qWexjB: "wzrRaR", nVPPRx: "XCL9V0", HL7Y76: "TRR_6n", Mh1vYs: "q8AtCP" };

function canMake(core, player, recipe) {
  const inventory = player.getInventory();
  const fur = core.ItemIdentifiers[recipe.fur];
  const coins = core.ItemIdentifiers.COINS;
  // These cache furs are non-stackable, so every consumed fur frees a slot.
  return inventory.getAmount(fur) >= recipe.amount && inventory.getAmount(coins) >= recipe.coins
    && inventory.getFreeSlots()
      + recipe.amount
      + Number(inventory.getAmount(coins) === recipe.coins) >= 1;
}

function dialogueCondition(core, event) {
  if (event.npcId !== PELLEM_NPC_ID || event.text !== "If the player does have the required items:") return null;
  const recipe = recipeForCondition(event.stepId);
  return recipe ? canMake(core, event.player, recipe) : null;
}

function makeMixedHide(core, event) {
  if (event.npcId !== PELLEM_NPC_ID || event.kind !== "message") return;
  const recipe = MIXED_HIDE[MESSAGE_RECIPE[event.stepId]];
  if (!recipe) return;
  const inventory = event.player.getInventory();
  const fur = core.ItemIdentifiers[recipe.fur];
  const coins = core.ItemIdentifiers.COINS;
  if (!canMake(core, event.player, recipe)) {
    event.handled = true;
    event.player.sendMessage("You need more inventory space to have Pellem make that.");
    return;
  }
  inventory.deleteNumber(fur, recipe.amount);
  inventory.deleteNumber(coins, recipe.coins);
  inventory.adds(core.ItemIdentifiers[recipe.output], 1);
}

module.exports = {
  name: "Pellem",
  description: "Lets Pellem make mixed-hide armour for the transcript's fur and coin costs.",
  members: true,
  register(api) {
    api.onNpcDialogueCondition(dialogueCondition.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", makeMixedHide.bind(null, api.core));
  },
};
