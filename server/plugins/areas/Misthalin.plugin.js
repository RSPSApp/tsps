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
 *
 * Wizards' Tower basement (a y+6400 dungeon, so the generic Ladders plugin can't
 * link it): the ground-floor Ladder at 3104,3162 climbs down to the basement
 * landing at 3104,9576, and the basement Ladder at 3103,9576 climbs back up in
 * front of the ground-floor ladder at 3105,3162.
 *
 * Lumbridge Swamp Caves
 *  - Dark hole at 3169,3172 > Use Rope: ties a rope and sets the SWAMP_CAVES_ROPED_ENTRANCE
 *    varbit (279) for good (Wiki). The rope is used up.
 *  - Dark hole > Climb-down: the tile below the side the player used, once roped.
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
  const landing = swampCavesLanding(player.getLocation());
  pluginApi.emitCustomEvent("ladders:climbDown", { player, destination: toLocation(landing) });
  return true;
}

module.exports = {
  name: "Misthalin",
  description: "Misthalin area interactions: the Edgeville dungeon ladder and trapdoor, Varrock's manhole to the sewers and the Wizards' Tower basement.",
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
  },
  _test: { swampCavesLanding, SWAMP_CAVE_ROPED_ATTRIBUTE, SWAMP_CAVE_ROPED_VARBIT },
};
