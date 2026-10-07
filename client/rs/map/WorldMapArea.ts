import { CacheSystem } from "../cache/CacheSystem";
import { IndexType } from "../cache/IndexType";
import { ByteBuffer } from "../io/ByteBuffer";

export type WorldMapCoord = {
    plane: number;
    x: number;
    y: number;
};

export type WorldMapPosition = {
    x: number;
    y: number;
};

export type WorldMapIconEntry = {
    element: number;
    category: number;
    spriteId: number;
    coord: number;
    displayCoord?: number;
};

export type WorldMapElementMetadata = {
    category?: number;
};

export type WorldMapEventState = {
    element: number;
    coord1: number;
    coord2: number;
};

export function getWorldMapZoomScale(zoomPercentage: number): number {
    switch (zoomPercentage | 0) {
        case 25:
            return 1;
        case 37:
            return 1.5;
        case 50:
            return 2;
        case 75:
            return 3;
        case 100:
            return 4;
        default:
            return 8;
    }
}

function normalizeWorldMapZoomPercentage(zoomPercentage: number): number {
    switch (zoomPercentage | 0) {
        case 25:
            return 25;
        case 37:
            return 37;
        case 50:
            return 50;
        case 75:
            return 75;
        case 100:
            return 100;
        default:
            return 200;
    }
}

type BoundsTarget = {
    regionLowX: number;
    regionHighX: number;
    regionLowY: number;
    regionHighY: number;
};

interface WorldMapSection {
    containsPosition(x: number, y: number): boolean;
    containsCoord(plane: number, x: number, y: number): boolean;
    coord(x: number, y: number): WorldMapCoord | undefined;
    position(plane: number, x: number, y: number): WorldMapPosition | undefined;
    expandBounds(target: BoundsTarget): void;
}

export function packWorldMapCoord(coord: WorldMapCoord): number {
    return ((coord.plane & 0x3) << 28) | ((coord.x & 0x3fff) << 14) | (coord.y & 0x3fff);
}

export function unpackWorldMapCoord(packed: number): WorldMapCoord {
    return {
        plane: (packed >>> 28) & 0x3,
        x: (packed >>> 14) & 0x3fff,
        y: packed & 0x3fff,
    };
}

function readCoord(buffer: ByteBuffer): WorldMapCoord {
    return unpackWorldMapCoord(buffer.readInt());
}

function skipNullableLargeSmart(buffer: ByteBuffer): void {
    buffer.readBigSmart();
}

function skipWorldMapData0(buffer: ByteBuffer, withRefs: boolean): void {
    buffer.readUnsignedByte();
    buffer.readUnsignedByte();
    buffer.readUnsignedByte();
    buffer.readUnsignedShort();
    buffer.readUnsignedShort();
    buffer.readUnsignedShort();
    buffer.readUnsignedShort();
    if (withRefs) {
        skipNullableLargeSmart(buffer);
        skipNullableLargeSmart(buffer);
    }
}

function skipWorldMapData1(buffer: ByteBuffer, withRefs: boolean): void {
    buffer.readUnsignedByte();
    buffer.readUnsignedByte();
    buffer.readUnsignedByte();
    buffer.readUnsignedShort();
    buffer.readUnsignedShort();
    buffer.readUnsignedByte();
    buffer.readUnsignedByte();
    buffer.readUnsignedShort();
    buffer.readUnsignedShort();
    buffer.readUnsignedByte();
    buffer.readUnsignedByte();
    if (withRefs) {
        skipNullableLargeSmart(buffer);
        skipNullableLargeSmart(buffer);
    }
}

/** The composite map's icons, in either format (rev 241 dropped the entries' geography refs). */
function decodeCompositeMapIcons(data: Int8Array, includeHidden: boolean): WorldMapIconEntry[] {
    try {
        return decodeCompositeMapIconsAs(data, includeHidden, true);
    } catch {
        return decodeCompositeMapIconsAs(data, includeHidden, false);
    }
}

function decodeCompositeMapIconsAs(data: Int8Array, includeHidden: boolean, withRefs: boolean): WorldMapIconEntry[] {
    const buffer = new ByteBuffer(data);
    const data0Count = buffer.readUnsignedShort();
    for (let i = 0; i < data0Count; i++) {
        skipWorldMapData0(buffer, withRefs);
    }

    const data1Count = buffer.readUnsignedShort();
    for (let i = 0; i < data1Count; i++) {
        skipWorldMapData1(buffer, withRefs);
    }

    const iconCount = buffer.readUnsignedShort();
    const icons: WorldMapIconEntry[] = [];
    for (let i = 0; i < iconCount; i++) {
        const element = buffer.readBigSmart();
        const coord = buffer.readInt();
        const hidden = buffer.readUnsignedByte() === 1;
        if (includeHidden || !hidden) {
            icons.push({
                element,
                category: -1,
                spriteId: -1,
                coord,
                displayCoord: coord,
            });
        }
    }
    if (buffer.offset !== data.length) {
        throw new Error("World map composite map: format mismatch");
    }
    return icons;
}

