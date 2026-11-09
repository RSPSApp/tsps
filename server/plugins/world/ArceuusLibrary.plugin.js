"use strict";

/**
 * Arceuus Library: customer requests, the bookshelf search that finds the requested text, and
 * the hand-in.
 *
 * https://oldschool.runescape.wiki/w/Arceuus_Library
 * https://oldschool.runescape.wiki/w/Biblia
 * https://raw.githubusercontent.com/runelite/runelite/master/runelite-client/src/main/java/net/runelite/client/plugins/kourendlibrary/Library.java
 *
 * The 353 bookcase slots and the five 16-book sequences are RuneLite's public Kourend Library
 * data (Server/caches bookcase layout, BSD-2-Clause); every 80-100 minutes the game picks a new
 * sequence and starting slot, so a book is found in one of the 16 sequence positions, every
 * 22nd slot. Searching a shelf takes a copy of the book that is there; the layout does not
 * change when a copy is taken, so the same shelf yields another copy until the next reset.
 *
 * The customer requests and hand-in lines are the generated npc-dialogues.json records. The
 * Varlamore Envoy is only requested once The Depths of Despair is complete (the Wiki: it is
 * obtained during that quest, then normally available in the Library); while that quest's own
 * Galana search is active the shelf is left to the quest.
 *
 * Help (the customers' second option) starts the request directly, and Talk-to with the requested
 * book in the inventory hands it in. Biblia names the floor and bay of the requested book from the
 * current layout. The library's stairs have one "Climb" option whose direction depends on the
 * stair (rsprox 1702: 27853/27851 go up, 27852/27856 go down, with no prompt). A Book of Arcane
 * Knowledge is read for 15x Magic or 5x Runecraft experience (Wiki: Book of Arcane Knowledge).
 *
 * The empty-shelf line and the search animation are the live ones (846/207,
 * human_pickuptable); RuneLite detects an empty shelf from "You don't find anything useful
 * here." The found item box follows the format the Bear Your Soul shelf search already uses.
 */

const LIBRARY = require("./data/arceuus-library.json");
const SHELF_POINTS = new Map(LIBRARY.bookcases.map(([x, y, z, index]) => [index, `${x},${y},${z}`]));
// The source lists some physical shelves twice; never place two different books on one shelf.
const START_SLOTS = Array.from({ length: LIBRARY.bookcases.length }, (_, zero) => zero).filter((zero) => {
  const occupied = LIBRARY.sequences[0].map((_, position) =>
    SHELF_POINTS.get((zero + position * LIBRARY.step) % LIBRARY.bookcases.length));
  return new Set(occupied).size === occupied.length;
});

const SAM = 7049;
const PROFESSOR_GRACKLEBONE = 7048;
const VILLIA = 7047;
const CUSTOMERS = new Set([SAM, PROFESSOR_GRACKLEBONE, VILLIA]);
const BIBLIA = 7045;
const BOOK_OF_ARCANE_KNOWLEDGE = 13513;
const BOOK_OF_ARCANE_KNOWLEDGE_NAME = "Book of Arcane Knowledge";
const CUSTOMER_NAMES = ["Sam", "Professor Gracklebone", "Villia"];
const MAGIC_XP_PER_LEVEL = 15;
const RUNECRAFT_XP_PER_LEVEL = 5;
// Library stairs (cache name "Stairs", single "Climb" option); direction taken from rsprox 1702.
const STAIRS_UP = new Set([27851, 27853, 27854]);
const STAIRS_DOWN = new Set([27852, 27855, 27856]);
const FLOOR_NAMES = ["bottom", "middle", "top"];
// The central room sits between the two north-south shelf lines; the bays are the four corners.
const CENTRE = { x: 1632.5, y: 3807.5, halfWidth: 7, halfHeight: 7 };
const BIBLIA_FLOOR_PLACEHOLDER = "[bottom/middle/top] floor, [central area/north-eastern bay/south-eastern bay/south-western bay/north-western bay]";
const BOOK_HINT_PLACEHOLDER = "[book]";
const HELPING_CONDITION = "If the player is helping NPCs find books in the Arceuus Library:";
const VARLAMORE_ENVOY = 21756;
const DEPTHS_OF_DESPAIR = "the_depths_of_despair";
const DEPTHS_GALANA_STAGE = 3;

