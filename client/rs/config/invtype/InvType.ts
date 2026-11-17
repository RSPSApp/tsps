import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

/** The cache capacity is available before any items have been sent to this inventory. */
export class InvType extends Type {
    size = 0;

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 2) this.size = buffer.readUnsignedShort();
    }
}
