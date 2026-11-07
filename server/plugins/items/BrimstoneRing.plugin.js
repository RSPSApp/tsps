/**
 * Brimstone ring creation (docs/brimstone-ring.md; https://oldschool.runescape.wiki/w/Hydra%27s_eye
 * and its transcript): using any two of the Hydra's eye, fang and heart on each other, with the
 * third in the inventory, warns that it can't be reversed, then asks to Proceed or Cancel. Proceed
 * swaps the three for the ring and says so. The ring's magic defence effect is
 * plugins/combat/effects/BrimstoneRing.EquipmentEffects.js. No capture shows the combination, so
 * its text and menu are the Wiki transcript's, and the swap is immediate.
 */
const { restricted, plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");

const MENU_TITLE = "Select an option";
const PROCEED = "Proceed with the combination.";
const CANCEL = "Cancel.";
const CONFIRM_TEXT = "Are you sure you wish to combine the <col=ff0000>Hydra Heart, the Hydra Eye, and Hydra Fang into the Brimstone Ring? This cannot be reversed.</col>";
const SUCCESS_TEXT = "You successfully combine the Hydra Heart, the Hydra Eye, and the Hydra Fang into the Brimstone Ring.";
const PARTS = ["Hydra's eye", "Hydra's fang", "Hydra's heart"];
const PART_IDS = ["HYDRAS_EYE", "HYDRAS_FANG", "HYDRAS_HEART"];

let api;

function partIds() {
  return PART_IDS.map((name) => api.core.ItemIdentifiers[name]);
}

function hasParts(player) {
  return partIds().every((id) => plainAmount(player.getInventory(), id) > 0);
}

function cancel(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

function combine(player) {
  cancel(player);
  if (!hasParts(player)) return;
  const { Item, ItemIdentifiers, DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = api.core;
  const inventory = player.getInventory();
  for (const id of partIds()) takePlain(inventory, id, 1);
  inventory.addItem(new Item(ItemIdentifiers.BRIMSTONE_RING, 1));
  const chain = new DialogueChainBuilder();
  chain.add(new ItemStatementDialogue(0, ItemIdentifiers.BRIMSTONE_RING, SUCCESS_TEXT));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

function showMenu(player) {
  api.sendMultiChatboxPrompt(player, MENU_TITLE,
    PROCEED, () => combine(player),
    CANCEL, () => cancel(player));
}

/** Two parts used on each other: with all three carried, ask first and consume nothing yet. */
function useParts({ player, usedItem, usedWithItem }) {
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (!hasParts(player)) return false;
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  chain.add(new StatementDialogue(0, CONFIRM_TEXT));
  chain.add(new ActionDialogue(1, { execute: () => showMenu(player) }));
  player.getDialogueManager().startDialogues(chain);
}

module.exports = {
  name: "BrimstoneRing",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onItemOnItem("Hydra's eye", "Hydra's fang", useParts, { noted: false });
    api.onItemOnItem("Hydra's eye", "Hydra's heart", useParts, { noted: false });
    api.onItemOnItem("Hydra's fang", "Hydra's heart", useParts, { noted: false });
  },
  _test: { PARTS, CONFIRM_TEXT, SUCCESS_TEXT, combine },
};
