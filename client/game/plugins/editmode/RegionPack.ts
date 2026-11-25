import * as pako from "pako";
import { DIRECTION_TO_ORIENTATION, quarterTurnToDirection } from "../../../common/Direction";
import { generateHeight } from "../../../rs/util/HeightCalc";
import type { BrowserHostNpcSpawn } from "./hostProtocol/npcSpawnMessage";

import type { ObjectSpawn } from "./hostProtocol/objectSpawnsMessage";
import type { EditModeEdit, EditModeRegionOverlays } from "./types";

const MAP_SIZE = 64;
const PLANE_COUNT = 4;

type Loc = {
    id: number;
    x: number;
    y: number;
    plane: number;
    shape: number;
    rotation: number;
};

export type ParsedRegionPack = {
    regionId: number;
    objectData: Uint8Array;
    terrainData: Uint8Array;
};

function bytes(data: Uint8Array | Int8Array): Uint8Array {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function readUnsignedSmart(data: Uint8Array, cursor: { offset: number }): number {
    if (cursor.offset >= data.length) throw new Error("Truncated region object data");
    const first = data[cursor.offset++];
    if (first < 128) return first;
    if (cursor.offset >= data.length) throw new Error("Truncated region object data");
    return ((first << 8) | data[cursor.offset++]) - 0x8000;
}

function readSmart3(data: Uint8Array, cursor: { offset: number }): number {
    let value = 0;
    let part: number;
    do {
        part = readUnsignedSmart(data, cursor);
        value += part;
    } while (part === 32767);
    return value;
}

function decodeLocs(data: Uint8Array): Loc[] {
    const cursor = { offset: 0 };
    const locs: Loc[] = [];
    let id = -1;
    while (cursor.offset < data.length) {
        const idDelta = readSmart3(data, cursor);
        if (idDelta === 0) break;
        id += idDelta;
        let position = 0;
        while (true) {
            const positionDelta = readUnsignedSmart(data, cursor);
            if (positionDelta === 0) break;
            position += positionDelta - 1;
            if (cursor.offset >= data.length) throw new Error("Truncated region object data");
            const attributes = data[cursor.offset++];
            locs.push({
                id,
                x: (position >> 6) & 0x3f,
                y: position & 0x3f,
                plane: position >> 12,
                shape: attributes >> 2,
                rotation: attributes & 3,
            });
        }
    }
    return locs;
}

function writeUnsignedSmart(output: number[], value: number): void {
    if (value < 0 || value > 32767) throw new Error(`Invalid unsigned smart: ${value}`);
    if (value < 128) output.push(value);
    else output.push((value + 0x8000) >> 8, value & 0xff);
}

function writeSmart3(output: number[], value: number): void {
    while (value >= 32767) {
        writeUnsignedSmart(output, 32767);
        value -= 32767;
    }
    writeUnsignedSmart(output, value);
}

function encodeLocs(locs: Loc[]): Uint8Array {
    locs.sort(
        (a, b) =>
            a.id - b.id ||
            ((a.plane << 12) | (a.x << 6) | a.y) -
                ((b.plane << 12) | (b.x << 6) | b.y) ||
            a.shape - b.shape ||
            a.rotation - b.rotation,
    );
    const output: number[] = [];
    let previousId = -1;
    for (let index = 0; index < locs.length; ) {
        const id = locs[index].id;
        writeSmart3(output, id - previousId);
        previousId = id;
        let previousPosition = 0;
        while (index < locs.length && locs[index].id === id) {
            const loc = locs[index++];
            const position = (loc.plane << 12) | (loc.x << 6) | loc.y;
            writeUnsignedSmart(output, position - previousPosition + 1);
            output.push((loc.shape << 2) | (loc.rotation & 3));
            previousPosition = position;
        }
        writeUnsignedSmart(output, 0);
    }
    writeSmart3(output, 0);
    return Uint8Array.from(output);
}

function applyLocEdits(
    data: Uint8Array,
    edits: readonly EditModeEdit[],
    mapX: number,
    mapY: number,
): Uint8Array {
    let locs = decodeLocs(data);
    for (const edit of edits) {
        if ((edit.tileX >> 6) !== mapX || (edit.tileY >> 6) !== mapY) continue;
        const x = edit.tileX & 0x3f;
        const y = edit.tileY & 0x3f;
        if (edit.kind === "clear") {
            locs = locs.filter((loc) => loc.x !== x || loc.y !== y);
            continue;
        }
        if (edit.kind !== "place" && edit.kind !== "delete") continue;
        locs = locs.filter(
            (loc) =>
                loc.x !== x ||
                loc.y !== y ||
                loc.plane !== edit.plane ||
                loc.shape !== edit.shape,
        );
        if (edit.kind === "place" && edit.locId >= 0) {
            locs.push({
                id: edit.locId,
                x,
                y,
                plane: edit.plane,
                shape: edit.shape,
                rotation: edit.rotation,
            });
        }
    }
    return encodeLocs(locs);
}

function writeTerrainValue(output: number[], value: number, wide: boolean): void {
    if (wide) output.push((value >> 8) & 0xff, value & 0xff);
    else output.push(value & 0xff);
}

function patchTerrain(
    data: Uint8Array,
    edits: readonly EditModeEdit[],
    mapX: number,
    mapY: number,
    wide: boolean,
): Uint8Array {
    const overlays = new Map<string, EditModeEdit>();
    const heights = new Map<string, number>();
    const flags = new Map<string, number>();
    const underlays = new Map<string, number>();
    for (const edit of edits) {
        if ((edit.tileX >> 6) !== mapX || (edit.tileY >> 6) !== mapY) continue;
        const x = edit.tileX & 0x3f;
        const y = edit.tileY & 0x3f;
        if (edit.kind === "clear") {
            for (let plane = 0; plane < PLANE_COUNT; plane++) {
                overlays.set(`${plane}:${x}:${y}`, edit);
            }
        } else if (edit.kind === "terrain") {
            overlays.set(`${edit.plane}:${x}:${y}`, edit);
        } else if (edit.kind === "height") {
            heights.set(`${edit.plane}:${x}:${y}`, edit.locId);
        } else if (edit.kind === "underlay") {
            underlays.set(`${edit.plane}:${x}:${y}`, edit.locId);
        } else if (edit.kind === "flag") {
            flags.set(`${edit.plane}:${x}:${y}`, edit.locId);
        }
    }
    if (overlays.size === 0 && heights.size === 0 && flags.size === 0 && underlays.size === 0) return data.slice();

    const width = wide ? 2 : 1;
    const output: number[] = [];
    let offset = 0;
    const readValue = (): number => {
        if (offset + width > data.length) throw new Error("Truncated region terrain data");
        const value = wide ? (data[offset] << 8) | data[offset + 1] : data[offset];
        offset += width;
        return value;
    };

    for (let plane = 0; plane < PLANE_COUNT; plane++) {
        for (let x = 0; x < MAP_SIZE; x++) {
            for (let y = 0; y < MAP_SIZE; y++) {
                const overlay = overlays.get(`${plane}:${x}:${y}`);
                const height = heights.get(`${plane}:${x}:${y}`);
                const underlay = underlays.get(`${plane}:${x}:${y}`);
                const flag = flags.get(`${plane}:${x}:${y}`);
                const tileParts: Uint8Array[] = [];
                let terminator: Uint8Array;
                const tileStart = offset;
                while (true) {
                    const partStart = offset;
                    const opcode = readValue();
                    if (opcode === 0) {
                        terminator = data.subarray(partStart, offset);
                        break;
                    }
                    if (opcode === 1) {
                        if (offset >= data.length) throw new Error("Truncated region terrain data");
                        offset++;
                        terminator = data.subarray(partStart, offset);
                        break;
                    }
                    if (opcode <= 49) readValue();
                    if ((!overlay || opcode > 49) && (flag === undefined || opcode < 50 || opcode > 81) && (underlay === undefined || opcode <= 81)) {
                        tileParts.push(data.subarray(partStart, offset));
                    }
                }
                if (!overlay && height === undefined && flag === undefined && underlay === undefined) {
                    output.push(...data.subarray(tileStart, offset));
                    continue;
                }
                for (const part of tileParts) output.push(...part);
                if (overlay?.kind === "terrain") {
                    writeTerrainValue(output, 2 + overlay.shape * 4 + (overlay.rotation & 3), wide);
                    writeTerrainValue(output, overlay.locId, wide);
                }
                if (underlay !== undefined && underlay > 0) writeTerrainValue(output, 81 + underlay, wide);
                if (flag !== undefined && flag > 0) writeTerrainValue(output, 49 + flag, wide);
                if (height === undefined) {
                    output.push(...terminator);
                } else {
                    writeTerrainValue(output, 1, wide);
                    output.push(height & 0xff);
                }
            }
        }
    }
    output.push(...data.subarray(offset));
    return Uint8Array.from(output);
}

export function buildRegionPack(
    regionId: number,
    objectArchiveId: number,
    terrainArchiveId: number,
    objectData: Uint8Array | Int8Array,
    terrainData: Uint8Array | Int8Array,
    edits: readonly EditModeEdit[],
    wideTerrain: boolean,
    includeObjectEdits = true,
    newRegion = false,
): Uint8Array {
    const mapX = regionId >> 8;
    const mapY = regionId & 0xff;
    if (
        regionId < 0 ||
        regionId > 0xffff ||
        (!newRegion && (objectArchiveId < -1 || terrainArchiveId < 0)) ||
        (newRegion && (objectArchiveId !== -1 || terrainArchiveId !== -1))
    ) {
        throw new Error("The active region is missing from the cache");
    }
    const objects = includeObjectEdits ? applyLocEdits(bytes(objectData), edits, mapX, mapY) : bytes(objectData);
    const terrain = patchTerrain(bytes(terrainData), edits, mapX, mapY, wideTerrain);
    const pack = new Uint8Array(28 + objects.length + terrain.length);
    const view = new DataView(pack.buffer);
    view.setInt32(0, 1);
    view.setInt32(4, objectArchiveId);
    view.setInt32(8, terrainArchiveId);
    view.setInt32(12, mapX);
    view.setInt32(16, mapY);
    view.setInt32(20, objects.length);
    pack.set(objects, 24);
    view.setInt32(24 + objects.length, terrain.length);
    pack.set(terrain, 28 + objects.length);
    return pack;
}

/** A synthetic region uses ordinary cache terrain and loc streams with no native archive IDs. */
export function createRegionPack(
    regionId: number, wide: boolean, underlay: number, cave: boolean,
    source?: ParsedRegionPack,
): Uint8Array {
    const tiles: number[] = [];
    if (source) {
        // Bake procedural ground heights at their original coordinates so copied land keeps its profile.
        const edits: EditModeEdit[] = [];
        let cursor = 0;
        const step = wide ? 2 : 1;
        const read = () => {
            if (cursor + step > source.terrainData.length) throw new Error("Source region terrain is incomplete");
            const value = wide ? (source.terrainData[cursor] << 8) | source.terrainData[cursor + 1] : source.terrainData[cursor];
            cursor += step;
            return value;
        };
        for (let x = 0; x < MAP_SIZE; x++) {
            for (let y = 0; y < MAP_SIZE; y++) {
                for (;;) {
                    const code = read();
                    if (code === 1) {
                        cursor++;
                        break;
                    }
                    if (code === 0) {
                        const originalX = (source.regionId >> 8) * MAP_SIZE + x;
                        const originalY = (source.regionId & 255) * MAP_SIZE + y;
                        edits.push({ kind: "height", tileX: (regionId >> 8) * MAP_SIZE + x,
                            tileY: (regionId & 255) * MAP_SIZE + y, plane: 0, shape: 0, rotation: 0,
                            locId: generateHeight(originalX + 932731, originalY + 556238) });
                        break;
                    }
                    if (code <= 49) read();
                }
            }
        }
        return buildRegionPack(regionId, -1, -1, Uint8Array.of(0), source.terrainData, edits, wide, true, true);
    }
    if (!Number.isInteger(underlay) || underlay < 1 || underlay > (wide ? 65454 : 174)) throw new Error("Choose a base ground colour");
    for (let level = 0; level < PLANE_COUNT; level++) {
        for (let index = 0; index < MAP_SIZE * MAP_SIZE; index++) {
            if (level === 0) writeTerrainValue(tiles, 81 + underlay, wide);
            if (level === 0 && cave) {
                writeTerrainValue(tiles, 1, wide);
                tiles.push(24);
            } else writeTerrainValue(tiles, 0, wide);
        }
    }
    return buildRegionPack(regionId, -1, -1, Uint8Array.of(0), Uint8Array.from(tiles), [], wide, true, true);
}

/** MapRegionReplacementManager.MAX_PACKET_PAYLOAD: the payload ceiling of one region packet. */
export const MAX_REGION_PACK_PAYLOAD = 0xfffd;

/** regionId(2) + flags(1) + rawTerrainLength(4) + rawObjectLength(4), before the deflated data. */
const COMPRESSED_REGION_PAYLOAD_HEADER = 11;

/**
 * The bytes the server puts on the wire for a region. Raw terrain + objects are used while
 * they fit the short packet; denser regions are deflated by encodeRegionReplacement, which
 * is what makes Falador's 82 KB cache regions editable. pako tracks zlib closely (a few
 * hundred bytes either way on 80 KB), and map data deflates by roughly 6x, so the check sits
 * far from the edge in both directions.
 */
export function regionReplacementPayloadSize(
    terrain: Uint8Array,
    objects: Uint8Array,
): number {
    if (terrain.length + objects.length > 16 * 1024 * 1024) {
        throw new RangeError("Region replacement exceeds the 16 MiB raw limit");
    }
    const raw = 7 + terrain.length + objects.length;
    if (raw <= MAX_REGION_PACK_PAYLOAD) return raw;
    const combined = new Uint8Array(terrain.length + objects.length);
    combined.set(terrain, 0);
    combined.set(objects, terrain.length);
    const deflated = pako.deflate(combined, { level: 9 });
    return COMPRESSED_REGION_PAYLOAD_HEADER + deflated.length;
}

/** Regions the server could not stream, with the size it would measure them at. */
export function oversizedRegionPacks(
    packs: readonly { regionId: number; data: Uint8Array }[],
): { regionId: number; payload: number }[] {
    return packs.flatMap(({ regionId, data }) => {
        const { objectData, terrainData } = parseRegionPack(data);
        const payload = regionReplacementPayloadSize(terrainData, objectData);
        return payload > MAX_REGION_PACK_PAYLOAD ? [{ regionId, payload }] : [];
    });
}

/** Decode the same complete region pack consumed by the server replacement manager. */
export function parseRegionPack(pack: Uint8Array): ParsedRegionPack {
    if (pack.length < 28) throw new Error("Truncated region pack");
    const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
    if (view.getInt32(0) !== 1) throw new Error("Unsupported region pack version");
    const mapX = view.getInt32(12);
    const mapY = view.getInt32(16);
    const objectLength = view.getInt32(20);
    if (mapX < 0 || mapX > 0xff || mapY < 0 || mapY > 0xff || objectLength < 0) {
        throw new Error("Invalid region pack header");
    }
    const terrainLengthOffset = 24 + objectLength;
    if (terrainLengthOffset + 4 > pack.length) throw new Error("Truncated region object data");
    const terrainLength = view.getInt32(terrainLengthOffset);
    const terrainStart = terrainLengthOffset + 4;
    if (terrainLength <= 0 || terrainStart + terrainLength !== pack.length) {
        throw new Error("Invalid region terrain data");
    }
    return {
        regionId: (mapX << 8) | mapY,
        objectData: pack.subarray(24, terrainLengthOffset),
        terrainData: pack.subarray(terrainStart),
    };
}

/** Copies selected tiles on every plane from the same edited packs used by Save. */
export function buildAreaClipboard(
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    getPack: (tileX: number, tileY: number) => Uint8Array,
    wideTerrain: boolean,
    npcs: readonly BrowserHostNpcSpawn[] = [],
): string {
    if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX >= 16383 || bounds.maxY >= 16383 ||
        bounds.maxX < bounds.minX || bounds.maxY < bounds.minY ||
        bounds.maxX - bounds.minX >= 128 || bounds.maxY - bounds.minY >= 128) {
        throw new Error("Select an area of at most 128 by 128 tiles inside the map");
    }
    const heights: Array<{ x: number; y: number; plane: number; height: number }> = [];
    const tiles: Array<{ x: number; y: number; plane: number; terrain: number[] }> = [];
    const objects: Loc[] = [];
    const contains = (x: number, y: number) => x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
    for (let mapX = bounds.minX >> 6; mapX <= (bounds.maxX + 1) >> 6; mapX++) {
        for (let mapY = bounds.minY >> 6; mapY <= (bounds.maxY + 1) >> 6; mapY++) {
            const pack = parseRegionPack(getPack(mapX * MAP_SIZE, mapY * MAP_SIZE));
            if (pack.regionId !== ((mapX << 8) | mapY)) throw new Error("Wrong region returned for selection");
            for (const loc of decodeLocs(pack.objectData)) {
                const x = mapX * MAP_SIZE + loc.x;
                const y = mapY * MAP_SIZE + loc.y;
                if (contains(x, y)) objects.push({ ...loc, x: x - bounds.minX, y: y - bounds.minY });
            }
            const data = pack.terrainData;
            let offset = 0;
            const read = (width: number): number => {
                if (offset + width > data.length) throw new Error("Truncated region terrain data");
                const value = width === 2 ? (data[offset] << 8) | data[offset + 1] : data[offset];
                offset += width;
                return value;
            };
            for (let plane = 0; plane < PLANE_COUNT; plane++) {
                for (let x = 0; x < MAP_SIZE; x++) {
                    for (let y = 0; y < MAP_SIZE; y++) {
                        const start = offset;
                        while (true) {
                            const opcode = read(wideTerrain ? 2 : 1);
                            if (opcode === 0) break;
                            if (opcode === 1) { read(1); break; }
                            if (opcode <= 49) read(wideTerrain ? 2 : 1);
                        }
                        const worldX = mapX * MAP_SIZE + x;
                        const worldY = mapY * MAP_SIZE + y;
                        if (worldX >= bounds.minX && worldX <= bounds.maxX + 1 &&
                            worldY >= bounds.minY && worldY <= bounds.maxY + 1) {
                            const terrain = Array.from(data.subarray(start, offset));
                            const x = worldX - bounds.minX, y = worldY - bounds.minY;
                            heights.push({ x, y, plane, height: readAreaTerrain(terrain, wideTerrain, worldX, worldY, plane).height });
                            if (contains(worldX, worldY)) tiles.push({ x, y, plane, terrain });
                        }
                    }
                }
            }
        }
    }
    // Raw terrain records preserve heights (including procedural height opcodes), flags,
    // underlays, overlays, shapes and rotations exactly. The origin retains noise coordinates.
    return JSON.stringify({ format: "elvarg-map-area", version: 1, origin: { x: bounds.minX, y: bounds.minY },
        width: bounds.maxX - bounds.minX + 1, height: bounds.maxY - bounds.minY + 1,
        planes: PLANE_COUNT, wideTerrain, tiles, objects, heights,
        npcs: npcs.filter(npc => contains(npc.tileX, npc.tileY)).map(npc => ({
            ...npc, tileX: npc.tileX - bounds.minX, tileY: npc.tileY - bounds.minY,
        })) });
}

