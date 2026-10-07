import { ClickMode } from "../InputManager";
import type { InputManager } from "../InputManager";
import type { WidgetManager } from "../../widgets/WidgetManager";
import {
    clearDragWidgetVisualState,
    getDragParentDepth,
    isInventoryContainer,
    isWidgetDraggable,
    resolveClickedWidgetParent,
    resolveDragParentByFlags,
} from "./interaction/widgetDragHelpers";
import {
    getUiClickRegistry,
    getWorldClickBlockingWidgetAtPoint,
    handleTradeRequestChatClick,
    isPointerOverMinimapClickTarget,
} from "./interaction/widgetClickProbe";

export type WidgetInteractionControllerDeps = {
    getWidgetManager: () => WidgetManager | undefined;
    getInputManager: () => InputManager | undefined;
    getRendererCanvas: () => unknown;
    getTradeRequestTargetsByName: () => ReadonlyMap<string, number>;
};

/**
 * Widget drag, click-state, and UI click-probe helpers extracted from OsrsClient.
 */
export class WidgetInteractionController {
    dragSourceWidget: any = null;
    clickedWidget: any = null;
    clickedWidgetParent: any = null;
    clickedWidgetX: number = 0;
    clickedWidgetY: number = 0;
    clickedWidgetHandled: boolean = false;

    widgetDragDuration: number = 0;
    /** Client cycle (20ms) at which the current press started; drag dead time counts from it. */
    dragClickCycle: number = 0;
    isDraggingWidget: boolean = false;
    dragClickX: number = 0;
    dragClickY: number = 0;
    draggedOnWidget: any = null;

    lastDragHitX: number = -1;
    lastDragHitY: number = -1;

    deferredWidgetAction: any = null;

    dragRenderAreaAbsX?: number;
    dragRenderAreaAbsY?: number;

    constructor(private readonly deps: WidgetInteractionControllerDeps) {}

    isInventoryContainer(parentUid: number): boolean {
        return isInventoryContainer(this.deps.getWidgetManager(), parentUid);
    }

    getDragParentDepth(w: any): number {
        return getDragParentDepth(this.deps.getWidgetManager(), w);
    }

    resolveDragParentByFlags(w: any): any | null {
        return resolveDragParentByFlags(this.deps.getWidgetManager(), w);
    }

    resolveClickedWidgetParent(w: any): any | null {
        return resolveClickedWidgetParent(this.deps.getWidgetManager(), w);
    }

    isWidgetDraggable(w: any): boolean {
        return isWidgetDraggable(this.deps.getWidgetManager(), w);
    }

    getUiRenderScale(): [number, number] {
        const canvas = this.deps.getInputManager()?.element as HTMLCanvasElement | undefined;
        const widgetManager = this.deps.getWidgetManager();
        const layoutW = widgetManager?.canvasWidth || 0;
        const layoutH = widgetManager?.canvasHeight || 0;
        const bufW = canvas?.width || 0;
        const bufH = canvas?.height || 0;
        const sx = layoutW > 0 && bufW > 0 ? bufW / layoutW : 1;
        const sy = layoutH > 0 && bufH > 0 ? bufH / layoutH : 1;
        return [sx, sy];
    }

    isWidgetInteractionStale(widget: any): boolean {
        const uid = typeof widget?.uid === "number" ? widget.uid | 0 : 0;
        const widgetManager = this.deps.getWidgetManager();
        if (uid === 0 || !widgetManager) return true;
        return (
            widgetManager.getWidgetByUid(uid) !== widget ||
            widgetManager.isEffectivelyHidden(uid)
        );
    }

    clearDragWidgetVisualState(widget: any): void {
        clearDragWidgetVisualState(this.deps.getWidgetManager(), widget);
    }

    cancelActiveUiClickIfHeld(): void {
        const inputManager = this.deps.getInputManager();
        const isHeld =
            inputManager?.clickMode2 === ClickMode.LEFT ||
            inputManager?.isDragging?.() === true;
        if (!isHeld) return;
        (this.deps.getRendererCanvas() as any)?.__inputBridge?.consumeClick?.();
    }

    clearWidgetInteractionState(): void {
        const clicked = this.clickedWidget;
        const dragSource = this.dragSourceWidget;

        this.clearDragWidgetVisualState(clicked);
        if (dragSource && dragSource !== clicked) {
            this.clearDragWidgetVisualState(dragSource);
        }

        this.clickedWidget = null;
        this.clickedWidgetParent = null;
        this.clickedWidgetX = 0;
        this.clickedWidgetY = 0;
        this.clickedWidgetHandled = false;
        this.widgetDragDuration = 0;
        this.isDraggingWidget = false;
        this.dragClickX = 0;
        this.dragClickY = 0;
        this.dragSourceWidget = null;
        this.draggedOnWidget = null;
        this.deferredWidgetAction = null;
        this.lastDragHitX = -1;
        this.lastDragHitY = -1;
        delete this.dragRenderAreaAbsX;
        delete this.dragRenderAreaAbsY;
        this.cancelActiveUiClickIfHeld();
    }

    clearStaleWidgetInteractionState(): void {
        if (this.clickedWidget && this.isWidgetInteractionStale(this.clickedWidget)) {
            this.clearWidgetInteractionState();
            return;
        }

        if (this.dragSourceWidget && this.isWidgetInteractionStale(this.dragSourceWidget)) {
            this.clearWidgetInteractionState();
            return;
        }

        if (
            this.deferredWidgetAction?.widget &&
            this.isWidgetInteractionStale(this.deferredWidgetAction.widget)
        ) {
            this.deferredWidgetAction = null;
            this.cancelActiveUiClickIfHeld();
        }

        if (this.draggedOnWidget && this.isWidgetInteractionStale(this.draggedOnWidget)) {
            this.draggedOnWidget = null;
        }
    }

    getWorldClickBlockingWidgetAtPoint(px: number, py: number): any | null {
        return getWorldClickBlockingWidgetAtPoint(
            this.deps.getWidgetManager(),
            this.clickedWidget,
            px,
            py,
        );
    }

    isPointOverWidget(px: number, py: number): boolean {
        return this.getWorldClickBlockingWidgetAtPoint(px, py) !== null;
    }

    handleTradeRequestChatClick(widgets: readonly any[]): boolean {
        return handleTradeRequestChatClick(
            widgets,
            this.deps.getTradeRequestTargetsByName(),
        );
    }

    getUiClickRegistry() {
        return getUiClickRegistry(this.deps.getRendererCanvas());
    }

    isPointerOverMinimapClickTarget(screenX: number, screenY: number): boolean {
        return isPointerOverMinimapClickTarget(
            this.deps.getRendererCanvas(),
            screenX,
            screenY,
        );
    }
}
