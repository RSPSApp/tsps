/**
 * Dragon hunter lance creation (docs/dragon-hunter-lance.md): a Hydra's claw used on a Zamorakian
 * hasta, or the other way round.
 *
 * Flow (rsprox capture 1532, rev 224, ticks 94-103): the warning box with both items
 * (objectbox_double: hasta, then claw), then a "Proceed with the alchemical combination. / Cancel."
 * menu. One tick after Proceed the lance takes the claw's slot and the hasta's slot empties, with
 * sequence 4462, spotanim 759, sound 140 and a success box showing the lance. No skill level is
 * checked: the Wiki (Dragon hunter lance) names none. The lance's dragonbane effect is
 * plugins/combat/effects/DragonHunter.EquipmentEffects.js.
 */
const MENU_TITLE = "Select an option";
const PROCEED = "Proceed with the alchemical combination.";
const CANCEL = "Cancel.";
const CONFIRM_TEXT = "Are you sure you wish to combine the Hydra claw and the Zamorakian hasta to create the Dragon hunter lance? This cannot be reversed.";
const SUCCESS_TEXT = "You successfully combine the Hydra claw and the Zamorakian hasta to create the Dragon hunter lance.";
const PRESET_TEXT = "Preset items cannot be used for this.";
const ANIMATION = 4462;
const SPOTANIM = 759;
const SOUND = 140;

let api;

function ids() {
  const { ItemIdentifiers } = api.core;
  return { claw: ItemIdentifiers.HYDRAS_CLAW, hasta: ItemIdentifiers.ZAMORAKIAN_HASTA, lance: ItemIdentifiers.DRAGON_HUNTER_LANCE };
}

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never combine. */
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

function cancel(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

function showMenu(player) {
  api.sendMultiChatboxPrompt(player, MENU_TITLE,
    PROCEED, () => proceed(player),
    CANCEL, () => cancel(player));
}

/** Claw on hasta (either way round): warn first, nothing is consumed yet. */
function ask({ player, usedItem, usedWithItem }) {
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  const { claw, hasta } = ids();
  if (plainSlot(player, claw) < 0 || plainSlot(player, hasta) < 0) return false;
  const { DialogueChainBuilder, DoubleItemStatementDialogue, ActionDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(new DoubleItemStatementDialogue(0, hasta, claw, CONFIRM_TEXT));
  chain.add(new ActionDialogue(1, { execute: () => showMenu(player) }));
  player.getDialogueManager().startDialogues(chain);
}

/**
 * Live keeps the menu up until the success box replaces it (rec 1532 ticks 99-100); ours closes it on
 * the click, because MultiChatboxPrompt always closes before running an option.
 */
function proceed(player) {
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1);
    }
    execute() {
      this.stop();
      combine(player);
    }
  })());
}

/** The items are checked again here: the inventory may have changed since the prompt. */
function combine(player) {
  const { claw, hasta, lance } = ids();
  const clawSlot = plainSlot(player, claw);
  const hastaSlot = plainSlot(player, hasta);
  if (clawSlot < 0 || hastaSlot < 0) {
    cancel(player);
    return false;
  }
  const { Item, Animation, Graphic, DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = api.core;
  const inventory = player.getInventory();
  inventory.setItem(hastaSlot, new Item(-1, 0));
  inventory.setItem(clawSlot, new Item(lance, 1));
  inventory.refreshItems();
  player.performAnimation(new Animation(ANIMATION));
  player.performGraphic(new Graphic(SPOTANIM));
  player.getPacketSender().sendSound(SOUND, 1, 0);
  const chain = new DialogueChainBuilder();
  chain.add(new ItemStatementDialogue(0, lance, SUCCESS_TEXT));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

module.exports = {
  name: "DragonHunterLance",
  description: "Lets players combine a Hydra's claw with a Zamorakian hasta into a Dragon hunter lance, after a warning and a Proceed or Cancel menu.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onItemOnItem("Hydra's claw", "Zamorakian hasta", ask, { noted: false });
  },
  _test: { CONFIRM_TEXT, SUCCESS_TEXT, PROCEED, CANCEL, combine },
};
