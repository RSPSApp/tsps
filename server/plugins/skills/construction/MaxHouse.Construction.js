"use strict";

const Data = require("./Data.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Instance = require("./Instance.Construction");
const Portals = require("./Portals.Construction");
const Nexus = require("./Nexus.Construction");
const Trophies = require("./Trophies.Construction");

// ::maxhouse (developer): replaces the house with one of every room, each with the best piece on
// every space, for testing. The old house is kept for ::restorehouse. Levels, room counts and the
// house size are ignored. The ground floor grows from the garden (with its exit portal), each room
// turned so most of its doorways meet its neighbours'; the halls' upper halves stand over them,
// the dungeon stairs under the skill hall and the oubliette under the throne room, and the rest of
// the dungeon grows from the stairs. Portals, the nexus, the cape hanger, trophy displays and the
// prize chest come set up.
const { HOUSE_ATTRIBUTE } = Data;
const BACKUP_ATTRIBUTE = "construction:house-backup";
const GRID = 8;
const GROUND = 1, UPPER = 2, BASEMENT = 0;
const GROUND_ROOMS = [
  "PARLOUR", "KITCHEN", "DINING_ROOM", "SKILL_HALL_UP", "QUEST_HALL_UP", "THRONE_ROOM", "WORKSHOP", "BEDROOM", "STUDY",
  "COSTUME_ROOM", "CHAPEL", "PORTAL_CHAMBER", "PORTAL_NEXUS", "GAMES_ROOM", "COMBAT_ROOM", "MENAGERIE_INDOORS",
  "ACHIEVEMENT_GALLERY", "FORMAL_GARDEN", "SUPERIOR_GARDEN",
];
const BASEMENT_ROOMS = ["DUNGEON_CORRIDOR", "DUNGEON_JUNCTION", "TREASURE_ROOM"];
// Spaces whose top piece isn't the one to have: the garden keeps its exit portal.
const PICKS = { GARDEN: { CENTERPIECE: "EXIT_PORTAL" } };
const PORTAL_DESTINATIONS = ["varrock teleport", "camelot teleport", "ardougne teleport"];
const NEXUS_DESTINATIONS = ["varrock teleport", "lumbridge teleport", "falador teleport", "camelot teleport", "ardougne teleport", "watchtower teleport", "trollheim teleport", "kharyrll teleport"];
const MAX_CAPE = { cape: Ids.obj("skillcape_max"), hood: Ids.obj("skillcape_max_hood") };
const MAX_CAPE_LOC = Ids.loc("poh_mounted_max_cape");
const TROPHY_FOR = { head: 7, fish: 18 }; // Vorkath's head, swift marlin
const PRIZE = 100000;
const OFFSETS = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // doorway edges: north, east, south, west

function rotated(doors, rotation) {
  return ((doors << rotation) | (doors >> (4 - rotation))) & 15;
}

/** The highest-level piece a space takes (the top of an upgrade chain saves as itself). */
function bestPiece(roomKey, hotspotKey) {
  const forced = PICKS[roomKey]?.[hotspotKey];
  if (forced) return forced;
  const choices = House.hotspotChoices(hotspotKey);
  if (!choices.length) return null;
  const best = choices.reduce((top, choice) => (choice.level >= top.level ? choice : top));
  return best.savesAs ?? best.key;
}

function furnished(roomKey) {
  const furniture = {};
  for (const hotspotKey of new Set(Data.ROOM_BY_KEY.get(roomKey).hotspots)) {
    if (hotspotKey === "EMPTY") continue;
    const piece = bestPiece(roomKey, hotspotKey);
    if (piece) furniture[hotspotKey] = piece;
  }
  return furniture;
}

/**
 * Lays out the rooms; doorway masks come from the house style's room templates. Every room by
 * default; a random house passes its own shuffled picks, which give it a different shape.
 */
function layout(save, groundRooms = GROUND_ROOMS, basementRooms = BASEMENT_ROOMS) {
  const doorsOf = (roomKey) => Instance.PlayerHouseInstance.prototype.templateDoorMask.call({ save }, roomKey);
  const rooms = Array.from({ length: 3 }, () => Array.from({ length: GRID }, () => Array(GRID).fill(null)));
  const put = (plane, x, y, roomKey, rotation) => { rooms[plane][x][y] = { roomKey, rotation, furniture: furnished(roomKey) }; };
  const grow = (plane, roomKey) => {
    const doors = doorsOf(roomKey);
    let best = null;
    for (let x = 0; x < GRID; x++) for (let y = 0; y < GRID; y++) {
      if (rooms[plane][x][y]) continue;
      for (let rotation = 0; rotation < 4; rotation++) {
        let met = 0;
        OFFSETS.forEach(([dx, dy], edge) => {
          const neighbour = rooms[plane][x + dx]?.[y + dy];
          if (!neighbour || !(rotated(doors, rotation) & (1 << edge))) return;
          if (rotated(doorsOf(neighbour.roomKey), neighbour.rotation) & (1 << ((edge + 2) & 3))) met++;
        });
        const distance = Math.abs(x - 3.5) + Math.abs(y - 3.5);
        if (met && (!best || met > best.met || (met === best.met && distance < best.distance))) best = { x, y, rotation, met, distance };
      }
    }
    if (best) put(plane, best.x, best.y, roomKey, best.rotation);
    return best;
  };
  put(GROUND, 4, 4, "GARDEN", 0);
  const placed = {};
  for (const roomKey of groundRooms) placed[roomKey] = grow(GROUND, roomKey);
  for (const [below, above] of [["SKILL_HALL_UP", "SKILL_HALL_DOWN"], ["QUEST_HALL_UP", "QUEST_HALL_DOWN"]]) {
    const at = placed[below];
    if (at) put(UPPER, at.x, at.y, above, at.rotation);
  }
  const hall = placed.SKILL_HALL_UP, throne = placed.THRONE_ROOM;
  if (hall) put(BASEMENT, hall.x, hall.y, "DUNGEON_STAIRS", hall.rotation);
  if (throne) put(BASEMENT, throne.x, throne.y, "OUBLIETTE", throne.rotation);
  for (const roomKey of basementRooms) grow(BASEMENT, roomKey);
  return rooms;
}

/** A random order of a random number (at least `minimum`) of `rooms`. */
function randomPick(rooms, minimum, random) {
  const shuffled = [...rooms];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, minimum + Math.floor(random() * (shuffled.length - minimum + 1)));
}