/** Snapshots visible persisted NPCs and editor additions, retaining spawn settings rather than wandering positions. */
export function copyAreaNpcs(spawns: readonly BrowserHostNpcSpawn[], edits: readonly EditModeEdit[]): BrowserHostNpcSpawn[] {
    const key = (spawn: BrowserHostNpcSpawn) => `${spawn.id}:${spawn.tileX}:${spawn.tileY}:${spawn.plane}`;
    const overrides = new Map<string, EditModeEdit[]>();
    for (const edit of edits) if (edit.kind === "npcWander") {
        const k = `${edit.locId}:${edit.tileX}:${edit.tileY}:${edit.plane}`;
        const rows = overrides.get(k) ?? [];
        rows.push(edit);
        overrides.set(k, rows);
    }
    return [
        ...spawns.map(spawn => {
            const override = overrides.get(key(spawn))?.shift();
            return { ...spawn, ...(override?.wanderRadius === undefined ? {} : { wanderRadius: override.wanderRadius }),
                ...(override?.direction === undefined ? {} : { direction: override.direction }) };
        }),
        ...edits.filter(edit => edit.kind === "npc").map(edit => ({
            id: edit.locId, tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane,
            direction: edit.direction ?? quarterTurnToDirection(edit.rotation),
            ...(edit.wanderRadius === undefined ? {} : { wanderRadius: edit.wanderRadius }),
        })),
    ];
}

