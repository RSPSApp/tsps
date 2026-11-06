import type { Inventory } from "../../rs/inventory/Inventory";

/** An item stack in a container (RuneLite's Item): id -1 and quantity 0 for an empty slot. */
export class Item {
    constructor(
        private readonly id: number,
        private readonly quantity: number,
    ) {}

    getId(): number {
        return this.id;
    }

    getQuantity(): number {
        return this.quantity;
    }
}

/**
 * A live view of one of the client's inventories (RuneLite's ItemContainer). `getItems()` is
 * slot-indexed, one Item per slot, as RuneLite's array is.
 */
export class ItemContainer {
    constructor(
        private readonly id: number,
        private readonly store: Inventory,
    ) {}

    getId(): number {
        return this.id;
    }

    getItems(): Item[] {
        return this.store.getSlots().map((slot) => (slot.itemId >= 0 ? new Item(slot.itemId, slot.quantity) : new Item(-1, 0)));
    }

    /** The item in a slot, or null past the container's size. */
    getItem(slot: number): Item | null {
        const found = this.store.getSlot(slot);
        if (!found) return null;
        return found.itemId >= 0 ? new Item(found.itemId, found.quantity) : null;
    }

    contains(itemId: number): boolean {
        return this.store.findSlotWithItem(itemId) !== undefined;
    }

    /** The total quantity of an item across every slot. */
    count(itemId: number): number {
        return this.store.count(itemId);
    }

    size(): number {
        return this.store.capacity;
    }
}
