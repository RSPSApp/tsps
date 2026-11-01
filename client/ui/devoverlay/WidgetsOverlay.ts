import { App as PicoApp, Program } from "picogl";

import { CacheIndex } from "../../rs/cache/CacheIndex";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { ClientState } from "../../game/ClientState";
import { isLowEndDevice, isTouchDevice } from "../../common/utils/DeviceUtil";
import { getUiScale } from "../UiScale";
import { FONT_BOLD_12, FONT_VERDANA_13 } from "../fonts";
import { getChooseOptionMenuRect } from "../../widgets/gl/choose-option";

import { GLRenderer } from "../../widgets/gl/renderer";
import {
    GLRenderOpts,
    beginWidgetUiFrame,
    detachGLUI,
    processWidgetUiInput,
    renderWidgetTreeGL,
} from "../../widgets/gl/widgets-gl";
import { drawTextGL } from "../../widgets/components/TextRenderer";
import type { WidgetManager } from "../../widgets/WidgetManager";
import type { WidgetNode } from "../../widgets/WidgetNode";
import type { GameFrameDrawContext, WidgetOverlay } from "../../game/plugins/ClientPluginManager";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";
import { isCurrentClientType, reportedClientType } from "../../rs/cs2/ClientType";

/**
 * The enhanced client's mouseover text setting, mouseover_text_disabled from rev 241 (it was
 * 12377, mouseover_text_enabled). For clienttype 10 the game draws that text itself (cache
 * script 4726, while this is 0) and lays HUD overlays out below it (4731).
 */
const VARBIT_MOUSEOVER_TEXT_DISABLED = 10035;

export interface WidgetsContext {
    getCacheSystem: () => CacheSystem;
    getFontLoader?: () => (id: number) => BitmapFont | undefined;
    getWidgetRoot?: () => any; // Legacy single-root fallback
    getWidgetRoots?: () => any[]; // Optional layered roots (viewport + modals)
    getWidgetManager?: () => WidgetManager | undefined;
    getItemIconCanvas?: () => (
        itemId: number,
        qty?: number,
        outline?: number,
        shadow?: number,
        quantityMode?: number,
    ) => HTMLCanvasElement | undefined;
    getObjLoader?: () => any;
    // Optional game context for plugins (e.g., player ECS, map state)
    getGameContext?: () => any;
    getRenderModelCanvas?: () => (
        modelId: number,
        params: any,
        width: number,
        height: number,
    ) => { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined;
}

type WidgetRenderEntry = {
    root: any;
    renderOpts: GLRenderOpts;
};

/**
 * Side-panel widgets the widget overlays anchor to: the fixed 317 side panels, the
 * resizable side container and the modern side background. Overlays are drawn right after
 * one of these is drawn, so later widgets (tooltips, menus) stay on top of them.
 */
const WIDGET_OVERLAY_ANCHORS = new Set<number>([
    (548 << 16) | 80, // Toplevel.SIDE_PANELS
    (161 << 16) | 73, // ToplevelOsrsStretch.SIDE_CONTAINER
    (164 << 16) | 70, // ToplevelPreEoc.SIDE_BACKGROUND
]);

export type OverlayRedrawPlan = {
    /** The overlays drawn differ from last pass (a plugin toggled): everything redraws. */
    setChanged: boolean;
    /** A changed overlay cannot say where it draws: everything redraws. */
    needsFullRedraw: boolean;
    /** Where the changed overlays were and will be, when every one of them could say. */
    dirtyRects: DirtyRect[];
};

/**
 * Decides how the overlays' changes since the last pass redraw. Polls every overlay's
 * signature (and records it): a changed overlay with `coverage()` contributes its previous and
 * coming rects, one without forces a full redraw.
 */
export function planWidgetOverlayRedraw(
    overlays: readonly WidgetOverlay[],
    previous: readonly WidgetOverlay[],
    signatures: WeakMap<WidgetOverlay, string>,
    rects: WeakMap<WidgetOverlay, DirtyRect[]>,
    clamp: (x: number, y: number, w: number, h: number) => DirtyRect | undefined,
): OverlayRedrawPlan {
    const setChanged =
        overlays.length !== previous.length || overlays.some((overlay, i) => overlay !== previous[i]);
    const dirtyRects: DirtyRect[] = [];
    let needsFullRedraw = false;
    for (const overlay of overlays) {
        const signature = overlay.signature();
        if (signature === signatures.get(overlay)) continue;
        signatures.set(overlay, signature);
        if (needsFullRedraw) continue;
        const coverage = overlay.coverage?.();
        if (!coverage) {
            needsFullRedraw = true;
            continue;
        }
        for (const rect of rects.get(overlay) ?? []) dirtyRects.push(rect);
        for (const r of coverage) {
            const rect = clamp(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w) + 1, Math.ceil(r.h) + 1);
            if (rect) dirtyRects.push(rect);
        }
    }
    return { setChanged, needsFullRedraw, dirtyRects };
}

type DirtyRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

type MouseOverTextVisualState = {
    signature: string;
    text?: string;
    rect?: DirtyRect;
    x?: number;
    y?: number;
};

export class WidgetsOverlay implements Overlay {
    getWidgetInputPoint(widget: WidgetNode): { x: number; y: number } | undefined {
        if (widget._absX === undefined || widget._absY === undefined) return undefined;
        return {
            x: (widget._absX + (widget._absWidth ?? widget.width) / 2) / this.overlayScaleX,
            y: (widget._absY + (widget._absHeight ?? widget.height) / 2) / this.overlayScaleY,
        };
    }

    private app!: PicoApp;
    private glRenderer?: GLRenderer;
    private overlayCanvas?: HTMLCanvasElement;
    private renderCanvas?: HTMLCanvasElement;
    private overlayScaleX: number = 1;
    private overlayScaleY: number = 1;
    private widgetEntries: WidgetRenderEntry[] = [];
    /** Overlays for the current pass, drawn from inside the tree at an anchor widget. */
    private currentWidgetOverlays: WidgetOverlay[] | null = null;
    private overlayDrawnThisPass = false;
    private visible: Map<number, boolean> = new Map();
    private hasPresentedFrame: boolean = false;

    // PERF: Cached arrays and objects to avoid per-frame allocations
    private cachedRootSources: any[] = [];
    // PERF: Cached baseRenderOpts to avoid creating object with arrow functions every frame
    private cachedBaseRenderOpts: Omit<
        GLRenderOpts,
        "rootOffsetX" | "rootOffsetY" | "rootScale" | "rootScaleX" | "rootScaleY"
    > | null = null;
    // Tracks root-set changes so we can force one full redraw/input rebuild.
    private lastRootSignature: string = "";
    private rootSetChanged: boolean = true;

    private lastMenuVisualSignature: string = "";
    /** The overlays drawn last pass, in order: a different set redraws the whole UI. */
    private lastWidgetOverlays: WidgetOverlay[] = [];
    /** Each overlay's signature and device rects as of its last draw, for partial overlay redraws. */
    private readonly lastOverlaySignatures = new WeakMap<WidgetOverlay, string>();
    private readonly lastOverlayRects = new WeakMap<WidgetOverlay, DirtyRect[]>();
    /** Device rects the above-widget overlays drew last. */
    private widgetOverlayRects: DirtyRect[] = [];
    /** Device rects the below-widget overlays drew last. */
    private belowWidgetOverlayRects: DirtyRect[] = [];
    private lastMenuVisualRect?: DirtyRect;
    private lastTradeAmountOverlaySignature: string = "";
    private lastMouseOverTextSignature: string = "";
    private lastMouseOverTextRect?: DirtyRect;

