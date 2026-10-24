import { Schema } from "leva/dist/declarations/src/types";

import { Renderer } from "./render/Renderer";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { isMobileMode } from "../common/utils/DeviceUtil";
import { clamp } from "../common/utils/MathUtil";
import { ProjectionType } from "./Camera";
import { OsrsRendererType } from "./GameRenderers";
import { getAxisDeadzone } from "./InputManager";
import { MapManager, MapSquare } from "./MapManager";
import { OsrsClient } from "./OsrsClient";
import type { CameraRotation } from "./plugins/ClientPluginManager";
import { IProjectileManager } from "./interfaces/IProjectileManager";
import type { PlayerSpotAnimationEvent } from "./sync/PlayerSyncTypes";
import type { WidgetsOverlay } from "../ui/devoverlay/WidgetsOverlay";
import { gammaFromScreenBrightness, loadScreenBrightness } from "../ui/ScreenBrightness";
import { multiLocVariants, multiLocVarps } from "../render/loc/MultiLocVarps";
import { getMapPlaneId, getMapSquareId } from "../rs/map/MapFileIndex";
import type { SdMapData } from "../render/loader/SdMapData";
import type { SdMapLoaderInput } from "../render/loader/SdMapLoaderInput";

/** Optional details of a LOC change (moves, rotations, shape changes). */
export type LocChangeOptions = {
    oldTile?: { x: number; y: number };
    newTile?: { x: number; y: number };
    oldRotation?: number;
    newRotation?: number;
    newShape?: number;
};

/** A server REGION replacement: new terrain/object data for one 64x64 region. */
export type RegionReplacementEvent = {
    regionId: number;
    allowReload: boolean;
    terrainData: Uint8Array;
    objectData?: Uint8Array;
};

/** A spot animation on an NPC (e.g. ice barrage or a whip special on its target). */
export type NpcSpotAnimationEvent = {
    npcServerId: number;
    spotId: number;
    height: number;
    startCycle: number;
    slot?: number;
};

/** A spot animation anchored to a tile. */
export type WorldSpotAnimationEvent = {
    spotId: number;
    tile: { x: number; y: number; level?: number };
    height?: number;
    startCycle: number;
    /** Repeats until killed (a client graphic, e.g. a loot beam), rather than playing once. */
    loop?: boolean;
};

export interface HitsplatEventPayload {
    targetType: "player" | "npc";
    targetId: number;
    damage: number;
    style?: number;
    tick?: number;
    /** OSRS secondary hitsplat type (var3 in SoundSystem.method877). */
    type2?: number;
    /** OSRS secondary hitsplat value (var4 in SoundSystem.method877). */
    damage2?: number;
    /** OSRS extra cycles added to the hitsplat lifetime (var6 in Actor.addHitSplat). */
    delayCycles?: number;
}

export abstract class GameRenderer<T extends MapSquare = MapSquare> extends Renderer {
    abstract type: OsrsRendererType;

    mapManager: MapManager<T>;
    uiHidden: boolean = false;
    widgetsOverlay?: WidgetsOverlay;
    private readonly minimapSources = new Map<number, SdMapLoaderInput>();
    private readonly minimapRequests = new Map<number, { source: SdMapLoaderInput; retryAt: number }>();

    registerMinimapSource(data: SdMapData): void {
        const input = data.minimapInput;
        if (!input || data.doorOnly || data.locOnly || input.instance || input.overrideRenderPos) return;
        this.minimapSources.set(getMapSquareId(data.mapX, data.mapY), { ...input, loadedTextureIds: new Set() });
        for (let level = 0; level < 4; level++) this.osrsClient.setMinimapImageUrl(data.mapX, data.mapY, undefined, level);
    }

    clearMinimapSources(): void {
        this.minimapSources.clear();
        this.minimapRequests.clear();
    }

