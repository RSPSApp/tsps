import * as fs from "fs";
import * as path from "path";
import { Boundary } from "../model/Boundary";
import { Location } from "../model/Location";
import { normalizeWorldPluginConfig, type ScopedPluginSettings } from "./WorldPluginConfig";

export type WorldZoneTag = string;

export interface WorldPosition {
    x: number;
    y: number;
    z: number;
}

export interface WorldZone {
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    z?: number;
    tags: WorldZoneTag[];
}

/** Layouts world.json can force on every login (Settings > Display > Game client layout). */
export const WORLD_GAMEFRAMES = ["modern-resizable", "modern-fixed", "317-resizable", "317-fixed"] as const;
export type WorldGameframe = (typeof WORLD_GAMEFRAMES)[number];

export interface WorldDefinitionData {
    name: string;
    spawn: WorldPosition;
    /** Shown under the world's name in the world list (up to 120 characters). */
    description: string;
    zones: WorldZone[];
    experienceMultiplier: number;
    /** Optional: when set, players are switched to this layout on login. */
    gameframe?: WorldGameframe;
    /** False makes this a free-to-play world (FreeToPlay plugin); needs zones tagged "f2p". */
    membersWorld: boolean;
    /** Per-plugin settings, read by PluginManager.getPluginConfig; carried for /api/world. */
    pluginConfig?: Record<string, unknown>;
    /** Plugin name -> on/off over the plugin's own default, read by PluginManager; carried for /api/world. */
    plugins?: Record<string, unknown>;
    /** Older whole-list form of `plugins`, still read by PluginManager; carried for /api/world. */
    disabledPlugins?: unknown;
}

export class WorldDefinitionValidationError extends Error {}

type JsonObject = Record<string, unknown>;


/**
 * world.json with world.local.json layered over it: each top-level key there replaces
 * world.json's, except pluginConfig and plugins, which are merged key by key. Read by both
 * the world definition and PluginManager (plugins, pluginConfig).
 */
export function readWorldConfig(scopedSettings?: ScopedPluginSettings): JsonObject {
    // Resolved per call from the working directory, as PluginManager always did.
    const shipped = object(JSON.parse(fs.readFileSync(path.resolve("data/definitions/world.json"), "utf8")), "world.json");
    // Optional per-deployment overrides (gitignored), so a live world can differ from the
    // shipped world.json (e.g. its XP rate or tutorial) and still update from main by fast-forward.
    const localFile = path.resolve("data/definitions/world.local.json");
    if (!fs.existsSync(localFile)) return normalizeWorldPluginConfig(shipped, scopedSettings);
    const local = object(JSON.parse(fs.readFileSync(localFile, "utf8")), "world.local.json");
    return mergeWorldConfig(shipped, local, scopedSettings);
}

/** The layering rule of readWorldConfig, for callers that already hold both layers. */
export function mergeWorldConfig(shipped: JsonObject, local: JsonObject, scopedSettings?: ScopedPluginSettings): JsonObject {
    shipped = normalizeWorldPluginConfig(shipped, scopedSettings);
    local = normalizeWorldPluginConfig(local, scopedSettings);
    const merged: JsonObject = { ...shipped, ...local };
    for (const key of ["pluginConfig", "plugins"]) {
        const shippedValue = shipped[key];
        const localValue = local[key];
        if (isPlainObject(shippedValue) && isPlainObject(localValue)) {
            merged[key] = { ...shippedValue, ...localValue };
        }
    }
    return merged;
}

function isPlainObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, label: string): JsonObject {
    if (!value || Array.isArray(value) || typeof value !== "object") {
        throw new WorldDefinitionValidationError(`${label} must be an object`);
    }
    return value as JsonObject;
}

function integer(source: JsonObject, key: string, label: string): number {
    const value = source[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new WorldDefinitionValidationError(`${label}.${key} must be an integer`);
    }
    return value;
}

function positiveNumber(source: JsonObject, key: string, label: string): number {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new WorldDefinitionValidationError(`${label}.${key} must be a positive number`);
    }
    return value;
}

function coordinate(source: JsonObject, key: string, label: string): number {
    const value = integer(source, key, label);
    if (value < 0 || value > 0x3fff) {
        throw new WorldDefinitionValidationError(`${label}.${key} is outside the world`);
    }
    return value;
}

function plane(source: JsonObject, label: string): number {
    const value = integer(source, "z", label);
    if (value < 0 || value > 3) {
        throw new WorldDefinitionValidationError(`${label}.z must be between 0 and 3`);
    }
    return value;
}

