"use strict";

const { RegionManager, Boundary, PrivateArea, Skill, Location, CachePipeline, CacheDefinitions, GameObject, World, encodeLocAddChange, encodeLocDel, encodeRebuildRegion,
  getTemplateRegion, templateChunkKey, rotateChunkLoc, rotateChunkTile, ObjectDefinition } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const Estate = require("./Estate.Construction");
const Servants = require("./Servants.Construction");
const House = require("./House.Construction");
const Dungeon = require("./Dungeon.Construction");
const Menagerie = require("./Menagerie.Construction");
const Decorations = require("./Decorations.Construction");
const GamesRoom = require("./GamesRoom.Construction");
const Trophies = require("./Trophies.Construction");
const CombatRings = require("./CombatRings.Construction");
const Data = require("./Data.Construction");
const Palette = require("./Palette.Construction");
const { messageBox } = require("./Menu.Construction");
const HOUSE_SIZE = 104;
const HOUSE_STRIDE = 112;
const HOUSE_ALLOCATION_COLUMNS = 16;
const HOUSE_ALLOCATION_COUNT = HOUSE_ALLOCATION_COLUMNS * HOUSE_ALLOCATION_COLUMNS;
const PREVIEW_WALL = Ids.loc("poh_preview_wall");
const BLOCKED_TILE = 0x200000;
const HOUSE_BUILDING_MODE_VARBIT = Ids.varbit("poh_building_mode");
const HOUSE_DYNAMIC_WINDOW = Ids.loc("poh_dynamic_window");
const allocatedHouses = new Array(HOUSE_ALLOCATION_COUNT).fill(false);
function allocateHouse() {
  const index = allocatedHouses.findIndex((used) => !used);
  if (index < 0) throw new Error("No Construction instance allocation is available.");
  allocatedHouses[index] = true;
  return {
    baseX: 6400 + (index % HOUSE_ALLOCATION_COLUMNS) * HOUSE_STRIDE,
    baseY: 6400 + Math.floor(index / HOUSE_ALLOCATION_COLUMNS) * HOUSE_STRIDE,
  };
}

function releaseHouse(allocation) {
  const x = Math.trunc((allocation.baseX - 6400) / HOUSE_STRIDE);
  const y = Math.trunc((allocation.baseY - 6400) / HOUSE_STRIDE);
  const index = y * HOUSE_ALLOCATION_COLUMNS + x;
  if (index >= 0 && index < allocatedHouses.length) allocatedHouses[index] = false;
}

const {createDefaultHouseSave} = require("./StorageState.Construction");

/** Minimal 4x4 grass test map with one Parlour, used by ::myhouse. */
function createTestHouseSave() {
  const rooms = Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => Array(8).fill(null)),
  );
  rooms[1][1][1] = { roomKey: "PARLOUR", rotation: 0, furniture: {} };
  return { rooms };
}

class PlayerHouseInstance extends PrivateArea {
  owner = null;
  buildingMode = false;
  litBurners = new Map();
  static templateObjects = new Map();
  roomDoors = [];
  visibleDoors = [];
  furnitureObjects = [];
  doorTargets = new Map();
  /** Furniture not drawn for now (a combat dummy while its NPC stands in for it); not saved. */
  hiddenFurniture = new Set();
  /** Objects drawn over the furniture for now (open dungeon doors, a throne room cage); sent to everyone who enters. */
  extraObjects = [];
  allocation;

  /** Test-house allocations are process-local and must never be restored as normal map tiles. */
  static isAllocationLocation(location) {
    const maximum = 6400 + HOUSE_ALLOCATION_COLUMNS * HOUSE_STRIDE;
    return location.getX() >= 6400 && location.getX() < maximum
      && location.getY() >= 6400 && location.getY() < maximum;
  }

  constructor(save, gridSize = 8) {
    const allocation = allocateHouse();
    super(Array.from({ length: 4 }, (_, plane) => new Boundary(
      allocation.baseX,
      allocation.baseX + HOUSE_SIZE - 1,
      allocation.baseY,
      allocation.baseY + HOUSE_SIZE - 1,
      plane,
    )));
    this.save = save; this.gridSize = gridSize;
    this.allocation = allocation;
    // Older saves used a fabricated shape 10 / face 0 for every hotspot.
    // Re-key them with the template placement so existing furniture is repaired too.
    for (const plane of save.rooms) {
      for (const column of plane) {
        for (let y = 0; y < column.length; y++) {
          const room = column[y];
          if (!room) continue;
          const furnitureByLocation = {};
          for (const saved of Object.values(room.furnitureByLocation ?? {})) {
            const template = this.getTemplateHotspot(room.roomKey, saved.sourceObjectId, saved.localX, saved.localY);
            const furniture = template ? { ...saved, sourceObjectId: template.id, type: template.type, face: template.face } : saved;
            furnitureByLocation[this.furnitureKey(furniture.localX, furniture.localY, furniture.type)] = furniture;
          }
          // A new house's save (and the oldest saves) list furniture by hotspot only, without its
          // placements: the starting garden's exit portal was never drawn. Place each of them.
          for (const [hotspotKey, buildableKey] of Object.entries(room.furniture ?? {})) {
            if (!buildableKey || Object.values(furnitureByLocation).some(furniture => furniture.hotspotKey === hotspotKey)) continue;
            const [placement] = this.hotspotPlacements(room.roomKey, hotspotKey);
            if (!placement) continue;
            furnitureByLocation[this.furnitureKey(placement.localX, placement.localY, placement.type)] = {
              buildableKey, hotspotKey, sourceObjectId: placement.id,
              localX: placement.localX, localY: placement.localY, type: placement.type, face: placement.face,
            };
          }
          // Older saves furnished only the clicked placement of a hotspot (one tile of a rug).
          for (const furniture of Object.values(furnitureByLocation)) {
            for (const placement of this.hotspotPlacements(room.roomKey, furniture.hotspotKey)) {
              const key = this.furnitureKey(placement.localX, placement.localY, placement.type);
              furnitureByLocation[key] ??= {
                buildableKey: furniture.buildableKey, hotspotKey: furniture.hotspotKey, sourceObjectId: placement.id,
                localX: placement.localX, localY: placement.localY, type: placement.type, face: placement.face,
              };
            }
          }
          column[y] = { ...room, furnitureByLocation };
        }
      }
    }
  }

