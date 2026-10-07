import { ModelData } from "../model/ModelData";
import { TextureLoader } from "../texture/TextureLoader";
import { CollisionMap } from "./CollisionMap";
import { FloorDecoration } from "./FloorDecoration";
import { Loc } from "./Loc";
import { SceneTile } from "./SceneTile";
import { SceneTileModel } from "./SceneTileModel";
import { Wall } from "./Wall";
import { WallDecoration } from "./WallDecoration";
import { Entity } from "./entity/Entity";
import { EntityTag, EntityType, getEntityTypeFromTag } from "./entity/EntityTag";

export class Scene {
    static readonly MAX_LEVELS = 4;
    static readonly MAP_SQUARE_SIZE = 64;

    static readonly UNITS_LEVEL_HEIGHT = 240;
    static readonly UNITS_TILE_HEIGHT_BASIS = 8;

    // Tiles
    tiles: SceneTile[][][];
    bridgeReplicas: (SceneTile | undefined)[][][];
    collisionMaps: CollisionMap[];

    // Terrain
    tileHeights: Int32Array[][];

    tileRenderFlags: Uint8Array[][];
    tileUnderlays: Uint16Array[][];
    tileOverlays: Int16Array[][];
    tileShapes: Uint8Array[][];
    tileRotations: Uint8Array[][];

    // Terrain light
    tileLightOcclusions: Uint8Array[][];

    constructor(
        readonly levels: number,
        readonly sizeX: number,
        readonly sizeY: number,
    ) {
        this.tiles = new Array(levels);
        this.bridgeReplicas = new Array(levels);
        this.collisionMaps = new Array(levels);

        this.tileHeights = new Array(levels);
        this.tileRenderFlags = new Array(levels);
        this.tileUnderlays = new Array(levels);
        this.tileOverlays = new Array(levels);
        this.tileShapes = new Array(levels);
        this.tileRotations = new Array(levels);

        this.tileLightOcclusions = new Array(levels);
        for (let l = 0; l < levels; l++) {
            this.tiles[l] = new Array(this.sizeX);
            this.bridgeReplicas[l] = new Array(this.sizeX);
            this.collisionMaps[l] = new CollisionMap(this.sizeX, this.sizeY);
            this.tileHeights[l] = new Array(this.sizeX + 1);
            this.tileRenderFlags[l] = new Array(this.sizeX);
            this.tileUnderlays[l] = new Array(this.sizeX);
            this.tileOverlays[l] = new Array(this.sizeX);
            this.tileShapes[l] = new Array(this.sizeX);
            this.tileRotations[l] = new Array(this.sizeX);
            this.tileLightOcclusions[l] = new Array(this.sizeX + 1);
            for (let x = 0; x < this.sizeX; x++) {
                this.tiles[l][x] = new Array(this.sizeY);
                this.bridgeReplicas[l][x] = new Array(this.sizeY);
                this.tileRenderFlags[l][x] = new Uint8Array(this.sizeY);
                this.tileUnderlays[l][x] = new Uint16Array(this.sizeY);
                this.tileOverlays[l][x] = new Int16Array(this.sizeY);
                this.tileShapes[l][x] = new Uint8Array(this.sizeY);
                this.tileRotations[l][x] = new Uint8Array(this.sizeY);
            }
            for (let x = 0; x < this.sizeX + 1; x++) {
                this.tileHeights[l][x] = new Int32Array(this.sizeY + 1);
                this.tileLightOcclusions[l][x] = new Uint8Array(this.sizeY + 1);
            }
        }
    }

    isWithinBounds(level: number, tileX: number, tileY: number): boolean {
        return (
            level >= 0 &&
            level < this.levels &&
            tileX >= 0 &&
            tileX < this.sizeX &&
            tileY >= 0 &&
            tileY < this.sizeY
        );
    }

    ensureTileExists(startLevel: number, endLevel: number, tileX: number, tileY: number) {
        for (let i = startLevel; i <= endLevel; i++) {
            if (!this.tiles[i][tileX][tileY]) {
                this.tiles[i][tileX][tileY] = new SceneTile(i, tileX, tileY);
            }
        }
    }

    private setBridgeReplicaTile(
        level: number,
        tileX: number,
        tileY: number,
        tile: SceneTile,
    ): void {
        if (!this.isWithinBounds(level, tileX, tileY)) {
            return;
        }
        this.bridgeReplicas[level][tileX][tileY] = tile;
    }