export function parseWorldPosition(value: unknown, label = "world spawn"): WorldPosition {
    const position = object(value, label);
    return {
        x: coordinate(position, "x", label),
        y: coordinate(position, "y", label),
        z: plane(position, label),
    };
}

const ZONE_BOUND_KEYS = ["minX", "maxX", "minY", "maxY", "z"] as const;

export function parseWorldZone(value: unknown, label = "world zone"): WorldZone {
    const zone = object(value, label);
    const bounded = ZONE_BOUND_KEYS.some((key) => zone[key] !== undefined);
    const parsed: WorldZone = bounded
        ? {
              minX: coordinate(zone, "minX", label),
              maxX: coordinate(zone, "maxX", label),
              minY: coordinate(zone, "minY", label),
              maxY: coordinate(zone, "maxY", label),
              z: plane(zone, label),
              tags: [],
          }
        : { tags: [] };
    if (bounded && (parsed.minX! > parsed.maxX! || parsed.minY! > parsed.maxY!)) {
        throw new WorldDefinitionValidationError(`${label} has reversed bounds`);
    }
    if (!Array.isArray(zone.tags)) {
        throw new WorldDefinitionValidationError(`${label}.tags must be a non-empty array`);
    }
    if (bounded && zone.tags.length === 0) {
        throw new WorldDefinitionValidationError(`${label}.tags must be a non-empty array`);
    }
    for (const tag of new Set(zone.tags)) {
        if (typeof tag !== "string") {
            throw new WorldDefinitionValidationError(
                `${label}.tags must contain strings`
            );
        }
        parsed.tags.push(tag);
    }
    return parsed;
}

/** True when the zone covers (x, y) on any plane; a zone without bounds covers everything. */
export function zoneContains(zone: WorldZone, x: number, y: number): boolean {
    return zone.minX === undefined ||
        (x >= zone.minX && x <= zone.maxX! && y >= zone.minY! && y <= zone.maxY!);
}

export function parseWorldDefinition(value: unknown): WorldDefinitionData {
    const world = object(value, "world.json");
    if (!Array.isArray(world.zones)) {
        throw new WorldDefinitionValidationError("world.json zones must be an array");
    }
    const experienceMultiplier = world.experienceMultiplier === undefined
        ? 1
        : positiveNumber(world, "experienceMultiplier", "world.json");
    if (world.gameframe !== undefined && !WORLD_GAMEFRAMES.includes(world.gameframe as WorldGameframe)) {
        throw new WorldDefinitionValidationError(`world.json gameframe must be one of ${WORLD_GAMEFRAMES.join(", ")}`);
    }
    if (world.membersWorld !== undefined && typeof world.membersWorld !== "boolean") {
        throw new WorldDefinitionValidationError("world.json membersWorld must be a boolean");
    }
    const name = world.name === undefined ? "Old School RuneScape" : world.name;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 64 || /[\x00-\x1f\x7f<>]/.test(name)) {
        throw new WorldDefinitionValidationError("world.json name must be plain text between 1 and 64 characters");
    }
    const membersWorld = world.membersWorld !== false;
    const description = world.description ?? "";
    if (typeof description !== "string" || description.length > 120) {
        throw new WorldDefinitionValidationError("world.json description must be a string of at most 120 characters");
    }
    const zones = world.zones.map((zone, index) =>
        parseWorldZone(zone, `world.json zones[${index}]`)
    );
    const spawn = parseWorldPosition(world.spawn, "world.json spawn");
    // Players outside free land are sent to the spawn, so it must be inside.
    if (!membersWorld && !zones.some((zone) => zone.tags.includes("f2p") && zoneContains(zone, spawn.x, spawn.y))) {
        throw new WorldDefinitionValidationError("world.json membersWorld false needs the spawn inside a zone tagged \"f2p\"");
    }
    return {
        spawn,
        name: name.trim(),
        description: description.trim(),
        zones,
        experienceMultiplier,
        membersWorld,
        ...(world.gameframe !== undefined && { gameframe: world.gameframe as WorldGameframe }),
        // Malformed config is ignored here as in PluginManager.loadPluginConfig, not fatal.
        ...(world.pluginConfig && typeof world.pluginConfig === "object" && !Array.isArray(world.pluginConfig) &&
            { pluginConfig: world.pluginConfig as Record<string, unknown> }),
        // Validated where they are read, by PluginManager.
        ...(isPlainObject(world.plugins) && { plugins: world.plugins }),
        ...(world.disabledPlugins !== undefined && { disabledPlugins: world.disabledPlugins }),
    };
}

