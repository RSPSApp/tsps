// rsprox recording 3174, ticks 71-160; see docs/farming.md.
let api;

function give(player, names) {
  const inventory = player.getInventory();
  const missing = names.filter(name => !inventory.contains(api.core.ItemIdentifiers[name.toUpperCase()]));
  if (!missing.length) return;
  // Ours: require enough room for the entire selection; the capture does not cover a full bag.
  if (inventory.getFreeSlots() < missing.length) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  for (const name of missing) {
    inventory.adds(api.core.ItemIdentifiers[name.toUpperCase()], 1);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, `You 'borrow' a ${name}.`);
  }
}

function takeTools({ player, objectId }) {
  if (objectId !== api.core.CacheDefinitions.getLocId("farming_shed_tools")) return false;
  const inventory = player.getInventory();
  const rake = inventory.contains(api.core.ItemIdentifiers.RAKE);
  const spade = inventory.contains(api.core.ItemIdentifiers.SPADE);
  if (rake && spade) {
    player.sendMessage("You've already got a spade and a rake.");
  } else if (rake || spade) {
    give(player, [rake ? "spade" : "rake"]);
  } else {
    api.sendMultiChatboxPrompt(player, "Which would you like to take?",
      "Rake", () => give(player, ["rake"]),
      "Spade", () => give(player, ["spade"]),
      // Ours: both tools are given with the same individual lines as each single selection.
      "Both", () => give(player, ["rake", "spade"]));
  }
  return true;
}

function attach(pluginApi) {
  api = pluginApi;
  api.onObjectInteraction("Tools", { Take: takeTools });
}
module.exports = { attach };
