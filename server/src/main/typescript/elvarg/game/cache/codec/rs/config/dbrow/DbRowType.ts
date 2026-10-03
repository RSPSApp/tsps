import { ByteBuffer } from "../../io/ByteBuffer";

/** Script var types whose values are strings; every other type is a 4-byte int. */
const STRING_TYPES = new Set([36, 42]);

/**
 * A cache database row (config archive 38). Each column holds values as a flat list: one or
 * more tuples, each as long as the column's type list. Ported from the client's DbRowLoader.
 */
export class DbRowType {
    tableId = -1;
    readonly columns = new Map<number, Array<number | string>>();

    constructor(readonly id: number) {}

    /** A column's values, or an empty list when the row doesn't set it. */
    column(columnId: number): Array<number | string> {
        return this.columns.get(columnId) ?? [];
    }

    /** A column's first value as a number, or `fallback` when unset. */
    int(columnId: number, fallback = 0): number {
        const value = this.columns.get(columnId)?.[0];
        return typeof value === "number" ? value : fallback;
    }

    /** A column's first value as a string, or "" when unset. */
    string(columnId: number): string {
        const value = this.columns.get(columnId)?.[0];
        return typeof value === "string" ? value : "";
    }

    static decode(id: number, data: Int8Array): DbRowType {
        const row = new DbRowType(id);
        const buffer = new ByteBuffer(data);
        while (buffer.offset < data.length) {
            const opcode = buffer.readUnsignedByte();
            if (opcode === 0) break;
            if (opcode === 3) {
                buffer.readUnsignedByte(); // column count
                for (let column = buffer.readUnsignedByte(); column !== 255; column = buffer.readUnsignedByte()) {
                    const types: number[] = [];
                    for (let count = buffer.readUnsignedByte(); count > 0; count--) {
                        types.push(buffer.readUnsignedShortSmart());
                    }
                    const values: Array<number | string> = [];
                    for (let tuples = buffer.readUnsignedShortSmart(); tuples > 0; tuples--) {
                        for (const type of types) values.push(STRING_TYPES.has(type) ? buffer.readString() : buffer.readInt());
                    }
                    row.columns.set(column, values);
                }
            } else if (opcode === 4) {
                row.tableId = buffer.readVarInt2();
            } else {
                break; // an unknown opcode would misalign the rest
            }
        }
        return row;
    }
}
