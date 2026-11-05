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
 * Binds a widget-manager source once the widget manager exists. `RuneLite.load()` runs from the
 * OsrsClient constructor, and the widget manager is created later in the async init, so a source
 * that needs it waits on client ticks until it appears. Returns the unbind function, which also
 * cancels the wait.
 */
export function bindWhenWidgetManagerReady(
    client: Pick<OsrsClient, "widgetManager">,
    bind: (client: Pick<OsrsClient, "widgetManager">) => () => void,
    onClientTick: (tick: () => void) => () => void,
): () => void {
    if (client.widgetManager) return bind(client);
    let unbind: (() => void) | undefined;
    const stopWaiting = onClientTick(() => {
        if (!client.widgetManager) return;
        stopWaiting();
        unbind = bind(client);
    });
    return () => {
        stopWaiting();
        unbind?.();
    };
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
