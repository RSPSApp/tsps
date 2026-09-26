import { OBJECT_SPAWNS_MESSAGE, OBJECT_SPAWNS_REQUEST_MESSAGE, parseObjectSpawns, type ObjectSpawn, type ObjectSpawnsMessage } from "./hostProtocol/objectSpawnsMessage";
import { isKnownWaterTextureId } from "../../../render/water/WaterTextureIds";
import { getContentApiBase } from "../../../network/serverConnection/contentApi";
import { ClientState } from "../../ClientState";
import { GameState } from "../../login/GameState";
import { setAudioSuspended } from "../../audio/audioContext";
import type { App as PicoApp, UniformBuffer } from "picogl";
import type { Ray } from "../../math/Raycast";
import type { SceneRaycastHit, SceneRaycaster } from "../../scene/SceneRaycaster";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { IndexType } from "../../../rs/cache/IndexType";
import { packWorldMapCoord } from "../../../rs/map/WorldMapArea";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { DIRECTION_TO_ORIENTATION } from "../../../common/Direction";
import { InteractType } from "../../../render/InteractType";
import type { MinimapIcon } from "../../../render/loader/SdMapData";
import { isDoorLocType } from "../../../render/loc/SceneLocs";
import type {
    InteractHighlightTarget,
    LocHighlightTarget,
} from "../../../render/render/constants";
import type { InteractHighlightDrawTarget } from "../../../ui/devoverlay/InteractHighlightOverlay";
import type { Overlay } from "../../../ui/devoverlay/Overlay";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import {
    copyRegionPackBytes,
    REGION_PACK_MESSAGE,
    REGION_PACK_REQUEST_MESSAGE,
    type RegionPackMessage,
} from "./hostProtocol/regionPackMessage";
import { browserHostOrigin, browserHostWindow } from "./hostProtocol/origin";
import { isBrowserHostClient } from "../../../config/clientEnv";
import {
    NPC_SPAWN_MESSAGE,
    NPC_SPAWN_REQUEST_MESSAGE,
    regionIdForTile,
    type BrowserHostNpcSpawn,
    type NpcSpawnMessage,
} from "./hostProtocol/npcSpawnMessage";
import {
    NPC_INTERACTIONS_MESSAGE,
    NPC_INTERACTIONS_REQUEST_MESSAGE,
    type NpcInteractionsMessage,
} from "./hostProtocol/npcInteractionsMessage";
import { getNpcMenuOptions } from "../../menu/WorldMenuBuilder";
import {
    WORLD_DEFINITION_MESSAGE,
    WORLD_DEFINITION_REQUEST_MESSAGE,
    type WorldDefinitionMessage,
} from "./hostProtocol/worldDefinitionMessage";
import {
    SHOP_DEFINITIONS_MESSAGE,
    SHOP_DEFINITIONS_REQUEST_MESSAGE,
    type ShopDefinitionsMessage,
} from "./hostProtocol/shopsMessage";
import type { OsrsClient } from "../../OsrsClient";
import { createBrowserEditModePluginPersistence } from "./BrowserEditModePluginPersistence";
import { detectRectangularBuilding, type DetectedBuilding } from "./BuildingDetector";
import { EditModePlugin } from "./EditModePlugin";
import { mountEditorUi } from "./EditorUi";
import { EditorWorldMap } from "./EditorWorldMap";
import {
    MapIconGroundOverlay,
    type MapIconGroundEntry,
} from "./MapIconGroundOverlay";
import {
    LocPlacementPreviewOverlay,
    getLocPlacementShape,
    type LocPlacementPreviewClient,
    type LocPlacementPreviewRenderer,
} from "./LocPlacementPreviewOverlay";
import { ModelImageCaptureOverlay } from "./ModelImageCaptureOverlay";
import { buildAreaClipboard, buildRegionPack, parseRegionPack, buildObjectSpawnExport, objectSpawnEdits } from "./RegionPack";
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
    EditModeNpcInteractions,
    EditModeShop,
    EditModeTile,
    EditModeWorldDefinition,
    EditModeWorldZone,
} from "./types";

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

type EditorRegionReplacement = {
    terrainData: Uint8Array;
    objectData?: Uint8Array;
};

