import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";

/**
 * "Click through transparent chatbox": with a transparent chatbox in resizable mode, the
 * message area (its background and the chat lines) lets clicks reach the world, while the
 * tab buttons, the input line and the scrollbar still take them. A right-click there opens
 * the world's menu, with the options of the chat line under the mouse on top.
 */
const CHATBOX = 162;
/** chatbox:chat_background, whose no-click-through flag toplevel_chatbox_background sets. */
export const CHAT_BACKGROUND_UID = (CHATBOX << 16) | 37;
/** The scrolling message lines; each line is one of its children. */
export const CHAT_MESSAGES_UID = (CHATBOX << 16) | 59;
const CHATBOX_TRANSPARENCY_VARBIT = 4608;

/**
 * Whether the message area is click-through now. The cache script toplevel_chatbox_background
 * decides it from both settings and the layout and clears the background's no-click-through
 * flag, so that flag is the answer; the transparency varbit guards against a stale flag.
 */
export function isChatboxClickThroughActive(
    getVarbit: (id: number) => number,
    getWidgetByUid: (uid: number) => any,
): boolean {
    if ((getVarbit(CHATBOX_TRANSPARENCY_VARBIT) | 0) !== 1) return false;
    const background = getWidgetByUid(CHAT_BACKGROUND_UID);
    return !!background && !background.noClickThrough;
}

/** The chat background, the message list, or one of its lines. */
export function isChatMessageAreaWidget(widget: any): boolean {
    const uid = (widget?.uid ?? -1) | 0;
    if (uid === CHAT_BACKGROUND_UID || uid === CHAT_MESSAGES_UID) return true;
    return ((widget?.parentUid ?? -1) | 0) === CHAT_MESSAGES_UID;
}

/**
 * A chat line's menu entries, ready to sit in the world menu: no Cancel (the world menu has
 * its own), and each one run through the line's own menu state, which the world menu does
 * not share.
 */
export function asWorldMenuEntries(
    entries: SimpleMenuEntry[],
    invoke: (index: number, x?: number, y?: number, ctx?: any) => void,
): SimpleMenuEntry[] {
    return entries
        .filter((entry) => entry.option !== "Cancel")
        .map((entry): SimpleMenuEntry => {
            const index = entry.menuStateIndex;
            const onClick = entry.onClick;
            return {
                ...entry,
                menuStateIndex: undefined,
                onClick: (x, y, ctx) => {
                    if (typeof index === "number") invoke(index, x, y, ctx);
                    else onClick?.(x, y, ctx);
                },
            };
        });
}
