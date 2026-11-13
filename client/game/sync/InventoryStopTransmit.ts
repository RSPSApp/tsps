import { Inventory } from "../../rs/inventory/Inventory";
import { markInvTransmit } from "../TransmitCycles";

/** The Inventory whose stop-transmit clear is running; retained copies skip that one clear. */
let stopping: Inventory | undefined;

/**
 * Native UPDATE_INV_STOPTRANSMIT discards cached items and still notifies for unknown IDs. The
 * native client unlinks the container, so `sent` (the ids RuneLite's getItemContainer answers
 * for) forgets it until the server sends it again.
 */
export function stopInventoryTransmit(inventories: Map<number, Inventory>, inventoryId: number, sent?: Set<number>): void {
    sent?.delete(inventoryId);
    // Keep the browser's shared Inventory object: HUD/CS2 consumers retain its identity.
    // Empty slots have the same CS2 query results as an absent native container.
    const inventory = inventories.get(inventoryId);
    stopping = inventory;
    try {
        inventory?.clear();
    } finally {
        stopping = undefined;
    }
    markInvTransmit(inventoryId & 0x7fff);
}

/**
 * A copy of `source` that follows every change except a stop-transmit clear. RuneLite plugins keep
 * the ItemContainer they were last given, so a closed bank still counts with its last contents.
 */
export function retainedInventory(source: Inventory): Inventory {
    const copy = new Inventory(source.capacity);
    source.subscribe((event) => {
        if (stopping === source) return;
        if (event.type === "snapshot") copy.setSnapshot(event.slots, { selectedSlot: null });
        else if (event.type === "slot") copy.setSlot(event.slot.slot, event.slot.itemId, event.slot.quantity);
    });
    return copy;
}
