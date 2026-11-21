/**
 * Misthalin area interactions: Edgeville, Varrock and the Wizards' Tower.
 *
 * Edgeville
 *  - Ladder at 3097,9867 (dungeon) > Climb-up: surface at 3096,3468.
 *  - Trapdoor at 3097,3468 > Open: dungeon at 3096,9867.
 *  - Lever at 3090,3475: the Levers plugin (docs/wilderness-levers.md).
 *
 * Varrock
 *  - Manhole at 3237,3458 > Open/Close: swap the closed (881) and open (882) locs.
 *  - Manhole > Climb-down: sewer landing at 3237,9858; the sewer Ladder > Climb-up
 *    returns to the manhole.
 *  - The West Bank's locked back Door (fai_varrock_bank_locked_door, 3186,3446) > Knock-at: the
 *    player's "I don't think I'm ever going to be allowed in there.", "Knock knock...", the
 *    Banker's "Who's there?" and five knock-knock answers (rsprox.net rec 3213 ticks 4464-5070,
 *    five knocks, each answer once). The door never opens.
 *
 * Wizards' Tower basement (a y+6400 dungeon, so the generic Ladders plugin can't
 * link it): the ground-floor Ladder at 3104,3162 climbs down to the basement
 * landing at 3104,9576, and the basement Ladder at 3103,9576 climbs back up in
 * front of the ground-floor ladder at 3105,3162.
 *
 * Lumbridge Swamp Caves
 *  - Dark hole at 3169,3172 > Use Rope: ties a rope and sets the SWAMP_CAVES_ROPED_ENTRANCE
 *    varbit (279) for good (Wiki). The rope is used up.
 *  - Dark hole > Climb-down: the tile below the side the player used, once roped. Without a
 *    tinderbox the swamp cave warning (cws_warning_13, shown by WarningScreens) comes first:
 *    "...Are you sure you want to go in without a tinderbox?", its answers rewritten as live does
 *    (rsprox_transcripts/242/911917.txt tick 21674).
 *  - Symbol (the cave goblin markers on the cave walls) > Look-at: shows that marker in the
 *    cave_goblin_markers modal (rsprox.net rec 3182, rev 232).
 */
let pluginApi;
let Location, Animation, GameObject, CacheDefinitions, ObjectManager, Objects, Items;
let climbDownAnimation;

// Edgeville
const EDGEVILLE_DUNGEON_LADDER = { x: 3097, y: 9867, z: 0 };
const EDGEVILLE_SURFACE = { x: 3096, y: 3468, z: 0 };
const EDGEVILLE_TRAPDOOR = { x: 3097, y: 3468, z: 0 };
const EDGEVILLE_DUNGEON_LANDING = { x: 3096, y: 9867, z: 0 };

// Varrock
const VARROCK_MANHOLE = { x: 3237, y: 3458, z: 0 };
const VARROCK_SEWER_LADDER = { x: 3237, y: 9858, z: 0 };
const VARROCK_BANK_LOCKED_DOOR = "fai_varrock_bank_locked_door";
const VARROCK_BANK_DOOR_LINE = "I don't think I'm ever going to be allowed in there.";
const VARROCK_BANK_DOOR = {
  banker: 8666, // varrock_bank_doorguard
  knock: "<col=000080>Knock knock...",
  knockSound: 1735,
  knockTicks: 2,
  title: "What would you like to say?",
};
// Chathead seqs: chatbored1, chathap1, chatshifty1, chatlaugh1, chatquiz1, chatang1, chatang2, chatcon1.
const CHAT = { BORED: 562, HAPPY: 567, SHIFTY: 592, LAUGH: 605, QUIZ: 554, ANGRY: 614, ANGRIER: 615, CONFUSED: 575 };
// The five answers to "Who's there?" (rec 3213: each one picked once).
const VARROCK_BANK_DOOR_JOKES = [
  (name) => [["player", `I'm ${name}. Please let me in.`, CHAT.HAPPY], ["banker", "No. Staff only beyond this point. You can't come in here.", CHAT.ANGRIER]],
  () => [["player", "Boo.", CHAT.SHIFTY], ["banker", "Boo who?", CHAT.QUIZ], ["player", "There's no need to cry!", CHAT.LAUGH], ["banker", "What? I'm not... oh, just go away!", CHAT.CONFUSED]],
  () => [["player", "Kanga.", CHAT.SHIFTY], ["banker", "Kanga who?", CHAT.QUIZ], ["player", "No, 'kangaroo'.", CHAT.LAUGH], ["banker", "Stop messing about and go away!", CHAT.ANGRY]],
  () => [["player", "Thank.", CHAT.SHIFTY], ["banker", "Thank who?", CHAT.QUIZ], ["player", "You're welcome!", CHAT.LAUGH], ["banker", "Stop it!", CHAT.ANGRY]],
  () => [["player", "Doctor.", CHAT.SHIFTY], ["banker", "Doctor wh.. hang on, I'm not falling for that one again! Go away.", CHAT.ANGRIER]],
];

