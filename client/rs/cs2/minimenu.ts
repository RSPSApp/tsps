import { ClientState } from "../../game/ClientState";
import { CANCEL_SELECTION_HANDLER } from "../../widgets/gl/widgetsGl/constants";
import { MenuTargetType } from "../MenuEntry";

/**
 * The minimenu's top entry as the game sees it under the pointer (the MINIMENU_* ops, the
 * mouseover text): a hovered component's own op, else the world menu's first option.
 */
export type MinMenuSnapshot = {
    option: string;
    target: string;
    numOps: number;
    type: number;
    hasComponentHover: boolean;
    /** The hovered component ("widget:<uid>" click targets), when hasComponentHover. */
    widgetUid?: number;
};

export const getInteractionCanvases = (osrsClient: any): any[] => {
    const renderer = osrsClient?.renderer as any;
    const widgetCanvas =
        typeof renderer?.getWidgetsGLCanvas === "function"
            ? renderer.getWidgetsGLCanvas()
            : undefined;
    const mainCanvas = renderer?.canvas;
    const canvases: any[] = [];
    if (widgetCanvas) canvases.push(widgetCanvas);
    if (mainCanvas && mainCanvas !== widgetCanvas) canvases.push(mainCanvas);
    return canvases;
};

// While an item or spell is selected, every op-less widget gets a target that only clears
// the selection on click. Over the game view those would hide the world entry
// ("Use Knife -> Goblin") behind an empty component hover.
const isMenuHoverTarget = (t: any): boolean => t?.onClick !== CANCEL_SELECTION_HANDLER;

export const getHoverTarget = (osrsClient: any): any => {
    for (const canvasAny of getInteractionCanvases(osrsClient)) {
        const clicks =
            (canvasAny?.__input as any)?.getClicks?.() ||
            (canvasAny?.__inputBridge as any)?.getClicks?.() ||
            canvasAny?.__clicks;
        if (!clicks) continue;
        // Re-pick at the live pointer position instead of trusting the cached
        // hover id: CS2 timers rebuild widget rows (e.g., the side journal),
        // which unregisters the hovered target and nulls the hover id while the
        // pointer is stationary - making the mouseover text vanish mid-hover.
        const ui = canvasAny?.__ui;
        if (
            typeof clicks.pick === "function" &&
            typeof ui?.mouseX === "number" &&
            typeof ui?.mouseY === "number"
        ) {
            const sxRaw = Number(canvasAny?.__uiInputScaleX ?? 1);
            const syRaw = Number(canvasAny?.__uiInputScaleY ?? 1);
            const sx = Number.isFinite(sxRaw) && sxRaw > 0 ? sxRaw : 1;
            const sy = Number.isFinite(syRaw) && syRaw > 0 ? syRaw : 1;
            const px = Math.round(ui.mouseX * sx);
            const py = Math.round(ui.mouseY * sy);
            // Prefer the topmost target with menu text: listener-only widgets
            // (e.g., the diary rows' hover-highlight rects) layer above the
            // op-bearing rows and would otherwise blank the minimenu.
            const hit =
                clicks.pick(px, py, (t: any) => !!t?.primaryOption?.option) ||
                clicks.pick(px, py, isMenuHoverTarget);
            if (hit) return hit;
        }
        const hoverTarget = clicks?.getHoverTarget?.();
        if (hoverTarget && isMenuHoverTarget(hoverTarget)) return hoverTarget;
    }
    return undefined;
};