    async requestMinimapImage(mapX: number, mapY: number, level: number): Promise<void> {
        if (!Number.isInteger(level) || level < 0 || level >= 4) return;
        const mapId = getMapSquareId(mapX, mapY);
        const source = this.minimapSources.get(mapId);
        if (!source) return;
        const key = getMapPlaneId(mapX, mapY, level);
        const pending = this.minimapRequests.get(key);
        if (pending?.source === source && pending.retryAt > Date.now()) return;
        const request = { source, retryAt: Infinity };
        this.minimapRequests.set(key, request);
        try {
            const data = await this.osrsClient.workerPool.queueMinimap(source, level);
            const blob = data?.minimapBlobs[level];
            if (blob && this.minimapSources.get(mapId) === source) {
                this.osrsClient.setMinimapImageUrl(mapX, mapY, URL.createObjectURL(blob), level);
            }
        } catch (error) {
            console.warn(`[minimap] floor ${level} load failed for ${mapX},${mapY}`, error);
        } finally {
            if (this.minimapRequests.get(key) === request) request.retryAt = Date.now() + 1000;
        }
    }

    // OSRS camera shake slots (0:X, 1:Y, 2:Z, 3:Yaw, 4:Pitch).
    public readonly cameraShakeEnabled: boolean[] = [false, false, false, false, false];
    public readonly cameraShakeRandomAmplitude: number[] = [0, 0, 0, 0, 0];
    public readonly cameraShakeWaveAmplitude: number[] = [0, 0, 0, 0, 0];
    public readonly cameraShakeWaveSpeed: number[] = [0, 0, 0, 0, 0];
    public readonly cameraShakeWavePhase: number[] = [0, 0, 0, 0, 0];
    public cameraShakeLastClientCycle: number = -1;

    setCameraShakeSlot(
        slot: number,
        randomAmplitude: number,
        waveAmplitude: number,
        waveSpeed: number,
        phase: number = 0,
    ): void {

        const idx = slot | 0;
        if (idx < 0 || idx >= 5) return;
        this.cameraShakeEnabled[idx] = true;
        this.cameraShakeRandomAmplitude[idx] = randomAmplitude | 0;
        this.cameraShakeWaveAmplitude[idx] = waveAmplitude | 0;
        this.cameraShakeWaveSpeed[idx] = waveSpeed | 0;
        this.cameraShakeWavePhase[idx] = phase | 0;
        this.cameraShakeLastClientCycle = -1;

    }

    clearCameraShakeSlot(slot: number): void {

        const idx = slot | 0;
        if (idx < 0 || idx >= 5) return;
        this.cameraShakeEnabled[idx] = false;
        this.cameraShakeRandomAmplitude[idx] = 0;
        this.cameraShakeWaveAmplitude[idx] = 0;
        this.cameraShakeWaveSpeed[idx] = 0;
        this.cameraShakeWavePhase[idx] = 0;

    }

    clearCameraShake(): void {

        for (let i = 0; i < 5; i++) {
            this.clearCameraShakeSlot(i);
        }
        this.cameraShakeLastClientCycle = -1;

    }

    computeCameraShakeOffsets(clientCycle: number): {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pitch: number;
        active: boolean;
    } {

        if (this.cameraShakeLastClientCycle < 0) {
            this.cameraShakeLastClientCycle = clientCycle;
        }
        let cyclesElapsed = (clientCycle - this.cameraShakeLastClientCycle) | 0;
        if (cyclesElapsed < 0 || cyclesElapsed > 200) {
            cyclesElapsed = 1;
        }
        if (cyclesElapsed > 0) {
            this.cameraShakeLastClientCycle = clientCycle;
        }

        let x = 0;
        let y = 0;
        let z = 0;
        let yaw = 0;
        let pitch = 0;
        let active = false;

        for (let i = 0; i < 5; i++) {
            if (!this.cameraShakeEnabled[i]) continue;
            active = true;
            if (cyclesElapsed > 0) {
                this.cameraShakeWavePhase[i] = (this.cameraShakeWavePhase[i] + cyclesElapsed) | 0;
            }
            const randomAmp = this.cameraShakeRandomAmplitude[i] | 0;
            const waveAmp = this.cameraShakeWaveAmplitude[i] | 0;
            const waveSpeed = this.cameraShakeWaveSpeed[i] | 0;
            const randomTerm = Math.random() * (randomAmp * 2 + 1) - randomAmp;
            const waveTerm = Math.sin((this.cameraShakeWavePhase[i] * waveSpeed) / 100.0) * waveAmp;
            const value = (randomTerm + waveTerm) | 0;

            switch (i) {
                case 0:
                    x += value;
                    break;
                case 1:
                    y += value;
                    break;
                case 2:
                    z += value;
                    break;
                case 3:
                    yaw += value;
                    break;
                case 4:
                    pitch += value;
                    break;
            }
        }

        return { x, y, z, yaw, pitch, active };

    }

