import { ItemContainer } from "@runelite/api/Item";
import { ItemContainerChanged, WidgetLoaded } from "@runelite/api/events";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import type { OsrsClient } from "../../game/OsrsClient";
import type { Inventory, InventoryEvent } from "../../rs/inventory/Inventory";

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
 * Posts WidgetLoaded for every interface open, as RuneLite does: the widget manager's group loads
 * plus its re-mounts of a group that stayed loaded (a dialogue's next page). Returns the unbind function.
 */
export function bindWidgetEvents(client: OsrsClient, post: (event: object) => void): () => void {
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
