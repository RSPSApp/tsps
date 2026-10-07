import { PrivateArea } from './PrivateArea';
import { Boundary } from '../../Boundary';
import { Location } from '../../Location';
import { GameObject } from '../../../entity/impl/object/GameObject';
import { ObjectDefinition } from '../../../definition/ObjectDefinition';
import { RegionManager } from '../../../collision/RegionManager';
import { getTemplateRegion, templateChunkKey } from '../../../collision/TemplateRegionData';
import { CachePipeline } from '../../../cache/CachePipeline';
import { encodeRebuildRegion } from '../../../../net/protocol/ClientProtocol';

/** An 8x8 chunk of the cache map that an instance copies, turned clockwise `rotation` times. */
export interface TemplateChunk {
    sourceChunkX: number;
    sourceChunkY: number;
    sourcePlane: number;
    rotation: number;
}

const PLANES = 4;
const SCENE_CHUNKS = 13;
/** The largest instance, in chunks a side, and the spacing between allocations. */
export const MAX_INSTANCE_CHUNKS = 16;
const SLOT_STRIDE = 20;
/** Instances live where the cache has no map (tile 8192+), clear of houses and boat decks. */
const FIRST_SLOT_CHUNK_X = 1024;
const FIRST_SLOT_CHUNK_Y = 200;
const SLOT_COLUMNS = 7;
const SLOT_ROWS = 60;
const usedSlots = new Array<boolean>(SLOT_COLUMNS * SLOT_ROWS).fill(false);

/** Settings bits (cache terrain) and the collision flags they set. */
const SETTING_BLOCKED = 1;
const SETTING_BRIDGE = 2;
const BLOCKED_TILE = 0x200000;
/** A tile no chunk has been copied to: nothing is drawn there and nothing walks there. */
const UNMAPPED_TILE = BLOCKED_TILE | 0x100;

interface PlacedLoc {
    id: number;
    x: number;
    y: number;
    z: number;
    type: number;
    face: number;
    object?: GameObject;
}

export function packTemplateChunk(chunk: TemplateChunk): number {
    return (((chunk.sourcePlane & 3) << 24)
        | ((chunk.sourceChunkX & 0x3ff) << 14)
        | ((chunk.sourceChunkY & 0x7ff) << 3)
        | ((chunk.rotation & 3) << 1)) >>> 0;
}

/** Where a tile of a chunk lands once the chunk is turned (the client's rotation). */
export function rotateChunkTile(x: number, y: number, rotation: number): [number, number] {
    switch (rotation & 3) {
        case 0: return [x, y];
        case 1: return [y, 7 - x];
        case 2: return [7 - x, 7 - y];
        default: return [7 - y, x];
    }
}

/** Where a loc's south-west tile lands once its chunk is turned; size is the loc's footprint. */
export function rotateChunkLoc(x: number, y: number, rotation: number, sizeX: number, sizeY: number, face: number): [number, number] {
    if ((face & 1) === 1) [sizeX, sizeY] = [sizeY, sizeX];
    switch (rotation & 3) {
        case 0: return [x, y];
        case 1: return [y, 7 - x - (sizeX - 1)];
        case 2: return [7 - x - (sizeX - 1), 7 - y - (sizeY - 1)];
        default: return [7 - y - (sizeY - 1), x];
    }
}

/**
 * A private area built from cache template chunks, as OSRS builds raids, the Gauntlet and other
 * dynamic maps. Chunks are copied (and turned) into a grid at an allocated place outside the
 * real map. The client draws them from the REBUILD_REGION palette, which PlayerSession sends
 * from {@link encodeScene} around each player inside; the server builds the same collision and
 * locs from the templates, so walking and interacting match what is drawn.
 *
 * Chunks can be copied or cleared at any time (a maze revealing rooms): the scene version goes
 * up and everyone inside is sent the new palette.
 */
export class TemplatedInstanceArea extends PrivateArea {
    public readonly baseChunkX: number;
    public readonly baseChunkY: number;
    public readonly widthChunks: number;
    public readonly heightChunks: number;
    private readonly slot: number;
    private readonly chunks: (TemplateChunk | null)[];
    private clipGrid: Int32Array | null = null;
    private locIndex = new Map<number, PlacedLoc[]>();
    private sceneVersion = 0;