    /** Temporary draw perturbation; leave the scripted movement targets untouched. */
    applyCameraShake(clientCycle: number): (() => void) | undefined {
        if (this.osrsClient.cameraShakeDisabled) return;
        const shake = this.computeCameraShakeOffsets(clientCycle);
        if (!shake.active) return;
        const camera = this.osrsClient.camera;
        const [x, y, z] = camera.pos;
        const yaw = camera.yaw;
        camera.pos[0] += shake.x / 128;
        camera.pos[1] += shake.y / 128;
        camera.pos[2] += shake.z / 128;
        camera.yaw = (yaw + shake.yaw) & 2047;
        if (shake.pitch) camera.setRenderPitchOverride(clamp(camera.getScenePitchAngle() + shake.pitch, 128, 383));
        return () => {
            camera.pos[0] = x; camera.pos[1] = y; camera.pos[2] = z;
            camera.yaw = yaw;
            camera.setRenderPitchOverride(undefined);
        };
    }

    /** Drops any cached roof visibility state so the next frame recomputes it. */
    invalidateRoofState(): void {}

    constructor(public osrsClient: OsrsClient) {
        super();
        // Keep the number of queued map loads low to cap memory spikes
        this.mapManager = new MapManager(osrsClient.workerPool.size, this.queueLoadMap.bind(this));
        this.mapManager.mapRemovedListeners.add((map) => {
            this.minimapSources.delete(getMapSquareId(map.mapX, map.mapY));
            for (let level = 0; level < 4; level++) this.minimapRequests.delete(getMapPlaneId(map.mapX, map.mapY, level));
        });
    }

    protected override getEffectiveFpsLimit(): number {
        // The GPU cap still honours the handheld's selected battery limit.
        const gpu = this.osrsClient.clientPlugins.gpuSettings();
        let limit = gpu ? gpu.fpsLimit : super.getEffectiveFpsLimit();
        let target = gpu && !isMobileMode ? 0 : Number(this.osrsClient.targetFps) | 0;
        // Never honor CS2 mobile battery caps (~20) on desktop.
        if (!isMobileMode && target > 0 && target < 60) {
            target = 0;
            this.osrsClient.targetFps = 0;
            if (this.fpsLimit > 0 && this.fpsLimit < 60) {
                this.fpsLimit = 0;
            }
        }
        if (target > 0) {
            limit = limit > 0 ? Math.min(limit, target) : target;
        }
        try {
            if (typeof document !== "undefined" && document.hidden) {
                limit = limit > 0 ? Math.min(limit, 30) : 30;
            }
        } catch {}
        return limit > 0 ? limit : 0;
    }

    override start(): void {
        try {
            this.osrsClient.startClientTickLoop();
        } catch {}
        super.start();
    }

    override stop(): void {
        try {
            this.osrsClient.stopClientTickLoop();
        } catch {}
        super.stop();
    }

    override async init() {
        this.osrsClient.inputManager.init(this.canvas);
    }

    override cleanUp(): void {
        this.clearMinimapSources();
        this.osrsClient.inputManager.cleanUp();
    }

    setUiHidden(hidden: boolean): void {
        this.uiHidden = !!hidden;
    }

    /** WebGL overrides this while streamed map work is still outstanding. */
    hasPendingMapStreamingWork(): boolean {
        return false;
    }

    /**
     * Clear session-specific caches to prevent memory leaks on logout/disconnect.
     * Subclasses should override to clear their accumulated session data.
     */
    clearSessionCaches(): void {
        // Base implementation does nothing - subclasses override
    }

    /**
     * Reset the loaded scene and its streaming state.
     *
     * A simple MapManager.clearMaps() only releases resident map squares; it
     * intentionally keeps the current-region coordinates so it can continue
     * normal streaming.  A new game session must also invalidate those
     * coordinates so logging back in at the same location schedules a fresh
     * scene load.
     */
    clearMaps(): void {
        this.mapManager.cleanUp();
    }

    initCache(): void {
        if (!this.osrsClient.loadedCache) return;
        this.mapManager.init(
            this.osrsClient.mapFileIndex,
            SceneBuilder.fillEmptyTerrain(this.osrsClient.loadedCache.info),
        );
    }

