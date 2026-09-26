import { ClientState } from "../../../game/ClientState";
import type { InputManager } from "../../../game/InputManager";
import { profiler } from "../../../render/PerformanceProfiler";
import { packWorldMapCoord } from "../../../rs/map/WorldMapArea";
import { menuAction } from "../../../ui/menu/MenuAction";
import { MenuOpcode, MenuState } from "../../../ui/menu/MenuState";
import {
    drawRichTextGL as UI_drawRichTextGL,
    drawTextGL as UI_drawTextGL,
    drawWrappedTextGL as UI_drawWrappedTextGL,
} from "../../../widgets/components/TextRenderer";
import { runCs1 } from "../../../widgets/cs1/runCs1";
import {
    collectWidgetsAtPointAcrossRoots as UI_collectWidgetsAtPointAcrossRoots,
    deriveMenuEntriesForWidget as UI_deriveMenuEntriesForWidget,
    findBlockingWidgetInHits as UI_findBlockingWidgetInHits,
    hasContextMenuOption as UI_hasContextMenuOption,
} from "../../../widgets/menu/utils";
import { MinimapRenderer } from "../MinimapRenderer";
import { drawChooseOptionMenu } from "../choose-option";
import { GLRenderer } from "../renderer";
import {
    ClipRect,
    ScissorStack,
    calculateStandardClip,
    calculateType9Clip,
    isClipValid,
} from "../scissor";
import { type SpriteMaskData, TextureCache } from "../texture-cache";
import { ensureInput } from "../ui-input";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import {
    DEBUG_CLICK_AREAS,
    NOOP,
    CANCEL_SELECTION_HANDLER,
    EMPTY_WIDGETS,
} from "./constants";
import {
    deriveMenuEntriesForWidgetCached,
    getWidgetInteractionSnapshot,
    shouldCheckWidgetHoverVisual,
    shouldProbeWidgetInteractionShallow,
} from "./interactionMenuCache";
import type { CachedClickTarget, WidgetClickMeta } from "./clickTypes";
import type { GLRenderOpts } from "./glRenderOpts";
import { drawLine, drawThickLine } from "./drawLines";
import { renderArcWidget } from "./arcWidget";
import { drawScrollBar } from "./scrollbarDraw";
import { drawWorldMapLabelGL, getWorldMapFlashTexture } from "./worldMapLabels";
import { scaleLogicalPixels } from "./scaleLogicalPixels";
import { ps } from "./profilingState";
import { FONT_VERDANA_11, FONT_VERDANA_13, FONT_VERDANA_15 } from "../../../ui/fonts";
import type { WorldMapLabelDraw, WorldMapLabelMetrics } from "./worldMapLabels";

export type { WidgetNode };
type Widget = WidgetNode;

