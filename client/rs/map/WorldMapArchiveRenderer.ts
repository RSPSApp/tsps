import type { CacheIndex } from "../cache/CacheIndex";
import type { CacheSystem } from "../cache/CacheSystem";
import { IndexType } from "../cache/IndexType";
import { isGroupMissingError } from "../cache/js5/GroupMissingError";
import { retryOnMissingGroup } from "../cache/js5/retryOnMissingGroup";
import type { OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import type { LocType } from "../config/loctype/LocType";
import type { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import type { MapElementType } from "../config/meltype/MapElementType";
import type { MapElementTypeLoader } from "../config/meltype/MapElementTypeLoader";
import type { VarManager } from "../config/vartype/VarManager";
import type { TextureLoader } from "../texture/TextureLoader";
import { ByteBuffer } from "../io/ByteBuffer";
import type { IndexedSprite } from "../sprite/IndexedSprite";
import { HSL_RGB_MAP, adjustOverlayLight, packHsl } from "../util/ColorUtil";
import { WorldMapArea, compositeMapFileFor, worldMapGroupId } from "./WorldMapArea";

export type WorldMapRenderIcon = {
    localX: number;
    localY: number;
    elementId: number;
    category: number;
    spriteId: number;
    worldMapVisible?: boolean;
    name?: string;
    textColor?: number;
    textSize?: number;
    horizontalAlignment?: number;
    verticalAlignment?: number;
    sourcePlane?: number;
    sourceX?: number;
    sourceY?: number;
    displayPlane?: number;
    displayX?: number;
    displayY?: number;
};

export type WorldMapRenderedTile = {
    pixels: Uint8Array;
    width: number;
    height: number;
    icons: WorldMapRenderIcon[];
};

export type WorldMapArchiveRendererOptions = {
    cacheSystem: CacheSystem;
    locTypeLoader: LocTypeLoader;
    mapElementTypeLoader?: MapElementTypeLoader;
    overlayTypeLoader: OverlayFloorTypeLoader;
    textureLoader: TextureLoader;
    mapScenes: IndexedSprite[];
    varManager?: VarManager;
};

type WorldMapDecoration = {
    objectDefinitionId: number;
    decoration: number;
    rotation: number;
};

type WorldMapDataBase = {
    minPlane: number;
    planes: number;
    regionXLow: number;
    regionYLow: number;
    regionX: number;
    regionY: number;
    groupId: number;
    fileId: number;
    /** Rev 241 format: no geography reference in the composite map, no header in the file. */
    headerless?: boolean;
    floorUnderlayIds?: Uint16Array;
    floorOverlayIds?: Uint16Array[];
    overlayShapes?: Uint8Array[];
    overlayRotations?: Uint8Array[];
    decorations?: Array<Array<WorldMapDecoration[] | undefined>>;
    geographyLoaded: boolean;
};

type WorldMapData0Record = WorldMapDataBase & {
    kind: 0;
};

type WorldMapData1Record = WorldMapDataBase & {
    kind: 1;
    chunkXLow: number;
    chunkYLow: number;
    chunkX: number;
    chunkY: number;
};

type StaticWorldMapIcon = {
    elementId: number;
    x: number;
    y: number;
    plane: number;
};

type WorldMapRegionRecord = {
    regionX: number;
    regionY: number;
    data0?: WorldMapData0Record;
    data1: WorldMapData1Record[];
    staticIcons: WorldMapRenderIcon[];
    dynamicIcons: WorldMapRenderIcon[];
    geographyLoaded: boolean;
};

type WorldMapAreaDataRecord = {
    area: WorldMapArea;
    data0: WorldMapData0Record[];
    data1: WorldMapData1Record[];
    staticIcons: StaticWorldMapIcon[];
    regions: Map<number, WorldMapRegionRecord>;
};

const WORLD_MAP_DATA0 = 0;
const WORLD_MAP_DATA1 = 1;
const WORLD_MAP_GEOGRAPHY0 = 0;
const WORLD_MAP_GEOGRAPHY1 = 1;
const TILE_COUNT = 64;
const TILE_AREA = TILE_COUNT * TILE_COUNT;
const WALL_LINE_DARK = 0xcc0000;
const WALL_LINE_LIGHT = 0xcccccc;

function getRegionKey(regionX: number, regionY: number): number {
    return ((regionX & 0xffff) << 16) | (regionY & 0xffff);
}

function getTileIndex(tileX: number, tileY: number): number {
    return ((tileX & 63) << 6) | (tileY & 63);
}

/**
 * Rev 241 dropped each entry's geography reference: the geography and ground indexes are keyed
 * by region, `(regionX << 8) | regionY`, with one file per map area that shows the region (its
 * whole grid, as that area draws it).
 */
function geographyRef<T extends WorldMapDataBase>(record: T, buffer: ByteBuffer, withRefs: boolean, areaId: number): T {
    if (withRefs) {
        record.groupId = buffer.readBigSmart();
        record.fileId = buffer.readBigSmart();
    } else {
        record.groupId = ((record.regionX & 0xff) << 8) | (record.regionY & 0xff);
        record.fileId = areaId;
        record.headerless = true;
    }
    return record;
}

function readWorldMapData0(buffer: ByteBuffer, withRefs = true, areaId = 0): WorldMapData0Record {
    const marker = buffer.readUnsignedByte();
    if (marker !== WORLD_MAP_DATA0) {
        throw new Error(`Invalid world map data0 marker ${marker}`);
    }
    const record: WorldMapData0Record = {
        kind: 0,
        minPlane: buffer.readUnsignedByte(),
        planes: buffer.readUnsignedByte(),
        regionXLow: buffer.readUnsignedShort(),
        regionYLow: buffer.readUnsignedShort(),
        regionX: buffer.readUnsignedShort(),
        regionY: buffer.readUnsignedShort(),
        groupId: -1,
        fileId: -1,
        geographyLoaded: false,
    };
    return geographyRef(record, buffer, withRefs, areaId);
}

function readWorldMapData1(buffer: ByteBuffer, withRefs = true, areaId = 0): WorldMapData1Record {
    const marker = buffer.readUnsignedByte();
    if (marker !== WORLD_MAP_DATA1) {
        throw new Error(`Invalid world map data1 marker ${marker}`);
    }
    const record: WorldMapData1Record = {
        kind: 1,
        minPlane: buffer.readUnsignedByte(),
        planes: buffer.readUnsignedByte(),
        regionXLow: buffer.readUnsignedShort(),
        regionYLow: buffer.readUnsignedShort(),
        chunkXLow: buffer.readUnsignedByte(),
        chunkYLow: buffer.readUnsignedByte(),
        regionX: buffer.readUnsignedShort(),
        regionY: buffer.readUnsignedShort(),
        chunkX: buffer.readUnsignedByte(),
        chunkY: buffer.readUnsignedByte(),
        groupId: -1,
        fileId: -1,
        geographyLoaded: false,
    };
    return geographyRef(record, buffer, withRefs, areaId);
}

/** A composite map, in whichever format it is (rev 241 dropped the geography references). */
function readCompositeMap(data: Int8Array, includeHiddenIcons: boolean, areaId = 0) {
    try {
        return readCompositeMapAs(data, includeHiddenIcons, true, areaId);
    } catch {
        return readCompositeMapAs(data, includeHiddenIcons, false, areaId);
    }
}

function readCompositeMapAs(data: Int8Array, includeHiddenIcons: boolean, withRefs: boolean, areaId: number) {
    const buffer = new ByteBuffer(data);
    const data0: WorldMapData0Record[] = [];
    const data1: WorldMapData1Record[] = [];
    const icons: StaticWorldMapIcon[] = [];

    const data0Count = buffer.readUnsignedShort();
    for (let i = 0; i < data0Count; i++) {
        data0.push(readWorldMapData0(buffer, withRefs, areaId));
    }

    const data1Count = buffer.readUnsignedShort();
    for (let i = 0; i < data1Count; i++) {
        data1.push(readWorldMapData1(buffer, withRefs, areaId));
    }

    const iconCount = buffer.readUnsignedShort();
    for (let i = 0; i < iconCount; i++) {
        const elementId = buffer.readBigSmart();
        const packedCoord = buffer.readInt();
        const hidden = buffer.readUnsignedByte() === 1;
        if (!includeHiddenIcons && hidden) continue;
        icons.push({
            elementId,
            plane: (packedCoord >>> 28) & 3,
            x: (packedCoord >>> 14) & 0x3fff,
            y: packedCoord & 0x3fff,
        });
    }
    if (buffer.offset !== data.length) {
        throw new Error("World map composite map: format mismatch");
    }

    return { data0, data1, icons };
}

function createWorldMapDataArrays(data: WorldMapDataBase): void {
    const planes = Math.max(1, Math.min(data.planes | 0, 4));
    data.planes = planes;
    data.floorUnderlayIds = new Uint16Array(TILE_AREA);
    data.floorOverlayIds = Array.from({ length: planes }, () => new Uint16Array(TILE_AREA));
    data.overlayShapes = Array.from({ length: planes }, () => new Uint8Array(TILE_AREA));
    data.overlayRotations = Array.from({ length: planes }, () => new Uint8Array(TILE_AREA));
    data.decorations = Array.from({ length: planes }, () => new Array<WorldMapDecoration[] | undefined>(TILE_AREA));
}

function readTile(data: WorldMapDataBase, tileX: number, tileY: number, buffer: ByteBuffer): void {
    const flags = buffer.readUnsignedByte();
    if (flags === 0) return;
    if ((flags & 1) !== 0) {
        readSimpleTile(data, tileX, tileY, buffer, flags);
    } else {
        readComplexTile(data, tileX, tileY, buffer, flags);
    }
}

function readSimpleTile(
    data: WorldMapDataBase,
    tileX: number,
    tileY: number,
    buffer: ByteBuffer,
    flags: number,
): void {
    const index = getTileIndex(tileX, tileY);
    if ((flags & 2) !== 0) {
        data.floorOverlayIds![0][index] = buffer.readUnsignedShort();
    }
    data.floorUnderlayIds![index] = buffer.readUnsignedShort();
}

function readComplexTile(
    data: WorldMapDataBase,
    tileX: number,
    tileY: number,
    buffer: ByteBuffer,
    flags: number,
): void {
    const index = getTileIndex(tileX, tileY);
    const planesToRead = ((flags & 24) >> 3) + 1;
    const hasOverlays = (flags & 2) !== 0;
    const hasDecorations = (flags & 4) !== 0;
    data.floorUnderlayIds![index] = buffer.readUnsignedShort();

    if (hasOverlays) {
        const overlayCount = buffer.readUnsignedByte();
        for (let plane = 0; plane < overlayCount; plane++) {
            const overlayId = buffer.readUnsignedShort();
            if (overlayId !== 0) {
                const overlayInfo = buffer.readUnsignedByte();
                if (plane < data.planes) {
                    data.floorOverlayIds![plane][index] = overlayId;
                    data.overlayShapes![plane][index] = overlayInfo >> 2;
                    data.overlayRotations![plane][index] = overlayInfo & 3;
                }
            }
        }
    }

    if (hasDecorations) {
        const limitedPlanes = Math.min(planesToRead, data.planes);
        for (let plane = 0; plane < planesToRead; plane++) {
            const decorationCount = buffer.readUnsignedByte();
            if (decorationCount === 0) continue;
            const decorations: WorldMapDecoration[] = [];
            for (let i = 0; i < decorationCount; i++) {
                // Rev 241 writes the loc id as a plain int; before, as a large smart.
                const objectDefinitionId = data.headerless ? buffer.readInt() : buffer.readBigSmart();
                const decorationInfo = buffer.readUnsignedByte();
                decorations.push({
                    objectDefinitionId,
                    decoration: decorationInfo >> 2,
                    rotation: decorationInfo & 3,
                });
            }
            if (plane < limitedPlanes) {
                data.decorations![plane][index] = decorations;
            }
        }
    }
}

/** Rev 241 geography for a whole region: no header, then its 64x64 tiles. */
function decodeHeaderlessGeography(data: WorldMapDataBase, bytes: Int8Array): void {
    const buffer = new ByteBuffer(bytes);
    createWorldMapDataArrays(data);
    for (let tileX = 0; tileX < TILE_COUNT; tileX++) {
        for (let tileY = 0; tileY < TILE_COUNT; tileY++) {
            readTile(data, tileX, tileY, buffer);
        }
    }
    if (buffer.offset !== bytes.length) {
        throw new Error(`World map geography ${data.regionX},${data.regionY}: ${bytes.length - buffer.offset} bytes left`);
    }
    data.geographyLoaded = true;
}

function decodeWorldMapData0Geography(data: WorldMapData0Record, bytes: Int8Array): void {
    if (data.headerless) return decodeHeaderlessGeography(data, bytes);
    const buffer = new ByteBuffer(bytes);
    createWorldMapDataArrays(data);
    const marker = buffer.readUnsignedByte();
    if (marker !== WORLD_MAP_GEOGRAPHY0) {
        throw new Error(`Invalid world map geography0 marker ${marker}`);
    }
    const regionX = buffer.readUnsignedByte();
    const regionY = buffer.readUnsignedByte();
    if (regionX !== data.regionX || regionY !== data.regionY) {
        throw new Error(`World map geography0 region mismatch ${regionX},${regionY}`);
    }
    for (let tileX = 0; tileX < TILE_COUNT; tileX++) {
        for (let tileY = 0; tileY < TILE_COUNT; tileY++) {
            readTile(data, tileX, tileY, buffer);
        }
    }
    data.geographyLoaded = true;
}

function decodeWorldMapData1Geography(data: WorldMapData1Record, bytes: Int8Array): void {
    if (data.headerless) return decodeHeaderlessGeography(data, bytes);
    const buffer = new ByteBuffer(bytes);
    createWorldMapDataArrays(data);
    const marker = buffer.readUnsignedByte();
    if (marker !== WORLD_MAP_GEOGRAPHY1) {
        throw new Error(`Invalid world map geography1 marker ${marker}`);
    }
    const regionX = buffer.readUnsignedByte();
    const regionY = buffer.readUnsignedByte();
    const chunkX = buffer.readUnsignedByte();
    const chunkY = buffer.readUnsignedByte();
    if (
        regionX !== data.regionX ||
        regionY !== data.regionY ||
        chunkX !== data.chunkX ||
        chunkY !== data.chunkY
    ) {
        throw new Error(`World map geography1 region mismatch ${regionX},${regionY},${chunkX},${chunkY}`);
    }
    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
            readTile(data, x + data.chunkX * 8, y + data.chunkY * 8, buffer);
        }
    }
    data.geographyLoaded = true;
}

