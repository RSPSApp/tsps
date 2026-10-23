import { strict as assert } from "node:assert";

import { ClickRegistry } from "../widgets/gl/click-registry";
import { dropStaleClickTarget } from "../widgets/gl/widgetsGl/clickTypes";
import type { CachedClickTarget } from "../widgets/gl/widgetsGl/clickTypes";
import { cleanupWidgetClickTarget } from "../widgets/gl/widgetsGl/frameInput";
import { UIInputBridge } from "../widgets/gl/ui-input";
import { WidgetManager } from "../widgets/WidgetManager";

/**
 * An emptied worn-equipment slot (387) must stop showing "Remove <item>" on hover: its click
 * target persists between frames until it is dropped.
 */
function emptiedSlotLosesItsHoverText(): void {
    const clicks = new ClickRegistry();
    const cache = new Map<number, CachedClickTarget>();
    const slot = { uid: (387 << 16) | 28 } as any;
    const target: CachedClickTarget = {
        id: `widget:${slot.uid}`,
        rect: { x: 0, y: 0, w: 36, h: 36 },
        priority: 100,
        hoverText: "Remove",
        primaryOption: { option: "Remove", target: "Bronze arrow" },
        persist: true,
        widgetUid: slot.uid,
    };
    cache.set(slot.uid, target);
    clicks.register(target);
    clicks.beginFrame();
    assert.equal(clicks.pick(10, 10)?.hoverText, "Remove", "persists across frames while the slot holds an item");

    dropStaleClickTarget(cache, clicks, slot);
    clicks.beginFrame();
    assert.equal(clicks.pick(10, 10), undefined, "nothing to hover once the slot is empty");
    assert.equal(cache.has(slot.uid), false);

    // A widget that never had a target is left alone.
    dropStaleClickTarget(cache, clicks, { uid: 1 });
}

emptiedSlotLosesItsHoverText();

/**
 * Scripts rebuild dynamic children (chat lines, quest interfaces) with CC_DELETEALL + CC_CREATE,
 * and each new child gets a fresh uid. The deleted children's click targets must go with them,
 * or the registry grows all session and every frame's hover pass slows down.
 */
function deletedDynamicWidgetsLoseTheirTargets(): void {
    const manager = new WidgetManager({} as never, {
        loadWidgetGroup: () => undefined,
        getAvailableGroups: () => [],
        clearCache: () => undefined,
    } as never);
    const ui = new UIInputBridge();
    const clicks = ui.getClicks();
    const canvas: any = { __input: ui, __clickTargetCache: new Map<number, CachedClickTarget>() };
    manager.onWidgetUnregistered = (uid) => cleanupWidgetClickTarget(canvas, uid);

    const parent: any = { uid: 162 << 16, groupId: 162, parentUid: -1, children: [] };
    manager.registerWidget(parent);
    for (let rebuild = 0; rebuild < 200; rebuild++) {
        for (const child of parent.children) manager.unregisterWidgetTree(child);
        parent.children = [];
        for (let line = 0; line < 5; line++) {
            const child: any = { uid: manager.allocateDynamicUid(162), parentUid: parent.uid, children: null };
            manager.registerWidget(child);
            parent.children.push(child);
            // What renderWidgetTreeGL does for a widget with ops.
            const target: CachedClickTarget = {
                id: `widget:${child.uid}`,
                rect: { x: 0, y: line * 14, w: 400, h: 14 },
                priority: 100,
                hoverText: "Report",
                persist: true,
                widgetUid: child.uid,
            };
            canvas.__clickTargetCache.set(child.uid, target);
            clicks.register(target);
        }
        clicks.beginFrame();
    }
    assert.equal(clicks.getTargetCount(), 5, "only the live children keep targets");
    assert.equal(canvas.__clickTargetCache.size, 5);
    assert.equal(clicks.pick(10, 20)?.widgetUid, parent.children[1].uid);
}

deletedDynamicWidgetsLoseTheirTargets();
console.log("Stale click targets are dropped");

/** A registered target or metadata without a cache entry still goes with its widget. */
function cleanupWithoutCacheEntry(): void {
    const ui = new UIInputBridge();
    const clicks = ui.getClicks();
    const uid = (162 << 16) | 0x8001;
    const canvas: any = {
        __input: ui,
        __clickTargetCache: new Map(),
        __clickMetaMap: new Map([[uid, {}]]),
    };
    clicks.register({ id: `widget:${uid}`, rect: { x: 0, y: 0, w: 10, h: 10 }, persist: true, widgetUid: uid });
    cleanupWidgetClickTarget(canvas, uid);
    assert.equal(clicks.getTargetCount(), 0);
    assert.equal(canvas.__clickMetaMap.size, 0);
}

cleanupWithoutCacheEntry();
