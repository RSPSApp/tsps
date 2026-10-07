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

    constructor(capacity: number, onAdded?: (mobile: E) => void, onRemoved?: (mobile: E) => void) {
        this.capacity = ++capacity;
        this.onAdded = onAdded;
        this.onRemoved = onRemoved;
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
            let index = this.slotQueue.shift();
            if (index !== undefined) {
              e.setRegistered(true);
              e.setIndex(index);
              this.characters[index] = e;
              e.onAdd();
              this.size++;
              this.onAdded?.(e);
              return true;
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
            this.slotQueue.push(e.getIndex());
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

    public contains(e: E): boolean {
        if (e === null) {
            return false;
        }
        return this.characters[e.getIndex()] != null;
    }

    public forEach(action: (e: E) => void): void {
        for (let e of this.characters) {
            if (!e) {
                continue;
            }
            action(e);
        }
    }

    public search(filter: (e: E) => boolean): E | null {
        for (let e of this.characters) {
            if (e === null)
                continue;
            if (filter(e))
                return e;
        }
        return null;
    }

    public * [Symbol.iterator](): IterableIterator<E> {
        for (let e of this.characters) {
            if (e === null) {
                continue;
            }
            yield e;
        }
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
        this.size = 0;
    }

    public remove(item: E): void {
        if (!item) {
            return;
        }
        if (item.isRegistered() && this.characters[item.getIndex()] != null) {
            item.setRegistered(false);
            this.characters[item.getIndex()] = null as any;
            this.slotQueue.push(item.getIndex());
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
