import { Mobile } from './Mobile';

/**
 * Binary min-heap of free slot indices. World slot indices are assigned
 * lowest-currently-free-first, matching how OSRS assigns entity indices
 * (used for update-block encoding, view-distance culling, etc). Processing
 * order is maintained separately by World and does not derive from this index.
 * A plain FIFO free-list would not give lowest-first allocation: once the
 * initial run of virgin slots is consumed, freed slots would only be reused
 * in the order they were freed rather than numeric order, so a long-uptime
 * world would just hand out ever-increasing indices instead of always
 * reusing the lowest free one.
 */
class SlotMinHeap {
    private heap: number[] = [];

    push(value: number): void {
        this.heap.push(value);
        let i = this.heap.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.heap[parent] <= this.heap[i]) break;
            [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
            i = parent;
        }
    }

    get size(): number {
        return this.heap.length;
    }

    shift(): number | undefined {
        if (this.heap.length === 0) return undefined;
        const top = this.heap[0];
        const last = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = last;
            let i = 0;
            const n = this.heap.length;
            while (true) {
                const left = i * 2 + 1;
                const right = i * 2 + 2;
                let smallest = i;
                if (left < n && this.heap[left] < this.heap[smallest]) smallest = left;
                if (right < n && this.heap[right] < this.heap[smallest]) smallest = right;
                if (smallest === i) break;
                [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
                i = smallest;
            }
        }
        return top;
    }
}

export class MobileList<E extends Mobile> implements Iterable<E> {
    private slotQueue: SlotMinHeap = new SlotMinHeap();
    private capacity: number;
    public characters: E[];
    private size: number;
    private onAdded?: (mobile: E) => void;
    private onRemoved?: (mobile: E) => void;
    /**
     * Slots freed this cycle, when the list holds them (`holdFreedSlots`): they go back to the free
     * heap at {@link releaseHeldSlots}, once every observer's update has sent the removal. Handed
     * straight to a mobile added the same cycle, the slot would reach a client as a removal and an
     * add of one index in one frame, which the RuneLite gateway (like OSRS for a jump or a type
     * change) takes as the old mobile changing, so it kept the old one's state (issue 6113).
     */
    private heldSlots: number[] | null;
    /**
     * The highest occupied slot, or 0. Slots are handed out lowest-free-first, so the live
     * mobiles sit in a short prefix of a capacity-sized array (a few thousand of the 65,535 NPC
     * slots); traversals stop here instead of stepping through every empty slot (issue 6036).
     */
    private highestSlot = 0;

    constructor(capacity: number, onAdded?: (mobile: E) => void, onRemoved?: (mobile: E) => void, { holdFreedSlots = false } = {}) {
        this.capacity = ++capacity;
        this.onAdded = onAdded;
        this.onRemoved = onRemoved;
        this.heldSlots = holdFreedSlots ? [] : null;
        // Pre-fill with null so iteration skips empty slots cleanly.
        this.characters = new Array(capacity).fill(null as any);
        this.size = 0;
        for (let i = 1; i <= (capacity - 1); i++) {
            this.slotQueue.push(i);
        }
    }

    /**
     * `bypassFullCheck` is for entities that must not consume a capped slot - player
     * bots on a browser host whose `isFull()` is overridden to cap humans. The slot
     * queue still bounds the list to its real capacity, so this cannot overflow it.
     */
    public add(e: E, bypassFullCheck = false): boolean {
        if (e === null) {
            return false;
        }

        if (!bypassFullCheck && this.isFull()) {
            return false;
        }

        if (!e.isRegistered()) {
            const index = this.slotQueue.shift();
            if (index !== undefined) {
                const previousIndex = e.getIndex();
                let counted = false;
                e.setRegistered(true);
                e.setIndex(index);
                this.characters[index] = e;
                if (index > this.highestSlot) this.highestSlot = index;
                try {
                    e.onAdd();
                    this.size++;
                    counted = true;
                    this.onAdded?.(e);
                    return true;
                } catch (registrationError) {
                    // onAdd can fail before size++ and onAdded can fail after it.
                    // Roll back only this allocation, never a replacement in its slot.
                    const rollbackErrors: unknown[] = [];
                    if (this.characters[index] === e) {
                        this.characters[index] = null as any;
                        this.lowerHighestSlot();
                        this.slotQueue.push(index);
                        if (counted) this.size--;
                        e.setRegistered(false);
                        // Try both hooks: a failed position-index cleanup must not
                        // skip the mobile's cancellation/logout cleanup (or vice versa).
                        try { this.onRemoved?.(e); } catch (error) { rollbackErrors.push(error); }
                        try { e.onRemove(); } catch (error) { rollbackErrors.push(error); }
                        e.setIndex(previousIndex);
                    }
                    if (rollbackErrors.length) {
                        throw Object.assign(new Error("Mobile registration and rollback hooks failed"), {
                            cause: registrationError, errors: [registrationError, ...rollbackErrors],
                        });
                    }
                    throw registrationError;
                }
            }
        }
        return false;
    }

    public removes(e: E): boolean {
        if (e === null) {
            return false;
        }

        if (e.isRegistered() && this.characters[e.getIndex()] != null) {
            e.setRegistered(false);
            this.characters[e.getIndex()] = null;
            this.lowerHighestSlot();
            this.freeSlot(e.getIndex());
            try {
                this.onRemoved?.(e);
                e.onRemove();
            } finally {
                // A throwing removal hook (for example a failed save on logout) must not
                // leave the list reporting a size it no longer holds or a leaked slot.
                this.size--;
            }
            return true;
        }
        return false;
    }

