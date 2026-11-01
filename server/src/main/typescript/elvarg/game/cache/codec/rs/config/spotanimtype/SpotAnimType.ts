import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

/** A graphic: what a spell, an emote or a loc effect plays. Links to a model and a sequence. */
export class SpotAnimType extends Type {
    modelId: number = 0;
    animationId: number = -1;
    resizeX: number = 128;
    resizeY: number = 128;
    rotation: number = 0;
    ambient: number = 0;
    contrast: number = 0;
    rotate: boolean = false;
    recolAll: number = -1;
    /** Model recolours, as `[from, to]` pairs. */
    recolorFrom: number[] = [];
    recolorTo: number[] = [];
    retextureFrom: number[] = [];
    retextureTo: number[] = [];
    debugName?: string;

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        switch (opcode) {
            case 1:
                this.modelId = buffer.readUnsignedShort();
                break;
            case 2:
                this.animationId = buffer.readUnsignedShort();
                break;
            case 3:
                this.modelId = buffer.readInt();
                break;
            case 4:
                this.resizeX = buffer.readUnsignedShort();
                break;
            case 5:
                this.resizeY = buffer.readUnsignedShort();
                break;
            case 6:
                this.rotation = buffer.readUnsignedShort();
                break;
            case 7:
                this.ambient = buffer.readUnsignedByte();
                break;
            case 8:
                this.contrast = buffer.readUnsignedByte();
                break;
            case 9:
                this.debugName = buffer.readString();
                break;
            case 10:
                this.rotate = true;
                break;
            case 40: {
                const count = buffer.readUnsignedByte();
                for (let index = 0; index < count; index++) {
                    this.recolorFrom.push(buffer.readUnsignedShort());
                    this.recolorTo.push(buffer.readUnsignedShort());
                }
                break;
            }
            case 41: {
                const count = buffer.readUnsignedByte();
                for (let index = 0; index < count; index++) {
                    this.retextureFrom.push(buffer.readUnsignedShort());
                    this.retextureTo.push(buffer.readUnsignedShort());
                }
                break;
            }
            case 42:
                this.recolAll = buffer.readUnsignedShort();
                break;
            default:
                throw new Error(`SpotAnimType: opcode ${opcode} not implemented. id: ${this.id}`);
        }
    }
}