    getBridgeReplicaTile(level: number, tileX: number, tileY: number): SceneTile | undefined {
        if (!this.isWithinBounds(level, tileX, tileY)) {
            return undefined;
        }
        return this.bridgeReplicas[level][tileX][tileY];
    }

    newFloorDecoration(
        level: number,
        tileX: number,
        tileY: number,
        height: number,
        entity: Entity | undefined,
        tag: EntityTag,
        flags: number,
    ): void {
        if (entity) {
            const x = tileX * 128 + 64;
            const y = tileY * 128 + 64;

            const floorDecoration = new FloorDecoration(entity, x, y, height, tag, flags);

            this.ensureTileExists(level, level, tileX, tileY);

            this.tiles[level][tileX][tileY].floorDecoration = floorDecoration;
        }
    }

    newLoc(
        level: number,
        tileX: number,
        tileY: number,
        height: number,
        sizeX: number,
        sizeY: number,
        entity: Entity | undefined,
        rotation: number,
        tag: EntityTag,
        flags: number,
    ): boolean {
        if (entity) {
            const centerX = tileX * 128 + 64 * sizeX;
            const centerY = tileY * 128 + 64 * sizeY;
            return this.newLoc0(
                level,
                tileX,
                tileY,
                sizeX,
                sizeY,
                centerX,
                centerY,
                height,
                entity,
                rotation,
                tag,
                flags,
            );
        }
        return true;
    }

    private newLoc0(
        level: number,
        tileX: number,
        tileY: number,
        sizeX: number,
        sizeY: number,
        centerX: number,
        centerY: number,
        height: number,
        entity: Entity,
        rotation: number,
        tag: EntityTag,
        flags: number,
    ): boolean {
        const startX = tileX;
        const startY = tileY;
        const endX = tileX + sizeX - 1;
        const endY = tileY + sizeY - 1;

        for (let sx = startX; sx <= endX; sx++) {
            for (let sy = startY; sy <= endY; sy++) {
                if (sx < 0 || sy < 0 || sx >= this.sizeX || sy >= this.sizeY) {
                    return false;
                }
                const tile = this.tiles[level][sx][sy];
                if (tile && tile.locs.length >= 5) {
                    return false;
                }
            }
        }

        const loc = new Loc(
            tag,
            flags,
            level,
            centerX,
            centerY,
            height,
            entity,
            rotation,
            startX,
            startY,
            endX,
            endY,
        );

        for (let sx = startX; sx <= endX; sx++) {
            for (let sy = startY; sy <= endY; sy++) {
                this.ensureTileExists(0, level, sx, sy);

                this.tiles[level][sx][sy].locs.push(loc);
            }
        }

        return true;
    }

    newWall(
        level: number,
        tileX: number,
        tileY: number,
        centerHeight: number,
        entity0: Entity | undefined,
        entity1: Entity | undefined,
        tag: EntityTag,
        flags: number,
    ): void {
        if (!entity0 && !entity1) {
            return;
        }

        const x = tileX * 128 + 64;
        const y = tileY * 128 + 64;

        const wall = new Wall(tag, flags, x, y, centerHeight, entity0, entity1);

        this.ensureTileExists(0, level, tileX, tileY);

        this.tiles[level][tileX][tileY].wall = wall;
    }

    newWallDecoration(
        level: number,
        tileX: number,
        tileY: number,
        centerHeight: number,
        entity0: Entity | undefined,
        entity1: Entity | undefined,
        offsetX: number,
        offsetY: number,
        tag: bigint,
        flags: number,
    ) {
        if (entity0) {
            const x = tileX * 128 + 64;
            const y = tileY * 128 + 64;

            const wallDecoration = new WallDecoration(
                tag,
                flags,
                x,
                y,
                centerHeight,
                entity0,
                entity1,
                offsetX,
                offsetY,
            );

            this.ensureTileExists(0, level, tileX, tileY);

            this.tiles[level][tileX][tileY].wallDecoration = wallDecoration;
        }
    }

    updateWallDecorationDisplacement(
        level: number,
        tileX: number,
        tileY: number,
        displacement: number,
    ) {
        const tile = this.tiles[level][tileX][tileY];
        if (tile && tile.wallDecoration) {
            const decor = tile.wallDecoration;
            decor.offsetX = ((displacement * decor.offsetX) / 16) | 0;
            decor.offsetY = ((displacement * decor.offsetY) / 16) | 0;
        }
    }