class WorldMapSection0 implements WorldMapSection {
    oldZ = 0;
    newZ = 0;
    oldX = 0;
    oldChunkXLow = 0;
    oldChunkXHigh = 0;
    oldY = 0;
    oldChunkYLow = 0;
    oldChunkYHigh = 0;
    newX = 0;
    newChunkXLow = 0;
    newChunkXHigh = 0;
    newY = 0;
    newChunkYLow = 0;
    newChunkYHigh = 0;

    read(buffer: ByteBuffer): void {
        this.oldZ = buffer.readUnsignedByte();
        this.newZ = buffer.readUnsignedByte();
        this.oldX = buffer.readUnsignedShort();
        this.oldChunkXLow = buffer.readUnsignedByte();
        this.oldChunkXHigh = buffer.readUnsignedByte();
        this.oldY = buffer.readUnsignedShort();
        this.oldChunkYLow = buffer.readUnsignedByte();
        this.oldChunkYHigh = buffer.readUnsignedByte();
        this.newX = buffer.readUnsignedShort();
        this.newChunkXLow = buffer.readUnsignedByte();
        this.newChunkXHigh = buffer.readUnsignedByte();
        this.newY = buffer.readUnsignedShort();
        this.newChunkYLow = buffer.readUnsignedByte();
        this.newChunkYHigh = buffer.readUnsignedByte();
    }

    containsPosition(x: number, y: number): boolean {
        return (
            x >= (this.newX << 6) + (this.newChunkXLow << 3) &&
            x <= (this.newX << 6) + (this.newChunkXHigh << 3) + 7 &&
            y >= (this.newY << 6) + (this.newChunkYLow << 3) &&
            y <= (this.newY << 6) + (this.newChunkYHigh << 3) + 7
        );
    }

    containsCoord(plane: number, x: number, y: number): boolean {
        if (plane < this.oldZ || plane >= this.oldZ + this.newZ) return false;
        return (
            x >= (this.oldX << 6) + (this.oldChunkXLow << 3) &&
            x <= (this.oldX << 6) + (this.oldChunkXHigh << 3) + 7 &&
            y >= (this.oldY << 6) + (this.oldChunkYLow << 3) &&
            y <= (this.oldY << 6) + (this.oldChunkYHigh << 3) + 7
        );
    }

    coord(x: number, y: number): WorldMapCoord | undefined {
        if (!this.containsPosition(x, y)) return undefined;
        return {
            plane: this.oldZ,
            x:
                this.oldX * 64 -
                this.newX * 64 +
                (this.oldChunkXLow * 8 - this.newChunkXLow * 8) +
                x,
            y:
                this.oldY * 64 -
                this.newY * 64 +
                y +
                (this.oldChunkYLow * 8 - this.newChunkYLow * 8),
        };
    }

    position(plane: number, x: number, y: number): WorldMapPosition | undefined {
        if (!this.containsCoord(plane, x, y)) return undefined;
        return {
            x:
                this.newX * 64 -
                this.oldX * 64 +
                x +
                (this.newChunkXLow * 8 - this.oldChunkXLow * 8),
            y:
                y +
                (this.newY * 64 - this.oldY * 64) +
                (this.newChunkYLow * 8 - this.oldChunkYLow * 8),
        };
    }

    expandBounds(target: BoundsTarget): void {
        target.regionLowX = Math.min(target.regionLowX, this.newX);
        target.regionHighX = Math.max(target.regionHighX, this.newX);
        target.regionLowY = Math.min(target.regionLowY, this.newY);
        target.regionHighY = Math.max(target.regionHighY, this.newY);
    }
}

class WorldMapSection1 implements WorldMapSection {
    minPlane = 0;
    planes = 0;
    regionStartX = 0;
    regionStartY = 0;
    regionEndX = 0;
    regionEndY = 0;

    read(buffer: ByteBuffer): void {
        this.minPlane = buffer.readUnsignedByte();
        this.planes = buffer.readUnsignedByte();
        this.regionStartX = buffer.readUnsignedShort();
        this.regionStartY = buffer.readUnsignedShort();
        this.regionEndX = buffer.readUnsignedShort();
        this.regionEndY = buffer.readUnsignedShort();
    }

    containsPosition(x: number, y: number): boolean {
        return x >> 6 === this.regionEndX && y >> 6 === this.regionEndY;
    }

    containsCoord(plane: number, x: number, y: number): boolean {
        return (
            plane >= this.minPlane &&
            plane < this.minPlane + this.planes &&
            x >> 6 === this.regionStartX &&
            y >> 6 === this.regionStartY
        );
    }

    coord(x: number, y: number): WorldMapCoord | undefined {
        if (!this.containsPosition(x, y)) return undefined;
        return {
            plane: this.minPlane,
            x: this.regionStartX * 64 - this.regionEndX * 64 + x,
            y: this.regionStartY * 64 - this.regionEndY * 64 + y,
        };
    }

    position(plane: number, x: number, y: number): WorldMapPosition | undefined {
        if (!this.containsCoord(plane, x, y)) return undefined;
        return {
            x: this.regionEndX * 64 - this.regionStartX * 64 + x,
            y: y + (this.regionEndY * 64 - this.regionStartY * 64),
        };
    }

    expandBounds(target: BoundsTarget): void {
        target.regionLowX = Math.min(target.regionLowX, this.regionEndX);
        target.regionHighX = Math.max(target.regionHighX, this.regionEndX);
        target.regionLowY = Math.min(target.regionLowY, this.regionEndY);
        target.regionHighY = Math.max(target.regionHighY, this.regionEndY);
    }
}