export const minMenuSnapshot = (osrsClient: any): MinMenuSnapshot => {
    // A plugin pointer aimed at the world (the backquote crosshair) clicks the world, never
    // the UI, so its mouseover text is the world option. UI hover state can also be stale
    // under it: the locked pointer holds still, so nothing re-picks the widget under it.
    const input = (osrsClient as any)?.inputManager;
    const aimsAtWorld =
        input?.hasInteractionPointerOverride?.() === true && input?.isWidgetInteractionPointer?.() !== true;
    const hoverTarget = aimsAtWorld ? undefined : getHoverTarget(osrsClient);

    const hoverId = typeof hoverTarget?.id === "string" ? hoverTarget.id : "";
    const componentTargetFromClicks =
        hoverId.startsWith("widget:") || hoverId.startsWith("__menu_opt_");
    const hoveredWidgetsByUid: Map<number, any> | undefined = (osrsClient as any)
        ?.hoveredWidgetsByUid as Map<number, any> | undefined;
    const hasHoveredWidgetState = !aimsAtWorld && !!(hoveredWidgetsByUid && hoveredWidgetsByUid.size > 0);
    const hasComponentHover = componentTargetFromClicks || hasHoveredWidgetState;
    const primaryOption = hoverTarget?.primaryOption;
    let componentOption = typeof primaryOption?.option === "string" ? primaryOption.option : "";
    let componentTarget = typeof primaryOption?.target === "string" ? primaryOption.target : "";
    // CS2 mouseover scripts treat numops as actionable options (exclude Cancel).
    const componentNumOpsRaw =
        typeof hoverTarget?.menuOptionsCount === "number"
            ? Math.max(0, hoverTarget.menuOptionsCount | 0)
            : 0;
    const componentNumOps = Math.max(0, componentNumOpsRaw - 1);
    const componentHasText =
        componentOption.trim().length > 0 || componentTarget.trim().length > 0;

    // When hovering UI components, prefer component metadata. If there is no menu text
    // available, treat minimenu as empty so CS2 mouseover_text does not create stray top-left labels.
    if (hasComponentHover) {
        return {
            option: componentOption,
            target: componentTarget,
            numOps: componentHasText ? Math.max(componentNumOps, 1) : componentNumOps,
            type: componentHasText ? 7 : 0,
            hasComponentHover: true,
            widgetUid: hoverId.startsWith("widget:") ? parseInt(hoverId.substring(7), 10) : undefined,
        };
    }

    const worldEntries: any[] = Array.isArray(osrsClient?.menuActiveSimpleEntries)
        ? (osrsClient.menuActiveSimpleEntries as any[])
        : [];
    let worldTop: any = undefined;
    let worldNumOps = 0;
    for (let i = 0; i < worldEntries.length; i++) {
        const row = worldEntries[i];
        const optionText = typeof row?.option === "string" ? row.option.trim() : "";
        if (optionText.toLowerCase() === "cancel") continue;
        worldNumOps++;
        if (!worldTop) worldTop = row;
    }
    if (!worldTop) worldTop = worldEntries[0];

    // when no actionable minimenu entries exist, selected item/spell still shows
    // "Use <item> ->" / "<spellAction> <spell> ->" hover text.
    if (worldNumOps <= 0) {
        if (ClientState.isItemSelected === 1) {
            const itemName = String(ClientState.selectedSpellName || "").trim();
            return {
                option: "Use",
                target: itemName.length > 0 ? `${itemName} ->` : "->",
                numOps: 1,
                type: 1,
                hasComponentHover: false,
            };
        }
        if (ClientState.isSpellSelected) {
            const spellAction = String(ClientState.selectedSpellActionName || "Cast").trim();
            const spellName = String(ClientState.selectedSpellName || "").trim();
            return {
                option: spellAction.length > 0 ? spellAction : "Cast",
                target: spellName.length > 0 ? `${spellName} ->` : "->",
                numOps: 1,
                type: 1,
                hasComponentHover: false,
            };
        }
    }

    const worldOption = typeof worldTop?.option === "string" ? worldTop.option : "";
    const worldTarget = typeof worldTop?.target === "string" ? worldTop.target : "";
    const worldTargetType =
        typeof worldTop?.targetType === "number"
            ? worldTop.targetType | 0
            : MenuTargetType.NONE;

    let worldType = 0;
    switch (worldTargetType) {
        case MenuTargetType.NPC:
            worldType = 2;
            break;
        case MenuTargetType.LOC:
            worldType = 3;
            break;
        case MenuTargetType.OBJ:
            worldType = 4;
            break;
        case MenuTargetType.PLAYER:
            worldType = 6;
            break;
        default: {
            const lower = worldOption.toLowerCase();
            worldType = lower === "walk here" ? 1 : 0;
            break;
        }
    }

    return {
        option: worldOption,
        target: worldTarget,
        numOps: Math.max(0, worldNumOps),
        type: worldType,
        hasComponentHover: false,
    };
};