    getWallTag(level: number, tileX: number, tileY: number): bigint {
        const tile = this.tiles[level][tileX][tileY];
        return (tile && tile.wall && tile.wall.tag) ?? 0n;
    }

    getLocTag(level: number, tileX: number, tileY: number): bigint {
        const tile = this.tiles[level][tileX][tileY];
        if (!tile) {
            return 0n;
        }

        for (const loc of tile.locs) {
            const entityType = getEntityTypeFromTag(loc.tag);
            if (entityType === EntityType.LOC && tileX === loc.startX && tileY === loc.startY) {
                return loc.tag;
            }
        }

        return 0n;
    }

    getFloorDecorationTag(level: number, tileX: number, tileY: number): bigint {
        const tile = this.tiles[level][tileX][tileY];
        return (tile && tile.floorDecoration && tile.floorDecoration.tag) || 0n;
    }

    getLocFlags(level: number, tileX: number, tileY: number, tag: bigint): number {
        const tile = this.tiles[level][tileX][tileY];
        if (!tile) {
            return -1;
        }

        if (tile.wall && tile.wall.tag === tag) {
            return tile.wall.flags & 0xff;
        } else if (tile.wallDecoration && tile.wallDecoration.tag === tag) {
            return tile.wallDecoration.flags & 0xff;
        } else if (tile.floorDecoration && tile.floorDecoration.tag === tag) {
            return tile.floorDecoration.flags & 0xff;
        } else {
            for (const loc of tile.locs) {
                if (loc.tag === tag) {
                    return loc.flags & 0xff;
                }
            }

            return -1;
        }
    }

    calculateTileLights(level: number, ignoreTileLightOcclusion: boolean = false): Int32Array[] {
        const lights: Int32Array[] = new Array(this.sizeX);
        for (let i = 0; i < this.sizeX; i++) {
            lights[i] = new Int32Array(this.sizeY);
        }

        const LIGHT_DIR_X = -50;
        const LIGHT_DIR_Y = -10;
        const LIGHT_DIR_Z = -50;
        const LIGHT_INTENSITY_BASE = 96;
        const LIGHT_INTENSITY_FACTOR = 768;
        const HEIGHT_SCALE = 65536;

        const lightMagnitude =
            Math.sqrt(
                LIGHT_DIR_X * LIGHT_DIR_X + LIGHT_DIR_Y * LIGHT_DIR_Y + LIGHT_DIR_Z * LIGHT_DIR_Z,
            ) | 0;
        const lightIntensity = (lightMagnitude * LIGHT_INTENSITY_FACTOR) >> 8;

        for (let x = 1; x < this.sizeX - 1; x++) {
            for (let y = 1; y < this.sizeY - 1; y++) {
                // First we need to calculate the normals for each tile.
                // This is typically by doing a cross product on the tangent vectors which can be derived from
                // the differences in height between adjacent tiles.
                // The code below seems to be calculating the normals directly by skipping the cross product.

                const heightDeltaX =
                    this.tileHeights[level][x + 1][y] - this.tileHeights[level][x - 1][y];
                const heightDeltaY =
                    this.tileHeights[level][x][y + 1] - this.tileHeights[level][x][y - 1];

                const tileNormalLength =
                    Math.sqrt(
                        heightDeltaY * heightDeltaY + heightDeltaX * heightDeltaX + HEIGHT_SCALE,
                    ) | 0;

                const normalizedTileNormalX = ((heightDeltaX << 8) / tileNormalLength) | 0;
                const normalizedTileNormalY = (HEIGHT_SCALE / tileNormalLength) | 0;
                const normalizedTileNormalZ = ((heightDeltaY << 8) / tileNormalLength) | 0;

                // Now we calculate the light contribution based on a simplified Phong model, specifically
                // we ignore the material coefficients and there are no specular contributions.

                // For reference, this is the standard Phong model:
                //  I = Ia * Ka + Id * Kd * (N dot L)
                //  I: Total intensity of light at a point on the surface.
                //  Ia: Intensity of ambient light in the scene (constant and uniform).
                //  Ka: Ambient reflection coefficient of the material.
                //  Id: Intensity of the directional (diffuse) light source.
                //  Kd: Diffuse reflection coefficient of the material.
                //  N: Normalized surface normal vector at the point.
                //  L: Normalized direction vector from the point to the light source.
                //  (N dot L): Dot product between the surface normal vector and the light direction vector.

                const dot =
                    normalizedTileNormalX * LIGHT_DIR_X +
                    normalizedTileNormalY * LIGHT_DIR_Y +
                    normalizedTileNormalZ * LIGHT_DIR_Z;
                const sunLight = (dot / lightIntensity + LIGHT_INTENSITY_BASE) | 0;

                // Now that we have the computed light contribution, take light occlusion from other objects
                // into account. These tile light occlusions are computed dinamically based on walls, roofs
                // and floors from neighbour tiles.
                const lightOcclusion = ignoreTileLightOcclusion
                    ? 0
                    : (this.tileLightOcclusions[level][x - 1][y] >> 2) +
                      (this.tileLightOcclusions[level][x][y - 1] >> 2) +
                      (this.tileLightOcclusions[level][x + 1][y] >> 3) +
                      (this.tileLightOcclusions[level][x][y + 1] >> 3) +
                      (this.tileLightOcclusions[level][x][y] >> 1);

                lights[x][y] = sunLight - lightOcclusion;
            }
        }

        return lights;
    }

