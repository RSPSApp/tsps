export type Cs2ArrayValueType = "int" | "object";

export class Cs2ArrayObject {
    static readonly MAX_LENGTH = 5000;

    readonly valueType: Cs2ArrayValueType;
    readonly mutable: boolean;
    readonly defaultValue: any;

    private values: any[];
    private _length: number;

    constructor(
        valueType: Cs2ArrayValueType,
        defaultValue: any,
        length: number,
        capacity: number,
        mutable: boolean = true,
    ) {
        if (length < 0 || capacity < 0 || length > Cs2ArrayObject.MAX_LENGTH) {
            throw new Error("RuntimeException");
        }
        const cappedCapacity = Math.min(Math.max(length, capacity), Cs2ArrayObject.MAX_LENGTH);
        this.valueType = valueType;
        this.defaultValue = defaultValue;
        this.mutable = mutable;
        this._length = length;
        this.values = new Array(cappedCapacity).fill(defaultValue);
    }

    get length(): number {
        return this._length;
    }

    private checkIndex(index: number): void {
        if (index < 0 || index >= this._length) {
            throw new Error("RuntimeException");
        }
    }

    private ensureWritable(): void {
        if (!this.mutable) {
            throw new Error("RuntimeException");
        }
    }

    private ensureType(value: any): void {
        if (this.valueType === "int") {
            if (typeof value !== "number") {
                throw new Error("RuntimeException");
            }
        }
    }

    private ensureCapacity(required: number): void {
        if (required > Cs2ArrayObject.MAX_LENGTH) {
            throw new Error("RuntimeException");
        }
        if (required <= this.values.length) {
            return;
        }
        const grown = Math.min(
            Cs2ArrayObject.MAX_LENGTH,
            Math.max(required, this.values.length + Math.max(16, this.values.length >> 1)),
        );
        const oldLen = this.values.length;
        this.values.length = grown;
        for (let i = oldLen; i < grown; i++) {
            this.values[i] = this.defaultValue;
        }
    }

    getInt(index: number): number {
        if (this.valueType !== "int") {
            throw new Error("RuntimeException");
        }
        this.checkIndex(index);
        return (this.values[index] as number) | 0;
    }

    getObject(index: number): any {
        if (this.valueType !== "object") {
            throw new Error("RuntimeException");
        }
        this.checkIndex(index);
        return this.values[index];
    }

    setAt(index: number, value: any): void {
        this.ensureWritable();
        this.checkIndex(index);
        this.ensureType(value);
        this.values[index] = value;
    }

    insertAt(index: number, value: any): void {
        this.ensureWritable();
        if (index < 0 || index > this._length) {
            throw new Error("RuntimeException");
        }
        this.ensureType(value);
        this.ensureCapacity(this._length + 1);
        for (let i = this._length; i > index; i--) {
            this.values[i] = this.values[i - 1];
        }
        this.values[index] = value;
        this._length++;
    }

    /**
     * Sorts the first `high + 1` keys ascending, carrying `companion` (if any) along. Equal keys
     * end up in the order the OSRS client leaves them in, so this is its procedure step for step:
     * the middle element is the pivot and is parked at the end; each element left of it moves to
     * the low side when `goesLow(key, pivot, index)` holds; the pivot then lands between the two
     * sides, which are sorted the same way.
     */
    private static sortRange(
        keys: any[],
        companion: any[] | null,
        low: number,
        high: number,
        goesLow: (key: any, pivot: any, index: number) => boolean,
    ): void {
        if (low >= high) return;
        const middle = (low + high) >> 1;
        let store = low;
        const pivot = keys[middle];
        keys[middle] = keys[high];
        keys[high] = pivot;
        let pivotCompanion: any;
        if (companion) {
            pivotCompanion = companion[middle];
            companion[middle] = companion[high];
            companion[high] = pivotCompanion;
        }
        for (let i = low; i < high; i++) {
            if (!goesLow(keys[i], pivot, i)) continue;
            const key = keys[i];
            keys[i] = keys[store];
            keys[store] = key;
            if (companion) {
                const held = companion[i];
                companion[i] = companion[store];
                companion[store] = held;
            }
            store++;
        }
        keys[high] = keys[store];
        keys[store] = pivot;
        if (companion) {
            companion[high] = companion[store];
            companion[store] = pivotCompanion;
        }
        Cs2ArrayObject.sortRange(keys, companion, low, store - 1, goesLow);
        Cs2ArrayObject.sortRange(keys, companion, store + 1, high, goesLow);
    }