const LIBRARY_ZONE = { minX: 1600, maxX: 1665, minY: 3780, maxY: 3835, levels: [0, 1, 2] };
const SEARCH_ANIMATION = 832;
const EMPTY_MESSAGE = "You don't find anything useful here.";
const RESET_MESSAGE = "<col=ef1020>You hear the shifting of books due to a mysterious force...or are you just hearing things?</col>";
const RESET_MIN_MINUTES = 80;
const RESET_MAX_MINUTES = 100;
const RESET_CHECK_TICKS = 20;

const REQUEST_ATTRIBUTE = "arceuus-library:request";
const REQUEST_OPTION = "Sure, what book do you want?";
const BOOK_PLACEHOLDER = "[book name]";

const VARIANT = {
  findingThem: "standard-dialogue-while-finding-a-book-for-them",
  findingElsewhere: "standard-dialogue-while-finding-a-book-for-someone-else",
  turningIn: "standard-dialogue-turning-in-the-book",
};

let api;
let core;
let BOOKS = new Map();
let bookIds = new Set();
let bookcasesByPoint = new Map();
let arrangement = null;
let nextResetAt = 0;

const isCustomer = (npcId) => CUSTOMERS.has(npcId);

function pointOf(location) {
  if (!location) return null;
  const get = (method, prop) => typeof location[method] === "function" ? location[method]() : location[prop];
  const x = get("getX", "x");
  const y = get("getY", "y");
  const z = get("getZ", "z");
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, z: Number.isFinite(z) ? z : 0 } : null;
}

function inLibrary(location) {
  const at = pointOf(location);
  return !!at && LIBRARY_ZONE.levels.includes(at.z)
    && at.x >= LIBRARY_ZONE.minX && at.x <= LIBRARY_ZONE.maxX
    && at.y >= LIBRARY_ZONE.minY && at.y <= LIBRARY_ZONE.maxY;
}

function questStage(player, key) {
  const request = { player, key, stage: null };
  api.emitCustomEvent("quest:get-stage", request);
  return request.stage;
}

function depthsComplete(player) {
  return (questStage(player, DEPTHS_OF_DESPAIR) ?? 0) >= 9;
}

function requestOf(player) {
  const request = player.getAttribute(REQUEST_ATTRIBUTE);
  return request && Number.isInteger(request.npcId) && BOOKS.has(request.itemId) ? request : null;
}

function assignRequest(player, npcId, random = Math.random) {
  const items = [...BOOKS.keys()].filter((id) => id !== VARLAMORE_ENVOY || depthsComplete(player));
  const itemId = items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  player.setAttribute(REQUEST_ATTRIBUTE, { npcId, itemId });
  return itemId;
}

function clearRequest(player) {
  player.setAttribute(REQUEST_ATTRIBUTE, null);
}

function resetArrangement(random = Math.random) {
  const sequence = LIBRARY.sequences[Math.floor(random() * LIBRARY.sequences.length)];
  const zero = START_SLOTS[Math.floor(random() * START_SLOTS.length)];
  arrangement = { sequence, zero };
  const minutes = RESET_MIN_MINUTES + Math.floor(random() * (RESET_MAX_MINUTES - RESET_MIN_MINUTES + 1));
  nextResetAt = Date.now() + minutes * 60_000;
  return arrangement;
}