    newTileModel(level: number, tileX: number, tileY: number, tileModel: SceneTileModel) {
        this.ensureTileExists(level, level, tileX, tileY);

        this.tiles[level][tileX][tileY].tileModel = tileModel;
    }

    private cloneLoc(loc: Loc): Loc {
        return new Loc(
            loc.tag,
            loc.flags,
            loc.level,
            loc.x,
            loc.y,
            loc.height,
            loc.entity,
            loc.rotation,
            loc.startX,
            loc.startY,
            loc.endX,
            loc.endY,
        );
    }

    private cloneTileForBridge(tile: SceneTile | undefined):
        | {
              level: number;
              originalLevel: number;
              minLevel: number;
              tileModel?: SceneTileModel;
              floorDecoration?: FloorDecoration;
              wall?: Wall;
              wallDecoration?: WallDecoration;
              locs: Loc[];
          }
        | undefined {
        if (!tile) {
            return undefined;
        }
        return {
            level: tile.level,
            originalLevel: tile.originalLevel,
            minLevel: tile.minLevel,
            tileModel: tile.tileModel,
            floorDecoration: tile.floorDecoration,
            wall: tile.wall,
            wallDecoration: tile.wallDecoration,
            locs: tile.locs.map((loc) => this.cloneLoc(loc)),
        };
    }

