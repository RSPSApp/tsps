import type { Inventory } from "../../rs/inventory/Inventory";
import { markInvTransmit } from "../TransmitCycles";

/** Native UPDATE_INV_STOPTRANSMIT discards cached items and still notifies for unknown IDs. */
export function stopInventoryTransmit(inventories: Map<number, Inventory>, inventoryId: number): void {
    // Keep the browser's shared Inventory object: HUD/CS2 consumers retain its identity.
    // Empty slots have the same CS2 query results as an absent native container.
    inventories.get(inventoryId)?.clear();
    markInvTransmit(inventoryId & 0x7fff);
}
