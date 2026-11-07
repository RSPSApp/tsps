import assert from "node:assert/strict";

import {
    decodeClientPacket,
    encodeCharacterList,
    encodeCharacterResult,
    encodeWelcome,
    encodePluginMessage,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { clientEncoder } from "../network/packet/ClientBinaryEncoder";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { state } from "../network/serverConnection/state";
import { send } from "../network/serverConnection/connection/send";
import { handleAuthTickMessage } from "../network/serverConnection/handlers/authTick";
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

// Initial login and reconnect share the sender, which negotiates against this connection's welcome.
(globalThis as any).WebSocket = { OPEN: 1 };
const sent: Uint8Array[] = [];
state.socket = { readyState: 1, send: (bytes: Uint8Array) => sent.push(bytes) } as any;
const welcome = decodeServerPacket(new Uint8Array(encodeWelcome(600, 1234))) as any;
assert.equal(encodeWelcome(600, 1234).toString("hex"), "0000000258000004d2", "welcome stays byte-for-byte unchanged");
for (const enabled of [false, true]) {
    state.lastWelcome = undefined;
    state.characterSlotsEnabled = false;
    state.loginOnWelcome = null;
    sent.length = 0;
    send({ type: "login", payload: { username: "Solo", password: "pw", revision: 241, flags: 1 | LOGIN_FLAG_CHARACTER_SELECT } });
    assert.equal(sent.length, 0, "login waits for the existing welcome, not a timeout");
    if (enabled) {
        const capability = decodeServerPacket(new Uint8Array(encodePluginMessage("characters:slots", { maxPerAccount: 6 }))) as any;
        assert.equal(handleAuthTickMessage(capability), true);
    }
    handleAuthTickMessage(welcome);
    assert.equal(sent.length, 1);
    const expectedFlags = 1 | (enabled ? LOGIN_FLAG_CHARACTER_SELECT : 0);
    assert.deepEqual(Buffer.from(sent[0]), Buffer.from(clientEncoder.encodeLogin("Solo", "pw", 241, expectedFlags)));
    assert.equal(state.sessionLoginFlags, expectedFlags, "the handshake/reconnect uses the actual negotiated flags");
    if (!enabled) {
        handleAuthTickMessage({ type: "plugin_message", payload: { channel: "characters:slots", data: { maxPerAccount: 6 } } });
        assert.equal(state.characterSlotsEnabled, false, "a late announcement cannot enable the feature");
    }
}
console.log("character-slots-protocol ok");