  /**
   * The house's template chunks. Empty slots take the floor's filler: the basement and ground
   * floor templates, and above them the blank chunk, whose tiles all block. rsprox captures (1,463
   * of 1,470 house rebuilds, rev 224-239) send the blank chunk upstairs whether or not building
   * mode is on, one slot past the grid too, so an upstairs doorway into nothing can't be walked
   * through (the client has no floor there, so the player would seem to fall).
   */
  buildPalette() {
    const palette = Palette.emptyHousePalette();
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const style = Estate.houseStyleIndex(this.save);
    for (let plane = 0; plane < Palette.HOUSE_PLANES; plane++) {
      for (let x = -1; x <= 8; x++) {
        for (let y = -1; y <= 8; y++) {
          const sceneX = x + gridOffset, sceneY = y + gridOffset;
          if (sceneX < 0 || sceneY < 0 || sceneX >= Palette.HOUSE_SCENE_CHUNKS || sceneY >= Palette.HOUSE_SCENE_CHUNKS) continue;
          const withinGrid = x >= 0 && y >= 0 && x < this.gridSize && y < this.gridSize;
          const ring = x >= -1 && y >= -1 && x <= this.gridSize && y <= this.gridSize;
          const room = withinGrid && plane < this.save.rooms.length ? this.save.rooms[plane]?.[x]?.[y] : null;
          const template = room
            ? Data.ROOM_BY_KEY.get(room.roomKey)
            : plane >= 2
              ? (ring ? Data.HOUSE_TEMPLATE_CHUNKS.blank : null)
              : !withinGrid
                ? null
                : plane === 0
                  ? Data.HOUSE_TEMPLATE_CHUNKS.basementFloor
                  : Data.HOUSE_TEMPLATE_CHUNKS.groundFloor;
          if (room && !template) {
            throw new Error(`Unknown Construction room template: ${room.roomKey}`);
          }
          if (!template) continue;
          palette[plane][sceneX][sceneY] = Palette.packTemplateChunk({
            sourceChunkX: template.sourceChunkX + Math.floor(style / 4) * 8,
            sourceChunkY: template.sourceChunkY,
            sourcePlane: style % 4,
            rotation: room?.rotation ?? 0,
          });
        }
      }
    }
    return palette;
  }

  getRoom(position) {
    return this.isRoomPosition(position) ? this.save.rooms[position.plane][position.x][position.y] : null;
  }

  getDoorTarget(location) {
    return this.doorTargets.get(`${location.x}:${location.y}:${location.z}`) ?? null;
  }

