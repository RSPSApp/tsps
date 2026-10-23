/**
 * Barbarian smithing (https://oldschool.runescape.wiki/w/Barbarian_Training#Smithing): a bar
 * and a matching log make a spear or a hasta, only at a barbarian anvil (Otto's Grotto and
 * Barbarian Village), which works nothing else. Needs Otto's smithing training, which this
 * server doesn't have yet: like the Fishing plugin's quest fish, it only locks once Barbarian
 * Training exists here, or for a player given "barbarian-training:smithing".
 *
 * Captured (rsprox recs 1530, 1533): Smith says "You should select a suitable metal bar from
 * your inventory and use it on the anvil."; without a hammer, "You need a hammer in order to
 * smith here."
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const QuestRuntime = require("../../quests/QuestRuntime");
const { messageBox, hasHammer, smithingLevel, hammering } = require("./Common.Smithing");

const BARBARIAN_ANVIL = "Barbarian anvil";
const TRAINED_ATTRIBUTE = "barbarian-training:smithing";
const INTERVAL_TICKS = 4;
const SELECT_BAR_MESSAGE = "You should select a suitable metal bar from your inventory and use it on the anvil.";
const NO_HAMMER_MESSAGE = "You need a hammer in order to smith here.";
const UNFAMILIAR_MESSAGE = "This anvil is unfamiliar and barbaric, you can't seem to use it.";

function trained(player) {
  const training = QuestRuntime.getRegisteredQuests().find((quest) => quest.name === "Barbarian Training");
  return !training || player.getAttribute(TRAINED_ATTRIBUTE) === true;
}

function makeOne(player, recipe, itemId) {
  const inventory = player.getInventory();
  if (!hasHammer(player)) {
    player.sendMessage(NO_HAMMER_MESSAGE);
    return false;
  }
  if (smithingLevel(player) < recipe.level) {
    messageBox(player, `You need a Smithing level of ${recipe.level} to make that.`);
    return false;
  }
  if (!inventory.contains(recipe.barId) || !inventory.contains(recipe.logId)) {
    player.sendMessage(`You need a ${Core.ItemDefinition.forId(recipe.barId).getName().toLowerCase()} and some ${Core.ItemDefinition.forId(recipe.logId).getName().toLowerCase()} to make that.`);
    return false;
  }
  inventory.deleteNumber(recipe.barId, 1);
  inventory.deleteNumber(recipe.logId, 1);
  inventory.addItem(new Core.Item(itemId, 1));
  player.performAnimation(hammering());
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, recipe.xp);
  Core.api.emitCustomEvent("smithing:success", { player, skill: Core.Skill.SMITHING, itemId });
  return true;
}

function start(player, recipe, itemId, amount) {
  if (!Number.isInteger(amount) || amount <= 0) return;
  const inventory = player.getInventory();
  const most = Math.min(inventory.getAmount(recipe.barId), inventory.getAmount(recipe.logId));
  if (most <= 0) return;
  Sessions.start(player, {
    type: "spears",
    remaining: Math.min(amount, most),
    interval: INTERVAL_TICKS,
    step: (smith) => makeOne(smith, recipe, itemId),
  });
}

function smith({ player }) {
  messageBox(player, trained(player) ? SELECT_BAR_MESSAGE : UNFAMILIAR_MESSAGE);
}

function useBar(event) {
  if (event.object?.getDefinition?.().getName() !== BARBARIAN_ANVIL) return;
  const recipe = Data.spears().find((candidate) => candidate.barId === event.itemId);
  if (!recipe) return;
  event.handled = true;
  const { player } = event;
  if (!trained(player)) return messageBox(player, UNFAMILIAR_MESSAGE);
  if (!hasHammer(player)) return player.sendMessage(NO_HAMMER_MESSAGE);
  const { CreationMenu } = Core;
  const most = Math.max(1, Math.min(player.getInventory().getAmount(recipe.barId), player.getInventory().getAmount(recipe.logId)));
  player.getPacketSender().sendCreationMenu(
    new CreationMenu("What would you like to make?", [recipe.spearId, recipe.hastaId], {
      execute: (itemId, amount) => start(player, recipe, itemId, amount),
    }, { maxAmount: most })
  );
}

module.exports = function attach(api) {
  api.persistAttribute(TRAINED_ATTRIBUTE, false);
  api.onObjectInteraction(BARBARIAN_ANVIL, { Smith: smith });
  api.onItemOnObject(useBar, { noted: false });
};

Object.assign(module.exports, { TRAINED_ATTRIBUTE });