/**
 * Rev 241: a region of chunks is one file per map area, holding only the chunks that area has
 * entries for, chunk by chunk (x, then y), each chunk's 8x8 tiles read with its own planes.
 */
function decodeHeaderlessChunkRegion(entries: WorldMapData1Record[], bytes: Int8Array): void {
    const buffer = new ByteBuffer(bytes);
    const byChunk = new Map<number, WorldMapData1Record>();
    for (const entry of entries) {
        createWorldMapDataArrays(entry);
        byChunk.set((entry.chunkX << 3) | entry.chunkY, entry);
    }
    for (let chunkX = 0; chunkX < 8; chunkX++) {
        for (let chunkY = 0; chunkY < 8; chunkY++) {
            const entry = byChunk.get((chunkX << 3) | chunkY);
            if (!entry) continue;
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    readTile(entry, chunkX * 8 + x, chunkY * 8 + y, buffer);
                }
            }
        }
    }
    if (buffer.offset !== bytes.length) {
        throw new Error(`World map geography ${entries[0]?.regionX},${entries[0]?.regionY}: format mismatch`);
    }
    for (const entry of entries) entry.geographyLoaded = true;
}

class WorldMapScaleHandler {
    readonly tileTemplates: Int8Array[][] = Array.from({ length: 8 }, () => new Array<Int8Array>(4));

