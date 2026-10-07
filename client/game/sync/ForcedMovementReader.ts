import { BitStream } from "./BitStream";
import type { ForcedMovementUpdate } from "./PlayerSyncTypes";

function toSignedByte(value: number): number {
    return value > 127 ? value - 256 : value;
}

/**
 * Reads a forced-movement block (players' exact move, and NPCs' exact_move): the start and end
 * tiles relative to the actor, the cycles they are reached at (after `cycleBase`), and the
 * orientation to face.
 */
export function readForcedMovement(stream: BitStream, cycleBase: number): ForcedMovementUpdate {
    const startDX = toSignedByte(stream.readUnsignedByteS()); // readByteSub
    const startDY = stream.readByte() | 0; // readByte
    const endDX = stream.readByte() | 0; // readByte
    const endDY = toSignedByte(stream.readUnsignedByteA()); // readByteAdd
    const startCycle = (cycleBase + (stream.readUnsignedShortBEA() | 0)) | 0; // readUnsignedShortAdd
    const endCycle = (cycleBase + (stream.readUnsignedShortBE() | 0)) | 0; // readUnsignedShort
    const direction = stream.readUnsignedShortLEA() | 0; // readUnsignedShortAddLE
    return {
        startDeltaX: startDX,
        startDeltaY: startDY,
        endDeltaX: endDX,
        endDeltaY: endDY,
        startCycle,
        endCycle,
        direction,
    };
}
