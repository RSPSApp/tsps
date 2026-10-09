import { getClientCycle } from "../../../network/ServerConnection";
import { mat4, vec3, vec4 } from "gl-matrix";
import { Scene } from "../../../rs/scene/Scene";
import type { HitsplatEventPayload } from "../../../game/GameRenderer";
import { ClientState } from "../../../game/ClientState";
import type { GroundItemOverlayEntry } from "../../../game/data/ground/GroundItemStore";
import { appendAttackTimerOverhead } from "../../../game/plugins/attacktimer/AttackTimerOverhead";
import type { TileMarkersPluginConfig } from "../../../game/plugins/tilemarkers/types";
import type { Model } from "../../../rs/model/Model";
import type { OsrsMenuEntry } from "../../../rs/MenuEntry";
import type { LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { Ray } from "../../../game/math/Raycast";
import type { MapManager } from "../../../game/MapManager";
import { SceneRaycaster } from "../../../game/scene/SceneRaycaster";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuClickContext } from "../../../ui/menu/MenuEngine";
import type { InteractHighlightDrawTarget } from "../../../ui/devoverlay/InteractHighlightOverlay";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../../../game/actor/ActorOverlayState";
import { resolveGroundItemStackPlane } from "../../../game/scene/PlaneResolver";
import { getMapSquareId } from "../../../rs/map/MapFileIndex";
import type { WebGLOsrsRendererHost } from "../../render/hostInterface";
import {
    addHitSplatOsrs,
    actorAddHealthBar,
    actorRemoveHealthBar,
    appendActorHealthBars,
    appendPlayerOverheadText,
    buildSimpleMenuEntries as buildSimpleMenuEntriesViaHost,
    checkInteractions as checkInteractionsViaHost,
    clearInteractHighlightActiveTarget as clearInteractHighlightActiveTargetViaHost,
    clearInteractHighlightHoverTarget as clearInteractHighlightHoverTargetViaHost,
    computeOverheadAlpha,
    computeTerrainTileAt as computeTerrainTileAtViaHost,
    computeTileAt as computeTileAtViaHost,
    ensureActorHealthBars,
    findNearestLocTile as findNearestLocTileViaHost,
    findVisualProxyModel as findVisualProxyModelViaHost,
    getBridgedTileHeight,
    getEffectiveControlledPlayerId,
    getEffectiveNpcType,
    getEffectivePlaneForTile,
    getHeightSamplePlaneForTile,
    getHitsplatVisibility,
    getInteractHighlightDrawTargets as getInteractHighlightDrawTargetsViaHost,
    getInteractLocModelLoader as getInteractLocModelLoaderViaHost,
    getLocIdsAtTileAllLevels as getLocIdsAtTileAllLevelsViaHost,
    getLocSize as getLocSizeViaHost,
    getLocalPlayerTile as getLocalPlayerTileViaHost,
    getMinTileHeightInRadius,
    getNpcDefaultHeight,
    getNpcFootprintRadius,
    getNpcWorldTile as getNpcWorldTileViaHost,
    getOccupancyPlaneForTile,
    getSequenceVerticalOffsetTiles,
    getTileRenderFlagAt,
    hasNoVisibleFaces as hasNoVisibleFacesViaHost,
    healthBarGet,
    healthBarPut,
    intersectTerrainPickTriangle as intersectTerrainPickTriangleViaHost,
    isBridgeSurfaceTile,
    isLocalPlayerAdjacentToLoc as isLocalPlayerAdjacentToLocViaHost,
    isLocHighlightTargetStillPresent as isLocHighlightTargetStillPresentViaHost,
    isMouseInUIRegion as isMouseInUIRegionViaHost,
    isSameInteractHighlightTarget as isSameInteractHighlightTargetViaHost,
    makeActorGroupKey,
    mapOverheadColor,
    maybeExpireInteractHighlightTarget as maybeExpireInteractHighlightTargetViaHost,
    onInteractHighlightEntryInvoked as onInteractHighlightEntryInvokedViaHost,
    performWorldEntryAction as performWorldEntryActionViaHost,
    resolveModIcon,
    resolveNpcOverlayAnchor as resolveNpcOverlayAnchorViaHost,
    resolvePlayerAnimationHeightOffsetTiles,
    resolvePlayerHeadIconOffset,
    resolvePlayerHitsplatOffset,
    resolvePlayerLogicalHeightTiles,
    resolveLocHighlightTargetFromEntry as resolveLocHighlightTargetFromEntryViaHost,
    resolveLocInteractionTile as resolveLocInteractionTileViaHost,
    resolveLocTypeRotAtTile as resolveLocTypeRotAtTileViaHost,
    resolveNpcHighlightTargetFromEntry as resolveNpcHighlightTargetFromEntryViaHost,
    resolveInteractHighlightTargetFromEntry as resolveInteractHighlightTargetFromEntryViaHost,
    resolveInteractHighlightTargetFromLocalInteraction as resolveInteractHighlightTargetFromLocalInteractionViaHost,
    screenToRay as screenToRayViaHost,
    shouldLayerNpcMovementSequence,
    spawnClickCross as spawnClickCrossViaHost,
    syncInteractHighlightActiveTargetFromLocalInteraction as syncInteractHighlightActiveTargetFromLocalInteractionViaHost,
    toCssEvent as toCssEventViaHost,
    toGLClickXY as toGLClickXYViaHost,
    trimActorHealthBars,
    trimHitsplats,
    updateHoveredTile as updateHoveredTileViaHost,
    updateInteractHighlightHoverTarget as updateInteractHighlightHoverTargetViaHost,
    worldToScreen,
    getInteractNpcModelLoader,
    buildHighlightTrianglePoints as buildHighlightTrianglePointsViaHost,
    buildLocModelHighlightTriangles as buildLocModelHighlightTrianglesViaHost,
    buildNpcModelHighlightTriangles as buildNpcModelHighlightTrianglesViaHost,
    resolveNpcMovementSequenceIds,
    resolveNpcHighlightTargetFromServerId,
    buildModelTrianglePoints,
} from "../../render/index";
import { DEFAULT_OVERHEAD_CHAT_COLOR, DEFAULT_OVERHEAD_CHAT_COLOR_ID, RENDER_CONSTANTS } from "../../render/constants";
import type { InteractHighlightTarget, LocHighlightTarget, NpcHighlightTarget } from "../../render/constants";
import type { HitsplatLayer } from "./HitsplatLayer";
import type { HealthBarLayer } from "./HealthBarLayer";
import type {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    OverlayUpdateArgs,
} from "../../../ui/devoverlay/Overlay";
import type { WebGPUMapSquare } from "../WebGPUMapSquare";
import type { WebGPURenderer } from "../WebGPURenderer";
import type { WebGLMapSquare } from "../../WebGLMapSquare";
import { computeWebGPURoofPlaneLimit } from "../frameConfig";

const PLAYER_DEFAULT_HEIGHT_FALLBACK = 200 / 128;

/**
 * Host adapter for the WebGL overlay helper layer. The helper functions in
 * client/render/render/* take a WebGLOsrsRendererHost; this class supplies the fields and
 * methods they read (map sampling, ECS lookups, entry pools) backed by the WebGPU renderer,
 * so the stage-4 overlays share the exact same population and layout rules.
 */
export class OverlayHost {
    readonly osrsClient: WebGPURenderer["osrsClient"];
    readonly mapManager: WebGPURenderer["mapManager"];
    readonly stats: WebGPURenderer["stats"];
    readonly canvas: HTMLCanvasElement;
    readonly app: { width: number; height: number; gl: { canvas: HTMLCanvasElement } };

    readonly npcDefaultHeightCache = new Map<number, number>();
    playerDefaultHeightTiles: number | undefined;
    pendingControlledPlayerServerId: number | undefined;

