import assert from "node:assert/strict";

import { WidgetManager } from "../widgets/WidgetManager";

// OSRS minimap_state (varbit 6719):
//   0 enabled, 1 map unclickable, 2 hide map, 3 hide compass,
//   4 hide compass + map unclickable, 5 disabled.
// Native draws the map for every state except 2 and 5, and the compass only while < 3.
const minimap = { uid: (161 << 16) | 30, parentUid: -1, contentType: 1338, hidden: false } as any;
const compass = { uid: (161 << 16) | 29, parentUid: -1, contentType: 1339, hidden: false } as any;

function managerWith(): WidgetManager {
    const manager = new WidgetManager({} as any, {} as any);
    const map = { ...minimap };
    const dial = { ...compass };
    for (const widget of [map, dial]) {
        (manager as any).widgetByUid.set(widget.uid, widget);
    }
    manager.minimapWidget = map;
    manager.compassWidget = dial;
    return manager;
}

function redraw(manager: WidgetManager) {
    manager.consumeAllRootDirty();
    manager.beginFrame();
    (manager as any).preciseDirtyWidgets.clear();
    manager.updateMinimap();
    manager.updateCompassAngle(512);
    return manager.getPreciseDirtyWidgets();
}

for (const state of [0, 1, 3, 4, 6, 7]) {
    const manager = managerWith();
    manager.setMinimapState(state);
    assert.equal(manager.isMinimapMapVisible(), true, `state ${state} shows the map`);
    assert.equal(
        manager.isMinimapCompassVisible(),
        state < 3,
        `state ${state} compass visibility`,
    );
    assert.equal(
        manager.isMinimapClickable(),
        state === 0 || state === 3,
        `state ${state} map clickability`,
    );
    const dirty = redraw(manager);
    assert.ok(dirty.some((w) => w.uid === minimap.uid), `state ${state} redraws the map`);
    assert.equal(
        dirty.some((w) => w.uid === compass.uid),
        state < 3,
        `state ${state} redraws the compass only while < 3`,
    );
}

for (const state of [2, 5]) {
    const manager = managerWith();
    manager.setMinimapState(state);
    assert.equal(manager.isMinimapMapVisible(), false, `state ${state} hides the map`);
    assert.equal(
        manager.isMinimapCompassVisible(),
        state < 3,
        `state ${state} compass visibility`,
    );
    assert.equal(
        manager.isMinimapClickable(),
        state === 0 || state === 3,
        `state ${state} map clickability`,
    );
    const dirty = redraw(manager);
    assert.equal(dirty.some((w) => w.uid === minimap.uid), false, `state ${state} leaves no stale map`);
    assert.equal(
        dirty.some((w) => w.uid === compass.uid),
        state < 3,
        `state ${state} compass redraw`,
    );
}

const manager = managerWith();
manager.setMinimapState(2);
assert.equal((manager as any).globalDirty, true, "a state change repaints the frame");
manager.consumeAllRootDirty();
manager.setMinimapState(2);
assert.equal((manager as any).globalDirty, false, "an unchanged state is a no-op");
manager.setMinimapState(-5);
assert.equal(manager.minimapState, 0, "states clamp to 0-7");
manager.setMinimapState(99);
assert.equal(manager.minimapState, 7);

console.log("minimap toggle test passed");
