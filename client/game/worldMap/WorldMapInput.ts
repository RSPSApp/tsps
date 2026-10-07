import { ClientPacketId, createPacket, queuePacket } from "../../network/packet";
import { isServerConnected } from "../../network/ServerConnection";
import { packWorldMapCoord } from "../../rs/map/WorldMapArea";
import { getVisibleWidgetSurfaceReason } from "../../widgets/gl/widgets-gl";
import type { WorldMapStateHolder } from "./WorldMapTypes";

export type WorldMapInputDeps = {
    isWidgetEffectivelyHidden: (uid: number) => boolean;
    invalidateAllWidgets: () => void;
};

export function resetWorldMapDrag(state: WorldMapStateHolder): void {
    state.worldMapDragStartMouseX = -1;
    state.worldMapDragStartMouseY = -1;
    state.worldMapDragStartDisplayX = 0;
    state.worldMapDragStartDisplayY = 0;
    state.worldMapDragPixelsPerTileX = 1;
    state.worldMapDragPixelsPerTileY = 1;
}

export function resetWorldMapClick(state: WorldMapStateHolder): void {
    state.worldMapClickStartMouseX = -1;
    state.worldMapClickStartMouseY = -1;
    state.worldMapClickStartTimeMs = 0;
}

function findWorldMapClickHit(
    hits: any[],
    isWidgetEffectivelyHidden: (uid: number) => boolean,
): any | null {
    for (let i = hits.length - 1; i >= 0; i--) {
        const w = hits[i];
        if (!w) continue;
        const uid = (w.uid ?? 0) | 0;
        if (uid !== 0 && isWidgetEffectivelyHidden(uid)) continue;
        if (w.hidden || w.hide) continue;
        if (((w.contentType ?? 0) | 0) === 1400) return w;
        if (getVisibleWidgetSurfaceReason(w)) return null;
    }
    return null;
}

function getWorldMapWidgetPixelsPerTile(state: WorldMapStateHolder, widget: any): { x: number; y: number } {
    const logicalPixelsPerTile = state.worldMapState.getZoomScale();
    const logicalWidth = Math.max(
        1,
        (widget?.width ?? state.worldMapState.getDisplayPixelWidth() ?? 1) | 0,
    );
    const logicalHeight = Math.max(
        1,
        (widget?.height ?? state.worldMapState.getDisplayPixelHeight() ?? 1) | 0,
    );
    const pixelWidth =
        typeof widget?._absWidth === "number" && Number.isFinite(widget._absWidth)
            ? Math.max(1, widget._absWidth | 0)
            : logicalWidth;
    const pixelHeight =
        typeof widget?._absHeight === "number" && Number.isFinite(widget._absHeight)
            ? Math.max(1, widget._absHeight | 0)
            : logicalHeight;
    return {
        x: logicalPixelsPerTile * (pixelWidth / logicalWidth),
        y: logicalPixelsPerTile * (pixelHeight / logicalHeight),
    };
}

function resolveWorldMapClickCoord(
    state: WorldMapStateHolder,
    widget: any,
    mouseX: number,
    mouseY: number,
): { plane: number; x: number; y: number } | undefined {
    const area = state.worldMapState.currentArea;
    if (!area || !state.worldMapState.isLoaded()) return undefined;

    const absX = Number.isFinite(widget?._absX) ? widget._absX : (widget?.x ?? 0);
    const absY = Number.isFinite(widget?._absY) ? widget._absY : (widget?.y ?? 0);
    const width = Math.max(
        1,
        Number.isFinite(widget?._absWidth)
            ? widget._absWidth
            : (widget?.width ?? state.worldMapState.getDisplayPixelWidth() ?? 1),
    );
    const height = Math.max(
        1,
        Number.isFinite(widget?._absHeight)
            ? widget._absHeight
            : (widget?.height ?? state.worldMapState.getDisplayPixelHeight() ?? 1),
    );

    if (mouseX < absX || mouseY < absY || mouseX >= absX + width || mouseY >= absY + height) {
        return undefined;
    }

    const pixelsPerTile = getWorldMapWidgetPixelsPerTile(state, widget);
    const centerX = absX + width / 2;
    const centerY = absY + height / 2;
    const displayX = Math.trunc(
        (state.worldMapState.displayX | 0) + (mouseX - centerX) / pixelsPerTile.x,
    );
    const displayY = Math.trunc(
        (state.worldMapState.displayY | 0) - (mouseY - centerY) / pixelsPerTile.y,
    );
    return area.coord(displayX, displayY);
}

function sendWorldMapClick(coord: { plane: number; x: number; y: number }): void {
    if (!isServerConnected()) return;
    const pkt = createPacket(ClientPacketId.WORLD_MAP_CLICK);
    pkt.packetBuffer.writeIntIME(packWorldMapCoord(coord));
    queuePacket(pkt);
}

