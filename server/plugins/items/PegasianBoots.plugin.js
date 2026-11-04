/**
 * Cerberus boot upgrades: a crystal used on its base boots.
 *
 * Flow (rsprox capture 1521, rev 224.1, Eternal boots): a confirmation box, then a
 * "Proceed with the infusion. / Cancel." menu. One tick after Proceed the boots replace the
 * ingredients, with sequence 4462, spotanim 759, 200 xp in Magic and Runecraft and a success box.
 * Only Eternal is captured; Pegasian and Primordial use the same wording with their own item names.
 * The captured area sounds belong to other players, and sound 140 has no verifiable name in the
 * current data, so no sound is played.
 */
const MAGIC_LEVEL = 60;
const RUNECRAFTING_LEVEL = 60;
const EXPERIENCE = 200;
const ANIMATION = 4462;
const SPOTANIM = 759;
const MENU_TITLE = "Select an option";
const PROCEED = "Proceed with the infusion.";
const CANCEL = "Cancel.";
const PRESET_TEXT = "Preset items cannot be used for this.";

let api;

// Names must match the item definitions (onItemOnItem is name-based).
const RECIPES = [
  { crystalName: "Pegasian crystal", baseName: "Ranger boots", resultName: "Pegasian boots",
    crystal: "PEGASIAN_CRYSTAL", base: "RANGER_BOOTS", result: "PEGASIAN_BOOTS" },
  { crystalName: "Primordial crystal", baseName: "Dragon boots", resultName: "Primordial boots",
    crystal: "PRIMORDIAL_CRYSTAL", base: "DRAGON_BOOTS", result: "PRIMORDIAL_BOOTS" },
  { crystalName: "Eternal crystal", baseName: "Infinity boots", resultName: "Eternal boots",
    crystal: "ETERNAL_CRYSTAL", base: "INFINITY_BOOTS", result: "ETERNAL_BOOTS" },
];

function id(recipe, key) {
  return api.core.ItemIdentifiers[recipe[key]];
}

function meetsLevels(player) {
  const skills = player.getSkillManager();
  const { Skill } = api.core;
  if (skills.getMaxLevel(Skill.MAGIC) >= MAGIC_LEVEL && skills.getMaxLevel(Skill.RUNECRAFTING) >= RUNECRAFTING_LEVEL) {
    return true;
  }
  player.sendMessage("You need level 60 Magic and Runecrafting to do this.");
  return false;
}

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never convert. */
function restricted(item) {
  const Item = api.core.Item;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

/** The slot of an unrestricted copy of the item: the instance that is actually consumed. */
function plainSlot(player, itemId) {
  return player.getInventory().getItems().findIndex((item) => item && item.getId() === itemId && !restricted(item));
}

function hasIngredients(player, recipe) {
  return plainSlot(player, id(recipe, "crystal")) >= 0 && plainSlot(player, id(recipe, "base")) >= 0;
}

function confirmText(recipe) {
  return `Are you sure you wish to infuse the ${recipe.baseName} and ${recipe.crystalName} to create ${recipe.resultName}? This can not be reversed.`;
}

function successText(recipe) {
  return `You successfully infuse the ${recipe.baseName} and ${recipe.crystalName} to create ${recipe.resultName}.`;
}

function cancel(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

function showMenu(player, recipe) {
  api.sendMultiChatboxPrompt(player, MENU_TITLE,
    PROCEED, () => proceed(player, recipe),
    CANCEL, () => cancel(player));
}

/** Used crystal on boots: ask first, nothing is consumed yet. */
function askToInfuse(recipe, { player, usedItem, usedWithItem }) {
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (!meetsLevels(player) || !hasIngredients(player, recipe)) return;
  const { DialogueChainBuilder, DoubleItemStatementDialogue, ActionDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(new DoubleItemStatementDialogue(0, id(recipe, "base"), id(recipe, "crystal"), confirmText(recipe)));
  chain.add(new ActionDialogue(1, { execute: () => showMenu(player, recipe) }));
  player.getDialogueManager().startDialogues(chain);
}

function proceed(player, recipe) {
  cancel(player);
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1);
    }
    execute() {
      this.stop();
      infuse(player, recipe);
    }
  })());
}

/** The ingredients are checked again here: the inventory may have changed since the prompt. */
function infuse(player, recipe) {
  if (!meetsLevels(player) || !hasIngredients(player, recipe)) return false;
  const { Item, Skill, Animation, Graphic, DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = api.core;
  const inventory = player.getInventory();
  inventory.deleteAtSlot(plainSlot(player, id(recipe, "crystal")), 1);
  inventory.deleteAtSlot(plainSlot(player, id(recipe, "base")), 1);
  inventory.addItem(new Item(id(recipe, "result"), 1));
  player.getSkillManager().addExperiences(Skill.MAGIC, EXPERIENCE);
  player.getSkillManager().addExperiences(Skill.RUNECRAFTING, EXPERIENCE);
  player.performAnimation(new Animation(ANIMATION));
  player.performGraphic(new Graphic(SPOTANIM));
  const chain = new DialogueChainBuilder();
  chain.add(new ItemStatementDialogue(0, id(recipe, "result"), successText(recipe)));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function attachRecipe(recipe) {
  api.onItemOnItem(recipe.crystalName, recipe.baseName, (event) => askToInfuse(recipe, event), { noted: false });
}

module.exports = {
  name: "PegasianBoots",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    RECIPES.forEach(attachRecipe);
  },
  _test: { RECIPES, infuse },
};