    constructor(widthChunks: number, heightChunks: number) {
        if (widthChunks < 1 || heightChunks < 1 || widthChunks > MAX_INSTANCE_CHUNKS || heightChunks > MAX_INSTANCE_CHUNKS) {
            throw new Error(`Templated instance size ${widthChunks}x${heightChunks} is outside 1-${MAX_INSTANCE_CHUNKS} chunks.`);
        }
        const slot = usedSlots.indexOf(false);
        if (slot < 0) throw new Error('No templated instance allocation is available.');
        const baseChunkX = FIRST_SLOT_CHUNK_X + (slot % SLOT_COLUMNS) * SLOT_STRIDE;
        const baseChunkY = FIRST_SLOT_CHUNK_Y + Math.floor(slot / SLOT_COLUMNS) * SLOT_STRIDE;
        const minX = baseChunkX * 8;
        const minY = baseChunkY * 8;
        super(Array.from({ length: PLANES }, (_, z) =>
            new Boundary(minX, minX + widthChunks * 8 - 1, minY, minY + heightChunks * 8 - 1, z)));
        usedSlots[slot] = true;
        this.slot = slot;
        this.baseChunkX = baseChunkX;
        this.baseChunkY = baseChunkY;
        this.widthChunks = widthChunks;
        this.heightChunks = heightChunks;
        this.chunks = new Array(PLANES * widthChunks * heightChunks).fill(null);
    }

    public getBaseX(): number {
        return this.baseChunkX * 8;
    }

    public getBaseY(): number {
        return this.baseChunkY * 8;
    }

    /** The world tile at an offset from the instance's south-west corner. */
    public tile(localX: number, localY: number, z: number): Location {
        return new Location(this.getBaseX() + localX, this.getBaseY() + localY, z);
    }

    public contains(location: Location): boolean {
        const x = location.getX() - this.getBaseX();
        const y = location.getY() - this.getBaseY();
        const z = location.getZ();
        return x >= 0 && y >= 0 && z >= 0 && z < PLANES && x < this.widthChunks * 8 && y < this.heightChunks * 8;
    }

    public getSceneVersion(): number {
        return this.sceneVersion;
    }

    public getChunk(plane: number, chunkX: number, chunkY: number): TemplateChunk | null {
        return this.inGrid(plane, chunkX, chunkY) ? this.chunks[this.chunkIndex(plane, chunkX, chunkY)] : null;
    }

    /** Copies one chunk (or clears it with null) at a chunk offset within the instance. */
    public setChunk(plane: number, chunkX: number, chunkY: number, chunk: TemplateChunk | null): void {
        if (!this.inGrid(plane, chunkX, chunkY)) {
            throw new Error(`Chunk ${chunkX},${chunkY},${plane} is outside the ${this.widthChunks}x${this.heightChunks} instance.`);
        }
        this.chunks[this.chunkIndex(plane, chunkX, chunkY)] = chunk ? { ...chunk, rotation: chunk.rotation & 3 } : null;
        this.invalidate();
    }

