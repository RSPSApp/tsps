import assert from "node:assert/strict";

import { WidgetManager } from "../widgets/WidgetManager";

// Timer scripts (the enhanced client's mouseover text, 4726) delete and rebuild the same dynamic
// children every client cycle. Only a rebuild that changes something may redraw the UI.
const manager = new WidgetManager({} as never, {
    loadWidgetGroup: () => undefined,
    getAvailableGroups: () => [],
    clearCache: () => undefined,
} as never);

const root: any = { uid: 161 << 16, groupId: 161, parentUid: -1, type: 0, children: null };
manager.registerWidget(root);
manager.registerRootWidget(root, 0, 0, 800, 600);

let nextUid = (161 << 16) | 0x8000;
/** CC_DELETEALL then CC_CREATE + setters, as the script does each cycle. */
function rebuild(text: string): void {
    // What the renderer wrote onto the drawn widgets isn't part of what the script built.
    for (const drawnChild of root.children ?? []) if (drawnChild) drawnChild._absX = 10;
    manager.beginChildRebuild(root);
    for (const child of root.children ?? []) if (child) manager.unregisterWidgetTree(child);
    root.children = null;
    manager.invalidateDynamicChildrenCache(root);
    manager.invalidateWidgetRender(root);
    const child: any = {
        uid: nextUid++, id: root.uid, parentUid: root.uid, groupId: 161, type: 4, childIndex: 0,
        rawX: 0, rawY: 0, rawWidth: 1, rawHeight: 1, isLayoutValid: false, text, textColor: 0xd8d8d8,
    };
    root.children = [child];
    manager.registerWidget(child);
    manager.invalidateWidgetRender(root);
    manager.invalidateWidget(child);
    manager.invalidateWidgetRender(child);
}

function drawn(): boolean {
    manager.flushChildRebuilds();
    const dirty = manager.isAnyRootDirty();
    manager.consumeAllRootDirty();
    return dirty;
}

rebuild("Walk here");
assert.equal(drawn(), true, "the first build draws");
rebuild("Walk here");
assert.equal(drawn(), false, "an identical rebuild leaves the UI as it was");
rebuild("Walk here");
assert.equal(drawn(), false);
rebuild("Attack Man");
assert.equal(drawn(), true, "new hover text redraws");

// Deleting the children without recreating them is a change too.
manager.beginChildRebuild(root);
for (const child of root.children ?? []) if (child) manager.unregisterWidgetTree(child);
root.children = null;
manager.invalidateWidgetRender(root);
assert.equal(drawn(), true, "removed children redraw");

// Other widgets still redraw at once while a rebuild is pending.
const other: any = { uid: (161 << 16) | 5, groupId: 161, parentUid: -1, type: 0, children: null };
manager.registerWidget(other);
manager.registerRootWidget(other, 0, 0, 10, 10);
manager.consumeAllRootDirty();
manager.beginChildRebuild(root);
manager.invalidateWidgetRender(other);
assert.equal(manager.isAnyRootDirty(), true, "unrelated invalidation is not held back");

console.log("Widget rebuilds only redraw when they change");

// Animated models only tick (and redraw) in open interfaces: the welcome screen (378) used to
// keep animating after login.
const seqTypes = { load: () => ({ frameLengths: [1, 1, 1], frameIds: [1, 2, 3], frameStep: 1, isSkeletalSeq: () => false }) };
const openModel: any = { uid: (161 << 16) | 9, groupId: 161, parentUid: root.uid, type: 6, sequenceId: 1, sequenceId2: -1, modelFrame: 0, modelFrameCycle: 0 };
const closedModel: any = { uid: (378 << 16) | 54, groupId: 378, parentUid: -1, type: 6, sequenceId: 1, sequenceId2: -1, modelFrame: 0, modelFrameCycle: 0, rootIndex: 0 };
manager.registerWidget(openModel);
manager.registerWidget(closedModel);
(manager as any).rootInterface = 161;
manager.consumeAllRootDirty();
manager.tickModelAnimations(5, seqTypes as never);
assert.ok(openModel.modelFrame > 0, "an open interface's model animates");
assert.equal(closedModel.modelFrame, 0, "a closed interface's model stays put");
manager.consumeAllRootDirty();
(manager as any).rootInterface = 999;
manager.tickModelAnimations(5, seqTypes as never);
assert.equal(manager.isAnyRootDirty(), false, "closed interfaces don't redraw the UI");

console.log("Only open interfaces animate their models");
