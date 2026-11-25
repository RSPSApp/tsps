import { getCustomDefinitionKey } from "../../../custom/definitions/CustomDefinitionStore";
import { connectEditorCustomContent } from "./EditorCustomContent";
import { OBJECT_SPAWNS_MESSAGE, OBJECT_SPAWNS_REQUEST_MESSAGE, parseObjectSpawns, type ObjectSpawn, type ObjectSpawnsMessage } from "./hostProtocol/objectSpawnsMessage";
import { isKnownWaterTextureId } from "../../../render/water/WaterTextureIds";
import { adjustOverlayLight, HSL_RGB_MAP } from "../../../rs/util/ColorUtil";
import { getContentApiBase } from "../../../network/serverConnection/contentApi";
import { TILE_FLAG_UNDER_ROOF } from "../../scene/TileRenderFlags";
import { ClientState } from "../../ClientState";
import { GameState } from "../../login/GameState";
import { setAudioSuspended } from "../../audio/audioContext";
import type { EditorOverlays } from "../../../render/webgpu/overlays/EditorOverlays";
import type { App as PicoApp, UniformBuffer } from "picogl";
import type { Ray } from "../../math/Raycast";
import type { SceneRaycastHit, SceneRaycastOptions, SceneRaycaster } from "../../scene/SceneRaycaster";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { IndexType } from "../../../rs/cache/IndexType";
import { packWorldMapCoord } from "../../../rs/map/WorldMapArea";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { DIRECTION_TO_ORIENTATION, MovementDirection, quarterTurnToDirection } from "../../../common/Direction";
import { InteractType } from "../../../render/InteractType";
import type { MinimapIcon } from "../../../render/loader/SdMapData";
import { isDoorLocType } from "../../../render/loc/SceneLocs";
import type {
    InteractHighlightTarget,
    LocHighlightTarget,
} from "../../../render/render/constants";
import type { InteractHighlightDrawTarget } from "../../../ui/devoverlay/InteractHighlightOverlay";
import { MapManager } from "../../MapManager";
import { sendChat } from "../../../network/serverConnection/outgoing/inventoryChat";
import type { Overlay } from "../../../ui/devoverlay/Overlay";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import {
    copyRegionPackBytes,
    REGION_PACK_MESSAGE,
    REGION_PACK_REQUEST_MESSAGE,
    type RegionPackMessage,
} from "./hostProtocol/regionPackMessage";
import { browserHostOrigin, browserHostWindow } from "./hostProtocol/origin";
import { isBrowserHostClient, isMapEditorUrl } from "../../../config/clientEnv";
import {
    NPC_SPAWN_MESSAGE,
    NPC_SPAWN_REQUEST_MESSAGE,
    classifyNpcSpawnPatch,
    HiddenNpcSpawns,
    loadNpcSpawnRegion,
    npcSpawnKey,
    parseNpcSpawnRecords,
    parseNpcSpawns,
    regionIdForTile,
    type BrowserHostNpcSpawn,
    type LoadedNpcSpawnEntry as LoadedNpcSpawnRegionEntry,
    type NpcSpawnMessage,
    type NpcSpawnRecord,
} from "./hostProtocol/npcSpawnMessage";
import {
    WORLD_DEFINITION_MESSAGE,
    WORLD_DEFINITION_REQUEST_MESSAGE,
    type WorldDefinitionMessage,
} from "./hostProtocol/worldDefinitionMessage";
import type { OsrsClient } from "../../OsrsClient";
import { createBrowserEditModePluginPersistence } from "./BrowserEditModePluginPersistence";
import { buildingWallKey, detectRectangularBuilding, type BuildingMapLoc, type DetectedBuilding } from "./BuildingDetector";
import { pickEditorTile, pickEditorTileHit, type EditorPickMap } from "./EditorTilePicking";
import { EditModePlugin } from "./EditModePlugin";
import type { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import type { LocModelType } from "../../../rs/config/loctype/LocModelType";
import type { Model2DRenderer } from "../../../ui/model/Model2DRenderer";
import { Model } from "../../../rs/model/Model";
import { parseEditorLocation } from "./EditorCoordinates";
import { mountEditorUi } from "./EditorUi";
import { EditorWorldMap } from "./EditorWorldMap";
import {
    MapIconGroundOverlay,
    type MapIconGroundEntry,
} from "./MapIconGroundOverlay";
import {
    LocPlacementPreviewOverlay,
    ScatterPlacementPreviewOverlay,
    getLocPlacementShape,
    type LocPlacementPreview,
    type LocPlacementPreviewClient,
    type LocPlacementPreviewRenderer,
} from "./LocPlacementPreviewOverlay";
import { ModelImageCaptureOverlay } from "./ModelImageCaptureOverlay";
import { buildAreaClipboard, copyAreaNpcs, buildRegionPack, createRegionPack, parseRegionPack, buildObjectSpawnExport, isLocEdit, objectSpawnEdits, readRegionFlags, readRegionOverlays } from "./RegionPack";
import {
    ZoneGroundOverlay,
    type ZoneGroundRect,
} from "./ZoneGroundOverlay";
import type {
    EditModeDefinitionSummary,
    EditModeBuildingProfile,
    EditModeEdit,
    EditModeSearchKind,
    EditModeSearchResult,
    EditModeTile,
    EditModeWorldDefinition,
    EditModeWorldZone,
} from "./types";
import { LOC_SHAPE_NORMAL } from "./types";
import type { InteractHighlightPluginConfig } from "../interacthighlight/InteractHighlightConfig";

/** Synthetic server ids for editor NPCs, kept clear of the server's own range. */
const EDITOR_NPC_SERVER_ID_BASE = 60000;
const EDITOR_NPC_PREVIEW_SERVER_ID = 59999;
const EDITOR_SELECTION_TILE_SLOT = 255;
const EDITOR_SELECTION_TILE_GROUP = 255;
const EDITOR_HOVER_TILE_SLOT = 254;
const EDITOR_HOVER_TILE_GROUP = 254;
const EDITOR_SPAWN_TILE_SLOT = 253;
const EDITOR_SPAWN_TILE_GROUP = 253;
const EDITOR_PATH_TILE_SLOT = 252;
const EDITOR_PATH_TILE_GROUP = 252;
const EDITOR_BLOCKED_TILE_SLOT = 251;
const EDITOR_TRAVEL_SOURCE_SLOT = 250;
const EDITOR_TRAVEL_ARRIVAL_SLOT = 249;
const TILE_HIGHLIGHT_ALWAYS_ON_TOP = 0x10;
const EDITOR_SELECTION_MAX_SPAN = 128;
const SEARCH_RESULT_LIMIT = 60;
/** North-up at the standard RS working angle: the title-screen preset sits off-axis and reads as skewed. */
const EDITOR_CAMERA_YAW = 0;
const EDITOR_CAMERA_PITCH = 210;
const PVP_ZONE_COLOR = 0xef4444;
const MULTI_COMBAT_ZONE_COLOR = 0xf59e0b;
const ZONE_OVERLAY_ALPHA = 0.14;
const SPAWN_TILE_COLOR = 0xa855f7;
const PATH_PREVIEW_COLOR = 0xfbbf24;
const WALL_PREVIEW_GROUND_COLOR = 0x78965f;
const EDITOR_INTERACT_HIGHLIGHT: InteractHighlightPluginConfig = {
    enabled: true,
    showHover: true,
    showInteract: true,
    hoverColor: 0xffffff,
    interactColor: 0xffffff,
    itemShowHover: true,
    itemShowInteract: true,
    itemHoverColor: 0xffffff,
    itemInteractColor: 0xffffff,
};

type EditorRegionReplacement = {
    terrainData: Uint8Array;
    objectData?: Uint8Array;
};

/** Include scenery that has no game menu entry when picking in Creator. */
function raycastEditorHits(
    raycaster: Pick<SceneRaycaster, "raycast">,
    ray: Ray,
    options: SceneRaycastOptions,
): SceneRaycastHit[] {
    const editorRaycaster = raycaster as typeof raycaster & {
        isLocTypeInteractive?: (locType: unknown) => boolean;
    };
    const originalFilter = editorRaycaster.isLocTypeInteractive;
    try {
        if (originalFilter) editorRaycaster.isLocTypeInteractive = () => true;
        return editorRaycaster.raycast(ray, options);
    } finally {
        if (originalFilter) editorRaycaster.isLocTypeInteractive = originalFilter;
    }
}

export function raycastEditScene(
    raycaster: Pick<SceneRaycaster, "raycast">,
    ray: Ray,
    basePlane?: number,
    onlyObjects = false,
): SceneRaycastHit | undefined {
    return raycastEditorHits(raycaster, ray, { maxDistance: 4096, maxHits: 1000, basePlane }).find(
        (hit) => hit.interactType === InteractType.LOC ||
            (!onlyObjects && hit.interactType === InteractType.NPC && hit.playerEcsIndex === undefined),
    );
}

/** Tiles the camera pulls back along its view ray when framing a tile. */
const EDITOR_CAMERA_DISTANCE = 22;
/** Tighter opening frame so the editor starts near the configured world spawn. */
const EDITOR_OPENING_CAMERA_DISTANCE = 14;
/** Types decoded per frame while indexing, so the client keeps rendering. */
const INDEX_CHUNK = 2000;

type NameIndex = ReadonlyArray<EditModeSearchResult>;

interface NamedTypeLoader {
    getCount(): number;
    load(id: number): { name?: string } | undefined;
    clearCache(): void;
}

let indexKey = "";
const indexes = new Map<EditModeSearchKind, NameIndex>();
const indexPromises = new Map<EditModeSearchKind, Promise<NameIndex>>();

async function buildNameIndex(loader: NamedTypeLoader): Promise<NameIndex> {
    const results: EditModeSearchResult[] = [];
    const count = loader.getCount() | 0;
    for (let id = 0; id < count; id++) {
        try {
            const name = loader.load(id)?.name;
            if (name && name !== "null") results.push({ id, name });
        } catch {
            // Types that fail to decode simply do not appear in the palette.
        }
        if (id % INDEX_CHUNK === INDEX_CHUNK - 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    // Decoding every type fills the loader cache; drop it, we only kept names.
    loader.clearCache();
    return results;
}

function getNameIndex(kind: EditModeSearchKind, loader: NamedTypeLoader): Promise<NameIndex> {
    const key = getCustomDefinitionKey();
    if (key !== indexKey) {
        indexes.clear();
        indexPromises.clear();
        indexKey = key;
    }
    const cached = indexes.get(kind);
    if (cached) return Promise.resolve(cached);

    let pending = indexPromises.get(kind);
    if (!pending) {
        pending = buildNameIndex(loader).then((index) => {
            if (key === indexKey) {
                indexes.set(kind, index);
                indexPromises.delete(kind);
            }
            return index;
        });
        indexPromises.set(kind, pending);
    }
    return pending;
}

function displayValue(value: unknown): string {
    if (value instanceof Map) return JSON.stringify(Object.fromEntries(value));
    if (Array.isArray(value)) return value.filter((entry) => entry != null).join(", ") || "—";
    if (value == null || value === "") return "—";
    return String(value);
}

const DEFINITION_FIELDS: Record<EditModeSearchKind, string[]> = {
    npc: [
        "modelIds",
        "size",
        "combatLevel",
        "actions",
        "idleSeqId",
        "walkSeqId",
        "attackLevel",
        "defenceLevel",
        "strengthLevel",
        "hitpoints",
        "rangedLevel",
        "magicLevel",
        "attackSpeed",
        "transforms",
    ],
    loc: [
        "models",
        "types",
        "sizeX",
        "sizeY",
        "actions",
        "clipType",
        "blocksProjectile",
        "seqId",
        "mapFunctionId",
        "mapSceneId",
        "transforms",
    ],
    item: [
        "model",
        "examine",
        "price",
        "stackability",
        "isMembers",
        "isTradable",
        "weight",
        "groundActions",
        "inventoryActions",
        "wearPos",
        "note",
        "placeholder",
    ],
};

function describeDefinition(
    client: OsrsClient,
    kind: EditModeSearchKind,
    id: number,
): EditModeDefinitionSummary | undefined {
    const loader = kind === "npc" ? client.npcTypeLoader : kind === "item" ? client.objTypeLoader : client.locTypeLoader;
    const definition = loader?.load(id) as unknown as Record<string, unknown> | undefined;
    if (!definition) return undefined;
    return {
        id,
        kind,
        name: String(definition.name || "Unnamed"),
        fields: DEFINITION_FIELDS[kind].map((field) => [field, displayValue(definition[field])]),
    };
}

const worldInteger = (value: unknown, label: string): number => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`${label} must be an integer`);
    }
    return value;
};

const worldCoordinate = (value: unknown, label: string): number => {
    const coordinate = worldInteger(value, label);
    if (coordinate < 0 || coordinate > 0x3fff) throw new Error(`${label} is outside the world`);
    return coordinate;
};

const worldPlane = (value: unknown, label: string): number => {
    const plane = worldInteger(value, label);
    if (plane < 0 || plane > 3) throw new Error(`${label} must be between 0 and 3`);
    return plane;
};

export function parseEditModeWorldDefinition(value: unknown): EditModeWorldDefinition {
    if (!value || Array.isArray(value) || typeof value !== "object") {
        throw new Error("World API returned an invalid document");
    }
    const raw = value as Record<string, unknown>;
    if (!raw.spawn || Array.isArray(raw.spawn) || typeof raw.spawn !== "object") {
        throw new Error("World API returned an invalid spawn");
    }
    if (!Array.isArray(raw.zones)) throw new Error("World API returned invalid zones");
    if (raw.experienceMultiplier !== undefined && (typeof raw.experienceMultiplier !== "number" || !Number.isFinite(raw.experienceMultiplier) || raw.experienceMultiplier <= 0)) {
        throw new Error("World API returned invalid experienceMultiplier");
    }
    const spawn = raw.spawn as Record<string, unknown>;
    const zones: EditModeWorldZone[] = raw.zones.map((value, index) => {
        if (!value || Array.isArray(value) || typeof value !== "object") {
            throw new Error(`World API zone ${index} is invalid`);
        }
        const zone = value as Record<string, unknown>;
        if (
            !Array.isArray(zone.tags) ||
            zone.tags.some((tag) => typeof tag !== "string")
        ) {
            throw new Error(`World API zone ${index} has invalid tags`);
        }
        const tags = [...new Set(zone.tags)] as EditModeWorldZone["tags"];
        if (["minX", "maxX", "minY", "maxY", "z"].every((key) => zone[key] === undefined)) {
            return { tags };
        }
        if (tags.length === 0) throw new Error(`World API zone ${index} has invalid tags`);
        const parsed: EditModeWorldZone = {
            minX: worldCoordinate(zone.minX, `World API zone ${index}.minX`),
            maxX: worldCoordinate(zone.maxX, `World API zone ${index}.maxX`),
            minY: worldCoordinate(zone.minY, `World API zone ${index}.minY`),
            maxY: worldCoordinate(zone.maxY, `World API zone ${index}.maxY`),
            z: worldPlane(zone.z, `World API zone ${index}.z`),
            tags,
        };
        if (parsed.minX > parsed.maxX || parsed.minY > parsed.maxY) {
            throw new Error(`World API zone ${index} has reversed bounds`);
        }
        return parsed;
    });
    return {
        // Keys the editor does not edit (plugins, pluginConfig, gameframe, membersWorld, ...) pass
        // through untouched, so saving world.json never drops settings it doesn't know.
        ...raw,
        spawn: {
            x: worldCoordinate(spawn.x, "World API spawn.x"),
            y: worldCoordinate(spawn.y, "World API spawn.y"),
            z: worldPlane(spawn.z, "World API spawn.z"),
        },
        zones,
        experienceMultiplier: raw.experienceMultiplier === undefined ? 1 : raw.experienceMultiplier,
    };
}

export function parseBrowserHostWorldSpawn(value: string | null): EditModeWorldDefinition {
    const spawn = value?.split(",").map(Number);
    if (!spawn || spawn.length !== 3 || !spawn.every(Number.isInteger)) {
        throw new Error("Browser host did not provide a valid world spawn");
    }
    return parseEditModeWorldDefinition({
        spawn: { x: spawn[0], y: spawn[1], z: spawn[2] },
        zones: [],
        experienceMultiplier: 1,
    });
}