    // Public property to enable/disable the overlay
    public enabled: boolean = true;

    constructor(
        program: Program,
        private ctx: WidgetsContext,
    ) {
        void program;
    }

    /**
     * Get the GL canvas where the click registry is stored.
     * Used for cleaning up click targets when interfaces close.
     */
    getGLCanvas(): HTMLCanvasElement | undefined {
        return this.glRenderer?.canvas as HTMLCanvasElement | undefined;
    }

    /** Rebuild type-dependent widget models, including portraits already baked into textures. */
    invalidateDefinitionCaches(): void {
        const canvas = this.getGLCanvas() as (HTMLCanvasElement & {
            __modelRenderCache?: Map<string, unknown>;
            __animatedModelMemo?: Map<number, unknown>;
        }) | undefined;
        for (const key of canvas?.__modelRenderCache?.keys() ?? []) this.glRenderer?.deleteTexture(key);
        for (const uid of canvas?.__animatedModelMemo?.keys() ?? []) this.glRenderer?.deleteTexture(`wm:dyn:${uid}`);
        canvas?.__modelRenderCache?.clear();
        canvas?.__animatedModelMemo?.clear();
        this.ctx.getWidgetManager?.()?.invalidateAll();
        this.hasPresentedFrame = false;
        this.rootSetChanged = true;
    }

    dispose(): void {
        if (this.glRenderer) {
            try {
                detachGLUI(this.glRenderer);
            } catch {}
        }
        this.glRenderer = undefined;
        this.renderCanvas = undefined;
        if (this.overlayCanvas?.parentElement) {
            try {
                this.overlayCanvas.parentElement.removeChild(this.overlayCanvas);
            } catch {}
        }
        this.overlayCanvas = undefined;
        this.hasPresentedFrame = false;
        this.rootSetChanged = true;
        this.lastRootSignature = "";
        this.lastWidgetOverlays = [];
        this.widgetOverlayRects = [];
        this.belowWidgetOverlayRects = [];
        this.lastMenuVisualSignature = "";
        this.lastMenuVisualRect = undefined;
        this.lastTradeAmountOverlaySignature = "";
        this.lastMouseOverTextSignature = "";
        this.lastMouseOverTextRect = undefined;
    }

    clearAndHide(): void {
        this.clearOverlayCanvas();
        if (this.overlayCanvas) {
            this.overlayCanvas.style.display = "none";
        }
    }

    init(args: OverlayInitArgs): void {
        this.dispose();
        this.app = args.app;

        // Render widgets into a real transparent overlay canvas stacked above the
        // scene canvas so we avoid re-uploading and re-compositing a full-screen
        // widget texture every frame.
        this.overlayCanvas = document.createElement("canvas");
        this.overlayCanvas.width = this.app.width;
        this.overlayCanvas.height = this.app.height;
        this.overlayCanvas.style.position = "absolute";
        this.overlayCanvas.style.inset = "0";
        this.overlayCanvas.style.width = "100%";
        this.overlayCanvas.style.height = "100%";
        this.overlayCanvas.style.pointerEvents = "none";
        this.overlayCanvas.style.background = "transparent";
        this.attachOverlayCanvas();

        // Initialize GL renderer for widgets
        try {
            this.renderCanvas = document.createElement("canvas");
            this.renderCanvas.width = this.overlayCanvas.width;
            this.renderCanvas.height = this.overlayCanvas.height;
            this.glRenderer = new GLRenderer(this.renderCanvas);
            const overlaySize = this.getOverlayRenderSize();
            this.glRenderer.resize(overlaySize.width, overlaySize.height);
        } catch (e) {
            console.error("Failed to initialize GLRenderer for widgets:", e);
        }
    }

    update(args: OverlayUpdateArgs): void {
        void args;
        if (!this.glRenderer || !this.overlayCanvas) {
            console.warn("WidgetsOverlay: No GL renderer or canvas");
            return;
        }

        this.attachOverlayCanvas();

        // Update canvas size if needed
        const overlaySize = this.getOverlayRenderSize();
        if (
            this.overlayCanvas.width !== overlaySize.width ||
            this.overlayCanvas.height !== overlaySize.height ||
            this.glRenderer.canvas.width !== overlaySize.width ||
            this.glRenderer.canvas.height !== overlaySize.height
        ) {
            this.overlayCanvas.width = overlaySize.width;
            this.overlayCanvas.height = overlaySize.height;
            this.glRenderer.resize(overlaySize.width, overlaySize.height);
            this.hasPresentedFrame = false;
            this.rootSetChanged = true;
            console.log(`WidgetsOverlay: Resized to ${overlaySize.width}x${overlaySize.height}`);
        }

        // PERF: Reuse cached array instead of allocating new one each frame
        const rootSources = this.cachedRootSources;
        rootSources.length = 0;
        if (typeof this.ctx.getWidgetRoots === "function") {
            const layered = this.ctx.getWidgetRoots();
            if (Array.isArray(layered)) {
                for (const root of layered) if (root) rootSources.push(root);
            }
        }
        if (!rootSources.length) {
            const single = this.ctx.getWidgetRoot?.();
            if (single) rootSources.push(single);
        }

        // PERF: Build signature without .map() to avoid intermediate array allocation
        let signature = "";
        for (let i = 0; i < rootSources.length; i++) {
            const root = rootSources[i];
            if (i > 0) signature += ",";
            signature += root && typeof root.uid === "number" ? root.uid : (root?.groupId ?? "");
        }
        if (signature !== this.lastRootSignature) {
            this.lastRootSignature = signature;
            this.rootSetChanged = true;
        }

        // PERF: Reuse cached baseRenderOpts, only update changing values
        const cacheSystem = this.ctx.getCacheSystem();
        let spriteIndex;
        try {
            spriteIndex = cacheSystem.getIndex(8); // Sprites index
        } catch (e) {
            console.warn("WidgetsOverlay: Could not get sprites index:", e);
        }
        const hostCanvas = this.app.gl.canvas as HTMLCanvasElement;

        // Create baseRenderOpts once, then update only changing fields
        if (!this.cachedBaseRenderOpts) {
            this.cachedBaseRenderOpts = {
                spriteIndex: spriteIndex as CacheIndex,
                fontLoader: this.ctx.getFontLoader?.() || (() => undefined),
                visible: this.visible,
                debug: false,
                hostW: this.app.width,
                hostH: this.app.height,
                hostCanvas: hostCanvas || undefined,
                itemIconCanvas: this.ctx.getItemIconCanvas?.(),
                objLoader: this.ctx.getObjLoader?.(),
                renderModelCanvas: this.ctx.getRenderModelCanvas?.(),
                game: this.ctx.getGameContext?.(),
                getCacheSystem: () => this.ctx.getCacheSystem(),
                widgetManager: this.ctx.getWidgetManager?.(),
                requestRepaintAll: () => {
                    // The overlay is redrawn every PostPresent; no extra action needed
                },
                openGroup: (groupId: number | string) => {
                    try {
                        let gid: number | undefined;
                        if (typeof groupId === "number") {
                            gid = groupId;
                        } else if (groupId === "skill_guide") {
                            gid = 214;
                        } else if (groupId === "equipment_stats") {
                            gid = 84;
                        }

                        if (gid !== undefined) {
                            const client = this.ctx.getGameContext?.()?.osrsClient;
                            if (client?.widgetSessionManager) {
                                client.widgetSessionManager.open(gid, { modal: true });
                            }
                        }
                    } catch (e) {
                        console.error("Failed to open group", groupId, e);
                    }
                },
            };
        }
        // Update only the fields that may change each frame
        const baseRenderOpts = this.cachedBaseRenderOpts;
        baseRenderOpts.spriteIndex = spriteIndex as CacheIndex;
        baseRenderOpts.hostW = overlaySize.width;
        baseRenderOpts.hostH = overlaySize.height;
        baseRenderOpts.hostCanvas = hostCanvas || undefined;
        baseRenderOpts.widgetManager = this.ctx.getWidgetManager?.();
        baseRenderOpts.game = this.ctx.getGameContext?.();
        const activeGameFrame = this.ctx.getGameContext?.()?.osrsClient?.clientPlugins?.activeGameFrame?.();
        baseRenderOpts.hideStockChrome = activeGameFrame?.hideStockChrome?.() === true;
        baseRenderOpts.rootGroupId = this.ctx.getWidgetManager?.()?.rootInterface;

        // PERF: Reuse cached array instead of allocating new one each frame
        this.widgetEntries.length = 0;
        for (const source of rootSources) {
            const entry = this.prepareWidgetEntry(source, baseRenderOpts);
            if (entry) this.widgetEntries.push(entry);
        }
    }

