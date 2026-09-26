import { collectWidgetsAtPointAcrossRoots } from "../../../widgets/menu/utils";
import type { WidgetInputControllerDeps, WidgetInputFrame, WidgetInputState } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { InputManager } from "../../InputManager";

export function buildWidgetInputFrame(
    deps: WidgetInputControllerDeps,
    state: WidgetInputState,
    input: InputManager,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): WidgetInputFrame | null {
    const mx = input.mouseX;
    const my = input.mouseY;

    // Get ALL roots in the same stacking order as rendering.
    // Base roots (rootInterface) first, then session-managed roots (bank/dialogs/etc.).
    const allRoots: any[] = [];
    const baseRoots = widgetManager.getAllGroupRoots(widgetManager.rootInterface);
    allRoots.push(...baseRoots);
    if (allRoots.length === 0) return null;

    // Input picking treats widgets as visible unless explicitly hidden.
    const visibleMap = new Map<number, boolean>();

    // While a widget is clicked/held, it is invalidated every frame so it can be
    // rendered semi-transparent (and to support drag visuals).
    // The clicked widget is invalidated so it can be re-rendered semi-transparent.
    if (widgetInteraction.clickedWidget) {
        widgetManager.invalidateWidgetRender(widgetInteraction.clickedWidget);
    }

    // callback for static children lookup
    const getStaticChildren = (uid: number) =>
        widgetManager.getStaticChildrenByParentUid(uid);

    // callback for InterfaceParent lookup (scrollbar widgets shouldn't scroll)
    const getInterfaceParentRoots = (containerUid: number): any[] => {
        const group = widgetManager.interfaceParents.get(containerUid)?.group;
        return typeof group === "number" ? widgetManager.getAllGroupRoots(group) : [];
    };
    const isInputCaptureWidget = (uid: number): boolean => {
        const parent = widgetManager.interfaceParents.get(uid);
        return !!parent && (parent.type | 0) === 0;
    };

    // widget flags accessor with runtime overrides applied.
    const getWidgetFlags = (w: any): number => widgetManager.getWidgetFlags(w);

    // Helper to collect widgets from all roots
    const collectFromAllRoots = (px: number, py: number): any[] => {
        const hits = collectWidgetsAtPointAcrossRoots(
            allRoots,
            px,
            py,
            visibleMap,
            getStaticChildren,
            getInterfaceParentRoots,
            isInputCaptureWidget,
        );
        // A custom gameframe may hide the stock chrome: drop it from input picking
        // so hidden OSRS tabs can't be clicked (the frame registers its own).
        const gameFrame = (globalThis as any)?.osrsClient?.clientPlugins?.activeGameFrame?.();
        if (!gameFrame?.hideStockChrome?.()) return hits;
        const rootId = widgetManager.rootInterface;
        const keep = new Set<number>(gameFrame.keepChrome?.() ?? []);
        return hits.filter((w: any) => !(
            (w.uid >>> 16) === rootId && (w.type === 3 || w.type === 5) && !keep.has(w.uid)
        ));
    };

    // MouseOver/MouseLeave handling
    // PERF: Cache hit test results - only recompute when mouse moves
    let hits: any[];
    if (mx === state.lastHoverHitX && my === state.lastHoverHitY && state.cachedHoverHits) {
        hits = state.cachedHoverHits;
    } else {
        hits = collectFromAllRoots(mx, my);
        state.lastHoverHitX = mx;
        state.lastHoverHitY = my;
        state.cachedHoverHits = hits;
    }
    return {
        input,
        mx,
        my,
        allRoots,
        visibleMap,
        hits,
        getStaticChildren,
        getInterfaceParentRoots,
        isInputCaptureWidget,
        getWidgetFlags,
        collectFromAllRoots,
        invalidateHoverCache: () => {
            state.cachedHoverHits = null;
        },
    };
}
