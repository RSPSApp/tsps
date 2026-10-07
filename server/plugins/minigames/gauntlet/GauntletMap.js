"use strict";

/**
 * The Gauntlet's maze: a 7x7 grid of rooms, each 2x2 chunks, with the Hunllef's room in the
 * centre and the start room beside it on a random side (Wiki). The whole layout - every room's
 * template and turn, and which rooms hold demi-bosses - is decided when the map is made. Rooms
 * are drawn only once lit: OSRS shows nothing past an unlit node, so lighting copies the room's
 * chunks and everyone inside is sent the new scene.
 *
 * Templates (Near-Reality's, checked against the cache): rooms at chunk X 232 (four exits,
 * middle), 234 (three, edge) and 236 (two, corner), Y 704 + 2 * (0-3) for four variants of each;
 * the start room at (238, 708) and the boss room at (238, 710). The Corrupted Gauntlet uses the
 * same layout 8 chunks east.
 */

const Shared = require("./GauntletShared");

const GRID = 7;
const CENTRE = 3;
const ROOM_CHUNKS = 2;
const ROOM_TILES = ROOM_CHUNKS * 8;
const PLANES = [0, 1, 2, 3];
const CORRUPTED_OFFSET = 8;
const TEMPLATE = {
  start: { chunkX: 238, chunkY: 708 },
  boss: { chunkX: 238, chunkY: 710 },
  MIDDLE: 232,
  EDGE: 234,
  CORNER: 236,
  firstVariantY: 704,
  variants: 4,
};
// The sides of a room, as grid steps.
const SIDES = [
  { name: "north", dx: 0, dy: 1 },
  { name: "east", dx: 1, dy: 0 },
  { name: "south", dx: 0, dy: -1 },
  { name: "west", dx: -1, dy: 0 },
];
const DEMI_BOSSES = ["bear", "dragon", "dark_beast"];

let MapClass = null;

function randomInt(random, max) {
  return Math.floor(random() * max);
}

/** Corners have two exits, the rest of the rim three, and the inside four. */
function roomType(gridX, gridY) {
  const rimX = gridX === 0 || gridX === GRID - 1;
  const rimY = gridY === 0 || gridY === GRID - 1;
  if (rimX && rimY) return "CORNER";
  return rimX || rimY ? "EDGE" : "MIDDLE";
}

/** Turns a rim room so its closed sides face out of the maze; inside rooms turn at random. */
function roomRotation(gridX, gridY, random) {
  const last = GRID - 1;
  if (gridX === last && gridY === last) return 0;
  if (gridX === 0 && gridY === 0) return 2;
  if (gridX === 0 && gridY === last) return 3;
  if (gridX === last && gridY === 0) return 1;
  if (gridX === 0) return 3;
  if (gridX === last) return 1;
  if (gridY === 0) return 2;
  if (gridY === last) return 0;
  return randomInt(random, 4);
}

/** Demi-bosses wait in the three middle rooms of each side of the rim. */
function isDemiBossRoom(gridX, gridY) {
  const rimX = gridX === 0 || gridX === GRID - 1;
  const rimY = gridY === 0 || gridY === GRID - 1;
  if (rimX) return gridY >= 2 && gridY <= 4;
  if (rimY) return gridX >= 2 && gridX <= 4;
  return false;
}

/** The plan of a run's maze: what each room is, before any of it is drawn. */
function planLayout(random) {
  const side = SIDES[randomInt(random, SIDES.length)];
  const start = { x: CENTRE + side.dx, y: CENTRE + side.dy };
  const rooms = [];
  for (let x = 0; x < GRID; x++) {
    const column = [];
    for (let y = 0; y < GRID; y++) {
      const special = x === CENTRE && y === CENTRE ? "boss" : x === start.x && y === start.y ? "start" : null;
      const type = roomType(x, y);
      column.push({
        gridX: x,
        gridY: y,
        special,
        type,
        template: special
          ? { ...TEMPLATE[special] }
          : { chunkX: TEMPLATE[type], chunkY: TEMPLATE.firstVariantY + 2 * randomInt(random, TEMPLATE.variants) },
        rotation: special ? 0 : roomRotation(x, y, random),
        demiBoss: null,
        lit: false,
      });
    }
    rooms.push(column);
  }
  // Six demi-boss rooms: each kind twice (Near-Reality; the Wiki lists the three kinds).
  const candidates = rooms.flat().filter((room) => isDemiBossRoom(room.gridX, room.gridY));
  for (const kind of [...DEMI_BOSSES, ...DEMI_BOSSES]) {
    const [room] = candidates.splice(randomInt(random, candidates.length), 1);
    room.demiBoss = kind;
  }
  return { start, rooms };
}