    constructor(readonly pixelsPerTile: number) {
        this.initTemplates();
    }

    getTemplate(shape: number, rotation: number): Int8Array | undefined {
        const originalShape = shape | 0;
        if (shape === 9) rotation = (rotation + 1) & 3;
        if (shape === 10 || shape === 11) rotation = (rotation + 3) & 3;
        if (originalShape === 9 || originalShape === 10) shape = 1;
        else if (originalShape === 11) shape = 8;
        if (shape < 1 || shape > 8) return undefined;
        return this.tileTemplates[shape - 1][rotation & 3];
    }

    private make(fill: (row: number, col: number) => boolean): Int8Array {
        const template = new Int8Array(this.pixelsPerTile * this.pixelsPerTile);
        let index = 0;
        for (let row = 0; row < this.pixelsPerTile; row++) {
            for (let col = 0; col < this.pixelsPerTile; col++) {
                if (fill(row, col)) template[index] = -1;
                index++;
            }
        }
        return template;
    }

    private makeWithOrder(
        rows: number[],
        cols: number[],
        fill: (sourceRow: number, sourceCol: number) => boolean,
    ): Int8Array {
        const template = new Int8Array(this.pixelsPerTile * this.pixelsPerTile);
        let index = 0;
        for (const row of rows) {
            for (const col of cols) {
                if (fill(row, col)) template[index] = -1;
                index++;
            }
        }
        return template;
    }

    private initTemplates(): void {
        const n = this.pixelsPerTile;
        const asc = Array.from({ length: n }, (_, i) => i);
        const desc = Array.from({ length: n }, (_, i) => n - 1 - i);

        this.tileTemplates[0][0] = this.make((row, col) => col <= row);
        this.tileTemplates[0][1] = this.makeWithOrder(desc, asc, (row, col) => col <= row);
        this.tileTemplates[0][2] = this.make((row, col) => col >= row);
        this.tileTemplates[0][3] = this.makeWithOrder(desc, asc, (row, col) => col >= row);

        this.tileTemplates[1][0] = this.makeWithOrder(desc, asc, (row, col) => col <= (row >> 1));
        this.tileTemplates[1][1] = this.make((row, col) => col >= (row << 1));
        this.tileTemplates[1][2] = this.makeWithOrder(asc, desc, (row, col) => col <= (row >> 1));
        this.tileTemplates[1][3] = this.makeWithOrder(desc, desc, (row, col) => col >= (row << 1));

        this.tileTemplates[2][0] = this.makeWithOrder(desc, desc, (row, col) => col <= (row >> 1));
        this.tileTemplates[2][1] = this.makeWithOrder(desc, asc, (row, col) => col >= (row << 1));
        this.tileTemplates[2][2] = this.make((row, col) => col <= (row >> 1));
        this.tileTemplates[2][3] = this.makeWithOrder(asc, desc, (row, col) => col >= (row << 1));

        this.tileTemplates[3][0] = this.makeWithOrder(desc, asc, (row, col) => col >= (row >> 1));
        this.tileTemplates[3][1] = this.make((row, col) => col <= (row << 1));
        this.tileTemplates[3][2] = this.makeWithOrder(asc, desc, (row, col) => col >= (row >> 1));
        this.tileTemplates[3][3] = this.makeWithOrder(desc, desc, (row, col) => col <= (row << 1));

        this.tileTemplates[4][0] = this.makeWithOrder(desc, desc, (row, col) => col >= (row >> 1));
        this.tileTemplates[4][1] = this.makeWithOrder(desc, asc, (row, col) => col <= (row << 1));
        this.tileTemplates[4][2] = this.make((row, col) => col >= (row >> 1));
        this.tileTemplates[4][3] = this.makeWithOrder(asc, desc, (row, col) => col <= (row << 1));

        this.tileTemplates[5][0] = this.make((_row, col) => col <= ((n / 2) | 0));
        this.tileTemplates[5][1] = this.make((row) => row <= ((n / 2) | 0));
        this.tileTemplates[5][2] = this.make((_row, col) => col >= ((n / 2) | 0));
        this.tileTemplates[5][3] = this.make((row) => row >= ((n / 2) | 0));

        this.tileTemplates[6][0] = this.make((row, col) => col <= row - ((n / 2) | 0));
        this.tileTemplates[6][1] = this.makeWithOrder(desc, asc, (row, col) => col <= row - ((n / 2) | 0));
        this.tileTemplates[6][2] = this.makeWithOrder(desc, desc, (row, col) => col <= row - ((n / 2) | 0));
        this.tileTemplates[6][3] = this.makeWithOrder(asc, desc, (row, col) => col <= row - ((n / 2) | 0));

        this.tileTemplates[7][0] = this.make((row, col) => col >= row - ((n / 2) | 0));
        this.tileTemplates[7][1] = this.makeWithOrder(desc, asc, (row, col) => col >= row - ((n / 2) | 0));
        this.tileTemplates[7][2] = this.makeWithOrder(desc, desc, (row, col) => col >= row - ((n / 2) | 0));
        this.tileTemplates[7][3] = this.makeWithOrder(asc, desc, (row, col) => col >= row - ((n / 2) | 0));
    }
}