function readAreaTerrain(data: number[], wide: boolean, x: number, y: number, plane: number) {
    if (!Array.isArray(data) || data.length > 64 || data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new Error("Invalid area terrain record");
    }
    let offset = 0;
    const read = (width = wide ? 2 : 1): number => {
        if (offset + width > data.length) throw new Error("Incomplete area terrain record");
        const value = width === 2 ? data[offset] * 256 + data[offset + 1] : data[offset];
        offset += width;
        return value;
    };
    let overlay = 0, shape = 0, rotation = 0, underlay = 0, flag = 0, height = 0;
    for (;;) {
        const opcode = read();
        if (opcode <= 1) {
            height = opcode === 1 ? read(1) : plane === 0 ? generateHeight(x + 932731, y + 556238) : 30;
            if (height === 1) height = 0;
            if (offset !== data.length) throw new Error("Extra bytes in area terrain record");
            return { overlay, shape, rotation, underlay, flag, height };
        }
        if (opcode <= 49) {
            overlay = read(); shape = (opcode - 2) >> 2; rotation = (opcode - 2) & 3;
        } else if (opcode <= 81) flag = opcode - 49;
        else underlay = opcode - 81;
    }
}

/** Validate the entire clipboard before producing one ordinary, undoable editor edit batch. */
export function areaPasteEdits(contents: string, destination: { tileX: number; tileY: number }, wideTerrain: boolean): EditModeEdit[] {
    if (typeof contents !== "string" || contents.length > 20_000_000) throw new Error("Area clipboard is too large");
    const area = JSON.parse(contents);
    const integer = (value: unknown, max: number) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
    if (!area || area.format !== "elvarg-map-area" || area.version !== 1 || area.planes !== 4 ||
        !integer(area.width, 128) || area.width === 0 || !integer(area.height, 128) || area.height === 0 ||
        !integer(area.origin?.x, 16383) || !integer(area.origin?.y, 16383) || typeof area.wideTerrain !== "boolean" ||
        !integer(destination.tileX, 16383 - area.width) || !integer(destination.tileY, 16383 - area.height) ||
        area.origin.x + area.width > 16384 || area.origin.y + area.height > 16384 ||
        !Array.isArray(area.tiles) || area.tiles.length !== area.width * area.height * 4 ||
        !Array.isArray(area.objects) || area.objects.length > 100_000 ||
        (area.npcs !== undefined && (!Array.isArray(area.npcs) || area.npcs.length > 100_000))) {
        throw new Error("Invalid or incomplete area clipboard");
    }
    const edits: EditModeEdit[] = [];
    const add = (kind: EditModeEdit["kind"], x: number, y: number, plane: number, locId: number, shape = 0, rotation = 0) =>
        edits.push({ kind, tileX: destination.tileX + x, tileY: destination.tileY + y, plane, locId, shape, rotation });
    const seen = new Set<string>();
    for (let x = 0; x < area.width; x++) for (let y = 0; y < area.height; y++) add("clear", x, y, 0, 0);
    for (const tile of area.tiles) {
        if (!tile || !integer(tile.x, area.width - 1) || !integer(tile.y, area.height - 1) || !integer(tile.plane, 3)) {
            throw new Error("Invalid area tile");
        }
        const key = `${tile.plane}:${tile.x}:${tile.y}`;
        if (seen.has(key)) throw new Error("Duplicate area tile");
        seen.add(key);
        const terrain = readAreaTerrain(tile.terrain, area.wideTerrain, area.origin.x + tile.x, area.origin.y + tile.y, tile.plane);
        if (!wideTerrain && (terrain.overlay > 255 || terrain.underlay > 174)) throw new Error("Terrain does not fit this cache revision");
        add("underlay", tile.x, tile.y, tile.plane, terrain.underlay);
        add("flag", tile.x, tile.y, tile.plane, terrain.flag);
        if (terrain.overlay) add("terrain", tile.x, tile.y, tile.plane, terrain.overlay, terrain.shape, terrain.rotation);
        add("height", tile.x, tile.y, tile.plane, terrain.height);
    }
    // New copies include the far-edge vertices too. Older v1 copies retain the destination's far edge.
    if (area.heights !== undefined) {
        if (!Array.isArray(area.heights) || area.heights.length !== (area.width + 1) * (area.height + 1) * 4) {
            throw new Error("Incomplete area heights");
        }
        seen.clear();
        for (const vertex of area.heights) {
            if (!vertex || !integer(vertex.x, area.width) || !integer(vertex.y, area.height) ||
                !integer(vertex.plane, 3) || !integer(vertex.height, 255) || vertex.height === 1) throw new Error("Invalid area height");
            const key = `${vertex.plane}:${vertex.x}:${vertex.y}`;
            if (seen.has(key)) throw new Error("Duplicate area height");
            seen.add(key);
            add("height", vertex.x, vertex.y, vertex.plane, vertex.height);
        }
    }
    for (const loc of area.objects) {
        if (!loc || !integer(loc.id, 0x7fffffff) || !integer(loc.x, area.width - 1) ||
            !integer(loc.y, area.height - 1) || !integer(loc.plane, 3) || !integer(loc.shape, 22) || !integer(loc.rotation, 3)) {
            throw new Error("Invalid area object");
        }
        add("place", loc.x, loc.y, loc.plane, loc.id, loc.shape, loc.rotation);
    }
    for (const npc of area.npcs ?? []) {
        if (!npc || !integer(npc.id, 0x7fffffff) || !integer(npc.tileX, area.width - 1) || !integer(npc.tileY, area.height - 1) ||
            !integer(npc.plane, 3) || (npc.direction !== undefined && !integer(npc.direction, 7)) ||
            (npc.wanderRadius !== undefined && !integer(npc.wanderRadius, 255)) || npc.remove !== undefined) throw new Error("Invalid area NPC");
        add("npc", npc.tileX, npc.tileY, npc.plane, npc.id, 0,
            npc.direction === undefined ? 0 : ((DIRECTION_TO_ORIENTATION[npc.direction] ?? 0) / 512) & 3);
        Object.assign(edits[edits.length - 1],
            npc.direction === undefined ? {} : { direction: npc.direction },
            npc.wanderRadius === undefined ? {} : { wanderRadius: npc.wanderRadius });
    }
    return edits;
}