    // OSRS bridge handling: for any tile where tileRenderFlags[1][x][y] has bit 0x2 set,
    // the column of tiles (levels 1..3) is shifted down by 1 so that the bridge sits on
    // the base plane. In addition, we retain non-rendering replicas at the original levels
    // so metadata such as locs/walls still resolve to their OSRS plane when queried.
    private setLinkBelow(tileX: number, tileY: number): void {
        // Clone tiles that will be demoted before we shift them
        const originalLevel1 = this.cloneTileForBridge(this.tiles[1][tileX][tileY]);
        const originalLevel2 = this.cloneTileForBridge(this.tiles[2][tileX][tileY]);
        const originalLevel3 = this.cloneTileForBridge(this.tiles[3][tileX][tileY]);

        const existingBase = this.tiles[0][tileX][tileY];
        if (existingBase?.isBridgeSurface && existingBase.linkedBelow !== undefined) {
            return;
        }

        // Save original base tile (may be undefined)
        const originalBase = existingBase;
        const hadLevel1Tile = !!this.tiles[1][tileX][tileY];

        // Shift levels 1..3 down to 0..2
        for (let l = 0; l < 3; l++) {
            const moved = (this.tiles[l][tileX][tileY] = this.tiles[l + 1][tileX][tileY]);
            if (moved) {
                // Decrement the logical level of the moved tile
                moved.level = Math.max(0, moved.level - 1);

                // Decrement loc level only for locs at their origin tile (startX, startY)
                // to match OSRS behavior. Multi-tile locs are shared across tiles and
                // should only have their level adjusted once at the origin.
                for (const loc of moved.locs) {
                    const entityType = getEntityTypeFromTag(loc.tag);
                    if (
                        entityType === EntityType.LOC &&
                        loc.startX === tileX &&
                        loc.startY === tileY
                    ) {
                        loc.level = Math.max(0, loc.level - 1);
                    }
                }
            }
        }

        // Ensure base tile exists
        if (!this.tiles[0][tileX][tileY]) {
            this.tiles[0][tileX][tileY] = new SceneTile(0, tileX, tileY);
        }

        // Link the original base tile below the new base tile (may be undefined)
        this.tiles[0][tileX][tileY].linkedBelow = originalBase;
        // Mark this base tile as a shifted bridge surface to allow consumers to
        // adjust object/loc render level and height sampling consistently with the shift.
        this.tiles[0][tileX][tileY].isBridgeSurface = hadLevel1Tile;

        // Clear topmost level
        this.tiles[3][tileX][tileY] = undefined as any;

        // Reset replica slots for this column before rebuilding them.
        for (let level = 1; level < this.levels; level++) {
            if (this.bridgeReplicas[level]) {
                this.bridgeReplicas[level][tileX][tileY] = undefined;
            }
        }

        // Create replicas for demoted tiles so objects remain queryable at original planes.
        // We add replica objects to existing shifted tiles to preserve both sets of objects.
        const originalTiles = [
            { original: originalLevel1, replicaLevel: 1 },
            { original: originalLevel2, replicaLevel: 2 },
            { original: originalLevel3, replicaLevel: 3 },
        ];

        for (const { original, replicaLevel } of originalTiles) {
            if (!original) continue;

            const replica = new SceneTile(replicaLevel, tileX, tileY);
            replica.originalLevel = original.originalLevel;
            replica.minLevel = original.minLevel;
            replica.tileModel = original.tileModel;
            replica.floorDecoration = original.floorDecoration;
            replica.wall = original.wall;
            replica.wallDecoration = original.wallDecoration;
            replica.locs = original.locs;
            replica.skipRender = true;
            this.setBridgeReplicaTile(replicaLevel, tileX, tileY, replica);

            // Restore loc levels for locs at their origin tile only
            for (const loc of original.locs) {
                const entityType = getEntityTypeFromTag(loc.tag);
                if (entityType === EntityType.LOC && loc.startX === tileX && loc.startY === tileY) {
                    loc.level = replicaLevel;
                }
            }
        }
    }