export function handleWorldMapDragInput(
    state: WorldMapStateHolder,
    deps: WorldMapInputDeps,
    hits: any[],
    mouseX: number,
    mouseY: number,
    isNewClick: boolean,
    isHolding: boolean,
): boolean {
    const isHidden = deps.isWidgetEffectivelyHidden;

    if (isNewClick) {
        const clickHit = findWorldMapClickHit(hits, isHidden);
        if (clickHit) {
            state.worldMapClickStartMouseX = mouseX | 0;
            state.worldMapClickStartMouseY = mouseY | 0;
            state.worldMapClickStartTimeMs = Date.now();
        } else {
            resetWorldMapClick(state);
        }
    }

    if (!isHolding) {
        if (state.worldMapClickStartMouseX >= 0 && state.worldMapClickStartMouseY >= 0) {
            const deltaX = (mouseX | 0) - state.worldMapClickStartMouseX;
            const deltaY = (mouseY | 0) - state.worldMapClickStartMouseY;
            const clickHit = findWorldMapClickHit(hits, isHidden);
            if (
                clickHit &&
                Date.now() - state.worldMapClickStartTimeMs <= 500 &&
                deltaX >= -25 &&
                deltaX <= 25 &&
                deltaY >= -25 &&
                deltaY <= 25
            ) {
                const coord = resolveWorldMapClickCoord(state, clickHit, mouseX | 0, mouseY | 0);
                if (coord) sendWorldMapClick(coord);
            }
            resetWorldMapClick(state);
        }
        resetWorldMapDrag(state);
        return false;
    }

    if (isNewClick) {
        // Only a press on the map itself drags it. A press on something drawn over the map (the
        // edge arrows' "Focus on", icons, buttons) is that thing's op, and a drag started under
        // it would pin the view while the op's script pans away (and snap it back).
        const worldMapHit = findWorldMapClickHit(hits, isHidden);
        if (!worldMapHit) {
            resetWorldMapDrag(state);
            return false;
        }
        state.worldMapDragStartMouseX = mouseX | 0;
        state.worldMapDragStartMouseY = mouseY | 0;
        state.worldMapDragStartDisplayX = state.worldMapState.displayX | 0;
        state.worldMapDragStartDisplayY = state.worldMapState.displayY | 0;
        const pixelsPerTile = getWorldMapWidgetPixelsPerTile(state, worldMapHit);
        state.worldMapDragPixelsPerTileX = pixelsPerTile.x;
        state.worldMapDragPixelsPerTileY = pixelsPerTile.y;
    }

    if (state.worldMapDragStartMouseX < 0 || state.worldMapDragStartMouseY < 0) {
        return false;
    }

    const deltaX = (mouseX | 0) - state.worldMapDragStartMouseX;
    const deltaY = (mouseY | 0) - state.worldMapDragStartMouseY;
    // Until the mouse moves there is nothing to drag: leave the view to anything else moving it.
    if (deltaX === 0 && deltaY === 0) return true;
    const nextX =
        state.worldMapDragStartDisplayX - Math.trunc(deltaX / state.worldMapDragPixelsPerTileX);
    const nextY =
        state.worldMapDragStartDisplayY + Math.trunc(deltaY / state.worldMapDragPixelsPerTileY);
    const currentX =
        state.pendingWorldMapDragDisplayX !== undefined
            ? state.pendingWorldMapDragDisplayX
            : state.worldMapState.displayX | 0;
    const currentY =
        state.pendingWorldMapDragDisplayY !== undefined
            ? state.pendingWorldMapDragDisplayY
            : state.worldMapState.displayY | 0;
    if (nextX !== currentX || nextY !== currentY) {
        state.pendingWorldMapDragDisplayX = nextX;
        state.pendingWorldMapDragDisplayY = nextY;
    }
    return true;
}

export function applyPendingWorldMapDrag(
    state: WorldMapStateHolder,
    invalidateAllWidgets: () => void,
): boolean {
    if (
        state.pendingWorldMapDragDisplayX === undefined ||
        state.pendingWorldMapDragDisplayY === undefined
    ) {
        return false;
    }
    const nextX = state.pendingWorldMapDragDisplayX | 0;
    const nextY = state.pendingWorldMapDragDisplayY | 0;
    state.pendingWorldMapDragDisplayX = undefined;
    state.pendingWorldMapDragDisplayY = undefined;
    if (
        nextX !== (state.worldMapState.displayX | 0) ||
        nextY !== (state.worldMapState.displayY | 0)
    ) {
        state.worldMapState.setDisplayPosition(nextX, nextY);
        invalidateAllWidgets();
        return true;
    }
    return false;
}
