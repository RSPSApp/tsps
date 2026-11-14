/**
 * The tatty note by the skeleton in the north of the Meiyerditch Laboratories, by the ruins to the
 * true Blood Altar (docs/meiyerditch-tatty-note.md). Searching the skeleton gives the note, Read
 * opens it in the long scroll (rsprox.net rec 395, rev 231).
 */
const SKELETON = 38091; // blood_altar_skeleton
const NOTE = 24684; // blood_altar_note "Tatty note"
const LONGSCROLL = 625;
const LONGSCROLL_SETUP = 418;

const FOUND = "You find a note by the skeleton which you take.";
const NOTHING = "You search the skeleton, but find nothing of interest.";
/** Ours: no capture or Wiki line for a full backpack. */
const NO_SPACE = "You don't have enough inventory space.";

/** Live sends an empty title (rec 395 tick 24079); "<br>" breaks the paragraphs. */
const NOTE_TITLE = "";
const NOTE_TEXT = [
  "He stabbed me! He actually stabbed me! And now here I am, bleeding out on the floor. You'd think that living in Morytania I'd have prepared myself for death, but I find the idea of my impending end more terrifying then I would have ever thought possible. Still, that is not why I write this note. As it's likely that I'll have left this world before I'm found here, this is my only way to explain what happened here.",
  "First, some background. Along with a few of the others, I was recently reassigned to mine out some new caves north of the current laboratories. The vampyres wish to expand their research operations down here and more room is needed. After many weeks of mining, we ended up breaking through into another set of tunnels. Saradomin only knows how long they've been here, but it's clear they are not natural.",
  "Most of the others went back to report what we'd found. Jovan though, being the fool he is, decided he wanted to take a closer look. I should have gone back with the others, but I didn't want to leave him alone. Big mistake. We soon found ourselves in a large chamber full of coffins and gravestones. The same chamber where you'll have likely found this note.",
  "At one end of the chamber, there were some strange ruins giving out a weird light. On the floor before them sat a strange talisman and a dagger. As we got closer, I could swear I heard someone whispering to me. I looked around and saw no one though. I called out to Jovan and told him we should head back. At that point though, something terrible happened. He turned to face me but there was a dark look in his eyes, like his mind wasn't his own anymore. He picked up the talisman and the dagger and walked towards me. Before I could do anything, he stabbed me right in the chest. As he did, he leaned towards me and said, 'this blood will make things right'. As I fell to the floor, I saw him run out of the chamber and head off through the unexplored tunnels.",
  "Well, there you have it. Just a little story of how my end finally came for me. If you want my advice, which you probably don't, you should seal this place. There's a darkness here that should remain hidden.",
].join("<br><br>");

let core;

/**
 * Search: the note goes into the backpack with an objectbox of it (rec 395 ticks 23976-23978).
 * Holding it already, the search finds nothing (tick 24049, the note in the backpack).
 * Ours: a banked or dropped note does not stop another being found; the Wiki says nothing.
 */
function searchSkeleton(event) {
  const { player, objectId } = event;
  if (objectId !== SKELETON) return false;
  const inventory = player.getInventory();
  if (inventory.contains(NOTE)) {
    player.sendMessage(NOTHING);
    return true;
  }
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  inventory.addItem(new core.Item(NOTE, 1));
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, NOTE, FOUND)));
  return true;
}

/** Read: the long scroll opens on the click, with no animation or sound (rec 395 tick 24079). */
function readNote(event) {
  if (event.itemId !== NOTE) return false;
  event.player.getPacketSender().sendInterface(LONGSCROLL).sendClientScript(LONGSCROLL_SETUP, NOTE_TITLE, NOTE_TEXT);
  return true;
}

module.exports = {
  name: "MeiyerditchTattyNote",
  description: "Searching the skeleton by the true Blood Altar ruins in the Meiyerditch Laboratories gives the tatty note, which can be read.",
  members: true,
  NOTE_TEXT,
  register(api) {
    core = api.core;
    api.onObjectInteraction("Skeleton", { Search: searchSkeleton });
    api.onItemAction("Tatty note", { Read: readNote });
  },
};
