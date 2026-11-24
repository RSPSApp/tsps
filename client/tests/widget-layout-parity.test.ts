import assert from "node:assert/strict";
import { test } from "node:test";

import { layoutSingleWidget } from "../widgets/layout/WidgetLayout";

// OSRS layout rules: both axes take their absolute / minus / proportional size before the aspect
// mode reads the other axis; the aspect ratio is the component's own (1:1 unless set); centring
// divides toward zero; and a component's scroll is kept inside its scroll area.

test("aspect width follows the height computed in the same pass", () => {
    const w: any = { rawX: 0, rawY: 0, rawWidth: 300, rawHeight: 20, widthMode: 4, heightMode: 1 };
    layoutSingleWidget(w, 500, 120);
    assert.deepEqual([w.width, w.height], [100, 100], "square: the raw width is not the ratio");
    layoutSingleWidget(w, 500, 220);
    assert.deepEqual([w.width, w.height], [200, 200], "and it tracks a resize at once");
});

test("a set aspect ratio is used", () => {
    const w: any = { rawX: 0, rawY: 0, rawWidth: 90, rawHeight: 0, widthMode: 0, heightMode: 4, aspectWidth: 3, aspectHeight: 2 };
    layoutSingleWidget(w, 500, 500);
    assert.deepEqual([w.width, w.height], [90, 60]);
});

test("centring a child wider than its parent rounds toward zero", () => {
    const w: any = { rawX: 0, rawY: 0, rawWidth: 13, rawHeight: 13, xPositionMode: 1, yPositionMode: 1 };
    layoutSingleWidget(w, 10, 10);
    assert.deepEqual([w.x, w.y], [-1, -1]);
});

test("scroll is clamped to the scroll area on layout", () => {
    const list: any = { rawX: 0, rawY: 0, rawWidth: 100, rawHeight: 100, scrollHeight: 300, scrollY: 250, scrollX: 5, scrollWidth: 0 };
    layoutSingleWidget(list, 500, 500);
    assert.deepEqual([list.scrollY, list.scrollX], [200, 0]);
    list.rawHeight = 400;
    layoutSingleWidget(list, 500, 500);
    assert.equal(list.scrollY, 0, "a list taller than its content cannot stay scrolled");
});
