import { strict as assert } from "node:assert";

import { createTypedArrayFromCode } from "../rs/cs2/Cs2ArrayObject";
import { sendIfTriggerOpLocal } from "../network/serverConnection/outgoing/widgets";
import { state } from "../network/serverConnection/state";
import { getPacketWriter } from "../network/packet/PacketWriter";

// The pact tree's Apply Changes (script 9383) passes its selection as one int array ("*") of node
// numbers: if_triggeroplocal(crc, talent_tree:data_layer, -1, array). Live sends the array's
// length as a plain varint, then each node zigzag-encoded (recorded: nodes 44 and 47 as
// [2, 88, 94], node 63 as [1, 126]). Sent unsigned, node 63 arrived as 63 and the server refused it.
const writer = getPacketWriter() as any;
const sent: number[][] = [];
const original = writer.addNode;
writer.addNode = (pkt: any) => sent.push(Array.from(pkt.packetBuffer.data.subarray(0, pkt.packetBuffer.offset)));
(state as any).socket = { readyState: 1 };
const send = (...nodes: number[]): number[] => {
    const selection = createTypedArrayFromCode(105, 0, nodes.length);
    for (const node of nodes) selection.push(node);
    sendIfTriggerOpLocal((647 << 16) | 11, -1, -1, -965477757, [selection]);
    return sent[sent.length - 1];
};
try {
    // The argument block ends the packet.
    assert.deepEqual(send(44, 47).slice(-3), [2, 88, 94], "nodes 44 and 47: the length, then each zigzag-encoded");
    assert.deepEqual(send(63).slice(-2), [1, 126], "node 63: 126, as RuneLite sends it");
    assert.deepEqual(send(106).slice(-3), [1, 0xd4, 0x01], "node 106: 212 over two bytes (recorded [1, -44, 1])");
    assert.deepEqual(send(0).slice(-2), [1, 0], "the central pact: 0 either way");
} finally {
    writer.addNode = original;
    (state as any).socket = null;
}
console.log("if-triggeroplocal-array: ok");
