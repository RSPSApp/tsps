import * as assert from "node:assert/strict";
import { encodeWidgetSetFlagsRange, decodeClientPacket } from "../src/main/typescript/elvarg/net/protocol/ClientProtocol";

// Both clients now use stock 399:7 children, without a custom row packet or translation.
for (const id of [16, 55, 217]) {
    const flags = encodeWidgetSetFlagsRange((399 << 16) | 7, id, id, 0x7e);
    assert.ok(flags.length > 0);
    const packet = Buffer.alloc(10);
    packet[0] = 91;
    packet.writeInt32BE((399 << 16) | 7, 1);
    packet.writeUInt16BE(id, 5);
    packet.writeUInt16BE(0xffff, 7);
    packet[9] = 2;
    const action: any = decodeClientPacket(packet);
    assert.equal(action.slot, id);
    assert.equal(action.widgetId, (399 << 16) | 7);
}
console.info("native quest list protocol smoke passed");