const INTRO = "There's a large selection of books, the majority of which look fairly<br>old. Some very strange names... You pick one at random :";
// The Wiki gives different spellings for the ground-floor library and Traiborn's room.
const LIBRARY_BOOKS = [
  "101 Ways to Impress Your Mates with Magic",
  "The Dark Arts of Magical Wands",
  "Fire, Earth and Water ~ What's it all About?",
  "How to become the Ultimate Wizard of the Universe",
  "The Life & Times of a Thingummywut by Traiborn the Wizard",
  "Life With a Wizard Husband ~ a Housewife's Story",
  "So You Think You're a Mage? Volume 28",
  "Wind Strike for Beginners",
];
const TRAIBORN_BOOKS = [
  "101 Ways to Impress your Mates with Magic",
  "The Dark Arts of Magical Wands",
  "Fire, Earth and Water - What's it all about?",
  "How to become the Ultimate Wizard of the Universe",
  "The Life & Times of a Thingummywut by Traiborn the Wizard",
  "Living with a Wizard Husband - A housewife's Story",
  "So you think you're a Mage? Volume 28",
  "Wind Strike for Beginners",
];

function searchBooks(event) {
  const { location, objectId, player } = event;
  // The same name is used by other bookcases, including the basement clue.
  if ((objectId !== CacheDefinitions.getLocId("fai_wiztower_bookcase") &&
       objectId !== CacheDefinitions.getLocId("fai_wiztower_bookcase_wall")) ||
      !location || location.x < 3100 || location.x > 3119 || location.y < 3150 || location.y > 3169 ||
      (location.z !== 0 && location.z !== 1)) return false;
  const { DialogueChainBuilder, StatementDialogue } = pluginApi.core;
  const books = location.z === 0 ? LIBRARY_BOOKS : TRAIBORN_BOOKS;
  const title = books[Math.floor(Math.random() * books.length)];
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, INTRO),
    new StatementDialogue(1, `'${title}'`),
    new StatementDialogue(2, "Interesting..."),
  ));
  return true;
}

// Wizards' Tower basement
const TOWER_LADDER = { x: 3104, y: 3162, z: 0 };
const TOWER_BASEMENT_LADDER = { x: 3103, y: 9576, z: 0 };
const TOWER_BASEMENT_LANDING = { x: 3104, y: 9576, z: 0 };
const TOWER_SURFACE_LANDING = { x: 3105, y: 3162, z: 0 };

