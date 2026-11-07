import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { handleInboundWorld } from "../network/serverConnection/handlers/inboundWorld";
import { npcExamineVisibleWhileHidden, npcOpsVisibility } from "../game/NpcOpsVisibility";
import { encodeHideNpcOps } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// tsps wire (the same encoder PacketSender.sendHideNpcOps uses) -> web decoder -> client state
// -> the predicate the NPC menu uses. server/tests/packet-sender.test.cjs covers the sender.
function handle(hidden: boolean): void {
    const decoded = decodeServerPacket(new Uint8Array(encodeHideNpcOps(hidden)));
    assert.deepEqual(decoded, { type: "hide_npc_ops", payload: { hidden } });
    assert.equal(handleInboundWorld(decoded), true);
}

npcOpsVisibility.clear();
handle(true);
assert.equal(npcOpsVisibility.hidden, true, "the menu filter sees the hidden state");
assert.equal(npcExamineVisibleWhileHidden(false, false), true, "Examine stays while NPC actions are hidden");
assert.equal(npcExamineVisibleWhileHidden(true, false), false, "a selected spell hides Examine too");
assert.equal(npcExamineVisibleWhileHidden(false, true), false, "a low-priority follower already added Examine");

handle(false);
assert.equal(npcOpsVisibility.hidden, false, "false restores NPC actions");

npcOpsVisibility.set(true);
npcOpsVisibility.clear();
assert.equal(npcOpsVisibility.hidden, false, "a full logout reset clears it");

console.log("npc ops visibility: ok");
