import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { VarManager } from "../rs/config/vartype/VarManager";
import { encodeVarpLong } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// Rev 241 reads the GE offer price from long varp 5753: the server's VARP_LONG reaches the client
// intact, past 32 bits and negative too, and a change fires the var-transmit callback.
for (const value of [806000n, 3_000_000_000n, -5n]) {
    const decoded = decodeServerPacket(new Uint8Array(encodeVarpLong(5753, value))) as any;
    assert.deepEqual(decoded, { type: "varp_long", payload: { varpId: 5753, value } });
}

const vars = new VarManager({ load: () => undefined } as any);
const changed: number[] = [];
vars.onVarpChange = (id: number) => changed.push(id);
assert.equal(vars.setVarpLong(5753, 806000n), true);
assert.equal(vars.setVarpLong(5753, 806000n), false, "no change, no callback");
assert.deepEqual([vars.varpLongs.get(5753), changed], [806000n, [5753]]);

vars.resetForLogout();
assert.equal(vars.varpLongs.has(5753), false, "logout clears long varps, as it does varps");

console.log("varp long packet: ok");
