// The Lumbridge resident who saw the cave goblin in the cellar (docs/quests/the-lost-tribe/README.md).
//
// Transcript:The Lost Tribe (revision 15398483): "the NPC who saw the goblin ... can be the cook,
// hans, bob, or aereck". Their lines are spoken by "NPC", and the player and Sigmund name them as
// "[NPC]"; each of the four answers with their own "Asking ..." section when they are not the
// witness. rsprox 20261112T152024-5ab63b4 (revision 242): Hans was that account's witness; asked
// "Do you know what happened in the cellar?" he spoke the witness lines (ticks 69-73), and the
// Duke's option read "Hans says he saw something in the cellar" (tick 115), Sigmund's "... enough to
// prove Hans's story" (tick 313).
//
// Ours: which of the four it is, picked evenly when the quest starts (the Wiki gives no odds; Father
// Aereck is left out while the player is in the middle of The Restless Ghost, whose dialogue he keeps), and
// how the Cook and Father Aereck are named ("The cook" follows the Wiki's quick guide, "The cook
// says he saw something in the cellar"; Father Aereck is unrecorded).
const WITNESS_ATTRIBUTE = "lost-tribe:witness";
const WITNESS_VARIANT = "a-hole-in-the-wall-talking-to-the-npc-who-saw-the-goblin";
const WITNESS_AGAIN_VARIANT = `${WITNESS_VARIANT}-talking-to-them-again`;
const PLACEHOLDER_SPEAKER = "NPC";
const CELLAR_QUESTION = /what happened in the (castle )?cellar\?$/i;

module.exports = function createWitness(api) {
  const { NpcIdentifiers } = api.core;
  // 1-based, as saved: 0 is "not picked yet".
  const WITNESSES = [
    { npcId: NpcIdentifiers.COOK_7, name: "Cook", subject: "The cook", possessive: "the cook's",
      variant: "a-hole-in-the-wall-asking-the-cook" },
    { npcId: NpcIdentifiers.HANS, name: "Hans", subject: "Hans", possessive: "Hans's",
      variant: "a-hole-in-the-wall-asking-hans" },
    { npcId: NpcIdentifiers.BOB_15, name: "Bob", subject: "Bob", possessive: "Bob's",
      variant: "a-hole-in-the-wall-asking-bob" },
    { npcId: NpcIdentifiers.FATHER_AERECK, name: "Father Aereck", subject: "Father Aereck", possessive: "Father Aereck's",
      variant: "a-hole-in-the-wall-asking-father-aereck" },
  ];
  /** Saves from before the witness was picked were told by Bob, the only witness then. */
  const LEGACY_WITNESS = 3;
  const BY_NPC = new Map(WITNESSES.map((witness) => [witness.npcId, witness]));

  api.persistAttribute(WITNESS_ATTRIBUTE, 0);

  /** `exclude` (npc ids) leaves out someone who can't answer yet: Father Aereck mid-Restless Ghost. */
  function pick(player, exclude = []) {
    const open = WITNESSES.map((witness, index) => [witness, index + 1]).filter(([witness]) => !exclude.includes(witness.npcId));
    player.setAttribute(WITNESS_ATTRIBUTE, open[Math.floor(Math.random() * open.length)][1]);
  }

  /** The player's witness; a save already past asking around keeps Bob. */
  function of(player, askedAround, exclude = []) {
    let index = Number(player.getAttribute(WITNESS_ATTRIBUTE)) || 0;
    if (index < 1 || index > WITNESSES.length) {
      if (askedAround) player.setAttribute(WITNESS_ATTRIBUTE, LEGACY_WITNESS);
      else pick(player, exclude);
      index = Number(player.getAttribute(WITNESS_ATTRIBUTE));
    }
    return WITNESSES[index - 1];
  }

  const candidate = (npcId) => BY_NPC.get(npcId) ?? null;

  /** "[NPC] says ..." and "... prove [NPC]'s story" with the witness's name. */
  function fill(text, witness) {
    return String(text).replace(/\[NPC\]'s/g, (_, offset) => (offset === 0 ? cap(witness.possessive) : witness.possessive))
      .replace(/\[NPC\]/g, witness.subject);
  }

  function cap(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** The witness section's lines, without its one-option menu: what the cellar question leads to. */
  const witnessAnswer = (steps) => steps[0]?.options?.[0]?.steps ?? [];

  return {
    WITNESS_VARIANT, WITNESS_AGAIN_VARIANT, PLACEHOLDER_SPEAKER, CELLAR_QUESTION,
    pick, of, candidate, fill, witnessAnswer,
  };
};
