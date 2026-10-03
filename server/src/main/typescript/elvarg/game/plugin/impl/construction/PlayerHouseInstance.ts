import { HOUSE_STYLES, houseStyleIndex } from "./HouseEstateData";
import { enterServantHouse, leaveServantHouse, type SavedServant } from "./ConstructionServants";
import type { Mobile } from "../../../entity/impl/Mobile";
import { RegionManager } from "../../../collision/RegionManager";
import { Boundary } from "../../../model/Boundary";
import { PrivateArea } from "../../../model/areas/impl/PrivateArea";
import { Skill } from "../../../model/Skill";
import { Location } from "../../../model/Location";
import { CachePipeline } from "../../../cache/CachePipeline";
import { CacheMaps } from "../../../cache/CacheMaps";
import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { ByteBuffer } from "../../../cache/codec/rs/io/ByteBuffer";
import { GameObject } from "../../../entity/impl/object/GameObject";
import { encodeLocAddChange, encodeLocDel, encodeRebuildRegion } from "../../../../net/protocol/ClientProtocol";
import type { Player } from "../../../entity/impl/player/Player";
import { BUILDABLE_BY_KEY, CONSTRUCTION_ROOMS, HOTSPOT_BY_OBJECT_ID, HOUSE_TEMPLATE_CHUNKS, ROOM_BY_KEY, type ConstructionBuildable, type ConstructionRoom } from "./ConstructionData";
import { emptyHousePalette, HOUSE_PLANES, HOUSE_SCENE_CHUNKS, packTemplateChunk, rotateHotspot } from "./HousePaletteCompiler";

export type SavedHouseRoom = Readonly<{
  roomKey: string;
  rotation: number;
  furniture: Readonly<Record<string, string>>;
  /** Location-keyed furniture keeps repeated hotspots independent and rotates with its room. */
  furnitureByLocation?: Readonly<Record<string, SavedHouseFurniture>>;
}>;

export type SavedHouseFurniture = {
  buildableKey: string;
  hotspotKey: string;
  sourceObjectId: number;
  localX: number;
  localY: number;
  type: number;
  face: number;
  destinations?: string[];
  displayObjectId?: number;
  storage?: Record<number, number>;
};

/** JSON-safe player persistence shape. `rooms[plane][x][y]` is a room or null. */
export type PlayerHouseSave = {
  rooms: Array<Array<Array<SavedHouseRoom | null>>>;
  locked?: boolean;
  /** Missing ownership on legacy saves means an already-owned house. */
  owned?: boolean;
  location?: number;
  style?: number;
  unlockedStyles?: number[];
  visitedKourend?: boolean;
  visitedVarlamore?: boolean;
  servant?: SavedServant;
  servantMoney?: number;
  /** 0 closed, 1 open, 2 no doors (native House Options varbit 6269). */
  doorMode?: number;
};

export type HouseAllocation = Readonly<{ baseX: number; baseY: number }>;
export type HouseRoomPosition = Readonly<{ x: number; y: number; plane: number }>;
export type HouseFurnitureTarget = Readonly<{
  position: HouseRoomPosition;
  hotspotKey: string;
  sourceObjectId: number;
  localX: number;
  localY: number;
  type: number;
  face: number;
}>;

const HOUSE_SIZE = 104;
const HOUSE_STRIDE = 112;
const HOUSE_ALLOCATION_COLUMNS = 16;
const HOUSE_ALLOCATION_COUNT = HOUSE_ALLOCATION_COLUMNS * HOUSE_ALLOCATION_COLUMNS;
const ROOM_DOOR_HOTSPOT_MIN = 15305;
const ROOM_DOOR_HOTSPOT_MAX = 15322;
const HOUSE_BUILDING_MODE_VARBIT = 2176;
const HOUSE_DYNAMIC_WINDOW = 13830;

type TemplateObject = Readonly<{
  id: number;
  sourceChunkX: number;
  sourceChunkY: number;
  localX: number;
  localY: number;
  type: number;
  face: number;
}>;
const allocatedHouses = new Array<boolean>(HOUSE_ALLOCATION_COUNT).fill(false);
function allocateHouse(): HouseAllocation {
  const index = allocatedHouses.findIndex((used) => !used);
  if (index < 0) throw new Error("No Construction instance allocation is available.");
  allocatedHouses[index] = true;
  return {
    baseX: 6400 + (index % HOUSE_ALLOCATION_COLUMNS) * HOUSE_STRIDE,
    baseY: 6400 + Math.floor(index / HOUSE_ALLOCATION_COLUMNS) * HOUSE_STRIDE,
  };
}

function releaseHouse(allocation: HouseAllocation): void {
  const x = Math.trunc((allocation.baseX - 6400) / HOUSE_STRIDE);
  const y = Math.trunc((allocation.baseY - 6400) / HOUSE_STRIDE);
  const index = y * HOUSE_ALLOCATION_COLUMNS + x;
  if (index >= 0 && index < allocatedHouses.length) allocatedHouses[index] = false;
}