class WorldMapSection2 implements WorldMapSection {
    minPlane = 0;
    planes = 0;
    regionStartX = 0;
    regionStartY = 0;
    regionEndX = 0;
    regionEndY = 0;
    regionLowX = 0;
    regionLowY = 0;
    regionHighX = 0;
    regionHighY = 0;

    read(buffer: ByteBuffer): void {
        this.minPlane = buffer.readUnsignedByte();
        this.planes = buffer.readUnsignedByte();
        this.regionStartX = buffer.readUnsignedShort();
        this.regionStartY = buffer.readUnsignedShort();
        this.regionEndX = buffer.readUnsignedShort();
        this.regionEndY = buffer.readUnsignedShort();
        this.regionLowX = buffer.readUnsignedShort();
        this.regionLowY = buffer.readUnsignedShort();
        this.regionHighX = buffer.readUnsignedShort();
        this.regionHighY = buffer.readUnsignedShort();
    }

    containsPosition(x: number, y: number): boolean {
        return (
            x >> 6 >= this.regionLowX &&
            x >> 6 <= this.regionHighX &&
            y >> 6 >= this.regionLowY &&
            y >> 6 <= this.regionHighY
        );
    }

    containsCoord(plane: number, x: number, y: number): boolean {
        return (
            plane >= this.minPlane &&
            plane < this.minPlane + this.planes &&
            x >> 6 >= this.regionStartX &&
            x >> 6 <= this.regionEndX &&
            y >> 6 >= this.regionStartY &&
            y >> 6 <= this.regionEndY
        );
    }

    coord(x: number, y: number): WorldMapCoord | undefined {
        if (!this.containsPosition(x, y)) return undefined;
        return {
            plane: this.minPlane,
            x: this.regionStartX * 64 - this.regionLowX * 64 + x,
            y: this.regionStartY * 64 - this.regionLowY * 64 + y,
        };
    }

    position(plane: number, x: number, y: number): WorldMapPosition | undefined {
        if (!this.containsCoord(plane, x, y)) return undefined;
        return {
            x: this.regionLowX * 64 - this.regionStartX * 64 + x,
            y: y + (this.regionLowY * 64 - this.regionStartY * 64),
        };
    }

    expandBounds(target: BoundsTarget): void {
        target.regionLowX = Math.min(target.regionLowX, this.regionLowX);
        target.regionHighX = Math.max(target.regionHighX, this.regionHighX);
        target.regionLowY = Math.min(target.regionLowY, this.regionLowY);
        target.regionHighY = Math.max(target.regionHighY, this.regionHighY);
    }
}

class WorldMapSectionChunk implements WorldMapSection {
    minPlane = 0;
    planes = 0;
    regionStartX = 0;
    regionStartChunkX = 0;
    regionStartY = 0;
    regionStartChunkY = 0;
    regionEndX = 0;
    regionEndChunkX = 0;
    regionEndY = 0;
    regionEndChunkY = 0;

    read(buffer: ByteBuffer): void {
        this.minPlane = buffer.readUnsignedByte();
        this.planes = buffer.readUnsignedByte();
        this.regionStartX = buffer.readUnsignedShort();
        this.regionStartChunkX = buffer.readUnsignedByte();
        this.regionStartY = buffer.readUnsignedShort();
        this.regionStartChunkY = buffer.readUnsignedByte();
        this.regionEndX = buffer.readUnsignedShort();
        this.regionEndChunkX = buffer.readUnsignedByte();
        this.regionEndY = buffer.readUnsignedShort();
        this.regionEndChunkY = buffer.readUnsignedByte();
    }

    containsPosition(x: number, y: number): boolean {
        return (
            x >= (this.regionEndX << 6) + (this.regionEndChunkX << 3) &&
            x <= (this.regionEndX << 6) + (this.regionEndChunkX << 3) + 7 &&
            y >= (this.regionEndY << 6) + (this.regionEndChunkY << 3) &&
            y <= (this.regionEndY << 6) + (this.regionEndChunkY << 3) + 7
        );
    }

    containsCoord(plane: number, x: number, y: number): boolean {
        return (
            plane >= this.minPlane &&
            plane < this.minPlane + this.planes &&
            x >= (this.regionStartX << 6) + (this.regionStartChunkX << 3) &&
            x <= (this.regionStartX << 6) + (this.regionStartChunkX << 3) + 7 &&
            y >= (this.regionStartY << 6) + (this.regionStartChunkY << 3) &&
            y <= (this.regionStartY << 6) + (this.regionStartChunkY << 3) + 7
        );
    }

    coord(x: number, y: number): WorldMapCoord | undefined {
        if (!this.containsPosition(x, y)) return undefined;
        return {
            plane: this.minPlane,
            x:
                this.regionStartX * 64 -
                this.regionEndX * 64 +
                (this.regionStartChunkX * 8 - this.regionEndChunkX * 8) +
                x,
            y:
                this.regionStartY * 64 -
                this.regionEndY * 64 +
                y +
                (this.regionStartChunkY * 8 - this.regionEndChunkY * 8),
        };
    }

