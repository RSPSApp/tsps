/**
 * Dragonbone necklace (https://oldschool.runescape.wiki/w/Dragonbone_necklace): while it is worn,
 * burying bones, or a bonecrusher crushing them, gives back the bone's Prayer restore (1 for bones
 * up to 5 for superior dragon bones; plugins/skills/data/bones.json). It works straight away (the
 * nine-second wait was removed in April 2021), not for demonic ashes, and doesn't stack with the
 * Catacombs of Kourend's restore. Its only drop is Vorkath, already in npc-drops.json.
 */
let core = null;

function wearing(player) {
  const necklace = player.getEquipment().get(core.Equipment.AMULET_SLOT);
  return necklace?.getId?.() === core.ItemIdentifiers.DRAGONBONE_NECKLACE;
}

/** "prayer:bone-restore": the necklace gives back the bone's Prayer points. */
function boneRestore(event) {
  if (wearing(event.player)) event.restore = Math.max(event.restore, event.points);
}

module.exports = {
  name: "DragonboneNecklace",
  description: "Dragonbone necklace: while worn, burying or crushing bones restores Prayer points.",
  members: true,
  register(api) {
    core = api.core;
    api.onCustomEvent("prayer:bone-restore", boneRestore);
  },
};