export class WorldMapArchiveRenderer {
    private readonly worldMapIndex: CacheIndex;
    private readonly geographyIndex: CacheIndex;
    private readonly groundIndex: CacheIndex;
    private readonly areaCache = new Map<number, WorldMapAreaDataRecord | undefined>();
    private readonly groundSpriteCache = new Map<string, Promise<Int32Array>>();
    private readonly scaleHandlers = new Map<number, WorldMapScaleHandler>();
    private readonly renderedRegionCache = new Map<string, WorldMapRenderedTile>();
    private renderedRegionCacheBytes = 0;

    private readonly maxRenderedRegionBytes = 48 * 1024 * 1024;

    constructor(private readonly options: WorldMapArchiveRendererOptions) {
        this.worldMapIndex = options.cacheSystem.getIndex(IndexType.OSRS.worldMap);
        this.geographyIndex = options.cacheSystem.getIndex(IndexType.OSRS.worldMapGeography);
        this.groundIndex = options.cacheSystem.getIndex(IndexType.OSRS.worldMapGround);
    }

    clear(): void {
        this.areaCache.clear();
        this.groundSpriteCache.clear();
        this.scaleHandlers.clear();
        this.renderedRegionCache.clear();
        this.renderedRegionCacheBytes = 0;
    }

    async loadTile(
        area: WorldMapArea | undefined,
        mapX: number,
        mapY: number,
        pixelsPerTile: number,
    ): Promise<WorldMapRenderedTile | undefined> {
        if (!area) {
            return undefined;
        }
        const clampedPixelsPerTile = Math.max(1, Math.min(8, Math.ceil(pixelsPerTile || 1)));
        const areaData = this.getAreaData(area);
        if (!areaData) {
            return undefined;
        }
        const region = this.getRegion(areaData, mapX | 0, mapY | 0);
        if (!region) {
            return undefined;
        }
        if (!region.data0 && region.data1.length === 0) {
            return undefined;
        }

        const cacheKey = `${areaData.area.id}:${mapX | 0}:${mapY | 0}:${clampedPixelsPerTile}`;
        const cached = this.renderedRegionCache.get(cacheKey);
        if (cached) {
            this.renderedRegionCache.delete(cacheKey);
            this.renderedRegionCache.set(cacheKey, cached);
            return cached;
        }

        if (!this.loadGeography(region)) {
            return undefined;
        }
        const width = clampedPixelsPerTile * TILE_COUNT;
        const height = width;
        const rgbPixels = new Int32Array(width * height);
        const source = region.data0 ?? region.data1[0];
        // Rev 241 keeps one ground image per map area in the region's group; before, file 0.
        const groundColors = await this.getGroundColors(source?.groupId ?? -1, source?.headerless ? source.fileId : 0);
        const scaleHandler = this.getScaleHandler(clampedPixelsPerTile);

        if (region.data0) {
            this.drawMapData0(rgbPixels, width, region.data0, scaleHandler, groundColors, areaData.area.backgroundColor);
        } else {
            this.drawMapData1(rgbPixels, width, region.data1, scaleHandler, groundColors, areaData.area.backgroundColor);
        }

        const pixels = this.convertRgbToRgba(rgbPixels);
        const tile = {
            pixels,
            width,
            height,
            icons: region.dynamicIcons,
        };
        this.setRenderedRegionCache(cacheKey, tile);
        return tile;
    }

    getIcons(area: WorldMapArea | undefined, mapX: number, mapY: number): WorldMapRenderIcon[] | undefined {
        if (!area) return undefined;
        const areaData = this.getAreaData(area);
        if (!areaData) return undefined;
        const region = this.getRegion(areaData, mapX | 0, mapY | 0);
        if (!region) return undefined;
        if ((region.data0 || region.data1.length > 0) && !region.geographyLoaded) {
            this.loadGeography(region);
        }
        const icons = region.staticIcons.concat(region.dynamicIcons);
        return icons.length > 0 ? icons : undefined;
    }

    private getAreaData(area: WorldMapArea): WorldMapAreaDataRecord | undefined {
        if (this.areaCache.has(area.id)) return this.areaCache.get(area.id);
        let result: WorldMapAreaDataRecord | undefined;
        try {
            const compositeMapArchiveId = worldMapGroupId(this.worldMapIndex, "compositemap");
            if (compositeMapArchiveId < 0) {
                this.areaCache.set(area.id, undefined);
                return undefined;
            }
            const compositeMapArchive = this.worldMapIndex.getArchive(compositeMapArchiveId);
            const compositeMapFile = compositeMapFileFor(compositeMapArchive, area);
            if (!compositeMapFile) {
                this.areaCache.set(area.id, undefined);
                return undefined;
            }
            const composite = readCompositeMap(compositeMapFile.data, true, area.id);
            result = {
                area,
                data0: composite.data0,
                data1: composite.data1,
                staticIcons: composite.icons,
                regions: new Map(),
            };
        } catch (error) {
            console.log("[WorldMapArchiveRenderer] Failed to load area data", {
                areaId: area.id,
                internalName: area.internalName,
                error,
            });
            result = undefined;
        }
        this.areaCache.set(area.id, result);
        return result;
    }

    private getRegion(areaData: WorldMapAreaDataRecord, regionX: number, regionY: number): WorldMapRegionRecord | undefined {
        if (
            regionX < areaData.area.regionLowX ||
            regionX > areaData.area.regionHighX ||
            regionY < areaData.area.regionLowY ||
            regionY > areaData.area.regionHighY
        ) {
            return undefined;
        }
        const key = getRegionKey(regionX, regionY);
        let region = areaData.regions.get(key);
        if (region) return region;

        const data0 = areaData.data0.find((entry) => entry.regionX === regionX && entry.regionY === regionY);
        const data1 = areaData.data1.filter((entry) => entry.regionX === regionX && entry.regionY === regionY);
        region = {
            regionX,
            regionY,
            data0,
            data1,
            staticIcons: this.getStaticIconsForRegion(areaData, regionX, regionY),
            dynamicIcons: [],
            geographyLoaded: false,
        };
        areaData.regions.set(key, region);
        return region;
    }