    /**
     * Initialize overlay assets from the cache.
     * Called during phased loading after cache is fully available.
     */
    initOverlays(): void {
        // Base implementation does nothing - subclasses override
    }

    getControls(): Schema {
        return {};
    }

    queueLoadMap(mapX: number, mapY: number, streamGeneration?: number): void {}

    /**
     * collision flags for route reconstruction (e.g. run-step traversal).
     * Default implementation returns 0 when not supported by the renderer.
     */
    getCollisionFlagAt(_plane: number, _tileX: number, _tileY: number): number {
        return 0;
    }

    handleInput(deltaTime: number) {
        // OSRS frame start: transfer click state (clickMode1 -> clickMode3)
        this.osrsClient.inputManager.onFrameStart();
        if (this.osrsClient.loginState.serverListOpen) {
            this.osrsClient.handleInGameServerListInput();
            return;
        }
        // Orbit only in-world; login keeps one-finger drag for list scrolling.
        this.osrsClient.inputManager.setTouchCameraOrbitEnabled(this.osrsClient.isLoggedIn());

        this.handleKeyInput(deltaTime);
        this.handleControllerInput(deltaTime);

        if (!this.uiHidden && (!this.osrsClient.inputManager.hasInteractionPointerOverride() ||
            this.osrsClient.inputManager.isWidgetInteractionPointer())) {
            // Process UI interaction BEFORE mouse input so widgets can consume scroll
            // before camera zoom uses it
            this.osrsClient.handleUiInput();
        } else if (!this.uiHidden) {
            // A pointer aimed at the world (the backquote crosshair) still drives widget hover,
            // so the game's mouseover tooltip follows it; its clicks stay with the world.
            this.osrsClient.handleUiHover();
        }
        if (!this.uiHidden) {
            this.osrsClient.runMouseFollowingTimers();
            // Update widget layout (CS2 positioning/sizing)
            this.osrsClient.updateWidgets();
        }

        // Mouse input (camera zoom) uses whatever wheel delta remains after UI
        this.handleMouseInput();
    }

    handleKeyInput(deltaTime: number) {
        this.startCameraRotation(deltaTime);
        if (this.osrsClient.editorCameraInput?.(deltaTime)) return;
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.osrsClient.inputManager;
        const camera = this.osrsClient.camera;

        let cameraSpeedMult = 1.0;
        if (inputManager.isShiftDown()) {
            cameraSpeedMult = 10.0;
        }
        if (inputManager.isKeyDown("Tab")) {
            cameraSpeedMult = 0.1;
        }

        // Arrow-key rotation speed tuned to OSRS pacing (~4s per revolution)
        const deltaPitch = 64 * 8 * deltaTimeSec; // ~90°/s
        const deltaYaw = 512 * deltaTimeSec; // 2048 units / 4s

        const pluginHandlesCameraKeys = this.osrsClient.clientPlugins.handleCameraKeys({
            camera,
            input: inputManager,
            deltaTime,
        });
        const rotation = this.cameraRotation;
        if (!pluginHandlesCameraKeys && inputManager.isKeyDown("ArrowUp")) {
            // Up tilts camera downward (increase positive pitch)
            rotation.keyPitch += deltaPitch;
        }
        if (!pluginHandlesCameraKeys && inputManager.isKeyDown("ArrowDown")) {
            // Down tilts camera upward (decrease positive pitch)
            rotation.keyPitch -= deltaPitch;
        }
        if (!pluginHandlesCameraKeys && inputManager.isKeyDown("ArrowRight")) {
            // Right rotates view to the right (negative yaw delta due to RS yaw basis)
            rotation.keyYaw -= deltaYaw;
        }
        if (!pluginHandlesCameraKeys && inputManager.isKeyDown("ArrowLeft")) {
            // Left rotates view to the left
            rotation.keyYaw += deltaYaw;
        }

        // camera position controls
        let deltaX = 0;
        let deltaY = 0;
        let deltaZ = 0;

        const deltaPos = 16 * (this.osrsClient.cameraSpeed * cameraSpeedMult) * deltaTimeSec;
        const deltaHeight = 8 * (this.osrsClient.cameraSpeed * cameraSpeedMult) * deltaTimeSec;

        if (!this.osrsClient.followPlayerCamera) {
            if (inputManager.isKeyDown("KeyW")) {
                // Forward
                deltaZ -= deltaPos;
            }
            if (inputManager.isKeyDown("KeyA")) {
                // Left
                deltaX += deltaPos;
            }
            if (inputManager.isKeyDown("KeyS")) {
                // Back
                deltaZ += deltaPos;
            }
            if (inputManager.isKeyDown("KeyD")) {
                // Right
                deltaX -= deltaPos;
            }
            if (inputManager.isKeyDown("KeyE") || inputManager.isKeyDown("KeyR")) {
                // Move up
                deltaY -= deltaHeight;
            }
            if (
                inputManager.isKeyDown("KeyQ") ||
                inputManager.isKeyDown("KeyC") ||
                inputManager.isKeyDown("KeyF")
            ) {
                // Move down
                deltaY += deltaHeight;
            }
        }

        if (!this.osrsClient.followPlayerCamera) {
            if (deltaX !== 0 || deltaZ !== 0) {
                camera.move(deltaX, 0, deltaZ);
            }
            if (deltaY !== 0) {
                camera.move(0, deltaY, 0);
            }
        }

        if (!this.osrsClient.followPlayerCamera) {
            if (inputManager.isKeyDown("KeyP")) {
                camera.snapToPosition(2780, undefined, 9537);
            }
        }

        // Toggle hover devoverlay with F3
        if (inputManager.isKeyDownEvent("F3")) {
            this.osrsClient.hoverOverlayEnabled = !this.osrsClient.hoverOverlayEnabled;
        }
    }