    private freeSlot(index: number): void {
        if (this.heldSlots) this.heldSlots.push(index);
        else this.slotQueue.push(index);
    }

    /** The slots freed since the last call become free for new mobiles (World calls it at the end of a cycle). */
    public releaseHeldSlots(): void {
        if (!this.heldSlots?.length) return;
        for (const index of this.heldSlots) this.slotQueue.push(index);
        this.heldSlots.length = 0;
    }

    /**
     * No slot is free now, only held ones: an add that fails for it can succeed once they are
     * released, so a queue should keep it rather than drop it.
     */
    public waitingOnHeldSlots(): boolean {
        return this.slotQueue.size === 0 && (this.heldSlots?.length ?? 0) > 0;
    }

    public contains(e: E): boolean {
        if (e === null) {
            return false;
        }
        return this.characters[e.getIndex()] != null;
    }

    /** Drops the high-water mark past slots that are now empty. */
    private lowerHighestSlot(): void {
        const characters = this.characters;
        let high = this.highestSlot;
        while (high > 0 && !characters[high]) high--;
        this.highestSlot = high;
    }

    /** The highest slot a traversal has to visit; live, so additions made during a traversal are seen. */
    public highestOccupiedSlot(): number {
        return this.highestSlot;
    }

    // forEach, search and the iterator visit slots in index order and read each slot when they
    // reach it, as the full-array loops they replace did: a mobile added at a higher slot during
    // the traversal is visited, one removed before its slot is reached is not.
    public forEach(action: (e: E) => void): void {
        const characters = this.characters;
        for (let i = 0; i <= this.highestSlot; i++) {
            const e = characters[i];
            if (e) action(e);
        }
    }

    public search(filter: (e: E) => boolean): E | null {
        const characters = this.characters;
        for (let i = 0; i <= this.highestSlot; i++) {
            const e = characters[i];
            if (e && filter(e)) return e;
        }
        return null;
    }

    public [Symbol.iterator](): IterableIterator<E> {
        return new MobileListIterator(this);
    }

    public get(slot: number): E {
        return this.characters[slot];
    }

    public sizeReturn(): number {
        return this.size;
    }

    public capacityReturn(): number {
        return this.capacity
    }

    public spaceLeft(): number {
        return this.capacity - this.size;
    }

    public isFull(): boolean {
        return this.size + 1 >= this.capacity;
    }

    public stream(): Array<E> {
        return this.characters;
    }

    public clear(): void {
        this.characters.forEach(this.remove);
        this.characters = [] as E[];
        this.highestSlot = 0;
        this.size = 0;
    }

    public remove(item: E): void {
        if (!item) {
            return;
        }
        if (item.isRegistered() && this.characters[item.getIndex()] != null) {
            item.setRegistered(false);
            this.characters[item.getIndex()] = null as any;
            this.lowerHighestSlot();
            this.freeSlot(item.getIndex());
            try {
                this.onRemoved?.(item);
                item.onRemove();
            } finally {
                // See removes(): keep the size honest when a removal hook throws.
                this.size--;
            }
        }
    }
}

/**
 * `for (const npc of World.getNpcs())`. It replaced a generator, which allocated a generator and
 * a fresh `{ value, done }` per mobile and stepped through every empty slot; with a few thousand
 * NPCs that was about half the server's garbage (issue 6036). This one steps only to the list's
 * high-water mark and returns the same result object from every `next()`. `for...of`, spread,
 * `Array.from` and destructuring read `value` before the next step, which is all the language
 * asks of a result; code that calls `next()` itself must not keep a result across calls.
 */
class MobileListIterator<E extends Mobile> implements IterableIterator<E> {
    private slot = -1;
    private readonly result: IteratorResult<E> = { value: undefined as any, done: false };

    constructor(private readonly list: MobileList<E>) {}

    public next(): IteratorResult<E> {
        const result = this.result;
        if (result.done) return result;
        const characters = this.list.characters;
        while (++this.slot <= this.list.highestOccupiedSlot()) {
            const e = characters[this.slot];
            if (e) {
                result.value = e;
                return result;
            }
        }
        result.value = undefined as any;
        result.done = true;
        return result;
    }

    public [Symbol.iterator](): IterableIterator<E> {
        return this;
    }
}

export class CharacterListIterator<E extends Mobile> implements Iterator<E> {
    private list: MobileList<E>;
    private index: number;
    private lastIndex: number = -1;

    constructor(list: MobileList<E>) {
        this.list = list;
    }

    public hasNext(): boolean {
        return !(this.index + 1 > this.list.capacityReturn());
    }

    public next(): IteratorResult<E> {
        if (this.index >= this.list.capacityReturn()) {
            throw new Error("There are no elements left to iterate over!");
        }
        this.lastIndex = this.index;
        this.index++;
        return { done: false, value: this.list.characters[this.lastIndex] };
    }

    public remove(): void {
        if (this.lastIndex == -1) {
            throw new Error("This method can only be " + "called once after \"next\".");
        }
        this.list.remove(this.list.characters[this.lastIndex]);
        this.lastIndex = -1;
    }
} 
