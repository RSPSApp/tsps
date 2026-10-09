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
import type { OsrsClient } from "../../game/OsrsClient";
import type { PlayerSpotAnimationEvent } from "../../game/sync/PlayerSyncTypes";
import { flushPackets } from "../../network/packet";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import type { MinimapIcon } from "../loader/SdMapData";
import { SdMapData } from "../loader/SdMapData";
import { SdMapDataLoader } from "../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../loader/SdMapLoaderInput";
import type { WorldEntityAnimator } from "../WorldEntityAnimator";
import { updateWorldEntityMotion } from "../render/worldEntityMotion";
import { getServerTickPhaseNow } from "../../network/serverConnection/timing";
import { WebGPUMapSquare } from "./WebGPUMapSquare";
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
import { GPU_TEXTURE_USAGE, SCENE_DEPTH_FORMAT, SCENE_GROUP, WORLD_TEXTURES_GROUP } from "./bindings";
import { getControlledPlayerEcsIndex, updateFollowCamera } from "./camera";
import { computeWebGPURoofPlaneLimit, resolveWebGPURenderDistance } from "./frameConfig";
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
    type: OsrsRendererType = WEBGPU;

    device!: GPUDevice;
    context!: GPUCanvasContext;
    format!: GPUTextureFormat;

    private world?: WorldResources;
    /** This frame's visible maps and roof limit, for drawSceneDepth during beforeScene. */
    private frameVisibleMaps: readonly WebGPUMapSquare[] = [];
    private frameRoofPlaneLimit = 3;
    private depthTexture?: GPUTexture;
    private depthView?: GPUTextureView;
    private depthWidth: number = 0;
    private depthHeight: number = 0;
    /** Offscreen HDR scene target, only when the scene extension declares `sceneColorFormat`. */
    private sceneColorTexture?: GPUTexture;
    private sceneColorView?: GPUTextureView;
    private sceneColorWidth: number = 0;
    private sceneColorHeight: number = 0;

    private dataLoader = new SdMapDataLoader();

    // Dynamic world-object state from LOC/REGION packets (same names as WebGLOsrsRenderer, which
    // plugins read). Every map build passes it to the worker, so rebuilt squares include it.
    readonly locOverrides: NonNullable<SdMapLoaderInput["locOverrides"]> = new Map();
    /** Dynamically spawned locs (LOC_ADD_CHANGE), keyed by "x,y,level,shape". */
    readonly addedLocs = new Map<
        string,
        { locId: number; x: number; y: number; level: number; shape: number; rotation: number }
    >();
    readonly locSpawns: NonNullable<SdMapLoaderInput["locSpawns"]> = new Map();
    readonly terrainOverrides: NonNullable<SdMapLoaderInput["terrainOverrides"]> = new Map();
    readonly mapRegionReplacements: NonNullable<SdMapLoaderInput["mapRegionReplacements"]> = new Map();
    /** LOC/REGION packet handling and the map rebuilds they cause (./locUpdates.ts). */
    readonly locUpdates = new LocUpdates(this);
    private mapsToLoad = new Denque<QueuedMap>();

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
    heightValidAtTime: number | undefined;
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
        });

        this.ensureDepthTexture(this.canvas.width, this.canvas.height);

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

    private async initWorldResources(): Promise<void> {
        if (this.world || !this.device || !this.osrsClient.loadedCache) return;
        try {
            this.world = await WorldResources.create(this.device, this.osrsClient, this.format);
            this.ensureSceneColorTexture(this.canvas.width, this.canvas.height);
            this.actors = new WebGPUActors(this);
            this.overlays = new WebGPUOverlays(this);
            this.ui = new WebGPUUi(this);
            await this.actors.init();
            await this.overlays.init();
            await this.ui.init();
        } catch (error) {
            console.error("[webgpu] world resources init failed", error);
        }
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

    override queueLoadMap(mapX: number, mapY: number, streamGeneration?: number): void {
        // Normal map streaming is suppressed while an instance scene is active.
        if (this.instanceActive) return;
        if (!this.osrsClient.loadedCache) return;
        void this.loadMapData(mapX, mapY, streamGeneration);
    }

    /** Rebuilds a square after a loc change: just its door or loc geometry when that is all that changed. */
    queueLocReload(mapX: number, mapY: number, group: LocReloadGroup): void {
        if (this.instanceActive || !this.osrsClient.loadedCache) return;
        void this.loadMapData(mapX, mapY, undefined, group === "full" ? undefined : group);
    }

    private async loadMapData(
        mapX: number,
        mapY: number,
        streamGeneration?: number,
        partial?: "door" | "loc",
    ): Promise<void> {
        this.locUpdates.applyGamemode();
        const locVersion = this.locUpdates.version(mapX, mapY);
        const input: SdMapLoaderInput = {
            mapX,
            mapY,
            maxLevel: Math.max(0, Math.min(Scene.MAX_LEVELS - 1, Scene.MAX_LEVELS - 1)),
            loadNpcs: false,
            smoothTerrain: true,
            minimizeDrawCalls: true,
            loadedTextureIds: this.world?.loadedTextureIds ?? new Set<number>(),
            locOverrides: this.locOverrides,
            locSpawns: this.locSpawns,
            terrainOverrides: this.terrainOverrides,
            mapRegionReplacements: this.mapRegionReplacements,
            extraLocs: this.getExtraLocs(mapX, mapY),
            doorOnly: partial === "door",
            locOnly: partial === "loc",
        };
        try {
            const mapData = await this.osrsClient.workerPool.queueLoad<
                SdMapLoaderInput,
                SdMapData | undefined,
                SdMapDataLoader
            >(this.dataLoader, input);
            if (!mapData) {
                this.mapManager.loadingMapIds.delete(getMapSquareId(mapX, mapY));
                return;
            }
            this.mapsToLoad.push({ mapData, streamGeneration, locVersion });
        } catch (error) {
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
        this.instances.clear();
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
    async loadSceneData(input: Omit<SdMapLoaderInput, "loadedTextureIds">): Promise<SdMapData | undefined> {
        return await this.osrsClient.workerPool.queueLoad<SdMapLoaderInput, SdMapData | undefined, SdMapDataLoader>(
            this.dataLoader,
            { ...input, loadedTextureIds: this.world?.loadedTextureIds ?? new Set<number>() },
        );
    }

    /**
     * Port of replaceSceneWithInstance + its loadMap: swaps a finished instance build in for
     * everything drawn, in one frame, without the fade-in. Normal loads that land while the
     * instance is active are dropped, as WebGL's queueStreamMapData does.
     */
    private applyInstanceScene(frameCount: number): void {
        this.mapsToLoad.clear();
        const world = this.world;
        const mapData = world ? this.instances.takeBuiltScene() : null;
        if (!world || !mapData) return;
        this.mapManager.cleanUp();
        this.osrsClient.clearMinimapImageUrls();
        const { mapX, mapY } = mapData;
        // Its NPCs belong to this one square now, wherever in the scene they stand.
        this.instanceSceneMap = { mapX: mapX | 0, mapY: mapY | 0 };
        const square = WebGPUMapSquare.load(this.device, world, mapData, -1, frameCount);
        square.initAnimatedLocs(mapData, this.osrsClient.seqTypeLoader, getClientCycle() | 0);
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
            const queued = this.mapsToLoad.shift();
            if (!queued) break;
            const { mapData } = queued;
            const { mapX, mapY } = mapData;
            // Built before a loc change: the reload LocUpdates queued replaces it.
            if (queued.locVersion !== undefined && !this.locUpdates.isCurrent(mapX, mapY, queued.locVersion)) {
                continue;
            }
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
            const timeLoaded = existing ? existing.timeLoaded : performance.now() / 1000;
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
            autoFogDepthFactor: AUTO_FOG_DEPTH_FACTOR, manualFogDepth: 0, hd: this.osrsClient.hdPlugin?.isEnabled() });

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
        data[64] = 255.0; // colorBanding (WebGL default; shader divides by 255)
        data[65] = this.osrsClient.isNewTextureAnim ? 1.0 : 0.0;
        this.world.flushSceneUniforms();
    }

    override render(time: number, deltaTime: number, _resized: boolean): void {
        const world = this.world;
        if (!this.device || !world || !this.depthView) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        if (width < 1 || height < 1) return;

        const timeSec = time / 1000;
        const loggedIn = this.osrsClient.isLoggedIn();

        if (loggedIn) {
            // 117 HD camera feel: the scene-viewport widget consumes wheel input before the
            // camera could see it, so capture the raw wheel while the pointer is over the 3D
            // viewport (the UI keeps its own scroll everywhere else). updateFollowCamera
            // consumes and clears it.
            const inputManager = this.osrsClient.inputManager;
            if (
                this.osrsClient.hdPlugin?.isEnabled() === true &&
                this.osrsClient.followPlayerCamera &&
                inputManager.wheelDeltaY !== 0 &&
                inputManager.mouseX >= 0 &&
                inputManager.mouseY >= 0 &&
                this.osrsClient.camera.containsScreenPoint(inputManager.mouseX, inputManager.mouseY)
            ) {
                this.followCamWheel += inputManager.wheelDeltaY;
            }
            this.handleInput(deltaTime);
            // Deck interpolation runs before the camera: it projects the deck coordinates the
            // player stands in to their world position (camera.ts) and places each deck.
            const cycle = getClientCycle() | 0;
            this.updateClientTickPhase(timeSec);
            this.worldEntityAnimator?.tick(cycle);
            this.osrsClient.worldViewManager.interpolateEntities(cycle, this.clientTickPhase);
            updateWorldEntityMotion(this);
            ensureWorldEntityOverlaysLoaded(this, performance.now());
            updateFollowCamera(this, timeSec, deltaTime);
            this.osrsClient.camera.update(width, height, 0, 0, width, height);
            // The deck placement matrices are view-space, so they are rebuilt per camera frame.
            this.worldEntityAnimator?.compose(
                this.osrsClient.camera.viewMatrix as Float32Array,
            );
            // Swap in built squares before the visible list is made: replacing a square (a door
            // or loc rebuild) destroys the old one's buffers, and a frame that still draws it
            // fails as a whole, flashing the clear colour.
            if (this.instanceActive) this.applyInstanceScene(this.stats.frameCount);
            else this.applyReadyMaps(this.stats.frameCount);
            this.mapManager.update(
                this.osrsClient.camera.getPosX(),
                this.osrsClient.camera.getPosZ(),
                this.osrsClient.camera,
                this.stats.frameCount,
                this.osrsClient.mapRadius,
                -1,
                -1,
                this.osrsClient.expandedMapLoading | 0,
            );
            this.updateSkyColor();
            for (const map of this.mapManager.visibleMaps) {
                map.updateAnimatedLocs(this.osrsClient.seqFrameLoader, cycle);
            }
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
        world.selectExtension(!!extension?.isActive());

        // Same point the WebGL frame loop flushes queued client packets (render.ts login
        // early-out and in-game path).
        flushPackets();
        this.actors?.update(timeSec);
        this.overlays?.update(time, deltaTime);
        this.ui?.update(time, deltaTime);

        const encoder = this.device.createCommandEncoder();
        const visible = loggedIn ? this.mapManager.visibleMaps : [];
        const roofPlaneLimit = loggedIn ? computeWebGPURoofPlaneLimit(this) : 3;
        this.frameVisibleMaps = visible;
        this.frameRoofPlaneLimit = roofPlaneLimit;

        // The extension's own passes (117 HD: uniforms, lights, shadow map) go in the same
        // encoder, before the scene pass that samples them.
        if (world.extensionActive && loggedIn) {
            extension!.beforeScene?.(this, encoder);
        }

        const canvasView = this.context.getCurrentTexture().createView();
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
        // The HDR target holds linear light, so the display-referred sky clear is linearised;
        // the tonemap pass re-encodes it.
        const toLinear = (value: number) => Math.pow(Math.max(value, 0), 2.2);
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: hdrTarget ?? canvasView,
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
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: this.depthView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        if (loggedIn) {
            for (let i = 0; i < visible.length; i++) {
                if (visible[i].canRender(this.stats.frameCount)) {
                    visible[i].drawOpaque(pass, roofPlaneLimit);
                }
            }
            this.actors?.drawOpaque(pass);
            for (let i = visible.length - 1; i >= 0; i--) {
                if (visible[i].canRender(this.stats.frameCount)) {
                    visible[i].drawAlpha(pass, roofPlaneLimit);
                }
            }
            this.actors?.drawAlpha(pass);
            this.overlays?.drawWorld(pass);
        }

        pass.end();

        if (hdrTarget) {
            sceneExtension!.afterScene!(this, encoder, {
                colorTexture: this.sceneColorTexture!,
                colorView: hdrTarget,
                depthTexture: this.depthTexture!,
                depthView: this.depthView!,
                canvasView,
            });
        }

        // Overlays and UI that draw after the world, without depth (ToFrameTexture +
        // PostPresent until stage 5 adds an offscreen frame texture).
        const screenPass = encoder.beginRenderPass({
            colorAttachments: [{ view: canvasView, loadOp: "load", storeOp: "store" }],
        });
        if (loggedIn) {
            this.overlays?.drawScreen(screenPass);
        }
        this.ui?.draw(screenPass);
        screenPass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    /**
     * Draws this frame's world and actors with the scene extension's depth pipelines into
     * `pass` (a depth-only pass the extension began), in the WebGL drawActors order: world
     * opaque, world alpha, actors. A no-op without a depth shader.
     */
    drawSceneDepth(pass: GPURenderPassEncoder): void {
        const world = this.world;
        if (!world?.depthTextureBindGroup) return;
        pass.setBindGroup(SCENE_GROUP, world.sceneBindGroup);
        pass.setBindGroup(WORLD_TEXTURES_GROUP, world.depthTextureBindGroup);
        const visible = this.frameVisibleMaps;
        for (let i = 0; i < visible.length; i++) {
            if (visible[i].canRender(this.stats.frameCount)) {
                visible[i].drawDepth(pass, this.frameRoofPlaneLimit);
            }
        }
        this.actors?.drawDepth(pass);
    }

    hasPendingMapStreamingWork(): boolean {
        return this.mapsToLoad.length > 0;
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

    getProjectileManager(): IProjectileManager | undefined {
        return this.actors?.getProjectileManager();
    }

    override registerHitsplat(event: HitsplatEventPayload): void {
        this.overlays?.registerHitsplat(event);
    }

    override registerSpotAnimation(event: PlayerSpotAnimationEvent): void {
        this.actors?.registerSpotAnimation(event);
    }

    override registerNpcSpotAnimation(event: NpcSpotAnimationEvent): void {
        this.actors?.registerNpcSpotAnimation(event);
    }

    override registerWorldSpotAnimation(event: WorldSpotAnimationEvent): void {
        this.actors?.registerWorldSpotAnimation(event);
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
        this.heightValidAtTime = undefined;
    }

    override cleanUp(): void {
        this.locUpdates.dispose();
        this.actors?.dispose();
        this.overlays?.dispose();
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
    }
}
