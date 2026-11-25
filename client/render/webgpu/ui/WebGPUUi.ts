import type { App as PicoApp } from "picogl";

import { getMapPlaneId } from "../../../rs/map/MapFileIndex";
import { Scene } from "../../../rs/scene/Scene";
import { RenderPhase } from "../../../ui/devoverlay/Overlay";
import type { OverlayUpdateArgs } from "../../../ui/devoverlay/Overlay";
import type { WidgetsOverlay } from "../../../ui/devoverlay/WidgetsOverlay";
import {
    createWidgetsOverlay,
    type WidgetsOverlayHost,
} from "../../../widgets/gl/widgetsOverlayFactory";
import type { WebGLOsrsRendererHost } from "../../render/hostInterface";
import {
    computeUiRenderMetrics as computeUiRenderMetricsQuality,
    getMobileGameplayUiScale,
    getSceneViewportWidgetRect as getSceneViewportWidgetRectQuality,
    getUiSurfaceCssSize,
} from "../../render/quality";
import type { MinimapIcon, SdMapData } from "../../loader/SdMapData";
import type { WebGPURenderer } from "../WebGPURenderer";
import { WebgpuUiPresentation } from "./presentation";

export interface UiRenderMetrics {
    layoutW: number;
    layoutH: number;
    renderScaleX: number;
    renderScaleY: number;
    renderOffsetX: number;
    renderOffsetY: number;
}

/**
 * WebGPU presentation/UI hosting (stage 5). The gameframe, HUD, menu and CS2 UI keep running in
 * their existing separate widget GL+canvas stack; this module hosts and drives it for the
 * WebGPU backend, and owns the login/loading presentation. Owned by client/render/webgpu/ui/.
 */
export class WebGPUUi {
    private readonly minimapIcons: Map<number, MinimapIcon[]> = new Map();
    private widgetsOverlay?: WidgetsOverlay;
    private widgetsHost?: WidgetsOverlayHost;
    private presentation?: WebgpuUiPresentation;
    private adapterApp?: { width: number; height: number; gl: { canvas: HTMLCanvasElement } };
    private widgetsCleared = true;
    private disposed = false;

    constructor(protected readonly renderer: WebGPURenderer) {}

    async init(): Promise<void> {
        const osrsClient = this.renderer.osrsClient;
        const canvas = this.renderer.canvas;

        this.presentation = new WebgpuUiPresentation(this.renderer, (bufW, bufH) =>
            this.computeUiRenderMetrics(bufW, bufH),
        );

        // The widget overlay reads the main app's width/height and gl.canvas only; this shim
        // provides exactly that surface over the WebGPU canvas.
        this.adapterApp = {
            width: Math.max(1, canvas.width | 0),
            height: Math.max(1, canvas.height | 0),
            gl: { canvas },
        };
        const adapter: WidgetsOverlayHost = {
            osrsClient,
            app: this.adapterApp as unknown as PicoApp,
            computeUiRenderMetrics: (bufW, bufH) => this.computeUiRenderMetrics(bufW, bufH),
            getInteractNpcModelLoader: () => this.renderer.interactionHost.getInteractNpcModelLoader(),
            getInteractLocModelLoader: () => this.renderer.interactionHost.getInteractLocModelLoader(),
        };
        this.widgetsHost = adapter;
        try {
            this.widgetsOverlay = createWidgetsOverlay(adapter);
        } catch (error) {
            console.error("[webgpu] widgets overlay init failed", error);
        }

        this.presentation.attachLoginLayer();
    }

    invalidateDefinitionCaches(): void {
        this.widgetsHost?.chatheadFactory?.clear();
        this.widgetsOverlay?.invalidateDefinitionCaches();
    }

    update(timeMs: number, deltaMs: number): void {
        const canvas = this.renderer.canvas;
        const bufW = Math.max(1, canvas.width | 0);
        const bufH = Math.max(1, canvas.height | 0);
        if (this.adapterApp) {
            this.adapterApp.width = bufW;
            this.adapterApp.height = bufH;
        }
        // Same source the WebGL renderer publishes for choose-option / overlay text scaling.
        (canvas as unknown as { __uiRenderScale?: number }).__uiRenderScale =
            this.getUiRenderMetrics(bufW, bufH).renderScaleX;

        this.presentation?.update(timeMs, deltaMs);

        if (!this.widgetsOverlay) return;
        if (this.renderer.osrsClient.isLoggedIn() && !this.renderer.uiHidden) {
            this.widgetsOverlay.update({} as OverlayUpdateArgs);
            this.widgetsCleared = false;
        } else if (!this.widgetsCleared) {
            this.widgetsOverlay.clearAndHide();
            this.widgetsCleared = true;
        }
    }

