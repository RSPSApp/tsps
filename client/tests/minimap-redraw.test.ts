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
