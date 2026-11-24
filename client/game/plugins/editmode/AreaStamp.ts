import type { EditModeEdit, EditModePreviewEdit, EditModeTile } from "./types";
import type { GroundItemPlacement } from "./EditorGroundItems";
import { generateHeight } from "../../../rs/util/HeightCalc";
import { deltaToDirection, directionToDelta, directionToOrientation, quarterTurnToDirection } from "../../../common/Direction";

export const MAX_STAMP_TILES = 4096;
const WORLD_SIZE = 16384;
const SIZED_SHAPES = new Set([10, 11, 22]);

type Offset = { x: number; y: number; plane: number };
type StampFloor = Offset & {
    overlay?: { id: number; shape: number; rotation: number };
    underlay?: number;
    flag?: number;
    height?: number;
};
type StampObject = Offset & { id: number; shape: number; rotation: number };
type StampNpc = Offset & { id: number; direction?: number; wanderRadius?: number; leashRadius?: number | null };
type StampGroundItem = Offset & { id: number; amt: number; respawn: number; members?: boolean };

export type AreaStamp = {
    name?: string;
    foundation?: boolean;
    width: number;
    height: number;
    floors: StampFloor[];
    objects: StampObject[];
    npcs: StampNpc[];
    items: StampGroundItem[];
    /** A complete editor export can also clear the destination's empty floor layers. */
    complete: boolean;
};

export type AreaStampOptions = {
    turns: number;
    terrain: "objects" | "floors" | "all";
    interactive: boolean;
    entities?: boolean;
    foundation?: boolean;
};

export type StampObjectInfo = { sizeX: number; sizeY: number; interactive: boolean };

function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        throw new Error("The area file contains an out-of-range map value");
    }
    return value;
}

type RecordData = Record<string, unknown>;
function record(value: unknown): RecordData {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid map area record");
    return value as RecordData;
}

function decodeFloor(data: unknown, wide: boolean): Omit<StampFloor, keyof Offset> {
    if (!Array.isArray(data) || data.length > 32) throw new Error("Invalid terrain record");
    const bytes = data.map((byte) => integer(byte, 0, 255));
    let offset = 0;
    const byte = () => {
        const value = bytes[offset++];
        if (value === undefined) throw new Error("Incomplete terrain record");
        return value;
    };
    const value = () => wide ? byte() * 256 + byte() : byte();
    const floor: Omit<StampFloor, keyof Offset> = {};
    for (;;) {
        const opcode = value();
        if (opcode < 2) {
            if (opcode === 1) floor.height = byte();
            if (offset !== bytes.length) throw new Error("Invalid terrain record ending");
            return floor;
        }
        if (opcode <= 49) floor.overlay = { id: value(), shape: (opcode - 2) >> 2, rotation: (opcode - 2) & 3 };
        else if (opcode <= 81) floor.flag = opcode - 49;
        else floor.underlay = opcode - 81;
    }
}