/** Furniture that needs more than building: directed portals, the nexus, the hanger, trophies. */
function setUp(player, house) {
  const destinations = Portals.houseDestinations();
  let portal = 0;
  const trophies = new Set(player.getAttribute(Trophies.MOUNTED_ATTRIBUTE) ?? []);
  for (const { furniture } of house.furnitureEntries()) {
    const key = furniture.buildableKey;
    if (key.endsWith("_PORTAL_FRAME")) {
      const destination = destinations.find(data => data.name === PORTAL_DESTINATIONS[portal % PORTAL_DESTINATIONS.length]);
      if (furniture.destinations?.length === undefined && destination) {
        furniture.destinations = [destination.name];
        const tier = key.startsWith("TEAK") ? 0 : key.startsWith("MAHOGANY") ? 1 : 2;
        if (Number.isInteger(destination.portalIds[tier])) furniture.displayObjectId = destination.portalIds[tier];
      }
      portal++;
    } else if (furniture.hotspotKey === "PORTAL_NEXUS") {
      const ids = NEXUS_DESTINATIONS.map(name => [...Nexus.destinations().values()].find(data => data.spellName === name)?.id).filter(Boolean);
      player.setAttribute(Nexus.STATE_ATTRIBUTE, { slots: ids, left: ids[0] ?? 0 });
    } else if (key === "CAPE_HANGER") {
      furniture.mountedCape = { ...MAX_CAPE };
      furniture.displayObjectId = MAX_CAPE_LOC;
    } else if (key.startsWith("HEAD_DISPLAY_") || key.startsWith("FISH_DISPLAY_")) {
      const trophy = TROPHY_FOR[key.startsWith("HEAD") ? "head" : "fish"];
      furniture.trophy = trophy;
      trophies.add(trophy);
    }
  }
  player.setAttribute(Trophies.MOUNTED_ATTRIBUTE, [...trophies]);
  house.save.prize = PRIZE;
}

/**
 * Replaces the player's house with `lay(save)`'s rooms and takes them in, keeping the old house for
 * ::restorehouse. The room count, or null when the new house couldn't load.
 */
function replaceHouse(player, lay) {
  const current = House.houseStateFor(player);
  if (!player.getAttribute(BACKUP_ATTRIBUTE)) player.setAttribute(BACKUP_ATTRIBUTE, JSON.parse(JSON.stringify(current)));
  House.releaseHouse(player, false);
  const save = { ...JSON.parse(JSON.stringify(current)), owned: true, locked: false };
  save.rooms = lay(save);
  delete save.prize;
  delete save.treasure;
  player.setAttribute(HOUSE_ATTRIBUTE, save);
  if (!House.enterHouse(player, false)) {
    player.sendMessage("Couldn't load the new house.");
    return null;
  }
  const house = House.houseFor(player);
  if (house) {
    setUp(player, house);
    House.rebuildHouse(player, house);
  }
  return save.rooms.flat(2).filter(Boolean).length;
}

function maxHouse({ player }) {
  const count = replaceHouse(player, (save) => layout(save));
  if (count !== null) player.sendMessage(`Your house now has ${count} rooms, all furnished. ::restorehouse brings the old one back.`);
}

/**
 * "construction:random-house" { player, handled }: the Rotten potato's Setup POH, "a player-owned house
 * with a random layout" (Wiki: Rotten potato). A random handful of rooms in a random order, furnished
 * as ::maxhouse furnishes them; ::restorehouse brings the old house back.
 */
function randomHouse(request, random = Math.random) {
  const player = request?.player;
  if (!player) return;
  request.handled = true;
  const count = replaceHouse(player, (save) => layout(save, randomPick(GROUND_ROOMS, 1, random), randomPick(BASEMENT_ROOMS, 0, random)));
  if (count !== null) player.sendMessage(`Your house has been set up with ${count} rooms. ::restorehouse brings the old one back.`);
}

function restoreHouse({ player }) {
  const backup = player.getAttribute(BACKUP_ATTRIBUTE);
  if (!backup) return player.sendMessage("There is no saved house to restore.");
  House.releaseHouse(player, true);
  player.setAttribute(HOUSE_ATTRIBUTE, backup);
  player.setAttribute(BACKUP_ATTRIBUTE, null);
  House.syncHouseOptions(player);
  player.sendMessage("Your old house is back. Enter it at your house portal.");
}

Object.assign(module.exports, { maxHouse, randomHouse, restoreHouse, BACKUP_ATTRIBUTE });
