import {
    QUEST_LIST_STATUS_COMPLETE,
    QUEST_LIST_STATUS_IN_PROGRESS,
    type QuestListWidgetGroup,
} from "../../common/ui/questList";
import { layoutQuestScrollbarChildren } from "../../game/widgets/input/questListScrollbarInput";
import { FONT_BOLD_12, FONT_PLAIN_11, FONT_PLAIN_12 } from "../../ui/fonts";
import type { WidgetManager } from "../WidgetManager";
import type { WidgetNode } from "../WidgetNode";

const QUEST_LIST_GROUP_ID = 399;
const QUEST_LIST_LIST_CHILD_ID = 7;
const QUEST_LIST_TEXT_CONTAINER_CHILD_ID = 6;
const QUEST_LIST_SCROLLBAR_CHILD_ID = 5;

const QUEST_LIST_LIST_UID = (QUEST_LIST_GROUP_ID << 16) | QUEST_LIST_LIST_CHILD_ID;
const QUEST_LIST_TEXT_CONTAINER_UID =
    (QUEST_LIST_GROUP_ID << 16) | QUEST_LIST_TEXT_CONTAINER_CHILD_ID;
const QUEST_LIST_SCROLLBAR_UID = (QUEST_LIST_GROUP_ID << 16) | QUEST_LIST_SCROLLBAR_CHILD_ID;
/** 399:2, where script 4137 hangs script 1340 on ~210 quest varps to rebuild the list (2633). */
const QUEST_LIST_ROOT_UID = (QUEST_LIST_GROUP_ID << 16) | 2;
const QUEST_LIST_REBUILD_SCRIPT = 1340;

export function questListPreferences(vars: { getVarbit(id: number): number; getVarp(id: number): number }) {
    // CS2 2633/4181: colours are stored as RGB+1, zero selects the cache default.
    const color = (id: number, fallback: number) => {
        const stored = vars.getVarp(id);
        return stored > 0 ? stored - 1 : fallback;
    };
    return {
        largeText: vars.getVarbit(13780) === 1,
        textShadow: vars.getVarbit(13781) !== 1,
        colors: [color(3409, 0xffff00), color(3410, 0xff0000), color(3411, 901389), color(3412, 10461087)],
    };
}

const HEADER_HEIGHT = 18;
const HEADER_ADVANCE = 25;
const HEADER_Y_OFFSET = 7;
const ROW_LINE_HEIGHT = 11;
const ROW_PADDING = 5;
const ROW_HEIGHT = ROW_LINE_HEIGHT + ROW_PADDING;
const ROW_EXTRA_BOTTOM = 5;

const COLOR_HEADER = 0xff981f;
const COLOR_IN_PROGRESS = 0xffff00;
const COLOR_NOT_STARTED = 0xff0000;
const COLOR_COMPLETE = 0x00ff00;
const COLOR_HOVER = 0xffffff;

function resolveQuestColor(status: number): number {
    if ((status | 0) === 3) return 0x9fa09f;
    if ((status | 0) === QUEST_LIST_STATUS_COMPLETE) return COLOR_COMPLETE;
    if ((status | 0) === QUEST_LIST_STATUS_IN_PROGRESS) return COLOR_IN_PROGRESS;
    return COLOR_NOT_STARTED;
}

// Server content is rendered into fixed cache widgets, so bound and strip any
// markup from names/titles before they reach the text renderer.
const MAX_QUEST_TEXT_LENGTH = 80;

function boundedQuestText(value: unknown): string {
    return String(value ?? "")
        .replace(/[<>]/g, "")
        .slice(0, MAX_QUEST_TEXT_LENGTH);
}

