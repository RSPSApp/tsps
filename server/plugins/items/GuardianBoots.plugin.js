/**
 * Guardian boots: a black tourmaline core used on Bandos boots (Wiki: Guardian boots, Black
 * tourmaline core). No level, no experience, and it cannot be undone.
 *
 * Flow (rsprox capture 2225, rev 228, ticks 221-229): a two-item box with the boots and the core
 * asking for confirmation, then a "Yes." / "No." menu. One tick after Yes the boots and core
 * are replaced by guardian boots and an item box shows them with the absorption text. No
 * animation, graphic, sound or experience is sent. The Wiki transcript has the same three texts.
 * The boots go to the first free slot; in the capture that was the core's slot, so the capture
 * can't tell it from "the core's slot".
 * Ours: No. only closes the menu (not captured), and only the core-on-boots order is captured;
 * boots-on-core runs the same flow.
 */
const CONFIRM_TEXT = "Do you really want to combine these items together into Guardian boots? You cannot undo this process.";
const MENU_TITLE = "Really combine these into guardian boots?";
const YES = "Yes.";
const NO = "No.";
const SUCCESS_TEXT = "The second you hold your tourmaline core by the Bandos boots, the core is absorbed rapidly. Perhaps there is some link between the metal in Bandos and tourmaline...";
const PRESET_TEXT = "Preset items cannot be used for this.";

let api;

function ids() {
  const I = api.core.ItemIdentifiers;
  return { boots: I.BANDOS_BOOTS, core: I.BLACK_TOURMALINE_CORE, result: I.GUARDIAN_BOOTS };
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

function hasIngredients(player) {
  const { boots, core } = ids();
  return plainSlot(player, boots) >= 0 && plainSlot(player, core) >= 0;
}

function closeChatbox(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

function showMenu(player) {
  api.sendMultiChatboxPrompt(player, MENU_TITLE,
    YES, () => confirm(player),
    NO, () => closeChatbox(player));
}

/** Core used on the boots (either way round): ask first, nothing is consumed yet. */
function useCoreOnBoots({ player, usedItem, usedWithItem }) {
  const { boots, core } = ids();
  const used = [usedItem.getId(), usedWithItem.getId()];
  // Other items that share the names (placeholders, other copies) are not ingredients.
  if (!used.includes(boots) || !used.includes(core)) return false;
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  if (!hasIngredients(player)) return true;
  const { DialogueChainBuilder, DoubleItemStatementDialogue, ActionDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(new DoubleItemStatementDialogue(0, boots, core, CONFIRM_TEXT));
  chain.add(new ActionDialogue(1, { execute: () => showMenu(player) }));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

/** Yes: the boots appear one tick later (capture 2225, ticks 226-227). */
function confirm(player) {
  closeChatbox(player);
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

/** The ingredients are checked again here: the inventory may have changed since the prompt. */
function combine(player) {
  if (!hasIngredients(player)) return false;
  const { boots, core, result } = ids();
  const { Item, DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = api.core;
  const inventory = player.getInventory();
  inventory.deleteAtSlot(plainSlot(player, core), 1);
  inventory.deleteAtSlot(plainSlot(player, boots), 1);
  inventory.addItem(new Item(result, 1));
  const chain = new DialogueChainBuilder();
  chain.add(new ItemStatementDialogue(0, result, SUCCESS_TEXT));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

module.exports = {
  name: "GuardianBoots",
  description: "Lets players use a black tourmaline core on Bandos boots to make guardian boots, after a confirmation.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onItemOnItem("Black tourmaline core", "Bandos boots", useCoreOnBoots, { noted: false });
  },
  _test: { combine, CONFIRM_TEXT, MENU_TITLE, SUCCESS_TEXT },
};
