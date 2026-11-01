import { LocAnimated, type LocFrameSoundHandler } from "../loc/LocAnimated";
import Denque from "denque";
import { mat4, vec3 } from "gl-matrix";

import { isWebGPUSupported } from "../../common/utils/DeviceUtil";
import { GameRenderer } from "../../game/GameRenderer";
import type {
    HitsplatEventPayload,
    LocChangeOptions,
    NpcSpotAnimationEvent,
    RegionReplacementEvent,
    WorldSpotAnimationEvent,
} from "../../game/GameRenderer";
import { OsrsRendererType, WEBGPU } from "../../game/GameRenderers";
import type { IProjectileManager } from "../../game/interfaces/IProjectileManager";
import type { Ray } from "../../game/math/Raycast";
import type { Frustum } from "../../game/Frustum";
import type { OsrsClient } from "../../game/OsrsClient";
import type { PlayerSpotAnimationEvent } from "../../game/sync/PlayerSyncTypes";
import { flushPackets } from "../../network/packet";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import type { MinimapIcon } from "../loader/SdMapData";
import { SdMapData } from "../loader/SdMapData";
import { SdMapDataLoader } from "../loader/SdMapDataLoader";
import { SdMapLoaderInput, snapshotMapInput } from "../loader/SdMapLoaderInput";
import type { WorldEntityAnimator } from "../WorldEntityAnimator";
import { pickSeaPoint, projectDeckToWorld, updateWorldEntityMotion } from "../render/worldEntityMotion";
import { getServerTickPhaseNow } from "../../network/serverConnection/timing";
import { WebGPUMapSquare, type SceneryDrawContext } from "./WebGPUMapSquare";
import { resolveFogRange } from "../RenderDistancePolicy";
import { WorldResources } from "./WorldResources";
import { WebGPUActors } from "./actors/WebGPUActors";
import { WebGPUInstances } from "./instances";
import {
    clearWorldEntities,
    clearWorldEntity,
    clearWorldEntityLocs,
    configureWorldEntityOverlayMap,
    ensureWorldEntityOverlaysLoaded,
    getOverlayMapForEntity,
    getWorldEntityIndexForMapId,
    loadWorldEntityScene,
    scheduleWorldEntityLocRebuild,
    type WorldEntityOverlay,
} from "./worldEntity";
import { environmentAt } from "../render/environment";
import { getCanvasResolutionScale, syncCameraViewportUnitScale } from "../render/quality";
import { getCameraViewportRect } from "../render/viewportRect";
import { GPU_TEXTURE_USAGE, SCENE_DEPTH_FORMAT, SCENE_GROUP, WORLD_TEXTURES_GROUP } from "./bindings";
import { getControlledPlayerEcsIndex, updateFollowCamera } from "./camera";
import { resolveWebGPULodDistance, resolveWebGPURenderDistance, updateWebGPUMapStreaming } from "./frameConfig";
import { FxaaPass } from "./fxaa";
import { SceneMsaaTargets } from "./msaaTargets";
import { WEBGPU_MSAA_SAMPLES } from "./multisample";
import { EditorOverlays } from "./overlays/EditorOverlays";
import { OverlayHost } from "./overlays/OverlayHost";
import { WebGPUOverlays } from "./overlays/WebGPUOverlays";
import { LocUpdates, type LocReloadGroup } from "./locUpdates";
import { getClientCycle } from "../../network/ServerConnection";
import { WebGPUUi } from "./ui/WebGPUUi";
import type { UiRenderMetrics } from "./ui/WebGPUUi";

interface QueuedMap {
    mapData: SdMapData;
    streamGeneration?: number;
    /** LocUpdates reload version the build started at; stale builds are dropped. */
    locVersion?: number;
    /** A door/loc rebuild of the drawn instance scene (applyInstanceScene applies it). */
    instance?: boolean;
}

const SKY_BLEND_PER_FRAME = 0.15;
const MAP_APPLY_BUDGET_MS = 4;
const AUTO_FOG_DEPTH_FACTOR = 0.85;

/**
 * WebGPU backend. Stage 2 renders the main world pass (terrain, locs, doors) over the
 * existing WebGL renderer's game-level shell. Actors, overlays, widgets and the login
 * screen are not ported yet; see docs/webgpu-renderer.md.
 */
export class WebGPURenderer extends GameRenderer<WebGPUMapSquare> {
    /** Animated scenery's frame sounds (windmills, machinery), as the WebGL tick plays them. */
    private readonly locFrameSound: LocFrameSoundHandler = (seqType, frame, at) =>
        this.osrsClient.handleSeqFrameSounds(seqType, frame, { position: { x: at.x, y: at.y, z: at.level * 128 } });
    type: OsrsRendererType = WEBGPU;

    device!: GPUDevice;
    context!: GPUCanvasContext;
    format!: GPUTextureFormat;

    private world?: WorldResources;
    /** Animation Smoothing state the loaded scenery was baked with (syncLocAnimationSmoothing). */
    private smoothLocAnimations?: number;
    /** This frame's roof limit and culling inputs, reused by scene and shadow draws. */
    private frameRoofPlaneLimit = 3;
    private frameScenery?: SceneryDrawContext;
    private depthTexture?: GPUTexture;
    private depthView?: GPUTextureView;
    private depthWidth: number = 0;
    private depthHeight: number = 0;
    /** Offscreen HDR scene target, only when the scene extension declares `sceneColorFormat`. */
    private sceneColorTexture?: GPUTexture;
    private sceneColorView?: GPUTextureView;
    private sceneColorWidth: number = 0;
    private sceneColorHeight: number = 0;
    /** The GPU plugin's anti-aliasing: multisampled world-pass targets, or FXAA on the base path. */
    private msaaTargets?: SceneMsaaTargets;
    private fxaa?: FxaaPass;

    private dataLoader = new SdMapDataLoader();

    // Dynamic world-object state from LOC/REGION packets (same names as WebGLOsrsRenderer, which
    // plugins read). Every map build passes it to the worker, so rebuilt squares include it.
    readonly locOverrides: NonNullable<SdMapLoaderInput["locOverrides"]> = new Map();
    /** Dynamically spawned locs (LOC_ADD_CHANGE), keyed by "x,y,level,shape". */
    readonly addedLocs = new Map<
        string,
        {
            locId: number;
            x: number;
            y: number;
            level: number;
            shape: number;
            rotation: number;
            /** Cache locs this add replaced, so removing it restores them. */
            replacedIds?: number[];
        }
    >();
    readonly locSpawns: NonNullable<SdMapLoaderInput["locSpawns"]> = new Map();
    readonly terrainOverrides: NonNullable<SdMapLoaderInput["terrainOverrides"]> = new Map();
    readonly mapRegionReplacements: NonNullable<SdMapLoaderInput["mapRegionReplacements"]> = new Map();
    /** LOC/REGION packet handling and the map rebuilds they cause (./locUpdates.ts). */
    readonly locUpdates = new LocUpdates(this);
    private mapsToLoad = new Denque<QueuedMap>();
    private pendingMapBuilds = 0;
    private mapLoadEpoch = 0;
    private readonly sceneBuilds = new Map<AbortController, { current: () => boolean; mapId?: number }>();