/** Reuses the scene's exact model picker, but includes scenery hidden from the game menu. */
export function raycastEditScene(
    raycaster: SceneRaycaster,
    ray: Ray,
    basePlane?: number,
): SceneRaycastHit | undefined {
    const editorRaycaster = raycaster as unknown as {
        raycast: SceneRaycaster["raycast"];
        isLocTypeInteractive?: (locType: unknown) => boolean;
    };
    const originalFilter = editorRaycaster.isLocTypeInteractive;
    try {
        if (originalFilter) editorRaycaster.isLocTypeInteractive = () => true;
        return editorRaycaster
            .raycast(ray, { maxDistance: 4096, maxHits: 1000, basePlane })
            .find(
                (hit) =>
                    hit.interactType === InteractType.LOC ||
                    (hit.interactType === InteractType.NPC && hit.playerEcsIndex === undefined),
            );
    } finally {
        if (originalFilter) editorRaycaster.isLocTypeInteractive = originalFilter;
    }
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
    const cached = indexes.get(kind);
    if (cached) return Promise.resolve(cached);

    let pending = indexPromises.get(kind);
    if (!pending) {
        pending = buildNameIndex(loader).then((index) => {
            indexes.set(kind, index);
            indexPromises.delete(kind);
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
    if (raw.disabledPlugins !== undefined && (
        !Array.isArray(raw.disabledPlugins) || raw.disabledPlugins.some(
            (name) => typeof name !== "string" || name.trim().length === 0,
        )
    )) throw new Error("World API returned invalid disabledPlugins");
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
        spawn: {
            x: worldCoordinate(spawn.x, "World API spawn.x"),
            y: worldCoordinate(spawn.y, "World API spawn.y"),
            z: worldPlane(spawn.z, "World API spawn.z"),
        },
        zones,
        disabledPlugins: (raw.disabledPlugins ?? []).map((name) => (name as string).trim()),
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
        disabledPlugins: [],
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

export function parseBrowserHostShops(contents: string): EditModeShop[] {
    const parsed: unknown = JSON.parse(contents);
    if (!Array.isArray(parsed)) throw new Error("Browser host provided invalid shops.json");
    return parsed.map((value, index) => {
        if (!value || Array.isArray(value) || typeof value !== "object") {
            throw new Error(`Shop ${index + 1} is invalid`);
        }
        const row = value as Record<string, unknown>;
        const id = Number(row.id);
        if (!Number.isInteger(id) || id < 0 || typeof row.name !== "string" || !Array.isArray(row.originalStock)) {
            throw new Error(`Shop ${index + 1} is invalid`);
        }
        const originalStock = row.originalStock.map((entry, stockIndex) => {
            if (!entry || Array.isArray(entry) || typeof entry !== "object") {
                throw new Error(`Shop ${id} stock ${stockIndex + 1} is invalid`);
            }
            const stock = entry as Record<string, unknown>;
            const itemId = Number(stock.id);
            const amount = Number(stock.amount);
            if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(amount) || amount <= 0 || amount > 0x7fffffff) {
                throw new Error(`Shop ${id} stock ${stockIndex + 1} is invalid`);
            }
            return { ...stock, id: itemId, amount };
        });
        return { ...row, id, name: row.name, originalStock };
    });
}

export function parseBrowserHostNpcInteractions(contents: string): EditModeNpcInteractions {
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Browser host provided invalid npc-interactions.json");
    }
    for (const [npcId, interactions] of Object.entries(parsed)) {
        if (!Number.isInteger(Number(npcId)) || Number(npcId) < 0 || !interactions || Array.isArray(interactions) || typeof interactions !== "object") {
            throw new Error("Browser host provided invalid npc-interactions.json");
        }
    }
    return parsed as EditModeNpcInteractions;
}

function requestBrowserHostShops(): Promise<EditModeShop[]> {
    const host = browserHostWindow();
    if (!host) return Promise.reject(new Error("Browser host is unavailable"));
    const hostOrigin = browserHostOrigin();
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error("Browser host did not provide shops"));
        }, 10_000);
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== hostOrigin || event.source !== host) return;
            const message = event.data as ShopDefinitionsMessage | undefined;
            if (message?.type !== SHOP_DEFINITIONS_MESSAGE || typeof message.contents !== "string") return;
            window.clearTimeout(timeout);
            window.removeEventListener("message", onMessage);
            try {
                resolve(parseBrowserHostShops(message.contents));
            } catch (error) {
                reject(error);
            }
        };
        window.addEventListener("message", onMessage);
        host.postMessage({ type: SHOP_DEFINITIONS_REQUEST_MESSAGE }, hostOrigin);
    });
}

function requestBrowserHostNpcInteractions(): Promise<EditModeNpcInteractions> {
    const host = browserHostWindow();
    if (!host) return Promise.reject(new Error("Browser host is unavailable"));
    const hostOrigin = browserHostOrigin();
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error("Browser host did not provide NPC interactions"));
        }, 10_000);
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== hostOrigin || event.source !== host) return;
            const message = event.data as NpcInteractionsMessage | undefined;
            if (message?.type !== NPC_INTERACTIONS_MESSAGE || typeof message.contents !== "string") return;
            window.clearTimeout(timeout);
            window.removeEventListener("message", onMessage);
            try {
                resolve(parseBrowserHostNpcInteractions(message.contents));
            } catch (error) {
                reject(error);
            }
        };
        window.addEventListener("message", onMessage);
        host.postMessage({ type: NPC_INTERACTIONS_REQUEST_MESSAGE }, hostOrigin);
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