/** The book at a physical bookcase slot, or null. */
function bookAt(location) {
  const at = pointOf(location);
  if (!at || !arrangement) return null;
  const indices = bookcasesByPoint.get(`${at.x},${at.y},${at.z}`);
  if (!indices) return null;
  for (const index of indices) {
    const offset = (index - arrangement.zero + LIBRARY.bookcases.length) % LIBRARY.bookcases.length;
    if (offset % LIBRARY.step !== 0) continue;
    const position = offset / LIBRARY.step;
    if (position < arrangement.sequence.length) return arrangement.sequence[position];
  }
  return null;
}

function foundText(itemId) {
  const book = LIBRARY.books.find((entry) => entry.itemId === itemId);
  return `You find:<br><col=00007f>${book?.description ?? "a book"}</col><br>You take a copy.`;
}

function later(player, ticks, action) {
  const { CountdownTask } = core;
  const tasks = api.getTaskManager?.() ?? core.TaskManager;
  if (!CountdownTask || !tasks) { action(); return; }
  tasks.submit(new CountdownTask(player, ticks, () => {
    if (player.isRegistered?.() === false) return;
    action();
  }));
}

function search(event) {
  if (event.handled) return false;
  const { player } = event;
  const location = event.location ?? player.getLocation();
  if (!inLibrary(location)) return false;
  // The Depths of Despair's Galana step owns its assigned shelf while it is active.
  if (questStage(player, DEPTHS_OF_DESPAIR) === DEPTHS_GALANA_STAGE) return false;

  event.handled = true;
  const book = bookAt(location);
  player.performAnimation?.(new core.Animation(SEARCH_ANIMATION));
  if (book == null || (book === VARLAMORE_ENVOY && !depthsComplete(player))) {
    player.sendMessage(EMPTY_MESSAGE);
    return true;
  }
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    return true;
  }
  later(player, 1, () => {
    player.getInventory().adds(book, 1);
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
      new core.ItemStatementDialogue(0, book, foundText(book)),
    ));
  });
  return true;
}

/** Bear Your Soul's shelf fallback yields when the library layout can serve the shelf. */
function claimSearch(request) {
  if (request.handled) return;
  const location = request.location ?? request.player?.getLocation?.();
  if (!inLibrary(location)) return;
  if (questStage(request.player, DEPTHS_OF_DESPAIR) === DEPTHS_GALANA_STAGE) return;
  request.handled = true;
}

function onDialogueVariant(context) {
  if (!isCustomer(context.npcId)) return null;
  const request = requestOf(context.player);
  if (!request) return null;
  return request.npcId === context.npcId ? VARIANT.findingThem : VARIANT.findingElsewhere;
}

function onChoice(choice) {
  if (!isCustomer(choice.npcId) || choice.option !== REQUEST_OPTION) return;
  assignRequest(choice.player, choice.npcId);
}

/** Fill the transcript's "[book name]" from the request, for the customer who asked. */
function onLine(event) {
  if (!isCustomer(event.npcId) || typeof event.text !== "string" || !event.text.includes(BOOK_PLACEHOLDER)) return;
  const request = requestOf(event.player);
  if (!request || request.npcId !== event.npcId) return;
  event.text = event.text.replace(BOOK_PLACEHOLDER, BOOKS.get(request.itemId));
}

function handIn(event) {
  const { player, npcId, itemId, target } = event;
  const request = requestOf(player);
  if (!isCustomer(npcId) || !request || request.npcId !== npcId || request.itemId !== itemId) return;
  player.getInventory().deleteNumber(itemId, 1);
  player.getInventory().addItem(new core.Item(BOOK_OF_ARCANE_KNOWLEDGE, 1));
  clearRequest(player);
  event.handled = true;
  api.emitCustomEvent("arceuus-library:book-handed-in", { player, npcId, itemId });
  api.emitCustomEvent("npc-dialogue:start", {
    player, npc: target, npcId, variant: VARIANT.turningIn, handled: false,
  });
}

