"use strict";

/**
 * Chambers of Xeric layouts: which rooms a raid has, in what order, and where each one sits.
 *
 * A raid is two floors of rooms (three in Challenge Mode) laid out as a path. Each room is a
 * 4x4-chunk block of the cache's raid map, copied turned to face the way the path enters it.
 * The cache has three versions of most rooms - the path turning left, going straight on, or
 * turning right - side by side, at chunk x 408, 412 and 416.
 *
 * Not on the Wiki (to check against a capture): the 26 layout patterns (room types and turns, as the
 * RuneLite raids plugin names them), the two combat-room rotations, how rooms are drawn from
 * them, how the path is laid out and cropped, and Challenge Mode's fixed three floors.
 * Wiki: the two rotations of combat rooms (Tekton, Vasa, Guardians, Mystics, Shamans,
 * Muttadiles, Vanguards, Vespula and its counterpart), and Challenge Mode's fixed layout.
 */

const DIRECTIONS = ["NORTH", "EAST", "SOUTH", "WEST"];
const OFFSET = { NORTH: [0, 1], EAST: [1, 0], SOUTH: [0, -1], WEST: [-1, 0] };

/**
 * The rooms: the cache chunk row each sits on, the plane it is copied from, its kind, and the
 * name the RuneLite raids plugin gives it. The three versions are at chunk x 408, 412, 416.
 */
const ROOMS = {
  FLOOR_END_DOWNSTAIRS: { chunkY: 644, plane: 0, kind: "end" },
  FLOOR_START_UPSTAIRS: { chunkY: 712, plane: 0, kind: "start" },
  RAID_START: { chunkY: 648, plane: 0, kind: "start" },
  SMALL_SCAVENGER_RUNT: { chunkY: 652, plane: 0, kind: "scavengers" },
  LIZARDMEN_SHAMAN: { chunkY: 656, plane: 0, kind: "combat", name: "Shamans" },
  VASA_NISTIRIO: { chunkY: 660, plane: 0, kind: "combat", name: "Vasa" },
  VANGUARD: { chunkY: 664, plane: 0, kind: "combat", name: "Vanguards" },
  ICE_DEMON: { chunkY: 668, plane: 0, kind: "puzzle", name: "Ice Demon" },
  CREATURE_KEEPER: { chunkY: 672, plane: 0, kind: "puzzle", name: "Thieving" },
  RESOURCES_A: { chunkY: 680, plane: 0, kind: "farming" },
  LARGE_SCAVENGER_BEAST: { chunkY: 652, plane: 1, kind: "scavengers" },
  DARK_ALTAR_ROOM: { chunkY: 656, plane: 1, kind: "combat", name: "Mystics" },
  TEKTON: { chunkY: 660, plane: 1, kind: "combat", name: "Tekton" },
  MUTTADILES: { chunkY: 664, plane: 1, kind: "combat", name: "Muttadiles" },
  DEATHLY_ROOM: { chunkY: 668, plane: 1, kind: "puzzle", name: "Tightrope" },
  RESOURCES_B: { chunkY: 680, plane: 1, kind: "farming" },
  GUARDIANS: { chunkY: 656, plane: 2, kind: "combat", name: "Guardians" },
  VESPULA: { chunkY: 660, plane: 2, kind: "combat", name: "Vespula" },
  CRAB_PUZZLE: { chunkY: 668, plane: 2, kind: "puzzle", name: "Crabs" },
};
const ROOM_CHUNKS = 4;
const VARIANT_CHUNK_X = [408, 412, 416];

const SCAVENGER_ROOMS = ["SMALL_SCAVENGER_RUNT", "LARGE_SCAVENGER_BEAST"];
const FARMING_ROOMS = ["RESOURCES_A", "RESOURCES_B"];
const PUZZLE_ROOMS = ["ICE_DEMON", "CREATURE_KEEPER", "DEATHLY_ROOM", "CRAB_PUZZLE"];

/** The two orders combat rooms come in; a raid takes a run of them from a random start. */
const BOSS_ROTATIONS = [
  ["TEKTON", "VASA_NISTIRIO", "GUARDIANS", "DARK_ALTAR_ROOM", "LIZARDMEN_SHAMAN", "MUTTADILES", "VANGUARD", "VESPULA"],
  ["TEKTON", "MUTTADILES", "GUARDIANS", "VESPULA", "LIZARDMEN_SHAMAN", "VASA_NISTIRIO", "VANGUARD", "DARK_ALTAR_ROOM"],
];

/**
 * The layout patterns: room kinds (# start, * end, S scavengers, C combat, F farming,
 * P puzzle) then the direction each room is entered from, both floors one after the other.
 */