    // ── Interaction host state (checkInteractions / SceneRaycaster) ─────────────────────────
    sceneRaycaster: SceneRaycaster | null = null;
    readonly cachedMenuEntries: OsrsMenuEntry[] = [];
    readonly cachedClientMenuEntries: OsrsMenuEntry[] = [];
    cachedActiveSpell: {
        spellId: number;
        spellName: string;
        actionName: string;
        spellLevel: number;
        runes: unknown;
        targetMask: number;
    } | null = null;
    readonly cachedLocIds = new Set<string>();
    readonly cachedObjIds = new Set<string>();
    readonly cachedNpcIds = new Set<number>();
    readonly cachedPlayerIds = new Set<number>();
    cachedCssEventResult = { clientX: 0, clientY: 0 };
    cachedCanvasRect: DOMRect | null = null;
    cachedCanvasRectFrame = -1;
    currentFrameCount = 0;
    boundToCssEvent: (
        gx?: number,
        gy?: number,
    ) => { clientX: number; clientY: number } | undefined;
    lastInteractionClientCycle = -1;
    lastInteractionMenuOpen = false;
    lastInteractionRaycastHitCount = 0;
    lastInteractionMenuOptionCount = 0;
    hoverTileX = -1;
    hoverTileY = -1;
    clickCrossOverlay?: {
        spawn(
            tileX: number,
            tileY: number,
            screenX: number,
            screenY: number,
            basePlane: number,
            atTime?: number,
            variant?: "yellow" | "red",
        ): void;
    };
    interactHighlightHoverTarget?: InteractHighlightTarget;
    interactHighlightActiveTarget?: InteractHighlightTarget;
    interactHighlightActiveFromInteraction = false;
    interactHighlightClickTick = -1;
    readonly interactHighlightDrawTargets: InteractHighlightDrawTarget[] = [];
    interactLocModelLoader?: LocModelLoader;

    // Scratch objects used by the shared screenToRay / terrain pick helpers.
    tmpInvViewProj = mat4.create();
    tmpNear = vec4.create();
    tmpFar = vec4.create();
    tmpTerrainEntryPoint = vec3.create();

    readonly hitsplatPool: HitsplatEntry[] = [];
    readonly healthBarPool: HealthBarEntry[] = [];
    readonly overheadTextPool: OverheadTextEntry[] = [];
    readonly overheadPrayerPool: OverheadPrayerEntry[] = [];

    readonly hitsplatOutput: HitsplatEntry[] = [];
    readonly healthBarOutput: HealthBarEntry[] = [];
    readonly overheadTextOutput: OverheadTextEntry[] = [];
    readonly overheadPrayerOutput: OverheadPrayerEntry[] = [];

    readonly playerHitsplats = new Map<number, ActorHitsplatState>();
    readonly npcHitsplats = new Map<number, ActorHitsplatState>();
    readonly playerHealthBars = new Map<number, ActorHealthBarsState>();
    readonly npcHealthBars = new Map<number, ActorHealthBarsState>();

    readonly actor2dStacks = new Map<number, number>();

    interactNpcModelLoader: ReturnType<typeof getInteractNpcModelLoader>;

    hitsplatOverlay?: HitsplatLayer;
    healthBarOverlay?: HealthBarLayer;

    groundOverlayEntries: GroundItemOverlayEntry[] = [];

    /** Frame-scoped values published by populateFrame for the overlay layers. */
    timeMs = 0;
    clientCycle = 0;
    playerWorldX?: number;
    playerWorldZ?: number;
    playerLevel = 0;
    playerRawLevel = 0;
    gameCycle = 0;

    private args?: OverlayUpdateArgs;
    private readonly renderer: WebGPURenderer;

    constructor(renderer: WebGPURenderer) {
        this.renderer = renderer;
        this.osrsClient = renderer.osrsClient;
        this.mapManager = renderer.mapManager;
        this.stats = renderer.stats;
        this.canvas = renderer.canvas;
        this.app = {
            get width() {
                return renderer.canvas.width;
            },
            get height() {
                return renderer.canvas.height;
            },
            gl: { canvas: renderer.canvas },
        };
        this.sceneRaycaster = new SceneRaycaster(
            this.mapManager as unknown as MapManager<WebGLMapSquare>,
            renderer.osrsClient,
        );
        this.boundToCssEvent = (gx?: number, gy?: number) =>
            this.toCssEvent(gx, gy, this.currentFrameCount);
    }

    private get typedHost(): WebGLOsrsRendererHost {
        return this as unknown as WebGLOsrsRendererHost;
    }

    /**
     * Deck placement read by the shared overlay pop helpers (projectDeckToWorld): an actor
     * aboard a boat has deck coordinates, so their labels are anchored where the deck is drawn.
     */
    get worldEntityAnimator(): WebGPURenderer["worldEntityAnimator"] {
        return this.renderer.worldEntityAnimator;
    }

    // ── Pools ────────────────────────────────────────────────────────────────────────────────

    acquireHitsplatEntry(): HitsplatEntry {
        const entry = this.hitsplatPool.pop() ?? { worldX: 0, worldZ: 0, plane: 0 };
        entry.style = undefined;
        entry.spriteName = undefined;
        entry.type2 = undefined;
        entry.damage2 = undefined;
        return entry;
    }

    acquireHealthBarEntry(): HealthBarEntry {
        return (
            this.healthBarPool.pop() ?? {
                worldX: 0,
                worldZ: 0,
                plane: 0,
                health: 0,
                health2: 0,
                cycle: 0,
                cycleOffset: 0,
            }
        );
    }

    acquireOverheadTextEntry(): OverheadTextEntry {
        const entry = this.overheadTextPool.pop() ?? {
            worldX: 0,
            worldZ: 0,
            plane: 0,
            heightOffsetTiles: 0.9,
            text: "",
            color: DEFAULT_OVERHEAD_CHAT_COLOR >>> 0,
            colorId: DEFAULT_OVERHEAD_CHAT_COLOR_ID,
            effect: 0,
            life: 1,
            remaining: 0,
            duration: 1,
        };
        entry.modIcon = undefined;
        entry.pattern = undefined;
        return entry;
    }

    acquireOverheadPrayerEntry(): OverheadPrayerEntry {
        return (
            this.overheadPrayerPool.pop() ?? {
                worldX: 0,
                worldZ: 0,
                plane: 0,
                heightOffsetTiles: 0.9,
                headIconPk: -1,
                headIconPrayer: -1,
                npcHeadIcons: undefined,
            }
        );
    }

    resetHealthBarOutput(): void {
        for (const entry of this.healthBarOutput) {
            entry.defId = undefined;
            entry.heightOffsetTiles = undefined;
            this.healthBarPool.push(entry);
        }
        this.healthBarOutput.length = 0;
    }

    resetOverheadPrayerOutput(): void {
        for (const entry of this.overheadPrayerOutput) {
            entry.headIconPk = -1;
            entry.headIconPrayer = -1;
            entry.npcHeadIcons = undefined;
            entry.heightOffsetTiles = 0.9;
            this.overheadPrayerPool.push(entry);
        }
        this.overheadPrayerOutput.length = 0;
    }

    resetOverheadTextOutput(): void {
        for (const entry of this.overheadTextOutput) {
            entry.text = "";
            entry.life = 0;
            entry.remaining = 0;
            entry.duration = 0;
            entry.modIcon = undefined;
            entry.pattern = undefined;
            entry.heightOffsetTiles = 0.9;
            entry.color = DEFAULT_OVERHEAD_CHAT_COLOR >>> 0;
            entry.colorId = DEFAULT_OVERHEAD_CHAT_COLOR_ID;
            this.overheadTextPool.push(entry);
        }
        this.overheadTextOutput.length = 0;
    }

    resetHitsplatOutput(): void {
        for (const entry of this.hitsplatOutput) {
            entry.style = undefined;
            entry.spriteName = undefined;
            this.hitsplatPool.push(entry);
        }
        this.hitsplatOutput.length = 0;
    }

    // ── Delegated helpers (same implementations as the WebGL path) ──────────────────────────

    getNpcDefaultHeight(npcTypeId: number): number {
        return getNpcDefaultHeight(this.typedHost, npcTypeId);
    }

    resolveNpcOverlayAnchor(
        ecsId: number,
        baseWorldX: number,
        baseWorldZ: number,
        npcTypeId: number | undefined,
    ): { worldX: number; worldZ: number; logicalHeightTiles: number } {
        return resolveNpcOverlayAnchorViaHost(this.typedHost, ecsId, baseWorldX, baseWorldZ, npcTypeId);
    }

    getEffectiveControlledPlayerId(): number {
        return getEffectiveControlledPlayerId(this.typedHost);
    }

    addHitSplatOsrs(
        state: ActorHitsplatState,
        type: number,
        value: number,
        type2: number,
        value2: number,
        currentCycle: number,
        delayCycles: number,
    ): void {
        addHitSplatOsrs(this.typedHost, state, type, value, type2, value2, currentCycle, delayCycles);
    }

    getHitsplatVisibility(
        state: ActorHitsplatState,
        slot: number,
        cycle: number,
    ): number | undefined {
        return getHitsplatVisibility(this.typedHost, state, slot, cycle);
    }

    trimHitsplats(tick: number): void {
        trimHitsplats(this.typedHost, tick);
    }