    /**
     * An int goes low when it is below the pivot; one equal to the pivot goes low too at an odd
     * index (never when the pivot is the largest int).
     */
    private static intGoesLow(key: number, pivot: number, index: number): boolean {
        const tie = pivot === 2147483647 ? 0 : index & 1;
        return (key | 0) < (pivot | 0) + tie;
    }

    /**
     * Strings order by their UTF-16 code units, as Java's String.compareTo does (not by
     * locale). One equal to the pivot goes low at an odd index. A null pivot sends everything
     * low; a null key otherwise stays high.
     */
    private static stringGoesLow(key: any, pivot: any, index: number): boolean {
        if (pivot == null) return true;
        if (key == null) return false;
        return key < pivot || ((index & 1) === 1 && key === pivot);
    }

    /** array_sort: sorts this array, moving `optionalPair`'s values with their keys. */
    sortAllWith(optionalPair: Cs2ArrayObject | null): void {
        if (this._length <= 1) return;
        this.ensureWritable();
        if (optionalPair) {
            optionalPair.ensureWritable();
        }
        if (optionalPair && optionalPair._length < this._length) {
            throw new Error("RuntimeException");
        }
        const high = this._length - 1;
        if (this.valueType === "int") {
            Cs2ArrayObject.sortRange(this.values, optionalPair?.values ?? null, 0, high, Cs2ArrayObject.intGoesLow);
            return;
        }
        if (optionalPair) {
            Cs2ArrayObject.sortRange(this.values, optionalPair.values, 0, high, Cs2ArrayObject.stringGoesLow);
            return;
        }
        // Strings on their own: a plain ascending sort (equal strings cannot be told apart), and
        // a null among them is an error.
        const sorted = this.values.slice(0, this._length);
        if (sorted.some((value) => value == null)) {
            throw new Error("RuntimeException");
        }
        sorted.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        for (let i = 0; i < this._length; i++) this.values[i] = sorted[i];
    }

    /**
     * array_max / array_min: the index of the first largest (smallest) value, -1 when empty.
     * Strings compare by code unit; a null is never picked over the first value, and comparing
     * against a null first value is an error.
     */
    private argExtreme(sign: 1 | -1): number {
        let index = -1;
        for (let i = 0; i < this._length; i++) {
            if (index === -1) {
                index = i;
                continue;
            }
            const value = this.values[i];
            const best = this.values[index];
            if (this.valueType === "int") {
                if (sign > 0 ? (value | 0) > (best | 0) : (value | 0) < (best | 0)) index = i;
                continue;
            }
            if (value == null) continue;
            if (best == null) throw new Error("RuntimeException");
            if (sign > 0 ? value > best : value < best) index = i;
        }
        return index;
    }

    getArgMax(): number {
        return this.argExtreme(1);
    }

    getArgMin(): number {
        return this.argExtreme(-1);
    }

    /**
     * The slots a (start, count) pair covers: a negative start is 0, and a negative count or
     * one that runs past the end stops at the array's end, so (0, -1) is the whole array.
     */
    private countedRange(start: number, count: number): [number, number] {
        const from = start < 0 ? 0 : start;
        const end = (from + count) | 0;
        return [from, count < 0 || end < 0 || end > this._length ? this._length : end];
    }

    /** array_generaterange: first, first + 1, ... into `count` slots from `start`. */
    fillSequence(first: number, start: number, count: number): void {
        this.ensureWritable();
        if (this.valueType !== "int") {
            throw new Error("RuntimeException");
        }
        const [from, to] = this.countedRange(start, count);
        for (let i = from; i < to; i++) {
            this.values[i] = (first + i - from) | 0;
        }
    }

    countMatches(value: any, start: number, end: number): number {
        const startIndex = start < 0 ? 0 : start;
        const endIndex = end < 0 || end > this._length ? this._length : end;
        let matches = 0;
        if (this.valueType === "int") {
            const target = (value as number) | 0;
            for (let i = startIndex; i < endIndex; i++) {
                if (((this.values[i] as number) | 0) === target) {
                    matches++;
                }
            }
            return matches;
        }
        for (let i = startIndex; i < endIndex; i++) {
            if (this.values[i] === value) {
                matches++;
            }
        }
        return matches;
    }

    /** The value at `index`, whatever the array's type. */
    getRaw(index: number): any {
        this.checkIndex(index);
        return this.values[index];
    }