/** Decodes each tile's overlay, shape and rotation from region terrain data, as the scene builder reads them. */
export function readRegionOverlays(
    data: Uint8Array, wideTerrain: boolean, includeUnderlays = false,
): EditModeRegionOverlays & { underlays?: Uint16Array } {
    const tileCount = PLANE_COUNT * MAP_SIZE * MAP_SIZE;
    const result = {
        overlays: new Uint16Array(tileCount),
        shapes: new Uint8Array(tileCount),
        rotations: new Uint8Array(tileCount),
        underlays: includeUnderlays ? new Uint16Array(tileCount) : undefined,
    };
    const width = wideTerrain ? 2 : 1;
    let offset = 0;
    const read = (bytes = width): number => {
        if (offset + bytes > data.length) throw new Error("Truncated region terrain data");
        const value = bytes === 2 ? (data[offset] << 8) | data[offset + 1] : data[offset];
        offset += bytes;
        return value;
    };
    for (let index = 0; index < tileCount; index++) {
        while (true) {
            const opcode = read();
            if (opcode === 0) break;
            if (opcode === 1) {
                read(1);
                break;
            }
            if (opcode <= 49) {
                result.overlays[index] = read();
                result.shapes[index] = (opcode - 2) >> 2;
                result.rotations[index] = (opcode - 2) & 3;
            } else if (opcode > 81 && result.underlays) {
                result.underlays[index] = opcode - 81;
            }
        }
    }
    return result;
}