    ensureHitsplatState(map: Map<number, ActorHitsplatState>, serverId: number): ActorHitsplatState {
        let state = map.get(serverId);
        if (state) return state;
        state = createActorHitsplatState();
        map.set(serverId, state);
        return state;
    }

    resolveHealthBarDefinition(defId: number): HealthBarDefinitionState {
        const def = this.healthBarOverlay?.getDefinition(defId | 0);
        return {
            defId: defId | 0,
            int1: (def?.int1 ?? 255) | 0,
            int2: (def?.int2 ?? 255) | 0,
            int3: (def?.int3 ?? -1) | 0,
            stepIncrement: (def?.stepIncrement ?? 1) | 0,
            int5: (def?.int5 ?? 70) | 0,
            width: Math.max(1, Math.min(255, def?.width ?? 30)) | 0,
            widthPadding: Math.max(0, def?.widthPadding ?? 0) | 0,
        };
    }

    ensureActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        serverId: number,
    ): ActorHealthBarsState {
        return ensureActorHealthBars(this.typedHost, map, serverId);
    }

    healthBarPut(bar: HealthBarBarState, update: HealthBarUpdateState): void {
        healthBarPut(this.typedHost, bar, update);
    }

    healthBarGet(bar: HealthBarBarState, clientCycle: number): HealthBarUpdateState | undefined {
        return healthBarGet(this.typedHost, bar, clientCycle);
    }

    actorAddHealthBar(
        state: ActorHealthBarsState,
        defId: number,
        update: HealthBarUpdateState,
    ): void {
        actorAddHealthBar(this.typedHost, state, defId, update);
    }

    actorRemoveHealthBar(state: ActorHealthBarsState, defId: number): void {
        actorRemoveHealthBar(this.typedHost, state, defId);
    }

    trimActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        tick: number,
        opts: { kind: "player" | "npc" },
    ): void {
        trimActorHealthBars(this.typedHost, map, tick, opts);
    }

    trimHealthBars(tick: number): void {
        this.trimActorHealthBars(this.playerHealthBars, tick, { kind: "player" });
        this.trimActorHealthBars(this.npcHealthBars, tick, { kind: "npc" });
    }

    makeActorGroupKey(isNpc: boolean, serverId: number): number {
        return makeActorGroupKey(this.typedHost, isNpc, serverId);
    }

    appendPlayerOverheadText(
        index: number,
        output: OverheadTextEntry[],
        maxEntries: number,
        playerDefaultHeightTiles: number | undefined,
    ): void {
        appendPlayerOverheadText(
            this.typedHost,
            index,
            output,
            maxEntries,
            playerDefaultHeightTiles,
        );
    }

    appendActorHealthBars(
        map: Map<number, ActorHealthBarsState>,
        serverId: number,
        kind: "player" | "npc",
        worldX: number,
        worldZ: number,
        plane: number,
        footprintRadius: number,
        baseHeightTiles: number,
        output: HealthBarEntry[],
        clientCycle: number,
        maxOutput: number,
    ): void {
        appendActorHealthBars(
            this.typedHost,
            map,
            serverId,
            kind,
            worldX,
            worldZ,
            plane,
            footprintRadius,
            baseHeightTiles,
            output,
            clientCycle,
            maxOutput,
        );
    }

    mapOverheadColor(rawColor: number | undefined): number {
        return mapOverheadColor(this.typedHost, rawColor);
    }

    resolveModIcon(modIcon: number | undefined): number | undefined {
        return resolveModIcon(this.typedHost, modIcon);
    }

    getSequenceVerticalOffsetTiles(seqId: number | undefined): number {
        return getSequenceVerticalOffsetTiles(this.typedHost, seqId);
    }

    resolvePlayerAnimationHeightOffsetTiles(index: number): number {
        return resolvePlayerAnimationHeightOffsetTiles(this.typedHost, index);
    }

    resolvePlayerLogicalHeightTiles(index: number, fallback?: number): number {
        return resolvePlayerLogicalHeightTiles(this.typedHost, index, fallback);
    }

    resolvePlayerHitsplatOffset(index: number, fallback?: number): number {
        return resolvePlayerHitsplatOffset(this.typedHost, index, fallback);
    }

    resolvePlayerHeadIconOffset(index: number, fallback?: number): number {
        return resolvePlayerHeadIconOffset(this.typedHost, index, fallback);
    }

    computeOverheadAlpha(entry: OverheadTextEntry): number {
        return computeOverheadAlpha(this.typedHost, entry);
    }

    getNpcFootprintRadius(npcTypeId: number | undefined): number {
        return getNpcFootprintRadius(this.typedHost, npcTypeId);
    }

    getEffectiveNpcType(npcTypeId: number) {
        return getEffectiveNpcType(this.typedHost, npcTypeId);
    }

    shouldRenderPlayerIndex(pid: number): boolean {
        const renderSelf = this.osrsClient.renderSelf !== false;
        const controlledServerId = this.osrsClient.controlledPlayerServerId | 0;
        const controlledPid =
            controlledServerId > 0
                ? this.osrsClient.playerEcs.getIndexForServerId(controlledServerId)
                : undefined;
        if (!renderSelf && controlledPid !== undefined && (pid | 0) === (controlledPid | 0)) {
            return false;
        }
        return !this.osrsClient.playerEcs.getIsHidden(pid | 0);
    }

    resolveNpcMovementSequenceIds(ecs: unknown, ecsId: number) {
        return resolveNpcMovementSequenceIds(this.typedHost, ecs as never, ecsId);
    }

    shouldLayerNpcMovementSequence(
        actionSeqId: number,
        movementSeqId: number,
        idleSeqId: number,
    ): boolean {
        return shouldLayerNpcMovementSequence(this.typedHost, actionSeqId, movementSeqId, idleSeqId);
    }

    getInteractNpcModelLoader() {
        if (!this.interactNpcModelLoader) {
            this.interactNpcModelLoader = getInteractNpcModelLoader(this.typedHost);
        }
        return this.interactNpcModelLoader;
    }

    resolveNpcHighlightTargetFromServerId(serverId: number) {
        return resolveNpcHighlightTargetFromServerId(this.typedHost, serverId);
    }

    buildModelTrianglePoints(
        model: Model,
        mapVertex: (index: number) => { x: number; y: number; z: number },
    ) {
        return buildModelTrianglePoints(this.typedHost, model, mapVertex);
    }

    // ── Map sampling (same math as the WebGL helpers, reading WebGPUMapSquare's public data) ─

    getPreferredMapForWorldTile(tileX: number, tileY: number): WebGPUMapSquare | undefined {
        return this.mapManager.getMapForWorldTile(tileX, tileY);
    }

    getMapLocalTile(
        map: WebGPUMapSquare,
        tileX: number,
        tileY: number,
    ): { x: number; y: number } | undefined {
        const span = map.getLocalTileSpan?.() ?? 0;
        const localX = (tileX | 0) - (map.getRenderBaseTileX?.() ?? map.mapX * Scene.MAP_SQUARE_SIZE);
        const localY = (tileY | 0) - (map.getRenderBaseTileY?.() ?? map.mapY * Scene.MAP_SQUARE_SIZE);
        if (localX < 0 || localY < 0 || localX >= span || localY >= span) return undefined;
        return { x: localX | 0, y: localY | 0 };
    }

    sampleHeightAtExactPlane(worldX: number, worldZ: number, plane: number): number {
        const map = this.getPreferredMapForWorldTile(Math.floor(worldX), Math.floor(worldZ));
        return map ? map.sampleHeightAtExactPlane(worldX, worldZ, plane) : 0;
    }

    getTileHeightAtPlane(worldX: number, worldY: number, plane: number): number {
        return this.sampleHeightAtExactPlane(worldX, worldY, plane);
    }

    getBridgedTileHeight(worldX: number, worldY: number, plane: number): number {
        return getBridgedTileHeight(this.typedHost, worldX, worldY, plane);
    }

    getMinTileHeightInRadius(worldX: number, worldZ: number, plane: number, radius: number): number {
        return getMinTileHeightInRadius(this.typedHost, worldX, worldZ, plane, radius);
    }

    getHeightSamplePlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return getHeightSamplePlaneForTile(this.typedHost, tileX, tileY, basePlane);
    }

    getEffectivePlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return getEffectivePlaneForTile(this.typedHost, tileX, tileY, basePlane);
    }

    getOccupancyPlaneForTile(tileX: number, tileY: number, basePlane: number): number {
        return getOccupancyPlaneForTile(this.typedHost, tileX, tileY, basePlane);
    }

    getTileRenderFlagAt(level: number, tileX: number, tileY: number): number {
        return getTileRenderFlagAt(this.typedHost, level, tileX, tileY);
    }

    isBridgeSurfaceTile(tileX: number, tileY: number, plane: number): boolean {
        return isBridgeSurfaceTile(this.typedHost, tileX, tileY, plane);
    }

    worldToScreen(x: number, y: number, z: number): number[] | Float32Array | undefined {
        return worldToScreen(this.typedHost, x, y, z);
    }

    getCollisionFlagAt(): number {
        // WebGPUMapSquare does not surface collision maps yet; callers treat 0 as walkable.
        return 0;
    }

    getPlayerRawPlane(): number {
        const idx = this.getControlledPlayerEcsIndex();
        return idx !== undefined ? this.osrsClient.playerEcs.getLevel(idx) | 0 : 0;
    }

    getPlayerBasePlane(): number {
        return this.getPlayerRawPlane();
    }

    getPlayerTileXY(): { x: number; y: number } {
        const idx = this.getControlledPlayerEcsIndex();
        if (idx !== undefined) {
            const pe = this.osrsClient.playerEcs;
            return { x: (pe.getX(idx) | 0) >> 7, y: (pe.getY(idx) | 0) >> 7 };
        }
        const camera = this.osrsClient.camera;
        return { x: Math.floor(camera.getPosX()), y: Math.floor(camera.getPosZ()) };
    }

    getControlledPlayerEcsIndex(): number | undefined {
        const pe = this.osrsClient.playerEcs;
        const controlledId = this.osrsClient.controlledPlayerServerId | 0;
        if (controlledId > 0) {
            try {
                const idx = pe.getIndexForServerId(controlledId);
                if (idx !== undefined) return idx | 0;
            } catch {}
        }
        try {
            if ((pe.size?.() ?? 0) > 0) return 0;
        } catch {}
        return undefined;
    }

    // ── Interaction host (checkInteractions / SceneRaycaster) ──────────────────────────────

    /** Hover + world interaction pass, run every frame before entry population (WebGL order). */
    updateInteractionFrame(): void {
        // As WebGL's frame does: plugins (the backquote crosshair) move the interaction point
        // first, so hover, the mouseover text and clicks use it rather than a pointer-locked mouse.
        this.osrsClient.clientPlugins.updateInteractionPointer(this.osrsClient.camera);
        if (!this.osrsClient.isLoggedIn()) return;
        try {
            updateHoveredTileViaHost(this.typedHost);
        } catch (error) {
            console.warn("[webgpu] updateHoveredTile failed", error);
        }
        try {
            checkInteractionsViaHost(this.typedHost);
        } catch (error) {
            console.warn("[webgpu] checkInteractions failed", error);
        }
    }

    computeTileAt(mouseX: number, mouseY: number) {
        return computeTileAtViaHost(this.typedHost, mouseX, mouseY);
    }

    computeTerrainTileAt(mouseX: number, mouseY: number) {
        return computeTerrainTileAtViaHost(this.typedHost, mouseX, mouseY);
    }

    screenToRay(mouseX: number, mouseY: number): Ray | null {
        return screenToRayViaHost(this.typedHost, mouseX, mouseY);
    }

    toGLClickXY(evt?: MouseEvent): { sx: number; sy: number } {
        return toGLClickXYViaHost(this.typedHost, evt);
    }

    toCssEvent(
        gx?: number,
        gy?: number,
        frameCount?: number,
    ): { clientX: number; clientY: number } | undefined {
        return toCssEventViaHost(this.typedHost, gx, gy, frameCount);
    }

    isMouseInUIRegion(mx: number, my: number): boolean {
        return isMouseInUIRegionViaHost(this.typedHost, mx, my);
    }

    intersectTerrainPickTriangle(
        ray: Ray,
        vertices: Float32Array,
        vertexOffset: number,
        baseX: number,
        baseZ: number,
    ): number | undefined {
        return intersectTerrainPickTriangleViaHost(
            this.typedHost,
            ray,
            vertices,
            vertexOffset,
            baseX,
            baseZ,
        );
    }

    /**
     * Port of getWorldEntityAdjustedTerrainRay (render/worldEntity2.ts): a ray that hits the sea
     * is moved into a deck map's own coordinates before its pick triangles are tested.
     */
    getWorldEntityAdjustedTerrainRay(ray: Ray, map?: unknown): Ray {
        if (!map) return ray;
        const deck = this.renderer.worldEntityForMap(map as WebGPUMapSquare);
        if (!deck) return ray;

        const viewMatrix = this.osrsClient.camera?.viewMatrix as Float32Array | undefined;
        if (!viewMatrix) return ray;

        const weInv = mat4.invert(mat4.create(), deck.transform);
        if (!weInv) return ray;
        const viewInv = mat4.invert(mat4.create(), viewMatrix);
        if (!viewInv) return ray;

        const transformInv = mat4.create();
        mat4.multiply(transformInv, weInv, viewMatrix);
        mat4.multiply(transformInv, viewInv, transformInv);

        const newOrigin = vec3.transformMat4(vec3.create(), ray.origin, transformInv);
        const farPoint = vec3.scaleAndAdd(vec3.create(), ray.origin, ray.direction, 1.0);
        const newFar = vec3.transformMat4(vec3.create(), farPoint, transformInv);
        const newDir = vec3.subtract(vec3.create(), newFar, newOrigin);
        vec3.normalize(newDir, newDir);
        return new Ray(newOrigin, newDir);
    }

    getRoofPlaneLimit(): number {
        return computeWebGPURoofPlaneLimit(this.renderer);
    }

    getNpcWorldTile(ecsId: number): { x: number; y: number } {
        return getNpcWorldTileViaHost(this.typedHost, ecsId);
    }

    getLocIdsAtTileAllLevels(
        tileX: number,
        tileY: number,
    ): { id: number; level: number; typeRot?: number }[] {
        return getLocIdsAtTileAllLevelsViaHost(this.typedHost, tileX, tileY);
    }

    findNearestLocTile(
        locId: number,
        tileX: number,
        tileY: number,
        basePlane: number,
        maxRadius?: number,
    ): { tileX: number; tileY: number; plane: number; typeRot?: number } | undefined {
        return findNearestLocTileViaHost(this.typedHost, locId, tileX, tileY, basePlane, maxRadius);
    }

    resolveLocInteractionTile(
        locId: number,
        approx: { tileX: number; tileY: number; plane?: number },
    ): { tileX: number; tileY: number; plane?: number; typeRot?: number } {
        return resolveLocInteractionTileViaHost(this.typedHost, locId, approx);
    }

    resolveLocTypeRotAtTile(
        locId: number,
        tileX: number,
        tileY: number,
        plane: number,
    ): number | undefined {
        return resolveLocTypeRotAtTileViaHost(this.typedHost, locId, tileX, tileY, plane);
    }

    getLocSize(locId: number): { sizeX: number; sizeY: number } | undefined {
        return getLocSizeViaHost(this.typedHost, locId);
    }

    getLocalPlayerTile(): { x: number; y: number } | undefined {
        return getLocalPlayerTileViaHost(this.typedHost);
    }

    isLocalPlayerAdjacentToLoc(locId: number, tile: { tileX: number; tileY: number }): boolean {
        return isLocalPlayerAdjacentToLocViaHost(this.typedHost, locId, tile);
    }

    hasActiveDestinationMarker(): boolean {
        return (ClientState.destinationX | 0) !== 0 || (ClientState.destinationY | 0) !== 0;
    }

    resolveLocHighlightTargetFromEntry(
        entry:
            | Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY">
            | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): LocHighlightTarget | undefined {
        return resolveLocHighlightTargetFromEntryViaHost(this.typedHost, entry, fallbackTile);
    }

    resolveNpcHighlightTargetFromEntry(
        entry:
            | Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY">
            | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): NpcHighlightTarget | undefined {
        return resolveNpcHighlightTargetFromEntryViaHost(this.typedHost, entry, fallbackTile);
    }

    resolveInteractHighlightTargetFromEntry(
        entry:
            | Pick<SimpleMenuEntry, "targetType" | "targetId" | "mapX" | "mapY">
            | undefined,
        fallbackTile?: { tileX: number; tileY: number; plane?: number },
    ): InteractHighlightTarget | undefined {
        return resolveInteractHighlightTargetFromEntryViaHost(
            this.typedHost,
            entry,
            fallbackTile,
        );
    }

    clearInteractHighlightActiveTarget(): void {
        clearInteractHighlightActiveTargetViaHost(this.typedHost);
    }

    clearInteractHighlightHoverTarget(): void {
        clearInteractHighlightHoverTargetViaHost(this.typedHost);
    }

    updateInteractHighlightHoverTarget(simpleEntries: SimpleMenuEntry[]): void {
        updateInteractHighlightHoverTargetViaHost(this.typedHost, simpleEntries);
    }

    onInteractHighlightEntryInvoked(
        entry: SimpleMenuEntry | undefined,
        clickedTile?: { tileX: number; tileY: number; plane?: number },
    ): void {
        onInteractHighlightEntryInvokedViaHost(this.typedHost, entry, clickedTile);
    }

    syncInteractHighlightActiveTargetFromLocalInteraction(): void {
        syncInteractHighlightActiveTargetFromLocalInteractionViaHost(this.typedHost);
    }

    resolveInteractHighlightTargetFromLocalInteraction(): InteractHighlightTarget | undefined {
        return resolveInteractHighlightTargetFromLocalInteractionViaHost(this.typedHost);
    }

    maybeExpireInteractHighlightTarget(): void {
        maybeExpireInteractHighlightTargetViaHost(this.typedHost);
    }

    isSameInteractHighlightTarget(
        a: InteractHighlightTarget | undefined,
        b: InteractHighlightTarget | undefined,
    ): boolean {
        return isSameInteractHighlightTargetViaHost(this.typedHost, a, b);
    }

    isLocHighlightTargetStillPresent(target: LocHighlightTarget): boolean {
        return isLocHighlightTargetStillPresentViaHost(this.typedHost, target);
    }

    getInteractHighlightDrawTargets(): ReadonlyArray<InteractHighlightDrawTarget> {
        return getInteractHighlightDrawTargetsViaHost(this.typedHost);
    }

    buildHighlightTrianglePoints(
        target: InteractHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        return buildHighlightTrianglePointsViaHost(this.typedHost, target);
    }

    buildLocModelHighlightTriangles(
        target: LocHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        return buildLocModelHighlightTrianglesViaHost(this.typedHost, target);
    }

    buildNpcModelHighlightTriangles(
        target: NpcHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined {
        return buildNpcModelHighlightTrianglesViaHost(this.typedHost, target);
    }

    getInteractLocModelLoader(): LocModelLoader | undefined {
        if (!this.interactLocModelLoader) {
            this.interactLocModelLoader = getInteractLocModelLoaderViaHost(this.typedHost);
        }
        return this.interactLocModelLoader;
    }

    hasNoVisibleFaces(model: Model): boolean {
        return hasNoVisibleFacesViaHost(this.typedHost, model);
    }

    findVisualProxyModel(
        locModelLoader: LocModelLoader,
        target: LocHighlightTarget,
        modelType: number,
        modelRotation: number,
    ): Model | undefined {
        return findVisualProxyModelViaHost(
            this.typedHost,
            locModelLoader,
            target,
            modelType,
            modelRotation,
        );
    }

    spawnClickCross(
        tile: { tileX: number; tileY: number; plane?: number } | undefined,
        xy: { sx: number; sy: number },
        color: "red" | "yellow",
    ): void {
        spawnClickCrossViaHost(this.typedHost, tile, xy, color);
    }

    performWorldEntryAction(
        e: OsrsMenuEntry,
        orig: ((entry?: unknown, evt?: MouseEvent, ctx?: unknown) => void) | undefined,
        evt?: MouseEvent,
        tileForMenu?: { tileX: number; tileY: number; plane?: number },
        menuCtx?: MenuClickContext,
    ): void {
        performWorldEntryActionViaHost(this.typedHost, e, orig, evt, tileForMenu, menuCtx);
    }

    buildSimpleMenuEntries(
        entries: OsrsMenuEntry[],
        opts: {
            shouldFreeze: boolean;
            toCssEvent: (gx?: number, gy?: number) => { clientX: number; clientY: number } | undefined;
        },
    ): SimpleMenuEntry[] {
        return buildSimpleMenuEntriesViaHost(this.typedHost, entries, opts);
    }

    // ── Frame population ────────────────────────────────────────────────────────────────────

    buildUpdateArgs(): OverlayUpdateArgs {
        let args = this.args;
        if (!args) {
            args = {
                time: 0,
                delta: 0,
                resolution: { width: 0, height: 0 },
                state: {
                    hoverEnabled: false,
                    hoverTile: undefined,
                    playerLevel: 0,
                    playerRawLevel: 0,
                    destTile: undefined,
                    currentTile: undefined,
                    tileHighlights: undefined,
                    clientTickPhase: 0,
                    playerWorldX: undefined,
                    playerWorldZ: undefined,
                    actorServerTiles: undefined,
                    hitsplats: undefined,
                    healthBars: undefined,
                    overheadTexts: undefined,
                    overheadPrayers: undefined,
                    groundItems: undefined,
                    gameCycle: 0,
                    actor2dStacks: this.actor2dStacks,
                },
                helpers: {
                    getTileHeightAtPlane: (x, y, plane) => this.getTileHeightAtPlane(x, y, plane),
                    getMinTileHeightInRadius: (x, z, plane, radius) =>
                        this.getMinTileHeightInRadius(x, z, plane, radius),
                    sampleHeightAtExactPlane: (x, z, plane) =>
                        this.sampleHeightAtExactPlane(x, z, plane),
                    getHeightSamplePlaneForTile: (x, y, plane) =>
                        this.getHeightSamplePlaneForTile(x, y, plane),
                    getEffectivePlaneForTile: (x, y, plane) =>
                        this.getEffectivePlaneForTile(x, y, plane),
                    getOccupancyPlaneForTile: (x, y, plane) =>
                        this.getOccupancyPlaneForTile(x, y, plane),
                    getTileRenderFlagAt: (level, x, y) => this.getTileRenderFlagAt(level, x, y),
                    isBridgeSurfaceTile: (x, y, plane) => this.isBridgeSurfaceTile(x, y, plane),
                    worldToScreen: (x, y, z) => this.worldToScreen(x, y, z),
                    getCollisionFlagAt: () => this.getCollisionFlagAt(),
                },
            };
            this.args = args;
        }
        return args;
    }

    /**
     * Port of the entry population in render/render/frame/render.ts (lines ~866-1386) plus the
     * post-present hover/actor-server-tile state. Runs once per frame before the overlays lay
     * out their quads.
     */
    populateFrame(timeMs: number, deltaMs: number): void {
        const osrsClient = this.osrsClient;
        const clientCycle = getClientCycle() | 0;
        this.timeMs = timeMs;
        this.clientCycle = clientCycle;
        this.gameCycle = clientCycle;

        this.resetHealthBarOutput();
        this.resetHitsplatOutput();
        this.resetOverheadTextOutput();
        this.resetOverheadPrayerOutput();
        this.actor2dStacks.clear();

        let playerWorldX: number | undefined;
        let playerWorldZ: number | undefined;
        let playerLevel = resolveGroundItemStackPlane(this.getPlayerRawPlane() | 0);
        let playerRawLevel = this.getPlayerRawPlane() | 0;
        let playerAnchorIdx = 0;

        const playerFrameCount: number | undefined = undefined;
        const playerDefaultHeightTiles = PLAYER_DEFAULT_HEIGHT_FALLBACK;

        const hitsplats = this.hitsplatOutput;
        const healthBars = this.healthBarOutput;
        const overheadTexts = this.overheadTextOutput;
        const overheadPrayers = this.overheadPrayerOutput;
        const hitsplatMaxEntries = RENDER_CONSTANTS.MAX_HIT_ENTRIES;
        const healthBarMaxEntries = 256;
        const overheadTextMaxEntries = 256;
        const overheadPrayerMaxEntries = 256;
        const groundOverlayMaxEntries = 40;
        const groundOverlayRadius = 12;

        try {
            const peHs = osrsClient.playerEcs;
            const nHs = peHs.size?.() ?? 0;
            if (nHs > 0) {
                const controlledId = osrsClient.controlledPlayerServerId | 0;
                const controlledIdx = peHs.getIndexForServerId(controlledId);
                playerAnchorIdx = controlledIdx !== undefined ? controlledIdx : 0;
                if (this.shouldRenderPlayerIndex(playerAnchorIdx)) {
                    const px = peHs.getX(playerAnchorIdx) | 0;
                    const py = peHs.getY(playerAnchorIdx) | 0;
                    playerWorldX = px / 128.0;
                    playerWorldZ = py / 128.0;
                    playerLevel = peHs.getLevel(playerAnchorIdx) | 0;
                    playerRawLevel = playerLevel;
                }
            }
        } catch {}

        if (playerWorldX != null && playerWorldZ != null && hitsplats.length < hitsplatMaxEntries) {
            const localPlayerHeightFallback =
                osrsClient.playerEcs.getDefaultHeightTiles?.(playerAnchorIdx) ??
                playerDefaultHeightTiles;
            const hitsplatOffset = this.resolvePlayerHitsplatOffset(
                playerAnchorIdx,
                localPlayerHeightFallback,
            );
            const healthBarOffset =
                this.resolvePlayerLogicalHeightTiles(playerAnchorIdx, localPlayerHeightFallback) +
                15 / 128;
            const playerServerId = this.getEffectiveControlledPlayerId();
            const state =
                playerServerId > 0 ? this.playerHitsplats.get(playerServerId) : undefined;
            if (state) {
                for (let slot = 0; slot < 4 && hitsplats.length < hitsplatMaxEntries; slot++) {
                    const animProgress = this.getHitsplatVisibility(state, slot, clientCycle);
                    if (animProgress === undefined) continue;
                    const entry = this.acquireHitsplatEntry();
                    entry.worldX = playerWorldX;
                    entry.worldZ = playerWorldZ;
                    entry.plane = playerLevel;
                    entry.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
                    entry.heightOffsetTiles = hitsplatOffset;
                    entry.damage = state.hitSplatValues[slot] | 0;
                    entry.count = 1;
                    entry.color = undefined;
                    entry.scale = RENDER_CONSTANTS.HITSPLAT_PLAYER_SCALE;
                    entry.variant = slot & 3;
                    entry.style = state.hitSplatTypes[slot] | 0;
                    entry.type2 = state.hitSplatTypes2[slot] | 0;
                    entry.damage2 = state.hitSplatValues2[slot] | 0;
                    entry.animProgress = animProgress;
                    hitsplats.push(entry);
                }
            }
            if (playerServerId > 0) {
                this.appendActorHealthBars(
                    this.playerHealthBars,
                    playerServerId,
                    "player",
                    playerWorldX,
                    playerWorldZ,
                    playerLevel,
                    RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS,
                    healthBarOffset,
                    healthBars,
                    clientCycle,
                    healthBarMaxEntries,
                );
            }
        }

        const localPlayerTextIdx = this.getControlledPlayerEcsIndex();
        try {
            const pe = osrsClient.playerEcs;
            const count = pe.size?.() ?? 0;
            for (let i = 0; i < count; i++) {
                if (i === localPlayerTextIdx) continue;
                this.appendPlayerOverheadText(i, overheadTexts, overheadTextMaxEntries, playerDefaultHeightTiles);
            }
        } catch {}

        try {
            const ne = osrsClient.npcEcs;
            ne.forEachActive((ecsId: number) => {
                if (overheadTexts.length >= overheadTextMaxEntries) return;
                const chatState = ne.getOverheadText(ecsId);
                if (!chatState) return;
                const text = chatState.text;
                if (!text || text.length === 0) return;
                const localX = ne.getX(ecsId) | 0;
                const localY = ne.getY(ecsId) | 0;
                const mid = ne.getMapId(ecsId) | 0;
                const mapX = (mid >> 8) & 0xff;
                const mapY = mid & 0xff;
                const worldX = mapX * 64 + localX / 128.0;
                const worldZ = mapY * 64 + localY / 128.0;
                const plane = ne.getLevel(ecsId) | 0;
                const overhead = this.acquireOverheadTextEntry();
                overhead.worldX = worldX;
                overhead.worldZ = worldZ;
                overhead.plane = plane;
                overhead.text = text;
                overhead.color = this.mapOverheadColor(0);
                overhead.colorId = 0;
                overhead.effect = 0;
                overhead.modIcon = undefined;
                overhead.pattern = undefined;
                const duration = 100;
                const remaining = Math.max(0, Math.min(duration, chatState.remaining));
                overhead.duration = duration;
                overhead.remaining = remaining;
                overhead.life = this.computeOverheadAlpha(overhead);
                const npcTypeId = ne.getNpcTypeId(ecsId) | 0;
                const npcHeight = npcTypeId > 0 ? this.getNpcDefaultHeight(npcTypeId) : 200;
                overhead.footprintRadius = this.getNpcFootprintRadius(npcTypeId);
                overhead.groupKey = this.makeActorGroupKey(true, ne.getServerId(ecsId) | 0);
                overhead.heightOffsetTiles = npcHeight / 128.0;
                overheadTexts.push(overhead);
            });
        } catch {}

        try {
            if (localPlayerTextIdx !== undefined) {
                this.appendPlayerOverheadText(
                    localPlayerTextIdx,
                    overheadTexts,
                    overheadTextMaxEntries,
                    playerDefaultHeightTiles,
                );
            }
        } catch {}

        // The attack timer plugin's countdown, with the local player's text (render.ts 1043-1052).
        try {
            appendAttackTimerOverhead(
                this.typedHost,
                localPlayerTextIdx,
                overheadTexts,
                overheadTextMaxEntries,
                playerDefaultHeightTiles,
            );
        } catch {}

        try {
            const pe = osrsClient.playerEcs;
            const count = pe.size?.() ?? 0;
            if (count > 0) {
                for (let i = 0; i < count; i++) {
                    if (overheadPrayers.length >= overheadPrayerMaxEntries) break;
                    if (!this.shouldRenderPlayerIndex(i)) continue;
                    const headIconPk = pe.getHeadIconPk(i);
                    const headIconPrayer = pe.getHeadIconPrayer(i);
                    if (headIconPk < 0 && headIconPrayer < 0) continue;

                    const px = pe.getX(i) | 0;
                    const py = pe.getY(i) | 0;
                    const worldX = px / 128.0;
                    const worldZ = py / 128.0;
                    const plane = pe.getLevel(i) | 0;

                    const entry = this.acquireOverheadPrayerEntry();
                    entry.worldX = worldX;
                    entry.worldZ = worldZ;
                    entry.plane = plane;
                    entry.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
                    entry.groupKey = this.makeActorGroupKey(
                        false,
                        pe.getServerIdForIndex?.(i) ?? 0,
                    );
                    entry.headIconPk = headIconPk;
                    entry.headIconPrayer = headIconPrayer;
                    entry.heightOffsetTiles = this.resolvePlayerHeadIconOffset(
                        i,
                        playerDefaultHeightTiles,
                    );
                    overheadPrayers.push(entry);
                }
            }
        } catch {}

        try {
            const ne = osrsClient.npcEcs;
            ne.forEachActive((ecsId: number) => {
                if (overheadPrayers.length >= overheadPrayerMaxEntries) return;
                if (!this.isNpcMapVisible(ecsId)) return;
                const type = this.getEffectiveNpcType(ne.getNpcTypeId(ecsId) | 0);
                const serverIcons = osrsClient.npcHeadIcons?.get(ne.getServerId(ecsId) | 0);
                const archives = type?.headIconSpriteIds;
                const sprites = type?.headIconSpriteIndices;
                if (!serverIcons && (!archives || !sprites)) return;

                const npcHeadIcons = (
                    serverIcons ??
                    archives!.map((archiveId, index) => ({
                        archiveId,
                        spriteId: sprites![index] ?? -1,
                    }))
                ).filter((icon) => icon.archiveId >= 0 && icon.spriteId >= 0);
                if (npcHeadIcons.length === 0) return;

                const mid = ne.getMapId(ecsId) | 0;
                const npcTypeId = ne.getNpcTypeId(ecsId) | 0;
                const entry = this.acquireOverheadPrayerEntry();
                entry.worldX = ((mid >> 8) & 0xff) * 64 + (ne.getX(ecsId) | 0) / 128.0;
                entry.worldZ = (mid & 0xff) * 64 + (ne.getY(ecsId) | 0) / 128.0;
                entry.plane = ne.getLevel(ecsId) | 0;
                entry.footprintRadius = this.getNpcFootprintRadius(npcTypeId);
                entry.groupKey = this.makeActorGroupKey(true, ne.getServerId(ecsId) | 0);
                entry.heightOffsetTiles = this.getNpcDefaultHeight(npcTypeId) / 128.0;
                entry.headIconPk = -1;
                entry.headIconPrayer = -1;
                entry.npcHeadIcons = npcHeadIcons;
                overheadPrayers.push(entry);
            });
        } catch {}

        try {
            const pe = osrsClient.playerEcs;
            const count = pe.size?.() ?? 0;
            if (count > 0 && this.playerHitsplats.size > 0) {
                const controlledId = this.getEffectiveControlledPlayerId();
                for (let i = 0; i < count; i++) {
                    if (
                        hitsplats.length >= hitsplatMaxEntries &&
                        healthBars.length >= healthBarMaxEntries
                    ) {
                        break;
                    }
                    if (!this.shouldRenderPlayerIndex(i)) continue;
                    const serverId = pe.getServerIdForIndex?.(i);
                    if (!serverId || serverId === controlledId) continue;
                    const state = this.playerHitsplats.get(serverId);
                    if (!state) continue;

                    const px = pe.getX(i) | 0;
                    const py = pe.getY(i) | 0;
                    const worldX = px / 128.0;
                    const worldZ = py / 128.0;
                    const plane = pe.getLevel(i) | 0;
                    const playerHeightFallback = pe.getDefaultHeightTiles?.(i) ?? 200 / 128;
                    const hitsplatOffset = this.resolvePlayerHitsplatOffset(i, playerHeightFallback);
                    const healthBarOffset =
                        this.resolvePlayerLogicalHeightTiles(i, playerHeightFallback) + 15 / 128;

                    for (let slot = 0; slot < 4 && hitsplats.length < hitsplatMaxEntries; slot++) {
                        const animProgress = this.getHitsplatVisibility(state, slot, clientCycle);
                        if (animProgress === undefined) continue;
                        const entry = this.acquireHitsplatEntry();
                        entry.worldX = worldX;
                        entry.worldZ = worldZ;
                        entry.plane = plane;
                        entry.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
                        entry.heightOffsetTiles = hitsplatOffset;
                        entry.damage = state.hitSplatValues[slot] | 0;
                        entry.count = 1;
                        entry.color = undefined;
                        entry.scale = RENDER_CONSTANTS.HITSPLAT_PLAYER_SCALE;
                        entry.variant = slot & 3;
                        entry.style = state.hitSplatTypes[slot] | 0;
                        entry.type2 = state.hitSplatTypes2[slot] | 0;
                        entry.damage2 = state.hitSplatValues2[slot] | 0;
                        entry.animProgress = animProgress;
                        hitsplats.push(entry);
                    }

                    if (serverId > 0 && healthBars.length < healthBarMaxEntries) {
                        this.appendActorHealthBars(
                            this.playerHealthBars,
                            serverId,
                            "player",
                            worldX,
                            worldZ,
                            plane,
                            RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS,
                            healthBarOffset,
                            healthBars,
                            clientCycle,
                            healthBarMaxEntries,
                        );
                    }
                }
            }
        } catch {}

        if (this.npcHitsplats.size > 0 || this.npcHealthBars.size > 0) {
            try {
                const npcEcs = osrsClient.npcEcs;
                npcEcs.forEachActive((ecsId: number) => {
                    if (
                        hitsplats.length >= hitsplatMaxEntries &&
                        healthBars.length >= healthBarMaxEntries
                    ) {
                        return;
                    }
                    if (!this.isNpcMapVisible(ecsId)) return;
                    const localX = npcEcs.getX(ecsId) | 0;
                    const localY = npcEcs.getY(ecsId) | 0;
                    const serverId = npcEcs.getServerId(ecsId) | 0;
                    if (serverId <= 0) return;
                    const state = this.npcHitsplats.get(serverId);
                    const hb = this.npcHealthBars.get(serverId);
                    const hasHealth = !!hb && hb.bars.length > 0;
                    if (!hasHealth && !state) return;
                    const npcMapId = npcEcs.getMapId(ecsId) | 0;
                    const npcMapX = (npcMapId >> 8) & 0xff;
                    const npcMapY = npcMapId & 0xff;
                    const baseWorldX = npcMapX * 64 + localX / 128.0;
                    const baseWorldZ = npcMapY * 64 + localY / 128.0;
                    const plane = npcEcs.getLevel(ecsId) | 0;
                    const npcTypeId = npcEcs.getNpcTypeId?.(ecsId);
                    const footprintRadius = this.getNpcFootprintRadius(npcTypeId);
                    const overlayAnchor = this.resolveNpcOverlayAnchor(
                        ecsId,
                        baseWorldX,
                        baseWorldZ,
                        npcTypeId,
                    );
                    const worldX = overlayAnchor.worldX;
                    const worldZ = overlayAnchor.worldZ;
                    const hitsplatOffset = overlayAnchor.logicalHeightTiles * 0.5;
                    const healthBarOffset = overlayAnchor.logicalHeightTiles + 15 / 128;
                    if (hasHealth && healthBars.length < healthBarMaxEntries) {
                        this.appendActorHealthBars(
                            this.npcHealthBars,
                            serverId,
                            "npc",
                            worldX,
                            worldZ,
                            plane,
                            footprintRadius,
                            healthBarOffset,
                            healthBars,
                            clientCycle,
                            healthBarMaxEntries,
                        );
                    }
                    if (!state) return;
                    for (let slot = 0; slot < 4 && hitsplats.length < hitsplatMaxEntries; slot++) {
                        const animProgress = this.getHitsplatVisibility(state, slot, clientCycle);
                        if (animProgress === undefined) continue;
                        const entry = this.acquireHitsplatEntry();
                        entry.worldX = worldX;
                        entry.worldZ = worldZ;
                        entry.plane = plane;
                        entry.footprintRadius = footprintRadius;
                        entry.heightOffsetTiles = hitsplatOffset;
                        entry.damage = state.hitSplatValues[slot] | 0;
                        entry.count = 1;
                        entry.color = undefined;
                        entry.scale = RENDER_CONSTANTS.HITSPLAT_NPC_SCALE;
                        entry.variant = slot & 3;
                        entry.style = state.hitSplatTypes[slot] | 0;
                        entry.type2 = state.hitSplatTypes2[slot] | 0;
                        entry.damage2 = state.hitSplatValues2[slot] | 0;
                        entry.animProgress = animProgress;
                        hitsplats.push(entry);
                    }
                });
            } catch {}
        }

        // Ground item labels: player anchor first, camera fallback (render.ts 1341-1386).
        this.groundOverlayEntries = [];
        if (playerWorldX != null && playerWorldZ != null) {
            const overlayEntries = osrsClient.getGroundItemOverlayEntries(
                Math.floor(playerWorldX),
                Math.floor(playerWorldZ),
                playerLevel,
                { radius: groundOverlayRadius, maxEntries: groundOverlayMaxEntries },
            );
            if (overlayEntries.length > 0) {
                this.groundOverlayEntries = overlayEntries;
            } else {
                try {
                    const camX = Math.floor(osrsClient.camera.getPosX());
                    const camY = Math.floor(osrsClient.camera.getPosZ());
                    const camLevel = resolveGroundItemStackPlane(this.getPlayerRawPlane() | 0);
                    const camEntries = osrsClient.getGroundItemOverlayEntries(camX, camY, camLevel, {
                        radius: groundOverlayRadius,
                        maxEntries: groundOverlayMaxEntries,
                    });
                    if (camEntries.length > 0) this.groundOverlayEntries = camEntries;
                } catch {}
            }
        } else {
            try {
                const peHs = osrsClient.playerEcs;
                const idx = peHs.getIndexForServerId(osrsClient.controlledPlayerServerId);
                if (idx !== undefined) {
                    const fallbackX = (peHs.getX(idx) / 128.0) | 0;
                    const fallbackY = (peHs.getY(idx) / 128.0) | 0;
                    const fallbackLevel = peHs.getLevel(idx) | 0;
                    const overlayEntries = osrsClient.getGroundItemOverlayEntries(
                        fallbackX,
                        fallbackY,
                        fallbackLevel,
                        { radius: groundOverlayRadius, maxEntries: groundOverlayMaxEntries },
                    );
                    if (overlayEntries.length > 0) this.groundOverlayEntries = overlayEntries;
                }
            } catch {}
        }

        this.playerWorldX = playerWorldX;
        this.playerWorldZ = playerWorldZ;
        this.playerLevel = playerLevel;
        this.playerRawLevel = playerRawLevel;
        this.playerDefaultHeightTiles = playerDefaultHeightTiles;

        const args = this.buildUpdateArgs();
        args.time = timeMs;
        args.delta = deltaMs;
        args.resolution.width = this.canvas.width;
        args.resolution.height = this.canvas.height;
        args.state.playerLevel = playerLevel;
        args.state.playerRawLevel = playerRawLevel;
        args.state.playerWorldX = playerWorldX;
        args.state.playerWorldZ = playerWorldZ;
        args.state.playerFrameCount = playerFrameCount;
        args.state.gameCycle = clientCycle;
        args.state.hitsplats = hitsplats.length > 0 ? hitsplats : undefined;
        args.state.healthBars = healthBars.length > 0 ? healthBars : undefined;
        args.state.overheadTexts = overheadTexts.length > 0 ? overheadTexts : undefined;
        args.state.overheadPrayers = overheadPrayers.length > 0 ? overheadPrayers : undefined;
        args.state.groundItems =
            this.groundOverlayEntries.length > 0 ? this.groundOverlayEntries : undefined;

        this.populateTileMarkerState(args);
    }

    /**
     * Port of populateTileMarkerOverlayState (render/overlays/scene.ts 233-338): hover/dest/
     * current tiles and native tile highlights for the tile-marker overlay. Hover picking is
     * WebGL-frame-only, so the hover tile comes from osrsClient.hoveredTile when present.
     */
    private populateTileMarkerState(args: OverlayUpdateArgs): void {
        const osrsClient = this.osrsClient;
        const state = args.state;

        state.hoverEnabled = !!osrsClient.hoverOverlayEnabled;
        const hovered = osrsClient.hoveredTile;
        state.hoverTile = hovered
            ? { x: hovered.tileX | 0, y: hovered.tileY | 0, plane: hovered.plane }
            : undefined;
        state.destTile = undefined;
        state.currentTile = undefined;

        let config: TileMarkersPluginConfig | undefined;
        try {
            config = osrsClient.tileMarkersPlugin.getConfig();
        } catch {}

        const destWorldX = ClientState.destinationWorldX | 0;
        const destWorldY = ClientState.destinationWorldY | 0;
        let activeDestX = destWorldX;
        let activeDestY = destWorldY;
        if (activeDestX === 0 && activeDestY === 0) {
            const destLocalX = ClientState.destinationX | 0;
            const destLocalY = ClientState.destinationY | 0;
            if (destLocalX !== 0 || destLocalY !== 0) {
                activeDestX = ClientState.localToWorldX(destLocalX) | 0;
                activeDestY = ClientState.localToWorldY(destLocalY) | 0;
            }
        }
        const hasActiveDestination = activeDestX !== 0 || activeDestY !== 0;

        let nativeTileHighlights: ReturnType<
            typeof osrsClient.tileHighlightManager.getRenderEntries
        > = [];
        try {
            nativeTileHighlights = osrsClient.tileHighlightManager.getRenderEntries();
        } catch {}

        const shouldOwnDestinationTile =
            !!config?.enabled && !!config.showDestinationTile && hasActiveDestination;
        const destinationColor = (config?.destinationTileColor ?? 0) & 0xffffff;
        const defaultNativeDestinationColor = 0xa9a753;
        const visibleTileHighlights = shouldOwnDestinationTile
            ? nativeTileHighlights.filter((highlight) => {
                  if ((highlight.slot | 0) === 4) return false;
                  const color = highlight.colorRgb & 0xffffff;
                  return color !== destinationColor && color !== defaultNativeDestinationColor;
              })
            : nativeTileHighlights;
        state.tileHighlights = visibleTileHighlights.length > 0 ? visibleTileHighlights : undefined;

        if (!config?.enabled) return;

        const nativeHasCurrentTile = visibleTileHighlights.some(
            (highlight) => (highlight.slot | 0) === 3,
        );
        if (config.showDestinationTile && hasActiveDestination) {
            state.destTile = { x: activeDestX, y: activeDestY };
        }
        if (!config.showCurrentTile || nativeHasCurrentTile) return;

        const controlledServerId = osrsClient.controlledPlayerServerId | 0;
        if (controlledServerId <= 0) return;
        const movementState = osrsClient.playerMovementSync?.getState?.(controlledServerId);
        if (!movementState) return;
        const ecsIndex = movementState.ecsIndex | 0;
        if (ecsIndex < 0 || !osrsClient.playerEcs.isMoving(ecsIndex)) return;
        state.currentTile = {
            x: movementState.tileX | 0,
            y: movementState.tileY | 0,
            plane: this.getHeightSamplePlaneForTile(
                movementState.tileX | 0,
                movementState.tileY | 0,
                this.getPlayerRawPlane() | 0,
            ),
        };
    }

    private isNpcMapVisible(ecsId: number): boolean {
        try {
            const mid = this.osrsClient.npcEcs.getMapId(ecsId) | 0;
            const map = this.mapManager.getMap((mid >> 8) & 0xff, mid & 0xff);
            return !!map;
        } catch {
            return false;
        }
    }

    // ── Event registration (registerHitsplat / health bars) ─────────────────────────────────

    registerHitsplat(event: HitsplatEventPayload): void {
        const clientCycle = getClientCycle() | 0;
        const delayCycles =
            typeof event.delayCycles === "number" ? Math.max(0, event.delayCycles | 0) : 0;
        const damage = event.damage | 0;
        const type = typeof event.style === "number" ? event.style | 0 : -1;
        const type2 = typeof event.type2 === "number" ? event.type2 | 0 : -1;
        const damage2 = typeof event.damage2 === "number" ? event.damage2 | 0 : -1;
        const targetId = event.targetId | 0;
        if (event.targetType === "player") {
            if (targetId > 0) {
                const controlledId = this.osrsClient.controlledPlayerServerId | 0;
                if (controlledId <= 0) {
                    this.pendingControlledPlayerServerId = targetId;
                } else if (this.pendingControlledPlayerServerId !== undefined) {
                    this.pendingControlledPlayerServerId = undefined;
                }
            }
            const state = this.ensureHitsplatState(this.playerHitsplats, targetId);
            this.addHitSplatOsrs(state, type, damage, type2, damage2, clientCycle, delayCycles);
        } else {
            const state = this.ensureHitsplatState(this.npcHitsplats, targetId);
            this.addHitSplatOsrs(state, type, damage, type2, damage2, clientCycle, delayCycles);
        }
        this.trimHitsplats(clientCycle);
        this.trimHealthBars(clientCycle);
    }

    registerPlayerHealthBarUpdate(event: {
        serverId: number;
        bar: {
            id: number;
            cycle: number;
            health: number;
            health2: number;
            cycleOffset: number;
            removed?: boolean;
        };
    }): void {
        const serverId = event.serverId | 0;
        if (serverId <= 0) return;
        const bar = event.bar;
        const defId = bar.id | 0;
        const actor = this.playerHealthBars.get(serverId);
        if (bar.removed === true) {
            if (!actor) return;
            this.actorRemoveHealthBar(actor, defId);
            if (actor.bars.length === 0) this.playerHealthBars.delete(serverId);
            return;
        }
        const state = actor ?? this.ensureActorHealthBars(this.playerHealthBars, serverId);
        this.actorAddHealthBar(state, defId, {
            cycle: bar.cycle | 0,
            health: bar.health | 0,
            health2: bar.health2 | 0,
            cycleOffset: bar.cycleOffset | 0,
        });
    }

    registerNpcHealthBarUpdate(event: {
        serverId: number;
        bar: {
            id: number;
            cycle: number;
            health: number;
            health2: number;
            cycleOffset: number;
            removed?: boolean;
        };
    }): void {
        const serverId = event.serverId | 0;
        if (serverId <= 0) return;
        const bar = event.bar;
        const defId = bar.id | 0;
        const actor = this.npcHealthBars.get(serverId);
        if (bar.removed === true) {
            if (!actor) return;
            this.actorRemoveHealthBar(actor, defId);
            if (actor.bars.length === 0) this.npcHealthBars.delete(serverId);
            return;
        }
        const state = actor ?? this.ensureActorHealthBars(this.npcHealthBars, serverId);
        this.actorAddHealthBar(state, defId, {
            cycle: bar.cycle | 0,
            health: bar.health | 0,
            health2: bar.health2 | 0,
            cycleOffset: bar.cycleOffset | 0,
        });
    }

    clearPlayerHealthBars(serverId: number): void {
        this.playerHealthBars.delete(serverId | 0);
    }

    clearNpcHealthBars(serverId: number): void {
        this.npcHealthBars.delete(serverId | 0);
    }

    /** Ground-item stack map keys currently built, keyed by map square id. */
    mapIdForTile(tileX: number, tileY: number): number {
        return getMapSquareId(tileX >> 6, tileY >> 6);
    }

    dispose(): void {
        this.hitsplatPool.length = 0;
        this.healthBarPool.length = 0;
        this.overheadTextPool.length = 0;
        this.overheadPrayerPool.length = 0;
        this.hitsplatOutput.length = 0;
        this.healthBarOutput.length = 0;
        this.overheadTextOutput.length = 0;
        this.overheadPrayerOutput.length = 0;
        this.playerHitsplats.clear();
        this.npcHitsplats.clear();
        this.playerHealthBars.clear();
        this.npcHealthBars.clear();
    }
}