/** Accept older editor clipboard exports and the server's capture_template files. */
export function parseAreaStamp(value: unknown): AreaStamp {
    const source = record(value);
    const complete = source.format === "elvarg-map-area" && source.version === 1;
    if (!complete && (source.format !== undefined || typeof source.name !== "string" || !source.source)) {
        throw new Error("Choose an area exported by the map editor or saved by the template tool");
    }
    const width = integer(source.width, 1, MAX_STAMP_TILES);
    const height = integer(source.height, 1, MAX_STAMP_TILES);
    if (width * height > MAX_STAMP_TILES) throw new Error(`An area can cover up to ${MAX_STAMP_TILES} tiles`);
    const maxTerrainRecords = complete ? width * height * 4 : (width + 1) * (height + 1) * 4;
    if (!Array.isArray(source.objects) || source.objects.length > width * height * 16 ||
        !Array.isArray(source.tiles) || source.tiles.length > maxTerrainRecords) {
        throw new Error("Invalid map area contents");
    }

    const offset = (entry: RecordData): Offset => ({
        x: integer(complete ? entry.x : entry.dx, 0, width - 1),
        y: integer(complete ? entry.y : entry.dy, 0, height - 1),
        plane: integer(complete ? entry.plane : entry.z, 0, 3),
    });
    const overlay = (data: unknown): StampFloor["overlay"] => {
        if (data == null) return undefined;
        const info = record(data);
        return { id: integer(info.id, 0, 65535), shape: integer(info.shape, 0, 11), rotation: integer(info.rotation, 0, 3) };
    };
    const optional = (data: unknown, max: number) => data == null ? undefined : integer(data, 0, max);
    const floors = source.tiles.map((tile) => {
        const entry = record(tile);
        // A generated roof/floor can supply height on its outer north/east vertices.
        const vertexOnly = !complete && entry.height !== undefined &&
            entry.overlay === undefined && entry.flag === undefined && entry.underlay === undefined;
        const at = vertexOnly
            ? { x: integer(entry.dx, 0, width), y: integer(entry.dy, 0, height), plane: integer(entry.z, 0, 3) }
            : offset(entry);
        if (complete) {
            const floor = decodeFloor(entry.terrain, source.wideTerrain === true);
            if (at.plane === 0 && floor.height === undefined && source.origin) {
                const origin = record(source.origin);
                floor.height = generateHeight(integer(origin.x, 0, 16383) + at.x + 932731,
                    integer(origin.y, 0, 16383) + at.y + 556238);
            }
            return { ...at, ...floor };
        }
        return {
            ...at,
            overlay: overlay(entry.overlay),
            underlay: optional(entry.underlay, 65454),
            flag: optional(entry.flag, 32),
            height: optional(entry.height, 255),
        };
    });
    const entities = (list: unknown): RecordData[] => {
        if (list === undefined) return [];
        if (!Array.isArray(list) || list.length > MAX_STAMP_TILES) throw new Error("The area contains too many spawn entries");
        return list.map(record);
    };
    return {
        name: typeof source.name === "string" ? source.name : undefined,
        foundation: typeof source.foundation === "boolean" ? source.foundation
            : !complete && floors.some((floor) => floor.plane === 0 && ((floor.flag ?? 0) & 4) !== 0),
        width, height, floors, complete,
        npcs: entities(source.npcs).map((entry) => ({
            ...offset(entry), id: integer(entry.id, 0, 65535),
            direction: optional(entry.direction, 7), wanderRadius: optional(entry.wanderRadius, 255),
            leashRadius: entry.leashRadius === null ? null : optional(entry.leashRadius, 255),
        })),
        items: entities(source.items).map((entry) => ({
            ...offset(entry), id: integer(entry.id, 0, 65535), amt: integer(entry.amt, 1, 2147483647),
            respawn: optional(entry.respawn, 86400) ?? 0, members: entry.members === true,
        })),
        objects: source.objects.map((object) => {
            const entry = record(object);
            return {
                ...offset(entry),
                id: integer(entry.id, 1, 0x7fffffff),
                shape: integer(complete ? entry.shape : entry.type, 0, 22),
                rotation: integer(complete ? entry.rotation : entry.face, 0, 3),
            };
        }),
    };
}

export function stampSize(area: AreaStamp, turns: number): [number, number] {
    return turns % 2 ? [area.height, area.width] : [area.width, area.height];
}

export function planAreaStamp(
    area: AreaStamp,
    target: EditModeTile,
    options: AreaStampOptions,
    objectInfo: (id: number) => StampObjectInfo | undefined,
): { edits: EditModeEdit[]; items: GroundItemPlacement[]; skipped: number } {
    const turns = options.turns & 3;
    const [width, height] = stampSize(area, turns);
    if (target.tileX < 0 || target.tileY < 0 || target.tileX + width > WORLD_SIZE || target.tileY + height > WORLD_SIZE) {
        throw new Error("The area would extend past the edge of the world");
    }
    const edits: EditModeEdit[] = [];
    const items: GroundItemPlacement[] = [];
    let skipped = 0;
    const turn = (x: number, y: number, sizeX: number, sizeY: number): [number, number] => {
        if (turns === 1) return [y, area.width - x - sizeX];
        if (turns === 2) return [area.width - x - sizeX, area.height - y - sizeY];
        if (turns === 3) return [area.height - y - sizeY, x];
        return [x, y];
    };
    for (const object of area.objects) {
        const info = objectInfo(object.id);
        const plane = target.plane + object.plane;
        if (!info || plane > 3 || (info.interactive && !options.interactive)) {
            skipped++;
            continue;
        }
        const sized = SIZED_SHAPES.has(object.shape);
        let sizeX = sized ? info.sizeX : 1;
        let sizeY = sized ? info.sizeY : 1;
        if (object.rotation & 1) [sizeX, sizeY] = [sizeY, sizeX];
        const [x, y] = turn(object.x, object.y, sizeX, sizeY);
        const turnedSizeX = turns & 1 ? sizeY : sizeX;
        const turnedSizeY = turns & 1 ? sizeX : sizeY;
        if (x < 0 || y < 0 || x + turnedSizeX > width || y + turnedSizeY > height) {
            skipped++;
            continue;
        }
        edits.push({
            kind: "place", tileX: target.tileX + x, tileY: target.tileY + y, plane,
            locId: object.id, shape: object.shape, rotation: (object.rotation + turns) & 3,
        });
    }
    if (options.entities) {
        for (const npc of area.npcs) {
            const plane = target.plane + npc.plane;
            if (plane > 3) continue;
            const [x, y] = turn(npc.x, npc.y, 1, 1);
            // NPC angles are packed as eight compass directions. Preserve the diagonals too.
            const source = npc.direction ?? quarterTurnToDirection(0);
            let { dx, dy } = directionToDelta(source);
            for (let turn = 0; turn < turns; turn++) [dx, dy] = [dy, -dx];
            const direction = deltaToDirection(dx, dy);
            const rotation = direction === undefined ? 0 : (directionToOrientation(direction) / 512) & 3;
            edits.push({ kind: "npc", tileX: target.tileX + x, tileY: target.tileY + y, plane,
                locId: npc.id, shape: 10, rotation, direction, wanderRadius: npc.wanderRadius, leashRadius: npc.leashRadius });
        }
        for (const item of area.items) {
            const z = target.plane + item.plane;
            if (z > 3) continue;
            const [x, y] = turn(item.x, item.y, 1, 1);
            items.push({ id: item.id, location: { x: target.tileX + x, y: target.tileY + y, z },
                amt: item.amt, respawn: item.respawn, members: item.members });
        }
    }
    if (options.terrain === "objects") return { edits, items, skipped };
    for (const floor of area.floors) {
        const plane = target.plane + floor.plane;
        if (plane > 3) continue;
        const [x, y] = turn(floor.x, floor.y, 1, 1);
        const at = { tileX: target.tileX + x, tileY: target.tileY + y, plane };
        const overlay = floor.overlay;
        if (overlay || area.complete) {
            edits.push({ kind: "terrain", ...at, locId: overlay?.id ?? 0, shape: overlay?.shape ?? 0, rotation: ((overlay?.rotation ?? 0) + turns) & 3 });
        }
        const flag = area.complete && options.terrain === "all" ? floor.flag ?? 0 : (floor.flag ?? 0) & ~3;
        if (flag || (area.complete && options.terrain === "all")) edits.push({ kind: "flag", ...at, locId: flag, shape: 0, rotation: 0 });
        if (options.terrain === "all" && (floor.underlay !== undefined || area.complete)) {
            edits.push({ kind: "underlay", ...at, locId: floor.underlay ?? 0, shape: 0, rotation: 0 });
        }
        if (floor.height !== undefined && (options.terrain === "all" || floor.plane > 0)) {
            // Heights belong to vertices, unlike the tile's paint and object anchor.
            const [vx, vy] = turn(floor.x, floor.y, 0, 0);
            if (target.tileX + vx >= WORLD_SIZE || target.tileY + vy >= WORLD_SIZE) continue;
            edits.push({ kind: "height", ...at, tileX: target.tileX + vx, tileY: target.tileY + vy,
                locId: floor.height, shape: 0, rotation: 0 });
        }
    }
    return { edits, items, skipped };
}


