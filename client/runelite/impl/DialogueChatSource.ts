import { ChatMessageType } from "@runelite/api/ChatMessageType";
import { ChatMessage } from "@runelite/api/events";
import * as InterfaceID from "@runelite/api/gameval/InterfaceID";
import type { OsrsClient } from "../../game/OsrsClient";
import { subscribeTick } from "../../network/serverConnection/timing";

/** chat_left:name / chat_left:text and chat_right:name / chat_right:text in the cache. */
const NAME_CHILD = 4;
const TEXT_CHILD = 6;
const DIALOGUE_GROUPS = new Set([InterfaceID.CHAT_LEFT, InterfaceID.CHAT_RIGHT]);

type TickSubscriber = (tick: () => void) => () => void;

/**
 * Posts RuneLite's DIALOG chat message, "<name>|<text>", for each NPC (chat_left) or player
 * (chat_right) dialogue page. The group loads before its text arrives in the same tick, so the
 * page is read on the game tick after the load; a page loaded twice in a tick posts once, and a
 * missing or hidden text widget posts nothing. Returns the unbind function.
 */
export function bindDialogueChat(
    client: Pick<OsrsClient, "widgetManager">,
    post: (event: ChatMessage) => void,
    subscribe: TickSubscriber = (tick) => subscribeTick(tick),
): () => void {
    const manager = client.widgetManager;
    const listeners = manager?.groupLoadedListeners;
    if (!manager || !listeners) return () => {};
    // A dialogue's next page re-mounts the same group without reloading it.
    const remounted = manager.groupRemountedListeners;

    const pending = new Set<number>();
    const onGroupLoaded = (groupId: number) => {
        if (DIALOGUE_GROUPS.has(groupId | 0)) pending.add(groupId | 0);
    };
    const text = (group: number, child: number): string | undefined => {
        const widget: any = manager.getWidgetByUid((group << 16) | child);
        if (!widget || widget.isHidden === true || widget.hidden === true) return undefined;
        return typeof widget.text === "string" ? widget.text : undefined;
    };
    const onTick = () => {
        if (pending.size === 0) return;
        const groups = [...pending];
        pending.clear();
        for (const group of groups) {
            const name = text(group, NAME_CHILD);
            const line = text(group, TEXT_CHILD);
            if (name === undefined || line === undefined) continue;
            post(new ChatMessage(ChatMessageType.DIALOG, "", `${name}|${line}`, null));
        }
    };

    listeners.add(onGroupLoaded);
    remounted?.add(onGroupLoaded);
    const unsubscribeTick = subscribe(onTick);
    return () => {
        listeners.delete(onGroupLoaded);
        remounted?.delete(onGroupLoaded);
        unsubscribeTick();
        pending.clear();
    };
}
