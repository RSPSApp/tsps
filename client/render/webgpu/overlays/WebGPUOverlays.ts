import type { HitsplatEventPayload } from "../../../game/GameRenderer";
import type { Ray } from "../../../game/math/Raycast";
import type { SdMapData } from "../../loader/SdMapData";
import type { WebGPUMapSquare } from "../WebGPUMapSquare";
import type { WebGPURenderer } from "../WebGPURenderer";
import { RENDER_CONSTANTS } from "../../render/constants";
import { ClickCrossLayer } from "./ClickCrossLayer";
import { GroundItemLabelLayer } from "./GroundItemLabelLayer";
import { GroundItemMeshes } from "./GroundItemMeshes";
import { HealthBarLayer } from "./HealthBarLayer";
import { HintArrowLayer } from "./HintArrowLayer";
import { HitsplatLayer } from "./HitsplatLayer";
import { InteractHighlightLayer } from "./InteractHighlightLayer";
import { OverlayHost } from "./OverlayHost";
import { OverheadPrayerLayer } from "./OverheadPrayerLayer";
import { OverheadTextLayer } from "./OverheadTextLayer";
import { getWorldResources } from "./rendererAccess";
import { ScreenLayer } from "./ScreenLayer";
import { TileMarkerLayer } from "./TileMarkerLayer";
import { TileTextLayer } from "./TileTextLayer";

type SceneClip = { x: number; y: number; width: number; height: number };

/**
 * WebGPU in-world overlays (stage 4): ground item labels and meshes, hitsplats, health bars,
 * overhead text/prayer, tile markers, click cross, interact highlight. Owned by
 * client/render/webgpu/overlays/. drawWorld runs inside the world pass (ToSceneFramebuffer,
 * depth available), drawScreen runs after it with no depth (ToFrameTexture + PostPresent until
 * stage 5 adds the frame texture).
 *
 * Draw order mirrors the WebGL OverlayManager phases: ToFrameTexture content (overhead text,
 * click cross) under PostPresent content (tile markers, tile text, ground labels, interact
 * highlight, health bars, overhead prayer, hitsplats), all clipped to the scene viewport.
 */
export class WebGPUOverlays {
    private host?: OverlayHost;
    private screen?: ScreenLayer;
    private groundMeshes?: GroundItemMeshes;
    private tileMarker?: TileMarkerLayer;
    private interactHighlight?: InteractHighlightLayer;
    private clickCross?: ClickCrossLayer;
    private groundItemLabels?: GroundItemLabelLayer;
    private hitsplats?: HitsplatLayer;

    getHost(): OverlayHost | undefined { return this.host; }

    /** Screen position to a world ray (HelmSteering), through the shared overlay host. */
    screenToRay(mouseX: number, mouseY: number): Ray | null {
        return this.host?.screenToRay(mouseX, mouseY) ?? null;
    }
    private healthBars?: HealthBarLayer;
    private overheadText?: OverheadTextLayer;
    private overheadPrayer?: OverheadPrayerLayer;
    private hintArrow?: HintArrowLayer;
    private tileText?: TileTextLayer;
    private initialized = false;

    constructor(protected readonly renderer: WebGPURenderer) {}

    async init(): Promise<void> {
        this.ensureInitialized();
    }

    /**
     * Idempotent init. The renderer calls `init()` after `WebGPUActors.init()`; if that sibling
     * subsystem throws, `init()` never runs, so `update()` retries here once world resources
     * exist. Stage-4 overlays must not be hostage to stage-3 init order.
     */
    private ensureInitialized(): void {
        if (this.initialized) return;
        const device = this.renderer.device;
        const format = this.renderer.format;
        const world = getWorldResources(this.renderer);
        if (!device || !format || !world) return;
        try {
            const host = this.renderer.interactionHost;
            const screen = new ScreenLayer(device, format);
            screen.init();

            const hitsplats = new HitsplatLayer(host, screen);
            const healthBars = new HealthBarLayer(host, screen);
            const overheadText = new OverheadTextLayer(host, screen);
            const overheadPrayer = new OverheadPrayerLayer(host, screen);
            const hintArrow = new HintArrowLayer(host, screen);
            const groundItemLabels = new GroundItemLabelLayer(host, screen);
            const tileText = new TileTextLayer(host, screen);
            const clickCross = new ClickCrossLayer(host, screen);
            const tileMarker = new TileMarkerLayer(
                host,
                device,
                format,
                world.sceneBindGroup,
                world.sceneUniformsLayout,
                world.extension?.sceneColorFormat,
            );
            const interactHighlight = new InteractHighlightLayer(
                host,
                device,
                format,
                world.sceneBindGroup,
                world.sceneUniformsLayout,
            );
            const groundMeshes = new GroundItemMeshes(this.renderer, device);

            // The WebGL population helpers resolve hitsplat/health-bar definitions through the
            // host's overlay references.
            host.hitsplatOverlay = hitsplats;
            host.healthBarOverlay = healthBars;
            host.clickCrossOverlay = clickCross;

            hitsplats.init();
            healthBars.init();
            overheadText.init();
            overheadPrayer.init();
            groundItemLabels.init();
            tileText.init();
            clickCross.init();
            tileMarker.init();
            interactHighlight.init();

            this.host = host;
            this.screen = screen;
            this.groundMeshes = groundMeshes;
            this.tileMarker = tileMarker;
            this.interactHighlight = interactHighlight;
            this.clickCross = clickCross;
            this.groundItemLabels = groundItemLabels;
            this.hitsplats = hitsplats;
            this.healthBars = healthBars;
            this.overheadText = overheadText;
            this.overheadPrayer = overheadPrayer;
            this.hintArrow = hintArrow;
            this.tileText = tileText;
            this.wireHealthBarEvents(host);
            this.initialized = true;
        } catch (error) {
            console.warn("[webgpu] overlays init failed", error);
        }
    }