/** Wires the editor to the running client. Dev builds only - see OsrsClient. */
export function installEditMode(client: OsrsClient): EditModePlugin {
    const plugin = new EditModePlugin(
        createBrowserEditModePluginPersistence("osrs.plugin.edit_mode.v1"),
    );
    const editorWorldMap = new EditorWorldMap(
        client,
        (tile) => frameCameraOnTile(client, tile, false),
        () => {
            const state = plugin.getState();
            return state.world.definition
                ? { zones: state.world.definition.zones, showPvp: state.config.showPvpZones, showMulti: state.config.showMultiCombatZones, showDuel: state.config.showDuelZones, showSafe: state.config.showSafeZones }
                : undefined;
        },
        (index, bounds) => plugin.resizeWorldZone(index, bounds),
        (bounds, tag) => plugin.addWorldZone(bounds, tag),
        (index, tag) => plugin.setWorldZoneType(index, tag),
        (index) => plugin.deleteWorldZone(index),
    );
    let previewNpc = false;
    let previewNpcType = -1;
    let previewNpcRotation = -1;
    let buildingPreviewTileKey: string | undefined;
    let pointerModelHighlight: InteractHighlightDrawTarget | undefined;
    let buildingModelHighlight: InteractHighlightDrawTarget | undefined;
    let buildingSelectionHighlight: InteractHighlightDrawTarget | undefined;
    let buildingHighlightRenderer: TerrainHost | undefined;
    let heightLevelRenderer: TerrainHost | undefined;
    let editorPickCache:
        | {
              renderer: TerrainHost;
              frame: number;
              x: number;
              y: number;
              pick: { tile: EditModeTile; target?: InteractHighlightTarget } | undefined;
          }
        | undefined;
    let mapIconFrame: number | undefined;
    let mapIconTargets = new Map<string, LocHighlightTarget>();
    let mapIconGroundOverlay: MapIconGroundOverlay | undefined;
    let mapIconGroundManager: TerrainHost["overlayManager"];
    let locPlacementPreviewOverlay: LocPlacementPreviewOverlay | undefined;
    let locPlacementPreviewManager: TerrainHost["overlayManager"];
    let modelImageCaptureOverlay: ModelImageCaptureOverlay | undefined;
    let modelImageCaptureManager: TerrainHost["overlayManager"];
    let selectedModelTarget: InteractHighlightTarget | undefined;
    let wallGroundOverlay: ZoneGroundOverlay | undefined;
    let wallGroundManager: TerrainHost["overlayManager"];
    let zoneFrame: number | undefined;
    let zoneGroundOverlay: ZoneGroundOverlay | undefined;
    let zoneGroundManager: TerrainHost["overlayManager"];
    const editorRegionReplacements = new Map<number, EditorRegionReplacement>();
    let objectSpawns: ObjectSpawn[] | undefined = browserHostWindow() ? undefined : [];
    let objectSpawnPreviewPending = false;
    const sceneEdits = (edits: readonly EditModeEdit[]) => [...objectSpawnEdits(objectSpawns ?? []), ...edits];
    const mapIconSprites = new Map<number, HTMLCanvasElement>();
    const mapIconLocs = new WeakMap<MinimapIcon, { locId: number; rotation?: number } | null>();
    let previousInteractHighlightConfig:
        | ReturnType<typeof client.interactHighlightPlugin.getConfig>
        | undefined;
    let terrainPreviewSignature = "";

    const clearPlacementPreview = (): void => {
        locPlacementPreviewOverlay?.clear();
        wallGroundOverlay?.setRects([]);
        if (previewNpc) {
            despawnEditorNpc(client, EDITOR_NPC_PREVIEW_SERVER_ID);
            previewNpc = false;
        }
        previewNpcType = -1;
        previewNpcRotation = -1;
    };
    const clearTerrainPreview = (): void => {
        if (!terrainPreviewSignature) return;
        terrainPreviewSignature = "";
        client.tileHighlightManager.clear(EDITOR_PATH_TILE_SLOT);
    };
    const setTerrainPreview = (edits: readonly EditModeEdit[]): void => {
        const signature = edits
            .map((edit) => `${edit.tileX},${edit.tileY},${edit.plane},${edit.locId},${edit.shape},${edit.rotation}`)
            .join(";");
        if (terrainPreviewSignature === signature) return;
        clearTerrainPreview();
        if (edits.length === 0) return;
        terrainPreviewSignature = signature;
        client.tileHighlightManager.configure(
            EDITOR_PATH_TILE_SLOT,
            PATH_PREVIEW_COLOR,
            2,
            20,
            TILE_HIGHLIGHT_ALWAYS_ON_TOP,
        );
        for (const edit of edits) {
            client.tileHighlightManager.set(
                packWorldMapCoord({ x: edit.tileX, y: edit.tileY, plane: edit.plane }),
                EDITOR_PATH_TILE_SLOT,
                EDITOR_PATH_TILE_GROUP,
            );
        }
    };
    const clearPointerPreview = (): void => {
        buildingPreviewTileKey = undefined;
        pointerModelHighlight = undefined;
        buildingModelHighlight = undefined;
        client.tileHighlightManager.clear(EDITOR_HOVER_TILE_SLOT);
        terrainHost(client)?.clearInteractHighlightHoverTarget();
    };
    const configureInteractHighlight = (): void => {
        if (!previousInteractHighlightConfig) {
            previousInteractHighlightConfig = {
                ...client.interactHighlightPlugin.getConfig(),
            };
        }
        Object.assign(client.interactHighlightPlugin.getConfig(), {
            enabled: true,
            showHover: true,
            showInteract: true,
            hoverColor: 0xffffff,
            interactColor: 0xffffff,
        });
    };
    const clearSelectionHighlight = (): void => {
        clearPointerPreview();
        selectedModelTarget = undefined;
        buildingSelectionHighlight = undefined;
        client.tileHighlightManager.clear(EDITOR_SELECTION_TILE_SLOT);
        const renderer = terrainHost(client);
        renderer?.clearInteractHighlightActiveTarget();
        if (previousInteractHighlightConfig) {
            Object.assign(
                client.interactHighlightPlugin.getConfig(),
                previousInteractHighlightConfig,
            );
            previousInteractHighlightConfig = undefined;
        }
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
    ): MapIconGroundOverlay | undefined => {
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
    ): LocPlacementPreviewOverlay | undefined => {
        if (!renderer.overlayManager || !renderer.app || !renderer.sceneUniformBuffer) return undefined;
        if (locPlacementPreviewManager === renderer.overlayManager) return locPlacementPreviewOverlay;
        const overlay = new LocPlacementPreviewOverlay();
        overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
        renderer.overlayManager.add(overlay);
        locPlacementPreviewManager = renderer.overlayManager;
        locPlacementPreviewOverlay = overlay;
        return overlay;
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
            const maxPlane = state.config.renderAllHeightLevels ? 3 : state.config.heightLevel;
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
    ): ZoneGroundOverlay | undefined => {
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
    ): ZoneGroundOverlay | undefined => {
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
            if (!state.config.renderAllHeightLevels && zone.z !== state.config.heightLevel) continue;
            const showPvp = state.config.showPvpZones && zone.tags.includes("pvp");
            const showMulti =
                state.config.showMultiCombatZones && zone.tags.includes("multi-combat");
            const showDuel = state.config.showDuelZones && zone.tags.includes("duel");
            const showSafe = state.config.showSafeZones && zone.tags.includes("safe");
            if (!showPvp && !showMulti && !showSafe && !showDuel) continue;
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
        const visible = state.config.showDuelZones || state.config.showPvpZones || state.config.showMultiCombatZones || state.config.showSafeZones;
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
    const resolveEditScenePick = (renderer: TerrainHost) => {
        const x = client.inputManager.mouseX;
        const y = client.inputManager.mouseY;
        if (
            editorPickCache?.renderer === renderer &&
            editorPickCache.frame === renderer.currentFrameCount &&
            editorPickCache.x === x &&
            editorPickCache.y === y
        ) {
            return editorPickCache.pick;
        }
        const ray = renderer.screenToRay(x, y);
        const hit =
            ray && renderer.sceneRaycaster
                ? raycastEditScene(
                      renderer.sceneRaycaster as SceneRaycaster,
                      ray,
                      renderer.getPlayerRawPlane(),
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
                const loc = renderer
                    .getLocIdsAtTileAllLevels(hit.tileX, hit.tileY)
                    .filter(({ id }) => id === hit.interactId)
                    .sort(
                        (a, b) =>
                            Math.abs(a.level - playerPlane) - Math.abs(b.level - playerPlane),
                    )[0];
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
            const tile = renderer.computeTileAt(x, y);
            const plane = plugin.getConfig().heightLevel;
            const iconTarget = tile && mapIconTargets.get(`${tile.tileX}:${tile.tileY}:${plane}`);
            if (iconTarget) {
                pick = {
                    tile: { tileX: iconTarget.tileX, tileY: iconTarget.tileY, plane },
                    target: iconTarget,
                };
            }
        }
        editorPickCache = { renderer, frame: renderer.currentFrameCount, x, y, pick };
        return pick;
    };
    const resolvePointerTarget = () => {
        const renderer = terrainHost(client);
        if (!renderer) return { renderer, target: undefined };
        return {
            renderer,
            target: resolveEditScenePick(renderer)?.target,
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
        const getBaseRoofPlaneLimit = renderer.getRoofPlaneLimit.bind(renderer);
        const shouldRenderNpc = renderer.shouldRenderNpcFromMap.bind(renderer);
        const shouldRenderPlayer = renderer.shouldRenderPlayerIndex.bind(renderer);
        const drawBase = renderer.drawWithRoofPlaneFilter.bind(renderer);
        const visiblePlaneRanges: PlaneDrawRange[] = [];
        const isEditing = () => {
            const state = plugin.getState();
            return state.config.enabled && (state.config.active || state.scenePreview);
        };
        renderer.getPlayerRawPlane = () =>
            isEditing() ? plugin.getConfig().heightLevel : getBasePlane();
        renderer.getRoofPlaneLimit = () =>
            isEditing()
                ? plugin.getConfig().renderAllHeightLevels
                    ? 3
                    : plugin.getConfig().heightLevel
                : getBaseRoofPlaneLimit();
        renderer.shouldRenderNpcFromMap = (map, ecsId) =>
            shouldRenderNpc(map, ecsId) &&
            (!isEditing() ||
                (client.npcEcs.getLevel(ecsId) | 0) === plugin.getConfig().heightLevel);
        renderer.shouldRenderPlayerIndex = (ecsId) =>
            shouldRenderPlayer(ecsId) &&
            (plugin.getConfig().renderAllHeightLevels ||
                !isEditing() ||
                (client.playerEcs.getLevel(ecsId) | 0) <= plugin.getConfig().heightLevel);
        renderer.drawWithRoofPlaneFilter = (drawCall, drawRanges, drawRangePlanes, limit) => {
            const config = plugin.getConfig();
            if (!isEditing() || config.renderAllHeightLevels || !drawRangePlanes) {
                drawBase(drawCall, drawRanges, drawRangePlanes, limit);
                return;
            }
            visiblePlaneRanges.length = 0;
            for (let i = 0; i < drawRanges.length; i++) {
                if ((drawRangePlanes[i] | 0) <= config.heightLevel) {
                    visiblePlaneRanges.push(drawRanges[i]);
                }
            }
            drawBase(drawCall, visiblePlaneRanges, undefined, 3);
        };
    };
    const analyseBuilding = (tile: EditModeTile) => {
        const renderer = terrainHost(client);
        if (!renderer) return undefined;
        const building = detectRectangularBuilding(
            tile.tileX,
            tile.tileY,
            (x, y) => renderer.getLocIdsAtTileAllLevels(x, y),
            (id) => {
                const type = client.locTypeLoader.load(id);
                return !!type && isDoorLocType(type);
            },
        );
        if (!building) return undefined;

        ensureBuildingHighlightRenderer(renderer);
        const trianglePoints: Array<readonly [number, number, number]> = [];
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
                    if (perimeterTiles.has(`${x}:${y}`) && (modelType === 10 || modelType === 22)) {
                        continue;
                    }
                    if (
                        wallLike &&
                        loc.id !== building.wallId &&
                        !door &&
                        perimeterTiles.has(`${x}:${y}`) &&
                        continuesOutside(loc.id, loc.level, x, y)
                    ) {
                        continue;
                    }
                    if (
                        !roofTiles.has(`${x}:${y}`) &&
                        !wallLike &&
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
                    if (points) trianglePoints.push(...points);
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

    const refreshEditedRegions = async (regionIds: readonly number[]) => {
        for (const regionId of regionIds) {
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
                    pack = buildEditorRegionPack(client, tile, sceneEdits(plugin.getConfig().edits), editorRegionReplacements);
                }
                const replacement = parseRegionPack(pack.data);
                client.onRegionReplacement({ ...replacement, allowReload: true });
            } catch (error) {
                console.warn(`[edit-mode] failed to rebuild region ${regionId}`, error);
            }
        }
    };

    plugin.attach({
        getCanvas: () => client.renderer?.canvas as HTMLCanvasElement | undefined,
        getCameraTile: () => ({
            tileX: Math.round(client.camera.getPosX()),
            tileY: Math.round(client.camera.getPosZ()),
            plane: plugin.getConfig().heightLevel,
        }),
        getPointerTile: () => {
            const renderer = terrainHost(client);
            if (renderer) ensureHeightLevelRenderer(renderer);
            // Fresh terrain fallback: hoveredTile can lag a frame after camera movement.
            const tile =
                renderer?.computeTileAt?.(client.inputManager.mouseX, client.inputManager.mouseY) ??
                client.hoveredTile;
            if (tile) {
                return {
                    tileX: tile.tileX | 0,
                    tileY: tile.tileY | 0,
                    plane: plugin.getConfig().heightLevel,
                };
            }
            // Terrain picking has gaps where a loc is the only clickable surface.
            return renderer ? resolveEditScenePick(renderer)?.tile : undefined;
        },
        previewPointer: (tile) => {
            clearPointerPreview();
            configureInteractHighlight();
            const { renderer, target } = resolvePointerTarget();
            if (renderer && target) {
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
            const tileKey = `${tile.tileX}:${tile.tileY}:${tile.plane}`;
            if (buildingPreviewTileKey === tileKey) return;
            clearPointerPreview();
            const analysis = analyseBuilding(tile);
            if (!analysis) return;
            buildingPreviewTileKey = tileKey;
            configureInteractHighlight();
            buildingModelHighlight = analysis.highlight;
            if (!analysis.highlight) setBuildingTileFallback(analysis.building, EDITOR_HOVER_TILE_SLOT);
        },
        selectBuilding: (tile) => {
            clearSelectionHighlight();
            const analysis = analyseBuilding(tile);
            if (!analysis) return undefined;
            configureInteractHighlight();
            const building = analysis.building;
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
        selectPointer: (tile) => {
            clearSelectionHighlight();
            const { renderer, target } = resolvePointerTarget();
            if (renderer && target) {
                selectedModelTarget = target;
                configureInteractHighlight();
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
                return {
                    kind: "npc" as const,
                    tileX: npcTile.x,
                    tileY: npcTile.y,
                    plane: target.plane,
                    locId: target.npcTypeId,
                    locName:
                        client.npcTypeLoader.load(target.npcTypeId)?.name ?? "",
                };
            }

            return selectTileRange(tile, tile);
        },
        captureSelectionImage: () => {
            const renderer = terrainHost(client);
            const target = selectedModelTarget;
            if (!renderer || !target) return Promise.resolve(undefined);
            const triangles = renderer.buildHighlightTrianglePoints(target);
            return ensureModelImageCaptureOverlay(renderer)?.capture(triangles ?? []) ?? Promise.resolve(undefined);
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
        setWallPreview: (walls, height) => {
            if (walls.length === 0) {
                clearPlacementPreview();
                return;
            }
            if (previewNpc) despawnEditorNpc(client, EDITOR_NPC_PREVIEW_SERVER_ID);
            previewNpc = false;
            previewNpcType = -1;
            previewNpcRotation = -1;
            const renderer = terrainHost(client);
            if (!renderer) return;
            const minX = Math.min(...walls.map((wall) => wall.tileX));
            const maxX = Math.max(...walls.map((wall) => wall.tileX));
            const minY = Math.min(...walls.map((wall) => wall.tileY));
            const maxY = Math.max(...walls.map((wall) => wall.tileY));
            ensureWallGroundOverlay(renderer)?.setRects(
                height === undefined
                    ? []
                    : [{
                        minX,
                        maxX,
                        minY,
                        maxY,
                        plane: walls[0].plane,
                        colorRgb: WALL_PREVIEW_GROUND_COLOR,
                        alpha: 0.65,
                        height,
                    }],
            );
            ensureBuildingHighlightRenderer(renderer);
            ensureLocPlacementPreviewOverlay(renderer)?.setPreviews(
                client as unknown as LocPlacementPreviewClient,
                client.renderer as unknown as LocPlacementPreviewRenderer,
                walls.map((wall) => ({
                    locId: wall.locId,
                    x: wall.tileX,
                    y: wall.tileY,
                    plane: wall.plane,
                    shape: wall.shape,
                    rotation: wall.rotation,
                    height,
                })),
            );
        },
        clearPlacementPreview,
        setAudioMuted: (muted) => {
            setAudioSuspended(muted);
            // Music also has an HTMLAudio fallback outside the Web Audio graph.
            client.musicSystem?.setMuted(muted);
        },
        onLocAddChange: (locId, tile, level, shape, rotation) => {
            const renderer = terrainHost(client);
            renderer?.pendingLocUpdates.add(renderer.getMapIdForWorldTile(tile.x, tile.y));
            client.onLocAddChange(locId, tile, level, shape, rotation);
        },
        onLocDel: (tile, level, shape, rotation) => {
            const renderer = terrainHost(client);
            renderer?.pendingLocUpdates.add(renderer.getMapIdForWorldTile(tile.x, tile.y));
            client.onLocDel(tile, level, shape, rotation);
        },
        getLocPlacementShape: (locId) => {
            const base = client.locTypeLoader.load(locId);
            const type = base.transforms ? base.transform(client.varManager, client.locTypeLoader) ?? base : base;
            return getLocPlacementShape(type);
        },
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
            return filterIndex(await getNameIndex(kind, loader), query);
        },
        describeDefinition: (kind, id) => describeDefinition(client, kind, id),
        loadShops: () => browserHostWindow() ? requestBrowserHostShops() : loadLocalEditorData("shops").then(parseBrowserHostShops),
        loadNpcInteractions: () => browserHostWindow() ? requestBrowserHostNpcInteractions() : loadLocalEditorData("npc-interactions").then(parseBrowserHostNpcInteractions),
        getNpcMenuOptions: (npcTypeId) => {
            const npc = client.npcTypeLoader?.load(npcTypeId);
            return npc ? getNpcMenuOptions(npc) : [];
        },
        isWaterOverlay: (id) => {
            const overlay = id > 0 ? client.loaderFactory?.getOverlayTypeLoader?.().load(id - 1) : undefined;
            return !!overlay && overlay.textureId !== 91 && isKnownWaterTextureId(overlay.textureId);
        },
        getOverlaySwatches: () => {
            const loader = client.loaderFactory?.getOverlayTypeLoader?.();
            if (!loader) return [];
            const swatches = [];
            for (let id = 1; id < loader.getCount(); id++) {
                try {
                    const overlay = loader.load(id);
                    swatches.push({
                        id,
                        colorRgb: overlay.primaryRgb & 0xffffff,
                        name: overlay.name,
                    });
                } catch {
                    // Sparse caches can still be fetching an overlay definition.
                }
            }
            return swatches;
        },
        loadWorldDefinition,
        spawnNpc: (npcTypeId, tile, rotation) => spawnEditorNpc(client, npcTypeId, tile, rotation),
        setFreeCamera: (enabled) => {
            // The client already flies the camera with WASD/QE whenever it is
            // not following the player (GameRenderer.handleKeyInput).
            // ponytail: map streaming still centres on the player, so flying
            // past the loaded radius shows empty space.
            client.followPlayerCamera = !enabled;
        },
        setScenePreview: (enabled, spawn) => {
            client.scenePreviewEnabled = enabled;
            client.scenePreviewLoadingStartedAt = enabled ? performance.now() : undefined;
            if (!enabled) return;
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
        jumpCameraToTile: (tile) => {
            frameCameraOnTile(client, tile, false);
        },
        copyArea: (bounds, edits) => buildAreaClipboard(
            bounds,
            (tileX, tileY) => buildEditorRegionPack(client, { tileX, tileY, plane: 0 }, sceneEdits(edits), editorRegionReplacements).data,
            client.loadedCache?.info.game === "oldschool" && (client.loadedCache?.info.revision ?? 0) >= 209,
        ),
        markMapEditsSaved: (packs, spawns) => {
            for (const pack of packs) {
                const parsed = parseRegionPack(pack.data);
                editorRegionReplacements.set(pack.regionId, parsed);
            }
            if (spawns !== undefined) objectSpawns = spawns;
        },
        exportObjectSpawns: (edits) => {
            if (!objectSpawns) throw new Error("Object spawns are still loading from the host; try Save again shortly");
            return buildObjectSpawnExport(objectSpawns, edits, plugin.getConfig().saveObjectSpawns, (regionId) =>
                parseRegionPack(buildEditorRegionPack(client, {
                    tileX: (regionId >> 8) << 6, tileY: (regionId & 0xff) << 6, plane: 0,
                }, [], editorRegionReplacements).data).objectData,
            );
        },
        exportRegionPack: (tile, edits) => {
            if (!objectSpawns) throw new Error("Object spawns are still loading from the host; try Save again shortly");
            const saveToJson = plugin.getConfig().saveObjectSpawns;
            return buildEditorRegionPack(client, tile, saveToJson ? edits : sceneEdits(edits), editorRegionReplacements, !saveToJson);
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
            frameCameraOnTile(
                client,
                {
                    tileX: Math.round(client.camera.getPosX()),
                    tileY: Math.round(client.camera.getPosZ()),
                    plane: plugin.getConfig().heightLevel,
                },
                true,
            );
        },
        toggleWorldMap: () => {
            editorWorldMap.toggle(plugin.getCameraTile());
        },
        isEditorModalOpen: () => editorWorldMap.isOpen(),
        setTerrainOverlay: (tile, overlay, shape, rotation) => {
            const renderer = terrainHost(client);
            if (!renderer) return;
            renderer.terrainOverrides.set(`${tile.tileX},${tile.tileY},${tile.plane}`, {
                overlay: overlay | 0,
                shape: shape | 0,
                rotation: rotation & 0x3,
            });
            reloadTile(renderer, tile);
            zoneGroundOverlay?.invalidate();
        },
        setTerrainPreview,
        clearTerrainPreview,
        clearTerrainOverride: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer) return;
            renderer.terrainOverrides.delete(`${tile.tileX},${tile.tileY},${tile.plane}`);
            reloadTile(renderer, tile);
            zoneGroundOverlay?.invalidate();
        },
        getTerrainHeight: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer?.getPreferredMapForWorldTile(tile.tileX, tile.tileY)) return undefined;
            return renderer.getTileHeightAtPlane(tile.tileX, tile.tileY, tile.plane);
        },
        refreshEditedRegions,
        despawnNpc: (serverId) => {
            // Dev-only: reuse the server despawn path rather than duplicating
            // the ECS/world-view teardown it performs.
            despawnEditorNpc(client, serverId);
        },
    });

    plugin.subscribe(() => {
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
    const params = new URLSearchParams(window.location.search);
    const host = browserHostWindow();
    if (isBrowserHostClient() && host) {
        const hostOrigin = browserHostOrigin();
        const loadedNpcSpawnRegions = new Map<
            number,
            Array<{ spawn: BrowserHostNpcSpawn; serverId: number }>
        >();
        const pendingNpcSpawnRegions = new Set<number>();
        const npcRuntimeReady = () => !!(client as unknown as { npcMovementSync?: unknown }).npcMovementSync;
        const syncNpcSpawnRegions = () => {
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
            for (const regionId of missing) pendingNpcSpawnRegions.add(regionId);
            host.postMessage(
                { type: NPC_SPAWN_REQUEST_MESSAGE, regionIds: missing },
                hostOrigin,
            );
        };
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
                    const entries = (byRegion.get(regionId) ?? []).flatMap((spawn) => {
                        const serverId = spawnStaticEditorNpc(client, spawn);
                        return serverId === undefined ? [] : [{ spawn, serverId }];
                    });
                    loadedNpcSpawnRegions.set(regionId, entries);
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
                if (client.npcEcs.getEcsIdForServer(entry.serverId) === undefined) {
                    spawnStaticEditorNpc(client, entry.spawn, entry.serverId);
                }
            }
        };
        host.postMessage({ type: REGION_PACK_REQUEST_MESSAGE }, hostOrigin);
        const requestObjectSpawns = () => {
            if (!objectSpawns && !host.closed) host.postMessage({ type: OBJECT_SPAWNS_REQUEST_MESSAGE }, hostOrigin);
        };
        requestObjectSpawns();
        window.setInterval(requestObjectSpawns, 2000);
        window.setInterval(syncNpcSpawnRegions, 500);
        syncNpcSpawnRegions();
    }
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
        if (active && !teardownEditorUi) teardownEditorUi = mountEditorUi(plugin);
        else if (!active && teardownEditorUi) {
            teardownEditorUi();
            teardownEditorUi = undefined;
        }
    };
    plugin.subscribe(syncEditorUi);
    syncEditorUi();

    // ?edit=1 opens the client straight in the editor instead of changing the
    // normal welcome-screen button.
    if (new URLSearchParams(window.location.search).has("edit")) {
        // ponytail: polled, because the cache load and the world definition
        // fetch settle independently and neither has a ready event to hook.
        const timer = window.setInterval(() => {
            // Entering LOGIN_SCREEN resets the world; don't queue regions before that reset.
            if (client.gameState !== GameState.LOGIN_SCREEN) return;
            if (!client.loadedCache || plugin.getState().world.loading) return;
            window.clearInterval(timer);
            plugin.setScenePreview(true);
        }, 250);
    }
    return plugin;
}