    position(plane: number, x: number, y: number): WorldMapPosition | undefined {
        if (!this.containsCoord(plane, x, y)) return undefined;
        return {
            x:
                this.regionEndX * 64 -
                this.regionStartX * 64 +
                x +
                (this.regionEndChunkX * 8 - this.regionStartChunkX * 8),
            y:
                y +
                (this.regionEndY * 64 - this.regionStartY * 64) +
                (this.regionEndChunkY * 8 - this.regionStartChunkY * 8),
        };
    }

    expandBounds(target: BoundsTarget): void {
        target.regionLowX = Math.min(target.regionLowX, this.regionEndX);
        target.regionHighX = Math.max(target.regionHighX, this.regionEndX);
        target.regionLowY = Math.min(target.regionLowY, this.regionEndY);
        target.regionHighY = Math.max(target.regionHighY, this.regionEndY);
    }
}

function readWorldMapSection(buffer: ByteBuffer): WorldMapSection {
    const type = buffer.readUnsignedByte();
    let section: WorldMapSection0 | WorldMapSection1 | WorldMapSection2 | WorldMapSectionChunk;
    switch (type) {
        case 0:
            section = new WorldMapSection2();
            break;
        case 1:
            section = new WorldMapSection1();
            break;
        case 2:
            section = new WorldMapSection0();
            break;
        case 3:
            section = new WorldMapSectionChunk();
            break;
        default:
            throw new Error(`Unsupported world map section type ${type}`);
    }
    section.read(buffer);
    return section;
}

/**
 * The world map index's groups (zwyz/osrs-cache Js5WorldMapGroup). Rev 241 dropped the group and
 * file names from this index, so a name lookup falls back to these ids; before, the names
 * resolved to the same ids.
 */
export const WORLD_MAP_GROUP = { details: 0, compositemap: 1, compositetexture: 2, area: 3, labels: 4 } as const;

export function worldMapGroupId(index: any, name: keyof typeof WORLD_MAP_GROUP): number {
    const byName = index.getArchiveId(name);
    if (byName >= 0) return byName;
    const id = WORLD_MAP_GROUP[name];
    return index.archiveExists(id) ? id : -1;
}

/** An area's composite map: by the area's name, else the file with its details file's id. */
export function compositeMapFileFor(archive: any, area: { id: number; internalName: string }): any {
    return archive.getFileNamed(area.internalName) ?? archive.getFile?.(area.id) ?? archive.files?.find((file: any) => file.id === area.id);
}

export class WorldMapArea {
    id = -1;
    internalName = "";
    externalName = "";
    origin: WorldMapCoord = { plane: 0, x: 0, y: 0 };
    unknownInt = -1;
    backgroundColor = -0x1000000;
    isMain = false;
    zoom = -1;
    sections: WorldMapSection[] = [];
    regionLowX = Number.MAX_SAFE_INTEGER;
    regionHighX = 0;
    regionLowY = Number.MAX_SAFE_INTEGER;
    regionHighY = 0;

    static decode(id: number, data: Int8Array): WorldMapArea {
        const buffer = new ByteBuffer(data);
        const area = new WorldMapArea();
        area.id = id | 0;
        area.internalName = buffer.readString();
        area.externalName = buffer.readString();
        area.origin = readCoord(buffer);
        area.unknownInt = buffer.readInt();
        area.backgroundColor = buffer.readInt();
        buffer.readUnsignedByte();
        area.isMain = buffer.readUnsignedByte() === 1;
        area.zoom = buffer.readUnsignedByte();
        const sectionCount = buffer.readUnsignedByte();
        for (let i = 0; i < sectionCount; i++) {
            area.sections.push(readWorldMapSection(buffer));
        }
        area.setBounds();
        return area;
    }

    private setBounds(): void {
        for (const section of this.sections) {
            section.expandBounds(this);
        }
        if (this.regionLowX === Number.MAX_SAFE_INTEGER) {
            this.regionLowX = 0;
            this.regionLowY = 0;
        }
    }

    containsPosition(x: number, y: number): boolean {
        const regionX = Math.floor(x / 64);
        const regionY = Math.floor(y / 64);
        if (
            regionX < this.regionLowX ||
            regionX > this.regionHighX ||
            regionY < this.regionLowY ||
            regionY > this.regionHighY
        ) {
            return false;
        }
        return this.sections.some((section) => section.containsPosition(x, y));
    }

    containsCoord(plane: number, x: number, y: number): boolean {
        return this.sections.some((section) => section.containsCoord(plane, x, y));
    }

    position(plane: number, x: number, y: number): WorldMapPosition | undefined {
        for (const section of this.sections) {
            const pos = section.position(plane, x, y);
            if (pos) return pos;
        }
        return undefined;
    }

    coord(x: number, y: number): WorldMapCoord | undefined {
        for (const section of this.sections) {
            const coord = section.coord(x, y);
            if (coord) return coord;
        }
        return undefined;
    }

    getOriginPacked(): number {
        return packWorldMapCoord(this.origin);
    }

    getWidthTiles(): number {
        return (this.regionHighX - this.regionLowX + 1) * 64;
    }

    getHeightTiles(): number {
        return (this.regionHighY - this.regionLowY + 1) * 64;
    }

    getBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
        return {
            minX: this.regionLowX * 64,
            minY: this.regionLowY * 64,
            maxX: this.regionHighX * 64 + 63,
            maxY: this.regionHighY * 64 + 63,
        };
    }
}