    private prepareWidgetEntry(
        root: any,
        baseRenderOpts: Omit<
            GLRenderOpts,
            "rootOffsetX" | "rootOffsetY" | "rootScale" | "rootScaleX" | "rootScaleY"
        >,
    ): WidgetRenderEntry | undefined {
        if (!root) return undefined;
        // Layout is done by computeWidgetRoots() - don't re-layout here
        // Widgets position themselves via their xPositionMode/yPositionMode alignment.
        // No external centering needed - just render at computed positions.
        // Keep legacy GL hover/tooltip text disabled; CS2-generated tooltip widgets are canonical.
        const gameFrame = this.ctx.getGameContext?.()?.osrsClient?.clientPlugins?.activeGameFrame?.();
        const renderOpts: GLRenderOpts = {
            ...baseRenderOpts,
            widgetRules: gameFrame?.widgetRules?.(),
            keepChromeUids: gameFrame?.keepChrome?.(),
            widgetOverlayAnchors: WIDGET_OVERLAY_ANCHORS,
            widgetOverlayAnchorDrawn: () => this.drawWidgetOverlaysAtAnchor(),
            rootOffsetX:
                typeof (root as any).__widgetRenderOffsetX === "number"
                    ? Math.round(Number((root as any).__widgetRenderOffsetX) * this.overlayScaleX)
                    : 0,
            rootOffsetY:
                typeof (root as any).__widgetRenderOffsetY === "number"
                    ? Math.round(Number((root as any).__widgetRenderOffsetY) * this.overlayScaleY)
                    : 0,
            rootScale:
                typeof (root as any).__widgetRenderScale === "number"
                    ? Number((root as any).__widgetRenderScale) * this.overlayScaleX
                    : 1.0,
            rootScaleX:
                typeof (root as any).__widgetRenderScaleX === "number"
                    ? Number((root as any).__widgetRenderScaleX) * this.overlayScaleX
                    : undefined,
            rootScaleY:
                typeof (root as any).__widgetRenderScaleY === "number"
                    ? Number((root as any).__widgetRenderScaleY) * this.overlayScaleY
                    : undefined,
            skipTooltip: true,
        };
        return { root, renderOpts };
    }

    private clampRectToCanvas(x: number, y: number, w: number, h: number): DirtyRect | undefined {
        const canvasW = this.glRenderer?.width ?? this.app.width;
        const canvasH = this.glRenderer?.height ?? this.app.height;
        const x0 = Math.max(0, x | 0);
        const y0 = Math.max(0, y | 0);
        const x1 = Math.min(canvasW, (x | 0) + Math.max(0, w | 0));
        const y1 = Math.min(canvasH, (y | 0) + Math.max(0, h | 0));
        if (x1 <= x0 || y1 <= y0) return undefined;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    private getRootRect(widgetManager: WidgetManager, root: any): DirtyRect | undefined {
        const rootIndex = root && typeof root.rootIndex === "number" ? root.rootIndex | 0 : -1;
        if (rootIndex < 0 || rootIndex >= widgetManager.rootWidgetCount) return undefined;
        return this.clampRectToCanvas(
            Math.round((widgetManager.rootWidgetXs[rootIndex] | 0) * this.overlayScaleX),
            Math.round((widgetManager.rootWidgetYs[rootIndex] | 0) * this.overlayScaleY),
            Math.round((widgetManager.rootWidgetWidths[rootIndex] | 0) * this.overlayScaleX),
            Math.round((widgetManager.rootWidgetHeights[rootIndex] | 0) * this.overlayScaleY),
        );
    }

    private getWidgetDirtyRect(widget: any): DirtyRect | undefined {
        const x = Number(widget?._absX);
        const y = Number(widget?._absY);
        const w = Number(widget?._absWidth);
        const h = Number(widget?._absHeight);
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(w) ||
            !Number.isFinite(h)
        ) {
            return undefined;
        }
        return this.clampRectToCanvas(
            Math.floor(x) - 1,
            Math.floor(y) - 1,
            Math.ceil(w) + 2,
            Math.ceil(h) + 2,
        );
    }

