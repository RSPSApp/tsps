import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

export class VarcIntType extends Type {
    persist: boolean = false;
    /** Rev 231+: the varc holds an array of this type (a ScriptVarType id), or -1. */
    arrayType: number = -1;

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 2) {
            this.persist = true;
        } else if (opcode === 3) {
            this.arrayType = buffer.readUnsignedShort();
        }
    }
}