/** Preview the planned heights and ground paint along with the locs. */
export function previewAreaStamp(
    edits: readonly EditModeEdit[],
    plane: number,
    sample: (tile: EditModeTile) => number | undefined,
    objectInfo: (id: number) => StampObjectInfo | undefined,
): { objects: EditModePreviewEdit[]; floors: EditModePreviewEdit[] } {
    const key = ({ tileX, tileY, plane }: EditModeTile): string => `${tileX}:${tileY}:${plane}`;
    const heights = new Map(edits.filter((edit) => edit.kind === "height").map((edit) => [key(edit), edit.locId]));
    const absoluteHeights = new Map<string, number | undefined>();
    const absolute = (tile: EditModeTile): number | undefined => {
        const id = key(tile);
        if (absoluteHeights.has(id)) return absoluteHeights.get(id);
        const byte = heights.get(id);
        const base = tile.plane === 0 ? 0 : byte === undefined ? undefined : absolute({ ...tile, plane: tile.plane - 1 });
        const height = byte === undefined ? sample(tile) : base === undefined ? undefined : base - (byte === 1 ? 0 : byte) / 16;
        absoluteHeights.set(id, height);
        return height;
    };
    const preview = (edit: EditModeEdit): EditModePreviewEdit => {
        const info = edit.kind === "place" ? objectInfo(edit.locId) : undefined;
        const width = ((edit.rotation & 1) ? info?.sizeY : info?.sizeX) ?? 1;
        const depth = ((edit.rotation & 1) ? info?.sizeX : info?.sizeY) ?? 1;
        const x = edit.tileX + Math.floor(width / 2), y = edit.tileY + Math.floor(depth / 2);
        const across = width & 1, along = depth & 1;
        const corners = [[x, y], [x + across, y], [x, y + along], [x + across, y + along]];
        const values = corners.map(([tileX, tileY]) => absolute({ tileX, tileY, plane: edit.plane }));
        const previewHeight = values.every((height) => height !== undefined)
            ? values.reduce<number>((sum, height) => sum + (height ?? 0), 0) / values.length : undefined;
        return { ...edit, previewHeight };
    };
    const objects = edits.filter((edit) => edit.kind === "place");
    const floors = edits.filter((edit) => edit.kind === "terrain" && edit.plane === plane && edit.locId > 0);
    // Generated towns fit under this. Very large clipboard imports sample across the whole stamp.
    const limit = 4000;
    const visible = objects.length <= limit ? objects
        : Array.from({ length: limit }, (_, index) => objects[Math.floor(index * objects.length / limit)]);
    return { objects: visible.map(preview), floors: floors.map(preview) };
}