// Lumbridge Swamp Caves: the surface dark hole and the rope tied through it.
const SWAMP_CAVE_DARK_HOLE = { x: 3169, y: 3172, z: 0 };
const SWAMP_CAVE_ROPED_ATTRIBUTE = "lumbridge-swamp-caves:roped";
/** Cache: varbit 279 SWAMP_CAVES_ROPED_ENTRANCE (varp 425, bit 3). */
const SWAMP_CAVE_ROPED_VARBIT = 279;
/** Every walkable side of the dark hole, and the tile the game lands on below it. */
const SWAMP_CAVE_LANDINGS = new Map([
  ["3169,3171,0", { x: 3169, y: 9571, z: 0 }],
  ["3168,3172,0", { x: 3168, y: 9572, z: 0 }],
  ["3170,3172,0", { x: 3170, y: 9572, z: 0 }],
  ["3169,3173,0", { x: 3167, y: 9573, z: 0 }],
  ["3170,3173,0", { x: 3170, y: 9572, z: 0 }],
]);
const SWAMP_CAVE_NEEDS_ROPE = "There is a sheer drop below the hole. You'll need a rope to get down there.";
const SWAMP_CAVE_TIED_ROPE = "You tie the rope to the top of the hole and throw it down.";
const SWAMP_CAVE_ROPE_QUESTION = "Attach a rope to the top of the hole?";
const SWAMP_CAVE_ROPE_SOUND = 1774;
/** cws_warning_13 (572), "Lumbridge Swamp Cave Rope". */
const SWAMP_CAVE_WARNING = 13;
/** That screen's answers (572:17, 18), as live rewrites them. */
const SWAMP_CAVE_WARNING_TEXTS = { 17: "I'll be fine without a tinderbox.", 18: "I'll come back with a tinderbox." };
/**
 * The cave goblin markers' Look-at. rsprox.net rec 3182 (rev 232): on arrival the player faces
 * the wall, then live sets cave_goblin_markers:symbol to the marker's model (6923 for the north
 * marker at tick 2669, 6924 for the south one at ticks 2877 and 3060, 6922 for the east one at
 * ticks 2192-2608 and rec 3981 tick 90, 6927 for the west one at tick 2764), runs
 * toplevel_mainmodal_open [0, 0] and opens cave_goblin_markers in the main modal. No message,
 * animation or sound. It is an approach op: most reads opened where the player stood, two to
 * seven tiles from the wall; from 3229,9608 (tick 2591) and rec 3981's 3223,9618 (tick 89) the
 * east marker was out of sight, and the player ran until it was in sight, then it opened.
 */
const SWAMP_CAVE_MARKER_MODELS = new Map([
  ["swamp_cavewall_northmarker", 6923],
  ["swamp_cavewall_southmarker", 6924],
  ["swamp_cavewall_eastmarker", 6922],
  ["swamp_cavewall_westmarker", 6927],
]);
const MAINMODAL_OPEN_SCRIPT = 2524;
/** Ours: the engine's default approach range; the recorded reads were from 2 and 7 tiles. */
const SWAMP_CAVE_MARKER_RANGE = 10;

function initialize(api) {
  pluginApi = api;
  ({ Location, Animation, GameObject, CacheDefinitions, ObjectManager, ObjectIdentifiers: Objects, ItemIdentifiers: Items } = api.core);
  climbDownAnimation = new Animation(827);
}

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

const toLocation = (position) => new Location(position.x, position.y, position.z ?? 0);