export function parseBrowserHostWorldDefinition(value: string | null): EditModeWorldDefinition {
    if (!value) throw new Error("Browser host did not provide a world definition");
    try {
        return parseEditModeWorldDefinition(JSON.parse(value));
    } catch (error) {
        throw new Error(
            `Browser host provided an invalid world definition: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

export function requestBrowserHostWorldDefinition(): Promise<EditModeWorldDefinition> {
    const host = browserHostWindow();
    if (!host) return Promise.reject(new Error("Browser host is unavailable"));
    const hostOrigin = browserHostOrigin();
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error("Browser host did not provide a world definition"));
        }, 10_000);
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== hostOrigin || event.source !== host) return;
            const message = event.data as WorldDefinitionMessage | undefined;
            if (message?.type !== WORLD_DEFINITION_MESSAGE || typeof message.contents !== "string") return;
            window.clearTimeout(timeout);
            window.removeEventListener("message", onMessage);
            try {
                resolve(parseBrowserHostWorldDefinition(message.contents));
            } catch (error) {
                reject(error);
            }
        };
        window.addEventListener("message", onMessage);
        host.postMessage({ type: WORLD_DEFINITION_REQUEST_MESSAGE }, hostOrigin);
    });
}

async function loadLocalEditorData(resource = ""): Promise<string> {
    const base = getContentApiBase();
    if (!base) throw new Error("Connect to a local development server to load editor data");
    const response = await fetch(`${base}/api/world${resource ? `/${resource}` : ""}`);
    if (!response.ok) throw new Error(`Editor API returned ${response.status}`);
    return response.text();
}

async function loadWorldDefinition(): Promise<EditModeWorldDefinition> {
    const params = new URLSearchParams(window.location.search);
    if (isBrowserHostClient()) {
        const definition = params.get("browser-host-world-definition");
        return definition
            ? parseBrowserHostWorldDefinition(definition)
            : params.get("browser-host-spawn")
              ? parseBrowserHostWorldSpawn(params.get("browser-host-spawn"))
              : requestBrowserHostWorldDefinition();
    }
    return parseEditModeWorldDefinition(JSON.parse(await loadLocalEditorData()));
}

function filterIndex(index: NameIndex, query: string): EditModeSearchResult[] {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) return [];

    const byId = Number(trimmed);
    if (Number.isInteger(byId) && byId >= 0) {
        const exact = index.filter((entry) => entry.id === byId);
        const partial = index.filter(
            (entry) => entry.id !== byId && String(entry.id).startsWith(trimmed),
        );
        return [...exact, ...partial].slice(0, SEARCH_RESULT_LIMIT);
    }

    return index
        .filter((entry) => entry.name.toLowerCase().includes(trimmed))
        .slice(0, SEARCH_RESULT_LIMIT);
}

export async function searchEditorCache(kind: EditModeSearchKind, loader: NamedTypeLoader, query: string): Promise<EditModeSearchResult[]> {
    return filterIndex(await getNameIndex(kind, loader), query);
}

/** Wires the editor to the running client. Dev builds only - see OsrsClient. */
export function installEditMode(client: OsrsClient): EditModePlugin {
    const plugin = new EditModePlugin(
        createBrowserEditModePluginPersistence("osrs.plugin.edit_mode.v1"),
    );
    client.editorCameraInput = (deltaTime) => plugin.handleCameraInput(client.camera, deltaTime);
    const isRegionOccupied = (id: number) => client.mapFileIndex.getTerrainArchiveId(id >> 8, id & 255) !== -1 ||
        client.mapFileIndex.getLocArchiveId(id >> 8, id & 255) !== -1 ||
        editorRegionReplacements.has(id) || serverRegionIds.has(id) || terrainHost(client)?.mapRegionReplacements.has(id) === true;
    const editorWorldMap = new EditorWorldMap(
        client,
        (tile) => plugin.goToLocation(`${tile.tileX}, ${tile.tileY}, ${tile.plane}`),
        () => {
            const state = plugin.getState();
            return state.world.definition
                ? { zones: state.world.definition.zones, showPvp: state.config.showPvpZones, showMulti: state.config.showMultiCombatZones, showDuel: state.config.showDuelZones, showSafe: state.config.showSafeZones, showF2p: state.config.showF2pZones }
                : undefined;
        },
        (index, bounds) => plugin.resizeWorldZone(index, bounds),
        (bounds, tag) => plugin.addWorldZone(bounds, tag),
        (index, tag) => plugin.setWorldZoneType(index, tag),
        (index) => plugin.deleteWorldZone(index),
        async (mapX, mapY, plane) => {
            const live = terrainHost(client)?.mapRegionReplacements;
            const replacements = new Map<number, { terrainData: Int8Array; objectData?: Int8Array }>();
            const signed = (bytes: Uint8Array) => new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            for (let x = Math.max(0, mapX - 1); x <= Math.min(255, mapX + 1); x++) {
                for (let y = Math.max(0, mapY - 1); y <= Math.min(255, mapY + 1); y++) {
                    const id = (x << 8) | y;
                    const visible = live?.get(id);
                    const base = editorRegionReplacements.get(id);
                    if (visible) replacements.set(id, visible);
                    else if (base) replacements.set(id, { terrainData: signed(base.terrainData),
                        objectData: base.objectData && signed(base.objectData) });
                }
            }
            const data = await client.workerPool.queueMinimap({
                mapX, mapY, maxLevel: plane, loadNpcs: false, smoothTerrain: true, minimizeDrawCalls: true,
                loadedTextureIds: new Set(), mapRegionReplacements: replacements,
            }, plane);
            return data?.minimapBlobs[plane];
        },
        isRegionOccupied,
    );
    const overlayTexturePreviews = new Map<number, string>();
    let previewNpc = false;
    let thumbnailRenderer: Model2DRenderer | undefined;
    let itemThumbnailRenderer: import("../../../ui/item/ItemIconRenderer").ItemIconRenderer | undefined;
    let thumbnailModelLoader: OsrsClient["modelLoader"];
    const renderModelThumbnail = async (model: Model): Promise<string | undefined> => {
        const { objTypeLoader, modelLoader, textureLoader } = client;
        if (!objTypeLoader || !modelLoader || !textureLoader) return;
        if (thumbnailModelLoader !== modelLoader) {
            thumbnailModelLoader = modelLoader;
            thumbnailRenderer = undefined;
            itemThumbnailRenderer = undefined;
        }
        if (!thumbnailRenderer) {
            const { Model2DRenderer } = await import("../../../ui/model/Model2DRenderer");
            thumbnailRenderer = new Model2DRenderer(objTypeLoader, modelLoader, textureLoader);
        }
        return thumbnailRenderer.renderModelInstanceToCanvasExtents(model, {
            xan2d: 256, yan2d: 256, orthographic: true, depthTest: true,
            fitToWidget: { width: 64, height: 64, padding: 4 },
        })?.canvas.toDataURL("image/png");
    };
    let previewNpcType = -1;
    let previewNpcRotation = -1;
    let buildingPreview: { renderer: TerrainHost; key: string; edits: readonly EditModeEdit[] } | undefined;
    let pointerModelHighlight: InteractHighlightDrawTarget | undefined;
    let buildingModelHighlight: InteractHighlightDrawTarget | undefined;
    let buildingSelectionHighlight: InteractHighlightDrawTarget | undefined;
    let buildingHighlightRenderer: TerrainHost | undefined;
    let heightLevelRenderer: TerrainHost | undefined;
    let editorPickCache:
        | {
              renderer: TerrainHost;
              frame: number;
              plane: number;
              x: number;
              y: number;
              onlyObjects: boolean;
              pick: { tile: EditModeTile; target?: InteractHighlightTarget } | undefined;
          }
        | undefined;
    let mapIconFrame: number | undefined;
    let mapIconTargets = new Map<string, LocHighlightTarget>();
    let mapIconGroundOverlay: Pick<MapIconGroundOverlay, "setEntries"> | undefined;
    let mapIconGroundManager: TerrainHost["overlayManager"];
    let locPlacementPreviewOverlay: Pick<LocPlacementPreviewOverlay, "setPreview" | "setPreviews" | "clear"> | undefined;
    let locPlacementPreviewManager: TerrainHost["overlayManager"];
    let constructionRenderer: TerrainHost | undefined;
    let constructionLayer: Pick<ScatterPlacementPreviewOverlay, "setPreviews"> | undefined;
    let hasConstructionPreview = false;
    let modelImageCaptureOverlay: ModelImageCaptureOverlay | undefined;
    let modelImageCaptureManager: TerrainHost["overlayManager"];
    let selectedModelTarget: InteractHighlightTarget | undefined;
    let wallGroundOverlay: Pick<ZoneGroundOverlay, "setRects" | "invalidate"> | undefined;
    let wallGroundManager: TerrainHost["overlayManager"];
    let zoneFrame: number | undefined;
    let zoneGroundOverlay: Pick<ZoneGroundOverlay, "setRects" | "invalidate"> | undefined;
    let zoneGroundManager: TerrainHost["overlayManager"];
    const editorRegionReplacements = new Map<number, EditorRegionReplacement>();
    let serverRegionIds = new Set<number>();
    const savedAwaitingLoad = new Set<number>();
    let landscapePreviewIds = new Set<number>();
    let landscapeViewDistance: number | undefined;
    // Suppressions each editor delete created, so undo removes only its own.
    const deletedLocOverrides = new Map<string, string[]>();
    let objectSpawns: ObjectSpawn[] | undefined = browserHostWindow() ? undefined : [];
    let objectSpawnPreviewPending = false;
    // Persisted NPC spawns are loaded per region in both modes: the browser
    // host answers over messaging, the standalone editor fetches the file once.
    /** `hidden`: suppressed by a removal marker, placed before or after the region loaded. */
    type LoadedNpcSpawnEntry = LoadedNpcSpawnRegionEntry<BrowserHostNpcSpawn>;
    const loadedNpcSpawnRegions = new Map<number, LoadedNpcSpawnEntry[]>();
    const pendingNpcSpawnRegions = new Set<number>();
    const hiddenNpcSpawns = new HiddenNpcSpawns();
    let gameNpcSpawns: BrowserHostNpcSpawn[] | undefined;
    let gameNpcSpawnsPromise: Promise<BrowserHostNpcSpawn[] | undefined> | undefined;
    let gameNpcSpawnsRetryAt = 0;
    const sceneEdits = (edits: readonly EditModeEdit[]) => [...objectSpawnEdits(objectSpawns ?? []), ...edits];
    const npcRuntimeReady = () => !!(client as unknown as { npcMovementSync?: unknown }).npcMovementSync;
    const findLoadedNpcSpawn = (serverId: number | undefined): LoadedNpcSpawnEntry | undefined => {
        if (serverId === undefined) return undefined;
        for (const entries of loadedNpcSpawnRegions.values()) {
            const entry = entries.find((candidate) => candidate.serverId === serverId);
            if (entry) return entry;
        }
        return undefined;
    };
    const loadStandaloneNpcSpawns = (): Promise<BrowserHostNpcSpawn[] | undefined> => {
        if (gameNpcSpawns) return Promise.resolve(gameNpcSpawns);
        if (gameNpcSpawnsPromise) return gameNpcSpawnsPromise;
        if (Date.now() < gameNpcSpawnsRetryAt) return Promise.resolve(undefined);
        gameNpcSpawnsPromise = loadLocalEditorData("npc-spawns").then(
            (contents) => {
                gameNpcSpawns = parseNpcSpawns(contents);
                syncNpcSpawnRegions();
                return gameNpcSpawns;
            },
            (error) => {
                // The dev server may still be starting; try again shortly.
                gameNpcSpawnsRetryAt = Date.now() + 5000;
                gameNpcSpawnsPromise = undefined;
                console.warn("[edit-mode] failed to load server NPC spawns", error);
                return undefined;
            },
        );
        return gameNpcSpawnsPromise;
    };
    /** Keeps the three-by-three map square around the camera populated with NPCs. */
    const syncNpcSpawnRegions = (): void => {
        // Do not enqueue NPC geometry into the title screen's unrelated map grid.
        // The scene preview establishes the editor's map grid first.
        if (!plugin.getState().scenePreview || !npcRuntimeReady()) return;
        const camera = plugin.getCameraTile();
        if (!camera) return;
        const mapX = camera.tileX >> 6;
        const mapY = camera.tileY >> 6;
        const wanted = new Set<number>();
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
            for (let offsetY = -1; offsetY <= 1; offsetY++) {
                const nextMapX = mapX + offsetX;
                const nextMapY = mapY + offsetY;
                if (nextMapX >= 0 && nextMapX <= 0xff && nextMapY >= 0 && nextMapY <= 0xff) {
                    wanted.add((nextMapX << 8) | nextMapY);
                }
            }
        }
        for (const [regionId, entries] of loadedNpcSpawnRegions) {
            if (wanted.has(regionId)) continue;
            for (const { serverId } of entries) despawnEditorNpc(client, serverId);
            loadedNpcSpawnRegions.delete(regionId);
        }
        const missing = [...wanted].filter((regionId) =>
            !loadedNpcSpawnRegions.has(regionId) && !pendingNpcSpawnRegions.has(regionId),
        );
        if (missing.length === 0) return;
        const host = browserHostWindow();
        if (isBrowserHostClient() && host && !host.closed) {
            for (const regionId of missing) pendingNpcSpawnRegions.add(regionId);
            host.postMessage({ type: NPC_SPAWN_REQUEST_MESSAGE, regionIds: missing }, browserHostOrigin());
            return;
        }
        void loadStandaloneNpcSpawns();
        if (!gameNpcSpawns) return;
        const byRegion = new Map<number, BrowserHostNpcSpawn[]>();
        for (const spawn of gameNpcSpawns) {
            const regionId = regionIdForTile(spawn.tileX, spawn.tileY);
            const entries = byRegion.get(regionId);
            if (entries) entries.push(spawn);
            else byRegion.set(regionId, [spawn]);
        }
        for (const regionId of missing) {
            loadedNpcSpawnRegions.set(regionId, loadNpcSpawnRegion(byRegion.get(regionId) ?? [], hiddenNpcSpawns,
                (spawn) => spawnStaticEditorNpc(client, spawn), reserveEditorNpcServerId));
        }
    };
    let persistedNpcSpawnEdits: EditModeEdit[] | undefined;
    /**
     * Turns the saved npc-spawns-custom.json patch into edits so a fresh
     * browser profile starts from what the server already loads, instead of
     * showing canonical spawns only and overwriting the patch on save.
     */
    const loadPersistedNpcSpawnEdits = async (): Promise<EditModeEdit[]> => {
        if (isBrowserHostClient()) return [];
        if (persistedNpcSpawnEdits) return persistedNpcSpawnEdits;
        const canonical = await loadStandaloneNpcSpawns();
        if (!canonical) throw new Error("NPC spawns are not available yet");
        let records: NpcSpawnRecord[];
        try {
            records = parseNpcSpawnRecords(await loadLocalEditorData("npc-spawns-custom"));
        } catch (error) {
            throw new Error(`Could not read the saved NPC spawn patch: ${
                error instanceof Error ? error.message : String(error)
            }`);
        }
        // Read the patch as the server's loader does: stacked spawns pair one for one with its records.
        const kinds = classifyNpcSpawnPatch(canonical, records);
        const edits: EditModeEdit[] = [];
        for (const [index, record] of records.entries()) {
            if (kinds[index] === "remove") {
                edits.push({
                    kind: "npcDelete",
                    locId: record.id,
                    tileX: record.tileX,
                    tileY: record.tileY,
                    plane: record.plane,
                    shape: 0,
                    rotation: 0,
                });
                continue;
            }
            const direction = record.direction;
            const rotation = direction === undefined
                ? 0
                : ((DIRECTION_TO_ORIENTATION[direction & 7] ?? 0) / 512) & 3;
            const overridesCanonical = kinds[index] === "override";
            edits.push(overridesCanonical
                ? {
                    kind: "npcWander",
                    locId: record.id,
                    tileX: record.tileX,
                    tileY: record.tileY,
                    plane: record.plane,
                    shape: 0,
                    rotation: 0,
                    ...(record.wanderRadius === undefined ? {} : { wanderRadius: record.wanderRadius }),
                    ...(record.leashRadius === undefined ? {} : { leashRadius: record.leashRadius }),
                    ...(direction === undefined ? {} : { direction }),
                }
                : {
                    kind: "npc",
                    locId: record.id,
                    tileX: record.tileX,
                    tileY: record.tileY,
                    plane: record.plane,
                    shape: LOC_SHAPE_NORMAL,
                    rotation,
                    ...(record.wanderRadius === undefined ? {} : { wanderRadius: record.wanderRadius }),
                    ...(record.leashRadius === undefined ? {} : { leashRadius: record.leashRadius }),
                    ...(direction === undefined ? {} : { direction }),
                });
        }
        persistedNpcSpawnEdits = edits;
        return edits;
    };
    const mapIconSprites = new Map<number, HTMLCanvasElement>();
    const mapIconLocs = new WeakMap<MinimapIcon, { locId: number; rotation?: number } | null>();
    // Edit mode loads no RuneLite plugins, so the editor supplies its own outlines.
    // Never removed: the editor installs once, for the page's life, and edit mode loads no
    // Interact Highlight plugin for this to override.
    client.clientPlugins.add({ interactHighlightConfig: () => EDITOR_INTERACT_HIGHLIGHT });
    let terrainPreviewSignature = "";
    let hasScatterBrushPreview = false;

    const clearConstructionPreview = (): void => {
        if (!hasConstructionPreview || !constructionRenderer) return;
        constructionLayer?.setPreviews(client, constructionRenderer as unknown as LocPlacementPreviewRenderer, []);
        hasConstructionPreview = false;
    };
    const clearPlacementPreview = (): void => {
        locPlacementPreviewOverlay?.clear();
        clearConstructionPreview();
        wallGroundOverlay?.setRects([]);
        if (previewNpc) {
            despawnEditorNpc(client, EDITOR_NPC_PREVIEW_SERVER_ID);
            previewNpc = false;
        }
        previewNpcType = -1;
        previewNpcRotation = -1;
    };
    const clearTerrainPreview = (): void => {
        if (hasScatterBrushPreview) {
            hasScatterBrushPreview = false;
            wallGroundOverlay?.setRects([]);
        }
        if (!terrainPreviewSignature) return;
        terrainPreviewSignature = "";
        client.tileHighlightManager.clear(EDITOR_PATH_TILE_SLOT);
    };
    // Full material geometry arrives from the worker. This layer draws the
    // edited shape in the meantime and follows the renderer across reloads.
    const paintRects = new Map<number, Map<string, ZoneGroundRect[]>>();
    const submittedPaint = new Map<number, Map<string, ZoneGroundRect[]>>();
    const paintReloads = new Set<number>();
    const scatterPreviews = new Map<number, Map<string, LocPlacementPreview>>();
    const submittedScatter = new Map<number, Map<string, LocPlacementPreview>>();
    const recentScatterPreviews: { mapId: number; key: string; preview: LocPlacementPreview }[] = [];
    const maxScatterPreviews = 160;
    let brushRenderer: TerrainHost | undefined;
    let paintLayer: Pick<ZoneGroundOverlay, "setRects"> | undefined;
    let scatterLayer: Pick<ScatterPlacementPreviewOverlay, "setPreviews"> | undefined;
    let paintFrame: number | undefined;
    const scatterKey = (edit: EditModeEdit): string => `${edit.tileX},${edit.tileY},${edit.plane},${edit.locId},${edit.shape},${edit.rotation}`;
    const drawPaint = (): void => {
        paintLayer?.setRects([...paintRects.values()].flatMap((rects) => [...rects.values()].flat()));
    };
    const drawScatteredLocs = (): void => {
        if (!scatterLayer || !brushRenderer) return;
        const previews = recentScatterPreviews
            .filter(({ mapId, key, preview }) => scatterPreviews.get(mapId)?.get(key) === preview)
            .map(({ preview }) => preview);
        scatterLayer.setPreviews(client, brushRenderer as unknown as LocPlacementPreviewRenderer, previews);
    };
    const retirePreviews = <T,>(mapId: number, awaiting: Map<number, Map<string, T>>, previews: Map<number, Map<string, T>>): boolean => {
        const submitted = awaiting.get(mapId);
        if (!submitted) return false;
        awaiting.delete(mapId);
        const current = previews.get(mapId);
        if (!current) return false;
        for (const [key, value] of submitted) {
            if (current.get(key) === value) current.delete(key);
        }
        if (!current.size) previews.delete(mapId);
        return true;
    };
    const onBrushMapAdded = ({ mapX, mapY }: { mapX: number; mapY: number }): void => {
        const mapId = (mapX << 8) | mapY;
        if (retirePreviews(mapId, submittedPaint, paintRects)) drawPaint();
        if (retirePreviews(mapId, submittedScatter, scatterPreviews)) drawScatteredLocs();
        if (hasScatterBrushPreview) wallGroundOverlay?.invalidate();
    };
    const watchBrushRenderer = (renderer: TerrainHost): void => {
        if (brushRenderer === renderer) return;
        brushRenderer?.mapManager.mapAddedListeners?.delete(onBrushMapAdded);
        if (hasScatterBrushPreview) clearTerrainPreview();
        paintLayer?.setRects([]);
        paintRects.clear();
        submittedPaint.clear();
        paintReloads.clear();
        scatterPreviews.clear();
        submittedScatter.clear();
        recentScatterPreviews.length = 0;
        drawScatteredLocs();
        brushRenderer = renderer;
        paintLayer = renderer.editorOverlays?.paint;
        scatterLayer = renderer.editorOverlays && { setPreviews: renderer.editorOverlays.setScatterPreviews.bind(renderer.editorOverlays) };
        if (!paintLayer && renderer.overlayManager && renderer.app && renderer.sceneUniformBuffer) {
            const layer = new ZoneGroundOverlay();
            const scatter = new ScatterPlacementPreviewOverlay();
            const args = { app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer };
            layer.init(args);
            scatter.init(args);
            renderer.overlayManager.add(layer);
            renderer.overlayManager.add(scatter);
            paintLayer = layer;
            scatterLayer = scatter;
        }
        renderer.mapManager.mapAddedListeners?.add(onBrushMapAdded);
    };
    const queuePaintReload = (renderer: TerrainHost, tile: EditModeTile, key: string, rects: ZoneGroundRect[]): void => {
        watchBrushRenderer(renderer);
        const mapId = renderer.getMapIdForWorldTile(tile.tileX, tile.tileY);
        if (rects.length) {
            let current = paintRects.get(mapId);
            if (!current) paintRects.set(mapId, current = new Map());
            current.set(key, rects);
        } else {
            paintRects.get(mapId)?.delete(key);
        }
        paintReloads.add(mapId);
        const flush = (): void => {
            paintFrame = undefined;
            const renderer = brushRenderer!;
            drawPaint();
            for (const id of paintReloads) {
                const rects = paintRects.get(id);
                if (rects?.size) submittedPaint.set(id, new Map(rects));
                else {
                    paintRects.delete(id);
                    submittedPaint.delete(id);
                }
                renderer.pendingLocUpdates?.add(id);
                renderer.scheduleLocReload(id >> 8, id & 0xff);
            }
            paintReloads.clear();
            zoneGroundOverlay?.invalidate();
        };
        if (paintFrame !== undefined) return;
        if (typeof requestAnimationFrame === "function") paintFrame = requestAnimationFrame(flush);
        else flush();
    };
    const paintPreviewColor = (overlayId: number): number | undefined => {
        if (overlayId <= 0) return;
        try {
            const definition = client.loaderFactory.getOverlayTypeLoader().load(overlayId - 1);
            if (definition.textureId >= 0 && client.textureLoader?.isSd(definition.textureId)) {
                return HSL_RGB_MAP[adjustOverlayLight(client.textureLoader.getAverageHsl(definition.textureId), 96)];
            }
            return definition.primaryRgb === 0xff00ff ? undefined : definition.primaryRgb;
        } catch { return; }
    };
    const paintRect = (tile: EditModeTile, colorRgb: number, shape?: number, rotation?: number): ZoneGroundRect => ({
        minX: tile.tileX, maxX: tile.tileX, minY: tile.tileY, maxY: tile.tileY,
        plane: tile.plane, shape, rotation, colorRgb, alpha: 1,
    });
    const basePaintByTerrain = new WeakMap<Uint8Array | Int8Array, ReturnType<typeof readRegionOverlays>>();
    const underlayEdits = new Map<string, number>();
    let underlayEditsSource: readonly EditModeEdit[] | undefined;
    const basePaintPreview = (tile: EditModeTile, showOverlay: boolean): ZoneGroundRect[] => {
        const regionId = regionIdForTile(tile.tileX, tile.tileY);
        try {
            const data = editorRegionReplacements.get(regionId)?.terrainData ?? client.loaderFactory.getMapFileLoader()
                .getTerrainData(tile.tileX >> 6, tile.tileY >> 6, client.loadedCache?.xteas);
            if (!data) return [];
            let base = basePaintByTerrain.get(data);
            if (!base) {
                base = readRegionOverlays(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), hasWideTerrain(client), true);
                basePaintByTerrain.set(data, base);
            }
            const index = (tile.plane * 64 + (tile.tileX & 63)) * 64 + (tile.tileY & 63);
            const rects: ZoneGroundRect[] = [];
            const edits = plugin.getConfig().edits;
            if (edits !== underlayEditsSource) {
                underlayEditsSource = edits;
                underlayEdits.clear();
                for (const edit of edits) {
                    if (edit.kind === "underlay") underlayEdits.set(`${edit.tileX},${edit.tileY},${edit.plane}`, edit.locId);
                }
            }
            const underlay = underlayEdits.get(`${tile.tileX},${tile.tileY},${tile.plane}`) ?? base.underlays?.[index] ?? 0;
            if (underlay > 0) {
                const definition = client.loaderFactory.getUnderlayTypeLoader().load(underlay - 1);
                if ("rgbColor" in definition && typeof definition.rgbColor === "number") rects.push(paintRect(tile, definition.rgbColor));
            }
            if (showOverlay) {
                const color = paintPreviewColor(base.overlays[index] & 0x7fff);
                if (color !== undefined) rects.push(paintRect(tile, color, base.shapes[index], base.rotations[index]));
            }
            return rects;
        } catch { return []; }
    };
    const previewScatteredLocs = (edits: readonly EditModeEdit[]): void => {
        if (!edits.length) return;
        const renderer = terrainHost(client);
        if (!renderer) return;
        watchBrushRenderer(renderer);
        for (const edit of edits) {
            if (edit.kind !== "place") continue;
            const mapId = renderer.getMapIdForWorldTile(edit.tileX, edit.tileY);
            let previews = scatterPreviews.get(mapId);
            if (!previews) scatterPreviews.set(mapId, previews = new Map());
            const key = scatterKey(edit);
            const preview = {
                locId: edit.locId, x: edit.tileX, y: edit.tileY,
                plane: edit.plane, shape: edit.shape, rotation: edit.rotation,
            };
            previews.set(key, preview);
            recentScatterPreviews.push({ mapId, key, preview });
        }
        // The worker draws the full stroke after its region builds.
        if (recentScatterPreviews.length > maxScatterPreviews) {
            recentScatterPreviews.splice(0, recentScatterPreviews.length - maxScatterPreviews);
        }
        drawScatteredLocs();
    };
    const setTerrainPreview = (tiles: readonly EditModeTile[], color = PATH_PREVIEW_COLOR): void => {
        const signature = tiles.length ? `${color}:${tiles.map((tile) => `${tile.tileX},${tile.tileY},${tile.plane}`).join(";")}` : "";
        if (terrainPreviewSignature === signature) return;
        clearTerrainPreview();
        if (!tiles.length) return;
        terrainPreviewSignature = signature;
        client.tileHighlightManager.configure(
            EDITOR_PATH_TILE_SLOT,
            color,
            2,
            20,
            TILE_HIGHLIGHT_ALWAYS_ON_TOP,
        );
        for (const edit of tiles) {
            client.tileHighlightManager.set(
                packWorldMapCoord({ x: edit.tileX, y: edit.tileY, plane: edit.plane }),
                EDITOR_PATH_TILE_SLOT,
                EDITOR_PATH_TILE_GROUP,
            );
        }
    };
    const setScatterBrushPreview = (tiles: readonly EditModeTile[]): void => {
        const renderer = terrainHost(client);
        if (!renderer || !tiles.length) return;
        watchBrushRenderer(renderer);
        const layer = ensureWallGroundOverlay(renderer);
        if (!layer) {
            setTerrainPreview(tiles);
            return;
        }

        // The brush is on one plane. Merge each row of its painted area into runs for the ground batch.
        const rows = new Map<number, number[]>();
        for (const { tileX, tileY } of tiles) {
            let xs = rows.get(tileY);
            if (!xs) rows.set(tileY, xs = []);
            xs.push(tileX);
        }
        const rects: ZoneGroundRect[] = [];
        const style = { plane: tiles[0].plane, colorRgb: PATH_PREVIEW_COLOR, alpha: 0.27 };
        for (const [y, xs] of rows) {
            xs.sort((a, b) => a - b);
            let start = xs[0];
            for (let i = 0; i < xs.length; i++) {
                const end = xs[i];
                if (xs[i + 1] === end + 1) continue;
                rects.push({ ...style, minX: start, maxX: end, minY: y, maxY: y });
                start = xs[i + 1];
            }
        }
        hasScatterBrushPreview = true;
        layer.setRects(rects);
    };
    const clearPointerPreview = (): void => {
        buildingPreview = undefined;
        pointerModelHighlight = undefined;
        buildingModelHighlight = undefined;
        client.tileHighlightManager.clear(EDITOR_HOVER_TILE_SLOT);
        terrainHost(client)?.clearInteractHighlightHoverTarget();
    };
    const flagsByTerrain = new WeakMap<Uint8Array | Int8Array, Uint8Array>();
    const clearSelectionHighlight = (): void => {
        clearPointerPreview();
        selectedModelTarget = undefined;
        buildingSelectionHighlight = undefined;
        client.tileHighlightManager.clear(EDITOR_SELECTION_TILE_SLOT);
        const renderer = terrainHost(client);
        renderer?.clearInteractHighlightActiveTarget();
    };
    const getMapIconSprite = (spriteId: number): HTMLCanvasElement | undefined => {
        const cached = mapIconSprites.get(spriteId);
        if (cached) return cached;
        try {
            const sprite = SpriteLoader.loadIntoIndexedSprite(
                client.cacheSystem.getIndex(IndexType.DAT2.sprites),
                spriteId,
            );
            if (!sprite) return undefined;
            const canvas = spriteToCanvas(sprite);
            mapIconSprites.set(spriteId, canvas);
            return canvas;
        } catch {
            return undefined;
        }
    };
    const resolveMapIconTarget = (
        renderer: TerrainHost,
        icon: MinimapIcon,
        tileX: number,
        tileY: number,
        plane: number,
    ): LocHighlightTarget | undefined => {
        const cached = mapIconLocs.get(icon);
        if (cached === null) return undefined;
        if (cached) {
            return {
                kind: "loc",
                locId: cached.locId,
                tileX,
                tileY,
                plane,
                locModelType: 22,
                locRotation: cached.rotation,
            };
        }
        const loc = renderer.getLocIdsAtTileAllLevels(tileX, tileY).find((candidate) => {
            if (candidate.level !== plane || ((candidate.typeRot ?? -1) & 0x3f) !== 22) {
                return false;
            }
            const base = client.locTypeLoader.load(candidate.id);
            const type = base?.transforms
                ? base.transform(client.varManager, client.locTypeLoader)
                : base;
            return type?.mapFunctionId === icon.elementId;
        });
        if (!loc) {
            mapIconLocs.set(icon, null);
            return undefined;
        }
        const rotation = loc.typeRot === undefined ? undefined : (loc.typeRot >>> 6) & 3;
        mapIconLocs.set(icon, { locId: loc.id, rotation });
        return {
            kind: "loc",
            locId: loc.id,
            tileX,
            tileY,
            plane,
            locModelType: 22,
            locRotation: rotation,
        };
    };
    const ensureMapIconGroundOverlay = (
        renderer: TerrainHost,
    ): Pick<MapIconGroundOverlay, "setEntries"> | undefined => {
        if (renderer.editorOverlays) return mapIconGroundOverlay = renderer.editorOverlays.icons;
        if (!renderer.overlayManager || !renderer.app || !renderer.sceneUniformBuffer) {
            return undefined;
        }
        if (mapIconGroundManager === renderer.overlayManager) return mapIconGroundOverlay;
        const overlay = new MapIconGroundOverlay();
        overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
        renderer.overlayManager.add(overlay);
        mapIconGroundManager = renderer.overlayManager;
        mapIconGroundOverlay = overlay;
        return overlay;
    };
    const ensureLocPlacementPreviewOverlay = (
        renderer: TerrainHost,
    ): Pick<LocPlacementPreviewOverlay, "setPreview" | "setPreviews" | "clear"> | undefined => {
        if (renderer.editorOverlays) return locPlacementPreviewOverlay = renderer.editorOverlays.preview;
        if (!renderer.overlayManager || !renderer.app || !renderer.sceneUniformBuffer) return undefined;
        if (locPlacementPreviewManager === renderer.overlayManager) return locPlacementPreviewOverlay;
        const overlay = new LocPlacementPreviewOverlay();
        overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
        renderer.overlayManager.add(overlay);
        locPlacementPreviewManager = renderer.overlayManager;
        locPlacementPreviewOverlay = overlay;
        return overlay;
    };
    const drawConstructionPreviews = (renderer: TerrainHost, previews: readonly LocPlacementPreview[]): void => {
        if (constructionRenderer !== renderer) {
            clearConstructionPreview();
            constructionRenderer = renderer;
            constructionLayer = renderer.editorOverlays && {
                setPreviews: renderer.editorOverlays.setConstructionPreviews.bind(renderer.editorOverlays),
            };
            if (!constructionLayer && renderer.overlayManager && renderer.app && renderer.sceneUniformBuffer) {
                const overlay = new ScatterPlacementPreviewOverlay();
                overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
                renderer.overlayManager.add(overlay);
                constructionLayer = overlay;
            }
        }
        constructionLayer?.setPreviews(client, renderer as unknown as LocPlacementPreviewRenderer, previews);
        hasConstructionPreview = Boolean(constructionLayer && previews.length);
    };
    const ensureModelImageCaptureOverlay = (
        renderer: TerrainHost,
    ): ModelImageCaptureOverlay | undefined => {
        if (!renderer.overlayManager || !renderer.app || !renderer.sceneUniformBuffer) return undefined;
        if (modelImageCaptureManager === renderer.overlayManager) return modelImageCaptureOverlay;
        const overlay = new ModelImageCaptureOverlay();
        overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
        renderer.overlayManager.add(overlay);
        modelImageCaptureManager = renderer.overlayManager;
        modelImageCaptureOverlay = overlay;
        return overlay;
    };
    const drawMapIcons = (): void => {
        mapIconFrame = undefined;
        const state = plugin.getState();
        if (!state.config.showMapIcons || !state.config.active) {
            mapIconGroundOverlay?.setEntries([]);
            mapIconTargets.clear();
            return;
        }
        const renderer = terrainHost(client);
        if (renderer) {
            const entries: MapIconGroundEntry[] = [];
            const targets = new Map<string, LocHighlightTarget>();
            const maxPlane = renderer.getRoofPlaneLimit();
            const cullTile = renderer.getRenderCullTile();
            const renderDistance = renderer.getFrameRenderDistanceTiles();
            for (let plane = 0; plane <= maxPlane; plane++) {
                for (let i = 0; i < renderer.mapManager.visibleMapCount; i++) {
                    const map = renderer.mapManager.visibleMaps[i];
                    if (
                        !renderer.isMapWithinRenderDistance(
                            map,
                            cullTile.x,
                            cullTile.y,
                            renderDistance,
                            0,
                        )
                    ) {
                        continue;
                    }
                    const icons = renderer.getMinimapIcons(map.mapX, map.mapY, plane) ?? [];
                    const baseX = map.getRenderBaseWorldX?.() ?? map.mapX * 64;
                    const baseY = map.getRenderBaseWorldY?.() ?? map.mapY * 64;
                    for (const icon of icons) {
                        const tileX = (baseX + icon.localX) | 0;
                        const tileY = (baseY + icon.localY) | 0;
                        const target = resolveMapIconTarget(renderer, icon, tileX, tileY, plane);
                        const sprite = getMapIconSprite(icon.spriteId);
                        if (!target || !sprite) continue;
                        entries.push({ spriteId: icon.spriteId, sprite, tileX, tileY, plane });
                        targets.set(`${tileX}:${tileY}:${plane}`, target);
                    }
                }
            }
            mapIconTargets = targets;
            ensureMapIconGroundOverlay(renderer)?.setEntries(entries);
        }
        mapIconFrame = requestAnimationFrame(drawMapIcons);
    };
    const syncMapIconLoop = (): void => {
        const state = plugin.getState();
        if (state.config.showMapIcons && state.config.active) {
            if (mapIconFrame === undefined) mapIconFrame = requestAnimationFrame(drawMapIcons);
            return;
        }
        if (mapIconFrame !== undefined) cancelAnimationFrame(mapIconFrame);
        mapIconFrame = undefined;
        mapIconGroundOverlay?.setEntries([]);
        mapIconTargets.clear();
    };
    const ensureZoneGroundOverlay = (
        renderer: TerrainHost,
    ): Pick<ZoneGroundOverlay, "setRects" | "invalidate"> | undefined => {
        if (renderer.editorOverlays) return zoneGroundOverlay = renderer.editorOverlays.zones;
        if (!renderer.overlayManager || !renderer.app || !renderer.sceneUniformBuffer) {
            return undefined;
        }
        if (zoneGroundManager === renderer.overlayManager) return zoneGroundOverlay;
        const overlay = new ZoneGroundOverlay();
        overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
        renderer.overlayManager.add(overlay);
        zoneGroundManager = renderer.overlayManager;
        zoneGroundOverlay = overlay;
        return overlay;
    };
    const ensureWallGroundOverlay = (
        renderer: TerrainHost,
    ): Pick<ZoneGroundOverlay, "setRects" | "invalidate"> | undefined => {
        if (renderer.editorOverlays) return wallGroundOverlay = renderer.editorOverlays.wall;
        if (!renderer.overlayManager || !renderer.app || !renderer.sceneUniformBuffer) return undefined;
        if (wallGroundManager === renderer.overlayManager) return wallGroundOverlay;
        const overlay = new ZoneGroundOverlay(false);
        overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
        renderer.overlayManager.add(overlay);
        wallGroundManager = renderer.overlayManager;
        wallGroundOverlay = overlay;
        return overlay;
    };
    const drawWorldZones = (): void => {
        zoneFrame = undefined;
        const state = plugin.getState();
        const world = state.world.definition;
        const renderer = terrainHost(client);
        if (!state.config.active || !world || !renderer) {
            zoneGroundOverlay?.setRects([]);
            return;
        }

        const cullTile = renderer.getRenderCullTile();
        const renderDistance = Math.ceil(renderer.getFrameRenderDistanceTiles());
        const rects: ZoneGroundRect[] = [];
        for (const zone of world.zones) {
            if (zone.minX === undefined) continue; // Global rules have no editable rectangle.
            // F2P land is matched on x/y by the server, so it shows on every plane.
            const showF2p = state.config.showF2pZones && zone.tags.includes("f2p");
            if (!showF2p && !state.config.renderAllHeightLevels && zone.z !== state.config.heightLevel) continue;
            const showPvp = state.config.showPvpZones && zone.tags.includes("pvp");
            const showMulti =
                state.config.showMultiCombatZones && zone.tags.includes("multi-combat");
            const showDuel = state.config.showDuelZones && zone.tags.includes("duel");
            const showSafe = state.config.showSafeZones && zone.tags.includes("safe");
            if (!showPvp && !showMulti && !showSafe && !showDuel && !showF2p) continue;
            for (let i = 0; i < renderer.mapManager.visibleMapCount; i++) {
                const map = renderer.mapManager.visibleMaps[i];
                if (
                    !renderer.isMapWithinRenderDistance(
                        map,
                        cullTile.x,
                        cullTile.y,
                        renderDistance,
                        0,
                    )
                ) {
                    continue;
                }
                const mapMinX = map.getRenderBaseWorldX?.() ?? map.mapX * 64;
                const mapMinY = map.getRenderBaseWorldY?.() ?? map.mapY * 64;
                const minX = Math.max(zone.minX, mapMinX);
                const maxX = Math.min(zone.maxX, mapMinX + 63);
                const minY = Math.max(zone.minY, mapMinY);
                const maxY = Math.min(zone.maxY, mapMinY + 63);
                if (minX > maxX || minY > maxY) continue;
                if (showSafe) rects.push({ minX, maxX, minY, maxY, plane: zone.z, colorRgb: 0x86efac, alpha: ZONE_OVERLAY_ALPHA });
                if (showF2p) rects.push({ minX, maxX, minY, maxY, plane: state.config.heightLevel, colorRgb: 0x93c5fd, alpha: ZONE_OVERLAY_ALPHA });
                if (showPvp) {
                    rects.push({
                        minX,
                        maxX,
                        minY,
                        maxY,
                        plane: zone.z,
                        colorRgb: PVP_ZONE_COLOR,
                        alpha: ZONE_OVERLAY_ALPHA,
                    });
                }
                if (showDuel) rects.push({ minX, maxX, minY, maxY, plane: zone.z, colorRgb: 0xc4b5fd, alpha: ZONE_OVERLAY_ALPHA });
                if (showMulti) {
                    rects.push({
                        minX,
                        maxX,
                        minY,
                        maxY,
                        plane: zone.z,
                        colorRgb: MULTI_COMBAT_ZONE_COLOR,
                        alpha: ZONE_OVERLAY_ALPHA,
                    });
                }
            }
        }
        ensureZoneGroundOverlay(renderer)?.setRects(rects);
        zoneFrame = requestAnimationFrame(drawWorldZones);
    };
    const syncWorldZoneLoop = (): void => {
        const state = plugin.getState();
        const visible = state.config.showDuelZones || state.config.showPvpZones || state.config.showMultiCombatZones || state.config.showSafeZones || state.config.showF2pZones;
        if (state.config.active && state.world.definition && visible) {
            if (zoneFrame === undefined) zoneFrame = requestAnimationFrame(drawWorldZones);
            return;
        }
        if (zoneFrame !== undefined) cancelAnimationFrame(zoneFrame);
        zoneFrame = undefined;
        zoneGroundOverlay?.setRects([]);
    };
    const syncWorldSpawnHighlight = (): void => {
        client.tileHighlightManager.clear(EDITOR_SPAWN_TILE_SLOT);
        const state = plugin.getState();
        const spawn = state.world.definition?.spawn;
        if (!spawn || !state.config.enabled || !(state.config.active || state.scenePreview)) return;
        client.tileHighlightManager.configure(
            EDITOR_SPAWN_TILE_SLOT,
            SPAWN_TILE_COLOR,
            2,
            25,
            TILE_HIGHLIGHT_ALWAYS_ON_TOP,
        );
        client.tileHighlightManager.set(
            packWorldMapCoord({ x: spawn.x, y: spawn.y, plane: spawn.z }),
            EDITOR_SPAWN_TILE_SLOT,
            EDITOR_SPAWN_TILE_GROUP,
        );
    };
    const selectTileRange = (start: EditModeTile, end: EditModeTile) => {
        clearSelectionHighlight();
        const limit = EDITOR_SELECTION_MAX_SPAN - 1;
        const endX = Math.max(start.tileX - limit, Math.min(start.tileX + limit, end.tileX));
        const endY = Math.max(start.tileY - limit, Math.min(start.tileY + limit, end.tileY));
        const minX = Math.min(start.tileX, endX);
        const maxX = Math.max(start.tileX, endX);
        const minY = Math.min(start.tileY, endY);
        const maxY = Math.max(start.tileY, endY);
        client.tileHighlightManager.configure(
            EDITOR_SELECTION_TILE_SLOT,
            0xffffff,
            2,
            12,
            TILE_HIGHLIGHT_ALWAYS_ON_TOP,
        );
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                client.tileHighlightManager.set(
                    packWorldMapCoord({ x, y, plane: start.plane }),
                    EDITOR_SELECTION_TILE_SLOT,
                    EDITOR_SELECTION_TILE_GROUP,
                );
            }
        }
        return {
            kind: "ground" as const,
            ...start,
            locId: -1,
            locName: "",
            tileEndX: endX,
            tileEndY: endY,
        };
    };
    let editorTilePick: { renderer: TerrainHost; frame: number; x: number; y: number; plane: number; tile?: EditModeTile } | undefined;
    const getEditorPointerTile = (renderer: TerrainHost) => {
        const { mouseX: x, mouseY: y } = client.inputManager;
        if (x < 0 || y < 0) return undefined;
        const frame = renderer.currentFrameCount;
        const plane = plugin.getConfig().heightLevel;
        if (editorTilePick?.renderer === renderer && editorTilePick.frame === frame && editorTilePick.x === x &&
            editorTilePick.y === y && editorTilePick.plane === plane) return editorTilePick.tile;
        const ray = renderer.screenToRay(x, y);
        const tile = ray ? pickEditorTile(ray, plane, renderer.mapManager.visibleMaps.slice(0, renderer.mapManager.visibleMapCount)) : undefined;
        editorTilePick = { renderer, frame, x, y, plane, tile };
        return tile;
    };
    const resolveEditScenePick = (renderer: TerrainHost, onlyObjects = false) => {
        const x = client.inputManager.mouseX;
        const y = client.inputManager.mouseY;
        if (
            editorPickCache?.renderer === renderer &&
            editorPickCache.frame === renderer.currentFrameCount &&
            editorPickCache.plane === plugin.getConfig().heightLevel &&
            editorPickCache.x === x &&
            editorPickCache.y === y &&
            editorPickCache.onlyObjects === onlyObjects
        ) {
            return editorPickCache.pick;
        }
        const ray = renderer.screenToRay(x, y);
        const hit =
            ray && renderer.sceneRaycaster
                ? raycastEditScene(
                      renderer.sceneRaycaster,
                      ray,
                      renderer.getPlayerRawPlane(),
                      onlyObjects,
                  )
                : undefined;
        let pick: { tile: EditModeTile; target?: InteractHighlightTarget } | undefined;
        if (hit?.tileX !== undefined && hit.tileY !== undefined) {
            if (hit.interactType === InteractType.NPC && hit.npcServerId !== undefined) {
                const target = renderer.resolveNpcHighlightTargetFromServerId(hit.npcServerId);
                pick = {
                    tile: {
                        tileX: hit.tileX,
                        tileY: hit.tileY,
                        plane: target?.plane ?? renderer.getPlayerRawPlane(),
                    },
                    target,
                };
            } else if (hit.interactType === InteractType.LOC) {
                const playerPlane = renderer.getPlayerRawPlane();
                const loc = hit.locLevel === undefined
                    ? renderer.getLocIdsAtTileAllLevels(hit.tileX, hit.tileY)
                        .filter(({ id }) => id === hit.interactId)
                        .sort((a, b) => Math.abs(a.level - playerPlane) - Math.abs(b.level - playerPlane))[0]
                    : { level: hit.locLevel, typeRot: hit.locTypeRot };
                if (loc) {
                    const typeRot = loc.typeRot;
                    pick = {
                        tile: { tileX: hit.tileX, tileY: hit.tileY, plane: loc.level },
                        target: {
                            kind: "loc",
                            locId: hit.interactId,
                            tileX: hit.tileX,
                            tileY: hit.tileY,
                            plane: loc.level,
                            locModelType: typeRot === undefined ? undefined : typeRot & 0x3f,
                            locRotation: typeRot === undefined ? undefined : (typeRot >>> 6) & 3,
                        },
                    };
                }
            }
        }
        if (!pick && plugin.getConfig().showMapIcons) {
            const tile = getEditorPointerTile(renderer);
            const plane = plugin.getConfig().heightLevel;
            const iconTarget = tile && mapIconTargets.get(`${tile.tileX}:${tile.tileY}:${plane}`);
            if (iconTarget) {
                pick = {
                    tile: { tileX: iconTarget.tileX, tileY: iconTarget.tileY, plane },
                    target: iconTarget,
                };
            }
        }
        editorPickCache = { renderer, frame: renderer.currentFrameCount, plane: plugin.getConfig().heightLevel, x, y, onlyObjects, pick };
        return pick;
    };
    const resolvePointerTarget = (onlyObjects = false) => {
        const renderer = terrainHost(client);
        if (!renderer) return { renderer, target: undefined };
        return {
            renderer,
            target: resolveEditScenePick(renderer, onlyObjects)?.target,
        };
    };
    const ensureBuildingHighlightRenderer = (renderer: TerrainHost): void => {
        if (buildingHighlightRenderer === renderer) return;
        buildingHighlightRenderer = renderer;
        const getBaseTargets = renderer.getInteractHighlightDrawTargets.bind(renderer);
        renderer.getInteractHighlightDrawTargets = () => {
            const targets = getBaseTargets() as InteractHighlightDrawTarget[];
            if (buildingSelectionHighlight) targets.push(buildingSelectionHighlight);
            if (buildingModelHighlight) targets.push(buildingModelHighlight);
            if (pointerModelHighlight) targets.push(pointerModelHighlight);
            if (
                !buildingSelectionHighlight &&
                !buildingModelHighlight &&
                !pointerModelHighlight &&
                (plugin.getConfig().tool === "place" || plugin.getConfig().tool === "wall")
            ) {
                targets.length = 0;
            }
            return targets;
        };
    };
    const ensureHeightLevelRenderer = (renderer: TerrainHost): void => {
        if (heightLevelRenderer === renderer) return;
        heightLevelRenderer = renderer;
        const getBasePlane = renderer.getPlayerRawPlane.bind(renderer);
        const getBaseEffectivePlane = renderer.getEffectivePlaneForTile.bind(renderer);
        const getBaseRoofPlaneLimit = renderer.getRoofPlaneLimit.bind(renderer);
        const shouldRenderNpc = renderer.shouldRenderNpcFromMap.bind(renderer);
        const shouldRenderPlayer = renderer.shouldRenderPlayerIndex.bind(renderer);
        let hoveredRoofFrame = -1;
        let hoverHidesUpperFloors = false;
        const isEditing = () => {
            const state = plugin.getState();
            return state.config.enabled && (state.config.active || state.scenePreview);
        };
        renderer.getEffectivePlaneForTile = (x, y, plane) =>
            isEditing() ? plane : getBaseEffectivePlane(x, y, plane);
        renderer.getPlayerRawPlane = () =>
            isEditing() ? plugin.getConfig().heightLevel : getBasePlane();
        renderer.getRoofPlaneLimit = () => {
            if (!isEditing()) return getBaseRoofPlaneLimit();
            const config = plugin.getConfig();
            if (config.floorView === "all") return 3;
            if (config.floorView === "one-above") return Math.min(3, config.heightLevel + 1);
            if (config.floorView === "up-to" || (config.ghostUi && !config.floorView)) return config.heightLevel;
            if (!config.renderAllHeightLevels) return config.heightLevel;
            if (plugin.isSelectingBuilding()) return 3;
            if (config.heightLevel === 0) {
                const selection = plugin.getState().selection;
                if (selection?.plane === 0 && (selection.kind === "loc" || selection.kind === "npc") &&
                    (renderer.getTileRenderFlagAt(0, selection.tileX, selection.tileY) & TILE_FLAG_UNDER_ROOF) !== 0) {
                    return 0;
                }
                if (hoveredRoofFrame !== renderer.currentFrameCount) {
                    hoveredRoofFrame = renderer.currentFrameCount;
                    // Pick the ground heightfield even while a roof covers it, avoiding hover flicker.
                    const tile = getEditorPointerTile(renderer);
                    hoverHidesUpperFloors = !!tile &&
                        (renderer.getTileRenderFlagAt(0, tile.tileX, tile.tileY) & TILE_FLAG_UNDER_ROOF) !== 0;
                }
                if (hoverHidesUpperFloors) return 0;
            }
            return 3;
        };
        renderer.shouldRenderNpcFromMap = (map, ecsId) =>
            shouldRenderNpc(map, ecsId) &&
            (!isEditing() ||
                (client.npcEcs.getLevel(ecsId) | 0) === plugin.getConfig().heightLevel);
        renderer.shouldRenderPlayerIndex = (ecsId) =>
            shouldRenderPlayer(ecsId) &&
            (!isEditing() ||
                (client.playerEcs.getLevel(ecsId) | 0) <= renderer.getRoofPlaneLimit());
    };
    const resolveBuilding = (renderer: TerrainHost, fallback?: EditModeTile): DetectedBuilding | undefined => {
        const { mouseX, mouseY } = client.inputManager;
        if (mouseX < 0 || mouseY < 0) return undefined;
        const ray = renderer.screenToRay(mouseX, mouseY);
        if (!ray) return undefined;
        const maps = renderer.mapManager.visibleMaps.slice(0, renderer.mapManager.visibleMapCount);
        const roofLimit = renderer.getRoofPlaneLimit();
        const ground = pickEditorTileHit(ray, 0, maps);
        const locs = new Map<string, BuildingMapLoc[]>();
        const getLocs = (x: number, y: number) => {
            const key = `${x}:${y}`;
            let at = locs.get(key);
            if (!at) {
                at = renderer.getLocIdsAtTileAllLevels(x, y);
                locs.set(key, at);
            }
            return at;
        };
        const isIndoor = (x: number, y: number, plane: number) =>
            (renderer.getTileRenderFlagAt(plane, x, y) & TILE_FLAG_UNDER_ROOF) !== 0;
        const detect = (x: number, y: number) => detectRectangularBuilding(
            x, y, getLocs,
            (id) => {
                const type = client.locTypeLoader.load(id);
                return !!type && isDoorLocType(type);
            },
            { isIndoor },
        );

        const surfaces: Array<{ t: number; x: number; y: number; roofPlane?: number; wallKey?: string }> = [];
        for (let plane = 1; plane <= roofLimit; plane++) {
            const hit = pickEditorTileHit(ray, plane, maps, (x, y) => isIndoor(x, y, plane - 1));
            if (hit) surfaces.push({ t: hit.t, x: hit.tile.tileX, y: hit.tile.tileY, roofPlane: plane });
        }
        if (renderer.sceneRaycaster) {
            const hits = raycastEditorHits(renderer.sceneRaycaster, ray, {
                maxDistance: Math.min(4096, (ground?.t ?? 4096) + 0.125),
                locPlaneLimit: roofLimit,
            });
            for (const hit of hits) {
                if (hit.tileX === undefined || hit.tileY === undefined ||
                    hit.locTypeRot === undefined || hit.locLevel === undefined) continue;
                const shape = hit.locTypeRot & 0x3f;
                if (shape > 9 && (shape < 12 || shape > 21)) continue;
                const wallKey = buildingWallKey(hit.tileX, hit.tileY,
                    { id: hit.interactId, level: hit.locLevel, typeRot: hit.locTypeRot });
                surfaces.push({ t: hit.t, x: hit.tileX, y: hit.tileY, wallKey });
            }
        }
        surfaces.sort((a, b) => a.t - b.t);
        const resolved = new Map<string, DetectedBuilding | undefined>();
        for (const surface of surfaces) {
            const { x, y, roofPlane, wallKey } = surface;
            const key = `${x}:${y}`;
            if (!resolved.has(key)) resolved.set(key, detect(x, y));
            const building = resolved.get(key);
            if (!building) continue;
            if (roofPlane !== undefined && building.terrainRoofPlane !== roofPlane) continue;
            if (building.boundaryWalls.has(wallKey ?? "") || building.tiles.some((tile) => tile.x === x && tile.y === y)) {
                return building;
            }
        }
        const tile = fallback ?? ground?.tile;
        return tile && detect(tile.tileX, tile.tileY);
    };

    const analyseBuilding = (renderer: TerrainHost, building: DetectedBuilding) => {
        ensureBuildingHighlightRenderer(renderer);
        const trianglePoints: Array<readonly [number, number, number]> = [];
        const terrainRoofPlane = building.terrainRoofPlane;
        if (terrainRoofPlane !== undefined) {
            const vertex = (x: number, y: number): readonly [number, number, number] =>
                [x, renderer.sampleHeightAtExactPlane(x, y, terrainRoofPlane), y];
            for (const { x, y } of building.tiles) {
                const a = vertex(x, y);
                const b = vertex(x + 1, y);
                const c = vertex(x + 1, y + 1);
                const d = vertex(x, y + 1);
                trianglePoints.push(a, b, c, a, c, d);
            }
        }
        const seen = new Set<string>();
        let objectCount = 0;
        let wallCount = 0;
        let doorCount = 0;
        let roofCount = 0;
        let decorationCount = 0;
        const profileObjects: EditModeBuildingProfile["objects"] = [];
        const roofTiles = new Set(building.tiles.map(({ x, y }) => `${x}:${y}`));
        const perimeterTiles = new Set(
            building.tiles
                .filter(({ x, y }) =>
                    [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(
                        ([nextX, nextY]) => !roofTiles.has(`${nextX}:${nextY}`),
                    ),
                )
                .map(({ x, y }) => `${x}:${y}`),
        );
        const continuesOutside = (
            id: number,
            level: number,
            x: number,
            y: number,
        ): boolean => {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if ((!dx && !dy) || roofTiles.has(`${x + dx}:${y + dy}`)) continue;
                    if (
                        renderer.getLocIdsAtTileAllLevels(x + dx, y + dy).some((candidate) => {
                            const type = (candidate.typeRot ?? -1) & 0x3f;
                            return (
                                candidate.id === id &&
                                candidate.level === level &&
                                (type <= 3 || type === 9)
                            );
                        })
                    ) {
                        return true;
                    }
                }
            }
            return false;
        };
        for (let plane = building.minPlane; plane <= building.maxPlane; plane++) {
            for (const { x, y } of building.structureTiles) {
                for (const loc of renderer.getLocIdsAtTileAllLevels(x, y)) {
                    if (loc.level !== plane || loc.typeRot === undefined) continue;
                    const modelType = loc.typeRot & 0x3f;
                    const wallLike = modelType <= 3 || modelType === 9;
                    const locType = wallLike ? client.locTypeLoader.load(loc.id) : undefined;
                    const door = !!locType && isDoorLocType(locType);
                    const boundaryWall = wallLike && building.boundaryWalls.has(buildingWallKey(x, y, loc));
                    if (
                        wallLike &&
                        !boundaryWall &&
                        loc.id !== building.wallId &&
                        !door &&
                        perimeterTiles.has(`${x}:${y}`) &&
                        continuesOutside(loc.id, loc.level, x, y)
                    ) {
                        continue;
                    }
                    if (
                        !roofTiles.has(`${x}:${y}`) &&
                        !boundaryWall &&
                        !(modelType >= 4 && modelType <= 8)
                    ) {
                        continue;
                    }
                    const key = `${loc.id}:${x}:${y}:${plane}:${loc.typeRot}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    objectCount++;
                    const role = door ? "door"
                        : wallLike ? "wall"
                        : modelType >= 4 && modelType <= 8 ? "decoration"
                        : modelType >= 12 && modelType <= 21 ? "roof" : "other";
                    if (role === "door") doorCount++;
                    else if (role === "wall") wallCount++;
                    else if (role === "decoration") decorationCount++;
                    else if (role === "roof") roofCount++;
                    profileObjects.push({
                        id: loc.id,
                        name: client.locTypeLoader.load(loc.id)?.name ?? "",
                        role,
                        x: x - building.minX,
                        y: y - building.minY,
                        z: plane - building.minPlane,
                        shape: modelType,
                        rotation: (loc.typeRot >>> 6) & 3,
                    });
                    const points = renderer.buildHighlightTrianglePoints({
                        kind: "loc",
                        locId: loc.id,
                        tileX: x,
                        tileY: y,
                        plane,
                        locModelType: modelType,
                        locRotation: (loc.typeRot >>> 6) & 3,
                    });
                    if (points) for (const point of points) trianglePoints.push(point);
                }
            }
        }
        const commonId = (matches: (object: EditModeBuildingProfile["objects"][number]) => boolean) => {
            const counts = new Map<number, number>();
            for (const object of profileObjects.filter(matches)) counts.set(object.id, (counts.get(object.id) ?? 0) + 1);
            return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        };
        return {
            building,
            highlight: trianglePoints.length
                ? ({ trianglePoints, color: 0xffffff, alpha: 0.45 } as InteractHighlightDrawTarget)
                : undefined,
            objectCount,
            wallCount,
            doorCount,
            roofCount,
            decorationCount,
            profileObjects,
            materials: {
                wallId: commonId((object) => object.role === "wall" && object.shape === 0),
                diagonalWallId: commonId((object) => object.role === "wall" && (object.shape === 1 || object.shape === 9)),
                doorId: commonId((object) => object.role === "door"),
                roofEdgeId: commonId((object) => object.role === "roof" && (object.shape === 18 || object.shape === 19 || object.shape === 21)),
                roofSlopeId: commonId((object) => object.role === "roof" && (object.shape === 12 || object.shape === 13 || object.shape === 16)),
                roofFillId: commonId((object) => object.role === "roof" && object.shape === 17),
            },
        };
    };
    const setBuildingTileFallback = (building: DetectedBuilding, slot: number): void => {
        client.tileHighlightManager.configure(slot, 0xffffff, 2, 12, 0);
        for (let plane = building.minPlane; plane <= building.maxPlane; plane++) {
            for (const { x, y } of building.tiles) {
                client.tileHighlightManager.set(packWorldMapCoord({ x, y, plane }), slot, slot);
            }
        }
    };

    const dirtyEditorRegions = new Set<number>();
    let editorRebuild: Promise<void> | undefined;
    const rebuildEditorRegions = async () => {
        for (const regionId of dirtyEditorRegions) {
            dirtyEditorRegions.delete(regionId);
            try {
                const tile = {
                    tileX: (regionId >> 8) << 6,
                    tileY: (regionId & 0xff) << 6,
                    plane: 0,
                };
                let pack;
                try {
                    pack = buildEditorRegionPack(client, tile, sceneEdits(plugin.getConfig().edits), editorRegionReplacements);
                } catch (error) {
                    if (!client.js5) throw error;
                    // Reading sparse map archives queues their download. The
                    // rendered worker map does not guarantee main-thread data.
                    await client.js5.settled();
                    // Every caller reads the latest editor state, including strokes
                    // applied while this region's base archives were fetching.
                    dirtyEditorRegions.delete(regionId);
                    pack = buildEditorRegionPack(client, tile, sceneEdits(plugin.getConfig().edits), editorRegionReplacements);
                }
                const replacement = parseRegionPack(pack.data);
                const previews = scatterPreviews.get(regionId);
                if (previews?.size) submittedScatter.set(regionId, new Map(previews));
                client.onRegionReplacement({ ...replacement, allowReload: true });
            } catch (error) {
                console.warn(`[edit-mode] failed to rebuild region ${regionId}`, error);
            }
        }
    };

    const refreshEditedRegions = (regionIds: readonly number[]): Promise<void> => {
        for (const id of regionIds) dirtyEditorRegions.add(id);
        editorRebuild ??= Promise.resolve().then(async () => {
            try {
                while (dirtyEditorRegions.size) await rebuildEditorRegions();
            } finally {
                editorRebuild = undefined;
            }
        });
        return editorRebuild;
    };

    const clearEditorReplacement = (id: number): void => {
        editorRegionReplacements.delete(id);
        const renderer = terrainHost(client);
        renderer?.mapRegionReplacements.delete(id);
        const x = id >> 8, y = id & 255;
        renderer?.scheduleLocReload(x, y);
        client.renderer.mapManager.removeMap(x, y);
        client.renderer.mapManager.addInvalidMap(x, y);
    };

    /**
     * Pulls server-side region replacements (agent edits, packs) and persisted
     * object spawns into the scene, so the logged-out preview shows the live
     * world. Local unsaved edits keep applying on top at rebuild. Browser-host
     * editors receive all of this through host messaging instead.
     */
    const pullServerReplacements = async (): Promise<void> => {
        if (browserHostWindow()) return;
        const base = getContentApiBase();
        if (!base) return;
        const touched = new Set<number>();
        const sameBytes = (first?: Uint8Array, second?: Uint8Array) => first === second ||
            (!!first && !!second && first.length === second.length && first.every((byte, i) => byte === second[i]));
        const acceptRegion = (id: number, pack: EditorRegionReplacement): void => {
            if (plugin.isNewMapSquare(id)) return;
            const saved = savedAwaitingLoad.has(id) && editorRegionReplacements.get(id);
            // Until the server loads the save, its running map can still be the previous version.
            if (saved && (!sameBytes(saved.terrainData, pack.terrainData) || !sameBytes(saved.objectData, pack.objectData))) return;
            savedAwaitingLoad.delete(id);
            const previous = editorRegionReplacements.get(id);
            if (previous && sameBytes(previous.terrainData, pack.terrainData) && sameBytes(previous.objectData, pack.objectData)) return;
            editorRegionReplacements.set(id, pack);
            touched.add(id);
        };
        try {
            const response = await fetch(`${base}/regions`, { cache: "no-store" });
            if (!response.ok) throw new Error(`World returned HTTP ${response.status}`);
            const list = await response.json();
            if (!Array.isArray(list?.regions)) throw new Error("World did not return a region list");
            const ids: number[] = list.regions.filter(Number.isInteger);
            const next = new Set(ids);
            for (const id of serverRegionIds) {
                if (!next.has(id) && !savedAwaitingLoad.has(id) && !plugin.isNewMapSquare(id)) clearEditorReplacement(id);
            }
            serverRegionIds = next;
            const load = async (id: number) => {
                if (plugin.isNewMapSquare(id)) return;
                try {
                    const packResponse = await fetch(`${base}/regions/${id}.pack`, { cache: "no-store" });
                    if (packResponse.ok) {
                        acceptRegion(id, parseRegionPack(new Uint8Array(await packResponse.arrayBuffer())));
                    } else {
                        const terrainResponse = await fetch(`${base}/regions/${id}.terrain`, { cache: "no-store" });
                        if (terrainResponse.ok) acceptRegion(id, { terrainData: new Uint8Array(await terrainResponse.arrayBuffer()) });
                    }
                } catch (error) {
                    console.warn(`[edit-mode] failed to load server region ${id}`, error);
                }
            };
            for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(load));
        } catch (error) {
            console.warn("[edit-mode] failed to list server regions", error);
        }
        try {
            const spawns = parseObjectSpawns(await loadLocalEditorData("object-spawns"));
            const previous = objectSpawns;
            objectSpawns = spawns;
            for (const spawn of [...previous ?? [], ...spawns]) touched.add(regionIdForTile(spawn.position.x, spawn.position.y));
        } catch (error) {
            console.warn("[edit-mode] failed to load server object spawns", error);
        }
        if (touched.size > 0) await refreshEditedRegions([...touched]);
    };

    let activeMapSync: Promise<void> | undefined;
    const syncServerReplacements = () => activeMapSync ??= pullServerReplacements().finally(() => {
        activeMapSync = undefined;
    });

    plugin.attach({
        getCanvas: () => client.renderer?.canvas as HTMLCanvasElement | undefined,
        setEditorRenderDistance: (distance) => {
            client.editorRenderDistance = landscapeViewDistance === undefined ? distance : Math.max(landscapeViewDistance, distance ?? 0);
        },
        loadObjectThumbnail: async (id) => {
            const { textureLoader, locTypeLoader } = client;
            const loader = terrainHost(client)?.getInteractLocModelLoader?.();
            if (!loader || !textureLoader || !locTypeLoader) return;
            const base = locTypeLoader.load(id);
            const type = base?.transforms ? base.transform(client.varManager, locTypeLoader) ?? base : base;
            if (!type) return;
            const preferred = getLocPlacementShape(type);
            const load = () => loader.getModel(type, preferred as LocModelType, 0);
            let source = load();
            if (!source && client.js5) {
                await client.js5.settled();
                source = load();
            }
            if (!source) return;
            const model = source instanceof Model ? source : source.light(textureLoader, source.ambient, source.contrast, -50, -10, -50);
            return renderModelThumbnail(model);
        },
        loadNpcThumbnail: async (id) => {
            const loader = terrainHost(client)?.getInteractNpcModelLoader?.();
            const type = client.npcTypeLoader?.load(id);
            if (!loader || !type) return;
            let model = loader.getModel(type, -1, -1);
            if (!model && client.js5) {
                await client.js5.settled();
                model = loader.getModel(type, -1, -1);
            }
            return model ? renderModelThumbnail(model) : undefined;
        },
        loadItemThumbnail: async (id) => {
            const { objTypeLoader, modelLoader, textureLoader, cacheSystem } = client;
            if (!objTypeLoader || !modelLoader || !textureLoader) return;
            if (thumbnailModelLoader !== modelLoader) {
                thumbnailModelLoader = modelLoader;
                thumbnailRenderer = undefined;
                itemThumbnailRenderer = undefined;
            }
            if (!itemThumbnailRenderer) {
                const { ItemIconRenderer } = await import("../../../ui/item/ItemIconRenderer");
                itemThumbnailRenderer = new ItemIconRenderer(objTypeLoader, modelLoader, textureLoader, cacheSystem);
            }
            let icon = itemThumbnailRenderer.renderToCanvas(id);
            if (!icon && client.js5) {
                await client.js5.settled();
                icon = itemThumbnailRenderer.renderToCanvas(id);
            }
            return icon?.toDataURL("image/png");
        },
        getCameraTile: () => ({
            tileX: Math.round(client.camera.getPosX()),
            tileY: Math.round(client.camera.getPosZ()),
            plane: plugin.getConfig().heightLevel,
        }),
        getPointerTile: () => {
            const renderer = terrainHost(client);
            if (renderer) ensureHeightLevelRenderer(renderer);
            const tile = renderer && getEditorPointerTile(renderer);
            if (tile) return tile;
            // Terrain picking has gaps where a loc is the only clickable surface.
            return renderer ? resolveEditScenePick(renderer)?.tile : undefined;
        },
        previewPointer: (tile) => {
            clearPointerPreview();
            const { renderer, target } = resolvePointerTarget();
            if (renderer && target && (target.kind === "loc" || target.kind === "npc")) {
                ensureBuildingHighlightRenderer(renderer);
                const trianglePoints = renderer.buildHighlightTrianglePoints(target);
                if (trianglePoints && trianglePoints.length >= 3) {
                    pointerModelHighlight = { trianglePoints, color: 0xffffff, alpha: 0.45 };
                    return;
                }
            }
            client.tileHighlightManager.configure(
                EDITOR_HOVER_TILE_SLOT,
                0xffffff,
                2,
                12,
                0,
            );
            client.tileHighlightManager.set(
                packWorldMapCoord({ x: tile.tileX, y: tile.tileY, plane: tile.plane }),
                EDITOR_HOVER_TILE_SLOT,
                EDITOR_HOVER_TILE_GROUP,
            );
        },
        previewBuilding: (tile) => {
            const renderer = terrainHost(client);
            const building = renderer && resolveBuilding(renderer, tile);
            if (!renderer || !building) {
                clearPointerPreview();
                return;
            }
            const key = `${building.minX}:${building.minY}:${building.maxX}:${building.maxY}:${building.minPlane}:${building.maxPlane}`;
            const edits = plugin.getConfig().edits;
            if (buildingPreview?.renderer === renderer && buildingPreview.key === key && buildingPreview.edits === edits) return;
            clearPointerPreview();
            const analysis = analyseBuilding(renderer, building);
            buildingPreview = { renderer, key, edits };
            buildingModelHighlight = analysis.highlight;
            if (!analysis.highlight) {
                setBuildingTileFallback(building, EDITOR_HOVER_TILE_SLOT);
            }
        },
        selectBuilding: (tile) => {
            clearSelectionHighlight();
            const renderer = terrainHost(client);
            const building = renderer && resolveBuilding(renderer, tile);
            if (!renderer || !building) return undefined;
            const analysis = analyseBuilding(renderer, building);
            buildingSelectionHighlight = analysis.highlight;
            if (!analysis.highlight) {
                setBuildingTileFallback(building, EDITOR_SELECTION_TILE_SLOT);
            }
            const width = building.maxX - building.minX + 1;
            const depth = building.maxY - building.minY + 1;
            const floors = Math.max(1, building.maxPlane - building.minPlane);
            return {
                kind: "building" as const,
                tileX: building.minX,
                tileY: building.minY,
                plane: building.minPlane,
                tileEndX: building.maxX,
                tileEndY: building.maxY,
                planeEnd: building.maxPlane,
                locId: -1,
                locName: "",
                buildingWidth: width,
                buildingDepth: depth,
                buildingFloors: floors,
                buildingTileCount: building.tiles.length * floors,
                buildingShape: building.shape,
                buildingObjectCount: analysis.objectCount,
                buildingWallCount: analysis.wallCount,
                buildingDoorCount: analysis.doorCount,
                buildingRoofCount: analysis.roofCount,
                buildingDecorationCount: analysis.decorationCount,
                buildingOtherCount:
                    analysis.objectCount -
                    analysis.wallCount -
                    analysis.doorCount -
                    analysis.roofCount -
                    analysis.decorationCount,
                buildingWallId: building.wallId,
                buildingProfile: {
                    format: "elvarg-building-profile",
                    version: 1,
                    shape: building.shape,
                    size: { width, depth, floors },
                    materials: analysis.materials,
                    footprint: building.tiles
                        .map(({ x, y }) => ({ x: x - building.minX, y: y - building.minY }))
                        .sort((a, b) => a.x - b.x || a.y - b.y),
                    objects: analysis.profileObjects.sort(
                        (a, b) => a.z - b.z || a.x - b.x || a.y - b.y || a.shape - b.shape || a.id - b.id,
                    ),
                },
            };
        },
        clearPointerPreview,
        getPointerLoc: () => {
            const entry = client.menuEntries.find(
                (candidate) => candidate.targetType === MenuTargetType.LOC,
            );
            return entry ? { locId: entry.targetId | 0, locName: entry.targetName } : undefined;
        },
        projectObject: (object) => {
            const renderer = terrainHost(client);
            const canvas = client.renderer?.canvas;
            if (!renderer || !canvas || !renderer.getPreferredMapForWorldTile(object.tileX, object.tileY)) return;
            const sized = object.shape === 10 || object.shape === 11 || object.shape === 22;
            const definition = sized ? client.locTypeLoader.load(object.locId) : undefined;
            const rotated = (object.rotation ?? 0) & 1;
            const x = object.tileX + ((rotated ? definition?.sizeY : definition?.sizeX) ?? 1) / 2;
            const y = object.tileY + ((rotated ? definition?.sizeX : definition?.sizeY) ?? 1) / 2;
            const height = renderer.getTileHeightAtPlane(x, y, object.plane);
            const projected = renderer.worldToScreen(x, height, y);
            if (!projected) return;
            const bounds = canvas.getBoundingClientRect();
            const { screenWidth, screenHeight } = client.camera;
            return {
                x: bounds.left + projected[0] * bounds.width / Math.max(1, screenWidth),
                y: bounds.top + projected[1] * bounds.height / Math.max(1, screenHeight),
            };
        },
        selectPointer: (tile, onlyObjects) => {
            clearSelectionHighlight();
            const { renderer, target } = resolvePointerTarget(onlyObjects);
            // Ground items use a separate editor tool.
            if (renderer && target && (target.kind === "loc" || target.kind === "npc")) {
                selectedModelTarget = target;
                renderer.interactHighlightActiveTarget = target;
                renderer.interactHighlightActiveFromInteraction = false;
                renderer.interactHighlightClickTick = -1;
                if (target.kind === "loc") {
                    return {
                        kind: "loc" as const,
                        tileX: target.tileX,
                        tileY: target.tileY,
                        plane: target.plane,
                        locId: target.locId,
                        locName: client.locTypeLoader.load(target.locId)?.name ?? "",
                        shape: target.locModelType,
                        rotation: target.locRotation,
                    };
                }
                const npcTile = renderer.getNpcWorldTile(target.ecsId);
                const npcServerId = client.npcEcs.getServerId(target.ecsId);
                const spawnEntry = findLoadedNpcSpawn(npcServerId);
                const edits = plugin.getConfig().edits;
                // A loaded game spawn is that spawn even when an editor-placed copy of it shares the tile.
                const customEdit = spawnEntry ? undefined : edits.find((edit) =>
                    edit.kind === "npc" &&
                    edit.locId === target.npcTypeId &&
                    edit.tileX === npcTile.x &&
                    edit.tileY === npcTile.y &&
                    edit.plane === target.plane,
                );
                const wanderEdit = edits.find((edit) =>
                    edit.kind === "npcWander" &&
                    edit.locId === target.npcTypeId &&
                    edit.tileX === npcTile.x &&
                    edit.tileY === npcTile.y &&
                    edit.plane === target.plane,
                );
                return {
                    kind: "npc" as const,
                    tileX: npcTile.x,
                    tileY: npcTile.y,
                    plane: target.plane,
                    locId: target.npcTypeId,
                    locName:
                        client.npcTypeLoader.load(target.npcTypeId)?.name ?? "",
                    ...(npcServerId > 0 ? { npcServerId } : {}),
                    npcSource: customEdit ? "custom" as const : spawnEntry ? "spawn" as const : undefined,
                    npcSpawn: spawnEntry?.spawn,
                    npcWanderRadius: customEdit
                        ? customEdit.wanderRadius ?? 5
                        : wanderEdit?.wanderRadius ?? spawnEntry?.spawn.wanderRadius ?? 5,
                    npcLeashRadius: customEdit ? customEdit.leashRadius
                        : wanderEdit?.leashRadius === undefined ? spawnEntry?.spawn.leashRadius : wanderEdit.leashRadius,
                };
            }

            return selectTileRange(tile, tile);
        },
        captureSelectionImage: () => {
            const renderer = terrainHost(client);
            const target = selectedModelTarget;
            if (!renderer || !target) return Promise.resolve(undefined);
            const triangles = renderer.buildHighlightTrianglePoints(target);
            return renderer.editorOverlays?.capture(triangles ?? [])
                ?? ensureModelImageCaptureOverlay(renderer)?.capture(triangles ?? []) ?? Promise.resolve(undefined);
        },
        afterNextSceneFrame: (callback) => {
            if (typeof requestAnimationFrame !== "function") {
                callback();
                return;
            }
            const frame = terrainHost(client)?.currentFrameCount;
            let attempts = 0;
            const wait = (): void => {
                if (terrainHost(client)?.currentFrameCount !== frame || ++attempts >= 3) callback();
                else requestAnimationFrame(wait);
            };
            requestAnimationFrame(wait);
        },
        selectTileRange,
        clearSelectionHighlight,
        setPlacementPreview: (kind, id, tile, shape, rotation) => {
            if (kind === "npc") {
                locPlacementPreviewOverlay?.clear();
                const sameNpc =
                    previewNpc &&
                    previewNpcType === (id | 0) &&
                    previewNpcRotation === (rotation | 0);
                if (!sameNpc && previewNpc) {
                    despawnEditorNpc(client, EDITOR_NPC_PREVIEW_SERVER_ID);
                    previewNpc = false;
                }
                previewNpc =
                    spawnEditorNpc(client, id, tile, rotation, EDITOR_NPC_PREVIEW_SERVER_ID) !==
                    undefined;
                previewNpcType = id | 0;
                previewNpcRotation = rotation | 0;
                return;
            }

            if (previewNpc) despawnEditorNpc(client, EDITOR_NPC_PREVIEW_SERVER_ID);
            previewNpc = false;
            previewNpcType = -1;
            previewNpcRotation = -1;
            const renderer = terrainHost(client);
            if (!renderer) return;
            ensureBuildingHighlightRenderer(renderer);
            ensureLocPlacementPreviewOverlay(renderer)?.setPreview(
                client as unknown as LocPlacementPreviewClient,
                client.renderer as unknown as LocPlacementPreviewRenderer,
                {
                locId: id,
                x: tile.tileX,
                y: tile.tileY,
                plane: tile.plane,
                shape,
                rotation,
                },
            );
        },
        setWallPreview: (walls, height, floors = []) => {
            if (!walls.length && !floors.length) {
                clearPlacementPreview();
                return;
            }
            if (previewNpc) despawnEditorNpc(client, EDITOR_NPC_PREVIEW_SERVER_ID);
            previewNpc = false;
            previewNpcType = -1;
            previewNpcRotation = -1;
            locPlacementPreviewOverlay?.clear();
            const renderer = terrainHost(client);
            if (!renderer) return;
            const colors = new Map<number, number | undefined>();
            const rects: ZoneGroundRect[] = floors.flatMap((floor) => {
                if (!colors.has(floor.locId)) colors.set(floor.locId, paintPreviewColor(floor.locId));
                const colorRgb = colors.get(floor.locId);
                if (colorRgb === undefined) return [];
                return [{
                    minX: floor.tileX, maxX: floor.tileX, minY: floor.tileY, maxY: floor.tileY,
                    plane: floor.plane, colorRgb, alpha: 0.52, height: floor.previewHeight,
                    shape: floor.shape, rotation: floor.rotation,
                }];
            });
            if (height !== undefined && walls.length > 0) {
                const ground = { plane: walls[0].plane, colorRgb: WALL_PREVIEW_GROUND_COLOR, alpha: 0.65, height };
                if (walls[0].shape === 9) {
                    for (const wall of walls) rects.push({
                        ...ground, minX: wall.tileX, maxX: wall.tileX, minY: wall.tileY, maxY: wall.tileY,
                    });
                } else {
                    rects.push({
                        ...ground, minX: Math.min(...walls.map((wall) => wall.tileX)),
                        maxX: Math.max(...walls.map((wall) => wall.tileX)),
                        minY: Math.min(...walls.map((wall) => wall.tileY)),
                        maxY: Math.max(...walls.map((wall) => wall.tileY)),
                    });
                }
            }
            ensureWallGroundOverlay(renderer)?.setRects(rects);
            ensureBuildingHighlightRenderer(renderer);
            drawConstructionPreviews(renderer, walls.map((wall) => ({
                locId: wall.locId, x: wall.tileX, y: wall.tileY, plane: wall.plane,
                shape: wall.shape, rotation: wall.rotation, height: wall.previewHeight ?? height,
            })));
        },
        clearPlacementPreview,
        setAudioMuted: (muted) => {
            setAudioSuspended(muted);
            // Music also has an HTMLAudio fallback outside the Web Audio graph.
            client.musicSystem?.setMuted(muted);
        },
        onLocAddChange: (locId, tile, level, shape, rotation) => {
            const renderer = terrainHost(client);
            renderer?.pendingLocUpdates?.add(renderer.getMapIdForWorldTile(tile.x, tile.y));
            client.onLocAddChange(locId, tile, level, shape, rotation);
        },
        onLocDel: (tile, level, shape, rotation) => {
            const renderer = terrainHost(client);
            renderer?.pendingLocUpdates?.add(renderer.getMapIdForWorldTile(tile.x, tile.y));
            const overrides = locOverrideStore(client);
            const before = new Set(overrides?.keys());
            client.onLocDel(tile, level, shape, rotation);
            const added = [...(overrides?.keys() ?? [])].filter((key) => !before.has(key));
            if (added.length === 0) return;
            const slot = `${tile.x},${tile.y},${level},${shape},${rotation}`;
            deletedLocOverrides.set(slot, [...(deletedLocOverrides.get(slot) ?? []), ...added]);
        },
        restoreLoc: (tile, level, shape, rotation) => {
            const renderer = terrainHost(client);
            const slot = `${tile.x},${tile.y},${level},${shape},${rotation}`;
            const keys = deletedLocOverrides.get(slot);
            if (!renderer || !keys) return;
            deletedLocOverrides.delete(slot);
            const overrides = locOverrideStore(client);
            for (const key of keys) overrides?.delete(key);
            reloadTile(renderer, { tileX: tile.x, tileY: tile.y, plane: level });
        },
        getLocPlacementShape: (locId) => {
            const base = client.locTypeLoader.load(locId);
            const type = base.transforms ? base.transform(client.varManager, client.locTypeLoader) ?? base : base;
            return getLocPlacementShape(type);
        },
        getLocPlacementShapes: (locId) => {
            const loc = client.locTypeLoader.load(locId);
            return loc.types?.length ? [...new Set(loc.types)].filter((shape) => shape >= 0 && shape <= 22) : [getLocPlacementShape(loc)];
        },
        hasLocAt: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer?.getPreferredMapForWorldTile(tile.tileX, tile.tileY)) return true;
            return renderer.getLocIdsAtTileAllLevels(tile.tileX, tile.tileY)
                .some(({ level, typeRot }) => level === tile.plane && (typeRot === undefined || typeRot >> 2 !== 22));
        },
        getStampObjectInfo: (id) => {
            try {
                const loc = client.locTypeLoader.load(id);
                if (!loc?.models?.length && !loc?.transforms?.length) return;
                return { sizeX: loc.sizeX, sizeY: loc.sizeY, interactive: loc.actions?.some(Boolean) ?? false };
            } catch {
                return;
            }
        },
        isEditableMapRegion: (id) => editorRegionReplacements.has(id) ||
            terrainHost(client)?.mapRegionReplacements.has(id) === true ||
            client.mapFileIndex.getTerrainArchiveId(id >> 8, id & 255) !== -1,
        validateStampRegions: (regions) => {
            const unavailable = regions.filter((id) => !readEditorRegion(client, id, editorRegionReplacements));
            if (unavailable.length === 0) return;
            const retry = () => {
                const missing = unavailable.find((id) => !readEditorRegion(client, id, editorRegionReplacements));
                if (missing !== undefined) throw new Error(`Could not read map data for region ${missing}. Try placing the stamp again.`);
            };
            if (client.js5) return client.js5.settled().then(retry);
            retry();
        },
        prepareNewRegion: async (id, underlay, cave, copyFrom) => {
            const x = id >> 8;
            const y = id & 255;
            if (!Number.isInteger(id) || id < 0 || x >= MapManager.MAX_MAP_X || y >= MapManager.MAX_MAP_Y) {
                throw new Error(`Choose map-square coordinates within 0–${MapManager.MAX_MAP_X - 1}, 0–${MapManager.MAX_MAP_Y - 1}`);
            }
            if (client.mapFileIndex.getTerrainArchiveId(x, y) !== -1 || client.mapFileIndex.getLocArchiveId(x, y) !== -1 ||
                editorRegionReplacements.has(id) ||
                terrainHost(client)?.mapRegionReplacements.has(id)) {
                throw new Error(`Region ${id} already has a map`);
            }
            let source;
            if (copyFrom !== undefined) {
                const tile = { tileX: (copyFrom >> 8) << 6, tileY: (copyFrom & 255) << 6, plane: 0 };
                const load = () => buildEditorRegionPack(client, tile, [], editorRegionReplacements, false);
                let pack;
                try {
                    pack = load();
                } catch (error) {
                    if (!client.js5) throw error;
                    await client.js5.settled();
                    pack = load();
                }
                source = parseRegionPack(pack.data);
            }
            return createRegionPack(id, hasWideTerrain(client), underlay, cave, source);
        },
        showLandscapePreview: (packs) => {
            const incoming = packs.map(({ data }) => parseRegionPack(data));
            const next = new Set(incoming.map(({ regionId }) => regionId));
            for (const id of landscapePreviewIds) {
                if (next.has(id)) continue;
                const base = editorRegionReplacements.get(id);
                if (base) client.onRegionReplacement({ regionId: id, ...base, allowReload: true });
                else clearEditorReplacement(id);
            }
            landscapePreviewIds = next;
            const distance = plugin.getConfig().renderDistance;
            if (incoming.length) {
                const columns = incoming.map(({ regionId }) => regionId >> 8);
                const rows = incoming.map(({ regionId }) => regionId & 255);
                const span = 1 + Math.max(Math.max(...columns) - Math.min(...columns), Math.max(...rows) - Math.min(...rows));
                landscapeViewDistance = Math.min(160, span * 42 + 24);
                client.editorRenderDistance = Math.max(landscapeViewDistance, distance ?? 0);
            } else {
                landscapeViewDistance = undefined;
                client.editorRenderDistance = plugin.handlesCanvasInput() ? distance : undefined;
            }
            for (const replacement of incoming) client.onRegionReplacement({ ...replacement, allowReload: true });
        },
        frameLandscape: (tile, span) => {
            client.camera.snapToYaw(EDITOR_CAMERA_YAW);
            client.camera.snapToPitch(span <= 64 ? 410 : 465);
            frameCameraOnTile(client, tile, false, Math.max(46, Math.min(138, span * 0.8)));
        },
        previewNewRegion: (data) => {
            const pack = parseRegionPack(data);
            editorRegionReplacements.set(pack.regionId, pack);
            client.onRegionReplacement({ ...pack, allowReload: true });
        },
        removeNewRegion: clearEditorReplacement,
        isRegionOccupied,
        loadTemplateCatalog: async () => JSON.parse(await loadLocalEditorData("templates")),
        loadTemplate: async (name) => JSON.parse(await loadLocalEditorData(`templates/${encodeURIComponent(name)}`)),
        loadMapPlans: async () => JSON.parse(await loadLocalEditorData("map-plans")),
        previewMapPlan: async (query) => {
            const result = JSON.parse(await loadLocalEditorData(`map-plans/preview?${query}`));
            if (result?.error) throw new Error(result.error);
            return result;
        },
        loadTravel: async (kind) => JSON.parse(await loadLocalEditorData(kind)),
        getLocActions: (id) => client.locTypeLoader.load(id)?.actions ?? [],
        loadGroundItems: async () => JSON.parse(await loadLocalEditorData("ground-items-custom")),
        previewGroundItems: (items) => client.setEditorGroundItemPreview(items.map((item, index) => ({
            id: -index - 1, itemId: item.id, quantity: item.amt, enabledOps: 0,
            tile: { x: item.location.x, y: item.location.y, level: item.location.z },
            name: "", gePrice: 0, haPrice: 0, tradeable: false,
        }))),
        getLocName: (locId) => client.locTypeLoader?.load(locId)?.name ?? "",
        getNpcName: (npcTypeId) => client.npcTypeLoader?.load(npcTypeId)?.name ?? "",
        search: async (kind, query) => {
            const loader = (
                kind === "npc"
                    ? client.npcTypeLoader
                    : kind === "item"
                      ? client.objTypeLoader
                      : client.locTypeLoader
            ) as unknown as NamedTypeLoader | undefined;
            if (!loader) return [];
            return searchEditorCache(kind, loader, query);
        },
        describeDefinition: (kind, id) => describeDefinition(client, kind, id),
        loadPersistedNpcSpawnEdits,
        isWaterOverlay: (id) => {
            const overlay = id > 0 ? client.loaderFactory?.getOverlayTypeLoader?.().load(id - 1) : undefined;
            return !!overlay && overlay.textureId !== 91 && isKnownWaterTextureId(overlay.textureId);
        },
        getOverlayTexture: (textureId) => {
            const cached = overlayTexturePreviews.get(textureId);
            if (cached) return cached;
            if (!client.textureLoader) return undefined;
            try {
                const size = 128;
                const pixels = client.textureLoader.getPixelsArgb(textureId, size, true, 1);
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = size;
                const ctx = canvas.getContext("2d");
                if (!ctx) return undefined;
                const image = ctx.createImageData(size, size);
                for (let i = 0; i < pixels.length; i++) {
                    image.data[i * 4] = (pixels[i] >>> 16) & 255;
                    image.data[i * 4 + 1] = (pixels[i] >>> 8) & 255;
                    image.data[i * 4 + 2] = pixels[i] & 255;
                    image.data[i * 4 + 3] = pixels[i] >>> 24;
                }
                ctx.putImageData(image, 0, 0);
                const url = canvas.toDataURL();
                overlayTexturePreviews.set(textureId, url);
                return url;
            } catch {
                // Sparse-cache textures may still be downloading; the palette retries them.
                return undefined;
            }
        },
        getOverlaySwatches: () => {
            const loader = client.loaderFactory?.getOverlayTypeLoader?.();
            if (!loader) return [];
            const swatches = [];
            for (let id = 1; id <= loader.getCount(); id++) {
                try {
                    // Tile overlay IDs are one-based; cache definitions are zero-based.
                    const overlay = loader.load(id - 1);
                    swatches.push({
                        id,
                        colorRgb: overlay.primaryRgb & 0xffffff,
                        textureId: overlay.textureId >= 0 && client.textureLoader?.isSd(overlay.textureId)
                            ? overlay.textureId : undefined,
                        name: overlay.name,
                    });
                } catch {
                    // Sparse caches can still be fetching an overlay definition.
                }
            }
            return swatches;
        },
        getUnderlaySwatches: () => {
            const loader = client.loaderFactory?.getUnderlayTypeLoader?.();
            if (!loader) return [];
            const swatches = [];
            for (let id = 1; id <= loader.getCount(); id++) {
                try {
                    const floor = loader.load(id - 1);
                    if ("rgbColor" in floor && typeof floor.rgbColor === "number") {
                        swatches.push({ id, colorRgb: floor.rgbColor & 0xffffff });
                    }
                } catch {
                    // The cache definition may still be downloading.
                }
            }
            return swatches;
        },
        loadWorldDefinition,
        spawnNpc: (npcTypeId, tile, rotation, direction) => direction === undefined
            ? spawnEditorNpc(client, npcTypeId, tile, rotation)
            : spawnEditorNpcWithOrientation(client, npcTypeId, tile, DIRECTION_TO_ORIENTATION[direction] ?? 0),
        setFreeCamera: (enabled) => {
            if (enabled) {
                for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
                    client.inputManager.keys?.delete(code);
                }
                client.stopKeyboardMovement?.(true);
            }
            client.followPlayerCamera = !enabled;
        },
        setScenePreview: (enabled, spawn) => {
            client.scenePreviewEnabled = enabled;
            client.scenePreviewLoadingStartedAt = enabled ? performance.now() : undefined;
            // Pull agent/pack edits when the preview starts: the scene (and its
            // map data) is ready then, so this cannot race the initial load.
            if (enabled) void syncServerReplacements();
            if (!enabled) {
                client.editorLaunching = false;
                document.body.classList.remove("map-editor-launching");
                return;
            }
            // Logged out the camera still holds the title-screen angles and sits
            // 26 tiles up with nothing framed, which reads as a skewed world.
            frameCameraOnTile(
                client,
                spawn ?? {
                    tileX: Math.round(client.camera.getPosX()),
                    tileY: Math.round(client.camera.getPosZ()),
                    plane: plugin.getConfig().heightLevel,
                },
                true,
                EDITOR_OPENING_CAMERA_DISTANCE,
            );
        },
        setHeightLevel: () => {
            const renderer = terrainHost(client);
            if (renderer) ensureHeightLevelRenderer(renderer);
        },
        setRenderAllHeightLevels: () => {
            const renderer = terrainHost(client);
            if (renderer) ensureHeightLevelRenderer(renderer);
        },
        isLoggedIn: () => client.isLoggedIn(),
        testTile: (tile) => {
            sendChat(`::tele ${tile.tileX} ${tile.tileY} ${tile.plane}`);
            frameCameraOnTile(client, tile, false);
        },
        reloadSavedRegions: (ids) => sendChat(`::reloadmap ${ids.join(" ")}`),
        jumpCameraToTile: (tile) => {
            frameCameraOnTile(client, tile, false);
        },
        hasWideTerrain: () => hasWideTerrain(client),
        copyArea: (bounds, edits) => {
            if (!objectSpawns) throw new Error("Object spawns are still loading; try Copy again shortly");
            const spawns: BrowserHostNpcSpawn[] = [];
            for (let x = bounds.minX >> 6; x <= bounds.maxX >> 6; x++) {
                for (let y = bounds.minY >> 6; y <= bounds.maxY >> 6; y++) {
                    const entries = loadedNpcSpawnRegions.get((x << 8) | y);
                    if (!entries) throw new Error("NPC spawns are still loading; try Copy again shortly");
                    spawns.push(...entries.filter(entry => !entry.hidden).map(entry => entry.spawn));
                }
            }
            return buildAreaClipboard(
                bounds,
                (tileX, tileY) => buildEditorRegionPack(client, { tileX, tileY, plane: 0 }, sceneEdits(edits), editorRegionReplacements).data,
                hasWideTerrain(client), copyAreaNpcs(spawns, edits),
            );
        },
        getAreaNpcs: ({ minX, maxX, minY, maxY }) => {
            const inside = ({ tileX, tileY }: { tileX: number; tileY: number }) =>
                tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY;
            const result: BrowserHostNpcSpawn[] = [];
            const edits = plugin.getConfig().edits;
            for (const entries of loadedNpcSpawnRegions.values()) {
                for (const { spawn, hidden } of entries) {
                    if (hidden || !inside(spawn)) continue;
                    const edit = edits.find((edit) => edit.kind === "npcWander" && edit.locId === spawn.id &&
                        edit.tileX === spawn.tileX && edit.tileY === spawn.tileY && edit.plane === spawn.plane);
                    result.push({
                        ...spawn, wanderRadius: edit?.wanderRadius ?? spawn.wanderRadius,
                        leashRadius: edit?.leashRadius === undefined ? spawn.leashRadius : edit.leashRadius,
                    });
                }
            }
            for (const edit of edits) {
                if (edit.kind === "npc" && inside(edit)) result.push({
                    id: edit.locId, tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane,
                    direction: edit.direction ?? quarterTurnToDirection(edit.rotation),
                    wanderRadius: edit.wanderRadius, leashRadius: edit.leashRadius,
                });
            }
            return result;
        },
        getRegionOverlays: (regionId, edits) => {
            try {
                // Objects play no part in overlays, so their edits are left out of the pack.
                const pack = buildEditorRegionPack(client, {
                    tileX: (regionId >> 8) << 6, tileY: (regionId & 0xff) << 6, plane: 0,
                }, edits, editorRegionReplacements, false);
                return readRegionOverlays(parseRegionPack(pack.data).terrainData, hasWideTerrain(client));
            } catch {
                return undefined;
            }
        },
        getLoadedMapData: (id) => editorRegionReplacements.get(id),
        markMapEditsSaved: (packs, spawns) => {
            for (const pack of packs) {
                const parsed = parseRegionPack(pack.data);
                editorRegionReplacements.set(pack.regionId, parsed);
                if (!browserHostWindow()) savedAwaitingLoad.add(pack.regionId);
            }
            if (spawns !== undefined) objectSpawns = spawns;
        },
        exportObjectSpawns: (edits, saveToJson) => {
            if (!objectSpawns) throw new Error("Object spawns are still loading from the host; try Save again shortly");
            return buildObjectSpawnExport(objectSpawns, edits, saveToJson, (regionId) =>
                parseRegionPack(buildEditorRegionPack(client, {
                    tileX: (regionId >> 8) << 6, tileY: (regionId & 0xff) << 6, plane: 0,
                }, [], editorRegionReplacements).data).objectData,
            );
        },
        exportRegionPack: (tile, edits, saveToJson) => {
            if (!objectSpawns) throw new Error("Object spawns are still loading from the host; try Save again shortly");
            const regionId = regionIdForTile(tile.tileX, tile.tileY);
            const bakeObjects = !saveToJson && edits.some((edit) => isLocEdit(edit) && regionIdForTile(edit.tileX, edit.tileY) === regionId);
            return buildEditorRegionPack(client, tile, bakeObjects ? sceneEdits(edits) : edits, editorRegionReplacements, bakeObjects);
        },
        rotateCamera: (deltaX, deltaY) => {
            const camera = client.camera;
            camera.updateYaw(camera.yaw, deltaX * 0.9);
            camera.updatePitch(camera.pitch, deltaY * 0.9);
        },
        cancelPendingClick: () => {
            const input = client.inputManager;
            input.clickMode1 = 0;
            input.clickMode2 = 0;
            input.clickMode3 = 0;
            input.saveClickX = -1;
            input.saveClickY = -1;
            // Drop the click cross too; the editor is not the game.
            ClientState.mouseCrossColor = 0;
            ClientState.mouseCrossState = 100;
        },
        levelCamera: () => {
            client.camera.snapToYaw(EDITOR_CAMERA_YAW);
            client.camera.snapToPitch(EDITOR_CAMERA_PITCH);
        },
        toggleWorldMap: (actions) => {
            editorWorldMap.toggle(plugin.getCameraTile(), actions);
        },
        isEditorModalOpen: () => editorWorldMap.isOpen(),
        closeEditorWorldMap: () => editorWorldMap.close(),
        setTerrainOverlay: (tile, overlay, shape, rotation) => {
            const renderer = terrainHost(client);
            if (!renderer) return;
            const key = `${tile.tileX},${tile.tileY},${tile.plane}`;
            renderer.terrainOverrides.set(key, {
                overlay: overlay | 0,
                shape: shape | 0,
                rotation: rotation & 0x3,
            });
            const colorRgb = paintPreviewColor(overlay);
            const rects = overlay === 0 ? basePaintPreview(tile, false) : colorRgb === undefined ? [] : [paintRect(tile, colorRgb, shape, rotation)];
            queuePaintReload(renderer, tile, key, rects);
        },
        setTerrainPreview,
        clearTerrainPreview,
        setScatterBrushPreview,
        previewScatteredLocs,
        clearTerrainOverride: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer) return;
            const key = `${tile.tileX},${tile.tileY},${tile.plane}`;
            renderer.terrainOverrides.delete(key);
            const mapId = renderer.getMapIdForWorldTile(tile.tileX, tile.tileY);
            const stillPreviewing = paintRects.get(mapId)?.has(key);
            queuePaintReload(renderer, tile, key, stillPreviewing ? [] : basePaintPreview(tile, true));
        },
        getTerrainOverlay: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer) return undefined;
            const override = renderer.terrainOverrides.get(`${tile.tileX},${tile.tileY},${tile.plane}`)?.overlay;
            if (override !== undefined) return override;
            const map = renderer.getPreferredMapForWorldTile(tile.tileX, tile.tileY);
            if (!map?.tileOverlays) return undefined;
            const x = Math.floor(tile.tileX - map.getRenderBaseWorldX()) + map.borderSize;
            const y = Math.floor(tile.tileY - map.getRenderBaseWorldY()) + map.borderSize;
            return (map.tileOverlays[tile.plane]?.[x]?.[y] ?? 0) & 0x7fff;
        },
        getTerrainHeight: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer?.getPreferredMapForWorldTile(tile.tileX, tile.tileY)) return undefined;
            return renderer.getTileHeightAtPlane(tile.tileX, tile.tileY, tile.plane);
        },
        getTerrainFlags: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer?.getPreferredMapForWorldTile(tile.tileX, tile.tileY)) return undefined;
            return renderer.getTileRenderFlagAt(tile.plane, tile.tileX, tile.tileY);
        },
        getBaseRegionFlags: (regionId) => {
            const x = regionId >> 8;
            const y = regionId & 255;
            try {
                const data = editorRegionReplacements.get(regionId)?.terrainData ??
                    client.loaderFactory.getMapFileLoader().getTerrainData(x, y, client.loadedCache?.xteas);
                if (!data) return;
                const cached = flagsByTerrain.get(data);
                if (cached) return cached;
                const flags = readRegionFlags(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), hasWideTerrain(client));
                flagsByTerrain.set(data, flags);
                return flags;
            } catch { return undefined; }
        },
        showBlockedTiles: (tiles) => {
            client.tileHighlightManager.clear(EDITOR_BLOCKED_TILE_SLOT);
            if (!tiles.length) return;
            client.tileHighlightManager.configure(EDITOR_BLOCKED_TILE_SLOT, 0xef4444, 1, 35, TILE_HIGHLIGHT_ALWAYS_ON_TOP);
            for (const tile of tiles) {
                client.tileHighlightManager.set(
                    packWorldMapCoord({ x: tile.tileX, y: tile.tileY, plane: tile.plane }),
                    EDITOR_BLOCKED_TILE_SLOT, EDITOR_BLOCKED_TILE_SLOT,
                );
            }
        },
        showTravelMarkers: (sources, arrivals) => {
            const draw = (tiles: readonly EditModeTile[], slot: number, color: number) => {
                client.tileHighlightManager.clear(slot);
                if (!tiles.length) return;
                client.tileHighlightManager.configure(slot, color, 2, 25, TILE_HIGHLIGHT_ALWAYS_ON_TOP);
                for (const tile of tiles) client.tileHighlightManager.set(
                    packWorldMapCoord({ x: tile.tileX, y: tile.tileY, plane: tile.plane }), slot, slot,
                );
            };
            draw(sources, EDITOR_TRAVEL_SOURCE_SLOT, 0xfbbf24);
            draw(arrivals, EDITOR_TRAVEL_ARRIVAL_SLOT, 0x67e8f9);
        },
        refreshEditedRegions,
        syncServerReplacements,
        despawnNpc: (serverId) => {
            // Dev-only: reuse the server despawn path rather than duplicating
            // the ECS/world-view teardown it performs.
            despawnEditorNpc(client, serverId);
        },
        countNpcSpawns: (spawn) => {
            const key = npcSpawnKey(spawn);
            let count = 0;
            for (const entries of loadedNpcSpawnRegions.values()) {
                for (const entry of entries) if (!entry.hidden && npcSpawnKey(entry.spawn) === key) count++;
            }
            return count;
        },
        // One removal marker hides one spawn: a stacked tile keeps its other spawns, as the server does.
        hideNpcSpawn: (spawn) => {
            const key = npcSpawnKey(spawn);
            hiddenNpcSpawns.hide(key);
            for (const entries of loadedNpcSpawnRegions.values()) {
                const entry = entries.find((candidate) => !candidate.hidden && npcSpawnKey(candidate.spawn) === key);
                if (!entry) continue;
                entry.hidden = true;
                despawnEditorNpc(client, entry.serverId);
                return;
            }
        },
        showNpcSpawn: (spawn) => {
            const key = npcSpawnKey(spawn);
            hiddenNpcSpawns.show(key);
            for (const entries of loadedNpcSpawnRegions.values()) {
                const entry = entries.find((candidate) => candidate.hidden && npcSpawnKey(candidate.spawn) === key);
                if (!entry) continue;
                entry.hidden = false;
                if (client.npcEcs.getEcsIdForServer(entry.serverId) !== undefined) return;
                const serverId = spawnStaticEditorNpc(client, entry.spawn, entry.serverId);
                if (serverId !== undefined) entry.serverId = serverId;
                return;
            }
        },
    });

    let lastPreviewEdits: readonly EditModeEdit[] | undefined;
    plugin.subscribe(() => {
        const edits = plugin.getConfig().edits;
        if (scatterPreviews.size && edits !== lastPreviewEdits) {
            lastPreviewEdits = edits;
            const placements = new Set(edits.filter((edit) => edit.kind === "place").map(scatterKey));
            let changed = false;
            for (const [region, previews] of scatterPreviews) {
                for (const key of previews.keys()) {
                    if (!placements.has(key)) changed = previews.delete(key) || changed;
                }
                if (!previews.size) {
                    scatterPreviews.delete(region);
                    submittedScatter.delete(region);
                }
            }
            if (changed) drawScatteredLocs();
        }
        if (objectSpawnPreviewPending && plugin.getState().scenePreview) {
            objectSpawnPreviewPending = false;
            void refreshEditedRegions([...new Set((objectSpawns ?? []).map((spawn) => regionIdForTile(spawn.position.x, spawn.position.y)))]);
        }
        syncMapIconLoop();
        syncWorldZoneLoop();
        syncWorldSpawnHighlight();
    });

    // The welcome screen's "Edit Mode" button is the way in, and Ctrl+E arms
    // it while logged in.
    plugin.setConfig({ enabled: true });
    const host = browserHostWindow();
    if (isBrowserHostClient() && host) {
        const hostOrigin = browserHostOrigin();
        connectEditorCustomContent(client, host, hostOrigin, () => {
            const { query, kind } = plugin.getState().search;
            plugin.searchCache(query, kind);
        });
        window.addEventListener("message", (event: MessageEvent) => {
            if (event.origin !== hostOrigin || event.source !== host) return;
            const message = event.data as RegionPackMessage | NpcSpawnMessage | ObjectSpawnsMessage | undefined;
            if (message?.type === OBJECT_SPAWNS_MESSAGE) {
                try {
                    if (objectSpawns) return;
                    objectSpawns = parseObjectSpawns(message.contents);
                    objectSpawnPreviewPending = true;
                    if (plugin.getState().scenePreview) {
                        objectSpawnPreviewPending = false;
                        void refreshEditedRegions([...new Set(objectSpawns.map((spawn) => regionIdForTile(spawn.position.x, spawn.position.y)))]);
                    }
                } catch (error) {
                    console.warn("[edit-mode] ignored invalid object spawns", error);
                }
                return;
            }
            if (message?.type === NPC_SPAWN_MESSAGE) {
                const regionIds = Array.isArray(message.regionIds) ? message.regionIds : [];
                if (!npcRuntimeReady()) {
                    for (const regionId of regionIds) pendingNpcSpawnRegions.delete(regionId);
                    return;
                }
                const byRegion = new Map<number, BrowserHostNpcSpawn[]>();
                for (const spawn of Array.isArray(message.spawns) ? message.spawns : []) {
                    if (![spawn.id, spawn.tileX, spawn.tileY, spawn.plane].every(Number.isInteger)) continue;
                    const regionId = regionIdForTile(spawn.tileX, spawn.tileY);
                    const entries = byRegion.get(regionId);
                    if (entries) entries.push(spawn);
                    else byRegion.set(regionId, [spawn]);
                }
                for (const regionId of regionIds) {
                    pendingNpcSpawnRegions.delete(regionId);
                    if (loadedNpcSpawnRegions.has(regionId)) continue;
                    loadedNpcSpawnRegions.set(regionId, loadNpcSpawnRegion(byRegion.get(regionId) ?? [], hiddenNpcSpawns,
                        (spawn) => spawnStaticEditorNpc(client, spawn), reserveEditorNpcServerId));
                }
                return;
            }
            const data = message && copyRegionPackBytes(message.data);
            if (message?.type !== REGION_PACK_MESSAGE || !data) return;
            try {
                const pack = parseRegionPack(data);
                if (pack.regionId !== message.regionId) throw new Error("Region id does not match pack");
                editorRegionReplacements.set(pack.regionId, pack);
                client.onRegionReplacement({ ...pack, allowReload: true });
            } catch (error) {
                console.warn("[edit-mode] ignored invalid host region pack", error);
            }
        });
        host.postMessage({ type: REGION_PACK_REQUEST_MESSAGE }, hostOrigin);
        const requestObjectSpawns = () => {
            if (!objectSpawns && !host.closed) host.postMessage({ type: OBJECT_SPAWNS_REQUEST_MESSAGE }, hostOrigin);
        };
        requestObjectSpawns();
        window.setInterval(requestObjectSpawns, 2000);
    }
    const mapManager = client.renderer.mapManager;
    const onMapAdded = mapManager.onMapAdded;
    mapManager.onMapAdded = (mapX, mapY) => {
        onMapAdded?.(mapX, mapY);
        const regionId = (mapX << 8) | mapY;
        const replacement = editorRegionReplacements.get(regionId);
        if (replacement && !terrainHost(client)?.mapRegionReplacements.has(regionId)) {
            client.onRegionReplacement({ regionId, ...replacement, allowReload: true });
        }
        plugin.reapplyNpcsForMap(mapX, mapY);
        for (const entry of loadedNpcSpawnRegions.get(regionId) ?? []) {
            if (entry.hidden) continue;
            if (client.npcEcs.getEcsIdForServer(entry.serverId) === undefined) {
                spawnStaticEditorNpc(client, entry.spawn, entry.serverId);
            }
        }
    };
    let teardownEditorUi: (() => void) | undefined;
    let editorUiLoadingTimer: number | undefined;
    const syncEditorUi = () => {
        const state = plugin.getState();
        const loading = client.scenePreviewLoadingStartedAt !== undefined;
        if (loading && editorUiLoadingTimer === undefined) {
            editorUiLoadingTimer = window.setTimeout(() => {
                editorUiLoadingTimer = undefined;
                syncEditorUi();
            }, 100);
        }
        const active = !loading && state.config.enabled && (state.scenePreview || state.config.active);
        if (active && !teardownEditorUi) {
            teardownEditorUi = mountEditorUi(plugin);
            client.editorLaunching = false;
            document.body.classList.remove("map-editor-launching");
        } else if (!active && teardownEditorUi) {
            teardownEditorUi();
            teardownEditorUi = undefined;
        }
    };
    plugin.subscribe(syncEditorUi);
    syncEditorUi();

    // ?edit=1 opens the client straight in the editor instead of changing the
    // normal welcome-screen button.
    if (isMapEditorUrl()) {
        const requested = parseEditorLocation(new URLSearchParams(window.location.search).get("at") ?? "");
        // ponytail: polled, because the cache load and the world definition
        // fetch settle independently and neither has a ready event to hook.
        const timer = window.setInterval(() => {
            // Entering LOGIN_SCREEN resets the world; don't queue regions before that reset.
            if (client.gameState !== GameState.LOGIN_SCREEN) return;
            if (!client.loadedCache || plugin.getState().world.loading) return;
            window.clearInterval(timer);
            plugin.setScenePreview(true, requested && { ...requested, plane: requested.plane ?? 0 });
        }, 250);
    }
    window.setInterval(syncNpcSpawnRegions, 500);
    syncNpcSpawnRegions();
    return plugin;
}