    handleMouseInput() {
        const inputManager = this.osrsClient.inputManager;
        const camera = this.osrsClient.camera;

        if (
            inputManager.isPointerLock() &&
            !this.osrsClient.clientPlugins.shouldKeepWorldMenuOpen()
        ) {
            this.osrsClient.closeMenu();
        }

        // mouse/touch controls
        const deltaMouseX = inputManager.getDeltaMouseX();
        const deltaMouseY = inputManager.getDeltaMouseY();

        const pluginHandlesCameraMouse = this.osrsClient.clientPlugins.handleCameraMouse({
            camera,
            input: inputManager,
            deltaTime: 0,
        });
        if (!pluginHandlesCameraMouse && !this.osrsClient.followPlayerCamera) {
            if (deltaMouseX !== 0 || deltaMouseY !== 0) {
                if (inputManager.isTouch) {
                    camera.move(0, clamp(-deltaMouseY, -100, 100) * 0.004, 0);
                } else {
                    camera.updatePitch(camera.pitch, deltaMouseY * 0.9);
                    camera.updateYaw(camera.yaw, deltaMouseX * 0.9);
                }
            }
        }

        // Middle-mouse camera drag (RuneLite style, works while following)
        const rotation = this.cameraRotation;
        rotation.dragPitch += inputManager.getDeltaCameraY() * -0.9;
        rotation.dragYaw += inputManager.getDeltaCameraX() * -0.9;

        // Middle-mouse held + scroll: rotate camera (RuneLite parity).
        const wheelScale = 0.005;
        rotation.dragPitch += inputManager.wheelCamDeltaY * wheelScale;
        rotation.dragYaw += inputManager.wheelCamDeltaX * -wheelScale;

        this.osrsClient.clientPlugins.transformCameraRotation(rotation);
        const pitch = rotation.keyPitch + rotation.dragPitch;
        const yaw = rotation.keyYaw + rotation.dragYaw;
        if (pitch !== 0) camera.updatePitch(camera.pitch, pitch);
        if (yaw !== 0) camera.updateYaw(camera.yaw, yaw);

        // Scroll wheel zoom.
        // Follow-camera zoom is driven by widget onScroll handlers on the main viewport root.
        const zoomDelta = inputManager.getCameraZoomDelta();
        const pluginHandlesCameraScroll = this.osrsClient.clientPlugins.handleCameraScroll({
            camera,
            input: inputManager,
            deltaTime: 0,
        });
        if (zoomDelta !== 0 && !pluginHandlesCameraScroll) {
            if (
                !this.osrsClient.followPlayerCamera &&
                camera.projectionType === ProjectionType.PERSPECTIVE
            ) {
                const zoomSpeed = 0.02; // tiles per wheel unit
                const clampedDelta = clamp(zoomDelta, -120, 120);
                if (clampedDelta !== 0) {
                    camera.move(0, 0, clampedDelta * zoomSpeed, true);
                    camera.updated = true;
                }
            } else if (camera.projectionType === ProjectionType.ORTHO) {
                // For ortho: higher value zooms in; wheel down (positive) zooms out
                const scale = 0.03;
                camera.orthoZoom = clamp(camera.orthoZoom + -zoomDelta * scale, 1, 60);
                camera.updated = true;
            }
        }
    }