// Edgeville: dungeon ladder back up to the surface.
function edgevilleLadderUp(event) {
  const { player, location } = event;
  if (!isAt(location, EDGEVILLE_DUNGEON_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", { player, destination: toLocation(EDGEVILLE_SURFACE) });
  event.handled = true;
}

// Edgeville: trapdoor down into the dungeon.
function edgevilleTrapdoorOpen(event) {
  const { player, location } = event;
  if (!isAt(location, EDGEVILLE_TRAPDOOR)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(EDGEVILLE_DUNGEON_LANDING) });
  event.handled = true;
}

function hasClimbDown(definition) {
  return Array.isArray(definition?.actions) && definition.actions.includes("Climb-down");
}

/** The loc shown while the manhole is open, or null if it has no open state. */
function resolveManholeOpenId(objectId) {
  const definition = CacheDefinitions.getObject(objectId);
  if (!definition) return null;

  // Transform list: the last entry is the revealed (open) variant.
  if (Array.isArray(definition.transforms) && definition.transforms.length > 0) {
    const openId = definition.transforms[definition.transforms.length - 1];
    if (Number.isInteger(openId) && openId >= 0 && openId !== objectId) return openId;
  }

  // Otherwise the open state is the paired same-named loc (881 -> 882).
  const paired = CacheDefinitions.getObject(objectId + 1);
  if (paired && paired.name === definition.name && hasClimbDown(paired)) return objectId + 1;
  return null;
}

/** Swap the loc on a tile, despawning before spawning so the shared tile is not wiped. */
function replaceObject(object, newId, player) {
  const position = object.getLocation?.() ?? toLocation({ x: 0, y: 0, z: 0 });
  const privateArea = player.getPrivateArea?.() ?? null;
  const replacement = new GameObject(newId, position, object.getType(), object.getFace(), privateArea);
  ObjectManager.deregister(object, true);
  ObjectManager.register(replacement, true);
}

// Varrock: reveal the open manhole and play the climb-down animation.
function varrockManholeOpen(event) {
  const { player, object, objectId } = event;
  const openId = resolveManholeOpenId(objectId);
  if (openId === null || openId === objectId) return false;
  replaceObject(object, openId, player);
  player.performAnimation(climbDownAnimation);
  event.handled = true;
}

// Varrock: put the closed manhole back.
function varrockManholeClose(event) {
  const { player, object, objectId, location } = event;
  if (objectId !== Objects.MANHOLE_2 || !isAt(location, VARROCK_MANHOLE)) return false;
  replaceObject(object, Objects.MANHOLE, player);
  event.handled = true;
}

// Varrock: descend through the manhole into the sewer.
function varrockClimbDownManhole(event) {
  const { player, location } = event;
  if (!isAt(location, VARROCK_MANHOLE)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(VARROCK_SEWER_LADDER) });
  event.handled = true;
}

// Varrock: sewer ladder back up to the manhole.
function varrockClimbUpToManhole(event) {
  const { player, location } = event;
  if (!isAt(location, VARROCK_SEWER_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", { player, destination: toLocation(VARROCK_MANHOLE) });
  event.handled = true;
}

// Wizards tower basement
function wizardsTowerClimbDown(event) {
  const { player, objectId, location } = event;
  if (objectId !== Objects.LADDER_10 || !isAt(location, TOWER_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(TOWER_BASEMENT_LANDING) });
  event.handled = true;
}

// Wizards tower basement
function wizardsTowerClimbUp(event) {
  const { player, objectId, location } = event;
  if (objectId !== Objects.LADDER_11 || !isAt(location, TOWER_BASEMENT_LADDER)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", { player, destination: toLocation(TOWER_SURFACE_LANDING) });
  event.handled = true;
}

// Lumbridge Swamp Caves: the rope stays tied once used, as the varbit remembers.
function swampCavesRoped(player) {
  return player.getAttribute(SWAMP_CAVE_ROPED_ATTRIBUTE) === true;
}

function syncSwampCavesRope({ player }) {
  if (swampCavesRoped(player)) player.getPacketSender().sendVarbit(SWAMP_CAVE_ROPED_VARBIT, 1);
}

function useRopeOnDarkHole(event) {
  const { player, objectId, location, itemId } = event;
  if (objectId !== Objects.DARK_HOLE || itemId !== Items.ROPE || !isAt(location, SWAMP_CAVE_DARK_HOLE)) return false;
  event.handled = true;
  if (swampCavesRoped(player)) return true;
  // rsprox 227/00075.txt:174556-174605: a Yes/No menu, then the varbit, human_pickupfloor (827), sound 1774,
  // and the line in an item box showing the rope.
  pluginApi.sendMultiChatboxPrompt(player, SWAMP_CAVE_ROPE_QUESTION, "Yes.", () => tieRopeToDarkHole(player), "No.", () => {});
  return true;
}

function tieRopeToDarkHole(player) {
  if (swampCavesRoped(player) || !player.getInventory().contains(Items.ROPE)) return;
  player.getInventory().delete(Items.ROPE, 1);
  player.setAttribute(SWAMP_CAVE_ROPED_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(SWAMP_CAVE_ROPED_VARBIT, 1);
  player.performAnimation(climbDownAnimation);
  player.getPacketSender().sendSound(SWAMP_CAVE_ROPE_SOUND, 1, 0);
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new ItemStatementDialogue(0, Items.ROPE, SWAMP_CAVE_TIED_ROPE)).add(new EndDialogue(1)));
}

/** The tile below the side of the hole the player used, as the game's pathing does. */
function swampCavesLanding(location) {
  return SWAMP_CAVE_LANDINGS.get(`${location.x},${location.y},${location.z ?? 0}`)
    ?? SWAMP_CAVE_LANDINGS.get("3168,3172,0");
}

function climbDownDarkHole(event) {
  const { player, objectId, location } = event;
  if (objectId !== Objects.DARK_HOLE || !isAt(location, SWAMP_CAVE_DARK_HOLE)) return false;
  event.handled = true;
  if (!swampCavesRoped(player)) {
    player.sendMessage(SWAMP_CAVE_NEEDS_ROPE);
    return true;
  }
  const climb = () => pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(swampCavesLanding(player.getLocation())) });
  if (hasTinderbox(player)) {
    climb();
    return true;
  }
  const warning = { player, warning: SWAMP_CAVE_WARNING, texts: SWAMP_CAVE_WARNING_TEXTS, proceed: climb };
  pluginApi.emitCustomEvent("warning-screen:show", warning);
  if (!warning.handled) climb();
  return true;
}