    /** Login/loading quads when they need the WebGPU canvas; null when only DOM layers changed. */
    draw(pass: GPURenderPassEncoder | null): void {
        void pass;
        if (this.widgetsCleared || this.renderer.uiHidden || !this.widgetsOverlay) return;
        if (!this.renderer.osrsClient.isLoggedIn()) return;
        // The widget stack composites its own DOM canvas; the GPU pass is unused, but the draw
        // is driven here so it lands after the world exactly like the WebGL PostPresent pass.
        this.widgetsOverlay.draw(RenderPhase.PostPresent);
    }

    getWidgetsGLCanvas(): HTMLCanvasElement | undefined {
        return this.widgetsOverlay?.getGLCanvas();
    }

    computeUiRenderMetrics(bufW: number, bufH: number): UiRenderMetrics {
        return computeUiRenderMetricsQuality(this.createQualityHost(), bufW, bufH);
    }

    getUiRenderMetrics(bufW: number, bufH: number): UiRenderMetrics {
        return this.computeUiRenderMetrics(bufW, bufH);
    }

    getSceneViewportWidgetRect(): { x: number; y: number; width: number; height: number } {
        return getSceneViewportWidgetRectQuality(this.createQualityHost());
    }

    getMinimapIcons(mapX: number, mapY: number, level: number = 0): MinimapIcon[] | undefined {
        return this.minimapIcons.get(getMapPlaneId(mapX | 0, mapY | 0, level | 0));
    }

    registerMinimapData(mapData: SdMapData): void {
        if (mapData.minimapInput) this.renderer.registerMinimapSource(mapData);
        const osrsClient = this.renderer.osrsClient;
        const mapX = mapData.mapX | 0;
        const mapY = mapData.mapY | 0;
        for (let level = 0; level < Scene.MAX_LEVELS; level++) {
            const blob = mapData.minimapBlobs?.[level];
            if (blob) {
                const url = URL.createObjectURL(blob);
                if (typeof osrsClient.setMinimapImageUrl === "function") {
                    osrsClient.setMinimapImageUrl(mapX, mapY, url, level);
                } else {
                    osrsClient.minimapImageUrls.set(getMapPlaneId(mapX, mapY, level), url);
                }
            }

            const key = getMapPlaneId(mapX, mapY, level);
            const icons = mapData.minimapIcons?.[level];
            if (icons === undefined) continue;
            if (icons.length > 0) {
                this.minimapIcons.set(key, icons);
            } else {
                this.minimapIcons.delete(key);
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        try {
            this.widgetsOverlay?.dispose();
        } catch {}
        this.widgetsOverlay = undefined;
        this.widgetsHost = undefined;
        this.presentation?.dispose();
        this.presentation = undefined;
        this.minimapIcons.clear();
        this.adapterApp = undefined;
    }

    /**
     * Structurally-typed WebGL renderer stand-in for the shared quality helpers. They read
     * canvas, app size, osrsClient and these three methods; no GL calls happen in them.
     */
    private createQualityHost(): WebGLOsrsRendererHost {
        const canvas = this.renderer.canvas;
        const shim: Record<string, unknown> = {
            canvas,
            app: { width: canvas.width, height: canvas.height },
            osrsClient: this.renderer.osrsClient,
        };
        shim.getUiSurfaceCssSize = (bufW: number, bufH: number) =>
            getUiSurfaceCssSize(shim as unknown as WebGLOsrsRendererHost, bufW, bufH);
        shim.getMobileGameplayUiScale = (
            cssW: number,
            cssH: number,
            bufW: number,
            bufH: number,
        ) =>
            getMobileGameplayUiScale(
                shim as unknown as WebGLOsrsRendererHost,
                cssW,
                cssH,
                bufW,
                bufH,
            );
        shim.computeUiRenderMetrics = (bufW: number, bufH: number) =>
            computeUiRenderMetricsQuality(shim as unknown as WebGLOsrsRendererHost, bufW, bufH);
        return shim as unknown as WebGLOsrsRendererHost;
    }
}
