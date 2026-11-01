import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

/**
 * A sequence: the animation definition a loc's `seqId` or a spotanim's `animationId` names.
 * Frames live in their own archive, so a frame id is a number here, not a resolved definition.
 */
export class SequenceType extends Type {
    /** Frame ids, one per animation step. */
    frameIds: number[] = [];
    frameDelays: number[] = [];
    frameStep: number = -1;
    interleaveLeave: number[] = [];
    stretches: boolean = false;
    forcedPriority: number = 5;
    leftHandItem: number = -1;
    rightHandItem: number = -1;
    maxLoops: number = 99;
    precedenceAnimating: number = -1;
    priority: number = -1;
    replyMode: number = 2;
    chatFrameIds: number[] = [];
    debugName?: string;
    params?: Map<number, number | string>;

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        switch (opcode) {
            case 1: {
                const count = buffer.readUnsignedShort();
                this.frameDelays = Array.from({ length: count }, () => buffer.readUnsignedShort());
                const lows = Array.from({ length: count }, () => buffer.readUnsignedShort());
                this.frameIds = lows.map((low) => low + (buffer.readUnsignedShort() << 16));
                break;
            }
            case 2:
                this.frameStep = buffer.readUnsignedShort();
                break;
            case 3: {
                const count = buffer.readUnsignedByte();
                this.interleaveLeave = Array.from({ length: count + 1 }, (_, index) =>
                    index < count ? buffer.readUnsignedByte() : 0x98967f,
                );
                break;
            }
            case 4:
                this.stretches = true;
                break;
            case 5:
                this.forcedPriority = buffer.readUnsignedByte();
                break;
            case 6:
                this.leftHandItem = buffer.readUnsignedShort();
                break;
            case 7:
                this.rightHandItem = buffer.readUnsignedShort();
                break;
            case 8:
                this.maxLoops = buffer.readUnsignedByte();
                break;
            case 9:
                this.precedenceAnimating = buffer.readUnsignedByte();
                break;
            case 10:
                this.priority = buffer.readUnsignedByte();
                break;
            case 11:
                this.replyMode = buffer.readUnsignedByte();
                break;
            case 12: {
                const count = buffer.readUnsignedByte();
                const lows = Array.from({ length: count }, () => buffer.readUnsignedShort());
                this.chatFrameIds = lows.map((low) => low + (buffer.readUnsignedShort() << 16));
                break;
            }
            case 13:
                // Per-frame sounds. Kept opaque: the inspector reports the count, not a fake structure.
                for (let remaining = buffer.readUnsignedByte(); remaining > 0; remaining--) {
                    buffer.readUnsignedByte();
                    buffer.readUnsignedShort();
                    buffer.readUnsignedByte();
                    buffer.readUnsignedByte();
                }
                break;
            case 14: {
                const count = buffer.readUnsignedByte();
                this.interleaveLeave = Array.from({ length: count + 1 }, (_, index) =>
                    index < count ? buffer.readUnsignedByte() : 0x98967f,
                );
                break;
            }
            case 15:
                buffer.readUnsignedShort();
                break;
            case 16:
                buffer.readUnsignedByte();
                break;
            case 17:
                // Skeletal animation step; read and keep opaque.
                buffer.readUnsignedShort();
                buffer.readUnsignedByte();
                break;
            case 18:
                this.debugName = buffer.readString();
                break;
            case 249:
                this.params = Type.readParamsMap(buffer, this.params);
                break;
            default:
                throw new Error(`SequenceType: opcode ${opcode} not implemented. id: ${this.id}`);
        }
    }
}