/** The warning asks about going in "without a tinderbox": a tinderbox or golden tinderbox held. */
function hasTinderbox(player) {
  const tinderboxes = [Items.TINDERBOX, Items.GOLDEN_TINDERBOX];
  return tinderboxes.some((id) => player.getInventory().contains(id));
}

function swampCaveMarkerModel(objectId) {
  for (const [gameval, model] of SWAMP_CAVE_MARKER_MODELS) {
    if (CacheDefinitions.getLocId(gameval) === objectId) return model;
  }
  return undefined;
}

// Lumbridge Swamp Caves: a marker is read from where the player stands when it is in range and in
// sight; from further away they walk until it is (the shared approach-op route).
function swampCaveMarkerRoute(event) {
  if (event.clickType !== 1 || swampCaveMarkerModel(event.objectId) === undefined) return;
  const where = event.object?.getLocation?.();
  const at = event.player.getLocation();
  if (!where || where.getZ() !== at.getZ()) return;
  const distance = Math.max(Math.abs(where.getX() - at.getX()), Math.abs(where.getY() - at.getY()));
  const inSight = distance <= SWAMP_CAVE_MARKER_RANGE && pluginApi.core.RegionManager.canProjectileAttackBounds(
    at, new Location(where.getX(), where.getY(), where.getZ()), 1, 1, 1, 1, event.player.getPrivateArea?.() ?? null);
  if (inSight) event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
  else event.approachRange = SWAMP_CAVE_MARKER_RANGE;
}

// Varrock West Bank: the locked back door (rec 3213 ticks 4464-5070, five knocks). The player's
// line, a "Knock knock..." box with no Continue for two ticks, the unseen Banker's "Who's there?",
// then five answers that each end with him sending the player away. The door never opens.
function knockVarrockBankDoor({ player, objectId }) {
  if (objectId !== CacheDefinitions.getLocId(VARROCK_BANK_LOCKED_DOOR)) return false;
  const { DialogueChainBuilder, PlayerDialogue, NpcDialogue, OptionDialogue, ActionDialogue, StatementDialogue, Task, TaskManager } = pluginApi.core;
  const dialogues = player.getDialogueManager();
  const knock = new ActionDialogue(1, { execute: () => {
    StatementDialogue.send(player, VARROCK_BANK_DOOR.knock, false);
    player.getPacketSender().sendSound(VARROCK_BANK_DOOR.knockSound, 1, 0);
    const task = new Task(VARROCK_BANK_DOOR.knockTicks, player);
    task.execute = () => {
      task.stop();
      if (dialogues.getCurrent() === knock) dialogues.startDialogue(2);
    };
    TaskManager.submit(task);
  } }, true);
  const answer = (option) => {
    const lines = VARROCK_BANK_DOOR_JOKES[Number(option) - 1]?.(player.getDisplayName());
    if (!lines) return;
    dialogues.startDialogues(new DialogueChainBuilder().add(...lines.map(([who, text, anim], i) => who === "player"
      ? new PlayerDialogue(i, text, anim)
      : new NpcDialogue(i, VARROCK_BANK_DOOR.banker, text, "Banker", anim))));
  };
  const name = player.getDisplayName();
  dialogues.startDialogues(new DialogueChainBuilder().add(
    new PlayerDialogue(0, VARROCK_BANK_DOOR_LINE, CHAT.BORED),
    knock,
    new NpcDialogue(2, VARROCK_BANK_DOOR.banker, "Who's there?", "Banker", CHAT.ANGRY),
    new OptionDialogue(3, { executeOption: answer },
      `I'm ${name}. Please let me in.`, "Boo.", "Kanga.", "Thank.", "Doctor.").setTitle(VARROCK_BANK_DOOR.title),
  ));
  return true;
}

