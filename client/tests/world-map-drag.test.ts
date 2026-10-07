import assert from "node:assert/strict";

import { applyPendingWorldMapDrag, handleWorldMapDragInput } from "../game/worldMap/WorldMapInput";

/** The world map widget (content type 1400) and an edge arrow ("Focus on ...") drawn over it. */
const MAP = { uid: (595 << 16) | 7, type: 0, contentType: 1400, width: 400, height: 300, _absX: 0, _absY: 0, _absWidth: 400, _absHeight: 300 };
const ARROW = { uid: (595 << 16) | 50, type: 5, spriteId: 297, width: 15, height: 15 };

function holder() {
    const worldMapState = {
        displayX: 3200,
        displayY: 3200,
        getZoomScale: () => 4,
        getDisplayPixelWidth: () => 400,
        getDisplayPixelHeight: () => 300,
        isLoaded: () => true,
        currentArea: undefined,
        setDisplayPosition(x: number, y: number) {
            this.displayX = x;
            this.displayY = y;
        },
    };
    return {
        worldMapState,
        worldMapDragStartMouseX: -1,
        worldMapDragStartMouseY: -1,
        worldMapDragStartDisplayX: 0,
        worldMapDragStartDisplayY: 0,
        worldMapDragPixelsPerTileX: 1,
        worldMapDragPixelsPerTileY: 1,
        worldMapClickStartMouseX: -1,
        worldMapClickStartMouseY: -1,
        worldMapClickStartTimeMs: 0,
        pendingWorldMapDragDisplayX: undefined as number | undefined,
        pendingWorldMapDragDisplayY: undefined as number | undefined,
    } as any;
}

const deps = { isWidgetEffectivelyHidden: () => false, invalidateAllWidgets: () => {} };
const frame = (state: any, hits: any[], x: number, y: number, isNewClick: boolean, isHolding: boolean) => {
    handleWorldMapDragInput(state, deps, hits, x, y, isNewClick, isHolding);
    applyPendingWorldMapDrag(state, () => {});
};

// "Focus on Your position": pressing the arrow runs its op, which pans the map (script 1756).
// The press must not start a drag that pins the view and snaps it back.
{
    const state = holder();
    frame(state, [MAP, ARROW], 200, 150, true, true);
    state.worldMapState.displayX = 3260; // the op's pan moves the view
    frame(state, [MAP, ARROW], 200, 150, false, true);
    frame(state, [MAP, ARROW], 200, 150, false, false);
    assert.equal(state.worldMapState.displayX, 3260, "a press on the arrow leaves the pan alone");
}

// A press on the map itself that doesn't move leaves the view to anything else moving it.
{
    const state = holder();
    frame(state, [MAP], 200, 150, true, true);
    state.worldMapState.displayX = 3230;
    frame(state, [MAP], 200, 150, false, true);
    assert.equal(state.worldMapState.displayX, 3230, "no movement, no drag");
}

// Dragging the map itself still moves it.
{
    const state = holder();
    frame(state, [MAP], 200, 150, true, true);
    frame(state, [MAP], 160, 150, false, true);
    assert.equal(state.worldMapState.displayX, 3210, "40 pixels left at 4 per tile: 10 tiles east");
}

console.log("world map drag: ok");
