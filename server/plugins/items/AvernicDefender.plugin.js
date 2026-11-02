/**
 * Avernic defender (Wiki: Avernic defender, Avernic defender hilt).
 *
 * The hilt on a dragon defender makes the defender after a confirmation, using up both. Dismantle
 * returns the dragon defender and destroys the hilt, also after asking. Inspect on the hilt gives
 * the Wiki's line. No capture makes one: the confirmation's words are ours.
 */
const INSPECT_LINE = "You raise the hilt, inspecting each section carefully. It looks as though it could combine with a powerful parrying dagger.";

let api = null;
let core = null;

function combine({ player }) {
  const I = core.ItemIdentifiers;
  api.sendMultiChatboxPrompt(player, "Combine the hilt with your dragon defender?",
    "Yes, make an Avernic defender.", () => {
      const inventory = player.getInventory();
      if (!inventory.contains(I.AVERNIC_DEFENDER_HILT) || !inventory.contains(I.DRAGON_DEFENDER)) return;
      inventory.delete(I.AVERNIC_DEFENDER_HILT, 1);
      inventory.delete(I.DRAGON_DEFENDER, 1);
      inventory.add(new core.Item(I.AVERNIC_DEFENDER, 1), true);
      player.sendMessage("You combine the hilt with the dragon defender to make an Avernic defender.");
    },
    "No, I'll keep them as they are.", () => {});
}

function dismantle({ player }) {
  const I = core.ItemIdentifiers;
  api.sendMultiChatboxPrompt(player, "Dismantling will destroy the hilt. Really dismantle it?",
    "Yes, dismantle it.", () => {
      const inventory = player.getInventory();
      if (!inventory.contains(I.AVERNIC_DEFENDER)) return;
      inventory.delete(I.AVERNIC_DEFENDER, 1);
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