/**
 * Terrain edits go straight into the renderer's override map and then force a
 * full map-square reload, the same route applyGamemodeWorldLocs takes.
 */
type TerrainHost = {
    currentFrameCount: number;
    app?: PicoApp;
    sceneUniformBuffer?: UniformBuffer;
    overlayManager?: { add(overlay: Overlay): unknown };
    mapManager: {
        visibleMapCount: number;
        visibleMaps: Array<{
            mapX: number;
            mapY: number;
            getRenderBaseWorldX?(): number;
            getRenderBaseWorldY?(): number;
        }>;
    };
    screenToRay(mouseX: number, mouseY: number): Ray | null;
    computeTileAt(
        mouseX: number,
        mouseY: number,
    ): { tileX: number; tileY: number; plane: number } | undefined;
    sceneRaycaster: Pick<SceneRaycaster, "raycast"> | null;
    getPlayerRawPlane(): number;
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
    shouldRenderNpcFromMap(map: unknown, ecsId: number): boolean;
    shouldRenderPlayerIndex(ecsId: number): boolean;
    drawWithRoofPlaneFilter(
        drawCall: unknown,
        drawRanges: PlaneDrawRange[],
        drawRangePlanes: Uint8Array | undefined,
        roofPlaneLimit: number,
    ): void;
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
    getPreferredMapForWorldTile(tileX: number, tileY: number): unknown;
    getTileHeightAtPlane(tileX: number, tileY: number, plane: number): number;
    pendingLocUpdates: Set<number>;
    getMapIdForWorldTile(x: number, y: number): number;
    scheduleLocReload(mapX: number, mapY: number): void;
};