    private rectsIntersect(a: DirtyRect, b: DirtyRect): boolean {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    private rectsOverlapOrTouch(a: DirtyRect, b: DirtyRect): boolean {
        return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
    }

    private mergeDirtyRects(rects: DirtyRect[]): DirtyRect[] {
        if (rects.length <= 1) return rects;
        const merged: DirtyRect[] = [];
        for (const rect of rects) {
            let current = rect;
            let changed = true;
            while (changed) {
                changed = false;
                for (let i = 0; i < merged.length; i++) {
                    const existing = merged[i];
                    if (!this.rectsOverlapOrTouch(current, existing)) continue;
                    const x0 = Math.min(current.x, existing.x);
                    const y0 = Math.min(current.y, existing.y);
                    const x1 = Math.max(current.x + current.w, existing.x + existing.w);
                    const y1 = Math.max(current.y + current.h, existing.y + existing.h);
                    current = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
                    merged.splice(i, 1);
                    changed = true;
                    break;
                }
            }
            merged.push(current);
        }
        return merged;
    }

    private clearOffscreenRect(rect: DirtyRect): void {
        if (!this.glRenderer) return;
        const gl = this.glRenderer.gl;
        const canvasW = this.glRenderer.width | 0;
        const canvasH = this.glRenderer.height | 0;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(rect.x, canvasH - (rect.y + rect.h), rect.w, rect.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.scissor(0, 0, canvasW, canvasH);
    }

    private attachOverlayCanvas(): void {
        const overlayCanvas = this.overlayCanvas;
        if (!overlayCanvas) return;
        const hostCanvas = this.app?.gl?.canvas as HTMLCanvasElement | undefined;
        const parent = hostCanvas?.parentElement;
        if (!parent) return;
        overlayCanvas.style.display = "";
        if (overlayCanvas.parentElement === parent) return;
        if (overlayCanvas.parentElement) {
            try {
                overlayCanvas.parentElement.removeChild(overlayCanvas);
            } catch {}
        }
        parent.appendChild(overlayCanvas);
    }

    private sizeCache: { w: number; h: number; at: number; size: { width: number; height: number } } | null =
        null;
    private lastDrawAt = 0;
    private lastDrawMouse = -1;

    private getOverlayRenderSize(): { width: number; height: number } {
        // Low-end: clientWidth/getBoundingClientRect force layout every frame; the host
        // size only changes on resize, so re-read at most twice a second.
        if (isLowEndDevice) {
            const now = performance.now();
            const c = this.sizeCache;
            if (c && c.w === this.app.width && c.h === this.app.height && now - c.at < 500) return c.size;
            const size = this.computeOverlayRenderSize();
            this.sizeCache = { w: this.app.width, h: this.app.height, at: now, size };
            return size;
        }
        return this.computeOverlayRenderSize();
    }

    private computeOverlayRenderSize(): { width: number; height: number } {
        const hostCanvas = this.app?.gl?.canvas as HTMLCanvasElement | undefined;
        const cssWidth =
            hostCanvas?.clientWidth ||
            hostCanvas?.offsetWidth ||
            hostCanvas?.getBoundingClientRect().width ||
            0;
        const cssHeight =
            hostCanvas?.clientHeight ||
            hostCanvas?.offsetHeight ||
            hostCanvas?.getBoundingClientRect().height ||
            0;
        const safeCssWidth = Math.max(1, Math.round(cssWidth || this.app.width || 1));
        const safeCssHeight = Math.max(1, Math.round(cssHeight || this.app.height || 1));
        const mainScaleX = Math.max(1, (this.app.width || 1) / safeCssWidth);
        const mainScaleY = Math.max(1, (this.app.height || 1) / safeCssHeight);
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        // Desktop overlay matches the main buffer (device pixels) exactly; the
        // widget render scale is already integer-snapped in computeUiRenderMetrics,
        // so any extra overlay scaling here would re-introduce resampling blur.
        const targetUiScale = isTouchDevice ? Math.max(1, Math.min(dpr, 2)) : mainScaleX;
        this.overlayScaleX = Math.max(1, targetUiScale / mainScaleX);
        this.overlayScaleY = Math.max(1, targetUiScale / mainScaleY);
        const canvases = [this.overlayCanvas, this.renderCanvas];
        for (const canvas of canvases) {
            if (!canvas) continue;
            const canvasAny = canvas as any;
            canvasAny.__uiInputScaleX = this.overlayScaleX;
            canvasAny.__uiInputScaleY = this.overlayScaleY;
            // Propagate renderScaleX from the main canvas so choose-option and other
            // overlay renderers use the same scale source as overhead text/hitsplats.
            const hostRenderScale = (hostCanvas as any)?.__uiRenderScale;
            if (typeof hostRenderScale === "number" && hostRenderScale > 0) {
                canvasAny.__uiRenderScale = hostRenderScale;
            }
        }
        return {
            width: Math.max(1, Math.round(this.app.width * this.overlayScaleX)),
            height: Math.max(1, Math.round(this.app.height * this.overlayScaleY)),
        };
    }

    private clearOverlayCanvas(): void {
        this.glRenderer?.clear(0, 0, 0, 0);
        if (this.overlayCanvas) {
            const ctx = this.overlayCanvas.getContext("2d");
            ctx?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }
        this.hasPresentedFrame = false;
    }

    private presentOverlayCanvas(full: boolean, rects: DirtyRect[]): void {
        if (!this.glRenderer || !this.overlayCanvas) return;
        const source = this.glRenderer.canvas;
        const ctx = this.overlayCanvas.getContext("2d");
        if (!ctx) return;
        this.glRenderer.gl.flush();
        ctx.imageSmoothingEnabled = false;
        if (full || !this.hasPresentedFrame) {
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            ctx.drawImage(source, 0, 0);
            this.hasPresentedFrame = true;
            return;
        }
        for (const rect of rects) {
            const x = rect.x | 0;
            const y = rect.y | 0;
            const w = Math.max(0, rect.w | 0);
            const h = Math.max(0, rect.h | 0);
            if (w <= 0 || h <= 0) continue;
            ctx.clearRect(x, y, w, h);
            ctx.drawImage(source, x, y, w, h, x, y, w, h);
        }
    }

    private getMenuAnchorPoint(menu: any): { x: number; y: number } {
        if (menu?.source === "widgets") {
            return {
                x: (menu?.x ?? 0) | 0,
                y: (menu?.y ?? 0) | 0,
            };
        }
        return {
            x: Math.round(((menu?.x ?? 0) | 0) * this.overlayScaleX),
            y: Math.round(((menu?.y ?? 0) | 0) * this.overlayScaleY),
        };
    }

    private getMenuVisualState(
        sharedUi: any,
        inputManager?: {
            mouseX?: number;
            mouseY?: number;
            clickMode3?: number;
            saveClickX?: number;
            saveClickY?: number;
        },
    ): { signature: string; rect?: DirtyRect } {
        const menu = sharedUi?.menu;
        if (!(menu && menu.open && Array.isArray(menu.entries) && menu.entries.length > 0)) {
            return { signature: "closed" };
        }
        const fontLoader = this.ctx.getFontLoader?.() || (() => undefined);
        const hostW = this.glRenderer?.width || this.app.width;
        const hostH = this.glRenderer?.height || this.app.height;
        const hostCanvas = this.app?.gl?.canvas as HTMLCanvasElement | undefined;
        const cssW = hostCanvas?.clientWidth || hostCanvas?.offsetWidth || 0;
        const cssH = hostCanvas?.clientHeight || hostCanvas?.offsetHeight || 0;
        const anchor = this.getMenuAnchorPoint(menu);
        const rect = getChooseOptionMenuRect(
            fontLoader,
            {
                ...menu,
                x: anchor.x,
                y: anchor.y,
            },
            hostW,
            hostH,
            getUiScale(cssW, cssH),
        );
        const mx = (sharedUi?.mouseX ?? 0) | 0;
        const my = (sharedUi?.mouseY ?? 0) | 0;
        const clickMode3 = (inputManager?.clickMode3 ?? 0) | 0;
        const saveClickX = (inputManager?.saveClickX ?? -1) | 0;
        const saveClickY = (inputManager?.saveClickY ?? -1) | 0;
        let entriesSig = "";
        for (let i = 0; i < menu.entries.length; i++) {
            const entry = menu.entries[i];
            if (i > 0) entriesSig += "\u0001";
            entriesSig += `${entry?.option ?? ""}\u0002${entry?.target ?? ""}`;
        }
        const signature = `open:${menu.follow ? 1 : 0}:${menu.x | 0}:${
            menu.y | 0
        }:${mx}:${my}:${clickMode3}:${saveClickX}:${saveClickY}:${entriesSig}`;
        return { signature, rect };
    }

    /**
     * Builds the OSRS mouseover label from the active world menu. The client stores menu
     * entries in display order, so the first actionable entry is the default option.
     */
    private getMouseOverTextVisualState(menuOpen: boolean): MouseOverTextVisualState {
        const client = this.ctx.getGameContext?.()?.osrsClient;
        if (!client?.showMouseOverText || menuOpen || client.menuOpen) {
            return { signature: "hidden" };
        }
        // As the current client (desktop or mobile), the game draws the mouseover text itself
        // (script 4726); drawing ours too showed it twice. Ours is only for older client types.
        if (isCurrentClientType(reportedClientType(client.widgetManager?.rootInterface))) {
            return { signature: "hidden" };
        }
        if (client.varManager?.getVarbit?.(VARBIT_MOUSEOVER_TEXT_DISABLED) === 1) {
            return { signature: "hidden" };
        }

        const entries = Array.isArray(client.menuActiveSimpleEntries)
            ? client.menuActiveSimpleEntries
            : [];
        let topEntry: any;
        let optionCount = 0;
        for (const entry of entries) {
            const option = typeof entry?.option === "string" ? entry.option.trim() : "";
            if (!option || option.toLowerCase() === "cancel") continue;
            optionCount++;
            if (!topEntry) topEntry = entry;
        }

        let text = "";
        if (topEntry) {
            const option = String(topEntry.option || "").trim();
            const target = String(topEntry.target || "").trim();
            text = target ? `${option} ${target}` : option;
            if (optionCount > 1) {
                text += `<col=ffffff> / ${optionCount - 1} more options`;
            }
        } else if (ClientState.isItemSelected === 1) {
            const itemName = String(ClientState.selectedSpellName || "").trim();
            text = `Use${itemName ? ` ${itemName}` : ""} ->`;
        } else if (ClientState.isSpellSelected) {
            const action = String(ClientState.selectedSpellActionName || "Cast").trim() || "Cast";
            const spellName = String(ClientState.selectedSpellName || "").trim();
            text = `${action}${spellName ? ` ${spellName}` : ""} ->`;
        }

        if (!text || !this.glRenderer) return { signature: "hidden" };

        const viewport = client.renderer?.getSceneViewportWidgetRect?.();
        const viewportX = Math.max(0, viewport?.x | 0);
        const viewportY = Math.max(0, viewport?.y | 0);
        const viewportWidth = Math.max(1, viewport?.width | 0 || this.app.width);
        const rectX = Math.round(viewportX * this.overlayScaleX);
        const rectY = Math.round(viewportY * this.overlayScaleY);
        const rectWidth = Math.max(
            1,
            Math.min(this.glRenderer.width - rectX, Math.round(viewportWidth * this.overlayScaleX)),
        );
        const { x: uiScaleX, y: uiScaleY } = this.getOverlayTextScale();
        const rectHeight = Math.max(1, Math.min(this.glRenderer.height - rectY, 20 * uiScaleY));
        if (rectX >= this.glRenderer.width || rectY >= this.glRenderer.height) {
            return { signature: "hidden" };
        }

        return {
            signature: `visible:${text}:${rectX}:${rectY}:${uiScaleX}:${uiScaleY}`,
            text,
            rect: { x: rectX, y: rectY, w: rectWidth, h: rectHeight },
            x: rectX + Math.round(4 * uiScaleX),
            y: rectY + Math.round(3 * uiScaleY),
        };
    }

    /**
     * Device pixels per layout pixel for text this overlay draws itself.
     *
     * overlayScaleX/Y alone is 1 on desktop (targetUiScale === mainScaleX), so it does NOT
     * account for HiDPI - the widget tree gets there by combining it with the renderer's
     * scale (see __widgetRenderScale usage in prepareWidgetEntry). Overlay-drawn text needs
     * the same combination or it renders at 1x into a device-pixel buffer, i.e. half size
     * on a 2x display. __uiRenderScale is the same source choose-option.ts uses.
     */
    private getOverlayTextScale(): { x: number; y: number } {
        const renderScale = (this.overlayCanvas as any)?.__uiRenderScale;
        const base = typeof renderScale === "number" && renderScale > 0 ? renderScale : 1;
        return { x: base * this.overlayScaleX, y: base * this.overlayScaleY };
    }

    draw(phase: RenderPhase): void {
        // Only draw in PostPresent phase
        if (phase !== RenderPhase.PostPresent) {
            return;
        }

        if (!this.enabled) {
            this.clearOverlayCanvas();
            return;
        }

        if (!this.glRenderer || !this.overlayCanvas) {
            return;
        }

        // Low-end: cap the HUD at ~25 redraws/s. Dirty state stays queued in the widget
        // manager, so skipping loses nothing; an open menu or a moved mouse (hover,
        // mouse-over text, clicks) redraws immediately.
        if (isLowEndDevice) {
            const now = performance.now();
            const im: any = this.ctx.getGameContext?.()?.osrsClient?.inputManager;
            const mouse = im ? ((im.mouseX | 0) << 16) | (im.mouseY | 0) : 0;
            const urgent = (this.app.gl.canvas as any)?.__ui?.menu?.open || mouse !== this.lastDrawMouse;
            if (!urgent && this.hasPresentedFrame && now - this.lastDrawAt < 40) return;
            this.lastDrawAt = now;
            this.lastDrawMouse = mouse;
        }

        // A plugin may supply an alternate gameframe (e.g. the classic 317 frame).
        const gameFrame = this.ctx.getGameContext?.()?.osrsClient?.clientPlugins?.activeGameFrame?.();
        const allWidgetOverlays: WidgetOverlay[] =
            this.ctx.getGameContext?.()?.osrsClient?.clientPlugins?.widgetOverlays?.() ?? [];
        // Below-widget overlays draw first in a full pass; the rest draw in or above the tree.
        const belowWidgetOverlays = allWidgetOverlays.filter((overlay) => overlay.drawBelowWidgets === true);
        const widgetOverlays = allWidgetOverlays.filter((overlay) => overlay.drawBelowWidgets !== true);

        if (this.widgetEntries.length === 0) {
            const widgetManager = this.ctx.getWidgetManager?.();
            if (!this.hasPresentedFrame || (widgetManager?.rootInterface ?? -1) === -1) {
                this.clearOverlayCanvas();
            }
            return;
        }

        try {
            // Share a single UI state bag between host canvas (world) and offscreen widget canvas (widgets/menu).
            // This keeps Choose Option + shared UI callbacks/state consistent across both passes.
            const hostCanvasAny = this.app.gl.canvas as any;
            const overlayCanvasAny = this.overlayCanvas as any;
            const renderCanvasAny = this.glRenderer.canvas as any;
            const sharedUi = (hostCanvasAny.__ui =
                hostCanvasAny.__ui || overlayCanvasAny.__ui || renderCanvasAny.__ui || {});
            overlayCanvasAny.__ui = sharedUi;
            renderCanvasAny.__ui = sharedUi;

            // Check dirty state from widget manager
            const widgetManager = this.ctx.getWidgetManager?.();
            let anyDirty = true; // Default to dirty if no manager
            let preciseDirtyWidgets: any[] = [];

            if (widgetManager) {
                // Update compass angle from camera yaw before rendering
                const gameCtx = this.ctx.getGameContext?.();
                const cameraYaw = gameCtx?.osrsClient?.camera?.yaw ?? 0;
                widgetManager.updateCompassAngle(cameraYaw);
                widgetManager.updateMinimap();

                // Rebuilt widgets only need a redraw if they came out different.
                widgetManager.flushChildRebuilds?.();
                // Check if any root widget region needs redraw
                anyDirty = widgetManager.isAnyRootDirty();
                const getPreciseDirtyWidgets = (widgetManager as any).getPreciseDirtyWidgets;
                if (typeof getPreciseDirtyWidgets === "function") {
                    preciseDirtyWidgets = getPreciseDirtyWidgets.call(widgetManager);
                }
            }

            // Also check if menu is open - Choose Option menu needs to render even if widgets aren't dirty
            const hostCanvas = this.app.gl.canvas as any;
            const ui = hostCanvas?.__ui;
            const inputManager = this.ctx.getGameContext?.()?.osrsClient?.inputManager;
            try {
                if (sharedUi && inputManager) {
                    sharedUi.mouseX = inputManager.mouseX | 0;
                    sharedUi.mouseY = inputManager.mouseY | 0;
                }
            } catch {}
            const menuOpen = !!ui?.menu?.open;
            const menuVisualState = this.getMenuVisualState(sharedUi, inputManager);
            const menuVisualDirty = menuVisualState.signature !== this.lastMenuVisualSignature;
            const tradeOverlaySignature = this.getTradeAmountOverlaySignature(widgetManager);
            const tradeOverlayDirty = tradeOverlaySignature !== this.lastTradeAmountOverlaySignature;
            const mouseOverTextState = this.getMouseOverTextVisualState(menuOpen);
            const mouseOverTextDirty =
                mouseOverTextState.signature !== this.lastMouseOverTextSignature;

            // A changed overlay redraws where it was and where it will be when it can say so
            // (coverage); one that cannot redraws the whole UI, as does a different set of
            // overlays. Ground item labels move with the camera every frame, so this is what
            // keeps walking and turning from repainting the whole HUD.
            const {
                setChanged: overlaySetChanged,
                needsFullRedraw: overlayNeedsFullRedraw,
                dirtyRects: overlayDirtyRects,
            } = planWidgetOverlayRedraw(
                allWidgetOverlays,
                this.lastWidgetOverlays,
                this.lastOverlaySignatures,
                this.lastOverlayRects,
                (x, y, w, h) => this.clampRectToCanvas(x, y, w, h),
            );

            // Force a full redraw only for root set changes.
            // The Choose Option menu is drawn as part of the shared widget overlay. When it is
            // open, partial dirty-rect redraws can visibly blink as hover/click state changes
            // every frame. Redraw the full overlay for the duration of the menu instead.
            const forceFullRedraw =
                !this.hasPresentedFrame ||
                this.rootSetChanged ||
                menuOpen ||
                tradeOverlayDirty ||
                !!gameFrame ||
                overlaySetChanged ||
                overlayNeedsFullRedraw;
            const preciseDirtyCount = preciseDirtyWidgets.length | 0;
            const shouldRedraw =
                anyDirty ||
                preciseDirtyCount > 0 ||
                forceFullRedraw ||
                menuVisualDirty ||
                mouseOverTextDirty ||
                overlayDirtyRects.length > 0;

            const consumedRootIndices: number[] = [];

            if (shouldRedraw) {
                let renderFull = forceFullRedraw || !widgetManager;
                let dirtyRects: DirtyRect[] = [];

                if (!renderFull && widgetManager) {
                    for (const entry of this.widgetEntries) {
                        const root = entry.root;
                        const rootIndex =
                            typeof root?.rootIndex === "number" ? root.rootIndex | 0 : -1;
                        if (rootIndex < 0 || !widgetManager.isRootDirty(rootIndex)) continue;
                        consumedRootIndices.push(rootIndex);
                        const rootRect = this.getRootRect(widgetManager, root);
                        if (rootRect) dirtyRects.push(rootRect);
                    }
                    if (dirtyRects.length === 0) {
                        dirtyRects = [];
                    }
                }
                if (!renderFull && preciseDirtyCount > 0) {
                    for (const widget of preciseDirtyWidgets) {
                        const rect = this.getWidgetDirtyRect(widget);
                        if (rect) dirtyRects.push(rect);
                    }
                }

                if (menuVisualDirty) {
                    if (this.lastMenuVisualRect) dirtyRects.push(this.lastMenuVisualRect);
                    if (menuVisualState.rect) dirtyRects.push(menuVisualState.rect);
                }
                if (mouseOverTextDirty) {
                    if (this.lastMouseOverTextRect) dirtyRects.push(this.lastMouseOverTextRect);
                    if (mouseOverTextState.rect) dirtyRects.push(mouseOverTextState.rect);
                }
                for (const rect of overlayDirtyRects) dirtyRects.push(rect);
                if (!renderFull) {
                    if (dirtyRects.length === 0) {
                        renderFull = true;
                    } else {
                        dirtyRects = this.mergeDirtyRects(dirtyRects);
                    }
                }
                // Overlays draw whole, so a partial pass touching one clears and redraws all of them.
                const redrawWidgetOverlays =
                    !renderFull &&
                    this.widgetOverlayRects.some((rect) =>
                        dirtyRects.some((dirty) => this.rectsIntersect(rect, dirty)),
                    );
                if (redrawWidgetOverlays) {
                    dirtyRects = this.mergeDirtyRects([...dirtyRects, ...this.widgetOverlayRects]);
                }

                if (widgetManager) {
                    const managerAny = widgetManager as any;
                    if (renderFull && typeof managerAny.consumeAllRootDirty === "function") {
                        managerAny.consumeAllRootDirty();
                    } else if (typeof managerAny.consumeRootDirty === "function") {
                        for (const rootIndex of consumedRootIndices) {
                            managerAny.consumeRootDirty(rootIndex);
                        }
                    }
                }
                if (renderFull) {
                    // Full pass: reset transient input targets, rebuild root order, redraw all roots.
                    beginWidgetUiFrame(this.glRenderer);
                    this.glRenderer.clear(0, 0, 0, 0);
                    // A custom gameframe draws first (backdrop) so the OSRS content
                    // (tab interfaces, minimap, chat) composites on top of it.
                    if (gameFrame) {
                        gameFrame.drawGameFrame(this.buildGameFrameContext(this.glRenderer));
                        this.glRenderer.flush();
                    }
                    this.belowWidgetOverlayRects =
                        belowWidgetOverlays.length > 0
                            ? this.drawWidgetOverlays(belowWidgetOverlays, true, [])
                            : [];
                    try {
                        const roots = (sharedUi as any).__widgetRoots;
                        if (roots) {
                            roots.length = 0;
                        } else {
                            (sharedUi as any).__widgetRoots = [];
                        }
                    } catch {}

                    this.currentWidgetOverlays = widgetOverlays;
                    this.overlayDrawnThisPass = false;
                    for (const entry of this.widgetEntries) {
                        renderWidgetTreeGL(
                            this.glRenderer,
                            entry.root,
                            entry.renderOpts,
                        );
                    }
                    // Anchor overlays (status bars) draw inside the tree so tooltips win;
                    // the rest (opponent info, ...) draw above the tree as before.
                    const aboveOverlays = widgetOverlays.filter((overlay) => overlay.drawAtAnchor !== true);
                    if (this.overlayDrawnThisPass) {
                        if (aboveOverlays.length > 0) this.drawWidgetOverlays(aboveOverlays, false);
                    } else {
                        this.drawWidgetOverlays(widgetOverlays, true);
                    }
                    this.drawTradeAmountOverlay(widgetManager);
                    this.drawMouseOverText(mouseOverTextState);
                    this.rootSetChanged = false;
                } else if (widgetManager) {
                    // Partial pass: keep existing click targets and redraw only dirty root regions.
                    // Widget click targets are persistent; menu redraws add their previous/current
                    // bounds into dirtyRects so an open menu no longer forces a full widget pass.
                    for (const dirtyRect of dirtyRects) {
                        this.clearOffscreenRect(dirtyRect);
                    }
                    // Below-widget overlays draw whole; scissored to each cleared rect they put
                    // back only what the clear took, before the widgets go on top again.
                    if (belowWidgetOverlays.length > 0) {
                        const gl = this.glRenderer.gl;
                        const canvasW = this.glRenderer.width | 0;
                        const canvasH = this.glRenderer.height | 0;
                        gl.enable(gl.SCISSOR_TEST);
                        for (const rect of dirtyRects) {
                            gl.scissor(rect.x, canvasH - (rect.y + rect.h), rect.w, rect.h);
                            this.belowWidgetOverlayRects = this.drawWidgetOverlays(belowWidgetOverlays, true, []);
                        }
                        gl.scissor(0, 0, canvasW, canvasH);
                    }
                    this.currentWidgetOverlays = widgetOverlays;
                    this.overlayDrawnThisPass = false;
                    for (const dirtyRect of dirtyRects) {
                        const rootClip = {
                            x0: dirtyRect.x,
                            y0: dirtyRect.y,
                            x1: dirtyRect.x + dirtyRect.w,
                            y1: dirtyRect.y + dirtyRect.h,
                        };

                        let renderedAnyRoot = false;
                        for (const entry of this.widgetEntries) {
                            const rootRect = this.getRootRect(widgetManager, entry.root);
                            if (!rootRect || !this.rectsIntersect(rootRect, dirtyRect)) continue;
                            renderedAnyRoot = true;
                            renderWidgetTreeGL(this.glRenderer, entry.root, {
                                ...entry.renderOpts,
                                rootClip,
                            });
                        }
                        if (!renderedAnyRoot && this.widgetEntries.length > 0) {
                            renderWidgetTreeGL(this.glRenderer, this.widgetEntries[0].root, {
                                ...this.widgetEntries[0].renderOpts,
                                rootClip,
                            });
                        }
                    }
                    // Bar values changed: repaint them even if the panel was not the dirty
                    // region (the anchor callback did not fire for that case).
                    if (redrawWidgetOverlays) {
                        const aboveOverlays = widgetOverlays.filter(
                            (overlay) => overlay.drawAtAnchor !== true,
                        );
                        if (this.overlayDrawnThisPass) {
                            if (aboveOverlays.length > 0) this.drawWidgetOverlays(aboveOverlays, false);
                        } else {
                            this.drawWidgetOverlays(widgetOverlays, true);
                        }
                    }
                    this.drawTradeAmountOverlay(widgetManager);
                    const mouseOverTextRect = mouseOverTextState.rect;
                    if (
                        mouseOverTextDirty ||
                        (mouseOverTextRect &&
                            dirtyRects.some((rect) =>
                                this.rectsIntersect(rect, mouseOverTextRect),
                            ))
                    ) {
                        this.drawMouseOverText(mouseOverTextState);
                    }
                }
                this.presentOverlayCanvas(renderFull, dirtyRects);

                this.lastMenuVisualSignature = menuVisualState.signature;
                this.lastWidgetOverlays = allWidgetOverlays;
                this.lastMenuVisualRect = menuVisualState.rect;
                this.lastTradeAmountOverlaySignature = tradeOverlaySignature;
                this.lastMouseOverTextSignature = mouseOverTextState.signature;
                this.lastMouseOverTextRect = mouseOverTextState.rect;
            }

            // Process input against the current click target registry.
            // Targets are rebuilt on full redraws and persisted across partial/clean frames.
            processWidgetUiInput(this.glRenderer, inputManager);

            // IMPORTANT: Clear dirty flags AFTER draw, so next frame starts clean.
            // Dirty flags set during the NEXT frame's tick will be visible to NEXT frame's draw.
            widgetManager?.beginFrame();
        } catch (e) {
            console.error("Error rendering widgets:", e);
        }
    }

    /**
     * Draws the overlays and returns the device rects they covered, remembering each overlay's
     * own rects for its next partial redraw. Without `into`, the rects are the above-widget
     * overlay rects (`widgetOverlayRects`), replaced or appended to.
     */
    private drawWidgetOverlays(overlays: WidgetOverlay[], resetRects = true, into?: DirtyRect[]): DirtyRect[] {
        const glr = this.glRenderer;
        if (!glr) return into ?? this.widgetOverlayRects;
        const context = {
            renderer: glr,
            fontLoader: this.ctx.getFontLoader?.() || (() => undefined),
            sprite: (id: number) => (glr.canvas as any).__textureCache?.getSpriteById(id),
            itemImage: (itemId: number, quantity: number, outline: number) =>
                this.ctx.getItemIconCanvas?.()?.(itemId, quantity, outline, 0, 0),
            place: (overlay: WidgetOverlay, width: number, height: number) =>
                this.ctx.getGameContext?.()?.osrsClient?.clientPlugins?.placeOverlay(overlay, width, height, {
                    w: glr.width,
                    h: glr.height,
                }),
        };
        if (!into && resetRects) this.widgetOverlayRects = [];
        const out = into ?? this.widgetOverlayRects;
        for (const overlay of overlays) {
            const rects: DirtyRect[] = [];
            for (const r of overlay.draw(context)) {
                const rect = this.clampRectToCanvas(
                    Math.floor(r.x),
                    Math.floor(r.y),
                    Math.ceil(r.w) + 1,
                    Math.ceil(r.h) + 1,
                );
                if (rect) rects.push(rect);
            }
            this.lastOverlayRects.set(overlay, rects);
            for (const rect of rects) out.push(rect);
        }
        glr.flush();
        return out;
    }

    /**
     * Draws the widget overlays (status bars) as soon as a side-panel anchor widget has
     * drawn its own content. Everything the tree draws afterwards - tab content, tooltips,
     * menus - stays on top of the bars.
     */
    private drawWidgetOverlaysAtAnchor(): void {
        if (this.overlayDrawnThisPass) return;
        const overlays = (this.currentWidgetOverlays ?? []).filter(
            (overlay) => overlay.drawAtAnchor === true,
        );
        if (overlays.length === 0) return;
        this.overlayDrawnThisPass = true;
        this.drawWidgetOverlays(overlays, true);
    }

    private buildGameFrameContext(glr: GLRenderer): GameFrameDrawContext {
        const client = this.ctx.getGameContext?.()?.osrsClient;
        const widgetManager = this.ctx.getWidgetManager?.();
        // Use the exact letterbox transform the widget roots got, not a fresh
        // canvas-fill scale - otherwise the frame drifts from the widgets on resize.
        const root: any = this.widgetEntries[0]?.root;
        const renderScaleX = typeof root?.__widgetRenderScaleX === "number" ? root.__widgetRenderScaleX : 1;
        const renderScaleY = typeof root?.__widgetRenderScaleY === "number" ? root.__widgetRenderScaleY : 1;
        const renderOffsetX = typeof root?.__widgetRenderOffsetX === "number" ? root.__widgetRenderOffsetX : 0;
        const renderOffsetY = typeof root?.__widgetRenderOffsetY === "number" ? root.__widgetRenderOffsetY : 0;
        const rectOf = (w: any) => w ? {
            x: w._absLogicalX ?? w.x ?? 0,
            y: w._absLogicalY ?? w.y ?? 0,
            width: w.width ?? 0,
            height: w.height ?? 0,
        } : undefined;
        const containerOf = (group: number) => {
            const parents: any = widgetManager?.interfaceParents;
            if (!parents || typeof parents[Symbol.iterator] !== "function") return undefined;
            for (const [uid, parent] of parents) {
                if (parent?.group === group) return rectOf((widgetManager as any)?.getWidgetByUid?.(uid));
            }
            return undefined;
        };
        const activeTab = client?.varManager?.getVarcInt?.(171) ?? 0;
        // Root 161 mounts its 14 tab interfaces into child slots 76..89 (index = tab).
        const tabSlot = 76 + Math.max(0, Math.min(13, activeTab));
        // Live absolute rect (sum of ancestors' x/y). _absLogicalX is only filled in
        // during the render pass, so it's stale for a tab container that was just
        // switched to and hasn't been rendered at its new spot yet.
        const absRectOf = (w: any) => {
            if (!w) return undefined;
            let ax = 0;
            let ay = 0;
            let cur = w;
            for (let guard = 0; cur && guard < 32; guard++) {
                ax += Number(cur.x) || 0;
                ay += Number(cur.y) || 0;
                const parentUid = cur.parentUid;
                if (parentUid === undefined || parentUid === 0xffff || parentUid === w.uid) break;
                cur = (widgetManager as any)?.getWidgetByUid?.(parentUid);
            }
            return { x: ax, y: ay, width: w.width ?? 0, height: w.height ?? 0 };
        };
        return {
            renderer: glr,
            renderScaleX,
            renderScaleY,
            renderOffsetX,
            renderOffsetY,
            switchTab: (tab: number) => {
                try {
                    client?.switchToTab?.(tab);
                    // Apply the queued tab layout now, so the next draw has the new
                    // tab content at its sidebar position instead of (0,0).
                    client?.flushWidgetEvents?.();
                } catch {}
            },
            clicks: (glr.canvas as any)?.__clicks,
            anchors: {
                chat: containerOf(162),
                tabContent: absRectOf((widgetManager as any)?.getWidgetByUid?.((161 << 16) | tabSlot)),
            },
        };
    }

    private getTradeAmountOverlaySignature(widgetManager?: WidgetManager): string {
        const client = this.ctx.getGameContext?.()?.osrsClient;
        if (!client?.isTradeQuantityInputActive?.()) return "hidden";
        const value = String(client.cs2Vm?.inputDialogString ?? "");
        const roots = widgetManager?.getAllGroupRoots?.(162) ?? [];
        const bounds = roots
            .map((root: any) => `${root?._absX ?? root?.x ?? 0},${root?._absY ?? root?.y ?? 0}`)
            .join(";");
        const { x: uiScaleX, y: uiScaleY } = this.getOverlayTextScale();
        return `visible:${value}:${bounds}:${uiScaleX}:${uiScaleY}`;
    }

    private drawMouseOverText(state: MouseOverTextVisualState): void {
        if (!state.text || !state.rect || !this.glRenderer) return;

        const { x: uiScaleX, y: uiScaleY } = this.getOverlayTextScale();
        drawTextGL(
            this.glRenderer,
            this.ctx.getFontLoader?.() || (() => undefined),
            state.text,
            state.x ?? state.rect.x,
            state.y ?? state.rect.y,
            state.rect.w,
            Math.max(1, Math.round(16 * uiScaleY)),
            FONT_BOLD_12,
            0xffffff,
            0,
            0,
            true,
            1,
            undefined,
            uiScaleX,
            uiScaleY,
        );
        this.glRenderer.flush();
    }

    /** Draw over the chat history while preserving the underlying widget tree. */
    private drawTradeAmountOverlay(widgetManager?: WidgetManager): void {
        const client = this.ctx.getGameContext?.()?.osrsClient;
        if (!client?.isTradeQuantityInputActive?.() || !this.glRenderer || !widgetManager) return;

        const roots = widgetManager.getAllGroupRoots?.(162) ?? [];
        if (roots.length === 0) return;
        // _absX/_absWidth are device space; x/width are layout space. Resolve everything
        // into the device space this.glRenderer draws in - mixing the two put the right
        // edge in the wrong place on any display where the two differ (HiDPI).
        const { x: uiScaleX, y: uiScaleY } = this.getOverlayTextScale();
        const deviceX = (w: any) => (w?._absX ?? (w?.x ?? 0) * uiScaleX) as number;
        const deviceY = (w: any) => (w?._absY ?? (w?.y ?? 0) * uiScaleY) as number;
        const deviceW = (w: any) => (w?._absWidth ?? (w?.width ?? 0) * uiScaleX) as number;
        const deviceH = (w: any) => (w?._absHeight ?? (w?.height ?? 0) * uiScaleY) as number;

        const left = Math.min(...roots.map(deviceX));
        const top = Math.min(...roots.map(deviceY));
        const right = Math.max(...roots.map((w: any) => deviceX(w) + deviceW(w)));
        const bottom = Math.max(...roots.map((w: any) => deviceY(w) + deviceH(w)));
        const width = Math.max(1, right - left);
        // Preserve the channel tabs along the bottom of the normal chatbox.
        const height = Math.max(72 * uiScaleY, bottom - top - 25 * uiScaleY);
        const x = left + 4 * uiScaleX;
        const y = top + 4 * uiScaleY;
        const innerWidth = Math.max(1, width - 8 * uiScaleX);
        const innerHeight = Math.max(1, height - 8 * uiScaleY);

        // Warm parchment tone approximates the native chatbox panel and masks
        // scrollback without changing the widget/layout tree beneath it.
        this.glRenderer.drawRect(x, y, innerWidth, innerHeight, [0.76, 0.71, 0.59, 1]);
        const fontLoader = this.ctx.getFontLoader?.() || (() => undefined);
        drawTextGL(
            this.glRenderer,
            fontLoader,
            "Enter amount:",
            x,
            y + Math.floor(innerHeight * 0.35),
            innerWidth,
            Math.max(1, Math.round(20 * uiScaleY)),
            FONT_VERDANA_13,
            0x000000,
            1,
            1,
            false,
            1,
            undefined,
            uiScaleX,
            uiScaleY,
        );
        drawTextGL(
            this.glRenderer,
            fontLoader,
            `<col=0000ff>${String(client.cs2Vm?.inputDialogString ?? "")}*</col>`,
            x,
            y + Math.floor(innerHeight * 0.55),
            innerWidth,
            Math.max(1, Math.round(20 * uiScaleY)),
            FONT_VERDANA_13,
            0x0000ff,
            1,
            1,
            false,
            1,
            undefined,
            uiScaleX,
            uiScaleY,
        );
        this.glRenderer.flush();
    }

    setWidgetVisibility(uid: number, visible: boolean): void {
        this.visible.set(uid, visible);
    }

    clearVisibility(): void {
        this.visible.clear();
    }
}