function mapClass() {
  if (MapClass) return MapClass;
  const { TemplatedInstanceArea } = Shared.core();
  MapClass = class GauntletMap extends TemplatedInstanceArea {
    constructor({ corrupted = false, random = Math.random } = {}) {
      super(GRID * ROOM_CHUNKS, GRID * ROOM_CHUNKS);
      this.corrupted = corrupted;
      const { start, rooms } = planLayout(random);
      this.start = start;
      this.rooms = rooms;
      this.lightRoom(CENTRE, CENTRE);
      this.lightRoom(start.x, start.y);
    }

    getName() {
      return this.corrupted ? "The Corrupted Gauntlet" : "The Gauntlet";
    }

    allowSummonPet() {
      return false;
    }

    isMulti() {
      return true;
    }

    process(mobile) {
      if (mobile.isPlayer?.()) this.run?.updateRoom?.();
    }

    /** The maze's monsters go with it (they are its entities, not visitors it saw enter). */
    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Shared.api()?.removeNpc?.(entity);
      }
      super.destroy();
    }

    postLeave(mobile, logout) {
      // Logging out or being moved out of the maze by anything but the run ends the run.
      if (mobile.isPlayer?.() && this.run?.player === mobile.getAsPlayer()) {
        this.run.end(logout ? "logout" : "left", { fromArea: true });
      }
      super.postLeave(mobile, logout);
    }

    room(gridX, gridY) {
      return this.rooms[gridX]?.[gridY] ?? null;
    }

    /** The room a tile is in, or null outside the maze. */
    roomAt(location) {
      if (!this.contains(location)) return null;
      return this.room(
        Math.floor((location.getX() - this.getBaseX()) / ROOM_TILES),
        Math.floor((location.getY() - this.getBaseY()) / ROOM_TILES),
      );
    }

    /** A tile of a room, counted from its south-west corner. */
    roomTile(room, offsetX, offsetY, z = Shared.PLANE) {
      return this.tile(room.gridX * ROOM_TILES + offsetX, room.gridY * ROOM_TILES + offsetY, z);
    }

    /** Draws a room: its chunks are copied in and the scene is resent to everyone inside. */
    lightRoom(gridX, gridY) {
      const room = this.room(gridX, gridY);
      if (!room || room.lit) return false;
      room.lit = true;
      const offset = this.corrupted ? CORRUPTED_OFFSET : 0;
      for (const plane of PLANES) {
        this.copySquare(ROOM_CHUNKS, room.template.chunkX + offset, room.template.chunkY, plane,
          gridX * ROOM_CHUNKS, gridY * ROOM_CHUNKS, plane, room.rotation);
      }
      return true;
    }

    lightAll() {
      for (const room of this.rooms.flat()) this.lightRoom(room.gridX, room.gridY);
    }

    /** Where a run begins: the start room's middle (Near-Reality: 5-6 tiles in each way). */
    startTile(random = Math.random) {
      return this.roomTile(this.room(this.start.x, this.start.y), 5 + randomInt(random, 2), 5 + randomInt(random, 2));
    }
  };
  return MapClass;
}

function createMap(options) {
  return new (mapClass())(options);
}

module.exports = {
  GRID, CENTRE, ROOM_TILES, SIDES,
  roomType, roomRotation, isDemiBossRoom, planLayout, createMap,
};
