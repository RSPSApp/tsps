import type { Point } from "@runelite/api/Point";
import type { Widget } from "@runelite/api/widgets/Widget";
import type { WidgetManager } from "../../widgets/WidgetManager";
import type { WidgetNode } from "../../widgets/WidgetNode";

/** The widget manager surface the wrapper reads (a test may stub it). */
export type WidgetSource = Pick<WidgetManager, "getWidgetByUid"> &
    Partial<Pick<WidgetManager, "getDynamicChildrenByParent" | "getStaticChildrenByParentUid" | "isEffectivelyHidden">>;

/**
 * RuneLite's Widget over one of our WidgetNodes. Every getter reads the node live, so a wrapper
 * kept across frames stays current; `getCanvasLocation` is the renderer's last laid-out position.
 */
export class WidgetImpl implements Widget {
    constructor(
        private readonly manager: WidgetSource,
        private readonly node: WidgetNode,
    ) {}

    getId(): number {
        return this.node.uid | 0;
    }

    getText(): string {
        return this.node.text ?? "";
    }

    getSpriteId(): number {
        return this.node.spriteId ?? -1;
    }

    getItemId(): number {
        return this.node.itemId ?? -1;
    }

    getItemQuantity(): number {
        return this.node.itemQuantity ?? 0;
    }

    isSelfHidden(): boolean {
        return this.node.isHidden === true || this.node.hidden === true;
    }

    isHidden(): boolean {
        if (this.isSelfHidden()) return true;
        return this.manager.isEffectivelyHidden?.(this.node.uid | 0) === true;
    }

    getCanvasLocation(): Point | null {
        const x = this.node._absX, y = this.node._absY;
        return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
    }

    getWidth(): number {
        return (this.node._absWidth ?? this.node.width) | 0;
    }

    getHeight(): number {
        return (this.node._absHeight ?? this.node.height) | 0;
    }

    getRelativeX(): number {
        return this.node.x | 0;
    }

    getRelativeY(): number {
        return this.node.y | 0;
    }

    getScrollX(): number {
        return this.node.scrollX | 0;
    }

    getScrollY(): number {
        return this.node.scrollY | 0;
    }

    getScrollWidth(): number {
        return this.node.scrollWidth | 0;
    }

    getScrollHeight(): number {
        return this.node.scrollHeight | 0;
    }

    getChildren(): Widget[] {
        const children = this.manager.getStaticChildrenByParentUid?.(this.node.uid | 0) ?? (this.node.children ?? []);
        return children.filter((child): child is WidgetNode => !!child).map((child) => new WidgetImpl(this.manager, child));
    }

    getDynamicChildren(): Widget[] {
        const children = this.manager.getDynamicChildrenByParent?.(this.node) ?? [];
        return children.filter((child): child is WidgetNode => !!child).map((child) => new WidgetImpl(this.manager, child));
    }

    getParent(): Widget | null {
        const parentUid = this.node.parentUid | 0;
        if (parentUid < 0) return null;
        const parent = this.manager.getWidgetByUid(parentUid);
        return parent ? new WidgetImpl(this.manager, parent) : null;
    }
}

/** The RuneLite Widget for a component id, or null when it is not loaded. */
export function getWidget(manager: WidgetSource | undefined, componentId: number): Widget | null {
    const node = manager?.getWidgetByUid(componentId | 0);
    return node ? new WidgetImpl(manager!, node) : null;
}