export function createDefaultHouseSave(): PlayerHouseSave {
  const rooms = Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => Array<SavedHouseRoom | null>(8).fill(null)),
  );
  rooms[1][4][4] = { roomKey: "GARDEN", rotation: 0, furniture: { CENTERPIECE: "EXIT_PORTAL" } };
  rooms[1][4][5] = { roomKey: "PARLOUR", rotation: 0, furniture: {} };
  return { rooms };
}

/** Minimal 4x4 grass test map with one Parlour, used by ::myhouse. */
export function createTestHouseSave(): PlayerHouseSave {
  const rooms = Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => Array<SavedHouseRoom | null>(8).fill(null)),
  );
  rooms[1][1][1] = { roomKey: "PARLOUR", rotation: 0, furniture: {} };
  return { rooms };
}

export class PlayerHouseInstance extends PrivateArea {
  public owner: Player | null = null;
  public buildingMode = false;
  public readonly litBurners = new Map<SavedHouseFurniture, number>();
  private static readonly templateObjects = new Map<number, readonly TemplateObject[]>();
  private readonly roomDoors: GameObject[] = [];
  private readonly visibleDoors: Array<{ object: GameObject; origin: Location; face: number; style: number; side: number; open: boolean }> = [];
  private readonly furnitureObjects: GameObject[] = [];
  private readonly doorTargets = new Map<string, HouseRoomPosition>();
  public readonly allocation: HouseAllocation;

  /** Test-house allocations are process-local and must never be restored as normal map tiles. */
  public static isAllocationLocation(location: Location): boolean {
    const maximum = 6400 + HOUSE_ALLOCATION_COLUMNS * HOUSE_STRIDE;
    return location.getX() >= 6400 && location.getX() < maximum
      && location.getY() >= 6400 && location.getY() < maximum;
  }

  constructor(public readonly save: PlayerHouseSave, private readonly gridSize = 8) {
    const allocation = allocateHouse();
    super(Array.from({ length: 4 }, (_, plane) => new Boundary(
      allocation.baseX,
      allocation.baseX + HOUSE_SIZE - 1,
      allocation.baseY,
      allocation.baseY + HOUSE_SIZE - 1,
      plane,
    )));
    this.allocation = allocation;
    // Older saves used a fabricated shape 10 / face 0 for every hotspot.
    // Re-key them with the template placement so existing furniture is repaired too.
    for (const plane of save.rooms) {
      for (const column of plane) {
        for (let y = 0; y < column.length; y++) {
          const room = column[y];
          if (!room?.furnitureByLocation) continue;
          const furnitureByLocation: Record<string, SavedHouseFurniture> = {};
          for (const saved of Object.values(room.furnitureByLocation)) {
            const template = this.getTemplateHotspot(room.roomKey, saved.sourceObjectId, saved.localX, saved.localY);
            const furniture = template ? { ...saved, sourceObjectId: template.id, type: template.type, face: template.face } : saved;
            furnitureByLocation[this.furnitureKey(furniture.localX, furniture.localY, furniture.type)] = furniture;
          }
          column[y] = { ...room, furnitureByLocation };
        }
      }
    }
  }