    private cameraRotationState?: CameraRotation;

    /** This frame's player camera rotation: keys add to it, then handleMouseInput applies it. */
    private get cameraRotation(): CameraRotation {
        this.cameraRotationState ??= {
            camera: this.osrsClient.camera,
            deltaTime: 0,
            keyYaw: 0,
            keyPitch: 0,
            dragYaw: 0,
            dragPitch: 0,
        };
        return this.cameraRotationState;
    }

    private startCameraRotation(deltaTime: number): void {
        const rotation = this.cameraRotation;
        rotation.camera = this.osrsClient.camera;
        rotation.deltaTime = deltaTime;
        rotation.keyYaw = rotation.keyPitch = rotation.dragYaw = rotation.dragPitch = 0;
    }

    handleControllerInput(deltaTime: number) {
        const deltaPitch = deltaTime;
        const deltaYaw = deltaTime;

        const inputManager = this.osrsClient.inputManager;
        const camera = this.osrsClient.camera;

        // controller
        const gamepad = inputManager.getGamepad();

        if (gamepad && gamepad.connected && gamepad.mapping === "standard") {
            // A plugin (Backquote's controller play) takes the controller over from the debug camera.
            if (this.osrsClient.clientPlugins.handleGamepad({ gamepad, camera, input: inputManager, deltaTime })) {
                return;
            }
            let cameraSpeedMult = 0.01;
            // X, R1
            if (gamepad.buttons[0].pressed || gamepad.buttons[5].pressed) {
                cameraSpeedMult = 0.1;
            }

            const zone = 0.1;

            const leftX = getAxisDeadzone(gamepad.axes[0], zone);
            const leftY = getAxisDeadzone(-gamepad.axes[1], zone);
            const leftTrigger = gamepad.buttons[6].value;

            const rightX = getAxisDeadzone(gamepad.axes[2], zone);
            const rightY = getAxisDeadzone(-gamepad.axes[3], zone);
            const rightTrigger = gamepad.buttons[7].value;

            const trigger = leftTrigger - rightTrigger;

            if (leftX !== 0 || leftY !== 0 || trigger !== 0) {
                camera.move(
                    leftX * cameraSpeedMult * -deltaTime,
                    0,
                    leftY * cameraSpeedMult * -deltaTime,
                    false,
                );
                camera.move(0, trigger * cameraSpeedMult * -deltaTime, 0);
            }

            if (rightX !== 0) {
                camera.updateYaw(camera.yaw, deltaYaw * 1.5 * rightX);
            }
            if (rightY !== 0) {
                // Gamepad right stick: pushing up should tilt up (decrease pitch)
                camera.updatePitch(camera.pitch, -deltaPitch * 1.5 * rightY);
            }
        }
    }

    /** OSRS's gamma exponent (lower is brighter), from the Settings "Screen brightness" slider. */
    brightness: number = gammaFromScreenBrightness(loadScreenBrightness());

    registerHitsplat(_event: HitsplatEventPayload): void {}

    registerSpotAnimation(_event: PlayerSpotAnimationEvent): void {}

    registerNpcSpotAnimation(_event: NpcSpotAnimationEvent): void {}

    /** Plays a graphic on a tile; returns its id, for killWorldSpotAnimation. */
    registerWorldSpotAnimation(_event: WorldSpotAnimationEvent): number | undefined {
        return undefined;
    }

    /** Removes a graphic registerWorldSpotAnimation started (a looping one never ends by itself). */
    killWorldSpotAnimation(_id: number): void {}

    // World objects (LOC packets). Backends rebuild the affected map squares.
    onLocChange(
        _oldId: number,
        _newId: number,
        _tile: { x: number; y: number },
        _level: number,
        _opts?: LocChangeOptions,
    ): void {}

