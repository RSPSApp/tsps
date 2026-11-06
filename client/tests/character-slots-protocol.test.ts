import assert from "node:assert/strict";

import {
    decodeClientPacket,
    encodeCharacterList,
    encodeCharacterResult,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { clientEncoder } from "../network/packet/ClientBinaryEncoder";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { LOGIN_FLAG_CHARACTER_SELECT } from "../network/serverConnection/constants";

const zezima = { name: "Zezima", combatLevel: 126, totalLevel: 2277, lastPlayedAt: 1762300000000, primary: true, hasSave: true };
const alt = { name: "Alt", combatLevel: 3, totalLevel: 40, lastPlayedAt: 0, primary: false, hasSave: false };

const list = decodeServerPacket(new Uint8Array(encodeCharacterList(3, 1, [zezima, alt]))) as any;
assert.equal(list.type, "character_list");
assert.deepEqual(list.payload, { maxCharacters: 3, defaultIndex: 1, characters: [zezima, alt] });

const result = decodeServerPacket(new Uint8Array(encodeCharacterResult(false, 3, "Slot limit reached."))) as any;
assert.deepEqual(result, { type: "character_result", payload: { ok: false, code: 3, message: "Slot limit reached." } });

assert.deepEqual(decodeClientPacket(Buffer.from(clientEncoder.encodeCharacterSelect("Alt"))), { type: "character_select", name: "Alt" });
assert.deepEqual(decodeClientPacket(Buffer.from(clientEncoder.encodeCharacterCreate("Alt"))), { type: "character_create", name: "Alt" });
assert.deepEqual(decodeClientPacket(Buffer.from(clientEncoder.encodeCharacterDelete("Alt", "alt"))), { type: "character_delete", name: "Alt", confirmName: "alt" });
assert.equal(LOGIN_FLAG_CHARACTER_SELECT, 4);

console.log("character-slots-protocol ok");
