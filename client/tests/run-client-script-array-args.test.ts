import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeRunClientScript } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { Cs2ArrayObject } from "../rs/cs2/Cs2ArrayObject";

// RUNCLIENTSCRIPT carries the cache's array arguments: rev 242's killcounts (script 9525) takes
// the Boss Kill Log's names as a stringarray and its kills and streaks as intarrays, which reach
// the VM as array objects for the object stack.
const decoded = decodeServerPacket(new Uint8Array(encodeRunClientScript(9525, [
    ["Abyssal Sire", "Vardorvis (Awakened)"], [1974, 3], [457, -1], "Boss Kill Log", 1,
]))) as any;
assert.equal(decoded.type, "runClientScript");
assert.equal(decoded.payload.scriptId, 9525);
const [names, kills, streaks, title, canReset] = decoded.payload.args;
assert.ok(names instanceof Cs2ArrayObject && kills instanceof Cs2ArrayObject && streaks instanceof Cs2ArrayObject);
assert.equal(names.valueType, "object");
assert.deepEqual([names.getObject(0), names.getObject(1)], ["Abyssal Sire", "Vardorvis (Awakened)"]);
assert.equal(kills.valueType, "int");
assert.deepEqual([kills.length, kills.getInt(0), kills.getInt(1)], [2, 1974, 3]);
assert.deepEqual([streaks.getInt(0), streaks.getInt(1)], [457, -1], "negative ints survive");
assert.equal(title, "Boss Kill Log");
assert.equal(canReset, 1);

// Plain arguments decode as before.
const plain = decodeServerPacket(new Uint8Array(encodeRunClientScript(1408, ["a", 5]))) as any;
assert.deepEqual(plain.payload.args, ["a", 5]);

console.log("run client script array args: ok");
