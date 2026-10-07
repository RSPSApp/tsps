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

    private compare(a: any, b: any): number {
        if (this.valueType === "int") {
            return ((a as number) | 0) - ((b as number) | 0);
        }
        const sa = a == null ? "" : String(a);
        const sb = b == null ? "" : String(b);
        return sa.localeCompare(sb);
    }

    sortAllWith(optionalPair: Cs2ArrayObject | null): void {
        if (this._length <= 1) return;
        this.ensureWritable();
        if (optionalPair) {
            optionalPair.ensureWritable();
        }
        if (optionalPair && optionalPair._length < this._length) {
            throw new Error("RuntimeException");
        }
        const indices = new Array<number>(this._length);
        for (let i = 0; i < this._length; i++) indices[i] = i;
        indices.sort((a, b) => this.compare(this.values[a], this.values[b]));

        const sortedPrimary = new Array<any>(this._length);
        for (let i = 0; i < this._length; i++) {
            sortedPrimary[i] = this.values[indices[i]];
        }
        for (let i = 0; i < this._length; i++) {
            this.values[i] = sortedPrimary[i];
        }

        if (!optionalPair) return;
        const sortedPair = new Array<any>(this._length);
        for (let i = 0; i < this._length; i++) {
            sortedPair[i] = optionalPair.values[indices[i]];
        }
        for (let i = 0; i < this._length; i++) {
            optionalPair.values[i] = sortedPair[i];
        }
    }

    getArgMax(): number {
        if (this._length <= 0) return -1;
        let index = 0;
        for (let i = 1; i < this._length; i++) {
            if (this.compare(this.values[i], this.values[index]) > 0) {
                index = i;
            }
        }
        return index;
    }

    getArgMin(): number {
        if (this._length <= 0) return -1;
        let index = 0;
        for (let i = 1; i < this._length; i++) {
            if (this.compare(this.values[i], this.values[index]) < 0) {
                index = i;
            }
        }
        return index;
    }

    /** Sets `[start, end)` to first, first + 1, … (a negative bound means the array's edge). */
    fillSequence(first: number, start: number, end: number): void {
        this.ensureWritable();
        if (this.valueType !== "int") {
            throw new Error("RuntimeException");
        }
        const startIndex = start < 0 ? 0 : start;
        const endIndex = end < 0 || end > this._length ? this._length : end;
        for (let i = startIndex; i < endIndex; i++) {
            this.values[i] = (first + i - startIndex) | 0;
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

    /** array_fill: `value` into [start, end). */
    fill(value: any, start: number, end: number): void {
        this.ensureWritable();
        this.ensureType(value);
        const [from, to] = this.range(start, end);
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

    /** array_randomise: Collections.shuffle, `nextInt(bound)` from a java.util.Random. */
    shuffle(nextInt: (bound: number) => number): void {
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