    private range(start: number, end: number): [number, number] {
        return [start < 0 ? 0 : start, end < 0 || end > this._length ? this._length : end];
    }

    private same(a: any, b: any): boolean {
        return this.valueType === "int" ? ((a as number) | 0) === ((b as number) | 0) : a === b;
    }

    /** array_indexof: the first index in [start, end) holding `value`, or -1. */
    indexOf(value: any, start: number, end: number): number {
        const [from, to] = this.range(start, end);
        for (let i = from; i < to; i++) if (this.same(this.values[i], value)) return i;
        return -1;
    }

    /** array_fill: `value` into `count` slots from `start`; a start past the end is an error. */
    fill(value: any, start: number, count: number): void {
        this.ensureWritable();
        this.ensureType(value);
        const [from, to] = this.countedRange(start, count);
        if (from > to) throw new Error("RuntimeException");
        for (let i = from; i < to; i++) this.values[i] = value;
    }

    reverse(): void {
        this.ensureWritable();
        for (let i = 0, j = this._length - 1; i < j; i++, j--) {
            const held = this.values[i];
            this.values[i] = this.values[j];
            this.values[j] = held;
        }
    }

    /** array_resize: a new length; new slots take the default value. */
    resize(length: number): void {
        this.ensureWritable();
        if (length < 0) throw new Error("RuntimeException");
        this.ensureCapacity(length);
        for (let i = this._length; i < length; i++) this.values[i] = this.defaultValue;
        this._length = length;
    }

    /** array_randomise: a swap per slot from the end, `nextInt(bound)` from a java.util.Random. */
    shuffle(nextInt: (bound: number) => number): void {
        if (this._length <= 1) return;
        this.ensureWritable();
        for (let i = this._length - 1; i > 0; i--) {
            const j = nextInt(i + 1);
            const held = this.values[i];
            this.values[i] = this.values[j];
            this.values[j] = held;
        }
    }

    push(value: any): void {
        this.insertAt(this._length, value);
    }

    /** array_delete: removes and returns the value at `index`. */
    deleteAt(index: number): any {
        this.ensureWritable();
        this.checkIndex(index);
        const removed = this.values[index];
        for (let i = index; i < this._length - 1; i++) this.values[i] = this.values[i + 1];
        this._length--;
        this.values[this._length] = this.defaultValue;
        return removed;
    }

    getAtOrDefault(index: number): any {
        if (index < 0 || index >= this._length) {
            return this.valueType === "int" ? -1 : "";
        }
        const value = this.values[index];
        if (this.valueType === "int") {
            return (value as number) | 0;
        }
        return value ?? "";
    }

    join(separator: string): string {
        if (this.valueType !== "object") {
            throw new Error("RuntimeException");
        }
        const parts = new Array<string>(this._length);
        for (let i = 0; i < this._length; i++) {
            const value = this.values[i];
            parts[i] = value == null ? "" : String(value);
        }
        return parts.join(separator);
    }
}

export function createTypedArrayFromCode(
    typeCode: number,
    length: number,
    capacity: number = length,
): Cs2ArrayObject {
    if (length < 0 || length > Cs2ArrayObject.MAX_LENGTH) {
        throw new Error("RuntimeException");
    }
    if (capacity < length) {
        capacity = length;
    }
    if (capacity > Cs2ArrayObject.MAX_LENGTH) {
        throw new Error("RuntimeException");
    }
    if (typeCode === 115) {
        return new Cs2ArrayObject("object", "", length, capacity, true);
    }
    if (typeCode === 105 || typeCode === 49) {
        return new Cs2ArrayObject("int", 0, length, capacity, true);
    }
    return new Cs2ArrayObject("int", -1, length, capacity, true);
}

export function isCs2ArrayObject(value: any): value is Cs2ArrayObject {
    return value instanceof Cs2ArrayObject;
}

export function requireCs2ArrayObject(value: any): Cs2ArrayObject {
    if (!isCs2ArrayObject(value)) {
        throw new Error("RuntimeException");
    }
    return value;
}

export function popTypedValue(typeCode: number, intPop: () => number, objPop: () => any): any {
    if (typeCode === 2 || typeCode === 115) {
        return objPop();
    }
    if (typeCode === 0 || typeCode === 49 || typeCode === 105) {
        return intPop();
    }
    if (typeCode === -1) {
        return null;
    }
    throw new Error("RuntimeException");
}
