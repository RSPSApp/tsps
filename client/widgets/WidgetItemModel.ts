import type { ObjType } from "../rs/config/objtype/ObjType";
import type { WidgetNode } from "./WidgetNode";

/** Initialize once when assigning an item; subsequent scripts own the model transform. */
export function initializeWidgetItemModel(widget: WidgetNode, obj: ObjType): void {
    widget.modelAngleX = widget.rotationX = obj.xan2d | 0;
    widget.modelAngleY = widget.rotationY = obj.yan2d | 0;
    widget.modelAngleZ = widget.rotationZ = obj.zan2d | 0;
    widget.modelOffsetX = obj.offsetX2d | 0;
    widget.modelOffsetY = obj.offsetY2d | 0;
    const widthUnits = ((widget as any).modelZoomWidthUnits ?? 0) | 0;
    const width = widthUnits > 0 ? widthUnits : (widget.rawWidth ?? 0) | 0;
    const zoom = Math.max(1, obj.zoom2d | 0);
    widget.modelZoom = width > 0 ? Math.max(1, Math.floor(zoom * 32 / width)) : zoom;
}
