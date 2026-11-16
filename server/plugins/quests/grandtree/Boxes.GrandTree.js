/**
 * Which of The Grand Tree's transcript messages live shows in a box rather than the chatbox (rsprox capture
 * local 1002189, revision 242.1; the tick each was first seen). A message box (229) is `null`; an object box (193)
 * names the item it shows, and a double object box (11) names both. The box writes its text to the chat as a
 * mesbox line itself (Dialogue.ts), as live does. Every other transcript message stays a game message. The texts
 * are the transcript's, matched with `<br>` and colour tags dropped.
 */
const BOXES = new Map([
  ["The king shows you a sample of bark.", [783]], // t10312
  ["The king shows you a translation book.", [784]], // t10323
  ["The king hands you the bark sample and the translation book.", [783, 784]], // t10338
  ["The mage starts to speak but all you hear is:", null], // t10562
  ["You give the bark sample to Hazelmere.", [783]], // t10570
  ["The mage carefully examines the sample.", null], // t10574
  ["You make a writing motion. The mage scribbles something down on a scroll.", null], // t10588
  ["Hazelmere has given you the scroll.", [786]], // t10593
  ["The gnome is munching on a worm hole.", null], // t10875
  ["The gnome continues to eat.", null], // t10882
  ["You've found Glough's Journal!", [785]], // t11119
  ["The foreman has given you the lumber order.", [787]], // t11514
  ["Anita gives you a key.", [788]], // t11870
  ["You have found a scroll!", [794]], // t11989
  ["You give the King the invasion plans.", [794]], // t12081
  ["The King has given you some twigs lashed together.", [789]], // t12117
  ["With a grinding of machinery, a trapdoor snaps open!", null], // t12203
  ["You've found a Daconia rock!", [793]], // t12799
  ["You give the King the Daconia rock.", [793]], // t12831
]);

function key(text) {
  return String(text ?? "").replace(/<br>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** The `box` a message step needs, or null when live sends it to the chatbox. */
function boxFor(text) {
  const k = key(text);
  if (!BOXES.has(k)) return null;
  const items = BOXES.get(k);
  return items == null ? { statement: true } : { items: [...items] };
}

/**
 * Shows a captured box outside a conversation (a cupboard, chest or root search): the message box, or the object
 * box with its item. `after` runs once the player continues past it.
 */
function showBox(api, player, text, after = null) {
  const { DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, ActionDialogue } = api.core;
  const box = boxFor(text);
  const chain = new DialogueChainBuilder();
  chain.add(box?.items ? new ItemStatementDialogue(0, box.items[0], text) : new StatementDialogue(0, text));
  if (after) chain.add(new ActionDialogue(1, { execute: after }));
  player.getDialogueManager().startDialogues(chain);
}

module.exports = { BOXES, boxFor, key, showBox };