function createDynamicTextWidget(
    widgetManager: WidgetManager,
    parent: WidgetNode,
    slot: number,
    overrides: Partial<WidgetNode>,
): WidgetNode {
    const uid = widgetManager.allocateDynamicUid(QUEST_LIST_GROUP_ID);
    return {
        uid,
        id: parent.uid,
        parentUid: parent.uid,
        groupId: parent.groupId,
        fileId: -1,
        type: 4,
        contentType: 0,
        childIndex: slot | 0,
        isIf3: true,
        hidden: false,
        isHidden: false,
        children: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rawX: 0,
        rawY: 0,
        rawWidth: 0,
        rawHeight: 0,
        widthMode: 0,
        heightMode: 0,
        xPositionMode: 0,
        yPositionMode: 0,
        scrollX: 0,
        scrollY: 0,
        scrollWidth: 0,
        scrollHeight: 0,
        itemId: -1,
        itemQuantity: 0,
        isDraggable: false,
        actions: [],
        rootIndex: -1,
        cycle: -1,
        modelFrame: 0,
        modelFrameCycle: 0,
        aspectWidth: 1,
        aspectHeight: 1,
        color: 0,
        textColor: 0,
        text: "",
        textShadow: true,
        textShadowed: true,
        fontId: FONT_PLAIN_11,
        xTextAlignment: 0,
        yTextAlignment: 1,
        lineHeight: 0,
        spriteId: -1,
        spriteId2: -1,
        params: new Map(),
        ...overrides,
    };
}

function clearDynamicChildren(widgetManager: WidgetManager, parent: WidgetNode): void {
    if (!Array.isArray(parent.children)) {
        parent.children = [];
        widgetManager.invalidateDynamicChildrenCache(parent);
        return;
    }

    for (const child of parent.children) {
        if (child) {
            widgetManager.unregisterWidgetTree(child);
        }
    }
    parent.children = [];
    widgetManager.invalidateDynamicChildrenCache(parent);
}

function registerChild(widgetManager: WidgetManager, parent: WidgetNode, child: WidgetNode): void {
    if (!Array.isArray(parent.children)) parent.children = [];
    const slot = Math.max(0, child.childIndex ?? 0);
    while (parent.children.length <= slot) parent.children.push(null);
    parent.children[slot] = child;
    widgetManager.registerWidget(child);
}

/**
 * Script 2633, rerun on every quest varp, measures the rows it builds itself. Under a server-owned
 * list it builds none, so it scrolled the list back to the top on every quest update. The server
 * sends the list again as quests progress, and that keeps the scroll position.
 */
function stopCacheListRebuilds(widgetManager: WidgetManager): void {
    const root = widgetManager.getWidgetByUid(QUEST_LIST_ROOT_UID);
    if (!root || root.onVarTransmit?.[0] !== QUEST_LIST_REBUILD_SCRIPT) return;
    root.onVarTransmit = undefined;
    root.varTransmitTriggers = undefined;
    if (root.eventHandlers) delete root.eventHandlers.onVarTransmit;
}