export function readRegionFlags(data: Uint8Array, wide: boolean): Uint8Array {
    const flags = new Uint8Array(PLANE_COUNT * MAP_SIZE * MAP_SIZE);
    let offset = 0;
    const width = wide ? 2 : 1;
    for (let index = 0; index < flags.length; index++) {
        while (true) {
            if (offset + width > data.length) throw new Error("Truncated region terrain data");
            const opcode = wide ? (data[offset] << 8) | data[offset + 1] : data[offset];
            offset += width;
            if (opcode <= 1) {
                offset += opcode;
                break;
            }
            if (opcode <= 49) offset += width;
            else if (opcode <= 81) flags[index] = opcode - 49;
        }
    }
    return flags;
}

/** Compare complete previews to their original map, preserving ids needed for collision removal. */
export function diffRegionObjects(regionId: number, original: Uint8Array, edited: Uint8Array): ObjectSpawn[] {
    const before = decodeLocs(original);
    const after = decodeLocs(edited);
    const key = (loc: Loc) => `${loc.id}:${loc.x}:${loc.y}:${loc.plane}:${loc.shape}:${loc.rotation}`;
    const beforeKeys = new Set(before.map(key));
    const afterKeys = new Set(after.map(key));
    const record = (loc: Loc): ObjectSpawn => ({
        id: loc.id,
        position: { x: ((regionId >> 8) << 6) + loc.x, y: ((regionId & 0xff) << 6) + loc.y, z: loc.plane },
        type: loc.shape,
        face: loc.rotation,
    });
    return [
        ...before.filter((loc) => !afterKeys.has(key(loc))).map((loc) => ({ ...record(loc), remove: true })),
        ...after.filter((loc) => !beforeKeys.has(key(loc))).map(record),
    ];
}

