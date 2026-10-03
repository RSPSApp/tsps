import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetInputFrame } from "./widgetInputTypes";

const QUEST_LIST_GROUP_ID = 399;
const QUEST_LIST_SCROLLBAR_UID = (QUEST_LIST_GROUP_ID << 16) | 5;
// The text pane is the scrolling viewport; script 31 wired the scrollbar to it.
const QUEST_LIST_VIEW_UID = (QUEST_LIST_GROUP_ID << 16) | 6;

const ARROW_HEIGHT = 16;
const CAP_HEIGHT = 5;
const MIN_THUMB_HEIGHT = 10;

type ScrollbarChildren = {
    children?: Array<{
        rawY?: number;
        y?: number;
        rawHeight?: number;
        height?: number;
        isLayoutValid?: boolean;
    } | null> | null;
};

function clampScrollY(value: number, maximum: number): number {
    return Math.min(Math.max(0, value | 0), maximum);
}

export type QuestScrollbarGeometry = {
    trackHeight: number;
    thumbHeight: number;
    maxThumbOffset: number;
    thumbOffset: number;
};

export function computeQuestScrollbarGeometry(
    viewportHeight: number,
    contentHeight: number,
    scrollY: number,
    scrollbarHeight: number,
): QuestScrollbarGeometry {
    const trackHeight = Math.max(0, scrollbarHeight - ARROW_HEIGHT * 2);
    const thumbHeight = Math.max(
        MIN_THUMB_HEIGHT,
        Math.floor((viewportHeight * trackHeight) / Math.max(1, contentHeight)),
    );
    const maxScrollY = Math.max(0, contentHeight - viewportHeight);
    const maxThumbOffset = Math.max(0, trackHeight - thumbHeight);
    const thumbOffset =
        maxScrollY > 0 ? Math.floor((maxThumbOffset * scrollY) / maxScrollY) : 0;
    return { trackHeight, thumbHeight, maxThumbOffset, thumbOffset };
}

/**
 * Positions the dragger (child 1) and its top/bottom caps (children 2/3) the
 * same way the cache's scrollbar refresh script (740) does. The caps are
 * separate widgets anchored to the dragger, so moving the dragger alone leaves
 * a detached cap behind - the "doubled" scrollbar.
 */
export function layoutQuestScrollbarChildren(
    widgetManager: WidgetManager,
    scrollbar: ScrollbarChildren,
    viewportHeight: number,
    contentHeight: number,
    scrollY: number,
    scrollbarHeight: number,
): void {
    const children = scrollbar.children;
    const thumb = children?.[1];
    if (!thumb) return;

    const { thumbHeight, thumbOffset } = computeQuestScrollbarGeometry(
        viewportHeight,
        contentHeight,
        scrollY,
        scrollbarHeight,
    );
    const thumbY = ARROW_HEIGHT + thumbOffset;

    thumb.rawY = thumbY;
    thumb.y = thumbY;
    thumb.rawHeight = thumbHeight;
    thumb.height = thumbHeight;
    thumb.isLayoutValid = true;
    widgetManager.invalidateWidget(thumb as never, "quest-list-scrollbar-thumb");

    const topCap = children?.[2];
    if (topCap) {
        topCap.rawY = thumbY;
        topCap.y = thumbY;
        topCap.rawHeight = CAP_HEIGHT;
        topCap.height = CAP_HEIGHT;
        topCap.isLayoutValid = true;
        widgetManager.invalidateWidget(topCap as never, "quest-list-scrollbar-cap");
    }

    const bottomCap = children?.[3];
    if (bottomCap) {
        const capY = thumbY + thumbHeight - CAP_HEIGHT;
        bottomCap.rawY = capY;
        bottomCap.y = capY;
        bottomCap.rawHeight = CAP_HEIGHT;
        bottomCap.height = CAP_HEIGHT;
        bottomCap.isLayoutValid = true;
        widgetManager.invalidateWidget(bottomCap as never, "quest-list-scrollbar-cap");
    }
}

// Touch swipe state, anchored to where the swipe started so nothing accumulates.
let touchDrag: { mode: "list" | "thumb"; startY: number; startScrollY: number } | null = null;

/**
 * Mouse drag, arrows and wheel on the quest list go through the cache's own
 * scrollbar scripts (31/35/36/37). Touch has no held-button drag (a one-finger
 * drag orbits the camera), so a swipe that starts on the list or its scrollbar
 * scrolls the list instead. Returns true while it owns the swipe.
 */
export function processQuestListTouchScroll(
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
): boolean {
    const { input, hits } = frame;
    if (!input.isTouch || !input.mouseWheelDown) {
        touchDrag = null;
        return false;
    }

    const view = widgetManager.getWidgetByUid(QUEST_LIST_VIEW_UID);
    const scrollbar = widgetManager.getWidgetByUid(QUEST_LIST_SCROLLBAR_UID);
    if (!view) return false;
    widgetManager.ensureLayout(view);
    if (scrollbar) widgetManager.ensureLayout(scrollbar);

    const viewportHeight = Math.max(0, view.height | 0);
    const contentHeight = Math.max(viewportHeight, view.scrollHeight | 0);
    const maxScrollY = contentHeight - viewportHeight;
    if (maxScrollY <= 0) return false;

    // The pointer is in canvas pixels, sizes are logical (scaled UI / HiDPI).
    const absHeight = (view as { _absHeight?: number })._absHeight ?? 0;
    const scaleY = absHeight > 0 && viewportHeight > 0 ? absHeight / viewportHeight : 1;
    const my = frame.my / scaleY;
    const scrollbarHeight = Math.max(0, (scrollbar?.height ?? 0) | 0);

    if (!touchDrag) {
        const hitIncludes = (uid: number): boolean => {
            for (const hit of hits ?? []) {
                let current: { uid?: number; parentUid?: number } | undefined = hit;
                for (let depth = 0; current && depth < 16; depth++) {
                    if ((current.uid ?? -1) === uid) return true;
                    const parentUid = current.parentUid;
                    if (typeof parentUid !== "number" || parentUid < 0) break;
                    current = widgetManager.getWidgetByUid(parentUid);
                }
            }
            return false;
        };
        const overScrollbar =
            !!scrollbar && !scrollbar.hidden && !scrollbar.isHidden && hitIncludes(scrollbar.uid);
        if (!overScrollbar && !hitIncludes(view.uid)) return false;
        touchDrag = { mode: overScrollbar ? "thumb" : "list", startY: my, startScrollY: view.scrollY | 0 };
    }

    const dy = my - touchDrag.startY;
    let next = touchDrag.startScrollY - dy;
    if (touchDrag.mode === "thumb") {
        const { maxThumbOffset } = computeQuestScrollbarGeometry(
            viewportHeight,
            contentHeight,
            0,
            scrollbarHeight,
        );
        next = touchDrag.startScrollY + (maxThumbOffset > 0 ? (dy * maxScrollY) / maxThumbOffset : 0);
    }
    next = clampScrollY(next, maxScrollY);
    if ((view.scrollY | 0) !== next) {
        view.scrollY = next;
        widgetManager.invalidateScroll(view);
        if (scrollbar) {
            layoutQuestScrollbarChildren(
                widgetManager,
                scrollbar,
                viewportHeight,
                contentHeight,
                next,
                scrollbarHeight,
            );
            widgetManager.invalidateWidget(scrollbar, "quest-list-scroll");
        }
    }
    input.consumeCameraDrag();
    return true;
}
