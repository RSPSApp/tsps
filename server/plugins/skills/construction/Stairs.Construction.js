"use strict";

const { api, Animation, CountdownTask, ItemIdentifiers, Location, Skill, TaskManager, DialogueChainBuilder, StatementDialogue } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const Data = require("./Data.Construction");
const House = require("./House.Construction");
const CarpenterOutfit = require("./CarpenterOutfit.Construction");
const Menu = require("./Menu.Construction");

// Floors: plane 0 is the basement, 1 the ground floor, 2 the upper floor. Staircases join a hall
// to the hall above or below it, the garden's dungeon entrance or a hall's spiral staircase to
// the dungeon stairs room, and a throne room's trapdoor to the oubliette's ladder. Messages are
// from rsprox captures; ladders and trapdoors play human_reachforladder and move a tick later.
const BASEMENT = 0;
const TOP_FLOOR = 2;
const COINS = ItemIdentifiers.COINS;
const CLIMB_LADDER = Ids.seq("human_reachforladder");

// What each piece of stair furniture connects to, and the piece it pairs with when building a
// room through it. `ladder`: climbed with the ladder animation.
const STAIRS = {
  OAK_STAIRCASE_UP: { up: true, pair: "OAK_STAIRCASE_DOWN" },
  TEAK_STAIRCASE_UP: { up: true, pair: "TEAK_STAIRCASE_DOWN" },
  MARBLE_STAIRCASE_UP: { up: true, pair: "MARBLE_STAIRCASE_DOWN" },
  OAK_STAIRCASE_DOWN: { down: true, pair: "OAK_STAIRCASE_UP" },
  TEAK_STAIRCASE_DOWN: { down: true, pair: "TEAK_STAIRCASE_UP" },
  MARBLE_STAIRCASE_DOWN: { down: true, pair: "MARBLE_STAIRCASE_UP" },
  SPIRAL_STAIRCASE: { up: true, down: true, pair: "SPIRAL_STAIRCASE" },
  MARBLE_SPIRAL_STAIRCASE: { up: true, down: true, pair: "MARBLE_SPIRAL_STAIRCASE" },
  DUNGEON_ENTRANCE: { down: true },
  OAK_TRAPDOOR: { down: true, ladder: true, pair: "OAK_LADDER" },
  TEAK_TRAPDOOR: { down: true, ladder: true, pair: "TEAK_LADDER" },
  MAHOGANY_TRAPDOOR: { down: true, ladder: true, pair: "MAHOGANY_LADDER" },
  OAK_LADDER: { up: true, ladder: true, pair: "OAK_TRAPDOOR" },
  TEAK_LADDER: { up: true, ladder: true, pair: "TEAK_TRAPDOOR" },
  MAHOGANY_LADDER: { up: true, ladder: true, pair: "MAHOGANY_TRAPDOOR" },
};
// The room a staircase leads to when there is none yet, by the room it starts in.
const ROOM_ABOVE = { SKILL_HALL_UP: "SKILL_HALL_DOWN", QUEST_HALL_UP: "QUEST_HALL_DOWN", DUNGEON_STAIRS: "SKILL_HALL_DOWN", OUBLIETTE: "THRONE_ROOM" };
const ROOM_BELOW = {
  SKILL_HALL_DOWN: "SKILL_HALL_UP", QUEST_HALL_DOWN: "QUEST_HALL_UP", SKILL_HALL_UP: "DUNGEON_STAIRS", QUEST_HALL_UP: "DUNGEON_STAIRS",
  GARDEN: "DUNGEON_STAIRS", THRONE_ROOM: "OUBLIETTE",
};
// A dungeon stairs room takes the up-going staircases; any of them will do below an entrance.
const DUNGEON_STAIRCASES = ["OAK_STAIRCASE_UP", "TEAK_STAIRCASE_UP", "SPIRAL_STAIRCASE", "MARBLE_STAIRCASE_UP", "MARBLE_SPIRAL_STAIRCASE"];
// Throne room trapdoors open in place; their open locs take Go-down.
const OPEN_TRAPDOORS = {
  OAK_TRAPDOOR: Ids.loc("poh_trapdoor_oak_open_7"), TEAK_TRAPDOOR: Ids.loc("poh_trapdoor_teak_open_7"),
  MAHOGANY_TRAPDOOR: Ids.loc("poh_trapdoor_mag_open_7"),
};