export class WorldMapState {
    readonly areasById = new Map<number, WorldMapArea>();
    readonly areasByInternalName = new Map<string, WorldMapArea>();
    mainArea?: WorldMapArea;
    currentArea?: WorldMapArea;
    zoomPercentage = 100;
    displayX = 0;
    displayY = 0;
    displayWidth = 512;
    displayHeight = 334;
    targetX = -1;
    targetY = -1;
    elementsEnabled = true;
    perpetualFlash = false;
    maxFlashCount = 3;
    cyclesPerFlash = 50;
    flashCount = -1;
    flashCycle = -1;
    currentEvent?: WorldMapEventState;
    readonly disabledElements = new Set<number>();
    readonly disabledCategories = new Set<number>();
    readonly flashingElements = new Set<number>();
    readonly flashingCategories = new Set<number>();
    private loaded = false;
    private displayPixelWidth = 0;
    private displayPixelHeight = 0;
    private readonly tileIconsByAreaTile = new Map<number, Map<number, WorldMapIconEntry[]>>();
    private readonly staticIconsByAreaTile = new Map<number, Map<number, WorldMapIconEntry[]>>();
    private elementMetadataResolver?: (elementId: number) => WorldMapElementMetadata | undefined;
    private iconIterator: WorldMapIconEntry[] = [];
    private iconIteratorIndex = 0;

    static empty(): WorldMapState {
        return new WorldMapState();
    }

    static load(cacheSystem: CacheSystem): WorldMapState {
        const state = new WorldMapState();
        let index;
        try {
            index = cacheSystem.getIndex(IndexType.OSRS.worldMap);
        } catch {
            return state;
        }

        const detailsArchiveId = worldMapGroupId(index, "details");
        if (detailsArchiveId < 0 || !index.archiveExists(detailsArchiveId)) {
            return state;
        }

        const archive = index.getArchive(detailsArchiveId);
        const compositeMapArchiveId = worldMapGroupId(index, "compositemap");
        const compositeMapArchive =
            compositeMapArchiveId >= 0 && index.archiveExists(compositeMapArchiveId)
                ? index.getArchive(compositeMapArchiveId)
                : undefined;
        for (const file of archive.files) {
            try {
                const area = WorldMapArea.decode(file.id, file.data);
                state.areasById.set(area.id, area);
                state.areasByInternalName.set(area.internalName, area);
                if (area.isMain) {
                    state.mainArea = area;
                }
                const compositeMapFile = compositeMapArchive && compositeMapFileFor(compositeMapArchive, area);
                if (compositeMapFile) {
                    state.addStaticIcons(area.id, decodeCompositeMapIcons(compositeMapFile.data, true));
                }
            } catch (error) {
                console.log("[WorldMapState] Failed to decode world map area", {
                    fileId: file.id,
                    error,
                });
            }
        }

        state.loaded = state.areasById.size > 0;
        state.currentArea = state.mainArea ?? state.areasById.values().next().value ?? undefined;
        if (state.currentArea) {
            if (state.currentArea.zoom > 0) state.setZoomPercentage(state.currentArea.zoom);
            state.jumpToSourceCoordOrOriginInstant(
                state.currentArea.origin.plane,
                state.currentArea.origin.x,
                state.currentArea.origin.y,
            );
        }
        return state;
    }

    isLoaded(): boolean {
        return this.loaded;
    }

    getCurrentMapAreaId(): number {
        return this.currentArea?.id ?? -1;
    }

    getMapArea(id: number): WorldMapArea | undefined {
        return this.areasById.get(id | 0);
    }

    getZoomScale(): number {
        return getWorldMapZoomScale(this.zoomPercentage);
    }

    getDisplayPixelWidth(): number {
        return this.displayPixelWidth > 0 ? this.displayPixelWidth : this.displayWidth;
    }

    getDisplayPixelHeight(): number {
        return this.displayPixelHeight > 0 ? this.displayPixelHeight : this.displayHeight;
    }

    setDisplaySize(width: number, height: number): void {
        this.displayPixelWidth = Math.max(0, width | 0);
        this.displayPixelHeight = Math.max(0, height | 0);
        this.recomputeDisplaySize();
    }

    setCurrentMapAreaId(id: number): void {
        const area = this.getMapArea(id);
        if (!area) return;
        this.currentArea = area;
        if (area.zoom > 0) this.setZoomPercentage(area.zoom);
        this.jumpToSourceCoordOrOriginInstant(area.origin.plane, area.origin.x, area.origin.y);
    }

    setCurrentMapAreaAndPosition(plane: number, x: number, y: number): void {
        const area = this.mapAreaAtCoord(plane, x, y) ?? this.mainArea ?? this.currentArea;
        if (!area) return;
        this.currentArea = area;
        if (area.zoom > 0) this.setZoomPercentage(area.zoom);
        this.jumpToSourceCoordOrOriginInstant(plane, x, y);
    }

