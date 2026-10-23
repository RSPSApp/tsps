export interface InventorySlot {
    slot: number;
    itemId: number;
    quantity: number;
}

export interface InventorySlotInput {
    slot: number;
    itemId: number;
    quantity?: number;
}

export type InventoryEvent =
    | { type: "snapshot"; slots: InventorySlot[]; selectedSlot: number | null }
    | { type: "slot"; slot: InventorySlot }
    | { type: "select"; slot: number | null };

export type InventoryListener = (event: InventoryEvent) => void;

function cloneSlot(slot: InventorySlot): InventorySlot {
    return { slot: slot.slot, itemId: slot.itemId, quantity: slot.quantity };
}

export class Inventory {
    static readonly changeListeners = new Set<(inventory: Inventory, event: InventoryEvent) => void>();
    static readonly SLOT_COUNT = 28;

    private readonly slots: InventorySlot[];
    private selectedSlot: number | null = null;
    private listeners: Set<InventoryListener> = new Set();

    /** Number of slots in this inventory */
    readonly capacity: number;

    constructor(slotCount: number = Inventory.SLOT_COUNT) {
        const count = Math.max(0, slotCount | 0);
        this.capacity = count;
        this.slots = Array.from({ length: count }, (_, index) => ({
            slot: index,
            itemId: -1,
            quantity: 0,
        }));
    }

    getSlots(): InventorySlot[] {
        return this.slots.map((slot) => cloneSlot(slot));
    }

    getSlot(index: number): InventorySlot | undefined {
        if (!this.isValidIndex(index)) return undefined;
        return cloneSlot(this.slots[index | 0]);
    }

    matchesSlot(index: number, itemId: number, quantity: number = 1): boolean {
        if (!this.isValidIndex(index)) return false;
        const current = this.slots[index | 0];
        const normalized = this.normalizeSlot(index, itemId, quantity);
        return current.itemId === normalized.itemId && current.quantity === normalized.quantity;
    }

    matchesSnapshot(entries: InventorySlotInput[]): boolean {
        const candidate = this.buildSnapshot(entries);
        for (let index = 0; index < this.slots.length; index++) {
            const current = this.slots[index];
            const incoming = candidate[index];
            if (current.itemId !== incoming.itemId || current.quantity !== incoming.quantity) {
                return false;
            }
        }
        return true;
    }

    snapshotSignature(entries?: InventorySlotInput[]): string {
        const snapshot = entries ? this.buildSnapshot(entries) : this.slots;
        return snapshot.map((slot) => `${slot.itemId}:${slot.quantity}`).join("|");
    }

    getSelectedSlot(): number | null {
        return this.selectedSlot;
    }

    setSelectedSlot(slot: number | null): void {
        const normalized = this.normalizeSelectedSlot(slot);
        if (this.selectedSlot === normalized) return;
        this.selectedSlot = normalized;
        this.emit({ type: "select", slot: this.selectedSlot });
    }

    setSlot(index: number, itemId: number, quantity: number = 1): InventorySlot {
        const slotIndex = this.requireValidIndex(index);
        const next = this.normalizeSlot(slotIndex, itemId, quantity);
        const current = this.slots[slotIndex];
        if (current.itemId === next.itemId && current.quantity === next.quantity) {
            return cloneSlot(current);
        }
        this.slots[slotIndex] = next;
        this.emit({ type: "slot", slot: cloneSlot(next) });
        if (next.itemId < 0 && this.selectedSlot === slotIndex) {
            this.setSelectedSlot(null);
        }
        return cloneSlot(next);
    }

    swapSlots(lhs: number, rhs: number): void {
        const idxA = this.requireValidIndex(lhs);
        const idxB = this.requireValidIndex(rhs);
        if (idxA === idxB) return;
        const a = this.slots[idxA];
        const b = this.slots[idxB];
        const nextA: InventorySlot = { slot: idxA, itemId: b.itemId, quantity: b.quantity };
        const nextB: InventorySlot = { slot: idxB, itemId: a.itemId, quantity: a.quantity };
        const changedA = a.itemId !== nextA.itemId || a.quantity !== nextA.quantity;
        const changedB = b.itemId !== nextB.itemId || b.quantity !== nextB.quantity;
        this.slots[idxA] = nextA;
        this.slots[idxB] = nextB;
        if (changedA) this.emit({ type: "slot", slot: cloneSlot(nextA) });
        if (changedB) this.emit({ type: "slot", slot: cloneSlot(nextB) });
        if (this.selectedSlot === idxA) {
            this.setSelectedSlot(idxB);
        } else if (this.selectedSlot === idxB) {
            this.setSelectedSlot(idxA);
        }
    }