    private getStaticIconsForRegion(areaData: WorldMapAreaDataRecord, regionX: number, regionY: number): WorldMapRenderIcon[] {
        const icons: WorldMapRenderIcon[] = [];
        for (const icon of areaData.staticIcons) {
            if ((icon.x >> 6) !== regionX || (icon.y >> 6) !== regionY) continue;
            const metadata = this.loadMapElement(icon.elementId);
            if (metadata?.worldMapVisible === false) continue;
            icons.push({
                localX: icon.x & 63,
                localY: icon.y & 63,
                elementId: icon.elementId,
                category: (metadata?.category ?? -1) | 0,
                spriteId: (metadata?.spriteId ?? -1) | 0,
                worldMapVisible: metadata?.worldMapVisible,
                name: metadata?.name,
                textColor: metadata?.textColor,
                textSize: metadata?.textSize,
                horizontalAlignment: metadata?.horizontalAlignment,
                verticalAlignment: metadata?.verticalAlignment,
                sourcePlane: icon.plane,
                sourceX: icon.x,
                sourceY: icon.y,
                displayPlane: icon.plane,
                displayX: icon.x,
                displayY: icon.y,
            });
        }
        return icons;
    }

    private loadGeography(region: WorldMapRegionRecord): boolean {
        if (region.geographyLoaded) return true;
        region.dynamicIcons = [];
        if (region.data0) {
            if (!this.loadWorldMapDataGeography(region.data0)) return false;
            this.buildIcons(region, region.data0, 0, 0, 64, 64);
            region.geographyLoaded = true;
            return true;
        }

        if (region.data1[0]?.headerless) {
            if (!this.loadChunkRegionGeography(region.data1)) return false;
        } else {
            for (const data of region.data1) {
                if (!this.loadWorldMapDataGeography(data)) return false;
            }
        }
        for (const data of region.data1) {
            this.buildIcons(region, data, data.chunkX * 8, data.chunkY * 8, 8, 8);
        }
        region.geographyLoaded = true;
        return true;
    }

    /** Rev 241: all of a region's chunk entries come from one file. */
    private loadChunkRegionGeography(entries: WorldMapData1Record[]): boolean {
        if (entries.every((entry) => entry.geographyLoaded)) return true;
        try {
            const file = this.geographyIndex.getFile(entries[0].groupId, entries[0].fileId);
            if (!file) return false;
            decodeHeaderlessChunkRegion(entries, file.data);
            return true;
        } catch (error) {
            console.warn("[WorldMap] chunk region geography", entries[0].regionX, entries[0].regionY, error);
            return false;
        }
    }

    private loadWorldMapDataGeography(data: WorldMapData0Record | WorldMapData1Record): boolean {
        if (data.geographyLoaded) return true;
        try {
            const file = this.geographyIndex.getFile(data.groupId, data.fileId);
            if (!file) return false;
            if (data.kind === 0) {
                decodeWorldMapData0Geography(data, file.data);
            } else {
                decodeWorldMapData1Geography(data, file.data);
            }
            return true;
        } catch (error) {
            // Missing groups are queued for on-demand fetch and this is
            // retried on the next render, so only log real failures.
            if (!isGroupMissingError(error)) {
                console.log("[WorldMapArchiveRenderer] Failed to load geography", {
                    groupId: data.groupId,
                    fileId: data.fileId,
                    error,
                });
            }
            return false;
        }
    }

    private buildIcons(
        region: WorldMapRegionRecord,
        data: WorldMapData0Record | WorldMapData1Record,
        startX: number,
        startY: number,
        width: number,
        height: number,
    ): void {
        for (let tileX = startX; tileX < startX + width; tileX++) {
            tileLoop: for (let tileY = startY; tileY < startY + height; tileY++) {
                const index = getTileIndex(tileX, tileY);
                for (let plane = 0; plane < data.planes; plane++) {
                    const decorations = data.decorations?.[plane]?.[index];
                    if (!decorations || decorations.length === 0) continue;
                    for (const decoration of decorations) {
                        const locType = this.options.locTypeLoader.load(decoration.objectDefinitionId);
                        const mapIconId = this.resolveMapIconId(locType);
                        if (mapIconId === -1) continue;
                        const icon = this.createLocIcon(region, data, mapIconId, plane, tileX, tileY);
                        if (icon) region.dynamicIcons.push(icon);
                        continue tileLoop;
                    }
                }
            }
        }
    }

    private resolveMapIconId(locType: LocType): number {
        if (locType.transforms) {
            const transformed = this.options.varManager ? locType.transform(this.options.varManager, this.options.locTypeLoader) : undefined;
            if (transformed && transformed.mapFunctionId !== -1) return transformed.mapFunctionId | 0;
            for (const transformId of locType.transforms) {
                if ((transformId | 0) === -1) continue;
                const candidate = this.options.locTypeLoader.load(transformId | 0);
                if (candidate.mapFunctionId !== -1) return candidate.mapFunctionId | 0;
            }
            return -1;
        }
        return locType.mapFunctionId | 0;
    }

    private createLocIcon(
        region: WorldMapRegionRecord,
        data: WorldMapData0Record | WorldMapData1Record,
        elementId: number,
        plane: number,
        tileX: number,
        tileY: number,
    ): WorldMapRenderIcon | undefined {
        const metadata = this.loadMapElement(elementId);
        if (metadata?.worldMapVisible === false) return undefined;
        let sourceX: number;
        let sourceY: number;
        const sourcePlane = plane + data.minPlane;
        if (data.kind === 0) {
            sourceX = tileX + data.regionXLow * 64;
            sourceY = tileY + data.regionYLow * 64;
        } else {
            sourceX = data.regionXLow * 64 + tileX + data.chunkXLow * 8;
            sourceY = data.regionYLow * 64 + tileY + data.chunkYLow * 8;
        }
        return {
            localX: tileX & 63,
            localY: tileY & 63,
            elementId,
            category: (metadata?.category ?? -1) | 0,
            spriteId: (metadata?.spriteId ?? -1) | 0,
            worldMapVisible: metadata?.worldMapVisible,
            name: metadata?.name,
            textColor: metadata?.textColor,
            textSize: metadata?.textSize,
            horizontalAlignment: metadata?.horizontalAlignment,
            verticalAlignment: metadata?.verticalAlignment,
            sourcePlane,
            sourceX,
            sourceY,
            displayPlane: plane,
            displayX: region.regionX * 64 + tileX,
            displayY: region.regionY * 64 + tileY,
        };
    }

