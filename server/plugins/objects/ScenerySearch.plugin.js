/**
 * Generic scenery Search (Wiki: Haystack, Hay bale, Crate, Box). Haystacks and hay bales
 * can hide a needle: 10% needle, else 2% pricked for 1 Hitpoint (Mod Ash, cited by the
 * Wiki). Plain crates and boxes find nothing. Only the needle line is quoted by the Wiki;
 * the "nothing" line follows its Goblin Village crate text, and the pricked line is ours.
 * Only objects whose cache options include Search reach these handlers.
 *
 * The Icyene Graveyard's mud mound (rsprox 231/00392 ticks 7883, 8087): without a spade, the
 * mesbox "You need a spade to do that."; with one, human_dig and synth 1470, then the journal
 * page and the ancient armour into the inventory under an objectbox_double with both. The
 * Journal page reads in ReadingBooks. Ours: the mound gives the pair on every search, and needs
 * two free slots (the haystack's full-inventory line); no capture shows either case.
 *
 * Plain bookcases, old bookshelves and the Varrock book shelves (rsprox captures, 38 searches in
 * 21 recordings, revisions 227-242): "You search the books..." (spam), then one of three
 * lines picked at random on each search, the same loc giving different ones. Revision 239 on
 * (recordings 4282, local 1001726, 1002048, 1002053), both arrive together two ticks after the
 * player reaches the shelf; up to 233 the second came two ticks after the first. Ours: each line
 * equally likely. The third line is the Wiki's (Transcript:Bookcase), "You don't find anything you'd ever want
 * to read."; every recording has "...anything that you'd ever want to read.", the recorded
 * difference. The plain sacks (loc `sacks`, local 1000075, 1001339): "There's nothing
 * interesting in these sacks." on arrival.
 *
 * Books and sacks are fallbacks, so a quest's, area's or minigame's own bookcase still answers
 * first. Loaded after Quests so a quest's own crate or box search claims its objects first.
 */
const NEEDLE_CHANCE = 0.1;
const PRICK_CHANCE = 0.02;

const DIG_SOUND = 1470;
const MUD_MOUND_FIND = "You find an old journal page and some ancient armour<br>in the mud. You take them both.";
const MUD_MOUND_NO_SPADE = "You need a spade to do that.";

const BOOKS_SEARCHED = "You search the books...";
const BOOKS_NOTHING = [
  "None of them look very interesting.",
  "You find nothing to interest you.",
  "You don't find anything you'd ever want to read.",
];
/** The ticks from the handler (one after the arrival) to the two book messages, as of revision 239. */
const BOOKS_DELAY = 1;
/** "Shelf" is also a kitchen or shop shelf: only these two hold books. */
const BOOK_SHELVES = ["fai_varrock_shelf_books", "fai_varrock_shelves_books"];
const SACKS_NOTHING = "There's nothing interesting in these sacks.";

let core;

const locId = (name) => core.CacheDefinitions.getLocId(name);

function searchedNothing(event) {
  const name = String(event.definition?.getName?.() ?? "").toLowerCase();
  event.player.sendMessage(`You search the ${name}, but find nothing of interest.`);
}

function searchHay(event) {
  const { player } = event;
  const roll = Math.random();
  if (roll < NEEDLE_CHANCE) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) return void player.sendMessage("You don't have enough inventory space.");
    inventory.adds(core.ItemIdentifiers.NEEDLE, 1);
    player.sendMessage("Wow! A needle! Now what are the chances of finding that?");
    return;
  }
  if (roll < NEEDLE_CHANCE + PRICK_CHANCE) {
    player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(1, core.HitMask.RED)]);
    player.sendMessage("You prick your finger on a needle.");
    return;
  }
  searchedNothing(event);
}

function mesbox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function searchMudMound({ player }) {
  const { ItemIdentifiers, DialogueChainBuilder, DoubleItemStatementDialogue } = core;
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIdentifiers.SPADE)) return void mesbox(player, MUD_MOUND_NO_SPADE);
  if (inventory.getFreeSlots() < 2) return void player.sendMessage("You don't have enough inventory space.");
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_dig")));
  player.getPacketSender().sendSound(DIG_SOUND, 1, 0);
  inventory.adds(ItemIdentifiers.JOURNAL_PAGE, 1);
  inventory.adds(ItemIdentifiers.ANCIENT_ARMOUR, 1);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new DoubleItemStatementDialogue(0, ItemIdentifiers.JOURNAL_PAGE, ItemIdentifiers.ANCIENT_ARMOUR, MUD_MOUND_FIND)));
}

function searchBooks({ player }) {
  const { Task, TaskManager, ChatType } = core;
  const line = BOOKS_NOTHING[Math.floor(Math.random() * BOOKS_NOTHING.length)];
  TaskManager.submit(new (class extends Task {
    constructor() { super(BOOKS_DELAY, player, false); }
    execute() {
      this.stop();
      if (!player.isRegistered()) return;
      player.getPacketSender().sendTypedMessage(ChatType.SPAM, BOOKS_SEARCHED);
      player.sendMessage(line);
    }
  })());
}

function searchBookShelf(event) {
  if (!BOOK_SHELVES.some((name) => locId(name) === event.objectId)) return false;
  searchBooks(event);
}

function searchSacks({ objectId, player }) {
  if (objectId !== locId("sacks")) return false;
  player.sendMessage(SACKS_NOTHING);
}

module.exports = {
  name: "ScenerySearch",
  description: "Searching haystacks and hay bales, which can hide a needle or prick you, plain crates, boxes, sacks, bookcases and book shelves, which hold nothing, and the Icyene Graveyard's mud mound, dug with a spade.",
  dependsOn: ["Quests"],
  register(api) {
    core = api.core;
    api.onObjectInteraction("Haystack", { Search: searchHay });
    api.onObjectInteraction("Hay bale", { Search: searchHay });
    api.onObjectInteraction("Hay bales", { Search: searchHay });
    api.onObjectInteraction("Crate", { Search: searchedNothing });
    api.onObjectInteraction("Crates", { Search: searchedNothing });
    api.onObjectInteraction("Box", { Search: searchedNothing });
    api.onObjectInteraction("Boxes", { Search: searchedNothing });
    api.onObjectInteraction("Mud mound", { Search: searchMudMound });
    const fallback = { fallback: true };
    api.onObjectInteraction("Bookcase", { Search: searchBooks }, fallback);
    api.onObjectInteraction("Old Bookshelf", { Search: searchBooks }, fallback);
    api.onObjectInteraction("Shelf", { Search: searchBookShelf }, fallback);
    api.onObjectInteraction("Sacks", { Search: searchSacks }, fallback);
  },
};