    // Apply bridge relinking across the entire scene to match OSRS
    applyBridgeLinks(): void {
        const floorMask = 0x200000;

        // Wall flag masks for each direction (movement + projectile + route blockers)
        const WALL_WEST_ALL = 0x80 | 0x10000 | 0x20000000; // WALL_WEST variants
        const WALL_EAST_ALL = 0x8 | 0x1000 | 0x2000000; // WALL_EAST variants
        const WALL_SOUTH_ALL = 0x20 | 0x4000 | 0x8000000; // WALL_SOUTH variants
        const WALL_NORTH_ALL = 0x2 | 0x400 | 0x800000; // WALL_NORTH variants

        // First pass: demote bridge tile collision
        for (let x = 0; x < this.sizeX; x++) {
            for (let y = 0; y < this.sizeY; y++) {
                if ((this.tileRenderFlags[1][x][y] & 0x2) === 2) {
                    this.setLinkBelow(x, y);

                    // When tiles are demoted, collision must also be shifted down.
                    // Save collision from upper planes before shifting
                    const collision1 = this.collisionMaps[1]?.getFlag(x, y) ?? 0;
                    const collision2 = this.collisionMaps[2]?.getFlag(x, y) ?? 0;
                    const collision3 = this.collisionMaps[3]?.getFlag(x, y) ?? 0;

                    // Shift collision down one plane (matching tile demotion)
                    // Preserve floor collision (0x200000) at each destination level as it was
                    // already set correctly by setFloorCollision() before bridge demotion

                    // Plane 0 gets non-floor collision from plane 1, keeping its floor collision
                    if (this.collisionMaps[0]) {
                        const floor0 = this.collisionMaps[0].getFlag(x, y) & floorMask;
                        this.collisionMaps[0].setFlag(x, y, (collision1 & ~floorMask) | floor0);
                    }
                    // Plane 1 gets non-floor collision from plane 2, keeping its floor collision
                    if (this.collisionMaps[1]) {
                        const floor1 = collision1 & floorMask;
                        this.collisionMaps[1].setFlag(x, y, (collision2 & ~floorMask) | floor1);
                    }
                    // Plane 2 gets non-floor collision from plane 3, keeping its floor collision
                    if (this.collisionMaps[2]) {
                        const floor2 = collision2 & floorMask;
                        this.collisionMaps[2].setFlag(x, y, (collision3 & ~floorMask) | floor2);
                    }
                    // Plane 3 is cleared (was shifted to plane 2)
                    if (this.collisionMaps[3]) {
                        const floor3 = collision3 & floorMask;
                        this.collisionMaps[3].setFlag(x, y, floor3);
                    }
                }
            }
        }

        // Second pass: copy wall flags from adjacent non-bridge tiles to plane 0
        // This fixes pathfinding from bridge (plane 0) to non-bridge (plane 1) tiles
        for (let x = 0; x < this.sizeX; x++) {
            for (let y = 0; y < this.sizeY; y++) {
                if ((this.tileRenderFlags[1][x][y] & 0x2) !== 2) {
                    continue; // Not a bridge tile
                }

                const cm0 = this.collisionMaps[0];
                const cm1 = this.collisionMaps[1];
                if (!cm0 || !cm1) continue;

                // Check west neighbor (x-1, y) - if not a bridge, copy its WALL_EAST to plane 0
                if (x > 0 && (this.tileRenderFlags[1][x - 1][y] & 0x2) !== 2) {
                    const neighborFlags = cm1.getFlag(x - 1, y);
                    const wallFlags = neighborFlags & WALL_EAST_ALL;
                    if (wallFlags) {
                        cm0.flag(x - 1, y, wallFlags);
                    }
                }

                // Check east neighbor (x+1, y) - if not a bridge, copy its WALL_WEST to plane 0
                if (x < this.sizeX - 1 && (this.tileRenderFlags[1][x + 1][y] & 0x2) !== 2) {
                    const neighborFlags = cm1.getFlag(x + 1, y);
                    const wallFlags = neighborFlags & WALL_WEST_ALL;
                    if (wallFlags) {
                        cm0.flag(x + 1, y, wallFlags);
                    }
                }

                // Check south neighbor (x, y-1) - if not a bridge, copy its WALL_NORTH to plane 0
                if (y > 0 && (this.tileRenderFlags[1][x][y - 1] & 0x2) !== 2) {
                    const neighborFlags = cm1.getFlag(x, y - 1);
                    const wallFlags = neighborFlags & WALL_NORTH_ALL;
                    if (wallFlags) {
                        cm0.flag(x, y - 1, wallFlags);
                    }
                }

                // Check north neighbor (x, y+1) - if not a bridge, copy its WALL_SOUTH to plane 0
                if (y < this.sizeY - 1 && (this.tileRenderFlags[1][x][y + 1] & 0x2) !== 2) {
                    const neighborFlags = cm1.getFlag(x, y + 1);
                    const wallFlags = neighborFlags & WALL_SOUTH_ALL;
                    if (wallFlags) {
                        cm0.flag(x, y + 1, wallFlags);
                    }
                }
            }
        }
    }

    getTileMinLevel(level: number, tileX: number, tileY: number): number {
        if ((this.tileRenderFlags[level][tileX][tileY] & 0x8) !== 0) {
            return 0;
        } else if (level > 0 && (this.tileRenderFlags[1][tileX][tileY] & 0x2) !== 0) {
            return level - 1;
        } else {
            return level;
        }
    }

    setTileMinLevel(level: number, tileX: number, tileY: number, minLevel: number) {
        const tile = this.tiles[level][tileX][tileY];
        if (tile) {
            tile.minLevel = minLevel;
        }
    }

    isInside(level: number, tileX: number, tileY: number): boolean {
        return (this.tileRenderFlags[level][tileX][tileY] & 0x4) !== 0;
    }

    setTileMinLevels() {
        for (let level = 0; level < this.levels; level++) {
            for (let x = 0; x < this.sizeX; x++) {
                for (let y = 0; y < this.sizeY; y++) {
                    this.setTileMinLevel(level, x, y, this.getTileMinLevel(level, x, y));
                }
            }
        }
    }

    isPlayerLevel(level: number, tileX: number, tileY: number, playerLevel: number): boolean {
        const baseFlags = this.tileRenderFlags[0][tileX][tileY];
        if ((baseFlags & 0x2) !== 0) {
            return true;
        }

        const levelFlags = this.tileRenderFlags[level][tileX][tileY];
        if ((levelFlags & 0x10) !== 0 && playerLevel < level) {
            return false;
        }

        return playerLevel >= this.getTileMinLevel(level, tileX, tileY);
    }