// Lumbridge Swamp Caves: a cave goblin marker's picture.
function lookAtSwampCaveMarker(event) {
  const { player, objectId } = event;
  const model = swampCaveMarkerModel(objectId);
  if (model === undefined) return false;
  event.handled = true;
  // Read from where they stand, so turned to the marker here (rec 3182's face_angle 360 and 1227).
  if (event.location) player.setPositionToFace(new Location(event.location.x, event.location.y, event.location.z ?? 0));
  const sender = player.getPacketSender();
  sender.sendInterfaceRawModel(CacheDefinitions.getComponentId("cave_goblin_markers:symbol"), model);
  sender.sendInterfaceScript(MAINMODAL_OPEN_SCRIPT, [0, 0]);
  sender.sendInterface(CacheDefinitions.getInterfaceId("cave_goblin_markers"));
  return true;
}

module.exports = {
  name: "Misthalin",
  description: "Misthalin area interactions: the Edgeville dungeon ladder and trapdoor, Varrock's manhole to the sewers and the West Bank's locked back door, the Wizards' Tower basement, and the Lumbridge Swamp Caves dark hole and wall markers.",
  register(api) {
    initialize(api);
    // Edgeville
    api.onObjectInteraction("Ladder", { "Climb-up": edgevilleLadderUp });
    api.onObjectInteraction("Trapdoor", { Open: edgevilleTrapdoorOpen });
    // Varrock
    api.onObjectInteraction("Manhole", {
      Open: varrockManholeOpen,
      Close: varrockManholeClose,
      "Climb-down": varrockClimbDownManhole,
    });
    api.onObjectInteraction("Ladder", { "Climb-up": varrockClimbUpToManhole });
    api.onObjectInteraction("Bookcase", { Search: searchBooks });
    api.onObjectInteraction("Door", { "Knock-at": knockVarrockBankDoor });
    // Wizards tower basement
    api.onObjectInteraction("Ladder", {
      "Climb-down": wizardsTowerClimbDown,
      "Climb-up": wizardsTowerClimbUp,
    });
    // Lumbridge Swamp Caves
    api.persistAttribute(SWAMP_CAVE_ROPED_ATTRIBUTE, false);
    api.onObjectInteraction("Dark hole", { "Climb-down": climbDownDarkHole });
    api.onItemOnObject("Rope", "Dark hole", useRopeOnDarkHole, { noted: false });
    api.onPlayerLogin(syncSwampCavesRope);
    api.onObjectRoute(swampCaveMarkerRoute);
    api.onObjectInteraction("Symbol", { "Look-at": lookAtSwampCaveMarker });
  },
  _test: { knockVarrockBankDoor, VARROCK_BANK_DOOR_LINE, VARROCK_BANK_DOOR, swampCavesLanding, lookAtSwampCaveMarker, swampCaveMarkerRoute, SWAMP_CAVE_MARKER_RANGE, SWAMP_CAVE_ROPED_ATTRIBUTE, SWAMP_CAVE_ROPED_VARBIT },
};
