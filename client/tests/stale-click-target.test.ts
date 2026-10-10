import { strict as assert } from "node:assert";

import { ClickRegistry } from "../widgets/gl/click-registry";
import { dropStaleClickTarget } from "../widgets/gl/widgetsGl/clickTypes";
import type { CachedClickTarget } from "../widgets/gl/widgetsGl/clickTypes";

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
