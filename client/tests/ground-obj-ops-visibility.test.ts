import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { handleInboundWorld } from "../network/serverConnection/handlers/inboundWorld";
import { groundObjExamineVisibleWhileHidden, groundObjOpsVisibility } from "../game/GroundObjOpsVisibility";
import { encodeHideObjOps } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// tsps wire (the same encoder PacketSender.sendHideObjOps uses) -> web decoder -> client state
// -> the predicate the ground-item menu uses. server/tests/packet-sender.test.cjs covers the sender.
function handle(hidden: boolean): void {
    const decoded = decodeServerPacket(new Uint8Array(encodeHideObjOps(hidden)));
    assert.deepEqual(decoded, { type: "hide_obj_ops", payload: { hidden } });
    assert.equal(handleInboundWorld(decoded), true);
}

groundObjOpsVisibility.clear();
handle(true);
assert.equal(groundObjOpsVisibility.hidden, true, "the ground-item menu filter sees the hidden state");
assert.equal(groundObjExamineVisibleWhileHidden(false), true, "Examine stays while ground-item actions are hidden");
assert.equal(groundObjExamineVisibleWhileHidden(true), false, "a selected spell hides ground-item Examine too");

handle(false);
assert.equal(groundObjOpsVisibility.hidden, false, "false restores ground-item actions");

groundObjOpsVisibility.set(true);
groundObjOpsVisibility.clear();
assert.equal(groundObjOpsVisibility.hidden, false, "a full logout reset clears it");

console.log("ground obj ops visibility: ok");