    /**
     * OsrsClient delivers health-bar updates through `renderer.register*HealthBarUpdate` /
     * `clear*HealthBars` (the WebGL renderer defines them; WebGPURenderer does not). The pools
     * are stage-4's, so bind the entry points to this host without touching the renderer file.
     * Existing definitions win (a later renderer-side wire-up would shadow this).
     */
    private wireHealthBarEvents(host: OverlayHost): void {
        type PlayerEvent = Parameters<OverlayHost["registerPlayerHealthBarUpdate"]>[0];
        type NpcEvent = Parameters<OverlayHost["registerNpcHealthBarUpdate"]>[0];
        const renderer = this.renderer as unknown as {
            registerPlayerHealthBarUpdate?: (event: PlayerEvent) => void;
            registerNpcHealthBarUpdate?: (event: NpcEvent) => void;
            clearPlayerHealthBars?: (serverId: number) => void;
            clearNpcHealthBars?: (serverId: number) => void;
        };
        if (!renderer.registerPlayerHealthBarUpdate) {
            renderer.registerPlayerHealthBarUpdate = (event) => host.registerPlayerHealthBarUpdate(event);
        }
        if (!renderer.registerNpcHealthBarUpdate) {
            renderer.registerNpcHealthBarUpdate = (event) => host.registerNpcHealthBarUpdate(event);
        }
        if (!renderer.clearPlayerHealthBars) {
            renderer.clearPlayerHealthBars = (serverId) => host.clearPlayerHealthBars(serverId);
        }
        if (!renderer.clearNpcHealthBars) {
            renderer.clearNpcHealthBars = (serverId) => host.clearNpcHealthBars(serverId);
        }
    }

    update(timeMs: number, deltaMs: number): void {
        if (!this.initialized) this.ensureInitialized();
        const host = this.host;
        const screen = this.screen;
        if (!this.initialized || !host || !screen) return;
        try {
            // World interaction/hover first (WebGL frame order), then the overlay entry
            // population that reads the hovered tile it produced.
            host.updateInteractionFrame();
            host.populateFrame(timeMs, deltaMs);
            screen.begin();
            const bufW = this.renderer.canvas.width;
            const bufH = this.renderer.canvas.height;
            screen.setCanvasResolution(bufW, bufH);
            this.syncScale(this.renderer.getUiRenderMetrics(bufW, bufH).renderScaleX);

            this.clickCross?.setTime(timeMs);
            this.clickCross?.update(timeMs);
            this.groundMeshes?.update(host.osrsClient.groundItems.getAllStacks());
            this.tileMarker?.update(this.resolveTileMarkerConfig());
            this.interactHighlight?.update();
        } catch (error) {
            console.warn("[webgpu] overlays update failed", error);
        }
    }

    /** The canvas is at device pixel ratio; size sprites/text like WebGL's overlay scale sync (frame/render.ts). */
    private syncScale(scale: number): void {
        for (const layer of [this.overheadText, this.hitsplats, this.overheadPrayer, this.hintArrow, this.clickCross, this.groundItemLabels, this.tileText]) {
            if (layer) layer.scale = scale;
        }
        if (this.healthBars) this.healthBars.scale = scale * RENDER_CONSTANTS.HEALTH_BAR_VISUAL_SCALE;
    }