    setSnapshot(entries: InventorySlotInput[], opts?: { selectedSlot?: number | null }): void {
        const fresh = this.buildSnapshot(entries);
        for (let i = 0; i < fresh.length; i++) this.slots[i] = fresh[i];
        this.selectedSlot = this.normalizeSelectedSlot(opts?.selectedSlot, true);
        this.emit({
            type: "snapshot",
            slots: fresh.map((slot) => cloneSlot(slot)),
            selectedSlot: this.selectedSlot,
        });
    }

    clear(): void {
        this.setSnapshot([], { selectedSlot: null });
    }

    firstEmptySlot(): number | undefined {
        const idx = this.slots.findIndex((slot) => slot.itemId < 0);
        return idx >= 0 ? idx : undefined;
    }

    findSlotWithItem(itemId: number): number | undefined {
        const idx = this.slots.findIndex((slot) => (slot.itemId | 0) === (itemId | 0));
        return idx >= 0 ? idx : undefined;
    }

    count(itemId: number): number {
        let total = 0;
        for (const slot of this.slots) {
            if ((slot.itemId | 0) === (itemId | 0)) {
                total += slot.quantity;
            }
        }
        return total;
    }

    subscribe(listener: InventoryListener): () => void {
        this.listeners.add(listener);
        listener({
            type: "snapshot",
            slots: this.getSlots(),
            selectedSlot: this.selectedSlot,
        });
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(event: InventoryEvent): void {
        if (event.type !== "select") for (const listener of Inventory.changeListeners) listener(this, event);
        for (const listener of this.listeners) {
            try {
                if (event.type === "snapshot") {
                    listener({
                        type: "snapshot",
                        slots: event.slots.map((slot) => cloneSlot(slot)),
                        selectedSlot: event.selectedSlot,
                    });
                } else if (event.type === "slot") {
                    listener({ type: "slot", slot: cloneSlot(event.slot) });
                } else {
                    listener({ type: "select", slot: event.slot });
                }
            } catch (err) {
                // Ignore listener errors to avoid breaking other subscribers
                console.warn("inventory listener error", err);
            }
        }
    }

    private isValidIndex(index: number): boolean {
        return Number.isInteger(index) && index >= 0 && index < this.slots.length;
    }

    private requireValidIndex(index: number): number {
        if (!this.isValidIndex(index)) {
            throw new RangeError(`Inventory slot index out of range: ${index}`);
        }
        return index | 0;
    }

    private normalizeSlot(index: number, itemId: number, quantity: number): InventorySlot {
        const normalizedId = itemId >= 0 ? itemId | 0 : -1;
        // Some containers (notably bank placeholders) can have an itemId with quantity 0.
        // Treat emptiness by itemId only; quantity 0 is still a valid occupied slot.
        const normalizedQuantity = normalizedId >= 0 ? Math.max(0, quantity | 0) : 0;
        return {
            slot: index | 0,
            itemId: normalizedId,
            quantity: normalizedQuantity,
        };
    }

    private buildSnapshot(entries: InventorySlotInput[]): InventorySlot[] {
        const snapshot = this.slots.map((_, index) => this.normalizeSlot(index, -1, 0));
        for (const entry of entries) {
            if (!this.isValidIndex(entry.slot)) continue;
            const index = entry.slot | 0;
            snapshot[index] = this.normalizeSlot(index, entry.itemId, entry.quantity ?? 1);
        }
        return snapshot;
    }

    private normalizeSelectedSlot(
        slot: number | null | undefined,
        allowEmpty: boolean = false,
    ): number | null {
        if (slot === null || slot === undefined) return null;
        if (!this.isValidIndex(slot)) return null;
        const idx = slot | 0;
        if (!allowEmpty && this.slots[idx].itemId < 0) return null;
        return idx;
    }
}