    private drawMapData0(
        pixels: Int32Array,
        width: number,
        data: WorldMapData0Record,
        scaleHandler: WorldMapScaleHandler,
        groundColors: Int32Array,
        backgroundColor: number,
    ): void {
        for (let tileX = 0; tileX < 64; tileX++) {
            for (let tileY = 0; tileY < 64; tileY++) {
                this.drawTileGround(pixels, width, tileX, tileY, data, scaleHandler, groundColors, backgroundColor);
                this.drawTileOverlays(pixels, width, tileX, tileY, data, scaleHandler, backgroundColor);
            }
        }
        for (let tileX = 0; tileX < 64; tileX++) {
            for (let tileY = 0; tileY < 64; tileY++) {
                this.drawTileDecorations(pixels, width, tileX, tileY, data);
            }
        }
    }

    private drawMapData1(
        pixels: Int32Array,
        width: number,
        dataList: WorldMapData1Record[],
        scaleHandler: WorldMapScaleHandler,
        groundColors: Int32Array,
        backgroundColor: number,
    ): void {
        for (const data of dataList) {
            for (let tileX = data.chunkX * 8; tileX < data.chunkX * 8 + 8; tileX++) {
                for (let tileY = data.chunkY * 8; tileY < data.chunkY * 8 + 8; tileY++) {
                    this.drawTileGround(pixels, width, tileX, tileY, data, scaleHandler, groundColors, backgroundColor);
                    this.drawTileOverlays(pixels, width, tileX, tileY, data, scaleHandler, backgroundColor);
                }
            }
        }
        for (const data of dataList) {
            for (let tileX = data.chunkX * 8; tileX < data.chunkX * 8 + 8; tileX++) {
                for (let tileY = data.chunkY * 8; tileY < data.chunkY * 8 + 8; tileY++) {
                    this.drawTileDecorations(pixels, width, tileX, tileY, data);
                }
            }
        }
    }

    private drawTileGround(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        data: WorldMapDataBase,
        scaleHandler: WorldMapScaleHandler,
        groundColors: Int32Array,
        backgroundColor: number,
    ): void {
        const index = getTileIndex(tileX, tileY);
        const underlayId = (data.floorUnderlayIds?.[index] ?? 0) - 1;
        const overlayId = (data.floorOverlayIds?.[0]?.[index] ?? 0) - 1;
        const x = tileX * scaleHandler.pixelsPerTile;
        const y = (63 - tileY) * scaleHandler.pixelsPerTile;
        if (underlayId === -1 && overlayId === -1) {
            this.fillTile(pixels, width, x, y, scaleHandler.pixelsPerTile, backgroundColor);
            return;
        }

        const overlayColor = overlayId !== -1 ? this.getFloorOverlayColor(overlayId, backgroundColor) : 0xff00ff;
        const shape = data.overlayShapes?.[0]?.[index] ?? 0;
        if (overlayId > -1 && shape === 0) {
            this.fillTile(pixels, width, x, y, scaleHandler.pixelsPerTile, overlayColor);
            return;
        }

        const underlayColor = (data.floorUnderlayIds?.[index] ?? 0) === 0 ? backgroundColor : groundColors[tileY * 64 + tileX];
        if (overlayId === -1) {
            this.fillTile(pixels, width, x, y, scaleHandler.pixelsPerTile, underlayColor);
            return;
        }

        this.drawTemplateTile(
            pixels,
            width,
            x,
            y,
            scaleHandler.pixelsPerTile,
            underlayColor,
            overlayColor,
            scaleHandler.getTemplate(shape, data.overlayRotations?.[0]?.[index] ?? 0),
        );
    }

    private drawTileOverlays(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        data: WorldMapDataBase,
        scaleHandler: WorldMapScaleHandler,
        backgroundColor: number,
    ): void {
        const index = getTileIndex(tileX, tileY);
        const x = tileX * scaleHandler.pixelsPerTile;
        const y = (63 - tileY) * scaleHandler.pixelsPerTile;
        for (let plane = 1; plane < data.planes; plane++) {
            const overlayId = (data.floorOverlayIds?.[plane]?.[index] ?? 0) - 1;
            if (overlayId <= -1) continue;
            const overlayColor = this.getFloorOverlayColor(overlayId, backgroundColor);
            const shape = data.overlayShapes?.[plane]?.[index] ?? 0;
            if (shape === 0) {
                this.fillTile(pixels, width, x, y, scaleHandler.pixelsPerTile, overlayColor);
            } else {
                this.drawTemplateTile(
                    pixels,
                    width,
                    x,
                    y,
                    scaleHandler.pixelsPerTile,
                    0,
                    overlayColor,
                    scaleHandler.getTemplate(shape, data.overlayRotations?.[plane]?.[index] ?? 0),
                );
            }
        }
    }

    private drawTileDecorations(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        data: WorldMapDataBase,
    ): void {
        this.drawMapSceneLines(pixels, width, tileX, tileY, data);
        this.drawMapScene(pixels, width, tileX, tileY, data);
    }

    private drawMapSceneLines(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        data: WorldMapDataBase,
    ): void {
        const index = getTileIndex(tileX, tileY);
        for (let plane = 0; plane < data.planes; plane++) {
            const decorations = data.decorations?.[plane]?.[index];
            if (!decorations || decorations.length === 0) continue;
            for (const decoration of decorations) {
                if (
                    !(
                        (decoration.decoration >= 0 && decoration.decoration <= 3) ||
                        decoration.decoration === 9
                    )
                ) {
                    continue;
                }
                const locType = this.options.locTypeLoader.load(decoration.objectDefinitionId);
                const color = locType.isInteractive !== 0 ? WALL_LINE_DARK : WALL_LINE_LIGHT;
                if (decoration.decoration === 0) {
                    this.drawWallLine(pixels, width, tileX, tileY, decoration.rotation, color);
                } else if (decoration.decoration === 2) {
                    this.drawWallLine(pixels, width, tileX, tileY, decoration.rotation, WALL_LINE_LIGHT);
                    this.drawWallLine(pixels, width, tileX, tileY, decoration.rotation + 1, color);
                } else if (decoration.decoration === 3) {
                    this.drawCornerPoint(pixels, width, tileX, tileY, decoration.rotation, color);
                } else if (decoration.decoration === 9) {
                    this.drawDiagonalLine(pixels, width, tileX, tileY, decoration.rotation, color);
                }
            }
        }
    }

