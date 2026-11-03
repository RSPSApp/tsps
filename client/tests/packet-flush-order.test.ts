import assert from "node:assert/strict";

import { ClientPacketId } from "../common/network/ClientPacketId";
import { createPacket, flushPackets, getPacketWriter, queuePacket } from "../network/packet";

// The live client's PacketWriter queues with addLast() and flushes from first(), so two
// actions clicked inside one frame reach the server in click order. The web client used to
// flush from the end, which reversed a one-tick combo: the granite-maul special arrived
// before the equip that put the maul in the hand.
const writer = getPacketWriter();
const previousSocket = (writer as any).socket;
const sent: Uint8Array[] = [];
writer.setSocket({
    readyState: 1,
    binaryType: "arraybuffer",
    send: (bytes: Uint8Array) => sent.push(bytes.slice()),
} as any);

function button(widgetId: number): void {
    const packet = createPacket(ClientPacketId.IF_BUTTON1);
    packet.packetBuffer.writeInt(widgetId);
    packet.packetBuffer.writeShort(-1);
    packet.packetBuffer.writeShort(-1);
    queuePacket(packet);
}

try {
    button(1111);
    button(2222);
    flushPackets();

    assert.equal(sent.length, 1, "both packets fit one batch");
    const bytes = sent[0];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint8(0), ClientPacketId.IF_BUTTON1);
    assert.equal(view.getInt32(1), 1111, "the first queued packet is sent first");
    assert.equal(view.getUint8(9), ClientPacketId.IF_BUTTON1);
    assert.equal(view.getInt32(10), 2222, "the second follows in queue order");
} finally {
    writer.clearBuffer();
    writer.setSocket(previousSocket ?? null);
}

console.log("packet flush order: ok");