function say(player, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/** The stair furniture in a room, or null. */
function stairsIn(room) {
  return Object.values(room?.furnitureByLocation ?? {}).find(furniture => STAIRS[furniture.buildableKey]) ?? null;
}

/** Whether a room type has a space for stair furniture. */
function holdsStairs(roomKey) {
  return Data.ROOM_BY_KEY.get(roomKey)?.hotspots.some(key => House.hotspotChoices(key).some(buildable => STAIRS[buildable.key])) ?? false;
}

function climb(event, direction) {
  const player = event.player;
  const house = House.houseFor(player);
  if (!house) return false;
  const position = house.getRoomPositionAt(event.location);
  const room = position && house.getRoom(position);
  const furniture = room && house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const stairs = furniture && STAIRS[furniture.buildableKey];
  if (!stairs?.[direction]) return false;
  const up = direction === "up";
  const where = up ? "top" : "bottom";
  if (up && position.plane >= TOP_FLOOR) {
    say(player, "You are on the highest possible level so you cannot add a room above here.");
    return true;
  }
  if (!up && position.plane <= BASEMENT) return false;
  const next = { ...position, plane: position.plane + (up ? 1 : -1) };
  const nextRoom = house.getRoom(next);
  if (!nextRoom) {
    if (!House.isBuildingMode(player)) say(player, `These stairs do not lead anywhere. Enter building mode to build a room at the ${where}.`);
    else offerRoom(player, house, room, furniture, next, up);
    return true;
  }
  const nextFurniture = stairsIn(nextRoom);
  const nextStairs = STAIRS[nextFurniture?.buildableKey];
  if (!nextStairs && holdsStairs(nextRoom.roomKey)) {
    say(player, `There are no stairs in the room ${up ? "above" : "below"}. Enter building mode to build some.`);
    return true;
  }
  // Two halls' staircases only meet when the rooms face the same way.
  const halls = !stairs.ladder && nextFurniture?.buildableKey !== "DUNGEON_ENTRANCE" && furniture.buildableKey !== "DUNGEON_ENTRANCE";
  if (!nextStairs || !(up ? nextStairs.down : nextStairs.up) || (halls && nextRoom.rotation !== room.rotation)) {
    say(player, `These stairs cannot connect to the room ${up ? "above" : "below"}.`);
    return true;
  }
  const at = player.getLocation();
  const arrive = new Location(at.getX(), at.getY(), next.plane);
  if (!stairs.ladder) {
    player.moveTo(arrive);
    return true;
  }
  player.performAnimation(new Animation(CLIMB_LADDER));
  TaskManager.submit(new CountdownTask(player, 1, () => {
    if (House.houseFor(player) === house) player.moveTo(arrive);
  }));
  return true;
}

/** Building mode: build the matching room (and its connecting piece) at the other end. */
function offerRoom(player, house, room, furniture, next, up) {
  const roomKey = (up ? ROOM_ABOVE : ROOM_BELOW)[room.roomKey];
  const template = roomKey && Data.ROOM_BY_KEY.get(roomKey);
  if (!template) {
    say(player, `These stairs cannot connect to the room ${up ? "above" : "below"}.`);
    return;
  }
  const question = template.key === "OUBLIETTE"
    ? "These stairs do not lead anywhere. Do you want to build an oubliette below the throne room?"
    : `These stairs do not lead anywhere. Do you want to build a room at the ${up ? "top" : "bottom"}?`;
  api.sendMultiChatboxPrompt(player, question,
    "Yes", () => buildRoomThrough(player, house, room, furniture, next, template),
    "No", () => {});
}

function buildRoomThrough(player, house, room, furniture, next, template) {
  if (House.houseFor(player) !== house || !House.isBuildingMode(player)) return;
  const problem = house.canPlaceRoom(template, next, House.constructionLevel(player));
  if (problem) return Menu.refuse(player, problem);
  if (player.getInventory().getAmount(COINS) < template.cost) return player.sendMessage("You can't afford to build that room.");
  const candidates = STAIRS[furniture.buildableKey].pair ? [STAIRS[furniture.buildableKey].pair] : DUNGEON_STAIRCASES;
  // Place the room to test its stair space, and take it back out if no staircase can be built.
  house.placeRoom(next, template, room.rotation);
  const hotspot = template.hotspots.find(key => House.hotspotChoices(key).some(buildable => candidates.includes(buildable.key)));
  const placement = hotspot && house.hotspotPlacements(template.key, hotspot)[0];
  const target = placement && { position: next, hotspotKey: hotspot, sourceObjectId: placement.id, localX: placement.localX, localY: placement.localY, type: placement.type, face: placement.face };
  const staircase = target && candidates.map(key => Data.BUILDABLE_BY_KEY.get(key))
    .find(buildable => buildable && House.getBuildMaterials(player, house, target, buildable) instanceof Map);
  if (!staircase) {
    house.removeRoom(next);
    say(player, `You don't have the right materials to build any staircase in the room ${next.plane > room.plane ? "above" : "below"}.`);
    return;
  }
  House.useMaterials(player, staircase, House.getBuildMaterials(player, house, target, staircase));
  player.getInventory().delete(COINS, template.cost);
  house.setFurniture(target, staircase);
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, CarpenterOutfit.withBonus(player, staircase.experience));
  House.rebuildHouse(player, house);
}