  public buildPalette(buildingMode: boolean): number[][][] {
    const palette = emptyHousePalette();
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < HOUSE_PLANES; plane++) {
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          const room = plane < this.save.rooms.length ? this.save.rooms[plane]?.[x]?.[y] : null;
          const withinGrid = x < this.gridSize && y < this.gridSize;
          const template = room
            ? ROOM_BY_KEY.get(room.roomKey)
            : !withinGrid
              ? null
              : plane === 0
              ? HOUSE_TEMPLATE_CHUNKS.basementFloor
              : plane === 1
                ? HOUSE_TEMPLATE_CHUNKS.groundFloor
                : buildingMode
                  ? HOUSE_TEMPLATE_CHUNKS.blank
                  : null;
          if (room && !template) {
            throw new Error(`Unknown Construction room template: ${room.roomKey}`);
          }
          if (!template) continue;
          palette[plane][x + gridOffset][y + gridOffset] = packTemplateChunk({
            sourceChunkX: template.sourceChunkX + Math.floor(houseStyleIndex(this.save) / 4) * 8,
            sourceChunkY: template.sourceChunkY,
            sourcePlane: houseStyleIndex(this.save) % 4,
            rotation: room?.rotation ?? 0,
          });
        }
      }
    }
    return palette;
  }

  public getRoom(position: HouseRoomPosition): SavedHouseRoom | null {
    return this.isRoomPosition(position) ? this.save.rooms[position.plane][position.x][position.y] : null;
  }

  public getDoorTarget(location: { x: number; y: number; z: number }): HouseRoomPosition | null {
    return this.doorTargets.get(`${location.x}:${location.y}:${location.z}`) ?? null;
  }

  public getFurnitureTarget(
    location: { x: number; y: number; z: number },
    sourceObjectId: number,
  ): HouseFurnitureTarget | null {
    const hotspot = HOTSPOT_BY_OBJECT_ID.get(sourceObjectId);
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    const template = room ? ROOM_BY_KEY.get(room.roomKey) : null;
    if (!hotspot || !position || !room || !template || !template.hotspots.includes(hotspot.key)) return null;

    const placement = PlayerHouseInstance.getTemplateObjects(houseStyleIndex(this.save)).find(object => {
      if (object.id !== sourceObjectId || object.sourceChunkX !== template.sourceChunkX || object.sourceChunkY !== template.sourceChunkY) return false;
      const local = this.rotatedFootprint(object.localX, object.localY, object.id, object.face, room.rotation);
      return local.x === ((location.x - this.allocation.baseX) & 7) && local.y === ((location.y - this.allocation.baseY) & 7);
    });
    if (!placement) return null;
    return {
      position,
      hotspotKey: hotspot.key,
      sourceObjectId,
      localX: placement.localX,
      localY: placement.localY,
      type: placement.type,
      face: placement.face,
    };
  }

  public getFurnitureAt(location: { x: number; y: number; z: number }, objectId: number, type: number): SavedHouseFurniture | null {
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    if (!position || !room) return null;
    const furniture = Object.values(room.furnitureByLocation ?? {}).find(value => {
      const local = this.rotatedFootprint(value.localX, value.localY, value.sourceObjectId, value.face, room.rotation);
      return value.type === type && local.x === ((location.x - this.allocation.baseX) & 7) && local.y === ((location.y - this.allocation.baseY) & 7);
    });
    if (!furniture) return null;
    const buildable = BUILDABLE_BY_KEY.get(furniture.buildableKey);
    return buildable && (buildable.objectIds.includes(objectId) || furniture.displayObjectId === objectId
      || (this.litBurners.has(furniture) && buildable.objectIds[0] + 1 === objectId)) ? furniture : null;
  }

  public getFurnitureAtTarget(target: HouseFurnitureTarget): SavedHouseFurniture | null {
    const room = this.getRoom(target.position);
    return room?.furnitureByLocation?.[this.furnitureKey(target.localX, target.localY, target.type)] ?? null;
  }

  public setFurniture(target: HouseFurnitureTarget, buildable: ConstructionBuildable): void {
    const room = this.getRoom(target.position);
    if (!room) return;
    const key = this.furnitureKey(target.localX, target.localY, target.type);
    const furniture: SavedHouseFurniture = {
      ...this.getFurnitureAtTarget(target),
      buildableKey: buildable.key,
      hotspotKey: target.hotspotKey,
      sourceObjectId: target.sourceObjectId,
      localX: target.localX,
      localY: target.localY,
      type: target.type,
      face: target.face,
    };
    this.save.rooms[target.position.plane][target.position.x][target.position.y] = {
      ...room,
      furniture: { ...room.furniture, [target.hotspotKey]: buildable.key },
      furnitureByLocation: { ...room.furnitureByLocation, [key]: furniture },
    };
  }

  public canRemoveFurniture(location: { x: number; y: number; z: number }, objectId: number, type: number): string | null {
    const furniture = this.getFurnitureAt(location, objectId, type);
    if (!furniture) return "There is no constructed furniture there.";
    if (Object.values(furniture.storage ?? {}).some(amount => amount > 0)) return "Empty this storage before removing it.";
    if (furniture.buildableKey === "EXIT_PORTAL" && this.getExitPortalCount() === 1) {
      return "Your house must have at least one exit portal.";
    }
    return null;
  }

  public removeFurniture(location: { x: number; y: number; z: number }, objectId: number, type: number): SavedHouseFurniture | null {
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    const furniture = this.getFurnitureAt(location, objectId, type);
    if (!position || !room || !furniture) return null;
    const remaining = { ...room.furnitureByLocation };
    delete remaining[this.furnitureKey(furniture.localX, furniture.localY, type)];
    const legacyFurniture = { ...room.furniture };
    if (!Object.values(remaining).some((entry) => entry.hotspotKey === furniture.hotspotKey && entry.buildableKey === furniture.buildableKey)) {
      delete legacyFurniture[furniture.hotspotKey];
    }
    this.save.rooms[position.plane][position.x][position.y] = {
      ...room,
      furniture: legacyFurniture,
      furnitureByLocation: remaining,
    };
    return furniture;
  }

  public override resolveObject(id: number, location: Location): GameObject | null {
    if ((id >= ROOM_DOOR_HOTSPOT_MIN && id <= ROOM_DOOR_HOTSPOT_MAX)
      || HOUSE_STYLES[houseStyleIndex(this.save)].doorHotspots.includes(id)) {
      const target = this.getDoorTarget({ x: location.getX(), y: location.getY(), z: location.getZ() }) ?? this.getDoorTargetAtLocation(location);
      if (!target) return null;
      this.doorTargets.set(`${location.getX()}:${location.getY()}:${location.getZ()}`, target);
      const door = new GameObject(id, location.clone(), 0, 0, this);
      this.roomDoors.push(door);
      return door;
    }

    // Dynamic-template hotspots exist only in the client's scene, so expose a
    // temporary server object after confirming that it belongs to this room.
    const target = this.getFurnitureTarget({ x: location.getX(), y: location.getY(), z: location.getZ() }, id);
    if (!target || this.getFurnitureAtTarget(target)) return null;
    const rotation = this.getRoom(target.position)!.rotation;
    const hotspot = new GameObject(id, location.clone(), target.type, (target.face + rotation) & 3, this);
    this.detach(hotspot);
    return hotspot;
  }

  public canPlaceRoom(room: ConstructionRoom, position: HouseRoomPosition, constructionLevel: number): string | null {
    if (!this.isRoomPosition(position)) return "That room location is outside your house.";
    if (this.getRoom(position)) return "There is already a room there.";
    if (!this.fitsHouseDimensions(position, constructionLevel)) return "That exceeds the house dimensions for your Construction level.";
    if (constructionLevel < room.level) return `You need Construction level ${room.level} to build a ${room.name}.`;
    if (this.getRoomCount() >= this.getMaxRooms(constructionLevel)) return "You already have the maximum number of rooms for your Construction level.";
    if (room.basement && position.plane !== 0) return "This room can only be created in the basement.";
    if (room.outdoors && position.plane !== 1) return "You can only add that room on surface level.";
    if (position.plane > 1) {
      const below = this.getRoom({ ...position, plane: position.plane - 1 });
      if (!below || ROOM_BY_KEY.get(below.roomKey)?.outdoors) return "You can't add a room with nothing below to support it.";
    }
    if (room.key === "COSTUME_ROOM" && this.hasRoom("COSTUME_ROOM")) return "You may only have one costume room.";
    if (room.key === "PORTAL_NEXUS" && this.hasRoom("PORTAL_NEXUS")) return "You may only have one portal nexus room.";
    if ((room.key === "MENAGERIE_INDOORS" || room.key === "MENAGERIE_OUTDOORS") && (this.hasRoom("MENAGERIE_INDOORS") || this.hasRoom("MENAGERIE_OUTDOORS"))) {
      return "You may only have one menagerie.";
    }
    return null;
  }

  public placeRoom(position: HouseRoomPosition, room: ConstructionRoom, rotation = 0): void {
    this.save.rooms[position.plane][position.x][position.y] = { roomKey: room.key, rotation: rotation & 3, furniture: {} };
  }

  public rotateRoom(position: HouseRoomPosition, rotation?: number): SavedHouseRoom | null {
    const room = this.getRoom(position);
    if (!room) return null;
    const rotated = { ...room, rotation: (rotation ?? room.rotation + 1) & 3 };
    this.save.rooms[position.plane][position.x][position.y] = rotated;
    return rotated;
  }

  public getRoomDoorMask(position: HouseRoomPosition): number {
    const room = this.getRoom(position), template = room && ROOM_BY_KEY.get(room.roomKey);
    if (!room || !template) return 0;
    if (template.outdoors) return 15;
    let mask = 0;
    for (const object of PlayerHouseInstance.getTemplateObjects(houseStyleIndex(this.save))) {
      if (((object.id < ROOM_DOOR_HOTSPOT_MIN || object.id > ROOM_DOOR_HOTSPOT_MAX)
        && !HOUSE_STYLES[houseStyleIndex(this.save)].doorHotspots.includes(object.id))
        || object.sourceChunkX !== template.sourceChunkX || object.sourceChunkY !== template.sourceChunkY) continue;
      const edge = object.localX === 0 ? 3 : object.localY === 7 ? 0 : object.localX === 7 ? 1 : 2;
      mask |= 1 << edge;
    }
    return mask;
  }

  public getAdjacentDoorMask(position: HouseRoomPosition): number {
    const offsets = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    return offsets.reduce((mask, [dx, dy], edge) => {
      const adjacent = { x: position.x + dx, y: position.y + dy, plane: position.plane };
      const room = this.getRoom(adjacent);
      const doors = this.getRoomDoorMask(adjacent);
      const rotated = room ? ((doors << room.rotation) | (doors >> (4 - room.rotation))) & 15 : 0;
      return mask | ((rotated & (1 << ((edge + 2) & 3))) ? 1 << edge : 0);
    }, 0);
  }

  public canMoveRoom(from: HouseRoomPosition, to: HouseRoomPosition): string | null {
    const room = this.getRoom(from);
    if (!room) return "There is no room there.";
    if (!this.isRoomPosition(to)) return "That room location is outside your house.";
    if (this.getRoom(to)) return "There is already a room there.";
    if (!this.fitsHouseDimensions(to, this.owner?.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) ?? 99, from)) return "That exceeds the house dimensions for your Construction level.";
    if (from.plane === 1 && this.getRoom({ ...from, plane: 2 })) return "That room supports a room above it.";
    const definition = ROOM_BY_KEY.get(room.roomKey)!;
    if (definition.basement && to.plane !== 0) return "This room belongs in the basement.";
    if (definition.outdoors && to.plane !== 1) return "This room belongs on the surface.";
    if (to.plane === 2) {
      const below = this.getRoom({ ...to, plane: 1 });
      if (!below || ROOM_BY_KEY.get(below.roomKey)?.outdoors
        || (from.plane === 1 && from.x === to.x && from.y === to.y)) return "This room needs a room below to support it.";
    }
    return null;
  }

  public moveRoom(from: HouseRoomPosition, to: HouseRoomPosition, rotation: number): boolean {
    if (this.canMoveRoom(from, to)) return false;
    const room = this.getRoom(from)!;
    this.save.rooms[to.plane][to.x][to.y] = { ...room, rotation: rotation & 3 };
    this.removeRoom(from);
    return true;
  }

  public canRemoveRoom(position: HouseRoomPosition): string | null {
    const room = this.getRoom(position);
    if (!room) return "There is no room there.";
    if (Object.values(room.furnitureByLocation ?? {}).some(furniture => Object.values(furniture.storage ?? {}).some(amount => amount > 0))) return "Empty the storage in this room before removing it.";
    if (position.plane === 1 && this.getRoom({ ...position, plane: 2 })) return "You can't remove that room because it supports a room above it.";
    if ((room.roomKey === "GARDEN" || room.roomKey === "FORMAL_GARDEN") && this.hasExitPortal(room) && this.getExitPortalCount() === 1) {
      return "Your house must have at least one exit portal.";
    }
    return null;
  }

  public removeRoom(position: HouseRoomPosition): void {
    if (this.isRoomPosition(position)) this.save.rooms[position.plane][position.x][position.y] = null;
  }

  /** Moves a player into this allocation and immediately streams its dynamic scene. */
  public enterHouse(player: Player, buildingMode: boolean): boolean {
    this.buildingMode = buildingMode;
    PlayerHouseInstance.getTemplateObjects(houseStyleIndex(this.save));
    const previousArea = player.getArea();
    if (previousArea && previousArea !== this) previousArea.leave(player, false);
    this.enter(player);
    player.moveTo(this.getEntryLocation());
    const sent = this.rebuild(player, buildingMode);
    if (sent) enterServantHouse(player, this);
    return sent;
  }

  public postLeave(mobile: Mobile, logout: boolean): void {
    if (mobile.isNpc()) { this.remove(mobile); return; }
    if (mobile.isPlayer()) leaveServantHouse(mobile.getAsPlayer(), this);
    super.postLeave(mobile, logout);
  }

  /** Replays the current saved layout after a room edit. */
  public rebuild(player: Player, buildingMode: boolean): boolean {
    this.buildingMode = buildingMode;
    // Remove old solid doors before the new scene installs its construction hotspots.
    if (buildingMode) this.refreshDoors();
    this.clearFurniture();
    player.getPacketSender().sendVarbit(HOUSE_BUILDING_MODE_VARBIT, buildingMode ? 1 : 0);
    const center = this.getSceneCenter();
    const palette = this.buildPalette(buildingMode);
    const seenRegions = new Set<number>();
    const xteas: number[][] = [];
    for (const plane of palette) {
      for (const column of plane) {
        for (const chunk of column) {
          if (chunk === -1) continue;
          const sourceX = (chunk >>> 14) & 0x3ff;
          const sourceY = (chunk >>> 3) & 0x7ff;
          const regionId = ((sourceX >> 3) << 8) | (sourceY >> 3);
          if (!seenRegions.has(regionId)) {
            seenRegions.add(regionId);
            xteas.push(CachePipeline.getXtea(regionId));
          }
        }
      }
    }
    const sent = player.getSession().sendClientPacket(encodeRebuildRegion(center.x, center.y, true, palette, xteas));
    this.refreshHotspots(player, buildingMode);
    this.refreshFurniture(player);
    if (!buildingMode) this.refreshDoors();
    return sent;
  }

  /** Leaving clears the private area; PlayerSession emits REBUILD_NORMAL next tick. */
  public exitHouse(player: Player, destination: Location): void {
    this.leave(player, false);
    player.moveTo(destination);
  }

  public destroy(): void {
    if (this.isDestroyed()) return;
    if (this.owner && this.save.servant) leaveServantHouse(this.owner, this);
    releaseHouse(this.allocation);
    super.destroy();
  }

  public getSceneCenter(): Readonly<{ x: number; y: number }> {
    return { x: (this.allocation.baseX + 52) >> 3, y: (this.allocation.baseY + 52) >> 3 };
  }

  public getEntryLocation(): Location {
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let x = 0; x < this.gridSize; x++) {
      for (let y = 0; y < this.gridSize; y++) {
        const room = this.save.rooms[1][x][y];
        if (!room || !this.hasExitPortal(room)) continue;
        const savedExit = Object.values(room.furnitureByLocation ?? {}).find((furniture) => furniture.buildableKey === "EXIT_PORTAL");
        const local = rotateHotspot(savedExit?.localX ?? 3, savedExit?.localY ?? 2, room.rotation);
        return new Location(this.allocation.baseX + (gridOffset + x) * 8 + local.x, this.allocation.baseY + (gridOffset + y) * 8 + local.y, 1);
      }
    }
    return new Location(this.allocation.baseX + 52, this.allocation.baseY + 52, 1);
  }

  private refreshHotspots(player: Player, buildingMode: boolean): void {
    for (const door of this.roomDoors.splice(0)) {
      this.detach(door);
    }
    this.doorTargets.clear();

    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) {
      for (let x = 0; x < this.gridSize; x++) {
        for (let y = 0; y < this.gridSize; y++) {
          const room = this.save.rooms[plane][x][y];
          const template = room ? ROOM_BY_KEY.get(room.roomKey) : null;
          if (!room || !template) continue;
          for (const hotspot of PlayerHouseInstance.getTemplateObjects(houseStyleIndex(this.save))) {
            if (hotspot.sourceChunkX !== template.sourceChunkX || hotspot.sourceChunkY !== template.sourceChunkY) continue;
            const local = this.rotatedFootprint(hotspot.localX, hotspot.localY, hotspot.id, hotspot.face, room.rotation);
            const worldX = this.allocation.baseX + (gridOffset + x) * 8 + local.x;
            const worldY = this.allocation.baseY + (gridOffset + y) * 8 + local.y;
            if (hotspot.id === HOUSE_DYNAMIC_WINDOW) {
              // Dynamic windows are layout markers, not furniture/building-mode ghosts.
              const adjacent = this.getDoorTargetFromEdge(x, y, plane, local.x, local.y);
              const neighbour = adjacent && this.getRoom(adjacent);
              const indoors = neighbour && !ROOM_BY_KEY.get(neighbour.roomKey)?.outdoors;
              player.getSession().sendClientPacket(encodeLocAddChange(
                indoors ? HOUSE_STYLES[houseStyleIndex(this.save)].wall : HOUSE_STYLES[houseStyleIndex(this.save)].window,
                worldX, worldY, plane, hotspot.type, (hotspot.face + room.rotation) & 3,
              ));
              continue;
            }
            if (!buildingMode) {
              // Templates contain ghosts even when the building-mode varbit is off.
              // Remove them before replaying built furniture at the same tiles.
              player.getSession().sendClientPacket(encodeLocDel(worldX, worldY, plane, hotspot.type, (hotspot.face + room.rotation) & 3));
              continue;
            }
            if ((hotspot.id < ROOM_DOOR_HOTSPOT_MIN || hotspot.id > ROOM_DOOR_HOTSPOT_MAX)
              && !HOUSE_STYLES[houseStyleIndex(this.save)].doorHotspots.includes(hotspot.id)) continue;
            const target = this.getDoorTargetFromEdge(x, y, plane, local.x, local.y);
            if (!target) continue;
            const location = new Location(
              worldX,
              worldY,
              plane,
            );
            this.doorTargets.set(`${location.getX()}:${location.getY()}:${location.getZ()}`, target);
            this.roomDoors.push(new GameObject(hotspot.id, location, hotspot.type, (hotspot.face + room.rotation) & 3, this));
          }
        }
      }
    }
  }

  public refreshDoors(): void {
    for (const door of this.visibleDoors.splice(0)) {
      RegionManager.removeObjectClipping(door.object);
      this.detach(door.object);
      for (const player of this.getPlayers()) player.getPacketSender().sendObjectRemoval(door.object);
    }
    if (this.buildingMode || this.save.doorMode === 2) return;
    const offset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) for (let x = 0; x < this.gridSize; x++) for (let y = 0; y < this.gridSize; y++) {
      const room = this.getRoom({ x, y, plane });
      const template = room && ROOM_BY_KEY.get(room.roomKey);
      if (!room || !template || template.outdoors) continue;
      for (const hotspot of PlayerHouseInstance.getTemplateObjects(houseStyleIndex(this.save))) {
        if (!HOUSE_STYLES[houseStyleIndex(this.save)].doorHotspots.includes(hotspot.id) || hotspot.sourceChunkX !== template.sourceChunkX || hotspot.sourceChunkY !== template.sourceChunkY) continue;
        const local = rotateHotspot(hotspot.localX, hotspot.localY, room.rotation);
        const neighbor = this.getDoorTargetFromEdge(x, y, plane, local.x, local.y);
        const other = neighbor && this.getRoom(neighbor);
        // Two adjacent room templates describe the same doorway. Keep one pair.
        if (other && !ROOM_BY_KEY.get(other.roomKey)?.outdoors && (neighbor!.x < x || neighbor!.y < y)) continue;
        const origin = new Location(this.allocation.baseX + (offset + x) * 8 + local.x,
          this.allocation.baseY + (offset + y) * 8 + local.y, plane);
        const style = houseStyleIndex(this.save), side = HOUSE_STYLES[style].doorHotspots.indexOf(hotspot.id);
        const face = (hotspot.face + room.rotation) & 3;
        const door = { origin, face, style, side, open: this.save.doorMode === 1,
          object: null as unknown as GameObject };
        this.visibleDoors.push(door);
        this.drawDoor(door);
      }
    }
  }

  private drawDoor(door: PlayerHouseInstance["visibleDoors"][number]): void {
    const offsets = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    const [dx, dy] = door.open ? offsets[door.face] : [0, 0];
    // Turn away from the pair's centre so each leaf stays on its outer hinge.
    const face = door.open ? (door.face + (door.side ? 3 : 1)) & 3 : door.face;
    door.object = new GameObject(HOUSE_STYLES[door.style].doors[door.side + (door.open ? 2 : 0)],
      door.origin.transform(dx, dy), 0, face, this);
    RegionManager.addObjectClipping(door.object);
    for (const player of this.getPlayers()) player.getPacketSender().sendObject(door.object);
  }

  public toggleDoor(id: number, location: Location): boolean {
    const clicked = this.visibleDoors.find(door => door.object.getId() === id && door.object.getLocation().equals(location));
    if (!clicked) return false;
    const pair = this.visibleDoors.filter(door => door.face === clicked.face && door.style === clicked.style
      && door.origin.getZ() === clicked.origin.getZ()
      && Math.abs(door.origin.getX() - clicked.origin.getX()) + Math.abs(door.origin.getY() - clicked.origin.getY()) <= 1);
    const open = !clicked.open;
    for (const door of pair) {
      RegionManager.removeObjectClipping(door.object);
      this.detach(door.object);
      for (const player of this.getPlayers()) player.getPacketSender().sendObjectRemoval(door.object);
    }
    for (const door of pair) { door.open = open; this.drawDoor(door); }
    return true;
  }

  private refreshFurniture(player: Player): void {
    if (this.furnitureObjects.length) {
      for (const object of this.furnitureObjects) player.getPacketSender().sendObject(object);
      return;
    }
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) {
      for (let x = 0; x < this.gridSize; x++) {
        for (let y = 0; y < this.gridSize; y++) {
          const room = this.save.rooms[plane][x][y];
          if (!room) continue;
          for (const furniture of Object.values(room.furnitureByLocation ?? {})) {
            const buildable = BUILDABLE_BY_KEY.get(furniture.buildableKey);
            if (!buildable) continue;
            const hotspot = HOTSPOT_BY_OBJECT_ID.get(furniture.sourceObjectId);
            const variant = hotspot ? hotspot.objectIds.indexOf(furniture.sourceObjectId) : -1;
            const objectId = (this.litBurners.get(furniture) ?? 0) > Date.now() ? buildable.objectIds[0] + 1
              : furniture.displayObjectId ?? buildable.objectIds[variant] ?? buildable.objectIds.find((id) => id >= 0) ?? -1;
            if (objectId < 0) continue;
            const local = this.rotatedFootprint(furniture.localX, furniture.localY, furniture.sourceObjectId, furniture.face, room.rotation);
            const object = new GameObject(
              objectId,
              new Location(this.allocation.baseX + (gridOffset + x) * 8 + local.x, this.allocation.baseY + (gridOffset + y) * 8 + local.y, plane),
              furniture.type,
              (furniture.face + room.rotation) & 3,
              this,
            );
            this.furnitureObjects.push(object);
            player.getPacketSender().sendObject(object);
          }
        }
      }
    }
  }

  private clearFurniture(): void {
    for (const object of this.furnitureObjects.splice(0)) this.detach(object);
  }

  public redrawFurniture(): void {
    this.clearFurniture();
    for (const player of this.getPlayers()) this.refreshFurniture(player);
  }

  private isRoomPosition(position: HouseRoomPosition): boolean {
    return Number.isInteger(position.x) && Number.isInteger(position.y) && Number.isInteger(position.plane)
      && position.plane >= 0 && position.plane < 3
      && position.x >= 0 && position.x < this.gridSize
      && position.y >= 0 && position.y < this.gridSize;
  }

  public getRoomCount(): number {
    return this.save.rooms.flat(2).filter((room) => room != null).length;
  }

  public getMaxRooms(level: number): number {
    if (level >= 99) return 38;
    if (level >= 96) return 37;
    return level >= 26 ? 25 + Math.floor((level - 26) / 6) : 24;
  }

  private fitsHouseDimensions(target: HouseRoomPosition, level: number, moving?: HouseRoomPosition): boolean {
    let minX = target.x, maxX = target.x, minY = target.y, maxY = target.y;
    for (let plane = 0; plane < 3; plane++) for (let x = 0; x < this.gridSize; x++) for (let y = 0; y < this.gridSize; y++) {
      if (!this.getRoom({ x, y, plane }) || (moving?.x === x && moving.y === y && moving.plane === plane)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const size = Math.min(7, 3 + Math.floor(level / 15));
    return maxX - minX < size && maxY - minY < size;
  }

  private hasRoom(key: string): boolean {
    return this.save.rooms.flat(2).some((room) => room?.roomKey === key);
  }

  private hasExitPortal(room: SavedHouseRoom): boolean {
    return room.furniture.CENTERPIECE === "EXIT_PORTAL"
      || room.furniture.FORMAL_GARDEN_CENTERPIECE === "EXIT_PORTAL"
      || Object.values(room.furnitureByLocation ?? {}).some((furniture) => furniture.buildableKey === "EXIT_PORTAL");
  }

  private getExitPortalCount(): number {
    return this.save.rooms.flat(2).filter((room): room is SavedHouseRoom => room != null).filter((room) => this.hasExitPortal(room)).length;
  }

  private getDoorTargetFromEdge(x: number, y: number, plane: number, localX: number, localY: number): HouseRoomPosition | null {
    const target = localX === 0 ? { x: x - 1, y, plane }
      : localX === 7 ? { x: x + 1, y, plane }
        : localY === 0 ? { x, y: y - 1, plane }
          : localY === 7 ? { x, y: y + 1, plane }
            : null;
    return target && this.isRoomPosition(target) ? target : null;
  }

  private getDoorTargetAtLocation(location: Location): HouseRoomPosition | null {
    const relativeX = location.getX() - this.allocation.baseX;
    const relativeY = location.getY() - this.allocation.baseY;
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const x = Math.floor(relativeX / 8) - gridOffset;
    const y = Math.floor(relativeY / 8) - gridOffset;
    const plane = location.getZ();
    const room = this.getRoom({ x, y, plane });
    if (!room) return null;
    return this.getDoorTargetFromEdge(x, y, plane, relativeX & 7, relativeY & 7);
  }

  public getRoomPositionAt(location: { x: number; y: number; z: number }): HouseRoomPosition | null {
    const gridOffset = Math.floor((HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const position = {
      x: Math.floor((location.x - this.allocation.baseX) / 8) - gridOffset,
      y: Math.floor((location.y - this.allocation.baseY) / 8) - gridOffset,
      plane: location.z,
    };
    return this.isRoomPosition(position) ? position : null;
  }

  private rotatedFootprint(x: number, y: number, id: number, face: number, rotation: number): Readonly<{ x: number; y: number }> {
    const definition = CacheDefinitions.getObject(id);
    const width = (face & 1) ? definition.sizeY : definition.sizeX;
    const height = (face & 1) ? definition.sizeX : definition.sizeY;
    const origin = rotateHotspot(x, y, rotation);
    const opposite = rotateHotspot(x + width - 1, y + height - 1, rotation);
    return { x: Math.min(origin.x, opposite.x), y: Math.min(origin.y, opposite.y) };
  }

  private furnitureKey(localX: number, localY: number, type: number): string {
    return `${localX}:${localY}:${type}`;
  }

  private getTemplateHotspot(roomKey: string, id: number, localX: number, localY: number): TemplateObject | undefined {
    const room = ROOM_BY_KEY.get(roomKey);
    return room && PlayerHouseInstance.getTemplateObjects(houseStyleIndex(this.save)).find((object) =>
      (object.id === id || (HOTSPOT_BY_OBJECT_ID.has(id) && HOTSPOT_BY_OBJECT_ID.get(object.id)?.key === HOTSPOT_BY_OBJECT_ID.get(id)?.key))
      && object.localX === localX && object.localY === localY
      && object.sourceChunkX === room.sourceChunkX && object.sourceChunkY === room.sourceChunkY);
  }

  private static getTemplateObjects(style = 0): readonly TemplateObject[] {
    const cached = this.templateObjects.get(style);
    if (cached) return cached;
    const chunkOffset = Math.floor(style / 4) * 8;
    const objects: TemplateObject[] = [];
    const regions = new Set([...CONSTRUCTION_ROOMS, ...Object.values(HOUSE_TEMPLATE_CHUNKS)]
      .map(({ sourceChunkX, sourceChunkY }) => (((sourceChunkX + chunkOffset) >> 3) << 8) | (sourceChunkY >> 3)));
    for (const regionId of regions) {
      const data = CacheMaps.getRegion(regionId)?.objectData;
      if (!data) throw new Error(`Construction template region ${regionId} is missing from the active cache.`);
      const buffer = new ByteBuffer(data);
      let objectId = -1;
      while (buffer.offset < data.length) {
        const objectDelta = buffer.readSmart3();
        if (objectDelta === 0) break;
        objectId += objectDelta;
        let packedLocation = 0;
        while (true) {
          const locationDelta = buffer.readUnsignedSmart();
          if (locationDelta === 0) break;
          packedLocation += locationDelta - 1;
          const info = buffer.readUnsignedByte();
          if ((packedLocation >> 12) !== style % 4) continue;
          if ((objectId < ROOM_DOOR_HOTSPOT_MIN || objectId > ROOM_DOOR_HOTSPOT_MAX)
            && !HOUSE_STYLES[style].doorHotspots.includes(objectId)
            && objectId !== HOUSE_DYNAMIC_WINDOW
            && !HOTSPOT_BY_OBJECT_ID.has(objectId)
            && !CacheDefinitions.getObject(objectId).actions?.includes("Build")) continue;
          const localX = (packedLocation >> 6) & 0x3f;
          const localY = packedLocation & 0x3f;
          objects.push({
            id: objectId,
            sourceChunkX: (regionId >> 8) * 8 + (localX >> 3) - chunkOffset,
            sourceChunkY: (regionId & 0xff) * 8 + (localY >> 3),
            localX: localX & 7,
            localY: localY & 7,
            type: info >> 2,
            face: info & 3,
          });
        }
      }
    }
    this.templateObjects.set(style, objects);
    return objects;
  }
}
