import { strict as assert } from "node:assert";

import { createTypedArrayFromCode } from "../rs/cs2/Cs2ArrayObject";
import { sendIfTriggerOpLocal } from "../network/serverConnection/outgoing/widgets";
import { state } from "../network/serverConnection/state";
import { getPacketWriter } from "../network/packet/PacketWriter";

// The pact tree's Apply Changes (script 9383) passes its selection as one int array ("*"):
// if_triggeroplocal(crc, talent_tree:data_layer, -1, array). Live sends the array's length, then
// each element (recorded [2, 88, 94]); dropping it left the server an empty payload.
const writer = getPacketWriter() as any;
const sent: number[][] = [];
const original = writer.addNode;
writer.addNode = (pkt: any) => sent.push(Array.from(pkt.packetBuffer.data.subarray(0, pkt.packetBuffer.offset)));
(state as any).socket = { readyState: 1 };
try {
    const selection = createTypedArrayFromCode(105, 0, 2);
    selection.push(88);
    selection.push(94);
    sendIfTriggerOpLocal((647 << 16) | 11, -1, -1, -965477757, [selection]);
    assert.equal(sent.length, 1);
    const bytes = sent[0];
    // The argument block ends the packet: the length 2 and the two components, zigzag varints.
    const tail = bytes.slice(bytes.length - 5);
    assert.deepEqual(tail, [4, 0xb0, 0x01, 0xbc, 0x01], "2, 88, 94 as zigzag varints");
} finally {
    writer.addNode = original;
    (state as any).socket = null;
}
console.log("if-triggeroplocal-array: ok");