function climbUp(event) { return climb(event, "up"); }
function climbDown(event) { return climb(event, "down"); }

function climbEither(event) {
  if (!House.houseFor(event.player)) return false;
  api.sendMultiChatboxPrompt(event.player, "Climb up or down the stairs?", "Climb up.", () => climbUp(event), "Climb down.", () => climbDown(event));
  return true;
}

/** Throne room trapdoors: Open and Close swap the loc for everyone in the house. */
function setTrapdoor(event, open) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const openLoc = furniture && OPEN_TRAPDOORS[furniture.buildableKey];
  if (!openLoc) return false;
  if (open) furniture.displayObjectId = openLoc;
  else delete furniture.displayObjectId;
  house.redrawFurniture();
  return true;
}

function openTrapdoor(event) { return setTrapdoor(event, true); }
function closeTrapdoor(event) { return setTrapdoor(event, false); }

/**
 * `ladders:climb` (the generic Ladders plugin asks before guessing a direction): house ladders and
 * staircases are the house's to move.
 */
function claimClimb(request) {
  if (request.handled || !House.houseFor(request.player)) return;
  const at = request.object.getLocation();
  const event = { ...request, location: { x: at.getX(), y: at.getY(), z: at.getZ() } };
  const option = request.object.getDefinition?.()?.getInteractions?.()?.[request.clickType - 1];
  const handler = { Climb: furnitureClimbs(event), "Climb-up": climbUp, "Climb-down": climbDown, "Go-down": climbDown }[option];
  if (handler && handler(event)) request.handled = true;
}

/** "Climb" goes up a ladder, and asks which way on a spiral staircase. */
function furnitureClimbs(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return STAIRS[furniture?.buildableKey]?.ladder ? climbUp : climbEither;
}

function attachStairs(api) {
  api.onCustomEvent("ladders:climb", claimClimb);
  api.onObjectInteraction("Staircase", { "Climb-up": climbUp, "Climb-down": climbDown, Climb: climbEither });
  api.onObjectInteraction("Dungeon entrance", { Enter: climbDown });
  api.onObjectInteraction("Ladder", { Climb: climbUp });
  for (const name of ["Oak trapdoor", "Teak trapdoor", "Mahogany trapdoor"]) {
    api.onObjectInteraction(name, { Open: openTrapdoor, Close: closeTrapdoor, "Go-down": climbDown });
  }
}

Object.assign(module.exports, { attachStairs });