/**
 * Terrain edits go straight into the renderer's override map and then force a
 * full map-square reload, the same route applyGamemodeWorldLocs takes.
 */
type TerrainHost = {
    currentFrameCount: number;
    getInteractLocModelLoader?(): LocModelLoader | undefined;
    getInteractNpcModelLoader?(): import("../../../rs/config/npctype/NpcModelLoader").NpcModelLoader | undefined;
    editorOverlays?: EditorOverlays;
    app?: PicoApp;
    sceneUniformBuffer?: UniformBuffer;
    overlayManager?: { add(overlay: Overlay): unknown };
    mapManager: {
        visibleMapCount: number;
        mapAddedListeners?: Set<(map: { mapX: number; mapY: number }) => void>;
        visibleMaps: Array<EditorPickMap & {
            mapX: number;
            mapY: number;
        }>;
    };
    screenToRay(mouseX: number, mouseY: number): Ray | null;
    worldToScreen(x: number, height: number, y: number): Float32Array | number[] | undefined;
    sceneRaycaster: Pick<SceneRaycaster, "raycast"> | null;
    getPlayerRawPlane(): number;
    getEffectivePlaneForTile(x: number, y: number, plane: number): number;
    getRenderCullTile(): { x: number; y: number };
    getFrameRenderDistanceTiles(): number;
    isMapWithinRenderDistance(
        map: unknown,
        tileX: number,
        tileY: number,
        renderDistanceTiles: number,
        renderDistancePadTiles: number,
    ): boolean;
    getMinimapIcons(mapX: number, mapY: number, level?: number): MinimapIcon[] | undefined;
    sampleHeightAtExactPlane(worldX: number, worldY: number, plane: number): number;
    getRoofPlaneLimit(): number;
    getTileRenderFlagAt(level: number, tileX: number, tileY: number): number;
    shouldRenderNpcFromMap(map: unknown, ecsId: number): boolean;
    shouldRenderPlayerIndex(ecsId: number): boolean;
    getInteractHighlightDrawTargets(): ReadonlyArray<InteractHighlightDrawTarget>;
    buildHighlightTrianglePoints(
        target: InteractHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined;
    getLocIdsAtTileAllLevels(
        tileX: number,
        tileY: number,
    ): Array<{ id: number; level: number; typeRot?: number }>;
    interactHighlightActiveTarget?: InteractHighlightTarget;
    interactHighlightHoverTarget?: InteractHighlightTarget;
    interactHighlightActiveFromInteraction: boolean;
    interactHighlightClickTick: number;
    clearInteractHighlightActiveTarget(): void;
    clearInteractHighlightHoverTarget(): void;
    resolveInteractHighlightTargetFromEntry(
        entry:
            | {
                  targetType?: MenuTargetType;
                  targetId?: number;
                  mapX?: number;
                  mapY?: number;
              }
            | undefined,
        fallbackTile?: EditModeTile,
    ): InteractHighlightTarget | undefined;
    resolveNpcHighlightTargetFromServerId(serverId: number): InteractHighlightTarget | undefined;
    getNpcWorldTile(ecsId: number): { x: number; y: number };
    terrainOverrides: Map<
        string,
        { underlay?: number; overlay?: number; shape?: number; rotation?: number }
    >;
    mapRegionReplacements: Map<
        number,
        { terrainData: Int8Array; objectData?: Int8Array }
    >;
    getPreferredMapForWorldTile(tileX: number, tileY: number): (EditorPickMap & { tileOverlays?: Int16Array[][] }) | undefined;
    getTileHeightAtPlane(tileX: number, tileY: number, plane: number): number;
    pendingLocUpdates?: Set<number>;
    getMapIdForWorldTile(x: number, y: number): number;
    scheduleLocReload(mapX: number, mapY: number): void;
};

function terrainHost(client: OsrsClient): TerrainHost | undefined {
    const backend = client.renderer as unknown as { interactionHost?: TerrainHost };
    const renderer = (backend.interactionHost ?? client.renderer) as unknown as TerrainHost | undefined;
    return renderer && renderer.terrainOverrides ? renderer : undefined;
}

/** Held by the renderer itself in both backends; WebGPU's interactionHost does not have it. */
function locOverrideStore(client: OsrsClient): Map<string, unknown> | undefined {
    return (client.renderer as unknown as { locOverrides?: Map<string, unknown> }).locOverrides;
}

function reloadTile(renderer: TerrainHost, tile: EditModeTile): void {
    const mapId = renderer.getMapIdForWorldTile(tile.tileX, tile.tileY);
    renderer.pendingLocUpdates?.add(mapId);
    renderer.scheduleLocReload(mapId >> 8, mapId & 0xff);
}

/** Revision 209 widened terrain values to two bytes. */
function hasWideTerrain(client: OsrsClient): boolean {
    return client.loadedCache?.info.game === "oldschool" && (client.loadedCache?.info.revision ?? 0) >= 209;
}

const EMPTY_MAP_OBJECTS = Uint8Array.of(0);

function readEditorRegion(client: OsrsClient, regionId: number, replacements: Map<number, EditorRegionReplacement>) {
    const mapX = regionId >> 8;
    const mapY = regionId & 255;
    const mapFileLoader = client.loaderFactory.getMapFileLoader();
    const replacement = replacements.get(regionId) ?? terrainHost(client)?.mapRegionReplacements.get(regionId);
    const xteas = client.loadedCache?.xteas;
    const terrainArchiveId = client.mapFileIndex.getTerrainArchiveId(mapX, mapY);
    const objectArchiveId = client.mapFileIndex.getLocArchiveId(mapX, mapY);
    const terrainData = replacement?.terrainData ?? mapFileLoader.getTerrainData(mapX, mapY, xteas);
    const objectData = replacement?.objectData ?? (objectArchiveId === -1
        ? EMPTY_MAP_OBJECTS : mapFileLoader.getLocData(mapX, mapY, xteas));
    if (!terrainData || !objectData) return;
    // Keep the imported/cache base separate from temporary editor preview packs.
    if (!replacements.has(regionId)) replacements.set(regionId, {
        terrainData: new Uint8Array(terrainData), objectData: new Uint8Array(objectData),
    });
    return { terrainData, objectData, terrainArchiveId, objectArchiveId };
}

function buildEditorRegionPack(
    client: OsrsClient,
    tile: EditModeTile,
    edits: readonly EditModeEdit[],
    replacements: Map<number, EditorRegionReplacement>,
    includeObjectEdits = true,
): { regionId: number; data: Uint8Array } {
    const mapX = tile.tileX >> 6;
    const mapY = tile.tileY >> 6;
    const regionId = (mapX << 8) | mapY;
    const region = readEditorRegion(client, regionId, replacements);
    if (!region) throw new Error(`Region ${regionId} is not loaded`);
    const { terrainData, objectData, terrainArchiveId, objectArchiveId } = region;
    return {
        regionId,
        data: buildRegionPack(
            regionId,
            objectArchiveId,
            terrainArchiveId,
            objectData,
            terrainData,
            edits,
            hasWideTerrain(client),
            includeObjectEdits,
            terrainArchiveId === -1 && objectArchiveId === -1,
        ),
    };
}

/**
 * Puts the camera on the tile at ground level, then pulls it back along its own
 * view ray so the tile sits mid-screen - the same shape as the follow camera's
 * orbit, which is what makes the view read as a normal RS one.
 */
function frameCameraOnTile(
    client: OsrsClient,
    tile: EditModeTile,
    resetAngles: boolean,
    distance = EDITOR_CAMERA_DISTANCE,
): void {
    const camera = client.camera;
    if (resetAngles) {
        camera.snapToYaw(EDITOR_CAMERA_YAW);
        camera.snapToPitch(EDITOR_CAMERA_PITCH);
    }

    const centreX = tile.tileX + 0.5;
    const centreZ = tile.tileY + 0.5;
    const renderer = client.renderer as unknown as
        | { sampleHeightAtExactPlane?: (x: number, z: number, plane: number) => number }
        | undefined;
    const height = renderer?.sampleHeightAtExactPlane?.(centreX, centreZ, tile.plane);

    camera.snapToPosition(
        centreX,
        typeof height === "number" && Number.isFinite(height) ? height : undefined,
        centreZ,
    );
    camera.move(0, 0, distance, true);
}

let nextEditorNpcServerId = EDITOR_NPC_SERVER_ID_BASE;
/** An id for a spawn kept hidden at region load, spawned under it if its marker is undone. */
const reserveEditorNpcServerId = (): number => nextEditorNpcServerId++;

/** The cache's spawnDirection (counted from north-west) in a spawn's direction numbering. */
const CACHE_TO_SPAWN_DIRECTION: ReadonlyArray<number> = [5, 6, 7, 3, 4, 0, 1, 2];

/** Browser-host spawn records are static editor scenery, never part of gameplay movement. */
function spawnStaticEditorNpc(
    client: OsrsClient,
    spawn: BrowserHostNpcSpawn,
    forcedServerId?: number,
): number | undefined {
    let cacheDirection: number | undefined;
    try {
        cacheDirection = client.npcTypeLoader?.load(spawn.id)?.spawnDirection;
    } catch {
        return undefined;
    }
    // The cache's spawnDirection counts from north-west (its default, 6, is south); a spawn's
    // direction counts from south-west, as Direction does.
    const direction = Number.isInteger(spawn.direction)
        ? spawn.direction!
        : Number.isInteger(cacheDirection)
          ? CACHE_TO_SPAWN_DIRECTION[cacheDirection! & 7]
          : MovementDirection.South;
    return spawnEditorNpcWithOrientation(
        client,
        spawn.id,
        { tileX: spawn.tileX, tileY: spawn.tileY, plane: spawn.plane },
        DIRECTION_TO_ORIENTATION[direction & 7] ?? 0,
        forcedServerId,
    );
}

/**
 * Spawns a cache NPC through the same path the server's NPC add stream uses,
 * so ECS state, movement sync and geometry streaming all stay consistent.
 * ponytail: synthetic ids start at 60000, collide only if the server ever
 * hands out ids that high.
 */
function spawnEditorNpc(
    client: OsrsClient,
    npcTypeId: number,
    tile: EditModeTile,
    rotation: number,
    forcedServerId?: number,
): number | undefined {
    return spawnEditorNpcWithOrientation(
        client,
        npcTypeId,
        tile,
        (rotation & 0x3) * 512,
        forcedServerId,
    );
}

function spawnEditorNpcWithOrientation(
    client: OsrsClient,
    npcTypeId: number,
    tile: EditModeTile,
    orientation: number,
    forcedServerId?: number,
): number | undefined {
    if (!(client as unknown as { npcMovementSync?: unknown }).npcMovementSync) return undefined;
    const spawnNpcBinary = (
        client as unknown as {
            spawnNpcBinary(
                spawn: {
                    npcId: number;
                    typeId: number;
                    tileX: number;
                    tileY: number;
                    level: number;
                    rot: number;
                    teleport: boolean;
                    worldViewId: number;
                },
                loopCycle: number,
            ): void;
        }
    ).spawnNpcBinary;
    if (typeof spawnNpcBinary !== "function") return undefined;

    const serverId = forcedServerId ?? nextEditorNpcServerId++;
    spawnNpcBinary.call(
        client,
        {
            npcId: serverId,
            typeId: npcTypeId | 0,
            tileX: tile.tileX | 0,
            tileY: tile.tileY | 0,
            level: tile.plane | 0,
            rot: orientation & 2047,
            teleport: true,
            worldViewId: -1,
        },
        0,
    );
    return serverId;
}

function despawnEditorNpc(client: OsrsClient, serverId: number): void {
    (client as unknown as { despawnNpcBinary(serverId: number): void }).despawnNpcBinary(serverId);
}
