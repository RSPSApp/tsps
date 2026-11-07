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

import { CharactersPlugin } from "../game/plugins/characters/CharactersPlugin";
import { PluginInjector, CLIENT_TOKEN } from "../runelite/client/plugins/PluginInjector";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { LoginState } from "../game/login/LoginState";
import { GameState } from "../game/login/GameState";

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

async function checkPluginProtocol(): Promise<void> {
    (globalThis as any).WebSocket = { OPEN: 1 };
    const sent: Uint8Array[] = [];
    state.socket = { readyState: 1, send: (bytes: Uint8Array) => sent.push(bytes) } as any;
    const client = { loginState: new LoginState(), gameState: GameState.CONNECTING, updateGameState(value: GameState) { this.gameState = value; } };
    const plugin = new PluginInjector(new ConfigManager(undefined)).provide(CLIENT_TOKEN, client).runWith(() => new CharactersPlugin());
    assert.equal(CharactersPlugin.descriptor.hidden, true, "the existing plugin-list filter hides Characters");
    await plugin.start();
    assert.equal(state.loginExtension, plugin);
    const welcome = decodeServerPacket(new Uint8Array(encodeWelcome(600, 1234))) as any;
    assert.equal(encodeWelcome(600, 1234).toString("hex"), "0000000258000004d2");
    for (const enabled of [false, true]) {
        state.lastWelcome = undefined;
        plugin.resetConnection();
        plugin.loginAttempt();
        state.loginOnWelcome = null;
        sent.length = 0;
        send({ type: "login", payload: { username: "Solo", password: "pw", revision: 241, flags: 1 } });
        assert.equal(sent.length, 0, "login waits for welcome, not a timeout");
        if (enabled) {
            const capability = decodeServerPacket(new Uint8Array(encodePluginMessage("characters:slots", { maxPerAccount: 6 }))) as any;
            assert.equal(handleAuthTickMessage(capability), true);
        }
        handleAuthTickMessage(welcome);
        const flags = 1 | (enabled ? LOGIN_FLAG_CHARACTER_SELECT : 0);
        assert.equal(sent.length, 1);
        assert.deepEqual(Buffer.from(sent[0]), Buffer.from(clientEncoder.encodeLogin("Solo", "pw", 241, flags)));
        assert.equal(state.sessionLoginFlags, flags);
        if (!enabled) {
            handleAuthTickMessage({ type: "plugin_message", payload: { channel: "characters:slots", data: { maxPerAccount: 6 } } });
            assert.equal(plugin.loginFlags(0), 0, "late announcements cannot enable selection");
            let handshakes = 0;
            plugin.beforeLoginHandshake(() => handshakes++);
            assert.equal(handshakes, 1, "an off server handshakes immediately");
        }
    }
    let fallback = 0;
    plugin.beforeLoginHandshake(() => fallback++);
    handleAuthTickMessage({ type: "character_list", payload: { maxCharacters: 6, defaultIndex: 0, characters: [{ ...zezima, hasSave: false }] } });
    assert.equal(fallback, 0);
    assert.equal(client.loginState.extension, undefined, "a new primary skips the picker");
    assert.deepEqual(decodeClientPacket(Buffer.from(sent.at(-1)!)), { type: "character_select", name: zezima.name });
    handleAuthTickMessage({ type: "character_result", payload: { ok: true, code: 0, message: "" } });
    assert.equal(decodeClientPacket(Buffer.from(sent.at(-1)!)).type, "handshake");

    plugin.loginAttempt();
    plugin.beforeLoginHandshake(() => fallback++);
    handleAuthTickMessage({ type: "character_list", payload: { maxCharacters: 6, defaultIndex: 1, characters: [zezima, alt] } });
    assert.equal(client.loginState.extension, plugin);
    assert.equal(plugin.picker.selectedCharacter, 1);
    plugin.submit();
    assert.deepEqual(decodeClientPacket(Buffer.from(sent.at(-1)!)), { type: "character_select", name: "Alt" });
    // A plugin field reaches both keyboard and mobile input without extending LoginState.
    plugin.picker.pickerBusy = false;
    const host = { loginBoxX: 202, contentScale: 1, layoutConfig: { isTouch: false, minTouchTarget: 0 } } as any;
    plugin.click(host, 300, 253);
    const field = client.loginState.extension?.textInput?.();
    assert.ok(field);
    field.setValue("Name!with-more-than-twelve");
    assert.equal(plugin.picker.pickerInput, "Namewith-mor");
    plugin.key("Backspace", "");
    assert.equal(plugin.picker.pickerInput, "Namewith-mo");
    plugin.click(host, 462, 322);
    assert.equal(plugin.textInput(), undefined);

    client.gameState = GameState.LOGGED_IN;
    plugin.onGameStateChanged(null as any);
    assert.equal(client.loginState.extension, undefined);
    plugin.resetConnection();
    assert.equal(plugin.loginFlags(0), 0, "capability never leaks to the next server");
    // Reconnect reselects the played alt, even if the server defaults to the primary.
    client.gameState = GameState.CONNECTION_LOST;
    state.sessionLoginFlags = LOGIN_FLAG_CHARACTER_SELECT;
    plugin.beforeLoginHandshake(() => fallback++);
    handleAuthTickMessage({ type: "character_list", payload: { maxCharacters: 6, defaultIndex: 0, characters: [zezima, alt] } });
    assert.deepEqual(decodeClientPacket(Buffer.from(sent.at(-1)!)), { type: "character_select", name: "Alt" });
    assert.equal(client.loginState.extension, undefined);
    handleAuthTickMessage({ type: "character_result", payload: { ok: true, code: 0, message: "" } });
    assert.equal(decodeClientPacket(Buffer.from(sent.at(-1)!)).type, "handshake");

    // A drop while choosing reopens the screen without silently entering a character.
    client.gameState = GameState.CONNECTING;
    plugin.loginAttempt();
    plugin.beforeLoginHandshake(() => fallback++);
    handleAuthTickMessage({ type: "character_list", payload: { maxCharacters: 6, defaultIndex: 0, characters: [zezima, alt] } });
    client.gameState = GameState.CONNECTION_LOST;
    plugin.resetConnection();
    plugin.beforeLoginHandshake(() => fallback++);
    const beforeReconnect = sent.length;
    handleAuthTickMessage({ type: "character_list", payload: { maxCharacters: 6, defaultIndex: 0, characters: [zezima, alt] } });
    assert.equal(sent.length, beforeReconnect);
    assert.equal(client.loginState.extension, plugin);
    assert.equal(client.gameState, GameState.CONNECTING);
    await plugin.stop();
    assert.equal(state.loginExtension, undefined, "shutdown removes all protocol behavior");
}
void checkPluginProtocol().then(() => console.log("character-slots-protocol ok"));
