"use strict";

/**
 * A raid's private copy of the chambers: its rooms copied from the cache's raid map, turned to
 * face the path, floor above floor, with the Great Olm's chamber beside them.
 *
 * Not on the Wiki (to check against a capture): rooms are 4x4 chunks; floors go on planes 3, 2 (and 1 in Challenge Mode); the
 * gaps around them are filled with a plain wall chunk (416, 647) turned at random; the Olm's
 * chamber is 5x7 chunks copied from (402, 713) on every plane. Tiles inside a room are given
 * as they are on the cache's map and turned with the room. The rope and hole tiles between
 * floors and the raid's first respawn tile are unverified too.
 *
 * Every layout is 16x8 chunks, so the Olm's chamber fits above it in one 16x16 instance.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Layout = require("./Layout.ChambersOfXeric");

const INSTANCE_CHUNKS = 16;
const ROOM_TILES = Layout.ROOM_CHUNKS * 8;
const WRAPPER = { chunkX: 416, chunkY: 647, plane: 0 };
const OLM = { chunkX: 402, chunkY: 713, width: 5, height: 7, atChunkX: 0, atChunkY: 8 };
/** The Olm chamber's entrance and middle, on the cache's map. */
const OLM_TILES = { entrance: { x: 3232, y: 5719 }, centre: { x: 3232, y: 5734 } };
const PLANES = [0, 1, 2, 3];

/**
 * Tiles the raid binds rooms to, on the cache's map, by the room's version (west / north /
 * east-turning): the first room's spawn, the rope up at a floor's start (into the floor
 * above's end room) and the bottom of the hole at a floor's end (the next floor's start room).
 */
const BOUND = {
  RAID_START: [{ x: 3278, y: 5187 }, { x: 3298, y: 5188 }, { x: 3330, y: 5188 }],
  FLOOR_END_DOWNSTAIRS: [{ x: 3278, y: 5168 }, { x: 3308, y: 5173 }, null],
  FLOOR_START_UPSTAIRS: [{ x: 3280, y: 5711 }, { x: 3312, y: 5711 }, { x: 3344, y: 5711 }],
};

let MapClass = null;

/** A tile of a 32x32 room turned clockwise `rotation` times; `size` for an NPC's south-west. */
function rotateRoomTile(x, y, rotation, size = 1, sizeY = size) {
  const last = ROOM_TILES - 1;
  const farX = size - 1;
  const farY = sizeY - 1;
  switch (rotation & 3) {
    case 0: return [x, y];
    case 1: return [y, last - x - farX];
    case 2: return [last - x - farX, last - y - farY];
    default: return [last - y - farY, x];
  }
}

// Raid-scoped rules from the unit files. The raid's area runs them, so nobody outside a raid
// pays for them. Handlers take the old hook event ({ attacker, target, method, allow } /
// { player, allow }) and the first to set `allow` decides.
const areaHandlers = { canAttack: [], canTeleport: [] };

function onRaidArea(kind, handler) {
  areaHandlers[kind].push(handler);
}

function firstVerdict(handlers, event) {
  for (const handler of handlers) {
    handler(event);
    if (event.allow !== null) return event.allow;
  }
  return null;
}