const LAYOUT_CODES = [
  "#FSCCP*#PCSCF* - #WNWSWN#ESEENW", "#FSCCS*#PCPSF* - #WSEEEN#WSWNWS", "#FSCPC*#CSCPF* - #WNWWSE#EENWWW",
  "#SCCFC*#PSCSF* - #EEENWW#WSEEEN", "#SCCFP*#CCSPF* - #NESEEN#WSWNWS", "#SCFCP*#CCSPF* - #ESEENW#ESWWNW",
  "#SCFCP*#CSCFS* - #ENEESW#ENWWSW", "#SCFPC*#CSPCF* - #WSWWNE#WSEENE", "#SCFPC*#PCCSF* - #WSEENE#WWWSEE",
  "#SCFPC*#SCPCF* - #NESENE#WSWWNE", "#SCPFC*#CCPSF* - #NWWWSE#WNEESE", "#SCPFC*#CSPCF* - #NEEESW#WWNEEE",
  "#SCPFC*#CSPSF* - #WWSEEE#NWSWWN", "#SCSPF*#CCSPF* - #ESWWNW#ESENES", "#SFCCP*#CSCPF* - #WNEESE#NWSWWN",
  "#SFCCS*#PCPSF* - #ENWWSW#ENESEN", "#SPCFC*#CSPCF* - #WWNEEE#WSWNWS", "#SPCFC*#SCCPF* - #ESENES#WWWNEE",
  "#SPSFP*#CCCSF* - #NWSWWN#ESEENW", "#SCFCP*#CSCPF* - #ENESEN#WWWSEE", "#SCPFC*#PCSCF* - #WNEEES#NWSWNW",
  "#FSPCC*#PSCCF* - #WWWSEE#ENWWSW", "#FSCCP*#PCSCF* - #ENWWWS#NEESEN", "#SCPFC*#CCSSF* - #NEESEN#WSWWNE",
  "#SFCCPC*#PCSCPF* - #WSEENES#WWWNEEE", "#SCFCPC*#CSPCSF* - #ESWWNWS#NESENES",
];
const KIND_OF_CHAR = { "#": "start", "*": "end", S: "scavengers", C: "combat", F: "farming", P: "puzzle" };
const DIRECTION_OF_CHAR = { N: "NORTH", E: "EAST", S: "SOUTH", W: "WEST" };

/** Challenge Mode's fixed floors (Wiki): each room and the way the path leaves it. */
const CHALLENGE_FLOORS = [
  [["RAID_START", "WEST"], ["TEKTON", "WEST"], ["CRAB_PUZZLE", "NORTH"], ["SMALL_SCAVENGER_RUNT", "EAST"],
    ["ICE_DEMON", "EAST"], ["LIZARDMEN_SHAMAN", "EAST"], ["RESOURCES_B", "SOUTH"], ["FLOOR_END_DOWNSTAIRS", "SOUTH"]],
  [["FLOOR_START_UPSTAIRS", "WEST"], ["VANGUARD", "WEST"], ["CREATURE_KEEPER", "WEST"], ["SMALL_SCAVENGER_RUNT", "NORTH"],
    ["VESPULA", "EAST"], ["RESOURCES_A", "EAST"], ["DEATHLY_ROOM", "EAST"], ["FLOOR_END_DOWNSTAIRS", "EAST"]],
  [["FLOOR_START_UPSTAIRS", "WEST"], ["GUARDIANS", "WEST"], ["VASA_NISTIRIO", "WEST"], ["SMALL_SCAVENGER_RUNT", "SOUTH"],
    ["DARK_ALTAR_ROOM", "EAST"], ["MUTTADILES", "EAST"], ["RESOURCES_B", "EAST"], ["FLOOR_END_DOWNSTAIRS", "EAST"]],
];

function parsePattern(code) {
  const [rooms, directions] = code.split(" - ");
  return [...rooms].map((char, index) => ({
    kind: KIND_OF_CHAR[char] ?? "puzzle",
    direction: DIRECTION_OF_CHAR[directions[index]] ?? null,
  }));
}

const PATTERNS = LAYOUT_CODES.map((code) => ({ code, rooms: parsePattern(code) }));

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

function takeRandom(list, random) {
  return list.splice(Math.floor(random() * list.length), 1)[0];
}

/** The rooms of a normal raid, split into its two floors: [{ room, direction }]. */
function generateRooms(random = Math.random) {
  const pattern = pick(PATTERNS, random);
  const rotation = pick(BOSS_ROTATIONS, random);
  const combatCount = pattern.rooms.filter((room) => room.kind === "combat").length;
  const start = Math.floor(random() * rotation.length);
  const combat = Array.from({ length: combatCount }, (_, i) => rotation[(start + i) % rotation.length]);
  const pools = {
    scavengers: [...SCAVENGER_ROOMS],
    farming: [...FARMING_ROOMS],
    // Two of the four puzzles are left out of each raid.
    puzzle: [...PUZZLE_ROOMS],
  };
  for (let i = 0; i < 2; i++) takeRandom(pools.puzzle, random);
  const all = { scavengers: SCAVENGER_ROOMS, farming: FARMING_ROOMS, puzzle: PUZZLE_ROOMS };
  const rooms = pattern.rooms.map(({ kind, direction }, index) => {
    if (kind === "start") return { room: index === 0 ? "RAID_START" : "FLOOR_START_UPSTAIRS", direction };
    if (kind === "end") return { room: "FLOOR_END_DOWNSTAIRS", direction };
    if (kind === "combat") return { room: combat.shift(), direction };
    const pool = pools[kind];
    return { room: pool.length > 0 ? takeRandom(pool, random) : pick(all[kind], random), direction };
  });
  const half = rooms.length / 2;
  return { pattern: pattern.code, floors: [rooms.slice(0, half), rooms.slice(half)] };
}