    private drawMapScene(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        data: WorldMapDataBase,
    ): void {
        const index = getTileIndex(tileX, tileY);
        for (let plane = 0; plane < data.planes; plane++) {
            const decorations = data.decorations?.[plane]?.[index];
            if (!decorations || decorations.length === 0) continue;
            for (const decoration of decorations) {
                if (!((decoration.decoration >= 10 && decoration.decoration <= 11) || decoration.decoration === 22)) {
                    continue;
                }
                const locType = this.options.locTypeLoader.load(decoration.objectDefinitionId);
                if (locType.mapSceneId === -1) continue;
                const sprite = this.options.mapScenes[locType.mapSceneId];
                if (!sprite) continue;
                const pixelsPerTile = Math.max(1, width / 64);
                const sizeTiles = decoration.rotation !== 1 && decoration.rotation !== 3 ? locType.sizeY : locType.sizeX;
                this.drawIndexedSpriteScaled(
                    pixels,
                    width,
                    width,
                    sprite,
                    tileX * pixelsPerTile,
                    (64 - sizeTiles - tileY) * pixelsPerTile,
                    pixelsPerTile * 2,
                    pixelsPerTile * 2,
                );
            }
        }
    }

    private drawWallLine(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        rotation: number,
        color: number,
    ): void {
        const pixelsPerTile = Math.max(1, width / 64) | 0;
        const x = tileX * pixelsPerTile;
        const y = (63 - tileY) * pixelsPerTile;
        const normalized = rotation & 3;
        if (normalized === 0) {
            this.drawVerticalLine(pixels, width, x, y, pixelsPerTile, color);
        } else if (normalized === 1) {
            this.drawHorizontalLine(pixels, width, x, y, pixelsPerTile, color);
        } else if (normalized === 2) {
            this.drawVerticalLine(pixels, width, x + pixelsPerTile - 1, y, pixelsPerTile, color);
        } else {
            this.drawHorizontalLine(pixels, width, x, y + pixelsPerTile - 1, pixelsPerTile, color);
        }
    }

    private drawCornerPoint(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        rotation: number,
        color: number,
    ): void {
        const pixelsPerTile = Math.max(1, width / 64) | 0;
        const x = tileX * pixelsPerTile;
        const y = (63 - tileY) * pixelsPerTile;
        if ((rotation & 3) === 0) pixels[y * width + x] = color & 0xffffff;
        else if ((rotation & 3) === 1) pixels[y * width + x + pixelsPerTile - 1] = color & 0xffffff;
        else if ((rotation & 3) === 2) pixels[(y + pixelsPerTile - 1) * width + x + pixelsPerTile - 1] = color & 0xffffff;
        else pixels[(y + pixelsPerTile - 1) * width + x] = color & 0xffffff;
    }

    private drawDiagonalLine(
        pixels: Int32Array,
        width: number,
        tileX: number,
        tileY: number,
        rotation: number,
        color: number,
    ): void {
        const pixelsPerTile = Math.max(1, width / 64) | 0;
        const x = tileX * pixelsPerTile;
        const y = (63 - tileY) * pixelsPerTile;
        if ((rotation & 1) === 0) {
            for (let i = 0; i < pixelsPerTile; i++) {
                pixels[(y + pixelsPerTile - 1 - i) * width + x + i] = color & 0xffffff;
            }
        } else {
            for (let i = 0; i < pixelsPerTile; i++) {
                pixels[(y + i) * width + x + i] = color & 0xffffff;
            }
        }
    }

    private drawVerticalLine(
        pixels: Int32Array,
        width: number,
        x: number,
        y: number,
        height: number,
        color: number,
    ): void {
        const rgb = color & 0xffffff;
        for (let yy = 0; yy < height; yy++) pixels[(y + yy) * width + x] = rgb;
    }

    private drawHorizontalLine(
        pixels: Int32Array,
        width: number,
        x: number,
        y: number,
        lineWidth: number,
        color: number,
    ): void {
        const rgb = color & 0xffffff;
        const offset = y * width + x;
        for (let xx = 0; xx < lineWidth; xx++) pixels[offset + xx] = rgb;
    }

    private fillTile(
        pixels: Int32Array,
        width: number,
        x: number,
        y: number,
        size: number,
        color: number,
    ): void {
        const rgb = color & 0xffffff;
        for (let yy = 0; yy < size; yy++) {
            let offset = (y + yy) * width + x;
            for (let xx = 0; xx < size; xx++) {
                pixels[offset++] = rgb;
            }
        }
    }

    private drawTemplateTile(
        pixels: Int32Array,
        width: number,
        x: number,
        y: number,
        size: number,
        underlayColor: number,
        overlayColor: number,
        template: Int8Array | undefined,
    ): void {
        if (!template) {
            this.fillTile(pixels, width, x, y, size, overlayColor);
            return;
        }
        const underlayRgb = underlayColor & 0xffffff;
        const overlayRgb = overlayColor & 0xffffff;
        let templateIndex = 0;
        for (let yy = 0; yy < size; yy++) {
            let offset = (y + yy) * width + x;
            for (let xx = 0; xx < size; xx++) {
                pixels[offset++] = template[templateIndex++] !== 0 ? overlayRgb : underlayRgb;
            }
        }
    }

    private drawIndexedSpriteScaled(
        pixels: Int32Array,
        width: number,
        height: number,
        sprite: IndexedSprite,
        x: number,
        y: number,
        drawWidth: number,
        drawHeight: number,
    ): void {
        const stepX = (sprite.width << 16) / drawWidth;
        const stepY = (sprite.height << 16) / drawHeight;
        let sourceXStart = 0;
        let sourceYStart = 0;
        if (sprite.xOffset > 0) {
            const adjust = ((stepX + (sprite.xOffset << 16) - 1) / stepX) | 0;
            x += adjust;
            sourceXStart += adjust * stepX - (sprite.xOffset << 16);
        }
        if (sprite.yOffset > 0) {
            const adjust = ((stepY + (sprite.yOffset << 16) - 1) / stepY) | 0;
            y += adjust;
            sourceYStart += adjust * stepY - (sprite.yOffset << 16);
        }
        if (sprite.subWidth < sprite.width) {
            drawWidth = ((stepX + ((sprite.subWidth << 16) - sourceXStart) - 1) / stepX) | 0;
        }
        if (sprite.subHeight < sprite.height) {
            drawHeight = ((stepY + ((sprite.subHeight << 16) - sourceYStart) - 1) / stepY) | 0;
        }

        const startX = Math.max(0, x | 0);
        const startY = Math.max(0, y | 0);
        const endX = Math.min(width, (x + drawWidth) | 0);
        const endY = Math.min(height, (y + drawHeight) | 0);
        for (let dstY = startY; dstY < endY; dstY++) {
            const srcY = ((sourceYStart + (dstY - y) * stepY) >> 16) | 0;
            if (srcY < 0 || srcY >= sprite.subHeight) continue;
            let dstOffset = dstY * width + startX;
            for (let dstX = startX; dstX < endX; dstX++) {
                const srcX = ((sourceXStart + (dstX - x) * stepX) >> 16) | 0;
                if (srcX < 0 || srcX >= sprite.subWidth) {
                    dstOffset++;
                    continue;
                }
                const srcIndex = srcY * sprite.subWidth + srcX;
                const paletteIndex = sprite.pixels[srcIndex] & 0xff;
                if (paletteIndex !== 0 && (sprite.alpha?.[srcIndex] ?? 255) !== 0) {
                    pixels[dstOffset] = sprite.palette[paletteIndex] & 0xffffff;
                }
                dstOffset++;
            }
        }
    }