    /**
     * Copies a `size` x `size` block of chunks, the whole block turned as one: what is at the
     * source's north-west ends up north-east after one clockwise turn.
     */
    public copySquare(
        size: number, sourceChunkX: number, sourceChunkY: number, sourcePlane: number,
        chunkX: number, chunkY: number, plane: number, rotation: number,
    ): void {
        const last = size - 1;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const [toX, toY] = rotateSquare(x, y, last, rotation);
                this.setChunk(plane, chunkX + toX, chunkY + toY, {
                    sourceChunkX: sourceChunkX + x, sourceChunkY: sourceChunkY + y, sourcePlane, rotation,
                });
            }
        }
    }

    /** The REBUILD_REGION palette for the 13x13-chunk scene centred on a chunk. */
    public buildScenePalette(centerChunkX: number, centerChunkY: number): { palette: number[][][]; xteas: number[][] } {
        const palette = Array.from({ length: PLANES }, () =>
            Array.from({ length: SCENE_CHUNKS }, () => new Array<number>(SCENE_CHUNKS).fill(-1)));
        const seen = new Set<number>();
        const xteas: number[][] = [];
        for (let plane = 0; plane < PLANES; plane++) {
            for (let x = 0; x < SCENE_CHUNKS; x++) {
                for (let y = 0; y < SCENE_CHUNKS; y++) {
                    const chunk = this.getChunk(plane, centerChunkX - 6 + x - this.baseChunkX, centerChunkY - 6 + y - this.baseChunkY);
                    if (!chunk) continue;
                    palette[plane][x][y] = packTemplateChunk(chunk);
                    const regionId = ((chunk.sourceChunkX >> 3) << 8) | (chunk.sourceChunkY >> 3);
                    if (!seen.has(regionId)) {
                        seen.add(regionId);
                        xteas.push(CachePipeline.getXtea(regionId));
                    }
                }
            }
        }
        return { palette, xteas };
    }

    public encodeScene(centerChunkX: number, centerChunkY: number): Buffer {
        const { palette, xteas } = this.buildScenePalette(centerChunkX, centerChunkY);
        return encodeRebuildRegion(centerChunkX, centerChunkY, true, palette, xteas);
    }

    // ------------------------------------------------------------------ collision

    /** The instance and a ring of tiles around it: nothing walks out of an instance. */
    public override hasClip(location: Location): boolean {
        const x = location.getX() - this.getBaseX();
        const y = location.getY() - this.getBaseY();
        const z = location.getZ();
        return x >= -1 && y >= -1 && z >= 0 && z < PLANES && x <= this.widthChunks * 8 && y <= this.heightChunks * 8;
    }

    public override getClip(location: Location): number {
        if (!this.contains(location)) return UNMAPPED_TILE;
        return this.collision()[this.tileIndex(location.getX(), location.getY(), location.getZ())];
    }

    public override setClip(location: Location, mask: number): void {
        if (!this.contains(location)) return;
        this.collision()[this.tileIndex(location.getX(), location.getY(), location.getZ())] = mask | 0;
    }

    public override removeClip(location: Location): void {
        this.setClip(location, 0);
    }

    // ------------------------------------------------------------------ locs

    /** The template loc of a type on a tile, as the client draws it there. */
    public getTemplateObject(location: Location, type: number): GameObject | null {
        const loc = this.locsAt(location).find((entry) => entry.type === type);
        return loc ? this.objectFor(loc) : null;
    }

    /** Every template loc on a tile. */
    public getTemplateObjects(location: Location): GameObject[] {
        return this.locsAt(location).map((loc) => this.objectFor(loc));
    }

    public override resolveObject(id: number, location: Location): GameObject | null {
        const loc = this.locsAt(location).find((entry) => entry.id === id);
        return loc ? this.objectFor(loc) : null;
    }

    /** All template locs (with an id) on a plane of a chunk, e.g. to find a room's spawn spots. */
    public getChunkObjects(plane: number, chunkX: number, chunkY: number): GameObject[] {
        this.collision();
        const objects: GameObject[] = [];
        const minX = this.getBaseX() + chunkX * 8;
        const minY = this.getBaseY() + chunkY * 8;
        for (let x = minX; x < minX + 8; x++) {
            for (let y = minY; y < minY + 8; y++) {
                objects.push(...this.getTemplateObjects(new Location(x, y, plane)));
            }
        }
        return objects;
    }

    public override destroy(): void {
        if (this.isDestroyed()) return;
        usedSlots[this.slot] = false;
        this.clipGrid = null;
        this.locIndex.clear();
        super.destroy();
    }

    // ------------------------------------------------------------------ internals

    private invalidate(): void {
        this.clipGrid = null;
        this.sceneVersion++;
    }

    private locsAt(location: Location): PlacedLoc[] {
        if (!this.contains(location)) return [];
        this.collision();
        return this.locIndex.get(this.tileIndex(location.getX(), location.getY(), location.getZ())) ?? [];
    }

    private objectFor(loc: PlacedLoc): GameObject {
        if (!loc.object) {
            loc.object = new GameObject(loc.id, new Location(loc.x, loc.y, loc.z), loc.type, loc.face, this);
            // Template locs belong to the scene, not to the area's spawned entities.
            this.detach(loc.object);
        }
        return loc.object;
    }

    private inGrid(plane: number, chunkX: number, chunkY: number): boolean {
        return plane >= 0 && plane < PLANES && chunkX >= 0 && chunkY >= 0
            && chunkX < this.widthChunks && chunkY < this.heightChunks;
    }

    private chunkIndex(plane: number, chunkX: number, chunkY: number): number {
        return (plane * this.widthChunks + chunkX) * this.heightChunks + chunkY;
    }

    private tileIndex(x: number, y: number, z: number): number {
        const width = this.widthChunks * 8;
        const height = this.heightChunks * 8;
        return (z * width + (x - this.getBaseX())) * height + (y - this.getBaseY());
    }

    /** The collision grid, rebuilt from the templates after any chunk changed. */
    private collision(): Int32Array {
        if (this.clipGrid) return this.clipGrid;
        const width = this.widthChunks * 8;
        const height = this.heightChunks * 8;
        const grid = new Int32Array(PLANES * width * height);
        this.clipGrid = grid;
        this.locIndex = new Map();

        const settings = new Uint8Array(grid.length);
        for (let plane = 0; plane < PLANES; plane++) {
            for (let chunkX = 0; chunkX < this.widthChunks; chunkX++) {
                for (let chunkY = 0; chunkY < this.heightChunks; chunkY++) {
                    this.copyChunkSettings(settings, plane, chunkX, chunkY);
                }
            }
        }
        const bridge = (x: number, y: number) =>
            (settings[this.tileIndex(x, y, 1)] & SETTING_BRIDGE) === SETTING_BRIDGE;

        for (let plane = 0; plane < PLANES; plane++) {
            for (let x = this.getBaseX(); x < this.getBaseX() + width; x++) {
                for (let y = this.getBaseY(); y < this.getBaseY() + height; y++) {
                    const index = this.tileIndex(x, y, plane);
                    if (!this.getChunk(plane, (x - this.getBaseX()) >> 3, (y - this.getBaseY()) >> 3)) {
                        grid[index] |= UNMAPPED_TILE;
                        continue;
                    }
                    if ((settings[index] & SETTING_BLOCKED) === 0) continue;
                    const level = bridge(x, y) ? plane - 1 : plane;
                    if (level >= 0) grid[this.tileIndex(x, y, level)] |= BLOCKED_TILE;
                }
            }
        }

        for (let plane = 0; plane < PLANES; plane++) {
            for (let chunkX = 0; chunkX < this.widthChunks; chunkX++) {
                for (let chunkY = 0; chunkY < this.heightChunks; chunkY++) {
                    this.placeChunkLocs(plane, chunkX, chunkY, bridge);
                }
            }
        }
        for (const locs of this.locIndex.values()) {
            for (const loc of locs) RegionManager.addObjectClipping(this.objectFor(loc));
        }
        // Spawned locs (resources, doors swapped at runtime) keep their collision.
        for (const object of this.getObjects()) RegionManager.addObjectClipping(object);
        return grid;
    }

    private copyChunkSettings(settings: Uint8Array, plane: number, chunkX: number, chunkY: number): void {
        const chunk = this.getChunk(plane, chunkX, chunkY);
        const region = chunk && getTemplateRegion(regionOf(chunk));
        if (!chunk || !region) return;
        const sourceX = (chunk.sourceChunkX & 7) * 8;
        const sourceY = (chunk.sourceChunkY & 7) * 8;
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                const [toX, toY] = rotateChunkTile(x, y, chunk.rotation);
                const value = region.settings[(chunk.sourcePlane << 12) | ((sourceX + x) << 6) | (sourceY + y)];
                settings[this.tileIndex(this.getBaseX() + chunkX * 8 + toX, this.getBaseY() + chunkY * 8 + toY, plane)] = value;
            }
        }
    }

    private placeChunkLocs(plane: number, chunkX: number, chunkY: number, bridge: (x: number, y: number) => boolean): void {
        const chunk = this.getChunk(plane, chunkX, chunkY);
        const region = chunk && getTemplateRegion(regionOf(chunk));
        if (!chunk || !region) return;
        const locs = region.chunks[templateChunkKey(chunk.sourcePlane, chunk.sourceChunkX, chunk.sourceChunkY)];
        for (const loc of locs) {
            const definition = ObjectDefinition.forId(loc.id);
            const [toX, toY] = rotateChunkLoc(loc.localX & 7, loc.localY & 7, chunk.rotation,
                definition?.getSizeX() ?? 1, definition?.getSizeY() ?? 1, loc.face);
            const x = this.getBaseX() + chunkX * 8 + toX;
            const y = this.getBaseY() + chunkY * 8 + toY;
            // As in the main world, a loc over a bridge sits (and collides) a plane lower.
            const z = this.contains(new Location(x, y, 1)) && bridge(x, y) ? plane - 1 : plane;
            if (z < 0 || !this.contains(new Location(x, y, z))) continue;
            const placed: PlacedLoc = { id: loc.id, x, y, z, type: loc.type, face: (loc.face + chunk.rotation) & 3 };
            const index = this.tileIndex(x, y, z);
            const list = this.locIndex.get(index);
            if (list) list.push(placed);
            else this.locIndex.set(index, [placed]);
        }
    }
}

function regionOf(chunk: TemplateChunk): number {
    return ((chunk.sourceChunkX >> 3) << 8) | (chunk.sourceChunkY >> 3);
}

/** A chunk's place in a turned square block, `last` being the block's size less one. */
function rotateSquare(x: number, y: number, last: number, rotation: number): [number, number] {
    switch (rotation & 3) {
        case 0: return [x, y];
        case 1: return [y, last - x];
        case 2: return [last - x, last - y];
        default: return [last - y, x];
    }
}