    private skyColor = new Float32Array([0, 0, 0]);
    private sceneHslOverride = new Float32Array([-1, -1, -1, 0]);
    private cameraPosUni = new Float32Array(2);
    readonly playerPosUni = new Float32Array(2);

    // Follow-camera state, same fields the WebGL renderer keeps for camera2.updateCameraFollow.
    followCamFocalXSub: number = 0;
    followCamFocalZSub: number = 0;
    followCamFocalLastClientCycle: number = -1;
    followCamFocalInitialized: boolean = false;
    readonly followCamRot = mat4.create();
    readonly followCamForwardAxis = vec3.fromValues(0, 0, -1);
    readonly followCamForward = vec3.create();
    mapDataLoadedNotified: boolean = false;

    // 117 HD follow-camera feel (updateFollowCamera): eased wheel zoom and yaw/pitch inertia.
    // followCamZoom scales the follow distance (1 = the pre-feature distance).
    followCamZoomTarget: number = 1;
    followCamZoom: number = 1;
    /** Wheel accumulated this frame while the pointer was over the scene (updateFollowCamera). */
    followCamWheel: number = 0;
    followCamSmoothedYaw: number = 0;
    followCamRawYaw: number = 0;
    followCamSmoothedPitch: number = 128;
    followCamCameraFeelInitialized: boolean = false;
    /** Follow camera-to-focal distance in tiles, read by the 117 HD DOF pass. */
    followCamDistance: number = 12;

    /** Stage 3/4/5 systems, owned by client/render/webgpu/{actors,overlays,ui}/. */
    readonly interactionHost: OverlayHost;
    readonly editorOverlays: EditorOverlays;
    actors?: WebGPUActors;
    overlays?: WebGPUOverlays;
    ui?: WebGPUUi;
    /** Instanced areas (REBUILD_REGION), see ./instances.ts. */
    readonly instances = new WebGPUInstances(this);
    instanceTemplateChunks: number[][][] | null = null;
    instanceRegionX = 0;
    instanceRegionY = 0;

    /** World entity deck scenes (boats), see ./worldEntity.ts. */
    readonly worldEntityOverlays = new Map<number, WorldEntityOverlay>();
    worldEntityAnimator?: WorldEntityAnimator;
    worldEntityLocRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    nextWorldEntityLoadToken: number = 1;
    readonly worldEntityLoadTokens = new Map<number, number>();
    readonly worldEntityReloadAfterMs = new Map<number, number>();
    /** 0..1 within the active client simulation tick; decks interpolate between tiles with it. */
    clientTickPhase: number = 0;

    constructor(osrsClient: OsrsClient) {
        super(osrsClient);
        this.interactionHost = new OverlayHost(this);
        this.editorOverlays = new EditorOverlays(this);
        this.mapManager.onMapRemoved = (mapX, mapY) => {
            this.actors?.onMapRemoved(mapX, mapY);
            this.overlays?.onMapRemoved(mapX, mapY);
        };
    }

    static isSupported(): boolean {
        return isWebGPUSupported;
    }

    static async probeAdapter(): Promise<GPUAdapter | undefined> {
        if (!isWebGPUSupported) return undefined;
        try {
            return (await navigator.gpu.requestAdapter()) ?? undefined;
        } catch {
            return undefined;
        }
    }