function onItemOnNpc(event) {
  if (event.handled || !bookIds.has(event.itemId)) return;
  handIn(event);
}

/** Where the requested book is on this layout: a floor and a bay name, or null. */
function locateBook(itemId) {
  if (!arrangement) return null;
  const position = arrangement.sequence.indexOf(itemId);
  if (position < 0) return null;
  const index = (arrangement.zero + position * LIBRARY.step) % LIBRARY.bookcases.length;
  const key = SHELF_POINTS.get(index);
  if (!key) return null;
  const [x, y, z] = key.split(",").map(Number);
  return { x, y, z, floor: FLOOR_NAMES[z], area: bayOf(x, y) };
}

function bayOf(x, y) {
  if (Math.abs(x - CENTRE.x) <= CENTRE.halfWidth && Math.abs(y - CENTRE.y) <= CENTRE.halfHeight) return "central area";
  return `${y > CENTRE.y ? "north" : "south"}-${x > CENTRE.x ? "eastern" : "western"} bay`;
}

/** Biblia's two blanks: the player's "[book]" and the floor and bay of the requested book. */
function onBibliaLine(event) {
  if (event.npcId !== BIBLIA || typeof event.text !== "string") return;
  const request = requestOf(event.player);
  if (!request) return;
  if (event.text.includes(BOOK_HINT_PLACEHOLDER)) {
    event.text = event.text.replace(BOOK_HINT_PLACEHOLDER, BOOKS.get(request.itemId));
  }
  if (event.text.includes(BIBLIA_FLOOR_PLACEHOLDER)) {
    const spot = locateBook(request.itemId);
    if (spot) event.text = event.text.replace(BIBLIA_FLOOR_PLACEHOLDER, `${spot.floor} floor, ${spot.area}`);
  }
}

/** Biblia's "I'm looking for a book..." option only shows while the player has a request. */
function onBibliaCondition(event) {
  if (event.npcId !== BIBLIA || event.text !== HELPING_CONDITION) return null;
  return requestOf(event.player) !== null;
}

/** Talk-to with the requested book in the inventory hands it in, as using it on the customer does. */
function talkToCustomer(event) {
  const { player, npc } = event;
  const npcId = npc.getId();
  const request = requestOf(player);
  if (!request || request.npcId !== npcId || !player.getInventory().contains(request.itemId)) return false;
  handIn({ player, npcId, itemId: request.itemId, target: npc });
  return true;
}

/** Help: the customer's request starts straight away, without the intro and menu. */
function helpCustomer(event) {
  if (talkToCustomer(event)) return true;
  const { player, npc } = event;
  const npcId = npc.getId();
  const start = { player, npc, npcId, handled: false };
  const request = requestOf(player);
  if (request) {
    start.variant = request.npcId === npcId ? VARIANT.findingThem : VARIANT.findingElsewhere;
    start.exact = true;
  } else {
    assignRequest(player, npcId);
    start.variant = "standard-dialogue";
    start.select = (steps) => steps.find((step) => step.type === "choice")
      ?.options.find((option) => option.text === REQUEST_OPTION)?.steps;
  }
  api.emitCustomEvent("npc-dialogue:start", start);
  if (!start.handled) clearRequest(player);
  return start.handled;
}

function climbStairs(request) {
  if (request.handled) return;
  const up = STAIRS_UP.has(request.objectId);
  if (!up && !STAIRS_DOWN.has(request.objectId)) return;
  api.emitCustomEvent(up ? "ladders:climbUp" : "ladders:climbDown", {
    player: request.player, object: request.object, objectId: request.objectId,
    clickType: request.clickType, location: request.object?.getLocation?.(),
  });
  request.handled = true;
}