type PlaneDrawRange = [number, number, number];

function terrainHost(client: OsrsClient): TerrainHost | undefined {
    const renderer = client.renderer as unknown as TerrainHost | undefined;
    return renderer && renderer.terrainOverrides ? renderer : undefined;
}

function reloadTile(renderer: TerrainHost, tile: EditModeTile): void {
    const mapId = renderer.getMapIdForWorldTile(tile.tileX, tile.tileY);
    renderer.pendingLocUpdates.add(mapId);
    renderer.scheduleLocReload(mapId >> 8, mapId & 0xff);
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
    const mapFileLoader = client.loaderFactory.getMapFileLoader();
    const replacement = replacements.get(regionId) ?? terrainHost(client)?.mapRegionReplacements.get(regionId);
    const xteas = client.loadedCache?.xteas;
    const terrainData = replacement?.terrainData ?? mapFileLoader.getTerrainData(mapX, mapY, xteas);
    const objectData =
        replacement?.objectData ?? (xteas ? mapFileLoader.getLocData(mapX, mapY, xteas) : undefined);
    if (!terrainData || !objectData) throw new Error(`Region ${regionId} is not loaded`);
    // Keep the imported/cache base separate from temporary editor preview packs.
    if (!replacements.has(regionId)) replacements.set(regionId, {
        terrainData: new Uint8Array(terrainData), objectData: new Uint8Array(objectData),
    });
    return {
        regionId,
        data: buildRegionPack(
            regionId,
            client.mapFileIndex.getLocArchiveId(mapX, mapY),
            client.mapFileIndex.getTerrainArchiveId(mapX, mapY),
            objectData,
            terrainData,
            edits,
            client.loadedCache?.info.game === "oldschool" &&
                (client.loadedCache?.info.revision ?? 0) >= 209,
            includeObjectEdits,
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
    const direction = Number.isInteger(spawn.direction)
        ? spawn.direction!
        : Number.isInteger(cacheDirection)
          ? cacheDirection
          : 6;
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