    jumpToMapArea(
        mapAreaId: number,
        preferredCoord: WorldMapCoord,
        fallbackCoord: WorldMapCoord,
        forceFallback: boolean,
    ): void {
        const area = this.getMapArea(mapAreaId);
        if (!area) return;
        this.currentArea = area;
        if (area.zoom > 0) this.setZoomPercentage(area.zoom);
        const coord =
            !forceFallback &&
            area.containsCoord(preferredCoord.plane, preferredCoord.x, preferredCoord.y)
                ? preferredCoord
                : fallbackCoord;
        this.jumpToSourceCoordOrOriginInstant(coord.plane, coord.x, coord.y);
    }

    mapAreaAtCoord(plane: number, x: number, y: number): WorldMapArea | undefined {
        for (const area of this.areasById.values()) {
            if (area.containsCoord(plane, x, y)) return area;
        }
        return undefined;
    }

    setZoomPercentage(zoom: number): void {
        this.zoomPercentage = normalizeWorldMapZoomPercentage(zoom);
        if (this.displayPixelWidth > 0 || this.displayPixelHeight > 0) {
            this.recomputeDisplaySize();
        }
    }

    private recomputeDisplaySize(): void {
        const pixelsPerTile = this.getZoomScale();
        this.displayWidth = Math.max(0, Math.ceil(this.displayPixelWidth / pixelsPerTile));
        this.displayHeight = Math.max(0, Math.ceil(this.displayPixelHeight / pixelsPerTile));
    }

    setWorldMapPositionTarget(x: number, y: number): void {
        if (!this.currentArea || !this.currentArea.containsPosition(x | 0, y | 0)) return;
        this.targetX = x | 0;
        this.targetY = y | 0;
    }

    setWorldMapPositionTargetInstant(x: number, y: number): void {
        if (!this.currentArea) return;
        this.setDisplayPosition(x | 0, y | 0);
    }

    setDisplayPosition(x: number, y: number): void {
        this.displayX = x | 0;
        this.displayY = y | 0;
        this.targetX = -1;
        this.targetY = -1;
    }

    jumpToSourceCoord(plane: number, x: number, y: number): void {
        const position = this.currentArea?.position(plane | 0, x | 0, y | 0);
        if (position) {
            this.setWorldMapPositionTarget(position.x, position.y);
        }
    }

    jumpToSourceCoordInstant(plane: number, x: number, y: number): void {
        const position = this.currentArea?.position(plane | 0, x | 0, y | 0);
        if (position) {
            this.setDisplayPosition(position.x, position.y);
        }
    }

    private jumpToSourceCoordOrOriginInstant(plane: number, x: number, y: number): void {
        const area = this.currentArea;
        if (!area) return;
        const position =
            area.position(plane | 0, x | 0, y | 0) ??
            area.position(area.origin.plane, area.origin.x, area.origin.y);
        this.setDisplayPosition(position?.x ?? area.origin.x, position?.y ?? area.origin.y);
    }

    cycle(): boolean {
        const flashChanged = this.cycleFlash();
        if (this.targetX === -1 || this.targetY === -1) {
            return flashChanged;
        }
        const deltaX = this.targetX - this.displayX;
        const deltaY = this.targetY - this.displayY;
        let stepX = deltaX;
        let stepY = deltaY;
        if (deltaX !== 0) {
            stepX = Math.trunc(deltaX / Math.min(8, Math.abs(deltaX)));
        }
        if (deltaY !== 0) {
            stepY = Math.trunc(deltaY / Math.min(8, Math.abs(deltaY)));
        }
        this.displayX = (this.displayX + stepX) | 0;
        this.displayY = (this.displayY + stepY) | 0;
        if (this.displayX === this.targetX && this.displayY === this.targetY) {
            this.targetX = -1;
            this.targetY = -1;
        }
        return flashChanged || stepX !== 0 || stepY !== 0;
    }

    sourceToDisplay(packedCoord: number): WorldMapPosition | undefined {
        const coord = unpackWorldMapCoord(packedCoord);
        return this.currentArea?.position(coord.plane, coord.x, coord.y);
    }

    displayToSource(packedCoord: number): WorldMapCoord | undefined {
        const coord = unpackWorldMapCoord(packedCoord);
        return this.currentArea?.coord(coord.x, coord.y);
    }

    coordInMap(mapAreaId: number, packedCoord: number): boolean {
        const coord = unpackWorldMapCoord(packedCoord);
        return this.getMapArea(mapAreaId)?.containsCoord(coord.plane, coord.x, coord.y) ?? false;
    }

    getDisplayCoord(): WorldMapCoord | undefined {
        const area = this.currentArea;
        if (!area) return undefined;
        const coord = area.coord(this.displayX | 0, this.displayY | 0);
        return coord ?? { plane: area.origin.plane, x: this.displayX | 0, y: this.displayY | 0 };
    }

