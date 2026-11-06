import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeWidgetSetRotateSpeed } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// IF_SETROTATESPEED as revision 227 sends it in recording 1723: the component uid, then one
// packed int with the y (turntable) speed in the high short and the x speed in the low short.
// The natural history quiz's models all get xspeed=0, yspeed=5 on interface 533.
const uid = (533 << 16) | 8;
const packet = (x: number, y: number) =>
    decodeServerPacket(new Uint8Array(encodeWidgetSetRotateSpeed(uid, x, y))) as any;

assert.equal(
    Buffer.from(encodeWidgetSetRotateSpeed(uid, 0, 5)).toString("hex"),
    "740215000800050000",
    "the packet is opcode 116, then the capture's exact 8-byte payload",
);
assert.deepEqual(packet(0, 5), {
    type: "widget",
    payload: { action: "set_rotate_speed", uid, speedX: 0, speedY: 5 },
});
assert.deepEqual(packet(-7, -1).payload, { action: "set_rotate_speed", uid, speedX: -7, speedY: -1 });
assert.deepEqual(packet(2047, 32767).payload, { action: "set_rotate_speed", uid, speedX: 2047, speedY: 32767 });
assert.deepEqual(packet(-32768, -2048).payload, { action: "set_rotate_speed", uid, speedX: -32768, speedY: -2048 });

console.log("widget set rotate speed packet: ok");