/**
 * Lays rooms out on a grid as a path: each room records its grid tile, the way the path
 * enters it (the rotation it is copied with) and which of the three versions to use.
 * `rooms` are [room, leaveDirection]; the grid is cropped to the rooms afterwards.
 */
class Palette {
  constructor(firstDirection) {
    this.x = 7;
    this.y = 7;
    this.lastDirection = firstDirection;
    this.chunks = [];
  }

  add(room, direction, forceStraight, random) {
    const chunk = { room, x: this.x, y: this.y, entry: this.lastDirection, variant: 0 };
    if (room === "RAID_START") {
      chunk.entry = "NORTH";
      chunk.variant = direction === "WEST" ? 0 : direction === "NORTH" ? 1 : 2;
    } else if (forceStraight) {
      chunk.variant = 0;
    } else if (room === "FLOOR_END_DOWNSTAIRS") {
      // The floor's end room has only two versions.
      chunk.variant = Math.floor(random() * 2);
    } else {
      const left = DIRECTIONS[(DIRECTIONS.indexOf(this.lastDirection) + 3) % 4];
      chunk.variant = this.lastDirection === direction ? 1 : direction === left ? 0 : 2;
    }
    const [dx, dy] = OFFSET[direction];
    this.x += dx;
    this.y += dy;
    this.lastDirection = direction;
    this.chunks.push(chunk);
  }

  crop() {
    const minX = Math.min(...this.chunks.map((chunk) => chunk.x));
    const minY = Math.min(...this.chunks.map((chunk) => chunk.y));
    for (const chunk of this.chunks) {
      chunk.x -= minX;
      chunk.y -= minY;
    }
  }
}

/** Lays one floor out from its rooms in order, each entered from the direction it lists. */
function layFloor(rooms, firstDirection, forceLastRoom, random) {
  const palette = new Palette(firstDirection);
  rooms.forEach((entry, index) => {
    const next = rooms[index + 1]?.direction ?? "SOUTH";
    palette.add(entry.room, next, forceLastRoom && index === rooms.length - 1, random);
  });
  palette.crop();
  return palette.chunks;
}

/** A normal raid: a random pattern, its two floors laid out. */
function normalLayout(random = Math.random) {
  const { pattern, floors } = generateRooms(random);
  const laid = floors.map((rooms, floor) => {
    const second = rooms[1]?.direction;
    const first = second === "WEST" ? "WEST" : second === "NORTH" ? "NORTH" : "EAST";
    return layFloor(rooms, first, floor === 1, random);
  });
  return { pattern, challenge: false, floors: laid };
}

/** Challenge Mode: always the same three floors. */
function challengeLayout() {
  const floors = CHALLENGE_FLOORS.map((rooms) => {
    const palette = new Palette("NORTH");
    for (const [room, direction] of rooms) palette.add(room, direction, false, () => 0);
    palette.crop();
    return palette.chunks;
  });
  return { pattern: null, challenge: true, floors };
}

/** Planes the floors go on: the top floor on 3, then 2, then 1. */
const FLOOR_PLANES = [3, 2, 1];

/** The layout's size in chunks: rooms are 4x4 chunks. */
function sizeOf(layout) {
  let width = 0;
  let height = 0;
  for (const floor of layout.floors) {
    for (const chunk of floor) {
      width = Math.max(width, (chunk.x + 1) * ROOM_CHUNKS);
      height = Math.max(height, (chunk.y + 1) * ROOM_CHUNKS);
    }
  }
  return { width, height };
}

/** The cache chunk a room is copied from. */
function sourceOf(chunk) {
  const room = ROOMS[chunk.room];
  return { chunkX: VARIANT_CHUNK_X[chunk.variant], chunkY: room.chunkY, plane: room.plane };
}

module.exports = {
  ROOMS, ROOM_CHUNKS, VARIANT_CHUNK_X, DIRECTIONS, PUZZLE_ROOMS, BOSS_ROTATIONS, LAYOUT_CODES, PATTERNS,
  CHALLENGE_FLOORS, FLOOR_PLANES, parsePattern, generateRooms, normalLayout, challengeLayout, sizeOf, sourceOf,
};