    getCenterHeight(level: number, tileX: number, tileY: number): number {
        let heightLevel = level;
        if (level < 3 && (this.tileRenderFlags[1][tileX][tileY] & 0x2) !== 0) {
            heightLevel = level + 1;
        }

        return (
            (this.tileHeights[heightLevel][tileX][tileY] +
                this.tileHeights[heightLevel][tileX][tileY + 1] +
                this.tileHeights[heightLevel][tileX + 1][tileY] +
                this.tileHeights[heightLevel][tileX + 1][tileY + 1]) >>
            2
        );
    }

    getDeltaHeight(
        level0: number,
        tileX0: number,
        tileY0: number,
        level1: number,
        tileX1: number,
        tileY1: number,
    ): number {
        return (
            this.getCenterHeight(level0, tileX0, tileY0) -
            this.getCenterHeight(level1, tileX1, tileY1)
        );
    }

    mergeLargeLocNormals(
        model: ModelData,
        startLevel: number,
        tileX: number,
        tileY: number,
        sizeX: number,
        sizeY: number,
    ): void {
        let hideOccluded = true;
        let startX = tileX;
        const endX = tileX + sizeX;
        const startY = tileY - 1;
        const endY = tileY + sizeY;

        for (let level = startLevel; level <= startLevel + 1; level++) {
            if (level === this.levels) {
                continue;
            }

            for (let localX = startX; localX <= endX; localX++) {
                if (localX >= 0 && localX < this.sizeX) {
                    for (let localY = startY; localY <= endY; localY++) {
                        if (
                            localY >= 0 &&
                            localY < this.sizeY &&
                            (!hideOccluded ||
                                localX >= endX ||
                                localY >= endY ||
                                (localY < tileY && tileX !== localX))
                        ) {
                            const tile = this.tiles[level][localX][localY];
                            if (tile) {
                                const deltaHeight = this.getDeltaHeight(
                                    level,
                                    localX,
                                    localY,
                                    startLevel,
                                    tileX,
                                    tileY,
                                );

                                const wall = tile.wall;
                                if (wall) {
                                    if (wall.entity0 instanceof ModelData) {
                                        ModelData.mergeNormals(
                                            model,
                                            wall.entity0,
                                            (1 - sizeX) * 64 + (localX - tileX) * 128,
                                            deltaHeight,
                                            (localY - tileY) * 128 + (1 - sizeY) * 64,
                                            hideOccluded,
                                        );
                                    }
                                    if (wall.entity1 instanceof ModelData) {
                                        ModelData.mergeNormals(
                                            model,
                                            wall.entity1,
                                            (1 - sizeX) * 64 + (localX - tileX) * 128,
                                            deltaHeight,
                                            (localY - tileY) * 128 + (1 - sizeY) * 64,
                                            hideOccluded,
                                        );
                                    }
                                }

                                for (const loc of tile.locs) {
                                    if (loc.entity instanceof ModelData) {
                                        const var21 = loc.endX - loc.startX + 1;
                                        const var22 = loc.endY - loc.startY + 1;
                                        ModelData.mergeNormals(
                                            model,
                                            loc.entity,
                                            (var21 - sizeX) * 64 + (loc.startX - tileX) * 128,
                                            deltaHeight,
                                            (loc.startY - tileY) * 128 + (var22 - sizeY) * 64,
                                            hideOccluded,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }

            startX--;
            hideOccluded = false;
        }
    }

    mergeFloorNormals(model: ModelData, level: number, tileX: number, tileY: number): void {
        const endX = tileX + 1;
        const startY = tileY - 1;
        const endY = tileY + 1;

        for (let x = tileX; x <= endX; x++) {
            if (x >= 0 && x < this.sizeX) {
                for (let y = startY; y <= endY; y++) {
                    if (y >= 0 && y < this.sizeY && (x >= endX || y >= endY)) {
                        const tile = this.tiles[level][x][y];
                        if (
                            tile &&
                            tile.floorDecoration &&
                            tile.floorDecoration.entity instanceof ModelData
                        ) {
                            const deltaHeight = this.getDeltaHeight(
                                level,
                                x,
                                y,
                                level,
                                tileX,
                                tileY,
                            );
                            ModelData.mergeNormals(
                                model,
                                tile.floorDecoration.entity,
                                (x - tileX) * 128,
                                deltaHeight,
                                (y - tileY) * 128,
                                true,
                            );
                        }
                    }
                }
            }
        }
    }

    private mergeTileGeometryNormals(
        tile: SceneTile,
        level: number,
        tileX: number,
        tileY: number,
    ): void {
        const wall = tile.wall;
        if (wall) {
            const model0 = wall.entity0 instanceof ModelData ? wall.entity0 : undefined;
            const model1 = wall.entity1 instanceof ModelData ? wall.entity1 : undefined;

            if (model0) {
                this.mergeLargeLocNormals(model0, level, tileX, tileY, 1, 1);
            }
            if (model1) {
                this.mergeLargeLocNormals(model1, level, tileX, tileY, 1, 1);
            }
            if (model0 && model1) {
                ModelData.mergeNormals(model0, model1, 0, 0, 0, false);
            }
        }

        for (const loc of tile.locs) {
            if (loc.entity instanceof ModelData) {
                this.mergeLargeLocNormals(
                    loc.entity,
                    level,
                    tileX,
                    tileY,
                    loc.endX - loc.startX + 1,
                    loc.endY - loc.startY + 1,
                );
            }
        }

        const floorDecoration = tile.floorDecoration;
        if (floorDecoration && floorDecoration.entity instanceof ModelData) {
            this.mergeFloorNormals(floorDecoration.entity, level, tileX, tileY);
        }
    }

    private lightTileGeometry(
        tile: SceneTile,
        textureLoader: TextureLoader,
        lightX: number,
        lightY: number,
        lightZ: number,
    ): void {
        const wall = tile.wall;
        if (wall) {
            if (wall.entity0 instanceof ModelData) {
                const model0 = wall.entity0;
                wall.entity0 = model0.light(
                    textureLoader,
                    model0.ambient,
                    model0.contrast,
                    lightX,
                    lightY,
                    lightZ,
                );
            }

            if (wall.entity1 instanceof ModelData) {
                const model1 = wall.entity1;
                wall.entity1 = model1.light(
                    textureLoader,
                    model1.ambient,
                    model1.contrast,
                    lightX,
                    lightY,
                    lightZ,
                );
            }
        }

        for (const loc of tile.locs) {
            if (loc.entity instanceof ModelData) {
                const model = loc.entity;
                loc.entity = model.light(
                    textureLoader,
                    model.ambient,
                    model.contrast,
                    lightX,
                    lightY,
                    lightZ,
                );
            }
        }

        const floorDecoration = tile.floorDecoration;
        if (floorDecoration && floorDecoration.entity instanceof ModelData) {
            const model = floorDecoration.entity;
            floorDecoration.entity = model.light(
                textureLoader,
                model.ambient,
                model.contrast,
                lightX,
                lightY,
                lightZ,
            );
        }
    }

    private forEachLightingTile(
        visitor: (tile: SceneTile, level: number, tileX: number, tileY: number) => void,
    ): void {
        const visited = new Set<SceneTile>();

        const visit = (tile: SceneTile, level: number, tileX: number, tileY: number) => {
            if (visited.has(tile)) {
                return;
            }
            visited.add(tile);
            visitor(tile, level, tileX, tileY);
        };

        for (let level = 0; level < this.levels; level++) {
            for (let tileX = 0; tileX < this.sizeX; tileX++) {
                for (let tileY = 0; tileY < this.sizeY; tileY++) {
                    const tile = this.tiles[level][tileX][tileY];
                    if (!tile) {
                        continue;
                    }

                    visit(tile, level, tileX, tileY);

                    const replicaTile = this.getBridgeReplicaTile(level, tileX, tileY);
                    if (replicaTile) {
                        visit(replicaTile, replicaTile.level, tileX, tileY);
                    }

                    // Also process the original base tile linked below a bridge-promoted column.
                    if (level === 0 && tile.linkedBelow) {
                        visit(tile.linkedBelow, level, tileX, tileY);
                    }
                }
            }
        }
    }

    light(textureLoader: TextureLoader, lightX: number, lightY: number, lightZ: number): void {
        // Keep every ModelData alive until all cross-tile normal merges are complete.
        // Lighting a tile converts ModelData to Model, which otherwise prevents later
        // tiles from merging normals against already-lit neighbors.
        this.forEachLightingTile((tile, level, tileX, tileY) => {
            this.mergeTileGeometryNormals(tile, level, tileX, tileY);
        });

        this.forEachLightingTile((tile) => {
            this.lightTileGeometry(tile, textureLoader, lightX, lightY, lightZ);
        });
    }

}
