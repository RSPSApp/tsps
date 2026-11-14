/**
 * Inspect on items whose only answer is a line beside the item: the object box (193), the line
 * also going to the chat. The lines and the items are in data/item-inspects.json, from rsprox.net
 * index recordings (docs/item-inspects.md). Inspecting changes nothing.
 */
const lines = require("./data/item-inspects.json");

/** Item name -> its Inspect line. */
const INSPECTS = new Map(Object.entries(lines).filter(([name]) => !name.startsWith("_")));

let core;

/** The item's object box, its line wrapped as live breaks it. */
function inspect({ player, itemId }) {
  const text = INSPECTS.get(core.ItemDefinition.forId(itemId).getName());
  if (!text) return false;
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, itemId, core.ChatTextLayout.wrap(text).join("<br>"))));
}

module.exports = {
  name: "ItemInspects",
  description: "Inspect on the sailing keys and shipbuilding parts (stormy, fetid and serrated keys, barrel stand, bottled storm, captured wind mote, Heart of Ithell, the three Barracuda Trial fabric rolls) and the unscented vyre noble disguise shows the item's line in an object box.",
  members: true,
  _test: { INSPECTS, inspect },
  register(api) {
    core = api.core;
    for (const name of INSPECTS.keys()) api.onItemAction(name, { Inspect: inspect });
  },
};