    setTileIcons(
        mapX: number,
        mapY: number,
        level: number,
        icons: Array<{
            localX: number;
            localY: number;
            elementId: number;
            category: number;
            spriteId: number;
            sourcePlane?: number;
            sourceX?: number;
            sourceY?: number;
            displayPlane?: number;
            displayX?: number;
            displayY?: number;
        }>,
    ): void {
        const areaId = this.currentArea?.id;
        if (areaId === undefined) return;
        const key = WorldMapState.getTileKey(mapX, mapY, level);
        const entries: WorldMapIconEntry[] = [];
        for (const icon of icons) {
            if ((icon.elementId | 0) < 0) continue;
            const sourcePlane = (icon.sourcePlane ?? level) | 0;
            const sourceX = (icon.sourceX ?? ((mapX << 6) + (icon.localX | 0))) | 0;
            const sourceY = (icon.sourceY ?? ((mapY << 6) + (icon.localY | 0))) | 0;
            const hasDisplayCoord = icon.displayX !== undefined && icon.displayY !== undefined;
            entries.push({
                element: icon.elementId | 0,
                category: icon.category | 0,
                spriteId: icon.spriteId | 0,
                coord: packWorldMapCoord({
                    plane: sourcePlane,
                    x: sourceX,
                    y: sourceY,
                }),
                displayCoord: hasDisplayCoord
                    ? packWorldMapCoord({
                          plane: (icon.displayPlane ?? sourcePlane) | 0,
                          x: icon.displayX! | 0,
                          y: icon.displayY! | 0,
                      })
                    : undefined,
            });
        }
        let areaIcons = this.tileIconsByAreaTile.get(areaId);
        if (!areaIcons) {
            areaIcons = new Map();
            this.tileIconsByAreaTile.set(areaId, areaIcons);
        }
        if (entries.length > 0) areaIcons.set(key, entries);
        else areaIcons.delete(key);
    }

    removeTileIcons(mapX: number, mapY: number, level: number, areaId = this.currentArea?.id): void {
        if (areaId === undefined) return;
        this.tileIconsByAreaTile.get(areaId)?.delete(WorldMapState.getTileKey(mapX, mapY, level));
    }

    clearTileIcons(): void {
        this.tileIconsByAreaTile.clear();
        this.iconIterator = [];
        this.iconIteratorIndex = 0;
    }

    setElementMetadataResolver(
        resolver: ((elementId: number) => WorldMapElementMetadata | undefined) | undefined,
    ): void {
        this.elementMetadataResolver = resolver;
        this.iconIterator = [];
        this.iconIteratorIndex = 0;
    }

    resolveIconCategory(icon: Pick<WorldMapIconEntry, "element" | "category">): number {
        const category = (icon.category ?? -1) | 0;
        if (category >= 0) return category;
        return (this.elementMetadataResolver?.(icon.element | 0)?.category ?? -1) | 0;
    }

    getStaticIconsForTile(mapX: number, mapY: number, level: number): WorldMapIconEntry[] {
        const areaId = this.currentArea?.id;
        if (areaId === undefined) return [];
        return this.staticIconsByAreaTile
            .get(areaId)
            ?.get(WorldMapState.getTileKey(mapX, mapY, level)) ?? [];
    }

    getIconsForTile(mapX: number, mapY: number, level: number): WorldMapIconEntry[] {
        const key = WorldMapState.getTileKey(mapX, mapY, level);
        const staticIcons =
            this.currentArea?.id !== undefined
                ? this.staticIconsByAreaTile.get(this.currentArea.id)?.get(key)
                : undefined;
        const tileIcons =
            this.currentArea?.id !== undefined
                ? this.tileIconsByAreaTile.get(this.currentArea.id)?.get(key)
                : undefined;
        if (!staticIcons || staticIcons.length === 0) return tileIcons ?? [];
        if (!tileIcons || tileIcons.length === 0) return staticIcons;
        return staticIcons.concat(tileIcons);
    }

    private getIconDisplayCoord(icon: WorldMapIconEntry): number {
        if (icon.displayCoord !== undefined) return icon.displayCoord | 0;
        const area = this.currentArea;
        if (!area) return icon.coord | 0;
        const coord = unpackWorldMapCoord(icon.coord);
        const displayPosition = area.position(coord.plane, coord.x, coord.y);
        if (!displayPosition) return icon.coord | 0;
        return packWorldMapCoord({
            plane: coord.plane,
            x: displayPosition.x,
            y: displayPosition.y,
        });
    }