  getFurnitureTarget(
    location,
    sourceObjectId,
  ) {
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    const template = room ? Data.ROOM_BY_KEY.get(room.roomKey) : null;
    const hotspot = room ? Data.hotspotIn(room.roomKey, sourceObjectId) : null;
    if (!hotspot || !position || !room || !template) return null;

    const placement = PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save)).find(object => {
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

  getFurnitureAt(location, objectId, type) {
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    if (!position || !room) return null;
    const furniture = Object.values(room.furnitureByLocation ?? {}).find(value => {
      const local = this.rotatedFootprint(value.localX, value.localY, value.sourceObjectId, value.face, room.rotation);
      return value.type === type && local.x === ((location.x - this.allocation.baseX) & 7) && local.y === ((location.y - this.allocation.baseY) & 7);
    });
    if (!furniture) return null;
    const buildable = Data.BUILDABLE_BY_KEY.get(furniture.buildableKey);
    return buildable && (buildable.objectIds.includes(objectId) || furniture.displayObjectId === objectId
      || (this.litBurners.has(furniture) && buildable.objectIds[0] + 1 === objectId)) ? furniture : null;
  }

  getFurnitureAtTarget(target) {
    const room = this.getRoom(target.position);
    return room?.furnitureByLocation?.[this.furnitureKey(target.localX, target.localY, target.type)] ?? null;
  }

  /** Every template placement of `hotspotKey` in a room of type `roomKey` (a rug's tiles, all curtains). */
  hotspotPlacements(roomKey, hotspotKey) {
    const template = Data.ROOM_BY_KEY.get(roomKey);
    if (!template) return [];
    return PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save)).filter(object =>
      object.sourceChunkX === template.sourceChunkX && object.sourceChunkY === template.sourceChunkY
      && Data.hotspotIn(roomKey, object.id)?.key === hotspotKey);
  }

  /** Building on a hotspot furnishes all of its placements in the room. */
  setFurniture(target, buildable) {
    const room = this.getRoom(target.position);
    if (!room) return;
    // An upgrade row (a display's next wood) saves as the furniture it makes.
    const savedKey = buildable.savesAs ?? buildable.key;
    const furnitureByLocation = { ...room.furnitureByLocation };
    const placements = this.hotspotPlacements(room.roomKey, target.hotspotKey);
    for (const placement of placements.length ? placements : [{ ...target, id: target.sourceObjectId }]) {
      const key = this.furnitureKey(placement.localX, placement.localY, placement.type);
      furnitureByLocation[key] = {
        ...furnitureByLocation[key],
        buildableKey: savedKey,
        hotspotKey: target.hotspotKey,
        sourceObjectId: placement.id,
        localX: placement.localX,
        localY: placement.localY,
        type: placement.type,
        face: placement.face,
      };
    }
    this.save.rooms[target.position.plane][target.position.x][target.position.y] = {
      ...room,
      furniture: { ...room.furniture, [target.hotspotKey]: savedKey },
      furnitureByLocation,
    };
  }

  canRemoveFurniture(location, objectId, type) {
    const furniture = this.getFurnitureAt(location, objectId, type);
    if (!furniture) return "There is no constructed furniture there.";
    if (Object.values(furniture.storage ?? {}).some(amount => amount > 0)) return "Empty this storage before removing it.";
    if (furniture.buildableKey === "EXIT_PORTAL" && this.getExitPortalCount() === 1) {
      return messageBox("Your house must have at least one exit portal.");
    }
    return null;
  }

  removeFurniture(location, objectId, type) {
    const position = this.getRoomPositionAt(location);
    const room = position ? this.getRoom(position) : null;
    const furniture = this.getFurnitureAt(location, objectId, type);
    if (!position || !room || !furniture) return null;
    // Removing takes the furniture off every placement of its hotspot, as building put it there.
    const remaining = Object.fromEntries(Object.entries(room.furnitureByLocation ?? {})
      .filter(([, entry]) => entry.hotspotKey !== furniture.hotspotKey));
    const legacyFurniture = { ...room.furniture };
    delete legacyFurniture[furniture.hotspotKey];
    this.save.rooms[position.plane][position.x][position.y] = {
      ...room,
      furniture: legacyFurniture,
      furnitureByLocation: remaining,
    };
    return furniture;
  }

  resolveObject(id, location) {
    if (Data.ROOM_DOOR_HOTSPOT_IDS.has(id)
      || Estate.HOUSE_STYLES[Estate.houseStyleIndex(this.save)].doorHotspots.includes(id)) {
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
    const rotation = this.getRoom(target.position).rotation;
    const hotspot = new GameObject(id, location.clone(), target.type, (target.face + rotation) & 3, this);
    this.detach(hotspot);
    return hotspot;
  }

  // rsprox captures (poh_add_room:list, door hotspots, rev 229-235): these refusals are message boxes.
  canPlaceRoom(room, position, constructionLevel) {
    if (!this.isRoomPosition(position)) return "That room location is outside your house.";
    if (this.getRoom(position)) return "There is already a room there.";
    if (!this.fitsHouseDimensions(position, constructionLevel)) return messageBox("Your house is already the maximum length.");
    if (constructionLevel < room.level) return `You need Construction level ${room.level} to build a ${room.name}.`;
    const maxRooms = this.getMaxRooms(constructionLevel);
    if (this.getRoomCount() >= maxRooms) return messageBox(`You can only build ${maxRooms} rooms with your Construction level.`);
    if (room.basement && position.plane !== 0) return messageBox("That room can only be built underground.");
    if (room.outdoors && position.plane !== 1) return messageBox("That room can only be built on ground level.");
    if (position.plane > 1) {
      const below = this.getRoom({ ...position, plane: position.plane - 1 });
      if (!below || Data.ROOM_BY_KEY.get(below.roomKey)?.outdoors) return messageBox("You can't build a room that would have no room to support it.");
    }
    if (this.getOnlyCopy(room)) return messageBox("You can only build one of those rooms.");
    return null;
  }

  /** Where the house already has a room that it may only have one of (the menageries count as one). */
  getOnlyCopy(room) {
    const keys = room.key === "MENAGERIE_INDOORS" || room.key === "MENAGERIE_OUTDOORS" ? ["MENAGERIE_INDOORS", "MENAGERIE_OUTDOORS"]
      : room.key === "COSTUME_ROOM" || room.key === "PORTAL_NEXUS" ? [room.key] : [];
    return keys.length ? this.findRoom(position => keys.includes(this.getRoom(position).roomKey)) : null;
  }

  placeRoom(position, room, rotation = 0) {
    this.save.rooms[position.plane][position.x][position.y] = { roomKey: room.key, rotation: rotation & 3, furniture: {} };
  }

  rotateRoom(position, rotation) {
    const room = this.getRoom(position);
    if (!room) return null;
    const rotated = { ...room, rotation: (rotation ?? room.rotation + 1) & 3 };
    this.save.rooms[position.plane][position.x][position.y] = rotated;
    return rotated;
  }

  getRoomDoorMask(position) {
    const room = this.getRoom(position);
    return room ? this.templateDoorMask(room.roomKey) : 0;
  }

  /** A room type's doorways (bit per edge: north, east, south, west) before it is rotated. */
  templateDoorMask(roomKey) {
    const template = Data.ROOM_BY_KEY.get(roomKey);
    if (!template) return 0;
    if (template.outdoors) return 15;
    let mask = 0;
    for (const object of PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save))) {
      if ((!Data.ROOM_DOOR_HOTSPOT_IDS.has(object.id)
        && !Estate.HOUSE_STYLES[Estate.houseStyleIndex(this.save)].doorHotspots.includes(object.id))
        || object.sourceChunkX !== template.sourceChunkX || object.sourceChunkY !== template.sourceChunkY) continue;
      const edge = object.localX === 0 ? 3 : object.localY === 7 ? 0 : object.localX === 7 ? 1 : 2;
      mask |= 1 << edge;
    }
    return mask;
  }

  getAdjacentDoorMask(position) {
    const offsets = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    return offsets.reduce((mask, [dx, dy], edge) => {
      const adjacent = { x: position.x + dx, y: position.y + dy, plane: position.plane };
      const room = this.getRoom(adjacent);
      const doors = this.getRoomDoorMask(adjacent);
      const rotated = room ? ((doors << room.rotation) | (doors >> (4 - room.rotation))) & 15 : 0;
      return mask | ((rotated & (1 << ((edge + 2) & 3))) ? 1 << edge : 0);
    }, 0);
  }

  // rsprox captures (poh_viewer:done and :map, rev 229): message boxes, in live wording.
  canMoveRoom(from, to) {
    const room = this.getRoom(from);
    if (!room) return "There is no room there.";
    if (!this.isRoomPosition(to)) return "That room location is outside your house.";
    if (this.getRoom(to)) return "There is already a room there.";
    if (!this.fitsHouseDimensions(to, this.owner?.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) ?? 99, from)) return messageBox("Your house is already the maximum length.");
    if (from.plane === 1 && this.getRoom({ ...from, plane: 2 })) return messageBox("That room is supporting something else, so it can't be moved.");
    const definition = Data.ROOM_BY_KEY.get(room.roomKey);
    if (definition.basement && to.plane !== 0) return messageBox("That room can only go underground.");
    if (definition.outdoors && to.plane !== 1) return messageBox("That room can only go on ground level.");
    if (to.plane === 2) {
      if (from.plane === 1 && from.x === to.x && from.y === to.y) return messageBox("You can't move it above itself. It would fall down.");
      const below = this.getRoom({ ...to, plane: 1 });
      if (!below) return messageBox("You can't build a room that would have no room to support it.");
      if (Data.ROOM_BY_KEY.get(below.roomKey)?.outdoors) return messageBox("You can't put it above that room.");
    }
    return null;
  }

  moveRoom(from, to, rotation) {
    if (this.canMoveRoom(from, to)) return false;
    const room = this.getRoom(from);
    this.save.rooms[to.plane][to.x][to.y] = { ...room, rotation: rotation & 3 };
    this.removeRoom(from);
    return true;
  }

  canRemoveRoom(position) {
    const room = this.getRoom(position);
    if (!room) return "There is no room there.";
    if (Object.values(room.furnitureByLocation ?? {}).some(furniture => Object.values(furniture.storage ?? {}).some(amount => amount > 0))) return "Empty the storage in this room before removing it.";
    if (position.plane === 1 && this.getRoom({ ...position, plane: 2 })) return messageBox("You can't remove a room that is supporting another room.");
    if ((room.roomKey === "GARDEN" || room.roomKey === "FORMAL_GARDEN") && this.hasExitPortal(room) && this.getExitPortalCount() === 1) {
      return messageBox("Your house must have at least one exit portal.");
    }
    return null;
  }

  removeRoom(position) {
    if (this.isRoomPosition(position)) this.save.rooms[position.plane][position.x][position.y] = null;
  }

  /** Moves a player into this allocation and immediately streams its dynamic scene. */
  enterHouse(player, buildingMode) {
    this.buildingMode = buildingMode;
    PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save));
    const previousArea = player.getArea();
    if (previousArea && previousArea !== this) previousArea.leave(player, false);
    this.enter(player);
    // Entering a house ends Vengeance's effect (Wiki: Vengeance).
    player.setHasVengeance(false);
    player.moveTo(this.getEntryLocation());
    const sent = this.rebuild(player, buildingMode);
    if (sent) Servants.enterServantHouse(player, this);
    return sent;
  }

  process(mobile) {
    if (mobile.isPlayer()) House.processOccupant(mobile.getAsPlayer(), this);
  }

  postLeave(mobile, logout) {
    if (mobile.isNpc()) { this.remove(mobile); return; }
    if (mobile.isPlayer()) Servants.leaveServantHouse(mobile.getAsPlayer(), this);
    super.postLeave(mobile, logout);
    if (mobile.isPlayer()) House.leftHouse(mobile.getAsPlayer(), this);
  }

  /** Replays the current saved layout after a room edit. */
  rebuild(player, buildingMode) {
    this.buildingMode = buildingMode;
    Trophies.refreshDisplays(this);
    // Remove old solid doors before the new scene installs its construction hotspots.
    if (buildingMode) this.refreshDoors();
    this.clearFurniture();
    player.getPacketSender().sendVarbit(HOUSE_BUILDING_MODE_VARBIT, buildingMode ? 1 : 0);
    const center = this.getSceneCenter();
    const palette = this.buildPalette();
    this.applyTemplateCollision(palette);
    const seenRegions = new Set();
    const xteas = [];
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
    Dungeon.refreshMonsters(this);
    Menagerie.refreshPets(this);
    Decorations.refresh(this);
    GamesRoom.resetGames(this);
    return sent;
  }

  /** Leaving clears the private area; PlayerSession emits REBUILD_NORMAL next tick. */
  exitHouse(player, destination) {
    this.leave(player, false);
    player.moveTo(destination);
  }

  /** Players may fight each other only inside one of the combat room's rings. */
  canAttack(attacker, target) {
    return CombatRings.canFight(attacker, target, this);
  }

  /** Spells on a games room orb work the game instead of hitting it. */
  canCastOnNpc(player, npc, spell) {
    return GamesRoom.castOnGame(player, npc, spell);
  }

  destroy() {
    if (this.isDestroyed()) return;
    if (this.owner && this.save.servant) Servants.leaveServantHouse(this.owner, this);
    releaseHouse(this.allocation);
    super.destroy();
  }

  getSceneCenter() {
    return { x: (this.allocation.baseX + 52) >> 3, y: (this.allocation.baseY + 52) >> 3 };
  }

  getEntryLocation() {
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let x = 0; x < this.gridSize; x++) {
      for (let y = 0; y < this.gridSize; y++) {
        const room = this.save.rooms[1][x][y];
        if (!room || !this.hasExitPortal(room)) continue;
        const savedExit = Object.values(room.furnitureByLocation ?? {}).find((furniture) => furniture.buildableKey === "EXIT_PORTAL");
        // In front of the portal (it is 2x2, from its saved corner), not on it.
        const local = Palette.rotateHotspot(savedExit?.localX ?? 3, savedExit ? savedExit.localY - 1 : 2, room.rotation);
        return new Location(this.allocation.baseX + (gridOffset + x) * 8 + local.x, this.allocation.baseY + (gridOffset + y) * 8 + local.y, 1);
      }
    }
    return new Location(this.allocation.baseX + 52, this.allocation.baseY + 52, 1);
  }

  /** Where each template hotspot of the room at `position` lands in this house. */
  hotspotTiles(position) {
    const room = this.getRoom(position);
    const template = room ? Data.ROOM_BY_KEY.get(room.roomKey) : null;
    if (!room || !template) return [];
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    return PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save))
      .filter(hotspot => hotspot.sourceChunkX === template.sourceChunkX && hotspot.sourceChunkY === template.sourceChunkY)
      .map(hotspot => {
        const local = this.rotatedFootprint(hotspot.localX, hotspot.localY, hotspot.id, hotspot.face, room.rotation);
        const definition = CacheDefinitions.getObject(hotspot.id);
        const sizes = [definition.sizeX ?? 1, definition.sizeY ?? 1];
        // The footprint turns with the hotspot's face and again with the room.
        const turned = ((hotspot.face + room.rotation) & 1) === 1;
        return {
          id: hotspot.id,
          x: this.allocation.baseX + (gridOffset + position.x) * 8 + local.x,
          y: this.allocation.baseY + (gridOffset + position.y) * 8 + local.y,
          plane: position.plane,
          width: turned ? sizes[1] : sizes[0],
          length: turned ? sizes[0] : sizes[1],
        };
      });
  }

  /**
   * rsprox captures: before a room picked at a door is built, its doorways show as poh_preview_wall
   * (shape 0, facing their edge: west 0, north 1, east 2, south 3) and its furniture spaces as their
   * hotspot locs, turned with the room. Floor spaces (rugs) aren't shown.
   */
  previewObjects(roomKey, position, rotation) {
    const template = Data.ROOM_BY_KEY.get(roomKey);
    if (!template) return [];
    const style = Estate.houseStyleIndex(this.save);
    const doorIds = Estate.HOUSE_STYLES[style].doorHotspots;
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const baseX = this.allocation.baseX + (gridOffset + position.x) * 8;
    const baseY = this.allocation.baseY + (gridOffset + position.y) * 8;
    return PlayerHouseInstance.getTemplateObjects(style)
      .filter(hotspot => hotspot.sourceChunkX === template.sourceChunkX && hotspot.sourceChunkY === template.sourceChunkY && hotspot.type !== 22)
      .map(hotspot => {
        const local = this.rotatedFootprint(hotspot.localX, hotspot.localY, hotspot.id, hotspot.face, rotation);
        const location = new Location(baseX + local.x, baseY + local.y, position.plane);
        const door = Data.ROOM_DOOR_HOTSPOT_IDS.has(hotspot.id) || doorIds.includes(hotspot.id);
        if (!door && !Data.hotspotIn(roomKey, hotspot.id)) return null; // windows and the like
        if (!door) return new GameObject(hotspot.id, location, hotspot.type, (hotspot.face + rotation) & 3, this);
        const edge = local.x === 0 ? 0 : local.y === 7 ? 1 : local.x === 7 ? 2 : 3;
        return new GameObject(PREVIEW_WALL, location, 0, edge, this);
      })
      .filter(Boolean);
  }

  refreshHotspots(player, buildingMode) {
    for (const door of this.roomDoors.splice(0)) {
      this.detach(door);
    }
    this.doorTargets.clear();

    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) {
      for (let x = 0; x < this.gridSize; x++) {
        for (let y = 0; y < this.gridSize; y++) {
          const room = this.save.rooms[plane][x][y];
          const template = room ? Data.ROOM_BY_KEY.get(room.roomKey) : null;
          if (!room || !template) continue;
          for (const hotspot of PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save))) {
            if (hotspot.sourceChunkX !== template.sourceChunkX || hotspot.sourceChunkY !== template.sourceChunkY) continue;
            const local = this.rotatedFootprint(hotspot.localX, hotspot.localY, hotspot.id, hotspot.face, room.rotation);
            const worldX = this.allocation.baseX + (gridOffset + x) * 8 + local.x;
            const worldY = this.allocation.baseY + (gridOffset + y) * 8 + local.y;
            if (hotspot.id === HOUSE_DYNAMIC_WINDOW) {
              // Dynamic windows are layout markers, not furniture/building-mode ghosts.
              const adjacent = this.getDoorTargetFromEdge(x, y, plane, local.x, local.y);
              const neighbour = adjacent && this.getRoom(adjacent);
              const indoors = neighbour && !Data.ROOM_BY_KEY.get(neighbour.roomKey)?.outdoors;
              player.getSession().sendClientPacket(encodeLocAddChange(
                indoors ? Estate.HOUSE_STYLES[Estate.houseStyleIndex(this.save)].wall : Estate.HOUSE_STYLES[Estate.houseStyleIndex(this.save)].window,
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
            if (!Data.ROOM_DOOR_HOTSPOT_IDS.has(hotspot.id)
              && !Estate.HOUSE_STYLES[Estate.houseStyleIndex(this.save)].doorHotspots.includes(hotspot.id)) continue;
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

  /**
   * The walls, windows and scenery the client draws from each room's template chunk collide as
   * they do in the cache's map (a templated instance does the same); without this every wall could
   * be walked through. Hotspots are left out: furniture and doors are placed with their own
   * collision. Blocked tiles in the chunk settings block too.
   */
  applyTemplateCollision(palette) {
    for (const object of this.templateClipObjects ?? []) RegionManager.removeObjectClipping(object);
    for (const tile of this.templateBlockedTiles ?? []) this.setClip(tile, this.getClip(tile) & ~BLOCKED_TILE);
    this.templateClipObjects = [];
    this.templateBlockedTiles = [];
    const style = Estate.houseStyleIndex(this.save);
    for (let plane = 0; plane < palette.length; plane++) {
      for (let x = 0; x < palette[plane].length; x++) {
        for (let y = 0; y < palette[plane][x].length; y++) {
          const chunk = palette[plane][x][y];
          if (chunk === -1) continue;
          const sourceX = (chunk >>> 14) & 0x3ff, sourceY = (chunk >>> 3) & 0x7ff;
          const sourcePlane = (chunk >>> 24) & 3, rotation = (chunk >>> 1) & 3;
          const region = getTemplateRegion(((sourceX >> 3) << 8) | (sourceY >> 3));
          if (!region) continue;
          const baseX = this.allocation.baseX + x * 8, baseY = this.allocation.baseY + y * 8;
          for (const loc of region.chunks[templateChunkKey(sourcePlane, sourceX, sourceY)] ?? []) {
            if (this.isTemplateHotspot(loc.id, style)) continue;
            const definition = ObjectDefinition.forId(loc.id);
            const [toX, toY] = rotateChunkLoc(loc.localX & 7, loc.localY & 7, rotation, definition?.getSizeX() ?? 1, definition?.getSizeY() ?? 1, loc.face);
            const object = new GameObject(loc.id, new Location(baseX + toX, baseY + toY, plane), loc.type, (loc.face + rotation) & 3, this);
            this.detach(object);
            RegionManager.addObjectClipping(object);
            this.templateClipObjects.push(object);
          }
          const tileX = (sourceX & 7) * 8, tileY = (sourceY & 7) * 8;
          for (let dx = 0; dx < 8; dx++) for (let dy = 0; dy < 8; dy++) {
            if ((region.settings[(sourcePlane << 12) | ((tileX + dx) << 6) | (tileY + dy)] & 1) === 0) continue;
            const [toX, toY] = rotateChunkTile(dx, dy, rotation);
            const tile = new Location(baseX + toX, baseY + toY, plane);
            this.setClip(tile, this.getClip(tile) | BLOCKED_TILE);
            this.templateBlockedTiles.push(tile);
          }
        }
      }
    }
  }

  /** Door and furniture spaces: drawn as doors and furniture instead. Windows stay, being wall. */
  isTemplateHotspot(id, style) {
    return Data.ROOM_DOOR_HOTSPOT_IDS.has(id) || Estate.HOUSE_STYLES[style].doorHotspots.includes(id)
      || Data.HOTSPOT_BY_OBJECT_ID.has(id) || !!CacheDefinitions.getObject(id)?.actions?.includes("Build");
  }

  refreshDoors() {
    for (const door of this.visibleDoors.splice(0)) {
      RegionManager.removeObjectClipping(door.object);
      this.detach(door.object);
      for (const player of this.getPlayers()) player.getPacketSender().sendObjectRemoval(door.object);
    }
    if (this.buildingMode || this.save.doorMode === 2) return;
    const offset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) for (let x = 0; x < this.gridSize; x++) for (let y = 0; y < this.gridSize; y++) {
      const room = this.getRoom({ x, y, plane });
      const template = room && Data.ROOM_BY_KEY.get(room.roomKey);
      if (!room || !template || template.outdoors) continue;
      for (const hotspot of PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save))) {
        if (!Estate.HOUSE_STYLES[Estate.houseStyleIndex(this.save)].doorHotspots.includes(hotspot.id) || hotspot.sourceChunkX !== template.sourceChunkX || hotspot.sourceChunkY !== template.sourceChunkY) continue;
        const local = Palette.rotateHotspot(hotspot.localX, hotspot.localY, room.rotation);
        const neighbor = this.getDoorTargetFromEdge(x, y, plane, local.x, local.y);
        const other = neighbor && this.getRoom(neighbor);
        // Two adjacent room templates describe the same doorway. Keep one pair.
        if (other && !Data.ROOM_BY_KEY.get(other.roomKey)?.outdoors && (neighbor.x < x || neighbor.y < y)) continue;
        const origin = new Location(this.allocation.baseX + (offset + x) * 8 + local.x,
          this.allocation.baseY + (offset + y) * 8 + local.y, plane);
        const style = Estate.houseStyleIndex(this.save), side = Estate.HOUSE_STYLES[style].doorHotspots.indexOf(hotspot.id);
        const face = (hotspot.face + room.rotation) & 3;
        const door = { origin, face, style, side, open: this.save.doorMode === 1,
          object: null };
        this.visibleDoors.push(door);
        this.drawDoor(door);
      }
    }
  }

  drawDoor(door) {
    const offsets = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    const [dx, dy] = door.open ? offsets[door.face] : [0, 0];
    // Turn away from the pair's centre so each leaf stays on its outer hinge.
    const face = door.open ? (door.face + (door.side ? 3 : 1)) & 3 : door.face;
    door.object = new GameObject(Estate.HOUSE_STYLES[door.style].doors[door.side + (door.open ? 2 : 0)],
      door.origin.transform(dx, dy), 0, face, this);
    RegionManager.addObjectClipping(door.object);
    for (const player of this.getPlayers()) player.getPacketSender().sendObject(door.object);
  }

  toggleDoor(id, location) {
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

  refreshFurniture(player) {
    for (const object of this.extraObjects) player.getPacketSender().sendObject(object);
    if (this.furnitureObjects.length) {
      for (const object of this.furnitureObjects) player.getPacketSender().sendObject(object);
      return;
    }
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    for (let plane = 0; plane < 3; plane++) {
      for (let x = 0; x < this.gridSize; x++) {
        for (let y = 0; y < this.gridSize; y++) {
          const room = this.save.rooms[plane][x][y];
          if (!room) continue;
          for (const furniture of Object.values(room.furnitureByLocation ?? {})) {
            const buildable = Data.BUILDABLE_BY_KEY.get(furniture.buildableKey);
            if (!buildable || this.hiddenFurniture.has(furniture)) continue;
            const hotspot = Data.HOTSPOT_BY_KEY.get(furniture.hotspotKey) ?? Data.hotspotIn(room.roomKey, furniture.sourceObjectId);
            const variant = hotspot ? hotspot.objectIds.indexOf(furniture.sourceObjectId) : -1;
            const objectId = (this.litBurners.get(furniture) ?? 0) > World.getProcessCycle() ? buildable.objectIds[0] + 1
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
            // Furniture blocks the way as its loc does (a dungeon door, a table; not a rug).
            RegionManager.addObjectClipping(object);
            player.getPacketSender().sendObject(object);
          }
        }
      }
    }
  }

  clearFurniture() {
    for (const object of this.furnitureObjects.splice(0)) {
      RegionManager.removeObjectClipping(object);
      this.detach(object);
    }
  }

  /** Every piece of furniture with its room position and the world tile its placement is drawn on. */
  furnitureEntries() {
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const entries = [];
    for (let plane = 0; plane < 3; plane++) for (let x = 0; x < this.gridSize; x++) for (let y = 0; y < this.gridSize; y++) {
      const room = this.save.rooms[plane][x][y];
      for (const furniture of Object.values(room?.furnitureByLocation ?? {})) {
        const local = this.rotatedFootprint(furniture.localX, furniture.localY, furniture.sourceObjectId, furniture.face, room.rotation);
        entries.push({ furniture, room, position: { x, y, plane },
          location: new Location(this.allocation.baseX + (gridOffset + x) * 8 + local.x, this.allocation.baseY + (gridOffset + y) * 8 + local.y, plane),
          face: (furniture.face + room.rotation) & 3 });
      }
    }
    return entries;
  }

  addExtraObject(object) {
    this.extraObjects.push(object);
    for (const player of this.getPlayers()) player.getPacketSender().sendObject(object);
  }

  removeExtraObject(object) {
    const index = this.extraObjects.indexOf(object);
    if (index < 0) return;
    this.extraObjects.splice(index, 1);
    RegionManager.removeObjectClipping(object);
    this.detach(object);
    for (const player of this.getPlayers()) player.getPacketSender().sendObjectRemoval(object);
  }

  /** Takes a piece of furniture off the map for now (not saved): a dummy or guard stands in. */
  hideFurniture(furniture) {
    this.hiddenFurniture.add(furniture);
    for (const object of this.furnitureObjects.filter(drawn => this.getFurnitureAt(
      { x: drawn.getLocation().getX(), y: drawn.getLocation().getY(), z: drawn.getLocation().getZ() }, drawn.getId(), drawn.getType()) === furniture)) {
      this.furnitureObjects.splice(this.furnitureObjects.indexOf(object), 1);
      RegionManager.removeObjectClipping(object);
      this.detach(object);
      for (const player of this.getPlayers()) player.getPacketSender().sendObjectRemoval(object);
    }
  }

  showFurniture(furniture) {
    if (this.hiddenFurniture.delete(furniture)) this.redrawFurniture();
  }

  redrawFurniture() {
    this.clearFurniture();
    for (const player of this.getPlayers()) this.refreshFurniture(player);
  }

  isRoomPosition(position) {
    return Number.isInteger(position.x) && Number.isInteger(position.y) && Number.isInteger(position.plane)
      && position.plane >= 0 && position.plane < 3
      && position.x >= 0 && position.x < this.gridSize
      && position.y >= 0 && position.y < this.gridSize;
  }

  getRoomCount() {
    return this.save.rooms.flat(2).filter((room) => room != null).length;
  }

  getMaxRooms(level) {
    if (level >= 99) return 38;
    if (level >= 96) return 37;
    return level >= 26 ? 25 + Math.floor((level - 26) / 6) : 24;
  }

  fitsHouseDimensions(target, level, moving) {
    let minX = target.x, maxX = target.x, minY = target.y, maxY = target.y;
    for (let plane = 0; plane < 3; plane++) for (let x = 0; x < this.gridSize; x++) for (let y = 0; y < this.gridSize; y++) {
      if (!this.getRoom({ x, y, plane }) || (moving?.x === x && moving.y === y && moving.plane === plane)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const size = Math.min(7, 3 + Math.floor(level / 15));
    return maxX - minX < size && maxY - minY < size;
  }

  hasRoom(key) {
    return this.save.rooms.flat(2).some((room) => room?.roomKey === key);
  }

  /** The position of the first built room that `matches(position)`, or null. */
  findRoom(matches) {
    for (let plane = 0; plane < this.save.rooms.length; plane++) for (let x = 0; x < this.gridSize; x++) for (let y = 0; y < this.gridSize; y++) {
      const position = { x, y, plane };
      if (this.getRoom(position) && matches(position)) return position;
    }
    return null;
  }

  hasExitPortal(room) {
    return room.furniture.CENTERPIECE === "EXIT_PORTAL"
      || room.furniture.FORMAL_GARDEN_CENTERPIECE === "EXIT_PORTAL"
      || Object.values(room.furnitureByLocation ?? {}).some((furniture) => furniture.buildableKey === "EXIT_PORTAL");
  }

  getExitPortalCount() {
    return this.save.rooms.flat(2).filter((room) => room != null).filter((room) => this.hasExitPortal(room)).length;
  }

  getDoorTargetFromEdge(x, y, plane, localX, localY) {
    const target = localX === 0 ? { x: x - 1, y, plane }
      : localX === 7 ? { x: x + 1, y, plane }
        : localY === 0 ? { x, y: y - 1, plane }
          : localY === 7 ? { x, y: y + 1, plane }
            : null;
    return target && this.isRoomPosition(target) ? target : null;
  }

  getDoorTargetAtLocation(location) {
    const relativeX = location.getX() - this.allocation.baseX;
    const relativeY = location.getY() - this.allocation.baseY;
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const x = Math.floor(relativeX / 8) - gridOffset;
    const y = Math.floor(relativeY / 8) - gridOffset;
    const plane = location.getZ();
    const room = this.getRoom({ x, y, plane });
    if (!room) return null;
    return this.getDoorTargetFromEdge(x, y, plane, relativeX & 7, relativeY & 7);
  }

  /** The south-west tile of the room at a grid position. */
  roomCorner(position) {
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    return new Location(this.allocation.baseX + (position.x + gridOffset) * 8, this.allocation.baseY + (position.y + gridOffset) * 8, position.plane);
  }

  getRoomPositionAt(location) {
    const gridOffset = Math.floor((Palette.HOUSE_SCENE_CHUNKS - this.gridSize) / 2);
    const position = {
      x: Math.floor((location.x - this.allocation.baseX) / 8) - gridOffset,
      y: Math.floor((location.y - this.allocation.baseY) / 8) - gridOffset,
      plane: location.z,
    };
    return this.isRoomPosition(position) ? position : null;
  }

  rotatedFootprint(x, y, id, face, rotation) {
    const definition = CacheDefinitions.getObject(id);
    const width = (face & 1) ? definition.sizeY : definition.sizeX;
    const height = (face & 1) ? definition.sizeX : definition.sizeY;
    const origin = Palette.rotateHotspot(x, y, rotation);
    const opposite = Palette.rotateHotspot(x + width - 1, y + height - 1, rotation);
    return { x: Math.min(origin.x, opposite.x), y: Math.min(origin.y, opposite.y) };
  }

  furnitureKey(localX, localY, type) {
    return `${localX}:${localY}:${type}`;
  }

  getTemplateHotspot(roomKey, id, localX, localY) {
    const room = Data.ROOM_BY_KEY.get(roomKey);
    return room && PlayerHouseInstance.getTemplateObjects(Estate.houseStyleIndex(this.save)).find((object) =>
      (object.id === id || (Data.hotspotIn(roomKey, id) && Data.hotspotIn(roomKey, object.id)?.key === Data.hotspotIn(roomKey, id)?.key))
      && object.localX === localX && object.localY === localY
      && object.sourceChunkX === room.sourceChunkX && object.sourceChunkY === room.sourceChunkY);
  }

  static getTemplateObjects(style = 0) {
    const cached = this.templateObjects.get(style);
    if (cached) return cached;
    const chunkOffset = Math.floor(style / 4) * 8;
    const objects = [];
    const regions = new Set([...Data.CONSTRUCTION_ROOMS, ...Object.values(Data.HOUSE_TEMPLATE_CHUNKS)]
      .map(({ sourceChunkX, sourceChunkY }) => (((sourceChunkX + chunkOffset) >> 3) << 8) | (sourceChunkY >> 3)));
    for (const regionId of regions) {
      const region = getTemplateRegion(regionId);
      if (!region) throw new Error(`Construction template region ${regionId} is missing from the active cache.`);
      for (const loc of region.chunks.flat()) {
        if (loc.plane !== style % 4) continue;
        if (!Data.ROOM_DOOR_HOTSPOT_IDS.has(loc.id)
          && !Estate.HOUSE_STYLES[style].doorHotspots.includes(loc.id)
          && loc.id !== HOUSE_DYNAMIC_WINDOW
          && !Data.HOTSPOT_BY_OBJECT_ID.has(loc.id)
          && !CacheDefinitions.getObject(loc.id).actions?.includes("Build")) continue;
        objects.push({
          id: loc.id,
          sourceChunkX: (regionId >> 8) * 8 + (loc.localX >> 3) - chunkOffset,
          sourceChunkY: (regionId & 0xff) * 8 + (loc.localY >> 3),
          localX: loc.localX & 7,
          localY: loc.localY & 7,
          type: loc.type,
          face: loc.face,
        });
      }
    }
    this.templateObjects.set(style, objects);
    return objects;
  }
}

Object.assign(module.exports, { createDefaultHouseSave, createTestHouseSave, PlayerHouseInstance });
