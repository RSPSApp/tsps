import type { ObjTypeLoader } from "../../../rs/config/objtype/ObjTypeLoader";
import type { VarManager } from "../../../rs/config/vartype/VarManager";
import type { Cs2Vm, ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import type { Inventory } from "../../../rs/inventory/Inventory";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { GameRenderer } from "../../GameRenderer";
import type { InputManager } from "../../InputManager";
import type { TransmitCycles } from "../../TransmitCycles";
import type { WorldMapController } from "../../worldMap/WorldMapController";
import type { PlayerDesignController } from "../PlayerDesignController";
import type { SpellSelectionController } from "../SpellSelectionController";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { CustomInterfaceRuntime } from "../../../widgets/custom/CustomInterfaceRuntime";
import type { WidgetActionEvent } from "../widgetActionPayload";

export type WidgetInputState = {
    hoveredWidgetUids: Set<number>;
    hoveredWidgetsByUid: Map<number, any>;
    if1ScrollbarDragging: boolean;
    if1AlternativeScrollbarWidth: number;
    lastHoverHitX: number;
    lastHoverHitY: number;
    cachedHoverHits: any[] | null;
    lastHoverListenerCycle: number;
};

export type WidgetInputFrame = {
    input: InputManager;
    mx: number;
    my: number;
    allRoots: any[];
    visibleMap: Map<number, boolean>;
    hits: any[];
    getStaticChildren: (uid: number) => any[];
    getInterfaceParentRoots: (containerUid: number) => any[];
    isInputCaptureWidget: (uid: number) => boolean;
    getWidgetFlags: (w: any) => number;
    collectFromAllRoots: (px: number, py: number) => any[];
    invalidateHoverCache: () => void;
};

export type WidgetInputControllerDeps = {
    getInputManager: () => InputManager;
    getWidgetManager: () => WidgetManager;
    getWidgetInteraction: () => WidgetInteractionController;
    getTransmitCycles: () => TransmitCycles;
    getRenderer: () => GameRenderer | undefined;
    getCs2Vm: () => Cs2Vm;
    getVarManager: () => VarManager;
    getWorldMap: () => WorldMapController;
    getCustomInterfaces: () => CustomInterfaceRuntime;
    getPlayerDesign: () => PlayerDesignController;
    getObjTypeLoader: () => ObjTypeLoader | undefined;
    getInventory: () => Inventory;
    getSettings: () => { shiftClickEnabled: boolean };
    getMinimapZoomEnabled: () => boolean;
    getMenuOpen: () => boolean;
    getMenuJustClosed: () => boolean;
    setMenuJustClosed: (value: boolean) => void;
    applyMinimapWheelZoom: (deltaY: number) => void;
    executeScriptListener: (
        widget: any,
        listener: any[],
        eventContext?: Partial<ScriptEvent>,
    ) => void;
    handleWidgetAction: (event: WidgetActionEvent) => void;
    handleTradeWidgetAction: (
        widget: any,
        event: { option?: string; slot?: number; itemId?: number },
        groupId: number,
        childId: number,
    ) => boolean;
    handleInventorySlotMove: (
        fromSlot: number,
        toSlot: number,
    ) => void;
    buildWidgetActionPayload: (
        event: Parameters<
            import("../WidgetActionRouter").WidgetActionRouter["buildWidgetActionPayload"]
        >[0],
    ) => import("../../../network/ServerConnection").WidgetActionClientPayload | null;
    resolveTransmitFlagWidget: (
        eventWidget: any,
        payload: import("../../../network/ServerConnection").WidgetActionClientPayload,
    ) => any;
    getSpellSelection: () => SpellSelectionController;
    getPendingInputDialogAction: () => { payload: any; option: string } | null;
    setPendingInputDialogAction: (action: { payload: any; option: string } | null) => void;
    getPendingTradeQuantityAction: () => {
        action: "offer" | "remove";
        slot: number;
        itemId: number;
        maximum: number;
    } | null;
    setPendingTradeQuantityAction: (
        action: {
            action: "offer" | "remove";
            slot: number;
            itemId: number;
            maximum: number;
        } | null,
    ) => void;
};

export function createWidgetInputState(): WidgetInputState {
    return {
        hoveredWidgetUids: new Set(),
        hoveredWidgetsByUid: new Map(),
        if1ScrollbarDragging: false,
        if1AlternativeScrollbarWidth: 0,
        lastHoverHitX: -1,
        lastHoverHitY: -1,
        cachedHoverHits: null,
        lastHoverListenerCycle: -1,
    };
}
