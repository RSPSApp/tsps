/**
 * Burning claws creation (docs/burning-claws.md, Creation; rsprox captures 1756 rev 227 tick 7068, 3327
 * rev 235 tick 78): using one Burning claw on another swaps the pair for Burning claws on the
 * same tick. The player plays human_crafting_bone_claws, synth sound 2694 (delay 8) is sent and
 * an objectbox shows the claws with "You bring the two claws together and combine them.". The
 * claws land in the first free slot once both claws are gone (slot 4 of 4/5 in 1756, slot 6 of
 * 14/18 in 3327). No skill is needed (Wiki: Burning claws). A claw used on its own slot does
 * nothing (1756 tick 5549: no message).
 */
const SEQUENCE = "human_crafting_bone_claws";
const SOUND = 2694;
const SOUND_DELAY = 8;
const TEXT = "You bring the two claws together and combine them.";

let api;

function combine({ player, usedItemSlot, usedWithItemSlot }) {
  if (usedItemSlot === usedWithItemSlot) return;
  const { Animation, CacheDefinitions, DialogueChainBuilder, ItemStatementDialogue, EndDialogue, ItemIdentifiers } = api.core;
  const inventory = player.getInventory();
  inventory.deleteAtSlot(usedItemSlot, 1, false);
  inventory.deleteAtSlot(usedWithItemSlot, 1, false);
  inventory.adds(ItemIdentifiers.BURNING_CLAWS, 1);
  const sequence = CacheDefinitions.getSeqId(SEQUENCE);
  if (sequence != null) player.performAnimation(new Animation(sequence));
  player.getPacketSender().sendSoundEffect(SOUND, 1, SOUND_DELAY, 255);
  const chain = new DialogueChainBuilder();
  chain.add(new ItemStatementDialogue(0, ItemIdentifiers.BURNING_CLAWS, TEXT));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

module.exports = {
  name: "BurningClaws",
  description: "Burning claws: use one Burning claw on another to combine them, with the captured animation, sound and item box.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onItemOnItem("Burning claw", "Burning claw", combine, { noted: false });
  },
  _test: { SEQUENCE, SOUND, SOUND_DELAY, TEXT },
};
