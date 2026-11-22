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
 * Wydin's stock-room crates in Port Sarim (potato_crate, cabbage_crate), rsprox 233/00465 ticks
 * 7190-7405: on arrival "There are a lot of potatoes in the crate."; four ticks later the chatmenu
 * "Do you want to take a potato?" Yes./No. Yes gives one potato with "You take a potato.",
 * human_pickuptable and synth 2582, or with a full inventory only "You do not have enough free
 * space to take a potato." They never run out. The banana crate beside them is Pirate's Treasure's.
 *
 * Plain crates and boxes (rsprox captures, 46 locs in about 50 recordings, revisions 227-242; the
 * Wiki quotes no line for them): "Crate" and "Crates" locs answer "You search the crate but find
 * nothing.", "Boxes" locs "There is nothing interesting in these boxes.", on arrival. The locs whose
 * recordings say something else (Falador, Varrock, the elid_ crates, the Wizards' Tower message
 * boxes) are named in data/crate-search.json; docs/scenery-search.md lists the recording ids.
 * Ours: a "Box" loc, or a haystack's empty search, keeps "You search the <name>, but find nothing
 * of interest." (no capture of either).
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
const CRATE_SEARCH = require("./data/crate-search.json");

/** Ticks from the "lot of" line to the take question (rsprox 233/00465 ticks 7315-7319, 7398-7404). */
const PRODUCE_PROMPT_TICKS = 4;
const PRODUCE_CRATES = [
  { loc: "potato_crate", item: "potato", one: "potato", many: "potatoes" },
  { loc: "cabbage_crate", item: "cabbage", one: "cabbage", many: "cabbages" },
];

let core;
let pluginApi;

const locId = (name) => core.CacheDefinitions.getLocId(name);

function searchedNothing(event) {
  const name = String(event.definition?.getName?.() ?? "").toLowerCase();
  event.player.sendMessage(`You search the ${name}, but find nothing of interest.`);
}

/** The captured "find nothing" line for this crate or box: its own, else its name's. */
function searchedEmpty(event) {
  const name = String(event.definition?.getName?.() ?? "");
  const own = Object.entries(CRATE_SEARCH.byLoc).find(([loc]) => locId(loc) === event.objectId)?.[1];
  const text = own?.text ?? CRATE_SEARCH.byName[name];
  if (!text) return searchedNothing(event);
  if (own?.mesbox) return mesbox(event.player, text);
  event.player.sendMessage(text);
}

function produceCrateFor(objectId) {
  return PRODUCE_CRATES.find((crate) => locId(crate.loc) === objectId);
}

function searchCrate(event) {
  const crate = produceCrateFor(event.objectId);
  if (!crate) return searchedEmpty(event);
  const { player } = event;
  player.sendMessage(`There are a lot of ${crate.many} in the crate.`);
  core.TaskManager.submit(new ProduceSearch(player, crate, event.location));
}

/** Still beside the crate and alive: a death in the four ticks (poison) moves them to the respawn. */
function besideCrate(player, tile) {
  const at = player.getLocation();
  return !player.isDyingReturn() && at.getZ() === tile.z
    && Math.abs(at.getX() - tile.x) <= 1 && Math.abs(at.getY() - tile.y) <= 1;
}

/**
 * The four ticks before the question hold the player still: a walk click is ignored (rsprox
 * 233/00465: move_gameclick on tick 7318, the question on 7319 with the player still on 3011,3204).
 * A click on the crate with the question open closes it and starts again (tick 7333); one during
 * the four ticks is ignored, like the walk click (unrecorded). Keyed to the player's index; stopping
 * it any way gives back the hold, unless another system took or released one since.
 * Built in register, once core (and its Task) is known.
 */
const produceSearchClass = (Task) => class ProduceSearch extends Task {
  constructor(player, crate, tile) {
    super(PRODUCE_PROMPT_TICKS, player.getIndex(), false);
    this.player = player;
    this.crate = crate;
    this.tile = tile;
    const queue = player.getMovementQueue();
    queue.reset().setBlockMovement(true);
    this.hold = queue.getBlockMovementGeneration();
  }

  execute() {
    this.stop();
    askToTake(this.player, this.crate, this.tile);
  }

  stop() {
    super.stop();
    const queue = this.player.getMovementQueue();
    if (this.hold !== null && queue.getBlockMovementGeneration() === this.hold) queue.setBlockMovement(false);
    this.hold = null;
  }
};
let ProduceSearch;

function askToTake(player, crate, tile) {
  if (!player.isRegistered() || !besideCrate(player, tile)) return;
  pluginApi.sendMultiChatboxPrompt(player, `Do you want to take a ${crate.one}?`, "Yes.", () => takeProduce(player, crate, tile), "No.", () => {});
}

function takeProduce(player, crate, tile) {
  if (!besideCrate(player, tile)) return;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) return void player.sendMessage(`You do not have enough free space to take a ${crate.one}.`);
  inventory.adds(core.CacheDefinitions.getObjId(crate.item), 1);
  player.sendMessage(`You take a ${crate.one}.`);
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_pickuptable")));
  core.Sounds.sendSound(player, core.Sound.PICK_UP_ITEM);
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
  description: "Searching haystacks and hay bales, which can hide a needle or prick you, plain crates, boxes, sacks, bookcases and book shelves, which hold nothing, Wydin's potato and cabbage crates in Port Sarim, which give one at a time, and the Icyene Graveyard's mud mound, dug with a spade.",
  dependsOn: ["Quests"],
  register(api) {
    core = api.core;
    pluginApi = api;
    ProduceSearch = produceSearchClass(core.Task);
    api.onObjectInteraction("Haystack", { Search: searchHay });
    api.onObjectInteraction("Hay bale", { Search: searchHay });
    api.onObjectInteraction("Hay bales", { Search: searchHay });
    api.onObjectInteraction("Crate", { Search: searchCrate });
    api.onObjectInteraction("Crates", { Search: searchedEmpty });
    api.onObjectInteraction("Box", { Search: searchedNothing });
    api.onObjectInteraction("Boxes", { Search: searchedEmpty });
    api.onObjectInteraction("Mud mound", { Search: searchMudMound });
    const fallback = { fallback: true };
    api.onObjectInteraction("Bookcase", { Search: searchBooks }, fallback);
    api.onObjectInteraction("Old Bookshelf", { Search: searchBooks }, fallback);
    api.onObjectInteraction("Shelf", { Search: searchBookShelf }, fallback);
    api.onObjectInteraction("Sacks", { Search: searchSacks }, fallback);
  },
};
