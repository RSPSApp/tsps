import assert from "node:assert/strict";

import { WidgetManager } from "../widgets/WidgetManager";

// The minimap is redrawn every frame it is on screen: zooming it, walking and moving dots never
// mark it dirty themselves, so without this the widget layer showed a new zoom only when
// something else (the compass turning, an orb update) redrew that region.
function managerWith(minimap: any): WidgetManager {
    const manager = new WidgetManager({} as any, {} as any);
    if (minimap) {
        (manager as any).widgetByUid.set(minimap.uid, minimap);
        manager.minimapWidget = minimap;
    }
    return manager;
}
const minimap = { uid: (161 << 16) | 30, parentUid: -1, contentType: 1338, hidden: false } as any;

const none = managerWith(null);
none.updateMinimap();
assert.deepEqual(none.getPreciseDirtyWidgets(), [], "no minimap, nothing to redraw");

const shown = managerWith(minimap);
shown.updateMinimap();
assert.deepEqual(shown.getPreciseDirtyWidgets(), [minimap], "its own rectangle is redrawn");

const hidden = managerWith({ ...minimap, hidden: true });
hidden.updateMinimap();
assert.deepEqual(hidden.getPreciseDirtyWidgets(), [], "a hidden minimap is left alone");

console.log("minimap redraw test passed");

none.updateCompassAngle(512);
assert.deepEqual(none.getPreciseDirtyWidgets(), [], "no compass, nothing to redraw");

// Camera rotation must not dirty the compass's entire fixed or resizable gameframe.
for (const groupId of [161, 164, 548]) {
    const manager = managerWith(null);
    const root = { uid: groupId << 16, parentUid: -1 } as any;
    manager.registerRootWidget(root, 0, 0, 800, 600);
    const compass = { uid: root.uid | 1, parentUid: root.uid, rootIndex: root.rootIndex } as any;
    manager.compassWidget = compass;
    manager.consumeAllRootDirty();

    manager.updateCompassAngle(512);
    assert.equal(compass.spriteAngle, 49152, "the compass turns opposite the camera");
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [compass], "only the compass redraws");
    assert.equal(manager.isAnyRootDirty(), false, "camera rotation leaves the gameframe clean");

    manager.beginFrame();
    manager.updateCompassAngle(512);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [], "an unchanged angle needs no redraw");

    manager.updateCompassAngle(-512);
    assert.equal(compass.spriteAngle, 16384, "negative camera yaw wraps correctly");
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [compass]);
    assert.equal(manager.isAnyRootDirty(), false);
}

console.log("compass redraw test passed");