const definition = parseWorldDefinition(readWorldConfig());

export const WORLD_SPAWN = new Location(
    definition.spawn.x,
    definition.spawn.y,
    definition.spawn.z
);

export const WORLD_ZONE_BOUNDARIES: Record<WorldZoneTag, Boundary[]> = Object.assign(Object.create(null), {
    duel: [],
    pvp: [],
    safe: [],
    "multi-combat": [],
    "all-buildings-safe": [],
});

function zoneBoundaries(zone: WorldZone): Boundary[] {
    if (zone.minX === undefined) {
        return [0, 1, 2, 3].map((z) => new Boundary(0, 0x3fff, 0, 0x3fff, z));
    }
    return [new Boundary(zone.minX, zone.maxX!, zone.minY!, zone.maxY!, zone.z!)];
}

// Free land per 64x64 map square: true when one "f2p" zone covers the whole square,
// otherwise the "f2p" zones overlapping it. isMembersArea runs per player per tick,
// so this keeps it to one map lookup instead of a scan of every zone.
const freeLandBySquare = new Map<number, true | WorldZone[]>();
let freeEverywhere = false;

function indexFreeLand(): void {
    freeLandBySquare.clear();
    freeEverywhere = false;
    for (const zone of definition.zones) {
        if (!zone.tags.includes("f2p")) continue;
        if (zone.minX === undefined) {
            freeEverywhere = true;
            continue;
        }
        for (let squareX = zone.minX >> 6; squareX <= zone.maxX! >> 6; squareX++) {
            for (let squareY = zone.minY! >> 6; squareY <= zone.maxY! >> 6; squareY++) {
                const key = (squareX << 8) | squareY;
                const entry = freeLandBySquare.get(key);
                if (entry === true) continue;
                const coversSquare = zone.minX <= squareX << 6 && zone.maxX! >= (squareX << 6) + 63 &&
                    zone.minY! <= squareY << 6 && zone.maxY! >= (squareY << 6) + 63;
                if (coversSquare) freeLandBySquare.set(key, true);
                else if (entry) entry.push(zone);
                else freeLandBySquare.set(key, [zone]);
            }
        }
    }
}

function syncRuntime(): void {
    WORLD_SPAWN.set(definition.spawn.x, definition.spawn.y, definition.spawn.z);
    for (const boundaries of Object.values(WORLD_ZONE_BOUNDARIES)) boundaries.length = 0;
    for (const zone of definition.zones) {
        const boundaries = zoneBoundaries(zone);
        for (const tag of zone.tags) {
            // "f2p" zones are matched on x/y across all planes via the freeLandBySquare index,
            // so single-plane Boundary objects for them would only mislead.
            if (tag !== "f2p") (WORLD_ZONE_BOUNDARIES[tag] ??= []).push(...boundaries);
        }
    }
    indexFreeLand();
}

function copyWorldDefinition(): WorldDefinitionData {
    return {
        spawn: { ...definition.spawn },
        name: definition.name,
        description: definition.description,
        zones: definition.zones.map((zone) => ({ ...zone, tags: [...zone.tags] })),
        experienceMultiplier: definition.experienceMultiplier,
        membersWorld: definition.membersWorld,
        ...(definition.gameframe !== undefined && { gameframe: definition.gameframe }),
        ...(definition.pluginConfig !== undefined && { pluginConfig: structuredClone(definition.pluginConfig) }),
        ...(definition.plugins !== undefined && { plugins: { ...definition.plugins } }),
        ...(definition.disabledPlugins !== undefined && { disabledPlugins: structuredClone(definition.disabledPlugins) }),
    };
}

export function getWorldDefinition(): WorldDefinitionData {
    return copyWorldDefinition();
}

export function isMembersWorld(): boolean {
    return definition.membersWorld;
}

/**
 * True on a free-to-play world for tiles outside every "f2p" zone. Zones match on
 * x/y only, so one box covers every plane.
 */
export function isMembersArea(x: number, y: number): boolean {
    if (definition.membersWorld || freeEverywhere) return false;
    const entry = freeLandBySquare.get(((x >> 6) << 8) | (y >> 6));
    return entry !== true && !entry?.some((zone) => zoneContains(zone, x, y));
}

export function hasGlobalWorldTag(tag: WorldZoneTag): boolean {
    return definition.zones.some((zone) => zone.minX === undefined && zone.tags.includes(tag));
}

syncRuntime();
