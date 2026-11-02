import type { ObjectSpawn } from "./hostProtocol/objectSpawnsMessage";
import type { EditModeEdit } from "./types";

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
        if (edit.kind === "place" && edit.locId > 0) {
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
): Uint8Array {
    const mapX = regionId >> 8;
    const mapY = regionId & 0xff;
    if (
        regionId < 0 ||
        regionId > 0xffff ||
        objectArchiveId < 0 ||
        terrainArchiveId < 0
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

/** MapRegionReplacementManager.MAX_PACKET_PAYLOAD: the server refuses a bigger region and keeps the cache's. */
export const MAX_REGION_PACK_PAYLOAD = 0xfffd;

/** Regions the server would refuse to load, with the size it would measure them at. */
export function oversizedRegionPacks(
    packs: readonly { regionId: number; data: Uint8Array }[],
): { regionId: number; payload: number }[] {
    return packs.flatMap(({ regionId, data }) => {
        const { objectData, terrainData } = parseRegionPack(data);
        const payload = 7 + terrainData.length + objectData.length;
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
): string {
    const tiles: Array<{ x: number; y: number; plane: number; terrain: number[] }> = [];
    const objects: Loc[] = [];
    const contains = (x: number, y: number) => x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
    for (let mapX = bounds.minX >> 6; mapX <= bounds.maxX >> 6; mapX++) {
        for (let mapY = bounds.minY >> 6; mapY <= bounds.maxY >> 6; mapY++) {
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
                        if (contains(worldX, worldY)) tiles.push({
                            x: worldX - bounds.minX, y: worldY - bounds.minY, plane,
                            terrain: Array.from(data.subarray(start, offset)),
                        });
                    }
                }
            }
        }
    }
    // Raw terrain records preserve heights (including procedural height opcodes), flags,
    // underlays, overlays, shapes and rotations exactly. The origin retains noise coordinates.
    return JSON.stringify({ format: "elvarg-map-area", version: 1, origin: { x: bounds.minX, y: bounds.minY },
        width: bounds.maxX - bounds.minX + 1, height: bounds.maxY - bounds.minY + 1,
        planes: PLANE_COUNT, wideTerrain, tiles, objects });
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
export function buildObjectSpawnExport(
    spawns: readonly ObjectSpawn[],
    edits: readonly EditModeEdit[],
    saveToJson: boolean,
    getObjectData: (regionId: number) => Uint8Array,
): ObjectSpawn[] | undefined {
    const regionId = (x: number, y: number) => ((x >> 6) << 8) | (y >> 6);
    const regions = new Set(edits.filter((edit) => edit.kind !== "npc" &&
        edit.kind !== "npcDelete" && edit.kind !== "npcWander" &&
        (!saveToJson || edit.kind === "place" || edit.kind === "delete" || edit.kind === "clear")
    ).map((edit) => regionId(edit.tileX, edit.tileY)));
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
