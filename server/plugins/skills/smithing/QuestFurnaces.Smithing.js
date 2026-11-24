/**
 * Furnaces a quest opens (data/furnaces.json `quests`). Cam Torum's Forge "can be used as a regular
 * furnace after the completion of Perilous Moons" (OSRS Wiki, Forge (Cam Torum)). Before the quest,
 * its options and any item used on it are refused ahead of Smithing, Crafting and the Desert Treasure II
 * rings, which all share the furnace names. Live's refusal is unrecorded: the message is ours.
 */
const Core = require("./Core.Smithing");

const QUEST_FURNACES = require("../data/furnaces.json").quests;

function nameOf(event) {
  return (event.definition ?? event.object?.getDefinition?.())?.getName?.();
}

/** The gate for this loc when the player has not completed its quest yet, else null. */
function lockedGate(player, name) {
  const gate = Object.hasOwn(QUEST_FURNACES, name ?? "") ? QUEST_FURNACES[name] : null;
  if (!gate || Core.questComplete(player, gate.quest)) return null;
  return gate;
}

function refuse(event) {
  const gate = event.player && lockedGate(event.player, nameOf(event));
  if (!gate) return;
  event.handled = true;
  event.player.sendMessage(gate.message);
}

module.exports = function attach(api) {
  api.onBeforeObjectInteraction(refuse);
  api.onItemOnObject(refuse, { before: true });
};

Object.assign(module.exports, { QUEST_FURNACES, lockedGate, refuse });