    private getFloorOverlayColor(floorOverlayId: number, defaultColor: number): number {
        let overlay;
        try {
            overlay = this.options.overlayTypeLoader.load(floorOverlayId | 0);
        } catch {
            return defaultColor;
        }
        if (!overlay) return defaultColor;
        let hsl = -1;
        if (overlay.secondaryRgb >= 0) {
            hsl = packHsl(overlay.secondaryHue, overlay.secondarySaturation, overlay.secondaryLightness);
        } else if (overlay.textureId >= 0) {
            try {
                hsl = this.options.textureLoader.getAverageHsl(overlay.textureId | 0);
            } catch {
                hsl = -1;
            }
        } else if (overlay.primaryRgb === 0xff00ff) {
            return defaultColor;
        } else {
            hsl = packHsl(overlay.hue, overlay.saturation, overlay.lightness);
        }
        return HSL_RGB_MAP[adjustOverlayLight(hsl, 96)] ?? defaultColor;
    }

    private getGroundColors(groupId: number, fileId = 0): Promise<Int32Array> {
        const key = `${groupId}/${fileId}`;
        const cached = this.groundSpriteCache.get(key);
        if (cached) return cached;
        const colors = this.loadGroundColors(groupId, fileId);
        this.groundSpriteCache.set(key, colors);
        return colors;
    }

    private async loadGroundColors(groupId: number, fileId: number): Promise<Int32Array> {
        try {
            // Waits for the group to stream in when the cache is sparse.
            const archive = await retryOnMissingGroup(() => this.groundIndex.getArchive(groupId));
            if (archive) {
                const file = archive.getFile(fileId) ?? archive.getFile(0) ?? archive.files[0];
                if (file) return await this.decodeWorldMapSprite(file.data);
            }
        } catch (error) {
            console.log("[WorldMapArchiveRenderer] Failed to load ground sprite", {
                groupId,
                error,
            });
        }
        // Don't keep the blank result cached; a later view retries the load.
        this.groundSpriteCache.delete(`${groupId}/${fileId}`);
        return new Int32Array(TILE_AREA);
    }

    private async decodeWorldMapSprite(data: Int8Array): Promise<Int32Array> {
        const colors = new Int32Array(TILE_AREA);
        const bytes = new Uint8Array(data.byteLength) as Uint8Array<ArrayBuffer>;
        bytes.set(data as unknown as Uint8Array);
        let image: ImageBitmap | HTMLImageElement | undefined;
        let url: string | undefined;
        try {
            const blob = new Blob([bytes.buffer], { type: this.getImageMimeType(bytes) });
            if (typeof createImageBitmap === "function") {
                image = await createImageBitmap(blob);
            } else if (typeof Image !== "undefined" && typeof URL !== "undefined") {
                url = URL.createObjectURL(blob);
                image = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error("Failed to decode world map ground image"));
                    img.src = url!;
                });
            } else {
                return colors;
            }
            const width = Math.min(TILE_COUNT, image.width | 0);
            const height = Math.min(TILE_COUNT, image.height | 0);
            if (width <= 0 || height <= 0) return colors;
            const canvas =
                typeof OffscreenCanvas !== "undefined"
                    ? new OffscreenCanvas(width, height)
                    : typeof document !== "undefined"
                      ? document.createElement("canvas")
                      : undefined;
            if (!canvas) return colors;
            canvas.width = width;
            canvas.height = height;
            // Canvas and OffscreenCanvas expose different getContext overloads.
            // Keeping the calls separate preserves their shared 2D context type.
            const ctx =
                typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas
                    ? canvas.getContext("2d", { willReadFrequently: true })
                    : (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true });
            if (!ctx) return colors;
            ctx.drawImage(image, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height).data;
            for (let y = 0; y < height; y++) {
                let srcOffset = y * width * 4;
                let dstOffset = y * TILE_COUNT;
                for (let x = 0; x < width; x++) {
                    colors[dstOffset++] =
                        (imageData[srcOffset] << 16) |
                        (imageData[srcOffset + 1] << 8) |
                        imageData[srcOffset + 2];
                    srcOffset += 4;
                }
            }
        } catch (error) {
            console.log("[WorldMapArchiveRenderer] Failed to decode ground sprite", { error });
        } finally {
            if (image && "close" in image) image.close();
            if (url !== undefined) URL.revokeObjectURL(url);
        }
        return colors;
    }

    private getImageMimeType(data: Uint8Array): string {
        if (
            data.length >= 8 &&
            data[0] === 0x89 &&
            data[1] === 0x50 &&
            data[2] === 0x4e &&
            data[3] === 0x47
        ) {
            return "image/png";
        }
        if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
            return "image/jpeg";
        }
        return "application/octet-stream";
    }

    private getScaleHandler(pixelsPerTile: number): WorldMapScaleHandler {
        let handler = this.scaleHandlers.get(pixelsPerTile);
        if (!handler) {
            handler = new WorldMapScaleHandler(pixelsPerTile);
            this.scaleHandlers.set(pixelsPerTile, handler);
        }
        return handler;
    }

    private loadMapElement(elementId: number): MapElementType | undefined {
        try {
            return this.options.mapElementTypeLoader?.load?.(elementId | 0);
        } catch {
            return undefined;
        }
    }

    private convertRgbToRgba(rgbPixels: Int32Array): Uint8Array {
        const pixels = new Uint8Array(rgbPixels.length * 4);
        let offset = 0;
        for (let i = 0; i < rgbPixels.length; i++) {
            const rgb = rgbPixels[i] & 0xffffff;
            pixels[offset++] = (rgb >> 16) & 0xff;
            pixels[offset++] = (rgb >> 8) & 0xff;
            pixels[offset++] = rgb & 0xff;
            pixels[offset++] = 0xff;
        }
        return pixels;
    }

    private setRenderedRegionCache(key: string, tile: WorldMapRenderedTile): void {
        this.renderedRegionCache.set(key, tile);
        this.renderedRegionCacheBytes += tile.pixels.byteLength;
        while (this.renderedRegionCacheBytes > this.maxRenderedRegionBytes) {
            const oldest = this.renderedRegionCache.keys().next().value;
            if (oldest === undefined) break;
            const removed = this.renderedRegionCache.get(oldest);
            if (removed) this.renderedRegionCacheBytes -= removed.pixels.byteLength;
            this.renderedRegionCache.delete(oldest);
        }
    }
}

/** For tests: the cache-format decoders. */
export const worldMapFormatForTests = { readCompositeMap, decodeWorldMapData0Geography, decodeHeaderlessChunkRegion };