function mapClass() {
  if (MapClass) return MapClass;
  const { TemplatedInstanceArea } = Shared.core();
  MapClass = class CoxMap extends TemplatedInstanceArea {
    constructor(layout, random = Math.random) {
      super(INSTANCE_CHUNKS, INSTANCE_CHUNKS);
      this.layout = layout;
      this.rooms = [];
      this.raid = null;
      layout.floors.forEach((floor, floorIndex) => {
        const plane = Layout.FLOOR_PLANES[floorIndex];
        for (let x = 0; x < INSTANCE_CHUNKS; x++) {
          for (let y = 0; y < OLM.atChunkY; y++) {
            this.setChunk(plane, x, y, {
              sourceChunkX: WRAPPER.chunkX, sourceChunkY: WRAPPER.chunkY, sourcePlane: WRAPPER.plane,
              rotation: Math.floor(random() * 4),
            });
          }
        }
        for (const chunk of floor) {
          const source = Layout.sourceOf(chunk);
          const rotation = Layout.DIRECTIONS.indexOf(chunk.entry);
          this.copySquare(Layout.ROOM_CHUNKS, source.chunkX, source.chunkY, source.plane,
            chunk.x * Layout.ROOM_CHUNKS, chunk.y * Layout.ROOM_CHUNKS, plane, rotation);
          this.rooms.push({
            index: this.rooms.length, key: chunk.room, ...Layout.ROOMS[chunk.room], floor: floorIndex, plane,
            gridX: chunk.x, gridY: chunk.y, rotation, variant: chunk.variant, source,
          });
        }
      });
      for (const plane of PLANES) {
        for (let x = 0; x < OLM.width; x++) {
          for (let y = 0; y < OLM.height; y++) {
            this.setChunk(plane, OLM.atChunkX + x, OLM.atChunkY + y, {
              sourceChunkX: OLM.chunkX + x, sourceChunkY: OLM.chunkY + y, sourcePlane: plane, rotation: 0,
            });
          }
        }
      }
      this.bindTiles();
    }

    getName() {
      return "Chambers of Xeric";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) this.raid?.playerLeftArea(mobile.getAsPlayer(), logout);
      super.postLeave(mobile, logout);
    }

    canAttack(attacker, target, method) {
      return firstVerdict(areaHandlers.canAttack, { attacker, target, method, allow: null });
    }

    canTeleport(player, wildernessLevelLimit, destination) {
      return firstVerdict(areaHandlers.canTeleport, { player, wildernessLevelLimit, destination, allow: null });
    }

    /** A cache tile of a room's source, where it lands in the raid; size is the footprint there (x by y). */
    roomTile(room, x, y, size = 1, sizeY = size) {
      const localX = x - room.source.chunkX * 8;
      const localY = y - room.source.tileChunkY * 8;
      const [tx, ty] = rotateRoomTile(localX, localY, room.rotation, size, sizeY);
      return this.tile(room.gridX * ROOM_TILES + tx, room.gridY * ROOM_TILES + ty, room.plane);
    }

    /** One of three tiles by which version of the room was copied (west, north, east turn). */
    respective(room, tiles) {
      const tile = tiles[room.variant];
      return tile ? this.roomTile(room, tile.x, tile.y) : null;
    }

    /** A tile of the Olm's chamber, given where it is on the cache's map. */
    olmTile(x, y, z = 0) {
      return this.tile(OLM.atChunkX * 8 + (x - OLM.chunkX * 8), OLM.atChunkY * 8 + (y - OLM.chunkY * 8), z);
    }

    inOlmChamber(location) {
      const x = location.getX() - this.getBaseX();
      const y = location.getY() - this.getBaseY();
      return x >= OLM.atChunkX * 8 && x < (OLM.atChunkX + OLM.width) * 8
        && y >= OLM.atChunkY * 8 && y < (OLM.atChunkY + OLM.height) * 8;
    }

    /** The room a tile is in, or null (the Olm's chamber is not a room here). */
    roomAt(location) {
      if (!this.contains(location) || this.inOlmChamber(location)) return null;
      const gridX = Math.floor((location.getX() - this.getBaseX()) / ROOM_TILES);
      const gridY = Math.floor((location.getY() - this.getBaseY()) / ROOM_TILES);
      return this.rooms.find((room) => room.plane === location.getZ() && room.gridX === gridX && room.gridY === gridY) ?? null;
    }

    /**
     * The first room's spawn; for each floor's start, the rope's landing in the floor above;
     * for each floor's end, the hole's landing in the next floor (or the Olm's entrance).
     */
    bindTiles() {
      this.olmEntrance = this.olmTile(OLM_TILES.entrance.x, OLM_TILES.entrance.y);
      this.olmCentre = this.olmTile(OLM_TILES.centre.x, OLM_TILES.centre.y);
      this.rooms.forEach((room, index) => {
        if (room.key === "RAID_START") {
          room.bound = this.respective(room, BOUND.RAID_START);
        } else if (room.key === "FLOOR_START_UPSTAIRS") {
          const above = this.rooms[index - 1];
          room.bound = above ? this.respective(above, BOUND.FLOOR_END_DOWNSTAIRS) : null;
        } else if (room.key === "FLOOR_END_DOWNSTAIRS") {
          const below = this.rooms[index + 1];
          room.bound = below ? this.respective(below, BOUND.FLOOR_START_UPSTAIRS) : this.olmEntrance;
        }
      });
      this.olmRopeLanding = (() => {
        const last = this.rooms[this.rooms.length - 1];
        return last ? this.respective(last, BOUND.FLOOR_END_DOWNSTAIRS) : null;
      })();
    }

    startTile() {
      return this.landing(this.rooms[0].bound);
    }

    /**
     * Where a player lands on a bound tile: the tile itself, or the nearest open one. The
     * ropes, holes and the Olm's rope stand on their landing tiles; the raid then walks the
     * player a step off them.
     */
    landing(tile) {
      if (!tile) return null;
      const { RegionManager } = Shared.core();
      const open = (x, y) => (RegionManager.getClipping(x, y, tile.getZ(), this) & 0x1280100) === 0;
      if (open(tile.getX(), tile.getY())) return tile;
      for (let radius = 1; radius <= 3; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            if (open(tile.getX() + dx, tile.getY() + dy)) return tile.clone().add(dx, dy);
          }
        }
      }
      return tile;
    }

    /** The raid's NPCs go with it. */
    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Shared.api()?.removeNpc?.(entity);
      }
      super.destroy();
    }
  };
  return MapClass;
}

function createMap(layout, random) {
  return new (mapClass())(layout, random);
}

module.exports = { INSTANCE_CHUNKS, ROOM_TILES, OLM, OLM_TILES, BOUND, rotateRoomTile, createMap, onRaidArea };