export function renderWidgetTreeGL(glr: GLRenderer, root: Widget, opts: GLRenderOpts) {
    // PERF: Reset widget count for this render pass
    ps._widgetRenderCount = 0;
    const profileWidgetRender = profiler.enabled && profiler.verbose;
    const renderStartMs = profileWidgetRender ? performance.now() : 0;
    const drawCountersStart = profileWidgetRender ? glr.getPerfCounters() : null;
    let clickRegistrationMs = 0;
    let clickProbeMs = 0;
    let clickDeriveMs = 0;
    let clickPrimaryFindMs = 0;
    let clickInventoryPrimaryMs = 0;
    let clickPrimaryResolveMs = 0;
    let clickCancelSetupMs = 0;
    let clickMetaMs = 0;
    let clickTargetMs = 0;
    let clickRegisterMs = 0;
    let minimapMs = 0;
    let spriteMs = 0;
    let modelMs = 0;
    let textMs = 0;
    let rectMs = 0;
    let lineMs = 0;
    let containerMs = 0;
    let prepMs = 0;
    let layoutMs = 0;
    let clipMs = 0;
    let boundsMs = 0;
    let selectionMs = 0;
    let deferMs = 0;
    let scrollbarMs = 0;
    let hoverMs = 0;
    let compassMs = 0;
    let containerScaffoldMs = 0;
    let scrollClampMs = 0;
    let prepContentTypeMs = 0;
    let prepVisibilityMs = 0;
    let debugRectMs = 0;
    let menuOverlayMs = 0;
    let staticDispatchMs = 0;
    let dynamicDispatchMs = 0;
    let interfaceParentDispatchMs = 0;
    let clickShallowMs = 0;
    let textWidgets = 0;
    let spriteWidgets = 0;
    let modelWidgets = 0;
    let minimapWidgets = 0;
    let interactiveWidgets = 0;
    let containerWidgets = 0;
    let leafWidgets = 0;
    let staticChildrenVisited = 0;
    let dynamicChildrenVisited = 0;
    let interfaceParentRootsVisited = 0;
    let clickCandidateWidgets = 0;
    let clickRegisteredWidgets = 0;
    let cancelSelectionWidgets = 0;
    let menuDeriveWidgets = 0;
    let menuEntriesTotal = 0;
    let modelCacheHits = 0;
    let modelCacheMisses = 0;
    let textTextureDrawCalls = 0;
    let spriteTextureDrawCalls = 0;
    let modelTextureDrawCalls = 0;
    let minimapTextureDrawCalls = 0;

    // Use the actual GL drawable size for scissor computations so CSS layout and clipping stay aligned.
    const hostH = glr.height;

    // Layout runs in logical widget coordinates. The caller provides rootScaleX/rootScaleY
    // to project logical coords into buffer coordinates for drawing/hit registration.

    const canvasAny = glr.canvas as any;
    // PERF: Cache TextureCache on canvas to avoid allocation each frame
    let tc: TextureCache = canvasAny.__textureCache;
    if (!tc) {
        tc = new TextureCache(glr, opts.spriteIndex, opts.itemIconCanvas);
        canvasAny.__textureCache = tc;
    }
    const widgetManager = opts.widgetManager;
    const widgetFlagsVersion = widgetManager?.getWidgetFlagsVersion?.() ?? 0;
    const widgetFlagsFrameCache = new Map<number, number>();
    const getCachedWidgetFlags = (w: any): number => {
        if (!widgetManager || !w) return ((w?.flags ?? 0) as number) | 0;
        const uid = typeof w.uid === "number" ? w.uid | 0 : undefined;
        if (uid === undefined) {
            const flags = widgetManager.getWidgetFlags(w) | 0;
            w.__widgetFlagsVersion = widgetFlagsVersion | 0;
            return flags;
        }
        const cached = widgetFlagsFrameCache.get(uid);
        if (cached !== undefined) return cached;
        const flags = widgetManager.getWidgetFlags(w) | 0;
        widgetFlagsFrameCache.set(uid, flags);
        w.__widgetFlagsVersion = widgetFlagsVersion | 0;
        return flags;
    };
    const rootOffsetX = Number.isFinite(opts.rootOffsetX as number) ? Number(opts.rootOffsetX) : 0;
    const rootOffsetY = Number.isFinite(opts.rootOffsetY as number) ? Number(opts.rootOffsetY) : 0;
    const rootScaleXRaw = Number(opts.rootScaleX ?? opts.rootScale ?? 1.0);
    const rootScaleYRaw = Number(opts.rootScaleY ?? opts.rootScale ?? 1.0);
    const rootScaleX = Number.isFinite(rootScaleXRaw) && rootScaleXRaw > 0 ? rootScaleXRaw : 1.0;
    const rootScaleY = Number.isFinite(rootScaleYRaw) && rootScaleYRaw > 0 ? rootScaleYRaw : 1.0;

    // The widget currently being clicked (Client.clickedWidget) is drawn semi-transparent.
    // Reference: UserComparator5.drawInterface: if (var10 == Client.clickedWidget && !var10.isScrollBar) { var14 = 128; }
    // Note: `clickedWidget` is a private TS field on OsrsClient but exists at runtime; read via `any`.
    const osrsClient = (opts.game as any)?.osrsClient as any;
    const clickedWidgetUid: number | null =
        typeof osrsClient?.clickedWidget?.uid === "number"
            ? ((osrsClient.clickedWidget.uid | 0) as number)
            : null;

    // PERF: Validate all dirty layouts in one pass before rendering
    // This avoids per-widget ensureLayout calls during tree traversal
    if (widgetManager) {
        widgetManager.validateAllLayouts();
    }
    const gl = glr.gl;
    gl.enable(gl.SCISSOR_TEST);

    // Optional root-level clip used for dirty-region redraws.
    const clipOpt = opts.rootClip;
    const clipX0 = Math.max(0, Math.min(glr.width, clipOpt?.x0 ?? 0));
    const clipY0 = Math.max(0, Math.min(glr.height, clipOpt?.y0 ?? 0));
    const clipX1 = Math.max(clipX0, Math.min(glr.width, clipOpt?.x1 ?? glr.width));
    const clipY1 = Math.max(clipY0, Math.min(glr.height, clipOpt?.y1 ?? glr.height));
    const clipW = Math.max(0, clipX1 - clipX0);
    const clipH = Math.max(0, clipY1 - clipY0);
    if (clipW <= 0 || clipH <= 0) {
        return;
    }
    // Use clip as initial scissor so draw calls outside dirty region are dropped by GL.
    gl.scissor(clipX0, hostH - clipY1, clipW, clipH);

    // UI state for interactions (per-canvas)
    const canvas = glr.canvas as HTMLCanvasElement & { __ui?: any };
    // Ensure GL canvas and host canvas share the same __ui object so world-menu + widget-menu interop works.
    try {
        const hc = (opts as any).hostCanvas as any;
        if (hc) {
            const hui = (hc.__ui = hc.__ui || canvas.__ui || {});
            canvas.__ui = hui;
        }
    } catch {}
    if (!canvas.__ui) canvas.__ui = {};
    const ui = canvas.__ui as {
        raf?: number | null;
        lastClick?: { x: number; y: number; consumer?: string };
        clickLogged?: boolean;
        onWidgetAction?: (ev: {
            widget: any;
            option: string;
            target?: string;
            source?: string;
            cursorX?: number;
            cursorY?: number;
            slot?: number;
            itemId?: number;
        }) => void;
        g4?: {
            barRect?: { x: number; y: number; w: number; h: number };
            trackRect?: { x: number; y: number; w: number; h: number };
            knobRect?: { x: number; y: number; w: number; h: number };
            contentRect?: { x: number; y: number; w: number; h: number };
            maxScroll?: number;
            container?: Widget;
        };
        // Aggregated roots for this draw pass (WidgetsOverlay renders multiple roots per frame).
        __widgetRoots?: any[];
        __widgetsGlPassActive?: boolean;
    };
    if (!ui.g4) ui.g4 = {};

    // Ensure per-canvas scroll registry and reset for this frame
    // Centralized input + registry
    // PERF: Use NOOP instead of inline closure - ensureInput ignores the callback anyway
    const input = ensureInput(glr, NOOP, (opts as any).hostCanvas);
    const clicks: any = input.getClicks();
    // Expose clicks registry to canvas for choose-option.ts hover detection
    (glr.canvas as any).__clicks = clicks;

    // OSRS-style: Set up visibility checker for hit testing.
    // This allows persisted click targets to be filtered at query time based on widget visibility,
    // matching OSRS behavior where the widget tree is traversed and hidden widgets are skipped.
    // Uses isEffectivelyHidden to check the full parent chain (hidden container = hidden children).
    if (widgetManager && typeof clicks.setWidgetHiddenChecker === "function") {
        clicks.setWidgetHiddenChecker((uid: number) => {
            return widgetManager.isEffectivelyHidden(uid);
        });
    }

    // Track roots in render order so the menu handler can pick the topmost root at the cursor.
    // WidgetsOverlay resets this once per frame before rendering all roots.
    // Keep root list unique so partial redraw passes don't accumulate duplicates.
    const widgetRoots = (ui.__widgetRoots = ui.__widgetRoots || []);
    if (!widgetRoots.includes(root as any)) {
        widgetRoots.push(root as any);
    }

    // Get InputManager from game client if available
    const inputManager = (opts.game as any)?.osrsClient?.inputManager;

    // Store inputManager on canvas so we can process input AFTER widgets are registered
    // (processInput is deferred to end of render so click targets exist)
    (glr.canvas as any).__pendingInputManager = inputManager;
    if (!inputManager) {
        // Log once if InputManager is not available
        const canvas = glr.canvas as any;
        if (!canvas.__warnedNoInputManager) {
            console.warn(
                "[widgets-gl] No InputManager found! opts.game=",
                opts.game,
                "osrsClient=",
                (opts.game as any)?.osrsClient,
            );
            canvas.__warnedNoInputManager = true;
        }
    }

    // Mirror pointer position into __ui for legacy consumers (e.g., Choose Option hover/cancel)
    try {
        const cAny: any = glr.canvas as any;
        const uii = (cAny.__ui = cAny.__ui || {});
        if (inputManager) {
            const pointer = input.getPointerPos(inputManager);
            uii.mouseX = pointer.x | 0;
            uii.mouseY = pointer.y | 0;
        }
    } catch {}
    // Mirror UI state from host canvas so overlays can read entries set by the map renderer
    // (Handled above by sharing the same __ui object between canvases.)
    // Provide UIInput a handler to open a pinned Choose Option menu on right-click.
    // Priority: if a widget under the pointer has options, show widget entries; otherwise let the map supply world entries.
    try {
        // Expose the OsrsClient on the canvas so overlay helpers (e.g., Choose Option) can
        // close the underlying world menu state, preventing re-open loops.
        const osrsClientRef = (opts.game as any)?.osrsClient ?? null;
        (glr.canvas as any).__osrsClient = osrsClientRef;
        (glr as any).osrsClient = osrsClientRef;
        input.setMenuHandler((x: number, y: number) => {
            const canvas = glr.canvas as HTMLCanvasElement & { __ui?: any };
            const ui = (canvas.__ui = canvas.__ui || {});
            // callback for static children lookup
            const getStaticChildren = osrsClientRef?.widgetManager
                ? (uid: number) => osrsClientRef.widgetManager.getStaticChildrenByParentUid(uid)
                : undefined;
            // callback for InterfaceParent traversal (mounted sub-interfaces).
            // Mounted interfaces are separate widget trees rendered at the container's (x,y)
            // and clipped to the container bounds. They do NOT scroll with the container.
            const getInterfaceParentRoots = osrsClientRef?.widgetManager
                ? (containerUid: number) => {
                      const wm = osrsClientRef.widgetManager;
                      const group = wm.interfaceParents.get(containerUid)?.group;
                      return typeof group === "number" ? wm.getAllGroupRoots(group) : [];
                  }
                : undefined;
            const isInputCaptureWidget = osrsClientRef?.widgetManager
                ? (uid: number) => {
                      const wm = osrsClientRef.widgetManager;
                      const parent = wm.interfaceParents.get(uid);
                      return !!parent && (parent.type | 0) === 0;
                  }
                : undefined;
            const getByUid =
                osrsClientRef?.widgetManager &&
                typeof osrsClientRef.widgetManager.getWidgetByUid === "function"
                    ? (uid: number) => osrsClientRef.widgetManager.getWidgetByUid(uid)
                    : undefined;
            // callback for widget flags lookup with IF_SETEVENTS overrides applied.
            // Without this callback, menu option visibility checks would only use base flags from cache,
            // missing runtime flag overrides from IF_SETEVENTS (e.g., equipment Remove action transmit flags).
            const getWidgetFlags =
                osrsClientRef?.widgetManager &&
                typeof osrsClientRef.widgetManager.getWidgetFlags === "function"
                    ? (w: any) => getCachedWidgetFlags(w)
                    : undefined;
            const openWorldMapIconMenu = (entries: any[]) => {
                const menuState = new MenuState();
                for (const entry of entries) {
                    const idx = menuState.add({
                        option: entry.option,
                        target: entry.target,
                        opcode: entry.opcode,
                        targetId: entry.targetId,
                        arg1: entry.mapX,
                        arg2: entry.mapY,
                        handler: entry.onClick,
                    });
                    entry.menuStateIndex = idx;
                }
                ui.menu = {
                    open: true,
                    follow: false,
                    x: x | 0,
                    y: y | 0,
                    entries,
                    targetWidget: null,
                    source: "worldmap",
                    menuState,
                } as any;
                try {
                    (ui as any).closeWorldMenu?.();
                } catch {}
            };
            try {
                const hover = clicks?.getHoverTarget?.();
                const hid: string | undefined = hover?.id;
                let worldMapSurface = !hid;
                if (hid && hid.startsWith("widget:") && getByUid) {
                    const uidNum = Number.parseInt(hid.slice("widget:".length), 10);
                    if (!Number.isNaN(uidNum)) {
                        const w = getByUid(uidNum);
                        worldMapSurface = (((w as any)?.contentType ?? 0) | 0) === 1400;
                    }
                }
                if (worldMapSurface) {
                    const entries = osrsClientRef?.getWorldMapMenuEntriesAt?.(x | 0, y | 0) ?? [];
                    const real = entries.some((entry: any) => {
                        const lower = String(entry?.option ?? "")
                            .trim()
                            .toLowerCase();
                        return !!lower && lower !== "cancel";
                    });
                    if (real) {
                        openWorldMapIconMenu(entries);
                        return;
                    }
                }
            } catch {}

            // Prefer the hovered click target (registered during render) as the menu anchor.
            // This avoids mismatches when interfaces are layered / mounted (InterfaceParents) and ensures
            // the menu targets exactly what the user right-clicked visually.
            try {
                const hover = clicks?.getHoverTarget?.();
                const hid: string | undefined = hover?.id;
                if (hid && hid.startsWith("widget:")) {
                    const uidNum = Number.parseInt(hid.slice("widget:".length), 10);
                    if (!Number.isNaN(uidNum) && getByUid) {
                        const w = getByUid(uidNum);
                        if (w && !(w as any).__dummyRoot) {
                            let candEntries: any[] = [];
                            let hasCustom = false;
                            try {
                                const fn = (ui as any).getWidgetMenuEntries;
                                if (typeof fn === "function") {
                                    candEntries = fn(w, x | 0, y | 0) || [];
                                    hasCustom = candEntries.length > 0;
                                }
                            } catch {}
                            try {
                                const base =
                                    UI_deriveMenuEntriesForWidget(
                                        w,
                                        hasCustom,
                                        getWidgetFlags,
                                        getByUid,
                                    ) || [];
                                // Widget menu entries are already in OSRS display order (top-to-bottom).
                                // Do not apply normalizeMenuEntries here; it expects OSRS insertion order and
                                // would reverse widget ops (e.g., minimap orbs).
                                candEntries = ([] as any[]).concat(candEntries, base);
                            } catch {}
                            const real = UI_hasContextMenuOption(candEntries);
                            if (real) {
                                ui.mouseX = x | 0;
                                ui.mouseY = y | 0;
                                const { widgetEntriesToSimple } = require("../../../ui/menu/MenuBridge");
                                const menuState = new MenuState();
                                const mapped = widgetEntriesToSimple(candEntries, {
                                    ui,
                                    chosenWidget: w,
                                    scheduleRender,
                                    menuState,
                                    label: {
                                        includeExamineIds: !!(opts.game as any)?.osrsClient
                                            ?.debugId,
                                    },
                                });
                                ui.menu = {
                                    open: true,
                                    follow: false,
                                    x: x | 0,
                                    y: y | 0,
                                    entries: mapped,
                                    targetWidget: w,
                                    source: "widgets",
                                    menuState,
                                } as any;
                                try {
                                    (ui as any).closeWorldMenu?.();
                                } catch {}
                                return;
                            }
                        }
                    }
                }
            } catch {}

            // Collect widgets at the click across ALL roots rendered this pass.
            // Root order matters: later roots are visually on top (WidgetsOverlay draw order).
            const roots = Array.isArray((ui as any).__widgetRoots)
                ? (ui as any).__widgetRoots
                : [root];
            const hits = UI_collectWidgetsAtPointAcrossRoots(
                roots as any[],
                x | 0,
                y | 0,
                opts.visible,
                getStaticChildren,
                getInterfaceParentRoots,
                isInputCaptureWidget,
            ).filter((h: any) => !h.__dummyRoot);
            let chosen: any | undefined;
            let entries: any[] = [];

            // Pick the most actionable widget by scanning from topmost back down
            for (let i = hits.length - 1; i >= 0; i--) {
                const candidate = hits[i];
                // Try custom entries first
                let candEntries: any[] = [];
                let hasCustom = false;
                try {
                    const fn = (ui as any).getWidgetMenuEntries;
                    if (typeof fn === "function") {
                        candEntries = fn(candidate, x | 0, y | 0) || [];
                        hasCustom = candEntries.length > 0;
                    }
                } catch {}
                // Always merge in base entries derived from widget actions/verb
                // If custom entries exist, only add Cancel from base (not Examine)
                try {
                    const base =
                        UI_deriveMenuEntriesForWidget(
                            candidate,
                            hasCustom,
                            getWidgetFlags,
                            getByUid,
                        ) || [];
                    // Widget menu entries are already in OSRS display order (top-to-bottom).
                    // Do not apply normalizeMenuEntries here; it expects OSRS insertion order and
                    // would reverse widget ops (e.g., minimap orbs).
                    candEntries = ([] as any[]).concat(candEntries, base);
                } catch {}

                // Add spell-target entry if spell is selected and this is an inventory item
                if (ClientState.isSpellSelected) {
                    const itemId = candidate.itemId ?? -1;
                    const candidateGroupId = candidate.groupId ?? candidate.uid >>> 16;
                    const isInventoryItem = itemId >= 0 || candidateGroupId === 149;

                    if (isInventoryItem) {
                        // Get item name for target label
                        let itemName = candidate.name || candidate.text || "";
                        if (!itemName && itemId >= 0) {
                            // Try to get item name from definition
                            try {
                                const objLoader = (opts.game as any)?.osrsClient?.objLoader;
                                const itemDef = objLoader?.load?.(itemId);
                                itemName = itemDef?.name || `Item ${itemId}`;
                            } catch {
                                itemName = `Item ${itemId}`;
                            }
                        }

                        const itemTarget = itemName ? `<col=ff9040>${itemName}` : "";
                        // spell-on-item entry uses selectedSpellActionName as the option
                        // and "selectedSpellName -> <col=ff9040>item" as target text.
                        const spellAction = ClientState.selectedSpellActionName || "Cast";
                        const spellName = ClientState.selectedSpellName || "";
                        const spellTarget =
                            spellName && itemTarget
                                ? `${spellName} -> ${itemTarget}`
                                : itemTarget || spellName;
                        const spellEntry = {
                            option: spellAction,
                            target: spellTarget,
                            widgetAction: {
                                slot: candidate.childIndex ?? candidate.uid & 0xffff,
                                itemId: itemId,
                            },
                        };

                        const explicitExamine = Array.isArray(candEntries)
                            ? candEntries.find(
                                  (e: any) =>
                                      String(e?.option ?? "")
                                          .trim()
                                          .toLowerCase() === "examine",
                              )
                            : undefined;

                        // Insert spell entry at the beginning (before Use, Drop, etc.)
                        candEntries = [
                            spellEntry,
                            ...candEntries.filter((e: any) => {
                                const lower = String(e?.option ?? "")
                                    .trim()
                                    .toLowerCase();
                                return lower !== "cancel" && lower !== "examine";
                            }),
                        ];
                        // Preserve explicit Examine if present on the base menu.
                        if (explicitExamine) {
                            candEntries.push({
                                option:
                                    typeof explicitExamine.option === "string"
                                        ? explicitExamine.option
                                        : "Examine",
                                target:
                                    typeof explicitExamine.target === "string"
                                        ? explicitExamine.target
                                        : itemTarget,
                            });
                        }
                        candEntries.push({ option: "Cancel" });
                    }
                }

                const real = UI_hasContextMenuOption(candEntries);
                if (real) {
                    chosen = candidate;
                    entries = candEntries;
                    break;
                }
            }
            if (chosen && entries.length) {
                ui.mouseX = x | 0;
                ui.mouseY = y | 0;
                // Map entries using the shared bridge and central hooks
                const { widgetEntriesToSimple } = require("../../../ui/menu/MenuBridge");
                const menuState = new MenuState();
                const mapped = widgetEntriesToSimple(entries, {
                    ui,
                    chosenWidget: chosen,
                    scheduleRender,
                    menuState,
                    label: {
                        includeExamineIds: !!(opts.game as any)?.osrsClient?.debugId,
                    },
                });
                ui.menu = {
                    open: true,
                    follow: false,
                    x: x | 0,
                    y: y | 0,
                    entries: mapped,
                    targetWidget: chosen,
                    source: "widgets",
                    menuState,
                } as any;
                try {
                    // Ensure any world menu state is closed so interaction sampling isn't locked
                    (ui as any).closeWorldMenu?.();
                } catch {}
                return;
            }
            // No actionable widget entries. If the click still landed on UI that
            // blocks the world (panels, modals), show a Cancel-only menu - a
            // right-click always opens a menu with at least "Cancel". The world
            // pass skips picks over UI entirely, so without this the click would
            // produce no menu at all.
            const blockingWidget = UI_findBlockingWidgetInHits(hits, {
                getWidgetFlags,
                getWidgetByUid: getByUid,
            });
            if (blockingWidget) {
                ui.mouseX = x | 0;
                ui.mouseY = y | 0;
                const { widgetEntriesToSimple } = require("../../../ui/menu/MenuBridge");
                const menuState = new MenuState();
                const mapped = widgetEntriesToSimple([{ option: "Cancel" }], {
                    ui,
                    chosenWidget: blockingWidget ?? null,
                    scheduleRender,
                    menuState,
                    label: {
                        includeExamineIds: !!(opts.game as any)?.osrsClient?.debugId,
                    },
                });
                ui.menu = {
                    open: true,
                    follow: false,
                    x: x | 0,
                    y: y | 0,
                    entries: mapped,
                    targetWidget: blockingWidget ?? null,
                    source: "widgets",
                    menuState,
                } as any;
                try {
                    (ui as any).closeWorldMenu?.();
                } catch {}
                return;
            }
            // Otherwise, let the map renderer own pinned menu population (world options).
            // It will write to __ui.menu later in the frame.
        });
    } catch {}
    const scheduleRender = () => {
        if (ui.raf) return;
        ui.raf = requestAnimationFrame(() => {
            ui.raf = null;
            // When the host can repaint all roots (multi-modal), defer to it to avoid
            // clearing other layers. Otherwise, fall back to legacy single-root repaint.
            if (typeof opts.requestRepaintAll === "function") {
                try {
                    opts.requestRepaintAll();
                    return;
                } catch {}
            }
            glr.clear();
            renderWidgetTreeGL(glr, root, opts);
        });
    };

    // Back-compat hook: some overlays expect `requestRender`.
    const requestRender = scheduleRender;

    // PERF: Cache ScissorStack on canvas instead of creating new one each frame
    let sc: ScissorStack = canvasAny.__scissorStack;
    if (!sc) {
        sc = new ScissorStack(gl, glr.width, hostH, () => glr.flush());
        canvasAny.__scissorStack = sc;
    } else {
        sc.reinit(gl, glr.width, hostH, () => glr.flush());
    }
    // Helpers
    function findWidgetLocal(w: Widget, gid: number, fid: number): Widget | undefined {
        if (w.groupId === gid && w.fileId === fid) return w;
        // Check static children (via parentUid filtering - )
        const staticChildren = widgetManager?.getStaticChildrenByParentUid(w.uid) ?? [];
        for (const c of staticChildren) {
            if (c != null) {
                const r = findWidgetLocal(c, gid, fid);
                if (r) return r;
            }
        }
        // Check runtime children (CC_CREATE/CC_COPY path)
        const dynamicChildren = widgetManager?.getDynamicChildrenByParent(w) ?? EMPTY_WIDGETS;
        for (const c of dynamicChildren) {
            if (c != null) {
                const r = findWidgetLocal(c, gid, fid);
                if (r) return r;
            }
        }
        return undefined;
    }

    function findWidgetByGroupFile(w: Widget, gid: number, fid: number): Widget | undefined {
        const viaManager = widgetManager?.findWidget(gid, fid);
        if (viaManager) return viaManager as Widget;
        return findWidgetLocal(w, gid, fid);
    }

    const g4ScrollContainer = root.groupId === 4 ? findWidgetByGroupFile(root, 4, 5) : undefined;

    function resolveIf1MousedOverWidgetUid(): number | null {
        if (osrsClient?.menuOpen || osrsClient?.dragSourceWidget) {
            return null;
        }

        const hoverTarget =
            typeof clicks?.getHoverTarget === "function" ? clicks.getHoverTarget() : null;
        const hoverId = typeof hoverTarget?.id === "string" ? hoverTarget.id : "";
        if (!hoverId.startsWith("widget:")) {
            return null;
        }

        const hoveredUid = Number.parseInt(hoverId.slice("widget:".length), 10);
        if (!Number.isFinite(hoveredUid)) {
            return null;
        }

        const hoveredWidget =
            widgetManager?.getWidgetByUid(hoveredUid) ??
            findWidgetByGroupFile(root, (hoveredUid >>> 16) & 0xffff, hoveredUid & 0xffff);
        if (!hoveredWidget || hoveredWidget.isIf3 !== false) {
            return null;
        }

        const mouseOverRedirect = (hoveredWidget.mouseOverRedirect ?? -1) | 0;
        const mouseOverColor = (hoveredWidget.mouseOverColor ?? 0) | 0;
        if (mouseOverRedirect < 0 && mouseOverColor === 0) {
            return null;
        }

        if (mouseOverRedirect >= 0) {
            const redirectWidget =
                widgetManager?.findWidget(hoveredWidget.groupId, mouseOverRedirect) ??
                findWidgetByGroupFile(root, hoveredWidget.groupId, mouseOverRedirect);
            return redirectWidget ? (redirectWidget.uid as number) | 0 : null;
        }

        return hoveredUid | 0;
    }

    const mousedOverIf1WidgetUid = resolveIf1MousedOverWidgetUid();

    // Generic steelborder renderer (title/close/divider options)
    // Prefer shared Frame9Slice helpers via plugins/components; no local wrappers here
    function drawWrappedTextGL(
        text: string,
        x: number,
        y: number,
        w: number,
        h: number,
        fontId: number,
        color: number,
        lineHeight = 12,
        shadow = true,
        yAlign: 0 | 1 | 2 = 1,
        xAlign: 0 | 1 | 2 = 1,
    ) {
        const inlineImageResolver = (imgId: number) => {
            const icon = tc.getSpriteCanvas("mod_icons", imgId | 0);
            if (!icon) return undefined;
            return { canvas: icon, width: icon.width, height: icon.height };
        };
        UI_drawWrappedTextGL(
            glr,
            opts.fontLoader,
            text,
            x,
            y,
            w,
            h,
            fontId,
            color,
            lineHeight,
            shadow,
            yAlign,
            xAlign,
            inlineImageResolver,
            rootScaleX,
            rootScaleY,
        );
    }

    function drawTextGL(
        text: string,
        x: number,
        y: number,
        w: number,
        h: number,
        fontId: number,
        color: number,
        xAlign = 0,
        yAlign = 0,
        shadow = false,
        alpha = 1,
    ) {
        const inlineImageResolver = (imgId: number) => {
            const icon = tc.getSpriteCanvas("mod_icons", imgId | 0);
            if (!icon) return undefined;
            return { canvas: icon, width: icon.width, height: icon.height };
        };
        UI_drawTextGL(
            glr,
            opts.fontLoader,
            text,
            x,
            y,
            w,
            h,
            fontId,
            color,
            xAlign,
            yAlign,
            shadow,
            alpha,
            inlineImageResolver,
            rootScaleX,
            rootScaleY,
        );
    }

    // Local wrap helper removed; prefer TextRenderer helpers if needed elsewhere

    function drawRichTextGL(
        text: string,
        x: number,
        y: number,
        w: number,
        h: number,
        fontId: number,
        defaultColor: number,
        xAlign = 0,
        yAlign = 0,
        shadow = false,
        highlightRegex?: RegExp,
        highlightColor?: number,
    ) {
        UI_drawRichTextGL(
            glr,
            opts.fontLoader,
            text,
            x,
            y,
            w,
            h,
            fontId,
            defaultColor,
            xAlign,
            yAlign,
            shadow,
            highlightRegex,
            highlightColor,
            rootScaleX,
            rootScaleY,
        );
    }

    // PERF: Cache debugRects array on canvas instead of creating new one each frame
    let debugRects: { x: number; y: number; w: number; h: number }[] = canvasAny.__debugRects;
    if (!debugRects) {
        debugRects = [];
        canvasAny.__debugRects = debugRects;
    } else {
        debugRects.length = 0; // Clear without reallocating
    }

    // dragged widgets are rendered last (on top of other UI elements).
    // PERF: Cache deferredDragged array on canvas instead of creating new one each frame
    type DeferredDraggedEntry = {
        w: Widget;
        ox: number;
        oy: number;
        parentVisible: boolean;
        inSelected: boolean;
        clip: ClipRect;
    };
    let deferredDragged: DeferredDraggedEntry[] = canvasAny.__deferredDragged;
    if (!deferredDragged) {
        deferredDragged = [];
        canvasAny.__deferredDragged = deferredDragged;
    } else {
        deferredDragged.length = 0; // Clear without reallocating
    }

    // Initial clip bounds = full canvas
    // PERF: Cache fullClip object on canvas instead of creating new one each frame
    let fullClip: ClipRect = canvasAny.__fullClip;
    if (!fullClip) {
        fullClip = { x0: clipX0, y0: clipY0, x1: clipX1, y1: clipY1 };
        canvasAny.__fullClip = fullClip;
    } else {
        fullClip.x0 = clipX0;
        fullClip.y0 = clipY0;
        fullClip.x1 = clipX1;
        fullClip.y1 = clipY1;
    }

    // PERF: Cached click metadata map to avoid closure allocation per widget
    // Stored on canvas, objects are reused and updated in-place (not cleared)
    let clickMetaMap: Map<number, WidgetClickMeta> = canvasAny.__clickMetaMap;
    if (!clickMetaMap) {
        clickMetaMap = new Map();
        canvasAny.__clickMetaMap = clickMetaMap;
    }
    // Note: We don't clear clickMetaMap - objects are reused across frames

    // PERF: Cached click target objects to avoid allocation per widget per frame
    // These are reused and updated in-place
    let clickTargetCache: Map<number, CachedClickTarget> = canvasAny.__clickTargetCache;
    if (!clickTargetCache) {
        clickTargetCache = new Map();
        canvasAny.__clickTargetCache = clickTargetCache;
    }

    // PERF: Single click dispatcher function that looks up metadata by widget uid
    // Created once per render call (not per widget), captures ui/inputManager
    const widgetClickDispatcher = (clickX?: number, clickY?: number, targetId?: string) => {
        // Extract widget uid from the click target id (format: "widget:${uid}")
        if (!targetId) return;
        const uidStr = targetId.replace("widget:", "");
        const uid = parseInt(uidStr, 10);
        if (isNaN(uid)) return;

        const meta = clickMetaMap.get(uid);
        if (!meta) return;

        const hook = ui.onWidgetAction;
        if (typeof hook !== "function") {
            console.warn("[widgets-gl] No onWidgetAction hook set!");
            return;
        }

        try {
            // Check shift state at click time for shift-click drop
            const isShiftHeld = inputManager?.shiftDown === true;
            let actionOption = meta.option;

            // OSRS shift-click drop: if shift held and item has Drop action, use Drop
            if (isShiftHeld && meta.hasDropAction) {
                actionOption = "Drop";
            }

            hook({
                widget: meta.widget,
                option: actionOption,
                target: meta.target,
                source: "primary",
                cursorX: clickX,
                cursorY: clickY,
                slot: meta.slot,
                itemId: meta.itemId,
            });
        } catch (err) {
            console.warn("[widgets-gl] onClick dispatch failed", err);
        }
    };

    function getWidgetEventHandler(
        w: Widget | null | undefined,
        eventType: "onClick" | "onScroll" | "onHold" | "onDrag" | "onDragComplete",
    ): { intArgs?: number[] } | null {
        const handlers = (w as any)?.eventHandlers;
        if (handlers instanceof Map) {
            const handler = handlers.get(eventType);
            return handler && typeof handler === "object" ? handler : null;
        }
        if (handlers && typeof handlers === "object") {
            const handler = handlers[eventType];
            return handler && typeof handler === "object" ? handler : null;
        }
        return null;
    }

    function getScrollbarTargetUidFromHandler(
        parentUid: number,
        handler: { intArgs?: number[] } | null,
    ): number | null {
        const intArgs = handler?.intArgs;
        if (!Array.isArray(intArgs) || intArgs.length < 2) {
            return null;
        }
        const sourceUid = intArgs[0];
        const targetUid = intArgs[1];
        if (!Number.isFinite(sourceUid) || !Number.isFinite(targetUid)) {
            return null;
        }
        if ((sourceUid | 0) !== (parentUid | 0)) {
            return null;
        }
        const normalizedTargetUid = targetUid | 0;
        if (normalizedTargetUid <= 0 || normalizedTargetUid === (parentUid | 0)) {
            return null;
        }
        return normalizedTargetUid;
    }

    function inferScrollbarAxis(
        w: Widget,
        startArrow: Widget | null | undefined,
        endArrow: Widget | null | undefined,
    ): "x" | "y" | null {
        const explicitAxis = (w as any).scrollBarAxis;
        if (explicitAxis === "x" || explicitAxis === "y") {
            return explicitAxis;
        }

        const arrowWidth = Math.max(startArrow?.width ?? 0, endArrow?.width ?? 0);
        const arrowHeight = Math.max(startArrow?.height ?? 0, endArrow?.height ?? 0);
        if (arrowWidth > 0 || arrowHeight > 0) {
            if (arrowHeight === 16 && arrowWidth !== 16) {
                return "y";
            }
            if (arrowWidth === 16 && arrowHeight !== 16) {
                return "x";
            }
            if (arrowWidth > arrowHeight) {
                return "y";
            }
            if (arrowHeight > arrowWidth) {
                return "x";
            }
        }

        const width = w.width ?? 0;
        const height = w.height ?? 0;
        if (height > width) {
            return "y";
        }
        if (width > height) {
            return "x";
        }
        return null;
    }

    // CS2 scrollbar procs wire the parent scrollbar component and scroll target into
    // the child handlers they create, so recover the linkage from that child pattern.
    function resolveScrollbarLink(w: Widget): {
        targetUid: number;
        axis: "x" | "y";
    } | null {
        const anyW = w as any;
        if (typeof anyW.scrollBarTargetUid === "number") {
            return {
                targetUid: anyW.scrollBarTargetUid | 0,
                axis: (anyW.scrollBarAxis as "x" | "y" | undefined) ?? "y",
            };
        }

        const children = Array.isArray(w.children) ? w.children : null;
        if (!children || children.length < 6) {
            return null;
        }

        const track = children[0] as Widget | null | undefined;
        const dragger = children[1] as Widget | null | undefined;
        const startArrow = children[4] as Widget | null | undefined;
        const endArrow = children[5] as Widget | null | undefined;
        if (!track || !dragger || !startArrow || !endArrow) {
            return null;
        }

        const candidateTargets = [
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(track, "onClick")),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(track, "onScroll")),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(dragger, "onDrag")),
            getScrollbarTargetUidFromHandler(
                w.uid,
                getWidgetEventHandler(dragger, "onDragComplete"),
            ),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(startArrow, "onHold")),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(endArrow, "onHold")),
        ];

        let targetUid: number | null = null;
        let bestCount = 0;
        const counts = new Map<number, number>();
        for (const candidate of candidateTargets) {
            if (candidate === null) {
                continue;
            }
            const count = (counts.get(candidate) ?? 0) + 1;
            counts.set(candidate, count);
            if (count > bestCount) {
                bestCount = count;
                targetUid = candidate;
            }
        }
        if (targetUid === null || bestCount < 2) {
            return null;
        }

        const axis = inferScrollbarAxis(w, startArrow, endArrow);
        if (!axis) {
            return null;
        }

        return { targetUid, axis };
    }

    /**
     * Check if widget is hidden.
     *
     * Note: Parent visibility propagates naturally through the recursive rendering -
     * if a parent is hidden, drawNode returns early and children are never visited.
     * This matches OSRS behavior where isComponentHidden doesn't recurse.
     */
    function isComponentHidden(w: Widget): boolean {
        // Only check this widget's visibility, not parents
        if (opts.visible.get(w.uid) === false) return true;
        if (w.hidden) return true;

        // Auto-hide CS2 scrollbars when their linked scroll target
        // has no scrollable range (maxScroll <= 0).
        const scrollbarLink = widgetManager ? resolveScrollbarLink(w) : null;
        if (scrollbarLink && widgetManager) {
            const target = widgetManager.getWidgetByUid(scrollbarLink.targetUid);
            if (target) {
                widgetManager.ensureLayout(target);
                const maxScroll =
                    scrollbarLink.axis === "x"
                        ? Math.max(0, (target.scrollWidth ?? 0) - (target.width ?? 0))
                        : Math.max(0, (target.scrollHeight ?? 0) - (target.height ?? 0));
                if (maxScroll <= 0) return true;
            }
        }

        return false;
    }
    function drawNode(
        w: Widget,
        ox: number,
        oy: number,
        parentVisible: boolean,
        inSelected: boolean,
        clip: ClipRect = fullClip,
        deferDragged: boolean = true,
    ) {
        const prepStartMs = profileWidgetRender ? performance.now() : 0;
        // contentType-driven widget mutations applied during draw.
        //
        const prepContentTypeStartMs = profileWidgetRender ? performance.now() : 0;
        try {
            const ct = ((w.contentType ?? 0) | 0) as number;
            if (ct === 324 || ct === 325) {
                // gender toggle sprites depend on Client.playerAppearance.gender.
                //
                // PlayerDesign can be shown before a world player exists; use the CS2 varbit mirror.
                // varbit 14021 (player_design_bodytype) is set to gender (0/1) by the client.
                let gender = 0;
                try {
                    gender =
                        (osrsClient?.varManager?.getVarbit?.(14021) ??
                            (() => {
                                const idx = osrsClient?.playerEcs?.getIndexForServerId?.(
                                    osrsClient?.controlledPlayerServerId,
                                );
                                const ap =
                                    idx !== undefined
                                        ? osrsClient?.playerEcs?.getAppearance?.(idx)
                                        : null;
                                return typeof ap?.gender === "number" ? ap.gender | 0 : 0;
                            })()) & 1;
                } catch {
                    gender = 0;
                }

                // Cache the original sprite IDs once.
                const anyClient = osrsClient as any;
                if (anyClient) {
                    if (
                        !Number.isFinite(anyClient.__pdSpriteA) ||
                        !Number.isFinite(anyClient.__pdSpriteB)
                    ) {
                        anyClient.__pdSpriteA =
                            typeof w.spriteId === "number" ? w.spriteId | 0 : -1;
                        anyClient.__pdSpriteB =
                            typeof w.spriteId2 === "number" ? w.spriteId2 | 0 : -1;
                    }
                    const spriteA = (anyClient.__pdSpriteA as number) | 0;
                    const spriteB = (anyClient.__pdSpriteB as number) | 0;
                    if (spriteA >= 0 && spriteB >= 0) {
                        if (ct === 324) {
                            w.spriteId = gender === 1 ? spriteA : spriteB;
                        } else {
                            w.spriteId = gender === 1 ? spriteB : spriteA;
                        }
                    }
                }
            }
            if (ct === 327 || ct === 328) {
                // Reference:
                const cycleCntr = ((osrsClient?.transmitCycles?.cycleCntr ?? 0) | 0) as number;
                const angleX = 150;
                const angleY = ((Math.sin(cycleCntr / 40.0) * 256.0) | 0) & 2047;
                const angleZ = 0;
                (w as any).modelAngleX = angleX;
                (w as any).modelAngleY = angleY;
                (w as any).modelAngleZ = angleZ;
                (w as any).rotationX = angleX;
                (w as any).rotationY = angleY;
                (w as any).rotationZ = angleZ;
                // modelType=5, modelId=0 (playerAppearance) for 327; modelId=1 (localPlayer) for 328
                (w as any).modelType = 5;
                (w as any).modelId = ct === 327 ? 0 : 1;
            }
        } catch {}
        if (profileWidgetRender) {
            prepContentTypeMs += performance.now() - prepContentTypeStartMs;
        }

        // Determine if this is an IF3 widget
        // Default to IF3 (modern) if not specified
        const isIf3 = w.isIf3 !== false;

        // Check widget visibility
        // IF1 widgets: Always enter the render block (visibility checked later for containers)
        // IF3 widgets: Skip if hidden
        const prepVisibilityStartMs = profileWidgetRender ? performance.now() : 0;
        if (isIf3 && isComponentHidden(w)) {
            if (profileWidgetRender) {
                prepVisibilityMs += performance.now() - prepVisibilityStartMs;
            }
            return;
        }

        // Parent visible tracking for rendering context
        const selfVisible = opts.visible.get(w.uid) !== false && !w.hidden;
        const eff = parentVisible && selfVisible;

        if (!eff) {
            if (profileWidgetRender) {
                prepVisibilityMs += performance.now() - prepVisibilityStartMs;
            }
            return;
        }
        if (profileWidgetRender) {
            prepVisibilityMs += performance.now() - prepVisibilityStartMs;
        }
        if (profileWidgetRender) {
            prepMs += performance.now() - prepStartMs;
        }

        // PERF: Count widgets being rendered
        ps._widgetRenderCount++;

        // Ensure layout is valid before reading computed dimensions
        // CS2 scripts (like quest tab) may have modified rawWidth/rawHeight via CC_SETSIZE,
        // invalidating the widget. This JIT validation ensures width/height are up-to-date.
        // Check for falsy (false or undefined) since initial state may be undefined
        const layoutStartMs = profileWidgetRender ? performance.now() : 0;
        if (widgetManager && !w.isLayoutValid) {
            widgetManager.ensureLayout(w);
        }
        if (profileWidgetRender) {
            layoutMs += performance.now() - layoutStartMs;
        }

        // Compute widget position and size in buffer coordinates
        // For widgets being dragged with dragRenderBehaviour=1, use visual position
        const clipStartMs = profileWidgetRender ? performance.now() : 0;
        const isDragActive = !!(w as any)._isDragActive;
        const isClickedWidget =
            clickedWidgetUid !== null && ((w.uid as number) | 0) === clickedWidgetUid;
        const rawVisualX = isDragActive ? ((w as any)._dragVisualX ?? w.x) : w.x;
        const rawVisualY = isDragActive ? ((w as any)._dragVisualY ?? w.y) : w.y;
        const visualX = (Number(rawVisualX) || 0) | 0;
        const visualY = (Number(rawVisualY) || 0) | 0;
        const logicalX = ox + visualX;
        const logicalY = oy + visualY;
        const logicalWidth = Math.max(1, w.width | 0);
        const logicalHeight = Math.max(1, w.height | 0);
        // Use consistent rounded edges to avoid 1px overlap/gap jitter at fractional scales.
        const x = Math.round(logicalX * rootScaleX + rootOffsetX);
        const y = Math.round(logicalY * rootScaleY + rootOffsetY);
        const x1 = Math.round((logicalX + logicalWidth) * rootScaleX + rootOffsetX);
        const y1 = Math.round((logicalY + logicalHeight) * rootScaleY + rootOffsetY);
        const width = Math.max(1, x1 - x);
        const height = Math.max(1, y1 - y);
        // A custom gameframe can hide the stock gameframe's own chrome (its
        // background/border sprite and rect widgets, which live in the root
        // interface) while leaving all interface widgets, including mounted tab
        // interfaces and their backgrounds, to render.
        const isRootGroupWidget =
            typeof opts.rootGroupId === "number" && ((w.uid >>> 16) === (opts.rootGroupId | 0));
        const skipOwnVisuals =
            opts.hideStockChrome === true &&
            (w.type === 3 || w.type === 5) &&
            isRootGroupWidget &&
            !(opts.keepChromeUids?.includes(w.uid) ?? false);
        const isContainer = w.type === 0 || w.type === 11;
        const staticChildren = isContainer
            ? (widgetManager?.getStaticChildrenByParentUid(w.uid) ?? EMPTY_WIDGETS)
            : EMPTY_WIDGETS;
        const dynamicChildren = widgetManager?.getDynamicChildrenByParent(w) ?? EMPTY_WIDGETS;
        const hasStaticChildren = staticChildren.length > 0;
        const hasChildren = dynamicChildren.length > 0;

        // Calculate widget clip bounds based on widget type
        // Reference: UserComparator5.drawInterface lines 142-170
        // Type 9 (Line) widgets have special clip calculation for negative dimensions
        let widgetClip: ClipRect;
        if (w.type === 9) {
            // Type 9 lines can have negative dimensions
            widgetClip = calculateType9Clip(clip, x, y, width, height);
        } else {
            widgetClip = calculateStandardClip(clip, x, y, width, height);
        }

        // Early cull check based on clip validity
        // Reference: UserComparator5.drawInterface line 172: if (!var10.isIf3 || var15 < var17 && var16 < var18)
        // IF3 widgets: only render if clip has positive area (var15 < var17 && var16 < var18)
        // IF1 widgets: always render (legacy behavior, even with invalid clip - clipping handled by scissor)
        //
        // IMPORTANT: Containers (type 0/11) with children should NOT be early-culled, because
        // their children may extend beyond the container's own bounds (e.g., scroll content).
        // The children themselves will be individually culled based on their own bounds.
        //
        // IMPORTANT: Actively dragged widgets should NOT be culled - they need to be deferred
        // for rendering on top, even when dragged outside their parent's clip bounds.
        const hasRenderableChildren = hasChildren || (isContainer && hasStaticChildren);
        if (isIf3 && !isClipValid(widgetClip) && !hasRenderableChildren && !isDragActive) {
            return; // IF3 widget is completely outside visible area and has no children
        }
        if (profileWidgetRender) {
            clipMs += performance.now() - clipStartMs;
        }
        // Note: IF1 widgets are NOT culled here - they rely on scissor clipping only.

        // Record absolute widget position for drag math and viewport queries.
        // Only write when values actually change to avoid per-frame property churn.
        const boundsStartMs = profileWidgetRender ? performance.now() : 0;
        try {
            const wAny = w as any;
            if (w._absX !== x) w._absX = x;
            if (w._absY !== y) w._absY = y;
            if (wAny._absLogicalX !== logicalX) wAny._absLogicalX = logicalX;
            if (wAny._absLogicalY !== logicalY) wAny._absLogicalY = logicalY;
            if (wAny._absWidth !== width) wAny._absWidth = width;
            if (wAny._absHeight !== height) wAny._absHeight = height;
        } catch {}
        if (profileWidgetRender) {
            boundsMs += performance.now() - boundsStartMs;
        }

        // draw dragged widget last so it appears above everything else.
        // Preserve clip/offset so it still respects the same scissor bounds.
        // IMPORTANT: Scrollbar widgets (dragRenderBehaviour=1) should NOT be deferred.
        // They must render inline to maintain proper z-order with sibling sprites
        // (the top/bottom cap decorations are positioned relative to the dragger).
        // Only inventory-style widgets (dragRenderBehaviour >= 2) need deferral.
        const deferStartMs = profileWidgetRender ? performance.now() : 0;
        const dragBehaviour = (w as any).dragRenderBehaviour ?? 2;
        if (deferDragged && isDragActive && dragBehaviour !== 1) {
            if (profileWidgetRender) {
                deferMs += performance.now() - deferStartMs;
            }
            deferredDragged.push({ w, ox, oy, parentVisible, inSelected, clip });
            return;
        }
        if (profileWidgetRender) {
            deferMs += performance.now() - deferStartMs;
        }
        // Check if this widget is the selected item (for "Use" outline)
        // In OSRS, selected items get a white pixel-perfect outline
        const selectionStartMs = profileWidgetRender ? performance.now() : 0;
        let isSelectedHere = false;
        if (ClientState.isItemSelected === 1) {
            // Primary check: exact UID match (for static widgets)
            if (w.uid === ClientState.selectedItemWidget) {
                isSelectedHere = true;
            }
            // Secondary check: for dynamic children created by CC_CREATE
            // Dynamic children have parentUid storing the container widget's UID,
            // and childIndex storing their slot position within the container.
            // selectedItemWidget = container widget UID, selectedItemSlot = slot index
            else if (
                (w as any).parentUid === ClientState.selectedItemWidget &&
                (w as any).childIndex === ClientState.selectedItemSlot
            ) {
                isSelectedHere = true;
            }
            // Tertiary check: match on group + slot for inventory containers
            // Widget UID is (groupId << 16) | childId format
            else {
                const widgetGroup = (w.uid >>> 16) & 0xffff;
                const selectedGroup = (ClientState.selectedItemWidget >>> 16) & 0xffff;
                const widgetChildIndex = (w as any).childIndex ?? w.uid & 0xffff;
                if (
                    widgetGroup === selectedGroup &&
                    widgetChildIndex === ClientState.selectedItemSlot
                ) {
                    isSelectedHere = true;
                }
            }
        }
        if (profileWidgetRender) {
            selectionMs += performance.now() - selectionStartMs;
        }

        // Default click target registration based on widget actions/verb OR CS2 event handlers
        const clickRegistrationStartMs = profileWidgetRender ? performance.now() : 0;
        try {
            const clickShallowStartMs = profileWidgetRender ? performance.now() : 0;
            const shouldProbeInteraction = shouldProbeWidgetInteractionShallow(w as any);
            if (profileWidgetRender) {
                clickShallowMs += performance.now() - clickShallowStartMs;
            }
            if (!shouldProbeInteraction) {
                // Continue with normal widget rendering; this widget does not participate in UI hit logic.
            } else {
                const clickProbeStartMs = profileWidgetRender ? performance.now() : 0;
                const interaction = getWidgetInteractionSnapshot(
                    w as any,
                    getCachedWidgetFlags,
                    widgetFlagsVersion,
                );
                const widgetActions = Array.isArray(w.actions) ? (w.actions as any[]) : undefined;
                const widgetItemId = (w as any).itemId;
                if (profileWidgetRender) {
                    clickProbeMs += performance.now() - clickProbeStartMs;
                }
                if (interaction.shouldDeriveEntries) {
                    menuDeriveWidgets++;
                }

                // Use widgetManager.getWidgetFlags for IF_SETEVENTS override lookup.
                // Without this, equipment slots won't show "Remove" if flags are only set via IF_SETEVENTS.
                const getWidgetFlagsLocal = widgetManager ? getCachedWidgetFlags : undefined;
                const clickDeriveStartMs = profileWidgetRender ? performance.now() : 0;
                const entries = interaction.shouldDeriveEntries
                    ? deriveMenuEntriesForWidgetCached(w as any, getWidgetFlagsLocal)
                    : [];
                if (profileWidgetRender) {
                    clickDeriveMs += performance.now() - clickDeriveStartMs;
                }
                menuEntriesTotal += entries.length | 0;
                const clickPrimaryFindStartMs = profileWidgetRender ? performance.now() : 0;
                const primary = entries.find((e) => {
                    const lower = String(e?.option ?? "")
                        .trim()
                        .toLowerCase();
                    return !!lower && lower !== "cancel" && lower !== "examine";
                });
                if (profileWidgetRender) {
                    clickPrimaryFindMs += performance.now() - clickPrimaryFindStartMs;
                }

                if (
                    primary ||
                    interaction.hasCs2Click ||
                    interaction.hasActions ||
                    interaction.hasOriginalHandlers ||
                    interaction.isInventoryItem ||
                    interaction.isPauseButtonWidget ||
                    interaction.hasButtonTypeInteraction
                ) {
                    clickCandidateWidgets++;
                    interactiveWidgets++;
                    const clickPrimaryResolveStartMs = profileWidgetRender ? performance.now() : 0;
                    let primaryOptionText = primary?.option ?? "";
                    let primaryTarget = primary?.target;

                    // For inventory items, use the widget's actions array to find the primary action
                    // The CS2 scripts set actions on inventory widgets from the item definition
                    // We need to find the first non-empty, non-Drop, non-Examine action
                    if (interaction.isInventoryItem && widgetActions) {
                        const clickInventoryPrimaryStartMs = profileWidgetRender
                            ? performance.now()
                            : 0;
                        const itemWidgetActions = widgetActions as (string | null | undefined)[];
                        const hasNonUseAction = widgetActions.some((action) => {
                            if (!action || typeof action !== "string") return false;
                            const lower = action.trim().toLowerCase();
                            if (!lower) return false;
                            return (
                                lower !== "use" &&
                                lower !== "drop" &&
                                lower !== "examine" &&
                                lower !== "cancel"
                            );
                        });
                        for (let i = 0; i < itemWidgetActions.length; i++) {
                            const action = itemWidgetActions[i];
                            if (!action || typeof action !== "string") continue;
                            const trimmed = action.trim();
                            if (!trimmed) continue;
                            const lower = trimmed.toLowerCase();
                            if (lower === "drop" || lower === "examine" || lower === "cancel")
                                continue;
                            if (hasNonUseAction && lower === "use") continue;
                            primaryOptionText = trimmed;
                            break;
                        }
                        if (profileWidgetRender) {
                            clickInventoryPrimaryMs +=
                                performance.now() - clickInventoryPrimaryStartMs;
                        }
                    }

                    // Pause button widgets show "Continue" with empty target
                    if (interaction.isPauseButtonWidget && !primaryOptionText) {
                        primaryOptionText = "Continue";
                        primaryTarget = undefined;
                    }
                    if (profileWidgetRender) {
                        clickPrimaryResolveMs += performance.now() - clickPrimaryResolveStartMs;
                    }

                    // Check if widget has a Drop action (for shift-click drop)
                    const clickMetaStartMs = profileWidgetRender ? performance.now() : 0;
                    const hasDropAction =
                        interaction.isInventoryItem &&
                        !!widgetActions &&
                        widgetActions.some(
                            (a: any) =>
                                a && typeof a === "string" && a.trim().toLowerCase() === "drop",
                        );

                    // PERF: Update cached metadata object in-place instead of creating new
                    const slot =
                        typeof (w as any).childIndex === "number"
                            ? (w as any).childIndex | 0
                            : undefined;
                    const itemId = typeof widgetItemId === "number" ? widgetItemId | 0 : undefined;

                    let meta = clickMetaMap.get(w.uid);
                    if (!meta) {
                        meta = {
                            widget: w,
                            option: primaryOptionText,
                            target: primaryTarget,
                            hasDropAction,
                            itemId,
                            slot,
                        };
                        clickMetaMap.set(w.uid, meta);
                    } else {
                        meta.widget = w;
                        meta.option = primaryOptionText;
                        meta.target = primaryTarget;
                        meta.hasDropAction = hasDropAction;
                        meta.itemId = itemId;
                        meta.slot = slot;
                    }
                    if (profileWidgetRender) {
                        clickMetaMs += performance.now() - clickMetaStartMs;
                    }

                    // PERF: Get or create cached click target, update in-place
                    // OSRS-style: persist=true for performance, visibility checked at query time via widgetUid
                    const clickTargetStartMs = profileWidgetRender ? performance.now() : 0;
                    let target = clickTargetCache.get(w.uid);
                    if (!target) {
                        const targetId = `widget:${w.uid}`;
                        const newTarget: CachedClickTarget = {
                            id: targetId,
                            rect: { x, y, w: width, h: height },
                            priority: 100,
                            hoverText: primaryOptionText,
                            primaryOption:
                                primaryOptionText || primaryTarget
                                    ? { option: primaryOptionText, target: primaryTarget }
                                    : undefined,
                            menuOptionsCount: entries.length | 0,
                            persist: true, // OSRS-style: persist for perf, visibility checked at query time
                            widgetUid: w.uid, // For OSRS-style visibility filtering during hit testing
                        };
                        clickTargetCache.set(w.uid, newTarget);
                        target = newTarget;
                        (w as any).__clickTargetId = targetId;
                    } else {
                        // Update rect in-place
                        target.rect.x = x;
                        target.rect.y = y;
                        target.rect.w = width;
                        target.rect.h = height;
                        target.hoverText = primaryOptionText;
                        // left-click primary actions are handled by OsrsClient.handleUiInput,
                        // not by the GL click registry. Ensure any previously-set handlers are cleared.
                        target.onDown = undefined;
                        target.onClick = undefined;
                        // Update primaryOption in-place if it exists, create if needed
                        if (primaryOptionText || primaryTarget) {
                            if (!target.primaryOption) {
                                target.primaryOption = {
                                    option: primaryOptionText,
                                    target: primaryTarget,
                                };
                            } else {
                                target.primaryOption.option = primaryOptionText;
                                target.primaryOption.target = primaryTarget;
                            }
                        } else {
                            target.primaryOption = undefined;
                        }
                        target.menuOptionsCount = entries.length | 0;
                        (w as any).__clickTargetId = target.id;
                    }
                    if (profileWidgetRender) {
                        clickTargetMs += performance.now() - clickTargetStartMs;
                    }

                    const clickRegisterStartMs = profileWidgetRender ? performance.now() : 0;
                    if (!skipOwnVisuals) {
                        clicks.register(target);
                        clickRegisteredWidgets++;
                    }

                    // Debug: draw purple outline for clickable areas
                    if (DEBUG_CLICK_AREAS) {
                        const purple = [0.8, 0.2, 0.8, 1.0] as [number, number, number, number];
                        // Top edge
                        glr.drawRect(x, y, width, 1, purple);
                        // Bottom edge
                        glr.drawRect(x, y + height - 1, width, 1, purple);
                        // Left edge
                        glr.drawRect(x, y, 1, height, purple);
                        // Right edge
                        glr.drawRect(x + width - 1, y, 1, height, purple);
                    }
                    if (profileWidgetRender) {
                        clickRegisterMs += performance.now() - clickRegisterStartMs;
                    }
                } else if (ClientState.isSpellSelected || ClientState.isItemSelected === 1) {
                    clickCandidateWidgets++;
                    const clickCancelSetupStartMs = profileWidgetRender ? performance.now() : 0;
                    // Widget has no options, but there's an active spell/item selection.
                    // Register a click target so clicking this widget cancels the selection.
                    // This matches OSRS behavior where clicking on widgets without valid
                    // targeting options cancels spell/item selection.
                    // PERF: Reuse cached click target object, update in-place
                    // OSRS-style: persist=true for performance, visibility checked at query time via widgetUid
                    const clickTargetStartMs = profileWidgetRender ? performance.now() : 0;
                    let target = clickTargetCache.get(w.uid);
                    if (!target) {
                        const targetId = `widget:${w.uid}`;
                        const newTarget: CachedClickTarget = {
                            id: targetId,
                            rect: { x, y, w: width, h: height },
                            priority: 50,
                            hoverText: undefined,
                            primaryOption: undefined,
                            onClick: CANCEL_SELECTION_HANDLER,
                            persist: true, // OSRS-style: persist for perf, visibility checked at query time
                            widgetUid: w.uid, // For OSRS-style visibility filtering during hit testing
                        };
                        clickTargetCache.set(w.uid, newTarget);
                        target = newTarget;
                        (w as any).__clickTargetId = targetId;
                    } else {
                        target.rect.x = x;
                        target.rect.y = y;
                        target.rect.w = width;
                        target.rect.h = height;
                        target.priority = 50;
                        target.hoverText = undefined;
                        target.primaryOption = undefined;
                        target.onClick = CANCEL_SELECTION_HANDLER;
                        (w as any).__clickTargetId = target.id;
                    }
                    if (profileWidgetRender) {
                        clickCancelSetupMs += performance.now() - clickCancelSetupStartMs;
                        clickTargetMs += performance.now() - clickTargetStartMs;
                    }

                    const clickRegisterStartMs = profileWidgetRender ? performance.now() : 0;
                    if (!skipOwnVisuals) {
                        clicks.register(target);
                        clickRegisteredWidgets++;
                    }
                    cancelSelectionWidgets++;
                    if (profileWidgetRender) {
                        clickRegisterMs += performance.now() - clickRegisterStartMs;
                    }
                }
            }
        } catch {}
        if (profileWidgetRender) {
            clickRegistrationMs += performance.now() - clickRegistrationStartMs;
        }

        // Auto-scroll clamping for IF1 containers only
        // Scrollbar rendering
        // IF3 widgets handle scroll bounds via CS2 scripts, IF1 clamps automatically
        if (w.type === 0 && !isIf3) {
            const scrollClampStartMs = profileWidgetRender ? performance.now() : 0;
            const scrollH = w.scrollHeight ?? 0;
            const prevScrollY = w.scrollY ?? 0;
            if ((w.scrollY || 0) > scrollH - w.height) {
                w.scrollY = scrollH - w.height;
            }
            if ((w.scrollY || 0) < 0) {
                w.scrollY = 0;
            }
            if (profileWidgetRender) {
                scrollClampMs += performance.now() - scrollClampStartMs;
            }
        }

        // IF1 type 0 containers draw scrollbar when scrollHeight > height
        // Widget border rendering
        // Scrollbar is drawn on the right edge of the container
        if (w.type === 0 && !isIf3 && (w.scrollHeight ?? 0) > logicalHeight) {
            const scrollbarStartMs = profileWidgetRender ? performance.now() : 0;
            drawScrollBar(
                glr,
                x + width, // scrollbar is drawn at the right edge (x + width)
                y,
                Math.round((w.scrollY ?? 0) * rootScaleY),
                height,
                Math.max(1, Math.round((w.scrollHeight ?? 0) * rootScaleY)),
                tc,
                opts,
                rootScaleX,
                rootScaleY,
            );
            if (profileWidgetRender) {
                scrollbarMs += performance.now() - scrollbarStartMs;
            }
        }

        // Check if this widget is being hovered (for hover state rendering)
        const hoverStartMs = profileWidgetRender ? performance.now() : 0;
        const widgetUid = (w.uid as number) | 0;
        const hoverVisual = shouldCheckWidgetHoverVisual(w, isIf3);
        const isWidgetHovered =
            hoverVisual &&
            (isIf3
                ? ((w as any).__clickTargetId &&
                      (clicks?.isHover?.((w as any).__clickTargetId) ?? false)) ||
                  clicks?.isHover?.(`widget:${w.uid}`) ||
                  false
                : mousedOverIf1WidgetUid === widgetUid);
        if (profileWidgetRender) {
            hoverMs += performance.now() - hoverStartMs;
        }
        // Special handling for compass widget (contentType 1339)
        // Compass is rendered before type-based logic
        //  draws WallDecoration.compass with camera yaw rotation and circular mask
        const contentType = (w as any).contentType ?? 0;
        // A custom gameframe can hide stock widgets outright (compass, XP drops...).
        const hiddenRule = opts.widgetRules?.find(
            (r) => r.hide === true &&
                (r.uid === undefined || r.uid === w.uid) &&
                (r.group === undefined || r.group === (w.uid >>> 16)) &&
                (r.type === undefined || r.type === w.type) &&
                (r.contentType === undefined || r.contentType === contentType),
        );
        if (hiddenRule) return;
        if (contentType === 1339) {
            const compassStartMs = profileWidgetRender ? performance.now() : 0;
            const compassSpriteId = opts.widgetManager?.compassSpriteId ?? -1;
            if (compassSpriteId >= 0) {
                const compassTex = tc.getSpriteById(compassSpriteId);
                if (compassTex) {
                    // Get rotation from spriteAngle (set by updateCompassAngle based on camera yaw)
                    // spriteAngle is in 16-bit format (0-65536 = 360 degrees)
                    const spriteAngle = w.spriteAngle ?? 0;

                    // The widget's primary sprite defines the circular mask.
                    // Reference: Widget.ac(..., false) uses spriteId.
                    const maskSpriteId = w.spriteId ?? -1;
                    const maskTex = maskSpriteId >= 0 ? tc.getSpriteById(maskSpriteId) : null;

                    if (maskTex) {
                        // draw at mask sprite's natural dimensions, not widget bounds.
                        // Reference: MinimapUtils.drawCompass uses spriteMask.width/height, not widget.width/height.
                        // The compass content sprite (compassTex) is larger than the display area (maskTex)
                        // because it includes transparent padding to avoid rotation seams. We center-crop
                        // the content UV to match Java's srcCenterX=25, srcCenterY=25 (center of 51x51 sprite).
                        const maskW = Math.round(maskTex.w * rootScaleX);
                        const maskH = Math.round(maskTex.h * rootScaleY);
                        const compassX = x + Math.round((width - maskW) / 2);
                        const compassY = y + Math.round((height - maskH) / 2);
                        const contentU0 = (compassTex.w / 2 - maskTex.w / 2) / compassTex.w;
                        const contentV0 = (compassTex.h / 2 - maskTex.h / 2) / compassTex.h;
                        const contentU1 = (compassTex.w / 2 + maskTex.w / 2) / compassTex.w;
                        const contentV1 = (compassTex.h / 2 + maskTex.h / 2) / compassTex.h;
                        glr.drawTextureRotatedMasked(
                            compassTex,
                            maskTex,
                            compassX,
                            compassY,
                            maskW,
                            maskH,
                            spriteAngle,
                            65536,
                            contentU0,
                            contentV0,
                            contentU1,
                            contentV1,
                        );
                    } else {
                        // Fallback: draw without mask, centered within widget
                        glr.drawTextureRotated(
                            compassTex,
                            x,
                            y,
                            width,
                            height,
                            spriteAngle,
                            65536,
                            0,
                            [0, 0, 0],
                            1,
                        );
                    }
                }
            }
            if (profileWidgetRender) {
                compassMs += performance.now() - compassStartMs;
            }
            // Skip normal type-based rendering for compass (OSRS uses continue)
            // But still need to traverse children, so don't return here
        }

        if (contentType === 1400) {
            const osrsClient = (opts.game as any)?.osrsClient;
            const worldMapState = osrsClient?.worldMapState;
            worldMapState?.setDisplaySize?.(logicalWidth | 0, logicalHeight | 0);

            const backgroundColor = worldMapState?.currentArea?.backgroundColor ?? 0x000000;
            glr.drawRect(x, y, width, height, [
                ((backgroundColor >>> 16) & 0xff) / 255,
                ((backgroundColor >>> 8) & 0xff) / 255,
                (backgroundColor & 0xff) / 255,
                1,
            ]);

            const worldMapIconBounds: any[] = [];
            const currentArea = worldMapState?.currentArea;
            if (worldMapState?.isLoaded?.() && currentArea) {
                const logicalPixelsPerTile = worldMapState.getZoomScale?.() ?? 4;
                const screenScaleX = logicalWidth > 0 ? width / logicalWidth : rootScaleX;
                const screenScaleY = logicalHeight > 0 ? height / logicalHeight : rootScaleY;
                const renderScale = (screenScaleX + screenScaleY) / 2;
                const pixelsPerTileX = logicalPixelsPerTile * screenScaleX;
                const pixelsPerTileY = logicalPixelsPerTile * screenScaleY;
                const centerX = x + width / 2;
                const centerY = y + height / 2;
                const displayX = worldMapState.displayX | 0;
                const displayY = worldMapState.displayY | 0;
                const worldMapRenderHost = osrsClient as any;
                const projectDisplayToScreen = (displayCoordX: number, displayCoordY: number) => ({
                    x: centerX + (displayCoordX - displayX) * pixelsPerTileX,
                    y: centerY - (displayCoordY - displayY) * pixelsPerTileY,
                });
                const tileDrawWidth = 64 * pixelsPerTileX;
                const tileDrawHeight = 64 * pixelsPerTileY;
                const worldMapLevel = Math.max(0, Math.min(3, currentArea.origin.plane | 0));
                let visibleWorldMapTiles: Array<{
                    mapX: number;
                    mapY: number;
                    distance: number;
                    sourceTile: { mapX: number; mapY: number; level?: number };
                }>;
                let maxVisibleTileDistance = 0;
                const visibleTileCacheKey = [
                    currentArea.id | 0,
                    displayX,
                    displayY,
                    logicalWidth | 0,
                    logicalHeight | 0,
                    worldMapState.zoomPercentage | 0,
                    worldMapLevel,
                ].join(":");
                const visibleTileCache = worldMapRenderHost?.__worldMapVisibleTileCache;
                if (visibleTileCache?.key === visibleTileCacheKey) {
                    visibleWorldMapTiles = visibleTileCache.tiles;
                    maxVisibleTileDistance = visibleTileCache.maxDistance;
                } else {
                    const bounds = currentArea.getBounds();
                    const minVisibleTileX =
                        displayX - logicalWidth / (2 * logicalPixelsPerTile) - 64;
                    const maxVisibleTileX =
                        displayX + logicalWidth / (2 * logicalPixelsPerTile) + 64;
                    const minVisibleTileY =
                        displayY - logicalHeight / (2 * logicalPixelsPerTile) - 64;
                    const maxVisibleTileY =
                        displayY + logicalHeight / (2 * logicalPixelsPerTile) + 64;
                    const minMapX = Math.max(bounds.minX >> 6, Math.floor(minVisibleTileX / 64));
                    const maxMapX = Math.min(bounds.maxX >> 6, Math.floor(maxVisibleTileX / 64));
                    const minMapY = Math.max(bounds.minY >> 6, Math.floor(minVisibleTileY / 64));
                    const maxMapY = Math.min(bounds.maxY >> 6, Math.floor(maxVisibleTileY / 64));
                    const visibleMapTiles: Array<{
                        mapX: number;
                        mapY: number;
                        distance: number;
                    }> = [];
                    for (let mapY = minMapY; mapY <= maxMapY; mapY++) {
                        for (let mapX = minMapX; mapX <= maxMapX; mapX++) {
                            const tileCenterX = mapX * 64 + 32;
                            const tileCenterY = mapY * 64 + 32;
                            const dx = tileCenterX - displayX;
                            const dy = tileCenterY - displayY;
                            visibleMapTiles.push({ mapX, mapY, distance: dx * dx + dy * dy });
                        }
                    }
                    if (visibleMapTiles.length > 1) {
                        visibleMapTiles.sort((a, b) => a.distance - b.distance);
                    }
                    maxVisibleTileDistance =
                        visibleMapTiles.length > 0
                            ? visibleMapTiles[visibleMapTiles.length - 1].distance
                            : 0;
                    visibleWorldMapTiles = visibleMapTiles.map(({ mapX, mapY, distance }) => {
                        const sourceTile = { mapX, mapY, level: worldMapLevel };
                        return { mapX, mapY, distance, sourceTile };
                    });
                    if (worldMapRenderHost) {
                        worldMapRenderHost.__worldMapVisibleTileCache = {
                            key: visibleTileCacheKey,
                            tiles: visibleWorldMapTiles,
                            maxDistance: maxVisibleTileDistance,
                        };
                    }
                }
                osrsClient?.retainWorldMapImageTiles?.(visibleWorldMapTiles);

                for (const { mapX, mapY, distance, sourceTile } of visibleWorldMapTiles) {
                    const sourceLevel = (sourceTile.level ?? currentArea.origin.plane ?? 0) | 0;
                    const source = osrsClient?.getWorldMapImageSource?.(
                        sourceTile.mapX,
                        sourceTile.mapY,
                        sourceLevel,
                        maxVisibleTileDistance - distance,
                    );
                    if (!source) {
                        continue;
                    }
                    const tileTex = source.pixels
                        ? tc.getTextureFromRgbaPixels(
                              source.key,
                              source.pixels,
                              source.width,
                              source.height,
                          )
                        : tc.getTextureByKey(source.key);
                    if (!tileTex) {
                        continue;
                    }
                    if (source.pixels) {
                        osrsClient?.markWorldMapImageTextureUploaded?.(source.key);
                    }

                    const tileTopLeft = projectDisplayToScreen(mapX * 64, mapY * 64 + 64);
                    glr.drawTexture(
                        tileTex,
                        tileTopLeft.x,
                        tileTopLeft.y,
                        tileDrawWidth,
                        tileDrawHeight,
                        1,
                        1,
                    );
                }

                const mapElementCache =
                    worldMapRenderHost.__worldMapElementCache ??
                    (worldMapRenderHost.__worldMapElementCache = new Map<number, any>());
                const labelMetricsCache =
                    worldMapRenderHost.__worldMapLabelMetricsCache ??
                    (worldMapRenderHost.__worldMapLabelMetricsCache = new Map<
                        string,
                        WorldMapLabelMetrics
                    >());
                const worldMapLabelDraws: WorldMapLabelDraw[] = [];
                const getMapElement = (elementId: number) => {
                    if (mapElementCache.has(elementId)) return mapElementCache.get(elementId);
                    let element;
                    try {
                        element = osrsClient?.mapElementTypeLoader?.load?.(elementId | 0);
                    } catch {
                        element = undefined;
                    }
                    mapElementCache.set(elementId, element);
                    return element;
                };
                const getWorldMapLabelFontId = (textSize: number) => {
                    if ((textSize | 0) === 1) return FONT_VERDANA_13;
                    if ((textSize | 0) === 2) return FONT_VERDANA_15;
                    return FONT_VERDANA_11;
                };
                const isWorldMapLabelVisible = (textSize: number) => {
                    if ((textSize | 0) === 0) return logicalPixelsPerTile >= 3;
                    if ((textSize | 0) === 1) return logicalPixelsPerTile >= 2;
                    return true;
                };
                const getSpriteXOffset = (textureWidth: number, horizontalAlignment: number) => {
                    if ((horizontalAlignment | 0) === 0) return -textureWidth / 2;
                    if ((horizontalAlignment | 0) === 1) return 0;
                    return -textureWidth;
                };
                const getSpriteYOffset = (textureHeight: number, verticalAlignment: number) => {
                    if ((verticalAlignment | 0) === 0) return -textureHeight / 2;
                    if ((verticalAlignment | 0) === 2) return 0;
                    return -textureHeight;
                };

                for (const { sourceTile } of visibleWorldMapTiles) {
                    const sourceLevel = (sourceTile.level ?? currentArea.origin.plane ?? 0) | 0;
                    const icons = osrsClient?.getWorldMapIcons?.(
                        sourceTile.mapX,
                        sourceTile.mapY,
                        sourceLevel,
                    );
                    if (!icons || icons.length === 0) continue;

                    for (const icon of icons) {
                        const elementId = (icon.elementId ?? -1) | 0;
                        if (elementId < 0) continue;
                        const element = getMapElement(elementId);
                        const category = (element?.category ?? icon.category ?? -1) | 0;
                        if (
                            worldMapState.elementsEnabled === false ||
                            !worldMapState.isElementEnabled?.(elementId) ||
                            (category >= 0 && !worldMapState.isCategoryEnabled?.(category))
                        ) {
                            continue;
                        }
                        if ((element?.worldMapVisible ?? icon.worldMapVisible ?? true) === false) {
                            continue;
                        }

                        const sourceX = icon.sourceX ?? sourceTile.mapX * 64 + (icon.localX | 0);
                        const sourceY = icon.sourceY ?? sourceTile.mapY * 64 + (icon.localY | 0);
                        const sourcePlane = (icon.sourcePlane ?? sourceLevel) | 0;
                        const displayPlane = (icon.displayPlane ?? sourcePlane) | 0;
                        let displayIconX = icon.displayX;
                        let displayIconY = icon.displayY;
                        if (displayIconX === undefined || displayIconY === undefined) {
                            const displayPos = currentArea.position(sourcePlane, sourceX, sourceY);
                            if (!displayPos) continue;
                            displayIconX = displayPos.x;
                            displayIconY = displayPos.y;
                        }
                        const iconPos = projectDisplayToScreen(
                            displayIconX + 0.5,
                            displayIconY + 0.5,
                        );
                        const iconX = iconPos.x;
                        const iconY = iconPos.y;
                        const spriteId = (element?.spriteId ?? icon.spriteId ?? -1) | 0;
                        const iconTex = spriteId >= 0 ? tc.getBySpriteId(spriteId) : null;
                        let hitX0 = iconX - 4 * renderScale;
                        let hitY0 = iconY - 4 * renderScale;
                        let hitX1 = iconX + 4 * renderScale;
                        let hitY1 = iconY + 4 * renderScale;
                        if (
                            worldMapState.shouldFlashIcon?.({
                                element: elementId,
                                category,
                            })
                        ) {
                            const flashTex = getWorldMapFlashTexture(glr);
                            if (flashTex) {
                                const flashSize = 30 * renderScale;
                                glr.drawTexture(
                                    flashTex,
                                    iconX - flashSize / 2,
                                    iconY - flashSize / 2,
                                    flashSize,
                                    flashSize,
                                    1,
                                    1,
                                );
                                hitX0 = Math.min(hitX0, iconX - flashSize / 2);
                                hitY0 = Math.min(hitY0, iconY - flashSize / 2);
                                hitX1 = Math.max(hitX1, iconX + flashSize / 2);
                                hitY1 = Math.max(hitY1, iconY + flashSize / 2);
                            }
                        }
                        if (iconTex) {
                            const iconW = iconTex.w * renderScale;
                            const iconH = iconTex.h * renderScale;
                            const spriteX =
                                iconX +
                                getSpriteXOffset(
                                    iconW,
                                    element?.horizontalAlignment ?? icon.horizontalAlignment ?? 0,
                                );
                            const spriteY =
                                iconY +
                                getSpriteYOffset(
                                    iconH,
                                    element?.verticalAlignment ?? icon.verticalAlignment ?? 0,
                                );
                            hitX0 = Math.min(hitX0, spriteX);
                            hitY0 = Math.min(hitY0, spriteY);
                            hitX1 = Math.max(hitX1, spriteX + iconW);
                            hitY1 = Math.max(hitY1, spriteY + iconH);
                            glr.drawTexture(iconTex, spriteX, spriteY, iconW, iconH, 1, 1);
                        }

                        const label = element?.name ?? icon.name;
                        const textSize = (element?.textSize ?? icon.textSize ?? 0) | 0;
                        if (label && isWorldMapLabelVisible(textSize)) {
                            const fontId = getWorldMapLabelFontId(textSize);
                            const labelText = String(label);
                            const font = opts.fontLoader(fontId);
                            const fontBaseline =
                                ((font as any)?.lineHeight ?? (font as any)?.ascent ?? 12) | 0 ||
                                12;
                            const labelMetricKey = `${fontId}:${fontBaseline}:${labelText}`;
                            let metrics = labelMetricsCache.get(labelMetricKey);
                            if (!metrics) {
                                const labelLines = labelText
                                    .replace(/<br\s*\/?\s*>/gi, "\n")
                                    .split(/\n/);
                                const lineWidths = labelLines.map(
                                    (line) => (font?.measure?.(line) ?? line.length * 6) | 0,
                                );
                                const logicalWidth = Math.max(1, ...lineWidths);
                                const lineHeight = Math.max(1, (fontBaseline / 2) | 0);
                                const logicalHeight = Math.max(
                                    1,
                                    ((labelLines.length * fontBaseline) / 2) | 0,
                                );
                                metrics = {
                                    lines: labelLines,
                                    lineWidths,
                                    logicalWidth,
                                    lineHeight,
                                    logicalHeight,
                                };
                                if (labelMetricsCache.size > 2048) {
                                    labelMetricsCache.clear();
                                }
                                labelMetricsCache.set(labelMetricKey, metrics);
                            }
                            const labelW = metrics.logicalWidth * rootScaleX;
                            const labelH = metrics.logicalHeight * rootScaleY;
                            const labelColor = element?.textColor ?? icon.textColor ?? 0;
                            hitX0 = Math.min(hitX0, iconX - labelW / 2);
                            hitY0 = Math.min(hitY0, iconY);
                            hitX1 = Math.max(hitX1, iconX + labelW / 2);
                            hitY1 = Math.max(hitY1, iconY + labelH);
                            worldMapLabelDraws.push({
                                text: labelText,
                                fontId,
                                font,
                                metrics,
                                x: iconX - labelW / 2,
                                y: iconY,
                                width: labelW,
                                height: labelH,
                                color: labelColor,
                                scaleX: rootScaleX,
                                scaleY: rootScaleY,
                            });
                        }
                        const sourceCoord = packWorldMapCoord({
                            plane: sourcePlane,
                            x: sourceX | 0,
                            y: sourceY | 0,
                        });
                        const displayCoord = packWorldMapCoord({
                            plane: displayPlane,
                            x: displayIconX | 0,
                            y: displayIconY | 0,
                        });
                        worldMapIconBounds.push({
                            elementId,
                            category,
                            coord1: sourceCoord,
                            coord2: displayCoord,
                            x0: Math.floor(hitX0),
                            y0: Math.floor(hitY0),
                            x1: Math.ceil(hitX1),
                            y1: Math.ceil(hitY1),
                        });
                    }
                }
                for (const labelDraw of worldMapLabelDraws) {
                    if (labelDraw.font && !/<(?!br\s*\/?\s*>)/i.test(labelDraw.text)) {
                        drawWorldMapLabelGL(
                            glr,
                            labelDraw.font,
                            labelDraw.metrics,
                            labelDraw.x,
                            labelDraw.y,
                            labelDraw.color,
                            labelDraw.scaleX,
                            labelDraw.scaleY,
                        );
                    } else {
                        drawWrappedTextGL(
                            labelDraw.text,
                            labelDraw.x,
                            labelDraw.y,
                            labelDraw.width,
                            labelDraw.height,
                            labelDraw.fontId,
                            labelDraw.color,
                            labelDraw.metrics.lineHeight,
                            true,
                            0,
                            1,
                        );
                    }
                }
            }
            osrsClient?.setRenderedWorldMapIcons?.(worldMapIconBounds);
        }

        if (contentType === 1401) {
            const osrsClient = (opts.game as any)?.osrsClient;
            const worldMapState = osrsClient?.worldMapState;
            const backgroundColor = worldMapState?.currentArea?.backgroundColor ?? 0x000000;
            glr.drawRect(x, y, width, height, [
                ((backgroundColor >>> 16) & 0xff) / 255,
                ((backgroundColor >>> 8) & 0xff) / 255,
                (backgroundColor & 0xff) / 255,
                1,
            ]);

            const currentArea = worldMapState?.currentArea;
            if (worldMapState?.isLoaded?.() && currentArea) {
                const minDisplayX = currentArea.regionLowX * 64;
                const minDisplayY = currentArea.regionLowY * 64;
                const displayWidthTiles = Math.max(1, currentArea.getWidthTiles?.() ?? 1);
                const displayHeightTiles = Math.max(1, currentArea.getHeightTiles?.() ?? 1);
                const scaleX = width / displayWidthTiles;
                const scaleY = height / displayHeightTiles;
                const projectOverview = (displayCoordX: number, displayCoordY: number) => ({
                    x: x + (displayCoordX - minDisplayX) * scaleX,
                    y: y + height - (displayCoordY - minDisplayY) * scaleY,
                });
                const mapElementCache = ((osrsClient as any).__worldMapOverviewElementCache ??=
                    new Map<number, any>());
                const getMapElement = (elementId: number) => {
                    if (mapElementCache.has(elementId)) return mapElementCache.get(elementId);
                    let element;
                    try {
                        element = osrsClient?.mapElementTypeLoader?.load?.(elementId | 0);
                    } catch {
                        element = undefined;
                    }
                    mapElementCache.set(elementId, element);
                    return element;
                };

                for (let mapY = currentArea.regionLowY; mapY <= currentArea.regionHighY; mapY++) {
                    for (
                        let mapX = currentArea.regionLowX;
                        mapX <= currentArea.regionHighX;
                        mapX++
                    ) {
                        const icons = osrsClient?.getWorldMapIcons?.(
                            mapX | 0,
                            mapY | 0,
                            Math.max(0, Math.min(3, currentArea.origin.plane | 0)),
                        );
                        if (!icons || icons.length === 0) continue;
                        for (const icon of icons) {
                            const elementId = (icon.elementId ?? -1) | 0;
                            if (elementId < 0) continue;
                            const element = getMapElement(elementId);
                            const category = (element?.category ?? icon.category ?? -1) | 0;
                            if (
                                worldMapState.elementsEnabled === false ||
                                !worldMapState.isElementEnabled?.(elementId) ||
                                (category >= 0 && !worldMapState.isCategoryEnabled?.(category))
                            ) {
                                continue;
                            }
                            if (
                                (element?.worldMapVisible ?? icon.worldMapVisible ?? true) === false
                            ) {
                                continue;
                            }
                            const displayIconX =
                                icon.displayX ?? mapX * 64 + ((icon.localX ?? 0) | 0);
                            const displayIconY =
                                icon.displayY ?? mapY * 64 + ((icon.localY ?? 0) | 0);
                            const pos = projectOverview(displayIconX + 0.5, displayIconY + 0.5);
                            const spriteId = (element?.spriteId ?? icon.spriteId ?? -1) | 0;
                            const iconTex = spriteId >= 0 ? tc.getBySpriteId(spriteId) : null;
                            const flashIcon = {
                                element: elementId,
                                category,
                            };
                            if (worldMapState.shouldFlashIcon?.(flashIcon)) {
                                const flashTex = getWorldMapFlashTexture(glr);
                                if (flashTex) {
                                    glr.drawTexture(flashTex, pos.x - 7, pos.y - 7, 14, 14, 1, 1);
                                }
                            }
                            if (iconTex) {
                                const iconW = Math.max(
                                    3,
                                    Math.min(12, iconTex.w * 0.5 * rootScaleX),
                                );
                                const iconH = Math.max(
                                    3,
                                    Math.min(12, iconTex.h * 0.5 * rootScaleY),
                                );
                                glr.drawTexture(
                                    iconTex,
                                    pos.x - iconW / 2,
                                    pos.y - iconH / 2,
                                    iconW,
                                    iconH,
                                    1,
                                    1,
                                );
                            } else {
                                glr.drawRect(pos.x - 1, pos.y - 1, 3, 3, [1, 1, 0, 1]);
                            }
                        }
                    }
                }

                const viewLeft =
                    worldMapState.displayX - (worldMapState.displayWidth | 0) / 2 - minDisplayX;
                const viewRight =
                    worldMapState.displayX + (worldMapState.displayWidth | 0) / 2 - minDisplayX;
                const viewBottom =
                    worldMapState.displayY - (worldMapState.displayHeight | 0) / 2 - minDisplayY;
                const viewTop =
                    worldMapState.displayY + (worldMapState.displayHeight | 0) / 2 - minDisplayY;
                const rectX = x + viewLeft * scaleX;
                const rectY = y + height - viewTop * scaleY;
                const rectW = Math.max(1, (viewRight - viewLeft) * scaleX);
                const rectH = Math.max(1, (viewTop - viewBottom) * scaleY);
                glr.drawRect(rectX, rectY, rectW, 1, [1, 0, 0, 1]);
                glr.drawRect(rectX, rectY + rectH - 1, rectW, 1, [1, 0, 0, 1]);
                glr.drawRect(rectX, rectY, 1, rectH, [1, 0, 0, 1]);
                glr.drawRect(rectX + rectW - 1, rectY, 1, rectH, [1, 0, 0, 1]);
            }
        }
        // Special handling for minimap widget (contentType 1338)
        // Uses localPlayer position, NOT camera
        // WebGL-based rendering for better mobile performance
        if (contentType === 1338) {
            const minimapStartMs = profileWidgetRender ? performance.now() : 0;
            const minimapTextureDrawCallsStart = profileWidgetRender
                ? glr.getPerfCounters().textureDrawCalls
                : 0;
            minimapWidgets++;
            glr.flush();
            const osrsClient = (opts.game as any)?.osrsClient;
            if (osrsClient && osrsClient.camera) {
                const localPlayerId = osrsClient.controlledPlayerServerId | 0;
                const playerState = osrsClient.playerMovementSync?.getState?.(localPlayerId);

                // Get or create MinimapRenderer instance (cached on canvas)
                const canvasAny = glr.canvas as any;
                let minimapRenderer: MinimapRenderer = canvasAny.__minimapRenderer;
                if (!minimapRenderer) {
                    minimapRenderer = new MinimapRenderer(glr.gl, glr.proj);
                    canvasAny.__minimapRenderer = minimapRenderer;
                }
                minimapRenderer.updateProj(glr.proj);

                const renderMaskSpriteId =
                    typeof w.spriteId === "number" && (w.spriteId | 0) >= 0 ? w.spriteId | 0 : -1;
                const clickMaskSpriteId =
                    typeof w.spriteId2 === "number" && (w.spriteId2 | 0) >= 0
                        ? w.spriteId2 | 0
                        : renderMaskSpriteId;
                const minimapMask: SpriteMaskData | undefined =
                    renderMaskSpriteId >= 0
                        ? tc.getWidgetSpriteMaskById(renderMaskSpriteId, {
                              borderType: ((w as any).borderType ?? 0) | 0,
                              shadowColor:
                                  ((w as any).graphicShadow ?? (w as any).shadowColor ?? 0) | 0,
                              flipH: !!(w.horizontalFlip || (w as any).flippedH),
                              flipV: !!(w.verticalFlip || (w as any).flippedV),
                          })
                        : undefined;
                const clickMask: SpriteMaskData | undefined =
                    clickMaskSpriteId === renderMaskSpriteId
                        ? minimapMask
                        : clickMaskSpriteId >= 0
                          ? tc.getWidgetSpriteMaskById(clickMaskSpriteId, {
                                borderType: ((w as any).borderType ?? 0) | 0,
                                shadowColor:
                                    ((w as any).graphicShadow ?? (w as any).shadowColor ?? 0) | 0,
                                flipH: !!(w.horizontalFlip || (w as any).flippedH),
                                flipV: !!(w.verticalFlip || (w as any).flippedV),
                            })
                          : undefined;

                if (playerState && minimapMask && clickMask) {
                    // Get interpolated player position from ECS
                    const playerEcs = osrsClient.playerEcs;
                    const playerIdx = playerEcs?.getIndexForServerId?.(localPlayerId);

                    let playerFineX: number;
                    let playerFineY: number;

                    if (playerIdx !== undefined && playerIdx >= 0) {
                        playerFineX = playerEcs.getX(playerIdx) | 0;
                        playerFineY = playerEcs.getY(playerIdx) | 0;
                    } else {
                        const rawSubX = (playerState.subX ?? 64) | 0;
                        const rawSubY = (playerState.subY ?? 64) | 0;
                        const subX = rawSubX & 127;
                        const subY = rawSubY & 127;
                        playerFineX = ((playerState.tileX | 0) << 7) + subX;
                        playerFineY = ((playerState.tileY | 0) << 7) + subY;
                    }

                    const playerTileX = playerFineX >> 7;
                    const playerTileY = playerFineY >> 7;
                    const subX = playerFineX & 127;
                    const subY = playerFineY & 127;
                    const worldX = playerTileX + (subX - 64) / 128;
                    const worldY = playerTileY + (subY - 64) / 128;
                    const playerLevel = Math.max(0, Math.min(3, playerState.level | 0));

                    const cameraYaw = osrsClient.camera.yaw ?? 0;
                    const minimapZoom = osrsClient.minimapZoom ?? 4;
                    const zoomScale = minimapZoom / 4.0;

                    const cameraMapX = playerTileX >> 6;
                    const cameraMapY = playerTileY >> 6;
                    const localTileX = playerTileX & 63;
                    const localTileY = playerTileY & 63;
                    const subTileX = worldX - playerTileX;
                    const subTileY = worldY - playerTileY;

                    const maskW = Math.max(1, Math.round(minimapMask.width * rootScaleX));
                    const maskH = Math.max(1, Math.round(minimapMask.height * rootScaleY));
                    const maskX = x + Math.round((width - maskW) / 2);
                    const maskY = y + Math.round((height - maskH) / 2);
                    const centerX = maskX + maskW / 2;
                    const centerY = maskY + maskH / 2;
                    const radius = Math.max(maskW, maskH) / 2;
                    const clickMaskW = Math.max(1, Math.round(clickMask.width * rootScaleX));
                    const clickMaskH = Math.max(1, Math.round(clickMask.height * rootScaleY));
                    const clickMaskX = x + Math.round((width - clickMaskW) / 2);
                    const clickMaskY = y + Math.round((height - clickMaskH) / 2);

                    // In OSRS the widget pixel size equals the screen pixel size, so
                    // 1 minimap pixel = 1 screen pixel at zoom 1.0.  Our renderer may
                    // draw the widget at a higher resolution (rootScaleX/Y > 1 for
                    // HiDPI / UI scaling), so we multiply the zoom by the average
                    // render scale so minimap pixels map to buffer pixels correctly.
                    const minimapRenderScale =
                        logicalWidth > 0 && logicalHeight > 0
                            ? (width / logicalWidth + height / logicalHeight) / 2
                            : 1;
                    const adjustedZoom = zoomScale * minimapRenderScale;

                    // Begin WebGL minimap rendering
                    minimapRenderer.begin(centerX, centerY, radius, cameraYaw, adjustedZoom, {
                        tex: minimapMask.texture.tex,
                        x: maskX,
                        y: maskY,
                        width: maskW,
                        height: maskH,
                    });

                    // Draw 3x3 grid of map tiles
                    // Each tile is 64 tiles = 256 minimap pixels at 4px/tile
                    const TILE_SIZE = 256;
                    const playerOffsetX = (localTileX + subTileX) * 4;
                    const playerOffsetY = (localTileY + subTileY) * 4;

                    for (let mx = 0; mx < 3; mx++) {
                        for (let my = 0; my < 3; my++) {
                            const mapX = cameraMapX - 1 + mx;
                            const mapY = cameraMapY - 1 + my;
                            const url = osrsClient.getMinimapImageUrl?.(mapX, mapY, playerLevel);
                            if (!url) continue;

                            // Get or trigger load of minimap tile texture
                            const tileTex = tc.getTextureFromUrl(url);
                            if (!tileTex) continue;

                            // Position relative to player (in minimap pixels)
                            // mx=0 is west, mx=2 is east; my=0 is south, my=2 is north
                            // Formula derived from original: tileY = 512 - my*256 + offsetY - ROTATION_CENTER
                            const relX = (mx - 1) * TILE_SIZE - playerOffsetX;
                            const relY = -my * TILE_SIZE + playerOffsetY;

                            minimapRenderer.drawTile(tileTex, relX, relY, TILE_SIZE);
                        }
                    }

                    const minimapIconProvider = osrsClient.renderer as
                        | {
                              getMinimapIcons?: (
                                  mapX: number,
                                  mapY: number,
                                  level: number,
                              ) => Array<{ localX: number; localY: number; spriteId: number }>;
                          }
                        | undefined;
                    for (let mx = 0; mx < 3; mx++) {
                        for (let my = 0; my < 3; my++) {
                            const mapX = cameraMapX - 1 + mx;
                            const mapY = cameraMapY - 1 + my;
                            const icons = minimapIconProvider?.getMinimapIcons?.(
                                mapX,
                                mapY,
                                playerLevel,
                            );
                            if (!icons || icons.length === 0) continue;

                            for (const icon of icons) {
                                const iconTex = tc.getBySpriteId(icon.spriteId | 0);
                                if (!iconTex) continue;

                                const iconWorldX = mapX * 64 + (icon.localX | 0) + 0.5;
                                const iconWorldY = mapY * 64 + (icon.localY | 0) + 0.5;
                                const iconScreen = minimapRenderer.relativeToScreen(
                                    (iconWorldX - worldX) * 4,
                                    (worldY - iconWorldY) * 4,
                                );
                                minimapRenderer.drawOverlay(
                                    iconTex,
                                    iconScreen.x,
                                    iconScreen.y,
                                    iconTex.w * minimapRenderScale,
                                    iconTex.h * minimapRenderScale,
                                );
                            }
                        }
                    }

                    // Get dot sprites as WebGL textures (using name token lookup)
                    const itemDotTex = tc.getByNameToken("mapdots,0");
                    const npcDotTex = tc.getByNameToken("mapdots,1");
                    const playerDotTex = tc.getByNameToken("mapdots,2");
                    const friendDotTex = tc.getByNameToken("mapdots,3");
                    const teamDotTex = tc.getByNameToken("mapdots,4");
                    const friendsChatDotTex = tc.getByNameToken("mapdots,5");
                    const clanDotTex = tc.getByNameToken("mapdots,6");
                    const itemDot = itemDotTex;
                    const npcDot = npcDotTex;
                    const playerDot = playerDotTex;
                    const otherPlayerEcs = osrsClient.playerEcs;

                    const normalizePlayerName = (name: unknown): string => {
                        return String(name ?? "")
                            .replace(/<[^>]*>/g, "")
                            .trim()
                            .toLowerCase();
                    };
                    const friendNames = new Set<string>();
                    const friendsChatNames = new Set<string>();
                    const clanMemberNames = new Set<string>();
                    const addName = (set: Set<string>, raw: unknown): void => {
                        if (typeof raw !== "string") return;
                        const normalized = normalizePlayerName(raw);
                        if (normalized.length > 0) set.add(normalized);
                    };
                    const addListByField = (
                        set: Set<string>,
                        list: unknown,
                        fieldName: string,
                    ): void => {
                        if (!Array.isArray(list)) return;
                        for (const entry of list) addName(set, (entry as any)?.[fieldName]);
                    };
                    const addNameList = (set: Set<string>, list: unknown): void => {
                        if (!Array.isArray(list)) return;
                        for (const entry of list) addName(set, entry);
                    };
                    const cs2Ctx: any = osrsClient.cs2Vm?.context;
                    addListByField(friendNames, cs2Ctx?.friendList, "name");
                    addListByField(friendsChatNames, cs2Ctx?.clanMembers, "name");
                    addNameList(clanMemberNames, cs2Ctx?.clanSettings?.memberNames);
                    addNameList(clanMemberNames, cs2Ctx?.clanChannel?.userNames);

                    const localEcsIdx = osrsClient.playerEcs?.getIndexForServerId?.(localPlayerId);
                    const localTeam =
                        typeof localEcsIdx === "number"
                            ? (osrsClient.playerEcs?.getTeam?.(localEcsIdx | 0) ?? 0) | 0
                            : 0;
                    const getPlayerDot = (ecsIdx: number) => {
                        const name = normalizePlayerName(otherPlayerEcs?.getName?.(ecsIdx));
                        if (name.length > 0 && friendNames.has(name)) return friendDotTex;
                        const otherTeam = (otherPlayerEcs?.getTeam?.(ecsIdx) ?? 0) | 0;
                        if (localTeam !== 0 && otherTeam !== 0 && localTeam === otherTeam) {
                            return teamDotTex;
                        }
                        if (name.length > 0 && friendsChatNames.has(name)) return friendsChatDotTex;
                        if (name.length > 0 && clanMemberNames.has(name)) return clanDotTex;
                        return playerDot;
                    };

                    // Draw other players
                    if (otherPlayerEcs?.getAllServerIds) {
                        for (const otherId of otherPlayerEcs.getAllServerIds()) {
                            if (otherId === localPlayerId) continue;

                            const ecsIdx = otherPlayerEcs.getIndexForServerId?.(otherId);
                            if (ecsIdx === undefined || ecsIdx < 0) continue;
                            if (otherPlayerEcs.getIsHidden?.(ecsIdx)) continue;
                            if (
                                ((otherPlayerEcs.getLevel?.(ecsIdx) ?? playerLevel) | 0) !==
                                playerLevel
                            ) {
                                continue;
                            }

                            const fineX = otherPlayerEcs.getX(ecsIdx) | 0;
                            const fineY = otherPlayerEcs.getY(ecsIdx) | 0;
                            const otherWorldX = fineX / 128;
                            const otherWorldY = fineY / 128;

                            const relX = (otherWorldX - worldX) * 4;
                            const relY = (worldY - otherWorldY) * 4;

                            const dotTex = getPlayerDot(ecsIdx);
                            if (dotTex) {
                                minimapRenderer.queueDot(dotTex, relX, relY, minimapRenderScale);
                            }
                        }
                    }

                    // Draw NPCs as yellow dots
                    const npcEcs = osrsClient.npcEcs;
                    if (npcEcs?.getAllActiveIds && npcDot) {
                        for (const ecsIdx of npcEcs.getAllActiveIds()) {
                            if (!npcEcs.isActive?.(ecsIdx)) continue;
                            if (((npcEcs.getLevel?.(ecsIdx) ?? playerLevel) | 0) !== playerLevel) {
                                continue;
                            }
                            const npcTypeId = (npcEcs.getNpcTypeId?.(ecsIdx) ?? -1) | 0;
                            let npcType =
                                npcTypeId >= 0
                                    ? osrsClient.npcTypeLoader?.load?.(npcTypeId)
                                    : undefined;
                            if (npcType?.transforms) {
                                npcType = npcType.transform?.(
                                    osrsClient.varManager,
                                    osrsClient.npcTypeLoader,
                                );
                            }
                            if (!npcType?.drawMapDot || !npcType.isInteractable) {
                                continue;
                            }

                            const mapId = npcEcs.getMapId(ecsIdx) | 0;
                            const mapSquareX = mapId >> 8;
                            const mapSquareY = mapId & 0xff;

                            const fineX = npcEcs.getX(ecsIdx) | 0;
                            const fineY = npcEcs.getY(ecsIdx) | 0;
                            const npcWorldX = mapSquareX * 64 + fineX / 128;
                            const npcWorldY = mapSquareY * 64 + fineY / 128;

                            const relX = (npcWorldX - worldX) * 4;
                            const relY = (worldY - npcWorldY) * 4;

                            minimapRenderer.queueDot(npcDot, relX, relY, minimapRenderScale);
                        }
                    }

                    // Draw ground items as red dots
                    const groundItems = osrsClient.groundItems;
                    if (groundItems && itemDot) {
                        const allStacks = groundItems.getAllStacks?.() ?? [];
                        for (const stack of allStacks) {
                            if (!stack || !stack.tile) continue;
                            if (((stack.tile.level ?? 0) | 0) !== playerLevel) continue;
                            const itemTileX = stack.tile.x | 0;
                            const itemTileY = stack.tile.y | 0;

                            const relX = (itemTileX + 0.5 - worldX) * 4;
                            const relY = (worldY - itemTileY - 0.5) * 4;

                            minimapRenderer.queueDot(itemDot, relX, relY, minimapRenderScale);
                        }
                    }

                    // Flush all queued dots (batched by texture)
                    minimapRenderer.flushDots();

                    // Draw player marker at center (white square, scaled for render resolution)
                    if (
                        localEcsIdx === undefined ||
                        !osrsClient.playerEcs.getIsHidden(localEcsIdx)
                    ) {
                        const markerSize = 3 * minimapRenderScale;
                        minimapRenderer.drawSolidRect(
                            centerX,
                            centerY,
                            markerSize,
                            markerSize,
                            [1, 1, 1, 1],
                        );
                    }

                    // Draw destination flag (unrotated overlay)
                    let destWorldX = ClientState.destinationWorldX;
                    let destWorldY = ClientState.destinationWorldY;

                    // Clear destination when player reaches it
                    if (
                        (destWorldX !== 0 || destWorldY !== 0) &&
                        playerTileX === destWorldX &&
                        playerTileY === destWorldY
                    ) {
                        ClientState.destinationX = 0;
                        ClientState.destinationY = 0;
                        ClientState.destinationWorldX = 0;
                        ClientState.destinationWorldY = 0;
                        destWorldX = 0;
                        destWorldY = 0;
                    }

                    if (destWorldX !== 0 || destWorldY !== 0) {
                        const relTileX = destWorldX - worldX;
                        const relTileY = worldY - destWorldY;
                        const relPixelX = relTileX * 4;
                        const relPixelY = relTileY * 4;

                        // Transform relative position to screen (applying rotation + zoom)
                        const flagScreen = minimapRenderer.relativeToScreen(relPixelX, relPixelY);

                        // Get flag texture
                        const flagTex = tc.getByNameToken("mapmarker,0");
                        if (flagTex) {
                            minimapRenderer.drawOverlay(
                                flagTex,
                                flagScreen.x,
                                flagScreen.y,
                                flagTex.w * minimapRenderScale,
                                flagTex.h * minimapRenderScale,
                            );
                        }
                    }

                    // Capture values needed for click handler closure (use worldX/Y for sub-tile precision)
                    const capturedWorldX = worldX;
                    const capturedWorldY = worldY;
                    const capturedCameraYaw = cameraYaw;
                    const capturedAdjustedZoom = adjustedZoom;
                    const capturedMinimapCenterX = clickMaskX + clickMaskW / 2;
                    const capturedMinimapCenterY = clickMaskY + clickMaskH / 2;
                    const capturedMask = clickMask;
                    const capturedMaskX = clickMaskX;
                    const capturedMaskY = clickMaskY;
                    const capturedMaskW = clickMaskW;
                    const capturedMaskH = clickMaskH;
                    const containsMinimapPoint = (pointX: number, pointY: number): boolean => {
                        const localX = Math.floor(
                            ((pointX - capturedMaskX) * capturedMask.width) / capturedMaskW,
                        );
                        const localY = Math.floor(
                            ((pointY - capturedMaskY) * capturedMask.height) / capturedMaskH,
                        );
                        return capturedMask.contains(localX, localY);
                    };

                    clicks.register({
                        id: `minimap:click-to-walk`,
                        rect: { x: clickMaskX, y: clickMaskY, w: clickMaskW, h: clickMaskH },
                        // minimap click-to-walk should not steal clicks from widgets
                        // rendered on top of the minimap (orbs, buttons). Keep below widget targets.
                        priority: 90,
                        persist: false,
                        contains: containsMinimapPoint,
                        onMiddleClick: () => {
                            const uiMenu = (glr.canvas as any)?.__ui?.menu;
                            if (osrsClient.menuOpen || uiMenu?.open) return;
                            osrsClient.minimapZoom = 4;
                        },
                        onClick: (clickX?: number, clickY?: number) => {
                            if (clickX === undefined || clickY === undefined) return;
                            if (!containsMinimapPoint(clickX, clickY)) return;

                            // Calculate click offset from minimap center (in screen pixels)
                            const offsetX = clickX - capturedMinimapCenterX;
                            const offsetY = clickY - capturedMinimapCenterY;

                            // Inverse of the flag position calculation:
                            // Flag uses θ = -cameraYaw / 326.11
                            // Inverse rotation matrix: [cos(θ), sin(θ); -sin(θ), cos(θ)]
                            const theta = -capturedCameraYaw / 326.11;
                            const cos = Math.cos(theta);
                            const sin = Math.sin(theta);

                            // Inverse rotation to get world-relative pixel offset
                            const relPixelX = offsetX * cos + offsetY * sin;
                            const relPixelY = -offsetX * sin + offsetY * cos;

                            // Convert from pixels to tiles (4 pixels per tile, scaled by zoom)
                            const relTileX = relPixelX / (4 * capturedAdjustedZoom);
                            const relTileY = relPixelY / (4 * capturedAdjustedZoom);

                            // Calculate target world tile
                            // Flag uses: relTileY = worldY - destWorldY, so destWorldY = worldY - relTileY
                            const targetTileX = Math.round(capturedWorldX + relTileX);
                            const targetTileY = Math.round(capturedWorldY - relTileY);

                            // Convert to local coordinates for menuAction
                            const localX = (targetTileX - (ClientState.baseX | 0)) | 0;
                            const localY = (targetTileY - (ClientState.baseY | 0)) | 0;

                            // Send walk command via menuAction
                            menuAction(
                                localX,
                                localY,
                                MenuOpcode.WalkHere,
                                0, // identifier
                                -1, // itemId
                                "Walk here",
                                "",
                                clickX | 0,
                                clickY | 0,
                            );
                        },
                    });
                } // end if (playerState)
            }
            // Skip normal type-based rendering for minimap
            if (profileWidgetRender) {
                minimapTextureDrawCalls +=
                    glr.getPerfCounters().textureDrawCalls - minimapTextureDrawCallsStart;
                minimapMs += performance.now() - minimapStartMs;
            }
        }
        if (w.arcStart !== undefined || w.arcEnd !== undefined) {
            renderArcWidget(glr, w, x, y, width, height, rootScaleX, rootScaleY);
        } else if (w.type === 3 && !skipOwnVisuals) {
            const rectStartMs = profileWidgetRender ? performance.now() : 0;
            // Type 3 rectangle rendering
            // Rectangle widget rendering
            // For IF1 widgets, runCs1() determines which color set to use
            // For IF3 widgets, there's no CS1 - just use base color/color2

            // Determine effective color based on CS1 comparison (IF1 only) or base
            // runCs1 returns true when condition is met -> use color2/mouseOverColor2
            // runCs1 returns false -> use color/mouseOverColor
            let cs1Result = false;
            if (!isIf3 && w.cs1Comparisons && w.cs1ComparisonValues && w.cs1Instructions) {
                cs1Result = runCs1(w, widgetManager);
            }

            let effectiveColor: number;
            if (cs1Result) {
                // CS1 condition met: use color2 (alternate state)
                effectiveColor = w.color2 ?? w.textColor ?? w.color ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor2) {
                    effectiveColor = w.mouseOverColor2;
                }
            } else {
                // Normal state: use color
                effectiveColor = w.textColor ?? w.color ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor) {
                    effectiveColor = w.mouseOverColor;
                }
            }

            // OSRS transparency: 0 = fully opaque, 255 = fully transparent
            // Scripts set w.transparency via cc_settrans; cache sets w.opacity (same semantics)
            const trans = w.transparency ?? w.opacity ?? 0;

            // Skip rendering fully transparent rectangles
            if (trans >= 255) {
                // Widget is fully transparent, skip drawing
            } else if (w.filled) {
                // OSRS fillMode: 0=SOLID, 1=GRADIENT_VERTICAL, 2=GRADIENT_ALPHA
                const fillMode = w.fillMode ?? 0;
                switch (fillMode) {
                    case 1: {
                        // GRADIENT_VERTICAL: color at top, color2 at bottom
                        const colorTop = w.color ?? w.textColor ?? 0xffffff;
                        const colorBot = w.color2 ?? colorTop;
                        const rT = ((colorTop >>> 16) & 0xff) / 255;
                        const gT = ((colorTop >>> 8) & 0xff) / 255;
                        const bT = (colorTop & 0xff) / 255;
                        const rB = ((colorBot >>> 16) & 0xff) / 255;
                        const gB = ((colorBot >>> 8) & 0xff) / 255;
                        const bB = (colorBot & 0xff) / 255;
                        const a = (255 - trans) / 255;
                        glr.drawRectGradientVertical(
                            x,
                            y,
                            width,
                            height,
                            [rT, gT, bT, a],
                            [rB, gB, bB, a],
                        );
                        break;
                    }
                    case 2: {
                        // GRADIENT_ALPHA: gradient color AND alpha
                        // Reference: Rasterizer2D_fillRectangleGradientAlpha
                        const colorTop = w.color ?? w.textColor ?? 0xffffff;
                        const colorBot = w.color2 ?? colorTop;
                        const alphaTop = 255 - (trans & 255);
                        const alphaBot = 255 - ((w.transparencyBot ?? trans) & 255);
                        glr.drawRectGradientAlpha(
                            x,
                            y,
                            width,
                            height,
                            colorTop,
                            colorBot,
                            alphaTop,
                            alphaBot,
                        );
                        break;
                    }
                    default: {
                        // SOLID fill (fillMode=0 or unset)
                        const a = (255 - trans) / 255;
                        const r = ((effectiveColor >>> 16) & 0xff) / 255;
                        const g = ((effectiveColor >>> 8) & 0xff) / 255;
                        const b = (effectiveColor & 0xff) / 255;
                        if (trans === 0) {
                            glr.drawRect(x, y, width, height, [r, g, b, 1]);
                        } else {
                            glr.drawRect(x, y, width, height, [r, g, b, a]);
                        }
                        break;
                    }
                }
            } else {
                // Rectangle outline (1px border)
                const a = (255 - trans) / 255;
                const r = ((effectiveColor >>> 16) & 0xff) / 255;
                const g = ((effectiveColor >>> 8) & 0xff) / 255;
                const b = (effectiveColor & 0xff) / 255;
                const strokeW = Math.min(width, scaleLogicalPixels(rootScaleX, 1));
                const strokeH = Math.min(height, scaleLogicalPixels(rootScaleY, 1));
                if (trans === 0) {
                    glr.drawRect(x, y, width, strokeH, [r, g, b, 1]);
                    glr.drawRect(x, y + height - strokeH, width, strokeH, [r, g, b, 1]);
                    glr.drawRect(x, y, strokeW, height, [r, g, b, 1]);
                    glr.drawRect(x + width - strokeW, y, strokeW, height, [r, g, b, 1]);
                } else {
                    glr.drawRect(x, y, width, strokeH, [r, g, b, a]);
                    glr.drawRect(x, y + height - strokeH, width, strokeH, [r, g, b, a]);
                    glr.drawRect(x, y, strokeW, height, [r, g, b, a]);
                    glr.drawRect(x + width - strokeW, y, strokeW, height, [r, g, b, a]);
                }
            }
            if (profileWidgetRender) {
                rectMs += performance.now() - rectStartMs;
            }
        } else if (w.type === 5 && contentType !== 1339 && contentType !== 1338 && !skipOwnVisuals) {
            const spriteStartMs = profileWidgetRender ? performance.now() : 0;
            const spriteTextureDrawCallsStart = profileWidgetRender
                ? glr.getPerfCounters().textureDrawCalls
                : 0;
            spriteWidgets++;
            // Type 5 = Sprite widget (skip if compass/minimap - already rendered above)
            const isIf3 = w.isIf3 !== false;
            let cs1Result = false;
            if (!isIf3 && w.cs1Comparisons && w.cs1ComparisonValues && w.cs1Instructions) {
                cs1Result = runCs1(w, widgetManager);
            }

            const effectiveSpriteId = isIf3
                ? typeof w.spriteId === "number" && w.spriteId >= 0
                    ? w.spriteId | 0
                    : -1
                : cs1Result
                  ? typeof w.spriteId2 === "number" && w.spriteId2 >= 0
                      ? w.spriteId2 | 0
                      : -1
                  : typeof w.spriteId === "number" && w.spriteId >= 0
                    ? w.spriteId | 0
                    : -1;

            // Check borderType for sprite outline (set via CS2 CC_SETOUTLINE/IF_SETOUTLINE)
            // borderType >= 2 = white pixel-perfect outline around sprite
            const borderType = (w as any).borderType ?? 0;
            const spriteShadow = ((w as any).graphicShadow ?? (w as any).shadowColor ?? 0) | 0;

            // Flip flags: check both property names (flippedH/flippedV from cache, horizontalFlip/verticalFlip from scripts)
            const hFlip = !!(w.horizontalFlip || (w as any).flippedH);
            const vFlip = !!(w.verticalFlip || (w as any).flippedV);

            // OSRS transparency: 0 = fully opaque, 255 = fully transparent
            // Scripts set w.transparency via cc_settrans; cache sets w.opacity (same semantics)
            // Clicked/dragged widget is semi-transparent (var14 = 128), except scrollbars.
            // Reference: UserComparator5.drawInterface: if (!var10.isScrollBar) { var14 = 128; }
            let trans = w.transparency ?? w.opacity ?? 0;
            if ((isDragActive || isClickedWidget) && !w.isScrollBar) {
                trans = 128;
            }
            const alpha = (255 - trans) / 255;
            const itemId = typeof w.itemId === "number" ? (w.itemId as number) | 0 : -1;
            const renderItemSprite = isIf3 && itemId >= 0;

            if (!renderItemSprite && effectiveSpriteId >= 0) {
                const tex = tc.getWidgetSpriteById(effectiveSpriteId, {
                    borderType,
                    shadowColor: spriteShadow,
                    flipH: hFlip,
                    flipV: vFlip,
                });
                if (tex) {
                    if (w.spriteTiling && tex.w > 0 && tex.h > 0) {
                        // Tile the sprite to fill the widget area
                        // Item widget rendering
                        // Uses Rasterizer2D_expandClip to constrain drawing to widget bounds,
                        // then draws full sprites, letting the scissor handle edge clipping.
                        const sprLogicalW = Math.max(1, tex.w | 0);
                        const sprLogicalH = Math.max(1, tex.h | 0);

                        // Push expanded clip to constrain tiling to widget bounds
                        sc.expandClip(x, y, x + width, y + height);

                        // Tile in logical widget space, then project tile edges into buffer space.
                        const tilesX = Math.ceil(logicalWidth / sprLogicalW);
                        const tilesY = Math.ceil(logicalHeight / sprLogicalH);

                        for (let tileY = 0; tileY < tilesY; tileY++) {
                            for (let tileX = 0; tileX < tilesX; tileX++) {
                                const tileLogicalX = logicalX + tileX * sprLogicalW;
                                const tileLogicalY = logicalY + tileY * sprLogicalH;
                                const tx = Math.round(tileLogicalX * rootScaleX + rootOffsetX);
                                const ty = Math.round(tileLogicalY * rootScaleY + rootOffsetY);
                                const tx1 = Math.round(
                                    (tileLogicalX + sprLogicalW) * rootScaleX + rootOffsetX,
                                );
                                const ty1 = Math.round(
                                    (tileLogicalY + sprLogicalH) * rootScaleY + rootOffsetY,
                                );
                                const drawW = Math.max(1, tx1 - tx);
                                const drawH = Math.max(1, ty1 - ty);
                                // Draw full sprite - scissor will clip edges
                                glr.drawTexture(
                                    tex,
                                    tx,
                                    ty,
                                    drawW,
                                    drawH,
                                    1,
                                    1,
                                    0,
                                    [0, 0, 0],
                                    false,
                                    false,
                                    alpha,
                                );
                            }
                        }

                        // Restore previous clip
                        sc.pop();
                    } else {
                        const nativeSpriteDraw = !isIf3;
                        const drawX = x;
                        const drawY = y;
                        const drawW = nativeSpriteDraw
                            ? Math.max(
                                  1,
                                  Math.round(
                                      (logicalX + Math.max(1, tex.w | 0)) * rootScaleX +
                                          rootOffsetX,
                                  ) - drawX,
                              )
                            : width;
                        const drawH = nativeSpriteDraw
                            ? Math.max(
                                  1,
                                  Math.round(
                                      (logicalY + Math.max(1, tex.h | 0)) * rootScaleY +
                                          rootOffsetY,
                                  ) - drawY,
                              )
                            : height;
                        const spriteAngle = nativeSpriteDraw ? 0 : (w.spriteAngle ?? 0);

                        if (spriteAngle !== 0) {
                            // Draw rotated sprite - uses 16-bit angle scale (0-65536 = 360 degrees)
                            glr.drawTextureRotated(
                                tex,
                                drawX,
                                drawY,
                                drawW,
                                drawH,
                                spriteAngle,
                                65536, // widget spriteAngle uses 16-bit scale
                                0,
                                [0, 0, 0],
                                alpha,
                            );
                        } else {
                            glr.drawTexture(
                                tex,
                                drawX,
                                drawY,
                                drawW,
                                drawH,
                                1,
                                1,
                                0,
                                [0, 0, 0],
                                false,
                                false,
                                alpha,
                            );
                        }
                    }
                }
            }

            // IF3 type-5 widgets switch to an item sprite when CC_SETOBJECT/IF_SETOBJECT is active.
            if (renderItemSprite) {
                const qty = (w.itemQuantity ?? 1) | 0;
                const qtyMode = (w.itemQuantityMode ?? 2) | 0;
                // selected items render with outline=2 (white).
                const itemOutline =
                    (isSelectedHere ? Math.max(2, borderType | 0) : borderType | 0) | 0;
                const itemTex = tc.getItemIconById(itemId, qty, itemOutline, spriteShadow, qtyMode);
                if (itemTex) {
                    glr.drawTexture(
                        itemTex,
                        x,
                        y,
                        width,
                        height,
                        1,
                        1,
                        0,
                        [0, 0, 0],
                        false,
                        false,
                        alpha,
                    );
                }
            }
            if (profileWidgetRender) {
                spriteTextureDrawCalls +=
                    glr.getPerfCounters().textureDrawCalls - spriteTextureDrawCallsStart;
                spriteMs += performance.now() - spriteStartMs;
            }
        } else if (
            w.type === 6 &&
            ((typeof w.modelId === "number" && w.modelId >= 0) ||
                (typeof w.itemId === "number" && w.itemId >= 0) ||
                (w as any).isPlayerChathead ||
                (w as any).isNpcChathead ||
                ((w.contentType ?? 0) | 0) === 328 ||
                ((w.modelType ?? 0) | 0) === 7 ||
                (w as any).isPlayerModel) &&
            typeof opts.renderModelCanvas === "function"
        ) {
            const modelStartMs = profileWidgetRender ? performance.now() : 0;
            const modelTextureDrawCallsStart = profileWidgetRender
                ? glr.getPerfCounters().textureDrawCalls
                : 0;
            modelWidgets++;
            // IF1 widgets use CS1 to choose model/sequence secondary fields.
            const cs1Result = runCs1(w, widgetManager);
            const modelId = ((cs1Result ? w.modelId2 : w.modelId) ?? -1) | 0;
            let rx = (w.rotationX ?? 0) | 0; // 0..2047
            let ry = (w.rotationY ?? 0) | 0; // 0..2047
            let rz = (w.rotationZ ?? 0) | 0; // 0..2047
            const rawSeqId = (cs1Result ? w.sequenceId2 : w.sequenceId) ?? -1;
            let sequenceId =
                typeof rawSeqId === "number" && rawSeqId >= 0 ? rawSeqId | 0 : undefined;
            // contentType=328 (modelType=5, modelId=1) renders via
            // localPlayer.getModelInternal() which bakes in the live idle animation.
            // Inject the local player's movement sequence so the widget model animates.
            let liveMovementFrame: number | undefined;
            if (sequenceId === undefined && ((w.contentType ?? 0) | 0) === 328) {
                try {
                    const ac = osrsClient?.playerAnimController;
                    const sid = osrsClient?.controlledPlayerServerId;
                    if (ac && typeof sid === "number" && sid >= 0) {
                        const ms = ac.getMovementSequenceState(sid);
                        if (ms && (ms.seqId | 0) >= 0) {
                            sequenceId = ms.seqId | 0;
                            liveMovementFrame = ms.frame | 0;
                        }
                    }
                } catch {}
            }
            // Replicate client zoom normalization
            let zoom = Math.max(1, (w.modelZoom ?? 0) | 0 || 2000);
            let offX = (w.modelOffsetX ?? 0) | 0;
            let offY = (w.modelOffsetY ?? 0) | 0;
            const ortho = !!w.modelOrthog;

            // No client-side bob if no sequence; rely on server/script-provided sequence/animationId.

            // If this widget is currently set to display an item, override angles/offsets/zoom
            // from the item definition.
            try {
                const itemId = w.itemId;
                const qty = (w.itemQuantity ?? 0) | 0 || 1;
                const objLoader = (opts as any).objLoader;
                if (typeof itemId === "number" && itemId >= 0 && objLoader?.load) {
                    let it = objLoader.load(itemId);
                    if (it && typeof it.getCountObj === "function") {
                        it = it.getCountObj(objLoader, qty);
                    }
                    if (it) {
                        rx = (it.xan2d | 0) as number;
                        ry = (it.yan2d | 0) as number;
                        rz = (it.zan2d | 0) as number;
                        offX = (it.offsetX2d | 0) as number;
                        offY = (it.offsetY2d | 0) as number;
                        zoom = Math.max(1, (it.zoom2d | 0) as number);
                    }
                }
            } catch {}

            // Apply normalization only when the widget is displaying an item (OSRS behavior)
            try {
                const itemId = w.itemId;
                if (typeof itemId === "number" && itemId >= 0) {
                    const zUnitsX = (w as any).modelZoomWidthUnits | 0 || 0;
                    // only width-based units are used; fallback is rawWidth
                    if (zUnitsX > 0) zoom = Math.max(1, Math.floor((zoom * 32) / zUnitsX));
                    else if ((w.rawWidth ?? 0) > 0)
                        zoom = Math.max(1, Math.floor((zoom * 32) / (w.rawWidth ?? 1)));
                }
            } catch {}
            // PERF: Build cache key FIRST and check if we have cached render result
            // Only cache static models (no animation)
            const isAnimated = sequenceId !== undefined && sequenceId >= 0;
            const appearanceKey = (() => {
                // modelType=7 widgets render a PlayerComposition clone; cache must vary by appearance.
                try {
                    const isPlayerModel =
                        ((w.contentType ?? 0) | 0) === 328 ||
                        ((w.modelType ?? 0) | 0) === 7 ||
                        (w as any).isPlayerModel === true;
                    const isPlayerChathead = (w as any).isPlayerChathead === true;
                    if (!isPlayerModel && !isPlayerChathead) return null;

                    const osrsClient = (opts.game as any)?.osrsClient;
                    const playerEcs = osrsClient?.playerEcs;
                    const localServerId = osrsClient?.controlledPlayerServerId;
                    const idx =
                        playerEcs && typeof playerEcs.getIndexForServerId === "function"
                            ? playerEcs.getIndexForServerId(localServerId)
                            : undefined;
                    const localAppearance =
                        idx !== undefined ? playerEcs?.getAppearance?.(idx) : undefined;

                    // contentType=328 is the local-player model. Prefer ECS appearance
                    // so server-driven appearance changes reflect even if widget has stale snapshot.
                    let app: any;
                    if (((w.contentType ?? 0) | 0) === 328) {
                        app = localAppearance || (w as any).playerAppearance;
                    } else {
                        app = (w as any).playerAppearance || localAppearance;
                    }
                    if (!app) return null;

                    const gender = (app.gender ?? 0) | 0;
                    const colors = Array.isArray(app.colors) ? app.colors.slice(0, 5) : [];
                    const kits = Array.isArray(app.kits) ? app.kits.slice(0, 7) : [];
                    let equip = Array.isArray(app.equip) ? app.equip.slice(0, 14) : [];
                    const keepEquipment =
                        typeof (w as any).playerModelKeepEquipment === "boolean"
                            ? ((w as any).playerModelKeepEquipment as boolean)
                            : true;
                    if (isPlayerModel && !keepEquipment) {
                        equip = new Array(14).fill(-1);
                    }

                    return `${gender}|c:${colors.join(",")}|k:${kits.join(",")}|e:${equip.join(
                        ",",
                    )}`;
                } catch {
                    return null;
                }
            })();
            const cacheSuffix = appearanceKey ? `:pa:${appearanceKey}` : "";
            const isPlayerDesignPreview =
                (((w.contentType ?? 0) | 0) === 327 || ((w.contentType ?? 0) | 0) === 328) &&
                (((w.modelType ?? 0) | 0) === 5 || ((w.modelType ?? 0) | 0) === 7);
            const isPlayerModel =
                ((w.contentType ?? 0) | 0) === 328 ||
                ((w.modelType ?? 0) | 0) === 7 ||
                (w as any).isPlayerModel === true;
            const modelCacheId =
                typeof w.itemId === "number" && (w.itemId | 0) >= 0
                    ? `item:${w.itemId | 0}:${(w.itemQuantity ?? 0) | 0}`
                    : `model:${modelId}`;
            const cacheKey =
                isAnimated || isPlayerDesignPreview || (isPlayerModel && !appearanceKey)
                    ? null // Animated models can't be cached (frame changes)
                    : `wm:${modelCacheId}:${rx}:${ry}:${rz}:${zoom}:${offX}:${offY}:o${
                          ortho ? 1 : 0
                      }:${width}:${height}${cacheSuffix}`;

            // PERF: Cache model render results (texture + offsets) on the canvas
            const canvasAny2 = glr.canvas as any;
            let modelCache: Map<
                string,
                { tex: any; offsetX: number; offsetY: number; w: number; h: number }
            > = canvasAny2.__modelRenderCache;
            if (!modelCache) {
                modelCache = new Map();
                canvasAny2.__modelRenderCache = modelCache;
            }

            // Check cache before expensive rendering
            const cached = cacheKey ? modelCache.get(cacheKey) : null;

            if (cached) {
                modelCacheHits++;
                // PERF: Use cached texture + offsets, skip CPU model rendering entirely
                const stretch = !!(w as any).stretchModel;
                const modelScaleX =
                    logicalWidth > 0
                        ? Math.max(1 / logicalWidth, width / logicalWidth)
                        : rootScaleX;
                const modelScaleY =
                    logicalHeight > 0
                        ? Math.max(1 / logicalHeight, height / logicalHeight)
                        : rootScaleY;
                if (stretch) {
                    glr.drawTexture(cached.tex, x, y, width, height, 1, 1);
                } else {
                    const drawW = Math.max(1, Math.round(cached.w * modelScaleX));
                    const drawH = Math.max(1, Math.round(cached.h * modelScaleY));
                    const drawX = x + ((width / 2) | 0) - Math.round(cached.offsetX * modelScaleX);
                    const drawY = y + ((height / 2) | 0) - Math.round(cached.offsetY * modelScaleY);
                    glr.drawTexture(cached.tex, drawX, drawY, drawW, drawH, 1, 1);
                }
            } else {
                modelCacheMisses++;
                // No cache hit - do expensive CPU model rendering
                const res = opts.renderModelCanvas(
                    modelId,
                    {
                        xan2d: rx,
                        yan2d: ry,
                        zan2d: rz,
                        zoom2d: zoom,
                        offsetX2d: offX,
                        ambient: w.modelAmbient,
                        contrast: w.modelContrast,
                        lightX: w.modelLightX,
                        lightY: w.modelLightY,
                        lightZ: w.modelLightZ,
                        offsetY2d: offY,
                        orthographic: ortho,
                        widget: w,
                        sequenceId,
                        sequenceFrame:
                            liveMovementFrame !== undefined
                                ? liveMovementFrame
                                : (w.modelFrame ?? 0) | 0,
                        depthTest: true,
                    },
                    width,
                    height,
                );
                if (res) {
                    const can = res.canvas;
                    // Animated/dynamic model widgets must update a stable GPU texture each frame.
                    // Using a varying cache key here would leak textures and prevent animation updates.
                    const texKey = cacheKey ? cacheKey : `wm:dyn:${w.uid}`;
                    const tex = cacheKey
                        ? glr.createTextureFromCanvas(texKey, can)
                        : glr.updateTextureFromCanvas(texKey, can);

                    // Cache the result for static models
                    if (cacheKey) {
                        modelCache.set(cacheKey, {
                            tex,
                            offsetX: res.offsetX | 0,
                            offsetY: res.offsetY | 0,
                            w: can.width,
                            h: can.height,
                        });
                    }

                    const stretch = !!(w as any).stretchModel;
                    const modelScaleX =
                        logicalWidth > 0
                            ? Math.max(1 / logicalWidth, width / logicalWidth)
                            : rootScaleX;
                    const modelScaleY =
                        logicalHeight > 0
                            ? Math.max(1 / logicalHeight, height / logicalHeight)
                            : rootScaleY;
                    if (stretch) {
                        glr.drawTexture(tex, x, y, width, height, 1, 1);
                    } else {
                        const drawW = Math.max(1, Math.round(can.width * modelScaleX));
                        const drawH = Math.max(1, Math.round(can.height * modelScaleY));
                        const drawX =
                            x + ((width / 2) | 0) - Math.round((res.offsetX | 0) * modelScaleX);
                        const drawY =
                            y + ((height / 2) | 0) - Math.round((res.offsetY | 0) * modelScaleY);
                        glr.drawTexture(tex, drawX, drawY, drawW, drawH, 1, 1);
                    }
                }
            }
            if (profileWidgetRender) {
                modelTextureDrawCalls +=
                    glr.getPerfCounters().textureDrawCalls - modelTextureDrawCallsStart;
                modelMs += performance.now() - modelStartMs;
            }
        } else if (w.type === 9) {
            const lineStartMs = profileWidgetRender ? performance.now() : 0;
            // Type 9 = Line widget
            // Type 9 = Line widget
            // Lines are defined by start point (x, y) and end point (x+width, y+height)
            // lineDirection determines diagonal direction:
            //   true = line from (x, y+height) to (x+width, y) (bottom-left to top-right)
            //   false = line from (x, y) to (x+width, y+height) (top-left to bottom-right)
            // lineWid: thickness of the line (1 = single pixel, >1 uses thick line drawing)
            const lineColor = w.textColor ?? w.color ?? 0x000000;
            const lineWid = (w as any).lineWidth ?? 1;
            const scaledLineWid = Math.max(
                1,
                Math.round(lineWid * Math.max(rootScaleX, rootScaleY)),
            );
            const lineDir = !!(w as any).lineDirection;
            const r = ((lineColor >>> 16) & 0xff) / 255;
            const g = ((lineColor >>> 8) & 0xff) / 255;
            const b = (lineColor & 0xff) / 255;
            const a = 1; // Lines are fully opaque

            // Calculate line endpoints based on lineDirection
            let x1: number, y1: number, x2: number, y2: number;
            if (lineDir) {
                // lineDirection = true: bottom-left to top-right diagonal
                x1 = x;
                y1 = y + height;
                x2 = x + width;
                y2 = y;
            } else {
                // lineDirection = false: top-left to bottom-right diagonal
                x1 = x;
                y1 = y;
                x2 = x + width;
                y2 = y + height;
            }

            // Draw line using Bresenham's algorithm or thick line algorithm
            if (scaledLineWid === 1) {
                // Single pixel line - use Bresenham's algorithm
                drawLine(glr, x1, y1, x2, y2, [r, g, b, a]);
            } else {
                // Thick line - draw multiple parallel lines
                drawThickLine(glr, x1, y1, x2, y2, scaledLineWid, [r, g, b, a]);
            }
            if (profileWidgetRender) {
                lineMs += performance.now() - lineStartMs;
            }
        } else if (w.type === 4 || w.type === 8) {
            const textStartMs = profileWidgetRender ? performance.now() : 0;
            const textTextureDrawCallsStart = profileWidgetRender
                ? glr.getPerfCounters().textureDrawCalls
                : 0;
            textWidgets++;
            // Type 4 text widget rendering
            // Model widget rendering
            // For IF1 widgets, runCs1() determines which text/color to use
            // For IF3 widgets, there's no CS1 - just use text/textColor

            let cs1Result = false;
            if (!isIf3 && w.cs1Comparisons && w.cs1ComparisonValues && w.cs1Instructions) {
                cs1Result = runCs1(w, widgetManager);
            }

            // Determine effective text and color based on CS1 result
            let effectiveText: string;
            let effectiveColor: number;

            if (cs1Result) {
                // CS1 condition met: use color2 and text2 (if text2 has content)
                effectiveColor = w.color2 ?? w.textColor ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor2) {
                    effectiveColor = w.mouseOverColor2;
                }
                // Use text2 if it exists and has content
                effectiveText =
                    w.text2 && String(w.text2).length > 0 ? String(w.text2) : String(w.text || "");
            } else {
                // Normal state: use color and text
                effectiveColor = w.textColor ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor) {
                    effectiveColor = w.mouseOverColor;
                }
                effectiveText = String(w.text || "");
            }

            // For IF3, use hover behavior (text2/mouseOverColor on hover)
            if (isIf3 && isWidgetHovered) {
                if (w.text2) effectiveText = String(w.text2);
                if (typeof w.mouseOverColor === "number") effectiveColor = w.mouseOverColor;
            }

            // Show "Please wait..." for the continue button being processed
            // NPC head widget rendering
            if (widgetManager?.meslayerContinueWidget === w) {
                effectiveText = "Please wait...";
            }

            if (effectiveText.length) {
                const normalized = effectiveText.replace(/<br\s*\/?\s*>/gi, "\n");
                // OSRS type-4 widgets use drawLines(), but short widgets disable automatic
                // word wrapping and only honor explicit line breaks.
                // When textLineHeight == 0, OSRS uses font.ascent as the line height.
                const resolvedFont = opts.fontLoader(w.fontId ?? -1);
                const lineH =
                    (w.lineHeight as number) | 0 ||
                    ((resolvedFont as any)?.lineHeight as number) ||
                    ((resolvedFont as any)?.ascent as number) ||
                    12;
                drawWrappedTextGL(
                    normalized,
                    x,
                    y,
                    width,
                    height,
                    w.fontId ?? -1,
                    effectiveColor,
                    lineH,
                    !!(w.textShadowed || w.textShadow),
                    (w.yTextAlignment ?? 0) as 0 | 1 | 2,
                    (w.xTextAlignment ?? 0) as 0 | 1 | 2,
                );
            }
            if (profileWidgetRender) {
                textTextureDrawCalls +=
                    glr.getPerfCounters().textureDrawCalls - textTextureDrawCallsStart;
                textMs += performance.now() - textStartMs;
            }
        } else if (w.type === 2) {
            // no placeholder slot grid rendering for type-2 inventory widgets.
            // Visible cells/items are rendered by real widget content and scripts.
        }

        // Collect debug devoverlay bounds
        if (opts.debug) {
            const debugRectStartMs = profileWidgetRender ? performance.now() : 0;
            debugRects.push({ x, y, w: width, h: height });
            if (profileWidgetRender) {
                debugRectMs += performance.now() - debugRectStartMs;
            }
        }

        if (!isContainer && hasChildren) {
            for (const child of dynamicChildren) {
                if (child != null) {
                    const dynamicDispatchStartMs = profileWidgetRender ? performance.now() : 0;
                    dynamicChildrenVisited++;
                    drawNode(child, logicalX, logicalY, eff, isSelectedHere, widgetClip);
                    if (profileWidgetRender) {
                        dynamicDispatchMs += performance.now() - dynamicDispatchStartMs;
                    }
                }
            }
        }
        // Only type 0 and 11 are containers that can have static children or mounted interfaces.
        // Widget draw dispatch
        // - Type 0 (layer): renders static children (via parentUid) AND dynamic children (w.children)
        // - Type 11 (layer): renders ONLY dynamic children (w.children)
        if (!isContainer) {
            leafWidgets++;
            return; // Non-containers have finished rendering their content above
        }

        containerWidgets++;
        const containerScaffoldStartMs = profileWidgetRender ? performance.now() : 0;
        // InterfaceParent (mounted sub-interface) is rendered as an additional
        // child interface layer for type 0 containers.
        const interfaceParentGroup =
            w.type === 0 && widgetManager
                ? widgetManager.interfaceParents.get(w.uid)?.group
                : undefined;
        const hasInterfaceParent = interfaceParentGroup !== undefined;

        const hasAnyChildren = hasStaticChildren || hasChildren || hasInterfaceParent;

        // IF1 container hidden checks
        // Layer (type 0) and line/divider (type 11)
        // For IF1 containers, skip children rendering if hidden
        // (IF3 containers already returned early at line 542)
        if (
            !isIf3 &&
            w.type === 0 &&
            isComponentHidden(w) &&
            widgetUid !== mousedOverIf1WidgetUid
        ) {
            if (profileWidgetRender) {
                containerScaffoldMs += performance.now() - containerScaffoldStartMs;
            }
            // Skip rendering children for hidden IF1 type 0 containers
            return;
        }
        if (w.type === 11 && isComponentHidden(w) && widgetUid !== mousedOverIf1WidgetUid) {
            if (profileWidgetRender) {
                containerScaffoldMs += performance.now() - containerScaffoldStartMs;
            }
            // Skip rendering children for hidden type 11 containers (IF1 only reaches here)
            return;
        }

        // Note: Scroll clamping for IF1 type 0 containers is already done at line 1195
        // No need to duplicate here

        if (hasAnyChildren) {
            const containerStartMs = profileWidgetRender ? performance.now() : 0;
            // Calculate child clip bounds
            // Reference: UserComparator5.drawInterface lines 163-169
            // For containers, children are clipped to the intersection of:
            // 1. Parent's clip bounds (var2-var5)
            // 2. This container's visible bounds (var15-var18)
            //
            // ALL type 0/11 containers clip their children, not just scrollable ones
            // drawInterface passes intersection bounds
            // Restore parent clip after drawing children

            // For IF3 widgets, only render children if clip is valid.
            // For IF1 widgets, always render children (scissor handles clipping).
            const shouldRenderChildren = !isIf3 || isClipValid(widgetClip);

            if (shouldRenderChildren) {
                // Type 0/11 containers ALWAYS clip their children to the
                // intersection bounds (var15-var18) by calling drawInterface with those bounds.
                // Type 0 and type 11 child rendering.
                //
                // OSRS clips strictly at container bounds - any visual overflow (item icons,
                // selection outlines) that extends beyond the container will be clipped.
                // This is intentional OSRS behavior. CS2 scripts control item margins.
                const childClip = widgetClip;

                const containerClipW = Math.max(0, childClip.x1 - childClip.x0);
                const containerClipH = Math.max(0, childClip.y1 - childClip.y0);

                sc.pushCanvasRect(childClip.x0, childClip.y0, containerClipW, containerClipH);

                // Child offset: widget position minus scroll offset
                const cx = logicalX - (w.scrollX || 0);
                const cy = logicalY - (w.scrollY || 0);
                if (profileWidgetRender) {
                    containerScaffoldMs += performance.now() - containerScaffoldStartMs;
                }

                // Type 0 renders BOTH static and dynamic children
                // Type 11 renders ONLY dynamic children (w.children)
                // Child rendering bounds differ by type
                if (w.type === 0 && hasStaticChildren) {
                    for (const child of staticChildren) {
                        if (child != null) {
                            const staticDispatchStartMs = profileWidgetRender
                                ? performance.now()
                                : 0;
                            staticChildrenVisited++;
                            drawNode(child, cx, cy, eff, isSelectedHere, childClip);
                            if (profileWidgetRender) {
                                staticDispatchMs += performance.now() - staticDispatchStartMs;
                            }
                        }
                    }
                }
                // Render dynamic children (from CC_CREATE scripts) - both type 0 and 11
                if (hasChildren) {
                    for (const child of dynamicChildren) {
                        if (child != null) {
                            const dynamicDispatchStartMs = profileWidgetRender
                                ? performance.now()
                                : 0;
                            dynamicChildrenVisited++;
                            // Normal children use scrolled offset (cx, cy)
                            drawNode(child, cx, cy, eff, isSelectedHere, childClip);
                            if (profileWidgetRender) {
                                dynamicDispatchMs += performance.now() - dynamicDispatchStartMs;
                            }
                        }
                    }
                }

                // Render InterfaceParent (mounted) interface roots LAST, on top of
                // the container's own children.
                if (interfaceParentGroup !== undefined && widgetManager) {
                    const roots = widgetManager.getAllGroupRoots(interfaceParentGroup);
                    for (const root of roots) {
                        if (root != null) {
                            const interfaceParentDispatchStartMs = profileWidgetRender
                                ? performance.now()
                                : 0;
                            interfaceParentRootsVisited++;
                            drawNode(
                                root as any,
                                logicalX,
                                logicalY,
                                eff,
                                isSelectedHere,
                                childClip,
                            );
                            if (profileWidgetRender) {
                                interfaceParentDispatchMs +=
                                    performance.now() - interfaceParentDispatchStartMs;
                            }
                        }
                    }
                }

                // Restore scissor after drawing children
                // Restore clip after child rendering
                sc.pop();
            } else if (profileWidgetRender) {
                containerScaffoldMs += performance.now() - containerScaffoldStartMs;
            }
            if (profileWidgetRender) {
                containerMs += performance.now() - containerStartMs;
            }
        } else if (profileWidgetRender) {
            containerScaffoldMs += performance.now() - containerScaffoldStartMs;
        }
    }
    // Maintain the root clip as the baseline scissor so container pop() calls
    // do not reset clipping back to the full viewport during partial redraws.
    sc.pushCanvasRect(
        fullClip.x0,
        fullClip.y0,
        fullClip.x1 - fullClip.x0,
        fullClip.y1 - fullClip.y0,
    );
    drawNode(root, 0, 0, true, false);

    // Render deferred dragged widgets on top.
    // Only inventory-style widgets (dragRenderBehaviour >= 2) are deferred.
    // Scrollbar widgets (dragRenderBehaviour=1) render inline to maintain z-order with siblings.
    for (const d of deferredDragged) {
        // Inventory item: full screen clip so it can be dragged anywhere
        // Use absolute coordinates (_dragAbsX/_dragAbsY) if available for reliable positioning
        const hasAbsCoords =
            typeof (d.w as any)._dragAbsX === "number" &&
            typeof (d.w as any)._dragAbsY === "number";

        sc.pushCanvasRect(0, 0, glr.width, glr.height);

        if (hasAbsCoords) {
            // Use absolute position directly - most reliable for free-dragging widgets
            // Temporarily set visual position to absolute coords and use ox=0
            const origVisualX = (d.w as any)._dragVisualX;
            const origVisualY = (d.w as any)._dragVisualY;
            (d.w as any)._dragVisualX =
                ((((d.w as any)._dragAbsX ?? 0) - rootOffsetX) / rootScaleX) | 0;
            (d.w as any)._dragVisualY =
                ((((d.w as any)._dragAbsY ?? 0) - rootOffsetY) / rootScaleY) | 0;
            drawNode(d.w, 0, 0, d.parentVisible, d.inSelected, fullClip, false);
            // Restore original values for other code that might use them
            (d.w as any)._dragVisualX = origVisualX;
            (d.w as any)._dragVisualY = origVisualY;
        } else {
            // Fallback: try to use parent's _absX for offset correction
            let useOx = d.ox;
            let useOy = d.oy;
            const parentUid = (d.w as any).parentUid;
            if (typeof parentUid === "number" && parentUid !== -1 && widgetManager) {
                const parent = widgetManager.getWidgetByUid(parentUid);
                if (parent && typeof (parent as any)._absLogicalX === "number") {
                    useOx = (parent as any)._absLogicalX;
                    useOy = (parent as any)._absLogicalY ?? d.oy;
                } else if (parent && typeof parent._absX === "number") {
                    // Backward-compatible fallback when logical abs coords are unavailable.
                    useOx = Math.round((parent._absX - rootOffsetX) / rootScaleX);
                    useOy = Math.round(((parent._absY ?? d.oy) - rootOffsetY) / rootScaleY);
                }
            }
            drawNode(d.w, useOx, useOy, d.parentVisible, d.inSelected, fullClip, false);
        }

        sc.pop();
    }
    sc.pop();
    glr.flush();
    gl.disable(gl.SCISSOR_TEST);
    // Final debug devoverlay pass, drawn on top of all content
    if (opts.debug && debugRects.length) {
        const col: [number, number, number, number] = [1, 0.58, 0, 1];
        for (const r of debugRects) {
            glr.drawRect(r.x, r.y, r.w, 1, col);
            glr.drawRect(r.x, r.y + r.h - 1, r.w, 1, col);
            glr.drawRect(r.x, r.y, 1, r.h, col);
            glr.drawRect(r.x + r.w - 1, r.y, 1, r.h, col);
        }
        // Highlight interactive rects (purple) when debug is on
        const purple: [number, number, number, number] = [0.63, 0.2, 0.88, 1];
        const drawOutline = (rc?: { x: number; y: number; w: number; h: number }) => {
            if (!rc) return;
            glr.drawRect(rc.x, rc.y, rc.w, 1, purple);
            glr.drawRect(rc.x, rc.y + rc.h - 1, rc.w, 1, purple);
            glr.drawRect(rc.x, rc.y, 1, rc.h, purple);
            glr.drawRect(rc.x + rc.w - 1, rc.y, 1, rc.h, purple);
        };
        try {
            // Click registry rects
            const clicks = (glr.canvas as any).__clicks;
            const rects = clicks?.getDebugRects?.() || [];
            for (const rc of rects) drawOutline(rc);
        } catch {}
        // Temple Trekking outlines left as-is for now
    }

    // GL-based context menu (Choose Option) devoverlay via component
    try {
        const menuOverlayStartMs = profileWidgetRender ? performance.now() : 0;
        drawChooseOptionMenu(glr, {
            fontLoader: opts.fontLoader,
            requestRender: requestRender,
            onExamine: (w) => {
                try {
                    (glr.canvas as any).__ui?.setDetails?.(w);
                } catch {}
            },
            menuState: (opts.game?.osrsClient as any)?.menuState,
        });
        if (profileWidgetRender) {
            menuOverlayMs += performance.now() - menuOverlayStartMs;
        }
    } catch {}
    glr.flush();

    // NOTE: Input is processed once per frame by WidgetsOverlay after ALL roots are rendered,
    // so clicks/hover can hit targets from any root (bank, dialogs, etc.).

    // PERF: Log widget count and branch timing every second (only when profiler enabled)
    if (profileWidgetRender) {
        const renderTotalMs = performance.now() - renderStartMs;
        const measuredMs = clickRegistrationMs + minimapMs + spriteMs + modelMs + textMs;
        const otherMs = Math.max(0, renderTotalMs - measuredMs);
        const drawCountersEnd = glr.getPerfCounters();
        const drawCallsDelta = drawCountersEnd.drawCalls - (drawCountersStart?.drawCalls ?? 0);
        const textureDrawCallsDelta =
            drawCountersEnd.textureDrawCalls - (drawCountersStart?.textureDrawCalls ?? 0);
        const solidDrawCallsDelta =
            drawCountersEnd.solidDrawCalls - (drawCountersStart?.solidDrawCalls ?? 0);
        const gradientDrawCallsDelta =
            drawCountersEnd.gradientDrawCalls - (drawCountersStart?.gradientDrawCalls ?? 0);
        const maskedDrawCallsDelta =
            drawCountersEnd.maskedDrawCalls - (drawCountersStart?.maskedDrawCalls ?? 0);

        ps._accumulatedWidgetCount += ps._widgetRenderCount;
        ps._accumulatedFrames++;
        ps._accumulatedWidgetRenderMs += renderTotalMs;
        ps._accumulatedWidgetClickMs += clickRegistrationMs;
        ps._accumulatedWidgetMinimapMs += minimapMs;
        ps._accumulatedWidgetSpriteMs += spriteMs;
        ps._accumulatedWidgetModelMs += modelMs;
        ps._accumulatedWidgetTextMs += textMs;
        ps._accumulatedWidgetOtherMs += otherMs;
        ps._accumulatedWidgetRectMs += rectMs;
        ps._accumulatedWidgetLineMs += lineMs;
        ps._accumulatedWidgetContainerMs += containerMs;
        ps._accumulatedWidgetPrepMs += prepMs;
        ps._accumulatedWidgetLayoutMs += layoutMs;
        ps._accumulatedWidgetClipMs += clipMs;
        ps._accumulatedWidgetBoundsMs += boundsMs;
        ps._accumulatedWidgetSelectionMs += selectionMs;
        ps._accumulatedWidgetDeferMs += deferMs;
        ps._accumulatedWidgetScrollbarMs += scrollbarMs;
        ps._accumulatedWidgetHoverMs += hoverMs;
        ps._accumulatedWidgetCompassMs += compassMs;
        ps._accumulatedWidgetContainerScaffoldMs += containerScaffoldMs;
        ps._accumulatedWidgetScrollClampMs += scrollClampMs;
        ps._accumulatedWidgetPrepContentTypeMs += prepContentTypeMs;
        ps._accumulatedWidgetPrepVisibilityMs += prepVisibilityMs;
        ps._accumulatedWidgetDebugRectMs += debugRectMs;
        ps._accumulatedWidgetMenuOverlayMs += menuOverlayMs;
        ps._accumulatedWidgetStaticDispatchMs += staticDispatchMs;
        ps._accumulatedWidgetDynamicDispatchMs += dynamicDispatchMs;
        ps._accumulatedWidgetInterfaceParentDispatchMs += interfaceParentDispatchMs;
        ps._accumulatedWidgetClickShallowMs += clickShallowMs;
        ps._accumulatedWidgetClickProbeMs += clickProbeMs;
        ps._accumulatedWidgetClickDeriveMs += clickDeriveMs;
        ps._accumulatedWidgetClickPrimaryFindMs += clickPrimaryFindMs;
        ps._accumulatedWidgetClickInventoryPrimaryMs += clickInventoryPrimaryMs;
        ps._accumulatedWidgetClickPrimaryResolveMs += clickPrimaryResolveMs;
        ps._accumulatedWidgetClickCancelSetupMs += clickCancelSetupMs;
        ps._accumulatedWidgetClickMetaMs += clickMetaMs;
        ps._accumulatedWidgetClickTargetMs += clickTargetMs;
        ps._accumulatedWidgetClickRegisterMs += clickRegisterMs;
        ps._accumulatedWidgetPasses++;
        ps._accumulatedWidgetDrawCalls += drawCallsDelta;
        ps._accumulatedWidgetTextureDrawCalls += textureDrawCallsDelta;
        ps._accumulatedWidgetSolidDrawCalls += solidDrawCallsDelta;
        ps._accumulatedWidgetGradientDrawCalls += gradientDrawCallsDelta;
        ps._accumulatedWidgetMaskedDrawCalls += maskedDrawCallsDelta;
        ps._accumulatedTextWidgets += textWidgets;
        ps._accumulatedSpriteWidgets += spriteWidgets;
        ps._accumulatedModelWidgets += modelWidgets;
        ps._accumulatedMinimapWidgets += minimapWidgets;
        ps._accumulatedInteractiveWidgets += interactiveWidgets;
        ps._accumulatedContainerWidgets += containerWidgets;
        ps._accumulatedLeafWidgets += leafWidgets;
        ps._accumulatedStaticChildrenVisited += staticChildrenVisited;
        ps._accumulatedDynamicChildrenVisited += dynamicChildrenVisited;
        ps._accumulatedInterfaceParentRootsVisited += interfaceParentRootsVisited;
        ps._accumulatedClickCandidateWidgets += clickCandidateWidgets;
        ps._accumulatedClickRegisteredWidgets += clickRegisteredWidgets;
        ps._accumulatedCancelSelectionWidgets += cancelSelectionWidgets;
        ps._accumulatedMenuDeriveWidgets += menuDeriveWidgets;
        ps._accumulatedMenuEntries += menuEntriesTotal;
        ps._accumulatedModelCacheHits += modelCacheHits;
        ps._accumulatedModelCacheMisses += modelCacheMisses;
        ps._accumulatedTextTextureDrawCalls += textTextureDrawCalls;
        ps._accumulatedSpriteTextureDrawCalls += spriteTextureDrawCalls;
        ps._accumulatedModelTextureDrawCalls += modelTextureDrawCalls;
        ps._accumulatedMinimapTextureDrawCalls += minimapTextureDrawCalls;

        const now = performance.now();
        if (now - ps._lastWidgetBreakdownLog > 1000) {
            if (ps._accumulatedWidgetPasses > 0 && ps._accumulatedWidgetRenderMs > 0.1) {
                const total = ps._accumulatedWidgetRenderMs;
                const otherAccounted =
                    ps._accumulatedWidgetRectMs +
                    ps._accumulatedWidgetLineMs +
                    ps._accumulatedWidgetPrepMs +
                    ps._accumulatedWidgetLayoutMs +
                    ps._accumulatedWidgetClipMs +
                    ps._accumulatedWidgetBoundsMs +
                    ps._accumulatedWidgetSelectionMs +
                    ps._accumulatedWidgetDeferMs +
                    ps._accumulatedWidgetScrollbarMs +
                    ps._accumulatedWidgetHoverMs +
                    ps._accumulatedWidgetCompassMs +
                    ps._accumulatedWidgetContainerScaffoldMs +
                    ps._accumulatedWidgetScrollClampMs +
                    ps._accumulatedWidgetDebugRectMs +
                    ps._accumulatedWidgetMenuOverlayMs;
                const otherMiscMs = Math.max(0, ps._accumulatedWidgetOtherMs - otherAccounted);
                const clickAccounted =
                    ps._accumulatedWidgetClickShallowMs +
                    ps._accumulatedWidgetClickProbeMs +
                    ps._accumulatedWidgetClickDeriveMs +
                    ps._accumulatedWidgetClickPrimaryFindMs +
                    ps._accumulatedWidgetClickInventoryPrimaryMs +
                    ps._accumulatedWidgetClickPrimaryResolveMs +
                    ps._accumulatedWidgetClickCancelSetupMs +
                    ps._accumulatedWidgetClickMetaMs +
                    ps._accumulatedWidgetClickTargetMs +
                    ps._accumulatedWidgetClickRegisterMs;
                const clickMiscMs = Math.max(0, ps._accumulatedWidgetClickMs - clickAccounted);
                const avgPerPass = (value: number) =>
                    (ps._accumulatedWidgetPasses > 0 ? value / ps._accumulatedWidgetPasses : 0).toFixed(
                        1,
                    );
                const pct = (value: number) => ((value / total) * 100).toFixed(0);
                const modelCacheSize =
                    (
                        canvasAny.__modelRenderCache as
                            | Map<
                                  string,
                                  {
                                      tex: any;
                                      offsetX: number;
                                      offsetY: number;
                                      w: number;
                                      h: number;
                                  }
                              >
                            | undefined
                    )?.size ?? 0;
                const iconTexCacheSize =
                    (canvasAny.__iconTexCache as Map<number, any> | undefined)?.size ?? 0;
                const clickTargetCacheSize =
                    (canvasAny.__clickTargetCache as Map<number, CachedClickTarget> | undefined)
                        ?.size ?? 0;
                const clickMetaCacheSize =
                    (canvasAny.__clickMetaMap as Map<number, WidgetClickMeta> | undefined)?.size ??
                    0;
                const textureCacheStats = tc.getCacheStats();
                console.log(
                    `[PERF] Widget render branches (${ps._accumulatedWidgetPasses} passes, ${total.toFixed(
                        1,
                    )}ms): ` +
                        `other=${ps._accumulatedWidgetOtherMs.toFixed(1)}ms (${pct(
                            ps._accumulatedWidgetOtherMs,
                        )}%), ` +
                        `text=${ps._accumulatedWidgetTextMs.toFixed(1)}ms (${pct(
                            ps._accumulatedWidgetTextMs,
                        )}%), ` +
                        `sprite=${ps._accumulatedWidgetSpriteMs.toFixed(1)}ms (${pct(
                            ps._accumulatedWidgetSpriteMs,
                        )}%), ` +
                        `minimap=${ps._accumulatedWidgetMinimapMs.toFixed(1)}ms (${pct(
                            ps._accumulatedWidgetMinimapMs,
                        )}%), ` +
                        `model=${ps._accumulatedWidgetModelMs.toFixed(1)}ms (${pct(
                            ps._accumulatedWidgetModelMs,
                        )}%), ` +
                        `click=${ps._accumulatedWidgetClickMs.toFixed(1)}ms (${pct(
                            ps._accumulatedWidgetClickMs,
                        )}%) | ` +
                        `draws=${ps._accumulatedWidgetDrawCalls} ` +
                        `(tex ${ps._accumulatedWidgetTextureDrawCalls}, solid ${ps._accumulatedWidgetSolidDrawCalls}, ` +
                        `grad ${ps._accumulatedWidgetGradientDrawCalls}, masked ${ps._accumulatedWidgetMaskedDrawCalls}) | ` +
                        `texBySource: text ${ps._accumulatedTextTextureDrawCalls}, sprite ${ps._accumulatedSpriteTextureDrawCalls}, ` +
                        `model ${ps._accumulatedModelTextureDrawCalls}, minimap ${ps._accumulatedMinimapTextureDrawCalls} | ` +
                        `other: rect ${ps._accumulatedWidgetRectMs.toFixed(
                            1,
                        )}, line ${ps._accumulatedWidgetLineMs.toFixed(
                            1,
                        )}, prep ${ps._accumulatedWidgetPrepMs.toFixed(
                            1,
                        )} (ct ${ps._accumulatedWidgetPrepContentTypeMs.toFixed(
                            1,
                        )}, vis ${ps._accumulatedWidgetPrepVisibilityMs.toFixed(
                            1,
                        )}), layout ${ps._accumulatedWidgetLayoutMs.toFixed(
                            1,
                        )}, clip ${ps._accumulatedWidgetClipMs.toFixed(
                            1,
                        )}, bounds ${ps._accumulatedWidgetBoundsMs.toFixed(
                            1,
                        )}, select ${ps._accumulatedWidgetSelectionMs.toFixed(
                            1,
                        )}, defer ${ps._accumulatedWidgetDeferMs.toFixed(
                            1,
                        )}, scrollbar ${ps._accumulatedWidgetScrollbarMs.toFixed(
                            1,
                        )}, hover ${ps._accumulatedWidgetHoverMs.toFixed(
                            1,
                        )}, compass ${ps._accumulatedWidgetCompassMs.toFixed(
                            1,
                        )}, containerScaffold ${ps._accumulatedWidgetContainerScaffoldMs.toFixed(
                            1,
                        )}, scrollClamp ${ps._accumulatedWidgetScrollClampMs.toFixed(
                            1,
                        )}, debugRect ${ps._accumulatedWidgetDebugRectMs.toFixed(
                            1,
                        )}, menuOverlay ${ps._accumulatedWidgetMenuOverlayMs.toFixed(
                            1,
                        )}, staticDispatchInclusive ${ps._accumulatedWidgetStaticDispatchMs.toFixed(
                            1,
                        )}, dynamicDispatchInclusive ${ps._accumulatedWidgetDynamicDispatchMs.toFixed(
                            1,
                        )}, ifaceDispatchInclusive ${ps._accumulatedWidgetInterfaceParentDispatchMs.toFixed(
                            1,
                        )}, containerInclusive ${ps._accumulatedWidgetContainerMs.toFixed(
                            1,
                        )}, misc ${otherMiscMs.toFixed(1)} | ` +
                        `click: shallow ${ps._accumulatedWidgetClickShallowMs.toFixed(
                            1,
                        )}, probe ${ps._accumulatedWidgetClickProbeMs.toFixed(
                            1,
                        )}, derive ${ps._accumulatedWidgetClickDeriveMs.toFixed(
                            1,
                        )}, primaryFind ${ps._accumulatedWidgetClickPrimaryFindMs.toFixed(
                            1,
                        )}, inventoryPrimary ${ps._accumulatedWidgetClickInventoryPrimaryMs.toFixed(
                            1,
                        )}, primaryResolve ${ps._accumulatedWidgetClickPrimaryResolveMs.toFixed(
                            1,
                        )}, cancelSetup ${ps._accumulatedWidgetClickCancelSetupMs.toFixed(
                            1,
                        )}, meta ${ps._accumulatedWidgetClickMetaMs.toFixed(
                            1,
                        )}, target ${ps._accumulatedWidgetClickTargetMs.toFixed(
                            1,
                        )}, register ${ps._accumulatedWidgetClickRegisterMs.toFixed(
                            1,
                        )}, misc ${clickMiscMs.toFixed(1)} | ` +
                        `avg/pass: widgets ${avgPerPass(
                            ps._accumulatedWidgetCount,
                        )}, text ${avgPerPass(ps._accumulatedTextWidgets)}, sprite ${avgPerPass(
                            ps._accumulatedSpriteWidgets,
                        )}, model ${avgPerPass(ps._accumulatedModelWidgets)}, minimap ${avgPerPass(
                            ps._accumulatedMinimapWidgets,
                        )}, containers ${avgPerPass(
                            ps._accumulatedContainerWidgets,
                        )}, leaves ${avgPerPass(
                            ps._accumulatedLeafWidgets,
                        )}, staticChildren ${avgPerPass(
                            ps._accumulatedStaticChildrenVisited,
                        )}, dynamicChildren ${avgPerPass(
                            ps._accumulatedDynamicChildrenVisited,
                        )}, ifaceRoots ${avgPerPass(
                            ps._accumulatedInterfaceParentRootsVisited,
                        )}, interactive ${avgPerPass(
                            ps._accumulatedInteractiveWidgets,
                        )}, clickCandidates ${avgPerPass(
                            ps._accumulatedClickCandidateWidgets,
                        )}, clickRegistered ${avgPerPass(
                            ps._accumulatedClickRegisteredWidgets,
                        )}, cancelSelection ${avgPerPass(ps._accumulatedCancelSelectionWidgets)},
                        menuDerive ${avgPerPass(
                            ps._accumulatedMenuDeriveWidgets,
                        )}, menuEntries ${avgPerPass(
                            ps._accumulatedMenuEntries,
                        )}, modelCache hit/miss ${ps._accumulatedModelCacheHits}/${ps._accumulatedModelCacheMisses} | cacheSizes: clickTargets ${clickTargetCacheSize}, clickMeta ${clickMetaCacheSize}, model ${modelCacheSize}, iconTex ${iconTexCacheSize}, glTex ${
                            textureCacheStats.glTextures
                        }, spriteCanvas ${textureCacheStats.spriteCanvas}, urlImages ${
                            textureCacheStats.urlImages
                        }, urlPending ${textureCacheStats.urlPending}`,
                );
            }
            ps._accumulatedWidgetRenderMs = 0;
            ps._accumulatedWidgetClickMs = 0;
            ps._accumulatedWidgetMinimapMs = 0;
            ps._accumulatedWidgetSpriteMs = 0;
            ps._accumulatedWidgetModelMs = 0;
            ps._accumulatedWidgetTextMs = 0;
            ps._accumulatedWidgetOtherMs = 0;
            ps._accumulatedWidgetRectMs = 0;
            ps._accumulatedWidgetLineMs = 0;
            ps._accumulatedWidgetContainerMs = 0;
            ps._accumulatedWidgetPrepMs = 0;
            ps._accumulatedWidgetLayoutMs = 0;
            ps._accumulatedWidgetClipMs = 0;
            ps._accumulatedWidgetBoundsMs = 0;
            ps._accumulatedWidgetSelectionMs = 0;
            ps._accumulatedWidgetDeferMs = 0;
            ps._accumulatedWidgetScrollbarMs = 0;
            ps._accumulatedWidgetHoverMs = 0;
            ps._accumulatedWidgetCompassMs = 0;
            ps._accumulatedWidgetContainerScaffoldMs = 0;
            ps._accumulatedWidgetScrollClampMs = 0;
            ps._accumulatedWidgetPrepContentTypeMs = 0;
            ps._accumulatedWidgetPrepVisibilityMs = 0;
            ps._accumulatedWidgetDebugRectMs = 0;
            ps._accumulatedWidgetMenuOverlayMs = 0;
            ps._accumulatedWidgetStaticDispatchMs = 0;
            ps._accumulatedWidgetDynamicDispatchMs = 0;
            ps._accumulatedWidgetInterfaceParentDispatchMs = 0;
            ps._accumulatedWidgetClickShallowMs = 0;
            ps._accumulatedWidgetClickProbeMs = 0;
            ps._accumulatedWidgetClickDeriveMs = 0;
            ps._accumulatedWidgetClickPrimaryFindMs = 0;
            ps._accumulatedWidgetClickInventoryPrimaryMs = 0;
            ps._accumulatedWidgetClickPrimaryResolveMs = 0;
            ps._accumulatedWidgetClickCancelSetupMs = 0;
            ps._accumulatedWidgetClickMetaMs = 0;
            ps._accumulatedWidgetClickTargetMs = 0;
            ps._accumulatedWidgetClickRegisterMs = 0;
            ps._accumulatedWidgetPasses = 0;
            ps._accumulatedWidgetDrawCalls = 0;
            ps._accumulatedWidgetTextureDrawCalls = 0;
            ps._accumulatedWidgetSolidDrawCalls = 0;
            ps._accumulatedWidgetGradientDrawCalls = 0;
            ps._accumulatedWidgetMaskedDrawCalls = 0;
            ps._accumulatedTextWidgets = 0;
            ps._accumulatedSpriteWidgets = 0;
            ps._accumulatedModelWidgets = 0;
            ps._accumulatedMinimapWidgets = 0;
            ps._accumulatedInteractiveWidgets = 0;
            ps._accumulatedContainerWidgets = 0;
            ps._accumulatedLeafWidgets = 0;
            ps._accumulatedStaticChildrenVisited = 0;
            ps._accumulatedDynamicChildrenVisited = 0;
            ps._accumulatedInterfaceParentRootsVisited = 0;
            ps._accumulatedClickCandidateWidgets = 0;
            ps._accumulatedClickRegisteredWidgets = 0;
            ps._accumulatedCancelSelectionWidgets = 0;
            ps._accumulatedMenuDeriveWidgets = 0;
            ps._accumulatedMenuEntries = 0;
            ps._accumulatedModelCacheHits = 0;
            ps._accumulatedModelCacheMisses = 0;
            ps._accumulatedTextTextureDrawCalls = 0;
            ps._accumulatedSpriteTextureDrawCalls = 0;
            ps._accumulatedModelTextureDrawCalls = 0;
            ps._accumulatedMinimapTextureDrawCalls = 0;
            ps._lastWidgetBreakdownLog = now;
        }
        if (now - ps._lastWidgetCountLog > 1000) {
            if (ps._accumulatedFrames > 0) {
                const avgWidgets = (ps._accumulatedWidgetCount / ps._accumulatedFrames) | 0;
                console.log(
                    `[PERF] Widget render: ${avgWidgets} widgets/frame avg (${ps._accumulatedFrames} frames, ${ps._accumulatedWidgetCount} total)`,
                );
            }
            ps._accumulatedWidgetCount = 0;
            ps._accumulatedFrames = 0;
            ps._lastWidgetCountLog = now;
        }
    }
}