    getNearestIconCoord(elementId: number, packedCoord: number): number {
        const source = unpackWorldMapCoord(packedCoord);
        if (this.currentArea && !this.currentArea.containsPosition(source.x, source.y)) {
            return -1;
        }
        let nearest: WorldMapIconEntry | undefined;
        let nearestDistance = Number.MAX_SAFE_INTEGER;
        for (const icon of this.getVisibleIcons()) {
            if ((icon.element | 0) !== (elementId | 0)) continue;
            const coord = unpackWorldMapCoord(this.getIconDisplayCoord(icon));
            const dx = coord.x - source.x;
            const dy = coord.y - source.y;
            const distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearest = icon;
                nearestDistance = distance;
            }
        }
        return nearest ? this.getIconDisplayCoord(nearest) : -1;
    }

    iconStart(): { element: number; coord: number } | undefined {
        this.iconIterator = this.getVisibleIcons();
        this.iconIteratorIndex = 0;
        return this.iconNext();
    }

    iconNext(): { element: number; coord: number } | undefined {
        while (this.iconIteratorIndex < this.iconIterator.length) {
            const icon = this.iconIterator[this.iconIteratorIndex++];
            if (this.isIconVisible(icon)) {
                return { element: icon.element, coord: this.getIconDisplayCoord(icon) };
            }
        }
        return undefined;
    }

    setElementEnabled(elementId: number, enabled: boolean): void {
        if (enabled) this.disabledElements.delete(elementId | 0);
        else this.disabledElements.add(elementId | 0);
    }

    setCategoryEnabled(categoryId: number, enabled: boolean): void {
        if (enabled) this.disabledCategories.delete(categoryId | 0);
        else this.disabledCategories.add(categoryId | 0);
    }

    isElementEnabled(elementId: number): boolean {
        return !this.disabledElements.has(elementId | 0);
    }

    isCategoryEnabled(categoryId: number): boolean {
        return !this.disabledCategories.has(categoryId | 0);
    }

    setMaxFlashCount(count: number): void {
        if ((count | 0) >= 1) this.maxFlashCount = count | 0;
    }

    resetMaxFlashCount(): void {
        this.maxFlashCount = 3;
    }

    setCyclesPerFlash(cycles: number): void {
        if ((cycles | 0) >= 1) this.cyclesPerFlash = cycles | 0;
    }

    resetCyclesPerFlash(): void {
        this.cyclesPerFlash = 50;
    }

    flashElement(elementId: number): void {
        this.flashingElements.clear();
        this.flashingCategories.clear();
        this.flashingElements.add(elementId | 0);
        this.flashCount = 0;
        this.flashCycle = 0;
    }

    flashCategory(categoryId: number): void {
        this.flashingElements.clear();
        this.flashingCategories.clear();
        this.flashingCategories.add(categoryId | 0);
        this.flashCount = 0;
        this.flashCycle = 0;
    }

    stopCurrentFlashes(): void {
        this.flashingElements.clear();
        this.flashingCategories.clear();
        this.flashCount = -1;
        this.flashCycle = -1;
    }

    hasActiveFlashes(): boolean {
        return this.flashingElements.size > 0 || this.flashingCategories.size > 0;
    }

    shouldFlashIcon(icon: Pick<WorldMapIconEntry, "element" | "category">): boolean {
        if (!this.hasActiveFlashes()) return false;
        if (this.flashCycle < 0 || this.cyclesPerFlash <= 0) return false;
        if (this.flashCycle % this.cyclesPerFlash >= this.cyclesPerFlash / 2) return false;
        if (this.flashingElements.has(icon.element | 0)) return true;
        const category = this.resolveIconCategory(icon);
        return category >= 0 && this.flashingCategories.has(category);
    }

    setCurrentEvent(event: WorldMapEventState | undefined): void {
        this.currentEvent = event;
    }

    private getVisibleIcons(): WorldMapIconEntry[] {
        const icons: WorldMapIconEntry[] = [];
        const area = this.currentArea;
        const iconGroups = [
            area ? this.staticIconsByAreaTile.get(area.id) : undefined,
            area ? this.tileIconsByAreaTile.get(area.id) : undefined,
        ];
        for (const iconGroup of iconGroups) {
            if (!iconGroup) continue;
            for (const tileIcons of iconGroup.values()) {
                for (const icon of tileIcons) {
                    if (!this.isIconVisible(icon)) continue;
                    if (area) {
                        const coord = unpackWorldMapCoord(icon.coord);
                        if (icon.displayCoord !== undefined) {
                            const displayCoord = unpackWorldMapCoord(icon.displayCoord);
                            if (!area.containsPosition(displayCoord.x, displayCoord.y)) continue;
                        } else if (!area.containsCoord(coord.plane, coord.x, coord.y)) continue;
                    }
                    icons.push(icon);
                }
            }
        }
        return icons;
    }

    private addStaticIcons(areaId: number, icons: WorldMapIconEntry[]): void {
        let areaIcons = this.staticIconsByAreaTile.get(areaId | 0);
        if (!areaIcons) {
            areaIcons = new Map();
            this.staticIconsByAreaTile.set(areaId | 0, areaIcons);
        }
        for (const icon of icons) {
            if ((icon.element | 0) < 0) continue;
            const coord = unpackWorldMapCoord(icon.coord);
            const mapX = coord.x >> 6;
            const mapY = coord.y >> 6;
            const key = WorldMapState.getTileKey(mapX, mapY, coord.plane);
            let tileIcons = areaIcons.get(key);
            if (!tileIcons) {
                tileIcons = [];
                areaIcons.set(key, tileIcons);
            }
            tileIcons.push(icon);
        }
    }

    isIconVisible(icon: Pick<WorldMapIconEntry, "element" | "category">): boolean {
        const category = this.resolveIconCategory(icon);
        return (
            this.elementsEnabled &&
            this.isElementEnabled(icon.element) &&
            (category < 0 || this.isCategoryEnabled(category))
        );
    }

    private cycleFlash(): boolean {
        if (!this.hasActiveFlashes()) return false;
        this.flashCycle = ((this.flashCycle < 0 ? 0 : this.flashCycle) + 1) | 0;
        if (this.cyclesPerFlash > 0 && this.flashCycle % this.cyclesPerFlash === 0) {
            this.flashCount = ((this.flashCount < 0 ? 0 : this.flashCount) + 1) | 0;
            if (this.flashCount >= this.maxFlashCount && !this.perpetualFlash) {
                this.stopCurrentFlashes();
            }
        }
        return true;
    }

    private static getTileKey(mapX: number, mapY: number, level: number): number {
        return (((level | 0) & 0x3) << 16) + (((mapX | 0) & 0xff) << 8) + ((mapY | 0) & 0xff);
    }
}