    onLocAddChange(
        _locId: number,
        _tile: { x: number; y: number },
        _level: number,
        _shape: number,
        _rotation: number,
    ): void {}

    onLocDel(_tile: { x: number; y: number }, _level: number, _shape: number, _rotation: number): void {}

    onLocAnim(
        _locId: number,
        _tile: { x: number; y: number },
        _level: number,
        _shape: number,
        _rotation: number,
        _animId: number,
    ): void {}

    refreshGamemodeWorldLocs(): void {}

    onRegionReplacement(_payload: RegionReplacementEvent): void {}

    private changedVarps = new Set<number>();
    /**
     * Each loaded square's multiloc variants as last built, with the loc arrays they were read
     * from; `pending` marks a rebuild this class asked for, whose new arrays are not known yet.
     */
    private multiLocBuilds = new Map<number, { ids: unknown; variants: string; pending: boolean }>();

    /**
     * A varp (or a varbit on it) changed. A multiloc's look is baked into its square's build, so
     * the loaded squares holding a multiloc that reads this varp are rebuilt; changes made together
     * (one server tick's varbits) rebuild each square once.
     */
    onVarpChange(varpId: number): void {
        if (this.changedVarps.size === 0) queueMicrotask(() => this.reloadMultiLocSquares());
        this.changedVarps.add(varpId | 0);
    }

    private reloadMultiLocSquares(): void {
        const changed = this.changedVarps;
        this.changedVarps = new Set();
        const client = this.osrsClient;
        const varbitLoader = client.varManager.varbitLoader;
        // Builds read the workers' copy of the vars, squares loaded later too.
        client.updateVars();
        if (!client.locTypeLoader || !varbitLoader) return;
        for (const map of this.mapManager.mapSquares.values()) {
            const varps = multiLocVarps((map as { tileLocIdsByLevel?: Int32Array[] }).tileLocIdsByLevel, client.locTypeLoader, varbitLoader);
            if (![...changed].some((varp) => varps.has(varp))) continue;
            const mapId = getMapSquareId(map.mapX, map.mapY);
            const ids = (map as { tileLocIdsByLevel?: Int32Array[] }).tileLocIdsByLevel;
            const variants = multiLocVariants(ids, client.locTypeLoader, client.varManager);
            const built = this.multiLocBuilds.get(mapId);
            if (built && built.variants === variants && (built.ids === ids || built.pending)) {
                // Still the old arrays: the rebuild asked for is in flight.
                this.multiLocBuilds.set(mapId, { ids, variants, pending: built.pending && built.ids === ids });
                continue;
            }
            this.multiLocBuilds.set(mapId, { ids, variants, pending: true });
            // A boat's deck is built from its template chunks, not loaded as a map square: a
            // plain reload of its square built an empty one in its place and the boat vanished
            // (boarding sets the sailing varbits its multilocs read).
            const deck = this.mapManager.worldEntityMapIds.has(mapId)
                ? client.worldViewManager.getWorldViewByOverlayMapId(mapId)
                : undefined;
            if (deck) this.scheduleWorldEntityLocRebuild(deck.id);
            else this.reloadMultiLocSquare(map.mapX, map.mapY);
        }
    }

    /** Rebuilds one loaded square's locs (backends override). */
    protected reloadMultiLocSquare(_mapX: number, _mapY: number): void {}

    /** Rebuilds a world entity's deck scene after its locs changed (backends override). */
    scheduleWorldEntityLocRebuild(_entityIndex: number): void {}

    // Instanced areas (REBUILD_REGION): the scene is one built map square while active.
    /** True while an instance scene replaces normal map streaming. */
    instanceActive: boolean = false;
    /** The map square the drawn instance scene is built as; it owns every NPC in the scene. */
    instanceSceneMap: { mapX: number; mapY: number } | null = null;

    async loadInstanceScene(
        _templateChunks: number[][][],
        _regionX: number,
        _regionY: number,
    ): Promise<void> {}

    clearInstance(): void {}

    abstract getProjectileManager(): IProjectileManager | undefined;

    override onFrameEnd(): void {
        super.onFrameEnd();

        // URL/search params syncing removed; no-op when camera updates

        this.osrsClient.inputManager.onFrameEnd();
        this.osrsClient.camera.onFrameEnd();
    }
}
