/**
 * Avernic defender (Wiki: Avernic defender, Avernic defender hilt).
 *
 * The hilt on a dragon defender makes the defender after a confirmation, using up both. Dismantle
 * returns the dragon defender and destroys the hilt, also after asking. Inspect on the hilt gives
 * the Wiki's line. No capture makes one: the confirmation's words are ours.
 * Preset (untradeable, unbankable) copies never convert: they are refused at the prompt and only an
 * unrestricted instance is consumed at Yes, so a free preset item cannot become a plain one.
 */
const INSPECT_LINE = "You raise the hilt, inspecting each section carefully. It looks as though it could combine with a powerful parrying dagger.";

const PRESET_TEXT = "Preset items cannot be used for this.";

let api = null;
let core = null;

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never convert. */
function restricted(item) {
  const Item = core.Item;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

/** The slot of an unrestricted copy of the item: the instance that is actually consumed. */
function plainSlot(player, itemId) {
  return player.getInventory().getItems().findIndex((item) => item && item.getId() === itemId && !restricted(item));
}

function combine({ player, usedItem, usedWithItem }) {
  const I = core.ItemIdentifiers;
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  api.sendMultiChatboxPrompt(player, "Combine the hilt with your dragon defender?",
    "Yes, make an Avernic defender.", () => {
      const inventory = player.getInventory();
      const hilt = plainSlot(player, I.AVERNIC_DEFENDER_HILT);
      const defender = plainSlot(player, I.DRAGON_DEFENDER);
      if (hilt < 0 || defender < 0) return;
      inventory.deleteAtSlot(hilt, 1);
      inventory.deleteAtSlot(defender, 1);
      inventory.add(new core.Item(I.AVERNIC_DEFENDER, 1), true);
      player.sendMessage("You combine the hilt with the dragon defender to make an Avernic defender.");
    },
    "No, I'll keep them as they are.", () => {});
}

function dismantle({ player, item }) {
  const I = core.ItemIdentifiers;
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  api.sendMultiChatboxPrompt(player, "Dismantling will destroy the hilt. Really dismantle it?",
    "Yes, dismantle it.", () => {
      const inventory = player.getInventory();
      const defender = plainSlot(player, I.AVERNIC_DEFENDER);
      if (defender < 0) return;
      inventory.deleteAtSlot(defender, 1);
      inventory.add(new core.Item(I.DRAGON_DEFENDER, 1), true);
      player.sendMessage("You dismantle the defender. The hilt crumbles to dust.");
    },
    "No.", () => {});
}

function inspect({ player }) {
  player.sendMessage(INSPECT_LINE);
}

module.exports = {
  name: "AvernicDefender",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    api.onItemOnItem("Avernic defender hilt", "Dragon defender", combine, { noted: false });
    api.onItemAction("Avernic defender", { Dismantle: dismantle });
    api.onItemAction("Avernic defender hilt", { Inspect: inspect });
  },
  _test: { combine, dismantle, inspect },
};