/** Read: spend the book on Magic (15x level) or Runecraft (5x level) experience. */
function readBook({ player }) {
  const { Skill } = core;
  const spend = (skill, perLevel) => () => {
    const inventory = player.getInventory();
    if (!inventory.contains(BOOK_OF_ARCANE_KNOWLEDGE)) return;
    inventory.deleteNumber(BOOK_OF_ARCANE_KNOWLEDGE, 1);
    player.getSkillManager().addExperiences(skill, perLevel * player.getSkillManager().getMaxLevel(skill));
  };
  api.sendMultiChatboxPrompt(
    player,
    "Choose the experience you would like to gain:",
    "Magic", spend(Skill.MAGIC, MAGIC_XP_PER_LEVEL),
    "Runecraft", spend(Skill.RUNECRAFTING, RUNECRAFT_XP_PER_LEVEL),
  );
  return true;
}

function announceReset() {
  for (const player of core.World?.getPlayers?.() ?? []) {
    if (inLibrary(player.getLocation?.())) player.sendMessage(RESET_MESSAGE);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  BOOKS.clear();
  for (const book of LIBRARY.books) BOOKS.set(book.itemId, book.shortName);
  bookIds.clear();
  for (const itemId of BOOKS.keys()) bookIds.add(itemId);
  bookcasesByPoint.clear();
  for (const [x, y, z, index] of LIBRARY.bookcases) {
    const key = `${x},${y},${z}`;
    const indices = bookcasesByPoint.get(key) ?? [];
    indices.push(index);
    bookcasesByPoint.set(key, indices);
  }
  resetArrangement();
  pluginApi.persistAttribute(REQUEST_ATTRIBUTE, null);
  pluginApi.onNpcDialogueVariant(onDialogueVariant);
  pluginApi.onCustomEvent("npc-dialogue:choice", onChoice);
  pluginApi.onCustomEvent("npc-dialogue:line", onLine);
  pluginApi.onCustomEvent("arceuus-library:shelf-claim", claimSearch);
  pluginApi.onItemOnNpc(onItemOnNpc);
  pluginApi.onNpcDialogueCondition(onBibliaCondition);
  pluginApi.onCustomEvent("npc-dialogue:line", onBibliaLine);
  pluginApi.onCustomEvent("ladders:climb", climbStairs);
  pluginApi.onItemAction(BOOK_OF_ARCANE_KNOWLEDGE_NAME, { Read: readBook });
  for (const name of CUSTOMER_NAMES) pluginApi.onNpcInteraction(name, { Help: helpCustomer, "Talk-to": talkToCustomer });
  pluginApi.onObjectInteraction("Bookshelf", { Search: search });
  pluginApi.getTaskManager().submit(new (class LibraryResetTask extends core.Task {
    constructor() { super(RESET_CHECK_TICKS); }
    execute() {
      if (Date.now() < nextResetAt) return;
      resetArrangement();
      announceReset();
    }
  })());
}

module.exports = {
  name: "ArceuusLibrary",
  description: "Arceuus Library: customers Sam, Professor Gracklebone and Villia request books, shelves are searched for the rotating layout, and the book is handed in.",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
  },
  _test: {
    SAM, PROFESSOR_GRACKLEBONE, VILLIA, CUSTOMERS, BOOK_OF_ARCANE_KNOWLEDGE, BOOKS,
    REQUEST_ATTRIBUTE, REQUEST_OPTION, BOOK_PLACEHOLDER, VARIANT, LIBRARY_ZONE,
    SEARCH_ANIMATION, EMPTY_MESSAGE, RESET_MESSAGE, VARLAMORE_ENVOY, DEPTHS_OF_DESPAIR,
    BIBLIA, STAIRS_UP, STAIRS_DOWN, locateBook, bayOf, onBibliaLine, onBibliaCondition,
    talkToCustomer, helpCustomer, climbStairs, readBook,
    isCustomer, requestOf, assignRequest, clearRequest, resetArrangement, bookAt, foundText,
    search, claimSearch, onDialogueVariant, onChoice, onLine, handIn, onItemOnNpc,
    get arrangement() { return arrangement; },
  },
};