export function objectSpawnEdits(spawns: readonly ObjectSpawn[]): EditModeEdit[] {
    return spawns.map((spawn) => ({
        kind: spawn.remove ? "delete" : "place",
        locId: spawn.id, tileX: spawn.position.x, tileY: spawn.position.y, plane: spawn.position.z,
        shape: spawn.type ?? 10, rotation: spawn.face ?? 0,
    }));
}

/** Preserve untouched records; pack mode consumes records baked into exported regions. */
export function isLocEdit(edit: EditModeEdit): boolean {
    return edit.kind === "place" || edit.kind === "delete" || edit.kind === "clear";
}

export function buildObjectSpawnExport(
    spawns: readonly ObjectSpawn[],
    edits: readonly EditModeEdit[],
    saveToJson: boolean,
    getObjectData: (regionId: number) => Uint8Array,
): ObjectSpawn[] | undefined {
    const regionId = (x: number, y: number) => ((x >> 6) << 8) | (y >> 6);
    const regions = new Set(edits.filter(isLocEdit).map((edit) => regionId(edit.tileX, edit.tileY)));
    const result = spawns.filter((spawn) => !regions.has(regionId(spawn.position.x, spawn.position.y)));
    if (!saveToJson) return result.length === spawns.length ? undefined : result;
    if (regions.size === 0) return undefined;
    const combined = [...objectSpawnEdits(spawns), ...edits];
    for (const region of regions) {
        const original = getObjectData(region);
        const edited = applyLocEdits(original, combined, region >> 8, region & 0xff);
        result.push(...diffRegionObjects(region, original, edited));
    }
    return result;
}
