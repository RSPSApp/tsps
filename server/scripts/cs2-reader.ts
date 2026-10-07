/** Reads a clientscript's instructions from the cache (for dump-cs2 and compare-cache). */
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";

export const SCONST = 3;
export const LCONST = 61;
export const SWITCH = 60;
const BYTE_OPERAND = new Set([21, 38, 39, 62, 63]); // return, pop_int/object/long, push_null

export interface ScriptHeader {
    name: string | null;
    opcodes: number;
    localInts: number;
    localObjs: number;
    localLongs: number;
    intArgs: number;
    objArgs: number;
    longArgs: number;
    switches: Map<number, number>[];
}

/** Revision 236 is the last whose scripts have no long local/argument counts. */
export const hasLongCounts = (revision: number) => revision !== 236 && revision >= 200;

export function readScript(data: Int8Array, longCounts: boolean): {
    header: ScriptHeader;
    instructions: Array<{ opcode: number; operand: number | string }>;
} {
    const buf = new ByteBuffer(data);
    buf.offset = buf.length - 2;
    const switchLength = buf.readUnsignedShort();
    const endIdx = buf.length - 2 - switchLength - (longCounts ? 16 : 12);
    buf.offset = endIdx;
    const opcodes = buf.readInt();
    const localInts = buf.readUnsignedShort();
    const localObjs = buf.readUnsignedShort();
    const localLongs = longCounts ? buf.readUnsignedShort() : 0;
    const intArgs = buf.readUnsignedShort();
    const objArgs = buf.readUnsignedShort();
    const longArgs = longCounts ? buf.readUnsignedShort() : 0;
    const switches: Map<number, number>[] = [];
    const numSwitches = buf.readUnsignedByte();
    for (let i = 0; i < numSwitches; ++i) {
        const m = new Map<number, number>();
        let count = buf.readUnsignedShort();
        while (count-- > 0) m.set(buf.readInt(), buf.readInt());
        switches.push(m);
    }
    buf.offset = 0;
    const name = buf.readNullString();
    const instructions: Array<{ opcode: number; operand: number | string }> = [];
    while (buf.offset < endIdx) {
        const opcode = buf.readUnsignedShort();
        let operand: number | string;
        if (opcode === SCONST) operand = buf.readString();
        else if (opcode === LCONST) operand = `${buf.readInt()}:${buf.readInt()}`;
        else if (BYTE_OPERAND.has(opcode)) operand = buf.readUnsignedByte();
        else operand = opcode < 100 ? buf.readInt() : buf.readUnsignedByte();
        instructions.push({ opcode, operand });
    }
    return {
        header: { name, opcodes, localInts, localObjs, localLongs, intArgs, objArgs, longArgs, switches },
        instructions,
    };
}
