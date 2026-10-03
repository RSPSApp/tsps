import assert from "node:assert/strict";

import {
    computeQuestScrollbarGeometry,
    layoutQuestScrollbarChildren,
    processQuestListTouchScroll,
} from "../game/widgets/input/questListScrollbarInput";

const SCROLLBAR_UID = (399 << 16) | 5;
const VIEW_UID = (399 << 16) | 6;

type Child = {
    uid: number;
    parentUid: number;
    rawY: number;
    y: number;
    rawHeight: number;
    height: number;
    isLayoutValid?: boolean;
};

const makeChild = (index: number, y: number, height: number): Child => ({
    uid: (399 << 16) | (0x8000 + index),
    parentUid: SCROLLBAR_UID,
    rawY: y,
    y,
    rawHeight: height,
    height,
});

const scrollbar: any = {
    uid: SCROLLBAR_UID,
    x: 440,
    y: 0,
    _absX: 440,
    _absY: 0,
    width: 16,
    height: 551,
    hidden: false,
    isHidden: false,
    children: [makeChild(0, 0, 519), makeChild(1, 0, 0), makeChild(2, 0, 0), makeChild(3, 0, 0)],
};
const content: any = {
    uid: VIEW_UID,
    x: 0,
    y: 0,
    _absX: 0,
    _absY: 0,
    width: 434,
    height: 551,
    scrollHeight: 990,
    scrollY: 0,
};
const widgets = new Map<number, any>([
    [SCROLLBAR_UID, scrollbar],
    [VIEW_UID, content],
]);
const widgetManager: any = {
    getWidgetByUid: (uid: number) => widgets.get(uid),
    ensureLayout: () => {},
    invalidateWidget: () => {},
    invalidateScroll: () => {},
};

// Geometry mirrors cache script 72/740: dragger and its caps share the track.
const geometry = computeQuestScrollbarGeometry(551, 990, 0, 551);
assert.equal(geometry.trackHeight, 519);
assert.equal(geometry.thumbHeight, 288);
assert.equal(geometry.thumbOffset, 0);

const layoutAt = (scrollY: number) => {
    layoutQuestScrollbarChildren(widgetManager, scrollbar, 551, 990, scrollY, 551);
    return scrollbar.children.map((c: Child) => c.y);
};

assert.deepEqual(layoutAt(0), [0, 16, 16, 299]);
assert.deepEqual(layoutAt(439), [0, 247, 247, 530]);

// Touch: a one-finger drag is a camera orbit (button not held). Starting it
// on the list scrolls the list by the finger distance and eats the orbit.
let consumed = 0;
const input: any = {
    clickMode2: 0,
    isTouch: true,
    mouseWheelDown: true,
    consumeCameraDrag: () => consumed++,
};
const swipe = (my: number, hit: any) =>
    processQuestListTouchScroll({ input, mx: 200, my, hits: [hit] } as never, widgetManager);
const endSwipe = () => {
    input.mouseWheelDown = false;
    assert.equal(swipe(0, content), false);
    input.mouseWheelDown = true;
};

content.scrollY = 100;
assert.equal(swipe(300, content), true);
swipe(250, content);
assert.equal(content.scrollY, 150, "swiping up scrolls down by the finger distance");
swipe(260, content);
assert.equal(content.scrollY, 140);
assert.ok(consumed > 0, "the swipe does not also orbit the camera");
endSwipe();

// Swiping on the scrollbar moves the thumb with the finger.
content.scrollY = 0;
swipe(100, scrollbar);
swipe(120, scrollbar);
assert.equal(content.scrollY, 38, "thumb swipe scrolls by the equivalent track distance");
endSwipe();

// Scaled UI (HiDPI x2): pointer is canvas pixels, sizes are logical.
content._absHeight = 1102;
content.scrollY = 100;
swipe(600, content);
swipe(500, content);
assert.equal(content.scrollY, 150, "scaled swipe scrolls by logical distance");
endSwipe();
delete content._absHeight;

// Swipes that start elsewhere orbit the camera as usual.
content.scrollY = 0;
assert.equal(swipe(300, { uid: 1, parentUid: -1 }), false);
endSwipe();

// Mouse input is left to the cache scrollbar scripts.
input.isTouch = false;
assert.equal(swipe(300, content), false);

console.log("quest list scrollbar tests passed");
