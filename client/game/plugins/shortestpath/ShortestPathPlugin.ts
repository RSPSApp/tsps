import { GameState } from "@runelite/api/GameState";
import type { ConfigChanged, PluginMessage } from "@runelite/api/events";
import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import { ClientState } from "../../ClientState";
import type { OsrsClient } from "../../OsrsClient";
import { fromLocalInstance, toLocalInstance, type InstanceScene, type WorldPoint } from "../../scene/worldPoint";
import type { WidgetOverlay, WorldMapOverlayContext } from "../ClientPluginManager";
import { ORBS_NOMAP_WORLDMAP, ORBS_WORLDMAP } from "../groundmarkers/GroundMarkerSharingManager";
import type { CollisionMap } from "./pathfinder/CollisionMap";
import type { PathStep } from "./pathfinder/NodeGraph";
import type { PathfinderResult } from "./pathfinder/Pathfinder";
import type { PathTransport } from "./pathfinder/PathfinderConfig";
import type { PathSearchBackend, PathSearchRequest } from "./pathfinder/PathSearch";
import { capturePlayer } from "./playerState";
import { Requirements, type PlayerSnapshot, type RoutingSettings } from "./requirement/Requirements";
import { loadTransports, RESOURCE_DIR } from "./resources";
import { drawWorldMapPath, PathMinimapOverlay, PathTileOverlay } from "./ShortestPathOverlays";
import { CONFIG_GROUP, ShortestPathConfig, type TeleportationItem } from "./ShortestPathConfig";
import type { Transport } from "./transport/Transport";
import { type Unlock } from "./transport/TransportItems";
import { distanceBetween, packWorldPoint, UNDEFINED, unpackWorldPlane, unpackWorldX, unpackWorldY } from "./WorldPointUtil";

/** JagexColors.MENU_TARGET. */
const MENU_TARGET = "ff9040";
const colour = (text: string) => `<col=${MENU_TARGET}>${text}</col>`;
const SET = "Set";
const CLEAR = "Clear";
const TARGET = colour("Target");
const START = colour("Start");
const PATH = colour("Path");

/** Settings that only change how the path is drawn; any other key recalculates the path. */
const DISPLAY_KEYS = new Set([
    "cancelInstead", "recalculateDistance", "finishDistance", "showUnreachableText", "showTileCounter", "tileCounterStep",
    "showTransportInfo", "drawMap", "drawMinimap", "drawTiles", "pathStyle", "colourPath", "colourPathCalculating",
    "colourPathUnreachable", "colourTransports", "colourCollisionMap", "colourText", "drawTransports", "drawCollisionMap",
    "unreachableText",
]);

/** The search being shown: upstream's ActiveSearch, as the worker reports it. */
export type ActiveSearch = {
    readonly start: number;
    readonly targets: readonly number[];
    path: PathStep[];
    result: PathfinderResult | null;
    cancel: () => void;
};

export type ShortestPathDeps = {
    configManager?: ConfigManager;
    /** The search thread; defaults to a Web Worker. */
    backend?: PathSearchBackend;
    /** Reads a file under client/public; defaults to fetch. */
    readText?: (path: string) => Promise<string>;
    /** The player snapshot the requirement gates read; defaults to the client's own state. */
    player?: () => PlayerSnapshot;
};

const publicUrl = (path: string) => `${(process.env.PUBLIC_URL ?? "").replace(/\/$/, "")}/${path}`;

async function fetchText(path: string): Promise<string> {
    const response = await fetch(publicUrl(path));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
}

async function createWorkerBackend(): Promise<PathSearchBackend> {
    const collisionMapUrl = new URL(publicUrl(`${RESOURCE_DIR}/collision-map.zip`), globalThis.location?.href).href;
    if (typeof Worker === "undefined") {
        const [{ InProcessSearchBackend }, { loadCollisionMap }] = await Promise.all([
            import("./pathfinder/PathSearch"), import("./pathfinder/loadCollisionMap"),
        ]);
        return new InProcessSearchBackend(async () => loadCollisionMap(await (await fetch(collisionMapUrl)).arrayBuffer()));
    }
    const { WorkerSearchBackend } = await import("./pathfinder/WorkerSearchBackend");
    return new WorkerSearchBackend(collisionMapUrl);
}

/** A target or start from a plugin message: a WorldPoint, a packed point, or {point}. */
function decodePoint(value: unknown): number {
    if (typeof value === "number" && Number.isInteger(value)) return value | 0;
    if (value && typeof value === "object") {
        const point = (value as { point?: unknown }).point;
        if (point !== undefined) return decodePoint(point);
        const { x, y, plane } = value as { x?: unknown; y?: unknown; plane?: unknown };
        if (typeof x === "number" && typeof y === "number") return packWorldPoint(x, y, typeof plane === "number" ? plane : 0);
    }
    return UNDEFINED;
}

