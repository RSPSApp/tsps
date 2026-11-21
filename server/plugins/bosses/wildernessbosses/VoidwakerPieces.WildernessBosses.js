/**
 * The three Voidwaker pieces the Wilderness bosses drop (the hilt from Callisto and Artio, the
 * blade from Vet'ion and Calvar'ion, the gem from Venenatis and Spindel).
 *
 * Wiki (Voidwaker hilt, Voidwaker blade, Voidwaker gem): "When inspected, a message in the
 * chatbox states" each piece's line below. Wiki (Voidwaker): "Attempting to combine the pieces
 * on your own displays the message" COMBINE_MESSAGE; Madam Sikaro in the Ferox Enclave Dungeon
 * assembles them. Nothing changes in the inventory. No rsprox recording has either action
 * (docs/wilderness-bosses.md).
 */
const PIECES = Object.freeze({
  "Voidwaker hilt": "A sturdy hilt. It's part of what looks to be a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
  "Voidwaker blade": "A sharp blade. It looks to be the deadliest part of a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
  "Voidwaker gem": "A magical gem. It looks like it could be fitted into a powerful weapon. Perhaps someone in Ferox Enclave would know what it is?",
});
const COMBINE_MESSAGE = "You don't think you have the skills to reassemble this weapon yourself.";

let core;

/** Inspect: the piece's line in the chat. */
function inspectPiece({ player, itemId }) {
  const line = PIECES[core.ItemDefinition.forId(itemId).getName()];
  if (!line) return false;
  player.sendMessage(line);
  return true;
}

/** One piece used on another: the player can't put the weapon together. */
function combinePieces({ player }) {
  player.sendMessage(COMBINE_MESSAGE);
  return true;
}

function attach(api) {
  core = api.core;
  for (const name of Object.keys(PIECES)) api.onItemAction(name, { Inspect: inspectPiece });
  const names = Object.keys(PIECES);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) api.onItemOnItem(names[i], names[j], combinePieces, { noted: false });
  }
}

module.exports = { attach, _test: { PIECES, COMBINE_MESSAGE, inspectPiece, combinePieces } };