export function applyQuestListWidgetGroups(
    widgetManager: WidgetManager,
    groups: QuestListWidgetGroup[],
    preferences: { largeText?: boolean; textShadow?: boolean; colors?: readonly number[] } = {},
): void {
    const list = widgetManager.getWidgetByUid(QUEST_LIST_LIST_UID);
    if (!list) return;

    // The rows and scroll size are server content, so the cache's own quest
    // list script (2633) must not rebuild or resize them. The scrollbar stays
    // cache-owned: script 31 wired its dragger/arrows/wheel to scroll 399:6,
    // and those scripts need to find and move the dragger.
    widgetManager.setServerOwnedWidget(QUEST_LIST_LIST_UID, true);
    widgetManager.setServerOwnedWidget(QUEST_LIST_TEXT_CONTAINER_UID, true);
    widgetManager.setServerOwnedWidget(QUEST_LIST_SCROLLBAR_UID, false);
    stopCacheListRebuilds(widgetManager);
    clearDynamicChildren(widgetManager, list);

    let y = 0;
    const rowHeight = preferences.largeText ? 18 : ROW_HEIGHT;
    const lineHeight = preferences.largeText ? 13 : ROW_LINE_HEIGHT;
    for (const group of Array.isArray(groups) ? groups : []) {
        // One malformed group must not abort the list or skip the sizing below.
        try {
            const title = boundedQuestText(group.title).trim();
            const quests = Array.isArray(group.quests) ? group.quests : [];
            if (quests.length === 0) continue;

            if (title.length > 0) {
                const headerSlot = Math.max(0, (quests[0]?.slot ?? 1) - 1);
                registerChild(
                    widgetManager,
                    list,
                    createDynamicTextWidget(widgetManager, list, headerSlot, {
                        rawX: 0,
                        rawY: y + HEADER_Y_OFFSET,
                        rawWidth: 0,
                        rawHeight: HEADER_HEIGHT,
                        widthMode: 1,
                        heightMode: 0,
                        xPositionMode: 1,
                        yPositionMode: 0,
                        text: title,
                        fontId: FONT_BOLD_12,
                        textColor: COLOR_HEADER,
                        color: COLOR_HEADER,
                        xTextAlignment: 0,
                        yTextAlignment: 0,
                        actions: [],
                        textShadow: preferences.textShadow !== false,
                        textShadowed: preferences.textShadow !== false,
                    }),
                );
                y += HEADER_ADVANCE;
            }

            for (const quest of quests) {
                const color = preferences.colors?.[quest.status] ?? resolveQuestColor(quest.status);
                const rowText = boundedQuestText(quest.displayName);
                registerChild(
                    widgetManager,
                    list,
                    createDynamicTextWidget(widgetManager, list, quest.slot, {
                        rawX: 0,
                        rawY: y,
                        rawWidth: 0,
                        rawHeight: rowHeight,
                        widthMode: 1,
                        heightMode: 0,
                        xPositionMode: 1,
                        yPositionMode: 0,
                        text: rowText,
                        fontId: preferences.largeText ? FONT_PLAIN_12 : FONT_PLAIN_11,
                        textShadow: preferences.textShadow !== false,
                        textShadowed: preferences.textShadow !== false,
                        textColor: color,
                        color,
                        mouseOverColor: COLOR_HOVER,
                        xTextAlignment: 0,
                        yTextAlignment: 1,
                        lineHeight,
                        actions: ["", "Read journal:", "", "", "", "Pin journal:"],
                        opBase: `<col=ff9040>${rowText}</col>`,
                    }),
                );
                y += rowHeight;
            }
        } catch (error) {
            console.warn("[quest-list] skipping malformed group", error);
        }
    }

    // Same shape as the cache (script 2633): the text pane 399:6 is the
    // scrolling viewport and the list 399:7 inside it is as tall as its rows.
    const textContainer = widgetManager.getWidgetByUid(QUEST_LIST_TEXT_CONTAINER_UID);
    const view = textContainer ?? list;
    widgetManager.ensureLayout(view);
    const viewportHeight = Math.max(0, view.height | 0);
    const contentHeight = Math.max(viewportHeight, y + ROW_EXTRA_BOTTOM);
    if (textContainer) {
        list.heightMode = 0;
        list.rawHeight = contentHeight;
        list.height = contentHeight;
        list.scrollHeight = 0;
        list.scrollY = 0;
    }
    view.scrollHeight = contentHeight;
    view.scrollY = Math.min(view.scrollY | 0, Math.max(0, contentHeight - viewportHeight));
    widgetManager.invalidateWidget(view, "quest-list");

    const scrollbar = widgetManager.getWidgetByUid(QUEST_LIST_SCROLLBAR_UID);
    if (scrollbar) {
        (
            scrollbar as WidgetNode & { scrollBarTargetUid?: number; scrollBarAxis?: "y" }
        ).scrollBarTargetUid = view.uid;
        (
            scrollbar as WidgetNode & { scrollBarTargetUid?: number; scrollBarAxis?: "y" }
        ).scrollBarAxis = "y";
        scrollbar.isHidden = contentHeight <= viewportHeight;
        scrollbar.hidden = scrollbar.isHidden;
        widgetManager.ensureLayout(scrollbar);
        // Script 31 sized the dragger for the cache's own rows; resize it for
        // the rows the server just sent (what script 72 would do).
        layoutQuestScrollbarChildren(
            widgetManager,
            scrollbar,
            viewportHeight,
            contentHeight,
            view.scrollY | 0,
            scrollbar.height | 0,
        );
        widgetManager.invalidateWidget(scrollbar, "quest-list");
    }

    widgetManager.invalidateDynamicChildrenCache(list);
    widgetManager.invalidateWidget(list, "quest-list");
}