/**
 * Skretzo's Shortest Path 1.22.5: Shift + right-click a tile's "Walk here", or right-click the
 * world map, to set a target; the shortest route, with the transports the account can use, is
 * drawn on the tiles, the minimap and the world map, and recalculated when the player strays.
 * Other plugins drive it with PluginMessage("shortestpath", "path" | "clear", ...).
 */
export class ShortestPathPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Shortest Path",
        description: "Draws the shortest path to a chosen destination on the map. Right click on the world map or shift right click a tile to use",
        tags: ["pathfinder", "map", "waypoint", "navigation"],
        enabledByDefault: false,
        configKey: "shortestpathplugin",
    };

    static config = ShortestPathConfig;

    readonly config: ConfigOf<typeof ShortestPathConfig>;
    private readonly configManager: ConfigManager;
    private readonly osrsClient: OsrsClient;
    private readonly deps: ShortestPathDeps;
    private readonly overlays: WidgetOverlay[];
    private backend: PathSearchBackend | undefined;
    private backendLoading: Promise<PathSearchBackend> | undefined;
    /** Bumped on every start and stop, so a backend that finishes loading after either is discarded. */
    private lifecycle = 0;
    /** Every loaded transport; a PathTransport's index points into this. */
    transports: Transport[] = [];
    private transportsLoading: Promise<void> | undefined;
    /** The transports the last refresh found usable, by origin (debug drawing). */
    usableTransports = new Set<number>();
    /** The search on screen (upstream's PathScheduler.pathfinder). */
    activeSearch: ActiveSearch | null = null;
    private startPointSet = false;
    private lastLocation = UNDEFINED;
    private generation = 0;
    /** Setting overrides from a plugin message, until "clear". */
    private overrides = new Map<string, unknown>();
    private bankSeen = false;
    /** A main-thread copy of the collision map, loaded only for the collision map debug view. */
    debugMap: CollisionMap | undefined;
    private debugMapLoading = false;

    constructor(osrsClient?: OsrsClient, deps: ShortestPathDeps = {}) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.configManager = deps.configManager ?? inject(ConfigManager);
        this.deps = deps;
        this.config = this.configManager.getConfig(ShortestPathConfig);
        this.overlays = [new PathTileOverlay(this), new PathMinimapOverlay(this)];
    }

    widgetOverlays(): WidgetOverlay[] {
        return this.isStarted() ? this.overlays : [];
    }

    protected async startUp(): Promise<void> {
        this.lifecycle++;
        this.ensureLoaded();
    }

    protected async shutDown(): Promise<void> {
        this.lifecycle++;
        this.setTarget(UNDEFINED);
        this.overrides.clear();
        this.backend?.dispose();
        this.backend = undefined;
        this.backendLoading = undefined;
    }

    /** Loads the transports and starts the search thread, once. */
    ensureLoaded(): Promise<void> {
        this.transportsLoading ??= loadTransports(this.deps.readText ?? fetchText).then((transports) => {
            this.transports = transports;
        }).catch((error) => {
            console.warn("[shortest-path] transports failed to load", error);
        });
        if (!this.backendLoading) {
            const lifecycle = this.lifecycle;
            const loading = (this.deps.backend ? Promise.resolve(this.deps.backend) : createWorkerBackend()).then((backend) => {
                // Stopped or restarted while the import was in flight: this backend belongs to no one.
                if (lifecycle !== this.lifecycle || !this.isStarted() || this.backendLoading !== loading) {
                    backend.dispose();
                    return backend;
                }
                if (this.backend !== backend) this.backend?.dispose();
                this.backend = backend;
                return backend;
            });
            this.backendLoading = loading;
        }
        return Promise.all([this.transportsLoading, this.backendLoading.then((b) => b.ready)]).then(() => {});
    }

    // ------------------------------------------------------------------ settings

    /** A setting, with any plugin-message override (upstream's Settings.applyOverrides). */
    setting<T>(key: keyof typeof ShortestPathConfig.items): T {
        if (this.overrides.has(key)) return this.overrides.get(key) as T;
        return (this.config as any)[key]() as T;
    }

    private routingSettings(): RoutingSettings {
        const unlocks = new Set<Unlock>();
        if (this.setting("unlockCanoeAxe")) unlocks.add("CANOE_AXE");
        if (this.setting("unlockXericsHonour")) unlocks.add("XERICS_HONOUR");
        if (this.setting("unlockDragontoothPassage")) unlocks.add("DRAGONTOOTH");
        if (this.setting("unlockMorUlRek")) unlocks.add("MOR_UL_REK");
        if (this.setting("unlockBalloonLogBasket")) unlocks.add("BALLOON_LOG_BASKET");
        return {
            enabled: (key) => this.setting<boolean>(key as any) !== false,
            cost: (key) => Number(this.setting(key as any)) || 0,
            teleportationItem: this.setting<TeleportationItem>("useTeleportationItems"),
            currencyThreshold: Number(this.setting("currencyThreshold")) || 0,
            respawnPrifddinas: !!this.setting("respawnPrifddinas"),
            declaredUnlocks: unlocks,
        };
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== CONFIG_GROUP || DISPLAY_KEYS.has(event.getKey())) return;
        const search = this.activeSearch;
        if (search) this.restart(search.start, search.targets);
    }

    // ------------------------------------------------------------------ player

    isLoggedIn(): boolean {
        return toRuneLiteGameState((this.osrsClient as any)?.gameState) === GameState.LOGGED_IN;
    }

    getClient(): OsrsClient {
        return this.osrsClient;
    }

    instanceScene(): InstanceScene {
        return {
            templates: ClientState.inInstance ? ClientState.instanceTemplateChunks : null,
            baseX: ClientState.baseX,
            baseY: ClientState.baseY,
        };
    }

    /** The local player's scene tile. */
    playerTile(): WorldPoint | undefined {
        const client: any = this.osrsClient;
        const index = client.playerEcs?.getIndexForServerId?.(client.controlledPlayerServerId);
        if (index === undefined) return undefined;
        const players = client.playerEcs;
        return { x: players.getX(index) >> 7, y: players.getY(index) >> 7, plane: players.getLevel(index) | 0 };
    }

    /** WorldPointUtil.fromLocalInstance(client, localPlayer), packed. */
    playerLocation(): number {
        const tile = this.playerTile();
        if (!tile) return UNDEFINED;
        return this.toWorld(tile.x, tile.y, tile.plane);
    }

    /** A scene tile's world point, packed. */
    toWorld(x: number, y: number, plane: number): number {
        const point = fromLocalInstance(this.instanceScene(), { x, y, plane });
        return packWorldPoint(point.x, point.y, point.plane);
    }

    /** The scene tiles showing a world point (several in an instance). */
    toLocalInstance(packed: number): WorldPoint[] {
        return toLocalInstance(this.instanceScene(), { x: unpackWorldX(packed), y: unpackWorldY(packed), plane: unpackWorldPlane(packed) });
    }

    private player(): PlayerSnapshot {
        if (this.deps.player) return this.deps.player();
        if ((this.osrsClient.lastKnownBank?.getSlots?.() ?? []).some((slot) => slot.itemId >= 0)) this.bankSeen = true;
        return capturePlayer(this.osrsClient, this.bankSeen);
    }

    // ------------------------------------------------------------------ searching (PathScheduler)

    /** PathfinderConfig.refresh: the transports this account can use now, priced. */
    buildRequest(start: number, targets: readonly number[]): PathSearchRequest {
        const requirements = new Requirements(this.player(), this.routingSettings());
        const transports: PathTransport[] = [];
        const destinations = new Set<number>();
        this.usableTransports = new Set();
        this.transports.forEach((transport, index) => {
            destinations.add(transport.destination);
            if (!requirements.usable(transport)) return;
            this.usableTransports.add(index);
            transports.push({
                index,
                origin: transport.origin,
                destination: transport.destination,
                duration: transport.duration,
                additionalCost: requirements.additionalCost(transport),
                delayedVisit: transport.type.sharesDestinationsWith !== null,
                differentialCost: requirements.differentialCost(transport),
                isTeleport: transport.type.isTeleport,
                maxWildernessLevel: transport.maxWildernessLevel,
            });
        });
        return {
            start,
            targets,
            transports,
            transportDestinations: [...destinations],
            avoidWilderness: !!this.setting("avoidWilderness"),
            unreachableTargetDistance: Number(this.setting("unreachableTargetDistanceThreshold")) || 0,
            collisionAwareBlockedTargets: !!this.setting("collisionAwareBlockedTargets"),
            calculationCutoffMillis: (Number(this.setting("calculationCutoff")) || 0) * 600,
        };
    }

    /** PathScheduler.restart: replaces the search on screen with one from start to targets. */
    restart(start: number, targets: readonly number[]): void {
        this.activeSearch?.cancel();
        const generation = ++this.generation;
        const search: ActiveSearch = { start, targets: [...targets], path: [], result: null, cancel: () => {} };
        this.activeSearch = search;
        void this.ensureLoaded().then(() => {
            if (generation !== this.generation || !this.backend) return;
            search.cancel = this.backend.search(this.buildRequest(start, targets), {
                progress: (path) => {
                    if (generation === this.generation) search.path = path;
                },
                done: (result) => {
                    if (generation !== this.generation) return;
                    search.path = result.path;
                    search.result = result;
                },
            });
        }).catch((error) => console.warn("[shortest-path] search failed to start", error));
    }

    /** PathScheduler.setTarget: UNDEFINED clears the path; append adds a target. */
    setTarget(target: number, append = false): void {
        this.setTargets(target === UNDEFINED ? [] : [target], append);
    }

    setTargets(targets: readonly number[], append = false): void {
        if (targets.length === 0) {
            this.activeSearch?.cancel();
            this.activeSearch = null;
            this.generation++;
            this.startPointSet = false;
            return;
        }
        let start = this.playerLocation();
        if (start === UNDEFINED && !(this.startPointSet && this.activeSearch)) return;
        if (start !== UNDEFINED) this.lastLocation = start;
        if (this.startPointSet && this.activeSearch) start = this.activeSearch.start;
        const all = append && this.activeSearch ? [...new Set([...this.activeSearch.targets, ...targets])] : targets;
        this.restart(start, all);
    }

    /** PathScheduler.setStart. */
    setStart(start: number): void {
        if (!this.activeSearch) return;
        this.startPointSet = true;
        this.restart(start, this.activeSearch.targets);
    }

    isDone(): boolean {
        return !!this.activeSearch?.result;
    }

    /** PathRenderState.isPathUnreachable: the finished path ends too far from every target. */
    isPathUnreachable(): boolean {
        const search = this.activeSearch;
        if (!search?.result || search.targets.length === 0) return false;
        const end = search.path.length === 0 ? search.start : search.path[search.path.length - 1].packed;
        const closest = Math.min(...search.targets.map((target) => distanceBetween(target, end)));
        return closest > (Number(this.setting("unreachableTargetDistanceThreshold")) || 0);
    }

    /** PathRenderState.getPathColor: calculating, unreachable or the path colour, as ARGB. */
    pathColor(): number {
        if (!this.isDone()) return Number(this.setting("colourPathCalculating")) >>> 0;
        if (this.isPathUnreachable()) return Number(this.setting("colourPathUnreachable")) >>> 0;
        return Number(this.setting("colourPath")) >>> 0;
    }

    /** RefreshCoordinator.offRouteTick: finish near a target, recalculate (or cancel) off the path. */
    onGameTick(): void {
        if (!this.isStarted()) return;
        if (this.setting("drawCollisionMap") && !this.debugMap) this.loadDebugMap();
        const search = this.activeSearch;
        if (!search || !this.isLoggedIn()) return;
        const location = this.playerLocation();
        if (location === UNDEFINED) return;
        const finishDistance = Number(this.setting("finishDistance"));
        for (const target of search.targets) {
            if (distanceBetween(location, target) < finishDistance) {
                this.setTarget(UNDEFINED);
                return;
            }
        }
        if (!this.startPointSet && !this.isNearPath(location)) {
            if (this.setting("cancelInstead")) {
                this.setTarget(UNDEFINED);
                return;
            }
            this.restart(location, search.targets);
        }
    }

    /** PathScheduler.isNearPath. */
    private isNearPath(location: number): boolean {
        const sameLocation = this.lastLocation === location;
        this.lastLocation = location;
        const path = this.activeSearch?.path;
        const recalculateDistance = Number(this.setting("recalculateDistance"));
        if (!path || path.length === 0 || recalculateDistance < 0 || sameLocation || !this.isDone()) return true;
        return path.some((step) => distanceBetween(location, step.packed) < recalculateDistance);
    }

    private loadDebugMap(): void {
        if (this.debugMapLoading) return;
        this.debugMapLoading = true;
        const local = this.backend?.map();
        if (local) {
            this.debugMap = local;
            return;
        }
        void import("./pathfinder/loadCollisionMap").then(async ({ loadCollisionMap }) => {
            const response = await fetch(publicUrl(`${RESOURCE_DIR}/collision-map.zip`));
            this.debugMap = await loadCollisionMap(await response.arrayBuffer());
        }).catch((error) => console.warn("[shortest-path] collision map failed to load", error));
    }

    // ------------------------------------------------------------------ plugin messages (PluginMessageHandler)

    onPluginMessage(event: PluginMessage): void {
        if (!this.isStarted() || event.namespace !== CONFIG_GROUP) return;
        const data = event.data ?? {};
        if (event.name === "path") {
            const overrides = data.config;
            if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
                for (const [key, value] of Object.entries(overrides)) {
                    if (key in ShortestPathConfig.items) this.overrides.set(key, value);
                }
            }
            if (data.start === undefined && data.target === undefined) return;
            let start = decodePoint(data.start);
            if (start === UNDEFINED) start = this.playerLocation();
            const targets = this.decodeTargets(data.target);
            if (start === UNDEFINED || targets === null) return;
            // No target while a path is shown: recalculate from start to the same targets.
            const useOld = targets.length === 0 && this.activeSearch;
            this.restart(start, useOld ? this.activeSearch!.targets : targets);
        } else if (event.name === "clear") {
            this.overrides.clear();
            this.setTarget(UNDEFINED);
        }
    }

    /** PluginMessageTargets.decode: one target or a collection; null when malformed. */
    private decodeTargets(value: unknown): number[] | null {
        if (value === undefined || value === null) return [];
        const items = value instanceof Set ? [...value] : Array.isArray(value) ? value : [value];
        const targets: number[] = [];
        for (const item of items) {
            const point = decodePoint(item);
            if (point === UNDEFINED) {
                console.warn("[shortest-path] ignoring plugin message with invalid target", item);
                return null;
            }
            if (!targets.includes(point)) targets.push(point);
        }
        return targets;
    }

    // ------------------------------------------------------------------ menus (MenuVerbs)

    private entry(option: string, target: string, onClick: () => void): SimpleMenuEntry {
        return { option, target, targetType: MenuTargetType.NONE, onClick };
    }

    /** The Set/Clear verbs, in the order upstream adds them. */
    private verbs(point: number, onPath: boolean): SimpleMenuEntry[] {
        const entries = [this.entry(SET, TARGET, () => this.setTarget(point))];
        const search = this.activeSearch;
        if (search && search.targets.length > 0) {
            entries.push(this.entry(SET, `${TARGET}${colour(` ${search.targets.length + 1}`)}`, () => this.setTarget(point, true)));
            entries.push(this.entry(SET, START, () => this.setStart(point)));
            if (onPath) entries.push(this.entry(CLEAR, PATH, () => this.setTarget(UNDEFINED)));
        }
        return entries;
    }

    /** MenuVerbs.onMenuEntryAdded: Shift on "Walk here" adds Set Target, Set Start and Clear Path under it. */
    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (!this.isStarted()) return entries;
        if (context.surface === "widget" && (context.widgetId === ORBS_WORLDMAP || context.widgetId === ORBS_NOMAP_WORLDMAP)) {
            if (!this.activeSearch || entries.some((e) => e.option === CLEAR && e.target === PATH)) return entries;
            const cancel = entries.findIndex((e) => e.option === "Cancel");
            const clear = this.entry(CLEAR, PATH, () => this.setTarget(UNDEFINED));
            return cancel < 0 ? [...entries, clear] : [...entries.slice(0, cancel), clear, ...entries.slice(cancel)];
        }
        // Ctrl + Shift is the dev teleport on "Walk here"; leave that menu alone.
        if (context.surface !== "world" || !ClientState.isShiftPressed() || ClientState.isCtrlPressed()) return entries;
        const walkIndex = entries.findIndex((e) => e.option === "Walk here");
        if (walkIndex < 0) return entries;
        const walk = entries[walkIndex];
        if (walk.mapX === undefined || walk.mapY === undefined) return entries;
        const tile = { x: ClientState.baseX + walk.mapX, y: ClientState.baseY + walk.mapY, plane: this.playerTile()?.plane ?? (ClientState.plane | 0) };
        const world = fromLocalInstance(this.instanceScene(), tile);
        const point = packWorldPoint(world.x, world.y, world.plane);
        const onPath = !!this.activeSearch?.path.some((step) => step.packed === point);
        return [...entries.slice(0, walkIndex + 1), ...this.verbs(point, onPath), ...entries.slice(walkIndex + 1)];
    }

    /** MenuVerbs on the world map: Set Target anywhere, and Set Start and Clear Path once a path is shown. */
    worldMapMenuEntries(point: { x: number; y: number; plane: number }): SimpleMenuEntry[] {
        if (!this.isStarted()) return [];
        return this.verbs(packWorldPoint(point.x, point.y, point.plane), true);
    }

    drawWorldMap(context: WorldMapOverlayContext): void {
        if (this.isStarted() && this.setting("drawMap")) drawWorldMapPath(this, context);
    }
}
