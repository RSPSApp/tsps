import assert from "node:assert/strict";
import { test } from "node:test";

import { IF1_TOOLTIP_DELAY, If1TooltipState, layoutIf1Tooltip } from "../widgets/gl/widgetsGl/if1Tooltip";

// Legacy tooltip components (type 8): the box appears after the mouse has rested on one for 50
// client cycles, below the component and inside the clip.

/** One draw pass per client cycle with the mouse on `uid` (or on nothing). */
function pass(state: If1TooltipState, cycle: number, uid: number | null, drawn: number[] = [7, 8]) {
    state.advance(cycle);
    for (const id of drawn) {
        if (id === uid) state.hover(id, cycle);
        else state.leave(id);
    }
}

test("the tooltip is shown only after 50 cycles on it", () => {
    const state = new If1TooltipState();
    let cycle = 100;
    pass(state, cycle, 7);
    for (let i = 0; i < IF1_TOOLTIP_DELAY - 1; i++) {
        pass(state, ++cycle, 7);
        assert.equal(state.isShown(7), false, `not yet shown after ${i + 1} cycles`);
    }
    pass(state, ++cycle, 7);
    assert.equal(state.timer, IF1_TOOLTIP_DELAY);
    assert.equal(state.isShown(7), true);
    assert.equal(state.isShown(8), false, "only the hovered tooltip is shown");
    pass(state, ++cycle, 7);
    assert.equal(state.timer, IF1_TOOLTIP_DELAY, "the timer stops at 50");
});

test("several draw passes in one cycle count once, and skipped cycles all count", () => {
    const state = new If1TooltipState();
    pass(state, 10, 7);
    pass(state, 11, 7);
    pass(state, 11, 7);
    pass(state, 11, 7);
    assert.equal(state.timer, 1);
    pass(state, 21, 7);
    assert.equal(state.timer, 11);
});

test("leaving hides the tooltip at once and the timer runs back down", () => {
    const state = new If1TooltipState();
    pass(state, 0, 7);
    pass(state, 60, 7);
    assert.equal(state.isShown(7), true);
    pass(state, 61, null);
    assert.equal(state.isShown(7), false);
    pass(state, 62, null);
    pass(state, 72, null);
    assert.equal(state.timer, 39);
    assert.equal(state.isActive(), true, "still counting down");
    pass(state, 200, null);
    assert.equal(state.timer, 0);
    assert.equal(state.isActive(), false);
});

test("moving to another tooltip does not restart the timer", () => {
    const state = new If1TooltipState();
    pass(state, 0, 7);
    pass(state, 60, 7);
    pass(state, 61, 8);
    assert.equal(state.isShown(7), false);
    assert.equal(state.isShown(8), true);
});

test("a tooltip that is no longer drawn stops counting", () => {
    const state = new If1TooltipState();
    pass(state, 0, 7);
    pass(state, 10, 7);
    assert.equal(state.timer, 10);
    // The interface closed: nothing reports the hover any more.
    pass(state, 11, null, []);
    pass(state, 15, null, []);
    assert.ok(state.timer < 11, "the timer no longer counts up");
    pass(state, 100, null, []);
    assert.equal(state.isActive(), false);
});

test("the box sits below the component, sized to its lines", () => {
    const measure = (line: string) => line.length * 5;
    // Two lines, the wider 11 characters: 55 + 6 wide, 2 * (12 + 1) + 7 tall.
    const box = layoutIf1Tooltip("Hello world<br>Bye", 100, 50, 80, 20, 765, 503, 12, measure);
    assert.deepEqual({ x: box.x, y: box.y, width: box.width, height: box.height }, { x: 114, y: 75, width: 61, height: 33 });
    assert.deepEqual(box.lines, [
        { text: "Hello world", x: 117, baseline: 89 },
        { text: "Bye", x: 117, baseline: 102 },
    ]);
});

test("the box stays right of the component's left edge and inside the clip", () => {
    const measure = (line: string) => line.length * 5;
    // Wider than the component: the left edge is the component's plus 5.
    const wide = layoutIf1Tooltip("A much longer tooltip line", 100, 50, 40, 20, 765, 503, 12, measure);
    assert.equal(wide.x, 105);
    // Against the right and bottom of the clip it is pushed back in.
    const edge = layoutIf1Tooltip("A much longer tooltip line", 700, 490, 40, 20, 765, 503, 12, measure);
    assert.equal(edge.x + edge.width, 765);
    assert.equal(edge.y + edge.height, 503);
    assert.equal(layoutIf1Tooltip("", 0, 0, 10, 10, 100, 100, 12, measure).lines.length, 0, "empty text has no lines");
});
