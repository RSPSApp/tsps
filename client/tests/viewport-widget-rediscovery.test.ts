import assert from "node:assert/strict";

import { ContentType, WidgetManager } from "../widgets/WidgetManager";

function widget(uid: number, contentType: number): any {
    return {
        uid,
        id: uid,
        groupId: uid >>> 16,
        fileId: 0,
        childIndex: -1,
        parentUid: -1,
        isIf3: true,
        type: 0,
        rawX: 0,
        rawY: 0,
        rawWidth: 0,
        rawHeight: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        widthMode: 1,
        heightMode: 1,
        xPositionMode: 0,
        yPositionMode: 0,
        hidden: false,
        contentType,
    };
}

const rootA = widget(900 << 16, ContentType.VIEWPORT);
const rootB = widget(901 << 16, ContentType.VIEWPORT);
const plain = widget(902 << 16, 0);
const groups = new Map<number, any>([
    [900, { root: rootA, widgets: new Map([[rootA.uid, rootA]]) }],
    [901, { root: rootB, widgets: new Map([[rootB.uid, rootB]]) }],
    [902, { root: plain, widgets: new Map([[plain.uid, plain]]) }],
]);
const loader = {
    loadWidgetGroup: (groupId: number) => groups.get(groupId),
    getAvailableGroups: () => [...groups.keys()],
    clearCache: () => undefined,
};
const manager = new WidgetManager({} as never, loader as never);
manager.resize(800, 600);

// Login boots the gameframe and the renderer must attach to its viewport.
manager.setRootInterface(900);
assert.equal(manager.viewportWidget, rootA, "loaded root exposes its viewport widget");
assert.equal(manager.getSceneViewportWidget(), rootA, "current root's viewport is served");

// The welcome screen (or any root without a viewport) clears the reference.
manager.setRootInterface(901);
assert.equal(manager.viewportWidget, rootB, "second root has its own viewport");
manager.setRootInterface(902);
assert.equal(manager.viewportWidget, null);

// Switching back to the cached gameframe replays the load path only if the
// manager rediscovers the special widgets itself. Without it viewportWidget
// stayed null and fixed mode rendered the scene across the whole canvas.
manager.setRootInterface(900);
assert.equal(
    manager.viewportWidget,
    rootA,
    "cached root rediscovers its viewport widget",
);

// A stale reference (e.g. the stretch viewport left over from the previous
// gameframe) must never be served while a different root is active.
manager.viewportWidget = rootB;
assert.equal(
    manager.getSceneViewportWidget(),
    rootA,
    "stale viewport is re-derived from the active root",
);

// A root with no viewport widget at all resolves to null, not the stale one.
manager.setRootInterface(902);
manager.viewportWidget = rootA;
assert.equal(manager.getSceneViewportWidget(), null, "no viewport widget means no viewport");

// Switching only the gameframe must retain the server's operation flags on mounted content.
const bank = widget((12 << 16) | 13, 0);
const desktopRoot = widget(161 << 16, 0);
manager.setRootInterface(161);
manager.setWidgetFlagsOverride(bank, 0x7fe);
manager.setWidgetFlagsOverride(desktopRoot, 2);
manager.setRootInterface(601);
assert.equal(manager.getServerSetFlags(bank), 0x7fe, "open bank actions survive a mobile switch");
assert.equal(manager.getServerSetFlags(desktopRoot), undefined, "old gameframe flags are removed");
manager.setRootInterface(161);
assert.equal(manager.getServerSetFlags(bank), 0x7fe, "bank actions survive switching back");
manager.setRootInterface(902);
assert.equal(manager.getServerSetFlags(bank), undefined, "leaving the gameframe still clears flags");

console.log("viewport widget rediscovery test passed");
