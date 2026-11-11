import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeWidgetSetNpcHead } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// The chatbox head (IF_SETNPCHEAD): the NPC id is unsigned, so custom NPCs (50000-65534, such as
// custom pets' followers) keep their id instead of turning negative and showing no head.
const head = (npcId: number) => (decodeServerPacket(new Uint8Array(encodeWidgetSetNpcHead((231 << 16) | 2, npcId))) as any)?.payload;
assert.deepEqual(head(3105), { action: "set_npc_head", uid: (231 << 16) | 2, npcId: 3105 }, "a cache NPC");
assert.equal(head(54000).npcId, 54000, "a custom NPC past a signed short");
assert.equal(head(65534).npcId, 65534, "the last custom NPC id");
assert.equal(head(-1).npcId, -1, "0xffff still means no head");

console.log("npc head packet tests passed");
