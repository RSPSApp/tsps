import { ItemContainer } from "@runelite/api/Item";
import { ItemContainerChanged, WidgetLoaded } from "@runelite/api/events";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import type { OsrsClient } from "../../game/OsrsClient";
import type { Inventory, InventoryEvent } from "../../rs/inventory/Inventory";
import { bindDialogueChat } from "./DialogueChatSource";

/**
 * Posts ItemContainerChanged from the client's backpack (INV, 93) and worn equipment (WORN,
 * 94) stores: once for the current contents on binding (as RuneLite posts containers on login),
 * then on every slot or snapshot change. Slot selection posts nothing. Returns the unbind function.
 */
export function bindContainerEvents(client: OsrsClient, post: (event: object) => void): () => void {
    const stores: Array<[number, Inventory | undefined]> = [
        [InventoryID.INV, client.inventory],
        [InventoryID.WORN, client.equipment],
    ];
    const unsubscribers: Array<() => void> = [];
    for (const [id, store] of stores) {
        if (!store) continue;
        const container = new ItemContainer(id, store);
        unsubscribers.push(
            store.subscribe((event: InventoryEvent) => {
                if (event.type === "select") return;
                post(new ItemContainerChanged(id, container));
            }),
        );
    }
    return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
    };
}

/**
 * The event sources that read the widget manager (WidgetLoaded, dialogue pages as DIALOG chat).
 * `RuneLite.load()` runs from the OsrsClient constructor, before the widget manager exists, so
 * `bind()` does nothing until the client calls it again once the manager is created. Binding
 * twice is a no-op; `release()` unbinds.
 */
export class WidgetSourceBinder {
    private unbind?: () => void;

    constructor(
        private readonly client: Pick<OsrsClient, "widgetManager">,
        private readonly post: (event: object) => void,
    ) {}

    /** True when the sources are bound (now or already). */
    bind(): boolean {
        if (this.unbind) return true;
        if (!this.client.widgetManager) return false;
        const unbindWidgets = bindWidgetEvents(this.client, this.post);
        const unbindDialogue = bindDialogueChat(this.client, this.post);
        this.unbind = () => {
            unbindWidgets();
            unbindDialogue();
        };
        return true;
    }

    release(): void {
        this.unbind?.();
        this.unbind = undefined;
    }
}

/**
 * Posts WidgetLoaded for every interface open, as RuneLite does: the widget manager's group loads
 * plus its re-mounts of a group that stayed loaded (a dialogue's next page). Returns the unbind function.
 */
export function bindWidgetEvents(client: Pick<OsrsClient, "widgetManager">, post: (event: object) => void): () => void {
    const manager = client.widgetManager;
    const loaded = manager?.groupLoadedListeners;
    if (!loaded) return () => {};
    const remounted = manager.groupRemountedListeners;
    const listener = (groupId: number) => post(new WidgetLoaded(groupId | 0));
    loaded.add(listener);
    remounted?.add(listener);
    return () => {
        loaded.delete(listener);
        remounted?.delete(listener);
    };
}