    override async init(): Promise<void> {
        await super.init();

        const adapter = await WebGPURenderer.probeAdapter();
        if (!adapter) {
            throw new Error("[webgpu] no adapter available");
        }
        this.device = await adapter.requestDevice();
        this.device.lost.then((info) => {
            // GPUDeviceLostInfo's fields are getters: logged as an object they print as {}.
            console.error(`[webgpu] device lost (${info.reason}): ${info.message}`);
        });
        // WebGPU validation errors are reported asynchronously and do not throw; surface them
        // with the [webgpu] tag the smoke test scans for.
        this.device.onuncapturederror = (event) => {
            console.error("[webgpu] uncaptured error", event.error.message);
        };

        const context = this.canvas.getContext("webgpu") as GPUCanvasContext | null;
        if (!context) {
            throw new Error("[webgpu] canvas.getContext('webgpu') returned null");
        }
        this.context = context;
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: "premultiplied",
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC,
        });

        this.ensureDepthTexture(this.canvas.width, this.canvas.height);

        // Title/download progress must draw while cache and world resources are still loading.
        this.ui = new WebGPUUi(this);
        await this.ui.init();

        (window as unknown as { __WEBGPU_RENDERER__?: WebGPURenderer }).__WEBGPU_RENDERER__ = this;
        console.info("[webgpu] device ready", adapter.info ?? {});
    }

    /**
     * The world texture atlas needs the cache's texture loader, which only exists after
     * phased loading (same reason WebGLOsrsRenderer.initTextures re-runs from initCache).
     */
    override initCache(): void {
        super.initCache();
        void this.initWorldResources();
    }

    override invalidateDefinitionCaches(): void {
        this.mapLoadEpoch++;
        this.cancelObsoleteSceneBuilds();
        this.instances.invalidate();
        WebGPUMapSquare.cancelPreparedLoads(this.device);
        this.mapsToLoad.clear();
        super.invalidateDefinitionCaches();
        this.ui?.invalidateDefinitionCaches();
        this.interactionHost.interactLocModelLoader?.clearCache();
        this.interactionHost.interactNpcModelLoader?.clearCache();
        this.interactionHost.sceneRaycaster?.clearCache();
        this.interactionHost.npcDefaultHeightCache.clear();
        this.interactionHost.cachedNpcIds.clear();
        this.interactionHost.cachedLocIds.clear();
        this.interactionHost.cachedObjIds.clear();
        this.actors?.invalidateNpcDefinitions();
        if (this.instanceActive) this.scheduleInstanceLocRebuild();
    }

    private async initWorldResources(): Promise<void> {
        if (this.world || !this.device || !this.osrsClient.loadedCache) return;
        try {
            this.world = await WorldResources.create(this.device, this.osrsClient, this.format);
            this.ensureSceneColorTexture(this.canvas.width, this.canvas.height);
            this.actors = new WebGPUActors(this);
            this.overlays = new WebGPUOverlays(this);
            await this.actors.init();
            await this.overlays.init();
        } catch (error) {
            console.error("[webgpu] world resources init failed", error);
        }
    }

    override getCanvasResolutionScale(cssWidth: number, cssHeight: number): number {
        return getCanvasResolutionScale(this, cssWidth, cssHeight);
    }

    override onResize(width: number, height: number): void {
        this.ensureDepthTexture(width, height);
        this.ensureSceneColorTexture(width, height);
    }

    private ensureDepthTexture(width: number, height: number): void {
        if (!this.device) return;
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (this.depthTexture && this.depthWidth === w && this.depthHeight === h) return;
        this.depthTexture?.destroy();
        this.depthTexture = this.device.createTexture({
            size: [w, h],
            format: SCENE_DEPTH_FORMAT,
            // TEXTURE_BINDING so a scene extension can sample it after the world pass (SSAO).
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.depthView = this.depthTexture.createView();
        this.depthWidth = w;
        this.depthHeight = h;
    }

    private ensureSceneColorTexture(width: number, height: number): void {
        const format = this.world?.extension?.sceneColorFormat;
        if (!this.device || !format) return;
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (this.sceneColorTexture && this.sceneColorWidth === w && this.sceneColorHeight === h) return;
        this.sceneColorTexture?.destroy();
        this.sceneColorTexture = this.device.createTexture({
            label: "webgpu scene hdr target",
            size: [w, h],
            format,
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.sceneColorView = this.sceneColorTexture.createView();
        this.sceneColorWidth = w;
        this.sceneColorHeight = h;
    }

    override resolveEffectiveRenderDistanceTiles(_frameCount: number): number {
        return resolveWebGPURenderDistance(this);
    }

    override queueLoadMap(mapX: number, mapY: number, streamGeneration?: number): void {
        // Normal map streaming is suppressed while an instance scene is active.
        if (this.instanceActive) return;
        if (!this.osrsClient.loadedCache) return;
        void this.loadMapData(mapX, mapY, streamGeneration);
    }

    /**
     * Animation Smoothing bakes scenery animations when a square is built, so toggling it
     * rebuilds the loaded scenery. The first call only records the state they were built with.
     */
    private syncLocAnimationSmoothing(): void {
        const settings = this.osrsClient.clientPlugins.objectSettings();
        const smooth = settings?.smoothLocAnimations ? settings.smoothLocAnimationSteps : -1;
        if (this.smoothLocAnimations === smooth) return;
        const first = this.smoothLocAnimations === undefined;
        this.smoothLocAnimations = smooth;
        if (first) return;
        if (this.instanceActive) {
            this.scheduleInstanceLocRebuild();
            return;
        }
        for (const mapId of this.mapManager.mapSquares.keys()) {
            this.queueLocReload(mapId >> 8, mapId & 0xff, "loc");
        }
    }

    /** Rebuilds a square after a loc change: just its door or loc geometry when that is all that changed. */
    queueLocReload(mapX: number, mapY: number, group: LocReloadGroup): void {
        if (!this.osrsClient.loadedCache) return;
        if (this.instanceActive) {
            // Only the drawn instance scene reloads in place, and only one group of it.
            const scene = this.instanceSceneMap;
            if (group === "full" || scene?.mapX !== mapX || scene.mapY !== mapY) this.scheduleInstanceLocRebuild();
            else void this.loadInstancePartial(group);
            return;
        }
        const partial = this.mapManager.getMap(mapX, mapY) && group !== "full" ? group : undefined;
        void this.loadMapData(mapX, mapY, undefined, partial);
    }

    /**
     * Rebuilds just the door or loc geometry of the drawn instance scene from its template
     * chunks (WebGL's instance scheduleInstanceLocUpdate), not the whole scene.
     */
    private async loadInstancePartial(partial: "door" | "loc"): Promise<void> {
        const scene = this.instanceSceneMap;
        const templateChunks = this.instanceTemplateChunks;
        if (!scene || !templateChunks) return;
        const { mapX, mapY } = scene;
        const epoch = this.mapLoadEpoch;
        const locVersion = this.locUpdates.version(mapX, mapY);
        const current = () => epoch === this.mapLoadEpoch && this.instanceActive &&
            this.instanceTemplateChunks === templateChunks && this.locUpdates.version(mapX, mapY) === locVersion;
        try {
            const mapData = await this.loadSceneData({
                mapX,
                mapY,
                maxLevel: Scene.MAX_LEVELS - 1,
                loadNpcs: false,
                smoothTerrain: true,
                ...this.osrsClient.clientPlugins.objectSettings(),
                minimizeDrawCalls: true,
                instance: { templateChunks, regionX: this.instanceRegionX, regionY: this.instanceRegionY },
                locOverrides: this.locOverrides,
                locSpawns: this.locSpawns,
                terrainOverrides: this.terrainOverrides,
                mapRegionReplacements: this.mapRegionReplacements,
                extraLocs: this.getExtraLocs(),
                doorOnly: partial === "door",
                locOnly: partial === "loc",
            }, current);
            if (!current() || !mapData) return;
            this.mapsToLoad.push({ mapData, locVersion, instance: true });
        } catch (error) {
            if ((error as Error)?.name === "AbortError" || !current()) return;
            console.error("[webgpu] instance loc rebuild failed", error);
            this.scheduleInstanceLocRebuild();
        }
    }

    private async loadMapData(
        mapX: number,
        mapY: number,
        streamGeneration?: number,
        partial?: "door" | "loc",
    ): Promise<void> {
        const epoch = this.mapLoadEpoch;
        this.locUpdates.applyGamemode();
        const locVersion = this.locUpdates.version(mapX, mapY);
        const input: SdMapLoaderInput = snapshotMapInput({
            persistentCache: true,
            minimapLevel: this.getPlayerRawPlane(),
            mapX,
            mapY,
            maxLevel: Math.max(0, Math.min(Scene.MAX_LEVELS - 1, Scene.MAX_LEVELS - 1)),
            loadNpcs: false,
            smoothTerrain: true,
            ...this.osrsClient.clientPlugins.objectSettings(),
            minimizeDrawCalls: true,
            loadedTextureIds: this.world?.loadedTextureIds ?? new Set<number>(),
            locOverrides: this.locOverrides,
            locSpawns: this.locSpawns,
            terrainOverrides: this.terrainOverrides,
            mapRegionReplacements: this.mapRegionReplacements,
            extraLocs: this.getExtraLocs(mapX, mapY),
            doorOnly: partial === "door",
            locOnly: partial === "loc",
        });
        try {
            const mapData = await this.loadSceneData(input, () => epoch === this.mapLoadEpoch &&
                !this.instanceActive && this.locUpdates.version(mapX, mapY) === locVersion &&
                (streamGeneration === undefined || this.mapManager.isMapInTargetGrid(mapX, mapY)));
            if (epoch !== this.mapLoadEpoch || this.instanceActive) return;
            if (streamGeneration !== undefined && !this.mapManager.isMapInTargetGrid(mapX, mapY)) {
                this.mapManager.loadingMapIds.delete(getMapSquareId(mapX, mapY));
                return;
            }
            if (!mapData) {
                this.mapManager.addInvalidMap(mapX, mapY);
                return;
            }
            mapData.minimapInput = input;
            this.mapsToLoad.push({ mapData, streamGeneration, locVersion });
        } catch (error) {
            if ((error as Error)?.name === "AbortError" || epoch !== this.mapLoadEpoch || this.instanceActive) return;
            console.error(`[webgpu] map load failed for (${mapX}, ${mapY})`, error);
            this.mapManager.deferFailedMapLoad(mapX, mapY);
        }
    }

    /** Rebuilds the active instance scene after its locs changed (filled in by the instances work). */
    scheduleInstanceLocRebuild(): void {
        this.instances.scheduleLocRebuild();
    }

    override async loadInstanceScene(
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
    ): Promise<void> {
        return this.instances.load(templateChunks, regionX, regionY);
    }

    override clearInstance(): void {
        this.mapLoadEpoch++;
        this.cancelObsoleteSceneBuilds();
        this.instances.clear();
        WebGPUMapSquare.cancelPreparedLoads(this.device);
        this.mapsToLoad.clear();
        // Drops the instance square and resets the grid, so streaming reloads the normal maps.
        this.mapManager.cleanUp();
        this.osrsClient.rehomeNpcs?.();
    }

    // ── World entity deck scenes (boats); see ./worldEntity.ts ────────────────────────────────

    /** Called by OsrsClient on REBUILD_WORLDENTITY; the deck is queued like any map build. */
    async loadWorldEntityScene(
        entityIndex: number,
        templateChunks: number[][][],
        regionX: number,
        regionY: number,
        worldX: number,
        worldY: number,
        sizeX: number,
        sizeZ: number,
        extraLocs: WorldEntityOverlay["extraLocs"],
        configId: number = -1,
        extraNpcs?: WorldEntityOverlay["extraNpcs"],
        basePlane: number = 0,
    ): Promise<void> {
        return loadWorldEntityScene(
            this,
            entityIndex,
            templateChunks,
            regionX,
            regionY,
            worldX,
            worldY,
            sizeX,
            sizeZ,
            extraLocs,
            configId,
            extraNpcs,
            basePlane,
        );
    }

    /** Deck locs arrive right after the first build; debounce a rebuild that includes them. */
    scheduleWorldEntityLocRebuild(entityIndex: number): void {
        scheduleWorldEntityLocRebuild(this, entityIndex);
    }

    /** The applied deck map for an entity, once built. */
    getOverlayMapForEntity(entityIndex: number): WebGPUMapSquare | undefined {
        return getOverlayMapForEntity(this, entityIndex);
    }

    clearWorldEntity(entityIndex: number): void {
        clearWorldEntity(this, entityIndex);
    }

    clearWorldEntityLocs(entityIndex: number): void {
        clearWorldEntityLocs(this, entityIndex);
    }

    /** A deck build the worker finished, applied with the normal map batch (applyReadyMaps). */
    queueWorldEntityMapData(mapData: SdMapData): void {
        this.mapsToLoad.push({ mapData });
    }

    /** Deck info for a visible map: its entity, overlay record and this frame's transform. */
    worldEntityForMap(
        map: WebGPUMapSquare,
    ): { entityIndex: number; overlay: WorldEntityOverlay; transform: Float32Array } | undefined {
        if (!this.mapManager.worldEntityMapIds.has(map.id)) return undefined;
        const entityIndex = getWorldEntityIndexForMapId(this, map.id);
        if (entityIndex === undefined) return undefined;
        const overlay = this.worldEntityOverlays.get(entityIndex);
        const transform = this.worldEntityAnimator?.getTransform(entityIndex);
        if (!overlay || !transform) return undefined;
        return { entityIndex, overlay, transform };
    }

    /** Server tick phase mapped onto the local client tick, for deck interpolation. */
    private updateClientTickPhase(timeSec: number): void {
        let phaseFromServer = Number.NaN;
        try {
            const { phase, tickMs } = getServerTickPhaseNow();
            const tickLengthMs = Math.max(1, tickMs | 0);
            const clampedPhase = Math.max(0, Math.min(1, phase));
            const msIntoServerTick = clampedPhase * tickLengthMs;
            const clientTickMs = 20;
            phaseFromServer = (msIntoServerTick % clientTickMs) / clientTickMs;
        } catch {
            phaseFromServer = Number.NaN;
        }
        if (!Number.isFinite(phaseFromServer)) {
            const ticksF = timeSec / 0.02;
            phaseFromServer = ticksF - Math.floor(ticksF);
        }
        this.clientTickPhase = Math.max(0, Math.min(1, phaseFromServer));
    }

    /** Builds a scene in the map worker (instances build theirs through here). */
    async loadSceneData(
        input: Omit<SdMapLoaderInput, "loadedTextureIds">,
        current?: () => boolean,
    ): Promise<SdMapData | undefined> {
        const epoch = this.mapLoadEpoch;
        const controller = new AbortController();
        this.cancelObsoleteSceneBuilds();
        const mapId = input.instance ? undefined : getMapSquareId(input.mapX, input.mapY);
        this.sceneBuilds.set(controller, {
            current: () => epoch === this.mapLoadEpoch && (!current || current()),
            mapId,
        });
        // Cancelling an older build clears its loading marker; this replacement still owns it.
        if (mapId !== undefined && !this.mapManager.getMap(input.mapX, input.mapY)) this.mapManager.loadingMapIds.add(mapId);
        this.pendingMapBuilds++;
        try {
            return await this.osrsClient.workerPool.queueLoad<SdMapLoaderInput, SdMapData | undefined, SdMapDataLoader>(
                this.dataLoader,
                { ...input, loadedTextureIds: this.world?.loadedTextureIds ?? new Set<number>() },
                controller.signal,
            );
        } catch (error) {
            if (controller.signal.aborted) throw new DOMException("Scene build cancelled", "AbortError");
            throw error;
        } finally {
            this.sceneBuilds.delete(controller);
            this.pendingMapBuilds--;
        }
    }

    private cancelObsoleteSceneBuilds(): void {
        for (const [controller, build] of this.sceneBuilds) {
            if (controller.signal.aborted || build.current()) continue;
            controller.abort();
            if (build.mapId !== undefined) this.mapManager.loadingMapIds.delete(build.mapId);
        }
    }

    /**
     * Port of replaceSceneWithInstance + its loadMap: swaps a finished instance build in for
     * everything drawn, in one frame, without the fade-in. Normal loads that land while the
     * instance is active are dropped, as WebGL's queueStreamMapData does.
     */
    private applyInstanceScene(frameCount: number): void {
        const partials: SdMapData[] = [];
        for (const queued of this.mapsToLoad.toArray()) {
            const { mapData, locVersion } = queued;
            if (queued.instance && locVersion !== undefined && this.locUpdates.isCurrent(mapData.mapX, mapData.mapY, locVersion)) {
                partials.push(mapData);
            } else {
                WebGPUMapSquare.cancelPreparedLoad(mapData);
            }
        }
        this.mapsToLoad.clear();
        const world = this.world;
        const mapData = world ? this.instances.takeBuiltScene((data) => WebGPUMapSquare.prepareLoad(this.device, data)) : null;
        if (!world) return;
        if (!mapData) {
            // A door or loc rebuild only replaces that group of the drawn scene.
            for (const partial of partials) {
                const square = this.mapManager.getMap(partial.mapX, partial.mapY);
                if (!square) continue;
                square.refreshPartial(partial, this.osrsClient.seqTypeLoader, getClientCycle() | 0);
                world.uploadMapTextures(partial.loadedTextures);
                if (partial.locOnly) this.ui?.registerMinimapData(partial);
                this.locUpdates.applied(partial.mapX, partial.mapY);
            }
            return;
        }
        // A whole scene built since covers them.
        for (const partial of partials) WebGPUMapSquare.cancelPreparedLoad(partial);
        // The scene's loc animations go on in the new one (LocAnimated.carryOver): a held one (a
        // collapsed floor) would replay from frame 0 otherwise.
        const carried: LocAnimated[] = [];
        for (const previous of this.mapManager.mapSquares.values()) carried.push(...((previous as any).locsAnimated ?? []));
        this.mapManager.cleanUp();
        this.osrsClient.clearMinimapImageUrls();
        const { mapX, mapY } = mapData;
        // Its NPCs belong to this one square now, wherever in the scene they stand.
        this.instanceSceneMap = { mapX: mapX | 0, mapY: mapY | 0 };
        const square = WebGPUMapSquare.load(this.device, world, mapData, -1, frameCount);
        square.initAnimatedLocs(mapData, this.osrsClient.seqTypeLoader, getClientCycle() | 0);
        LocAnimated.carryOver(carried, square.locsAnimated);
        world.uploadMapTextures(mapData.loadedTextures);
        this.mapManager.addMap(mapX, mapY, square);
        this.actors?.onMapAdded(square, mapData);
        this.overlays?.onMapAdded(square, mapData);
        this.ui?.registerMinimapData(mapData);
        this.osrsClient.rehomeNpcs?.(getMapSquareId(mapX, mapY));
    }

    /** addedLocs as loader extraLocs: those inside one map square, or all of them (instances). */
    getExtraLocs(mapX?: number, mapY?: number): SdMapLoaderInput["extraLocs"] {
        const out: NonNullable<SdMapLoaderInput["extraLocs"]> = [];
        for (const loc of this.addedLocs.values()) {
            if (mapX !== undefined && mapY !== undefined && ((loc.x >> 6) !== mapX || (loc.y >> 6) !== mapY)) {
                continue;
            }
            out.push({ id: loc.locId, x: loc.x, y: loc.y, level: loc.level, shape: loc.shape, rotation: loc.rotation });
        }
        return out.length > 0 ? out : undefined;
    }

    private applyReadyMaps(frameCount: number): void {
        const world = this.world;
        if (!world) return;
        const startedAt = performance.now();
        while (this.mapsToLoad.length > 0) {
            if (performance.now() - startedAt > MAP_APPLY_BUDGET_MS) break;
            const queued = this.mapsToLoad.peekFront();
            if (!queued) break;
            const { mapData } = queued;
            const { mapX, mapY } = mapData;
            if (queued.streamGeneration !== undefined && !this.mapManager.isMapInTargetGrid(mapX, mapY)) {
                this.mapsToLoad.shift();
                WebGPUMapSquare.cancelPreparedLoad(mapData);
                this.mapManager.loadingMapIds.delete(getMapSquareId(mapX, mapY));
                continue;
            }
            // Built before a loc change: the reload LocUpdates queued replaces it.
            if (queued.locVersion !== undefined && !this.locUpdates.isCurrent(mapX, mapY, queued.locVersion)) {
                this.mapsToLoad.shift();
                WebGPUMapSquare.cancelPreparedLoad(mapData);
                continue;
            }
            if (!mapData.doorOnly && !mapData.locOnly && !WebGPUMapSquare.prepareLoad(this.device, mapData)) break;
            this.mapsToLoad.shift();
            const existing = this.mapManager.getMap(mapX, mapY);
            if (mapData.doorOnly || mapData.locOnly) {
                // A door-only/loc-only build only replaces that group of a resident square;
                // if the square is gone (pruned or never applied) rebuild it whole.
                if (!existing) {
                    this.queueLocReload(mapX, mapY, "full");
                    continue;
                }
                existing.refreshPartial(mapData, this.osrsClient.seqTypeLoader, getClientCycle() | 0);
                world.uploadMapTextures(mapData.loadedTextures);
                if (mapData.locOnly) this.ui?.registerMinimapData(mapData);
                this.locUpdates.applied(mapX, mapY);
                continue;
            }
            if (queued.locVersion !== undefined) this.locUpdates.applied(mapX, mapY);
            // Foreground groups publish together; per-upload fades would reveal squares separately.
            const timeLoaded = existing ? existing.timeLoaded : -1;
            if (existing) {
                this.mapManager.removeMap(mapX, mapY);
            }
            const square = WebGPUMapSquare.load(
                this.device,
                world,
                mapData,
                timeLoaded,
                frameCount,
            );
            square.initAnimatedLocs(mapData, this.osrsClient.seqTypeLoader, getClientCycle() | 0);
            world.uploadMapTextures(mapData.loadedTextures);
            this.mapManager.addMap(mapX, mapY, square);
            configureWorldEntityOverlayMap(this, square);
            this.actors?.onMapAdded(square, mapData);
            this.overlays?.onMapAdded(square, mapData);
            this.ui?.registerMinimapData(mapData);
        }
    }

    private updateSkyColor(deltaFrames: number = 1): void {
        const playerX = this.playerPosUni[0];
        const playerZ = this.playerPosUni[1];
        // In an instance, the region its template chunk was copied from (environmentAt).
        const target = environmentAt(this, playerX, playerZ).fogColor;
        const blend = Math.min(1, SKY_BLEND_PER_FRAME * deltaFrames);
        for (let i = 0; i < 3; i++) {
            const delta = target[i] - this.skyColor[i];
            this.skyColor[i] =
                Math.abs(delta) < 1 / 512 ? target[i] : this.skyColor[i] + delta * blend;
        }
    }

    private writeSceneUniforms(timeSec: number): void {
        if (!this.world) return;
        const camera = this.osrsClient.camera;
        this.cameraPosUni[0] = camera.getPosX();
        this.cameraPosUni[1] = camera.getPosZ();

        const renderDistance = resolveWebGPURenderDistance(this);
        // HD spreads haze over long views, as on WebGL (render/render/frame/render.ts).
        const { fogEnd, fogDepth } = resolveFogRange({ renderDistance, autoFogDepth: true,
            autoFogDepthFactor: AUTO_FOG_DEPTH_FACTOR, manualFogDepth: 0, hd: this.osrsClient.clientPlugins.hdEnabled() });

        const data = this.world.sceneData;
        data.set(camera.viewProjMatrix as Float32Array, 0);
        data.set(camera.viewMatrix as Float32Array, 16);
        data.set(camera.projectionMatrix as Float32Array, 32);
        data[48] = this.skyColor[0];
        data[49] = this.skyColor[1];
        data[50] = this.skyColor[2];
        data[51] = 1.0;
        data.set(this.sceneHslOverride, 52);
        data.set(this.cameraPosUni, 56);
        data.set(this.playerPosUni, 58);
        data[60] = fogEnd;
        data[61] = fogDepth;
        data[62] = timeSec;
        data[63] = this.brightness;
        // colorBanding: the GPU plugin's, else WebGL's default (the shader divides by it).
        data[64] = this.osrsClient.clientPlugins.gpuSettings()?.colorBanding ?? 255.0;
        data[65] = this.osrsClient.isNewTextureAnim ? 1.0 : 0.0;
        this.world.flushSceneUniforms();
    }

    override render(time: number, deltaTime: number, _resized: boolean): void {
        const world = this.world;
        if (!this.device || !this.depthView) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width < 1 || height < 1) return;
        if (!world) {
            this.ui?.update(time, deltaTime);
            return;
        }

        const timeSec = time / 1000;
        const loggedIn = this.osrsClient.isLoggedIn();
        const scenePreview = !loggedIn && this.osrsClient.scenePreviewEnabled && !!this.osrsClient.loadedCache;
        const drawScene = loggedIn || scenePreview;
        const sceneViewport = this.getSceneViewportWidgetRect();
        let restoreCamera: (() => void) | undefined;

        if (drawScene) {
            syncCameraViewportUnitScale(this);
            const inputManager = this.osrsClient.inputManager;
            this.handleInput(deltaTime);
            // UI chooses the wheel owner first. The native viewport zoom listener keeps a
            // copy for HD; foreground lists and modals consume theirs without forwarding it.
            // A hidden HUD has no viewport listener, so its unclaimed world wheel still zooms.
            const viewportWheel = inputManager.viewportWheelDeltaY || inputManager.getCameraZoomDelta();
            if (
                this.osrsClient.clientPlugins.hdEnabled() === true &&
                this.osrsClient.followPlayerCamera &&
                this.osrsClient.camera.getViewPitchOverride() === undefined &&
                viewportWheel !== 0 &&
                inputManager.mouseX >= 0 &&
                inputManager.mouseY >= 0 &&
                this.osrsClient.camera.containsScreenPoint(inputManager.mouseX, inputManager.mouseY)
            ) {
                this.followCamWheel += viewportWheel;
            }
            // Deck interpolation runs before the camera: it projects the deck coordinates the
            // player stands in to their world position (camera.ts) and places each deck.
            const cycle = getClientCycle() | 0;
            this.updateClientTickPhase(timeSec);
            this.worldEntityAnimator?.tick(cycle);
            this.osrsClient.worldViewManager.interpolateEntities(cycle, this.clientTickPhase);
            updateWorldEntityMotion(this);
            ensureWorldEntityOverlaysLoaded(this, performance.now());
            this.osrsClient.camera.applySmoothing(deltaTime);
            if (scenePreview) {
                this.playerPosUni[0] = this.osrsClient.camera.getPosX();
                this.playerPosUni[1] = this.osrsClient.camera.getPosZ();
            } else updateFollowCamera(this, timeSec, deltaTime);
            restoreCamera = this.applyCameraShake(cycle);
            this.osrsClient.camera.update(
                width, height,
                sceneViewport.x, sceneViewport.y, sceneViewport.width, sceneViewport.height,
            );
            // The deck placement matrices are view-space, so they are rebuilt per camera frame.
            this.worldEntityAnimator?.compose(
                this.osrsClient.camera.viewMatrix as Float32Array,
            );
            // Swap in built squares before the visible list is made: replacing a square (a door
            // or loc rebuild) destroys the old one's buffers, and a frame that still draws it
            // fails as a whole, flashing the clear colour.
            if (this.instanceActive) this.applyInstanceScene(this.stats.frameCount);
            else this.applyReadyMaps(this.stats.frameCount);
            updateWebGPUMapStreaming(this, this.stats.frameCount);
            this.cancelObsoleteSceneBuilds();
            this.updateSkyColor();
            this.syncLocAnimationSmoothing();
            for (const map of this.mapManager.visibleMaps) {
                map.updateAnimatedLocs(this.osrsClient.seqFrameLoader, cycle, this.locFrameSound);
            }
            this.osrsClient.ambientSounds.frame(this.mapManager.visibleMaps);
            // World entity decks are drawn from their own coordinate space; hand each map this
            // frame's placement matrix (identity maps are left untouched).
            for (const map of this.mapManager.visibleMaps) {
                if (!this.mapManager.worldEntityMapIds.has(map.id)) continue;
                const entityIndex = getWorldEntityIndexForMapId(this, map.id);
                const transform =
                    entityIndex !== undefined
                        ? this.worldEntityAnimator?.getTransform(entityIndex)
                        : undefined;
                map.setWorldEntityTransform(transform);
            }
        }

        this.writeSceneUniforms(timeSec);

        // A scene extension (e.g. 117 HD) is a runtime toggle: pick the pipeline pair once per
        // frame, before any map draw.
        const extension = world.extension;
        const gpu = this.osrsClient.clientPlugins.gpuSettings();
        const sampleCount = gpu && gpu.msaaSamples > 0 ? WEBGPU_MSAA_SAMPLES : 1;
        world.selectExtension(!!extension?.isActive(), sampleCount);

        // Same point the WebGL frame loop flushes queued client packets (render.ts login
        // early-out and in-game path).
        flushPackets();
        this.frameRoofPlaneLimit = drawScene ? this.interactionHost.getRoofPlaneLimit() : 3;
        const actorShadow = world.extensionActive && extension?.shaders.depth
            ? (drawScene ? extension.prepareActorVisibility?.(this) : undefined)
            : null;
        this.actors?.update(timeSec, actorShadow);
        this.overlays?.update(time, deltaTime);
        this.ui?.update(time, deltaTime);

        const encoder = this.device.createCommandEncoder();
        const visible = drawScene ? this.mapManager.visibleMaps : [];
        const roofPlaneLimit = this.frameRoofPlaneLimit;
        const camera = this.osrsClient.camera;
        this.frameScenery = {
            tileX: this.playerPosUni[0], tileZ: this.playerPosUni[1],
            distance: world.sceneData[60],
            lodDistance: resolveWebGPULodDistance(this), camera: camera.frustum,
        };

        // The extension's own passes (117 HD: uniforms, lights, shadow map) go in the same
        // encoder, before the scene pass that samples them.
        if (world.extensionActive && drawScene) {
            extension!.beforeScene?.(this, encoder);
        }

        const canvasTexture = this.context.getCurrentTexture();
        const canvasView = canvasTexture.createView();
        // An active extension that declares sceneColorFormat renders the world into the HDR
        // target and composites to the canvas in afterScene (HDR tonemapping, bloom, SSAO).
        const sceneExtension = world.extension;
        const hdrTarget =
            world.extensionActive &&
            sceneExtension?.sceneColorFormat &&
            sceneExtension.afterScene &&
            this.sceneColorView
                ? this.sceneColorView
                : undefined;
        // Without the extension's target, FXAA has the world drawn into its own and presents it.
        const fxaa = !hdrTarget && gpu?.fxaa ? (this.fxaa ??= new FxaaPass(this.device, this.format)) : undefined;
        const sceneTarget = hdrTarget ?? fxaa?.ensure(width, height) ?? canvasView;
        // MSAA draws into multisampled targets that resolve into sceneTarget as the pass ends.
        let msaa: SceneMsaaTargets | undefined;
        if (sampleCount > 1) {
            msaa = this.msaaTargets ??= new SceneMsaaTargets(this.device);
            msaa.ensure(width, height, hdrTarget ? sceneExtension!.sceneColorFormat! : this.format);
        } else if (this.msaaTargets) {
            this.msaaTargets.destroy();
            this.msaaTargets = undefined;
        }
        // The HDR target holds linear light, so the display-referred sky clear is linearised;
        // the tonemap pass re-encodes it.
        const toLinear = (value: number) => Math.pow(Math.max(value, 0), 2.2);
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: msaa?.colorView ?? sceneTarget,
                    resolveTarget: msaa ? sceneTarget : undefined,
                    clearValue: hdrTarget
                        ? {
                              r: toLinear(this.skyColor[0]),
                              g: toLinear(this.skyColor[1]),
                              b: toLinear(this.skyColor[2]),
                              a: 1,
                          }
                        : {
                              r: this.skyColor[0],
                              g: this.skyColor[1],
                              b: this.skyColor[2],
                              a: 1,
                          },
                    loadOp: "clear",
                    storeOp: msaa ? "discard" : "store",
                },
            ],
            depthStencilAttachment: {
                view: msaa?.depthView ?? this.depthView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                // Multisampled depth is only read again to resolve it for the extension.
                depthStoreOp: msaa && !hdrTarget ? "discard" : "store",
            },
        });

        if (drawScene) {
            const sceneClip = this.getSceneViewportClipRect();
            const clipX = Math.max(0, Math.min(width, Math.floor(sceneClip.x)));
            const clipY = Math.max(0, Math.min(height, Math.floor(sceneClip.y)));
            pass.setScissorRect(
                clipX, clipY,
                Math.max(0, Math.min(width, Math.ceil(sceneClip.x + sceneClip.width)) - clipX),
                Math.max(0, Math.min(height, Math.ceil(sceneClip.y + sceneClip.height)) - clipY),
            );
            for (let i = 0; i < visible.length; i++) {
                if (visible[i].canRender(this.stats.frameCount)) {
                    visible[i].drawOpaque(pass, roofPlaneLimit, this.frameScenery);
                }
            }
            // Locs seen below the floor (SunkenLocs): the depth under them reset, then drawn again.
            const sunken = visible.filter((map) => map.canRender(this.stats.frameCount) && map.hasSunkenLocs());
            if (sunken.length > 0) {
                pass.setViewport(0, 0, width, height, 1, 1);
                for (const map of sunken) map.drawSunkenLocs(pass, true, roofPlaneLimit, this.frameScenery);
                pass.setViewport(0, 0, width, height, 0, 1);
                for (const map of sunken) map.drawSunkenLocs(pass, false, roofPlaneLimit, this.frameScenery);
            }
            this.actors?.drawOpaque(pass);
            for (let i = visible.length - 1; i >= 0; i--) {
                if (visible[i].canRender(this.stats.frameCount)) {
                    visible[i].drawAlpha(pass, roofPlaneLimit, this.frameScenery);
                }
            }
            this.actors?.drawAlpha(pass);
            this.overlays?.drawWorld(pass);
            this.editorOverlays.draw(pass, this.frameScenery);
        }

        pass.end();

        // The extension's post passes read and depth-test against the single-sampled depth.
        if (msaa && hdrTarget) msaa.resolveDepth(encoder, this.depthView);
        fxaa?.encode(encoder, canvasView);

        if (hdrTarget) {
            sceneExtension!.afterScene!(this, encoder, {
                colorTexture: this.sceneColorTexture!,
                colorView: hdrTarget,
                depthTexture: this.depthTexture!,
                depthView: this.depthView!,
                canvasView,
            });
        }

        if (restoreCamera) {
            restoreCamera();
            camera.update(width, height, sceneViewport.x, sceneViewport.y, sceneViewport.width, sceneViewport.height);
            this.worldEntityAnimator?.compose(camera.viewMatrix as Float32Array);
        }

        // Overlays and UI that draw after the world, without depth (ToFrameTexture +
        // PostPresent until stage 5 adds an offscreen frame texture).
        const screenPass = encoder.beginRenderPass({
            colorAttachments: [{ view: canvasView, loadOp: "load", storeOp: "store" }],
        });
        if (drawScene) {
            this.overlays?.drawScreen(screenPass);
        }
        this.ui?.draw(screenPass);
        screenPass.end();

        this.editorOverlays.encodeCapture(encoder, canvasTexture);
        this.device.queue.submit([encoder.finish()]);
    }

    /**
     * Draws full-detail loaded scenery into the extension's cached world-shadow target.
     */
    drawWorldDepth(pass: GPURenderPassEncoder, shadow: Frustum): void {
        const world = this.world;
        if (!world?.depthTextureBindGroup || !this.frameScenery) return;
        pass.setBindGroup(SCENE_GROUP, world.sceneBindGroup);
        pass.setBindGroup(WORLD_TEXTURES_GROUP, world.depthTextureBindGroup);
        const visibility = { ...this.frameScenery, shadow };
        const cycle = getClientCycle() | 0;
        // Loaded off-screen geometry can still cast into the light's view.
        for (const map of this.mapManager.mapSquares.values()) {
            if (map.canRender(this.stats.frameCount)) {
                map.updateAnimatedLocs(this.osrsClient.seqFrameLoader, cycle);
                map.drawDepth(pass, this.frameRoofPlaneLimit, visibility);
            }
        }
    }

    drawActorDepth(pass: GPURenderPassEncoder): void {
        const world = this.world;
        if (!world?.depthTextureBindGroup) return;
        pass.setBindGroup(SCENE_GROUP, world.sceneBindGroup);
        pass.setBindGroup(WORLD_TEXTURES_GROUP, world.depthTextureBindGroup);
        this.actors?.drawDepth(pass);
    }

    getRoofPlaneLimit(): number {
        return this.frameRoofPlaneLimit;
    }

    hasPendingMapStreamingWork(): boolean {
        return this.pendingMapBuilds > 0 || this.mapManager.loadingMapIds.size > 0 || this.mapsToLoad.length > 0 ||
            this.instances.hasPendingWork() ||
            this.mapManager.hasPendingMapLoads(this.stats.frameCount) ||
            !this.mapManager.isSceneReady(this.stats.frameCount);
    }

    /** Controlled player's raw plane; part of the HdLightsHost surface. */
    getPlayerRawPlane(): number {
        const idx = getControlledPlayerEcsIndex(this);
        return idx !== undefined ? this.osrsClient.playerEcs.getLevel(idx) | 0 : 0;
    }

    /** Terrain height at a world tile/plane; part of the HdLightsHost surface. */
    sampleHeightAtExactPlane(worldX: number, worldZ: number, plane: number): number {
        const map = this.mapManager.getMapForWorldTile(Math.floor(worldX), Math.floor(worldZ));
        return map ? map.sampleHeightAtExactPlane(worldX, worldZ, plane) : 0;
    }

    // ── Helm steering surface read by HelmSteering's deps ─────────────────────────────────────

    /** Port of WebGLOsrsRenderer.screenToRay, through the overlay host's shared implementation. */
    screenToRay(mouseX: number, mouseY: number): Ray | null {
        return this.overlays?.screenToRay(mouseX, mouseY) ?? null;
    }

    /** World fine point on the sea under a screen position, around a boat (HelmSteering). */
    pickSeaPointAt(
        entityIndex: number,
        mouseX: number,
        mouseY: number,
    ): { x: number; y: number } | undefined {
        return pickSeaPoint(this, entityIndex, mouseX, mouseY);
    }

    /** Maps a fine position in an entity's deck scene to world fine units (HelmSteering). */
    projectDeckToWorld(
        entityIndex: number,
        fineX: number,
        fineY: number,
    ): { x: number; y: number } | undefined {
        return projectDeckToWorld(this, entityIndex, fineX, fineY);
    }

    getProjectileManager(): IProjectileManager | undefined {
        return this.actors?.getProjectileManager();
    }

    override registerHitsplat(event: HitsplatEventPayload): void {
        this.overlays?.registerHitsplat(event);
    }

    override registerSpotAnimation(event: PlayerSpotAnimationEvent): void {
        this.actors?.registerSpotAnimation(event);
    }

    override getCollisionFlagAt(plane: number, tileX: number, tileY: number): number {
        const view = this.osrsClient.worldViewManager.findWorldViewAt(tileX, tileY);
        const map = view && !view.isTopLevel()
            ? this.osrsClient.worldViewManager.getOverlayMapSquare(view.id, this.mapManager)
            : this.mapManager.getMapForWorldTile(tileX, tileY);
        if (!map) return 0x100;
        return map.getCollisionFlag(plane, tileX - map.getRenderBaseTileX(), tileY - map.getRenderBaseTileY());
    }

    override registerNpcSpotAnimation(event: NpcSpotAnimationEvent): void {
        this.actors?.registerNpcSpotAnimation(event);
    }

    override registerWorldSpotAnimation(event: WorldSpotAnimationEvent): number | undefined {
        return this.actors?.registerWorldSpotAnimation(event);
    }

    override killWorldSpotAnimation(id: number): void {
        this.actors?.killWorldSpotAnimation(id);
    }

    override onLocChange(oldId: number, newId: number, tile: { x: number; y: number }, level: number, opts?: LocChangeOptions): void {
        this.locUpdates.onLocChange(oldId, newId, tile, level, opts);
    }

    override onLocAddChange(locId: number, tile: { x: number; y: number }, level: number, shape: number, rotation: number): void {
        this.locUpdates.onLocAddChange(locId, tile, level, shape, rotation);
    }

    override onLocDel(tile: { x: number; y: number }, level: number, shape: number, rotation: number): void {
        this.locUpdates.onLocDel(tile, level, shape, rotation);
    }

    override onLocAnim(locId: number, tile: { x: number; y: number }, level: number, shape: number, rotation: number, animId: number): void {
        this.locUpdates.onLocAnim(locId, tile, level, shape, rotation, animId);
    }

    override refreshGamemodeWorldLocs(): void {
        this.locUpdates.refreshGamemodeWorldLocs();
    }

    protected override reloadMultiLocSquare(mapX: number, mapY: number): void {
        if (this.instanceActive) this.scheduleInstanceLocRebuild();
        else this.locUpdates.scheduleReload(mapX, mapY, "full");
    }

    override onRegionReplacement(payload: RegionReplacementEvent): void {
        this.locUpdates.onRegionReplacement(payload);
    }

    getWidgetsGLCanvas(): HTMLCanvasElement | undefined {
        return this.ui?.getWidgetsGLCanvas();
    }

    computeUiRenderMetrics(bufW: number, bufH: number): UiRenderMetrics {
        return (
            this.ui?.computeUiRenderMetrics(bufW, bufH) ?? {
                layoutW: bufW,
                layoutH: bufH,
                renderScaleX: 1,
                renderScaleY: 1,
                renderOffsetX: 0,
                renderOffsetY: 0,
            }
        );
    }

    getUiRenderMetrics(bufW: number, bufH: number): UiRenderMetrics {
        return this.ui?.getUiRenderMetrics(bufW, bufH) ?? this.computeUiRenderMetrics(bufW, bufH);
    }

    /** Current draw bounds; the raw widget rect remains the input to camera.update. */
    getSceneViewportClipRect(): { x: number; y: number; width: number; height: number } {
        return getCameraViewportRect(this.osrsClient.camera);
    }

    getSceneViewportWidgetRect(): { x: number; y: number; width: number; height: number } {
        return (
            this.ui?.getSceneViewportWidgetRect() ?? {
                x: 0,
                y: 0,
                width: this.canvas.width,
                height: this.canvas.height,
            }
        );
    }

    getMinimapIcons(mapX: number, mapY: number, level: number = 0): MinimapIcon[] | undefined {
        return this.ui?.getMinimapIcons(mapX, mapY, level);
    }

    registerMinimapData(mapData: SdMapData): void {
        this.ui?.registerMinimapData(mapData);
    }

    /**
     * Logout/disconnect reset (port of render/render/session.ts clearSessionCaches). Without it
     * mapDataLoadedNotified stays set, MAP_DATA_LOADED never completes on the next login and the
     * client sits on "Loading - please wait".
     */
    override clearSessionCaches(): void {
        this.mapLoadEpoch++;
        this.cancelObsoleteSceneBuilds();
        WebGPUMapSquare.cancelPreparedLoads(this.device);
        this.locUpdates.dispose();
        this.locOverrides.clear();
        this.addedLocs.clear();
        this.locSpawns.clear();
        this.terrainOverrides.clear();
        this.mapRegionReplacements.clear();
        this.mapsToLoad.clear();
        clearWorldEntities(this);
        this.followCamFocalInitialized = false;
        this.followCamFocalLastClientCycle = -1;
        this.followCamZoomTarget = 1;
        this.followCamZoom = 1;
        this.followCamWheel = 0;
        this.followCamCameraFeelInitialized = false;
        this.followCamDistance = 12;
        this.mapDataLoadedNotified = false;
    }

    override cleanUp(): void {
        this.mapLoadEpoch++;
        this.cancelObsoleteSceneBuilds();
        WebGPUMapSquare.cancelPreparedLoads(this.device);
        this.locUpdates.dispose();
        this.actors?.dispose();
        this.overlays?.dispose();
        this.interactionHost.dispose();
        this.editorOverlays.dispose();
        this.ui?.dispose();
        this.actors = undefined;
        this.overlays = undefined;
        this.ui = undefined;
        super.cleanUp();
        this.world?.destroy();
        this.world = undefined;
        this.depthTexture?.destroy();
        this.depthTexture = undefined;
        this.depthView = undefined;
        this.sceneColorTexture?.destroy();
        this.sceneColorTexture = undefined;
        this.sceneColorView = undefined;
        this.msaaTargets?.destroy();
        this.msaaTargets = undefined;
        this.fxaa?.dispose();
        this.fxaa = undefined;
    }
}