    /** World pass (depth available): ground item meshes and depth-aware tile markers. */
    drawWorld(pass: GPURenderPassEncoder): void {
        if (!this.initialized) return;
        const world = getWorldResources(this.renderer);
        const hdrActive = !!world?.extensionActive && !!world.extension?.sceneColorFormat;
        try {
            this.groundMeshes?.drawWorld(pass);
            this.tileMarker?.drawWorld(pass, hdrActive, world?.sampleCount ?? 1);
        } catch (error) {
            console.warn("[webgpu] overlays world draw failed", error);
        }
    }

    /** Screen pass (no depth): textured quads plus always-on-top markers and highlight compose. */
    drawScreen(pass: GPURenderPassEncoder): void {
        const screen = this.screen;
        if (!this.initialized || !screen) return;
        const clip = this.sceneClip();
        const canvas = this.renderer.canvas;
        try {
            pass.setScissorRect(clip.x, clip.y, clip.width, clip.height);

            // ToFrameTexture group (the hint arrow is WebGL's TutorialHintOverlay).
            this.overheadText?.draw();
            this.hintArrow?.draw();
            this.clickCross?.draw();
            screen.flush(pass, clip);

            // PostPresent group, in OverlayManager registration order: tile markers, tile
            // text, ground labels, interact highlight, health bars, head icons, hitsplats.
            this.tileMarker?.drawScreen(pass);
            this.tileText?.draw();
            this.groundItemLabels?.draw();
            screen.flush(pass, clip);
            this.interactHighlight?.drawScreen(pass);
            this.healthBars?.draw();
            this.overheadPrayer?.draw();
            this.hitsplats?.draw();
            screen.flush(pass, clip);
        } catch (error) {
            console.warn("[webgpu] overlays screen draw failed", error);
        } finally {
            pass.setScissorRect(0, 0, Math.max(1, canvas.width | 0), Math.max(1, canvas.height | 0));
        }
    }

    onMapAdded(map: WebGPUMapSquare, mapData: SdMapData): void {
        this.groundMeshes?.onMapAdded(map, mapData);
    }

    onMapRemoved(mapX: number, mapY: number): void {
        this.groundMeshes?.onMapRemoved(mapX, mapY);
    }

    registerHitsplat(event: HitsplatEventPayload): void {
        this.host?.registerHitsplat(event);
    }

    dispose(): void {
        this.hitsplats?.dispose();
        this.healthBars?.dispose();
        this.overheadText?.dispose();
        this.overheadPrayer?.dispose();
        this.hintArrow?.dispose();
        this.groundItemLabels?.dispose();
        this.tileText?.dispose();
        this.clickCross?.dispose();
        this.tileMarker?.dispose();
        this.interactHighlight?.dispose();
        this.groundMeshes?.dispose();
        this.screen?.destroy();

        this.host = undefined;
        this.screen = undefined;
        this.groundMeshes = undefined;
        this.tileMarker = undefined;
        this.interactHighlight = undefined;
        this.clickCross = undefined;
        this.groundItemLabels = undefined;
        this.hitsplats = undefined;
        this.healthBars = undefined;
        this.overheadText = undefined;
        this.overheadPrayer = undefined;
        this.hintArrow = undefined;
        this.tileText = undefined;
        this.initialized = false;
    }

    /** Scene viewport in device-pixel coordinates (WebGPU scissor is top-left origin). */
    private sceneClip(): SceneClip {
        const canvas = this.renderer.canvas;
        const width = Math.max(1, canvas.width | 0);
        const height = Math.max(1, canvas.height | 0);
        try {
            const rect = this.renderer.getSceneViewportWidgetRect();
            // A 1x1 rect means the UI layout is not built yet (login/loading, or a sibling
            // subsystem failed to init); fall back to the full canvas rather than scissor
            // every overlay away.
            if (rect && rect.width > 2 && rect.height > 2) {
                const x = Math.max(0, Math.floor(rect.x));
                const y = Math.max(0, Math.floor(rect.y));
                return {
                    x,
                    y,
                    width: Math.max(1, Math.min(width - x, Math.floor(rect.width))),
                    height: Math.max(1, Math.min(height - y, Math.floor(rect.height))),
                };
            }
        } catch {}
        return { x: 0, y: 0, width, height };
    }

    private resolveTileMarkerConfig(): {
        destinationTileColor: number;
        currentTileColor: number;
    } {
        try {
            const config = this.renderer.osrsClient.clientPlugins.tileMarkersConfig();
            return {
                destinationTileColor: config.destinationTileColor,
                currentTileColor: config.currentTileColor,
            };
        } catch {
            return { destinationTileColor: 0xa9a753, currentTileColor: 0xffffff };
        }
    }
}
