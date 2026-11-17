import assert from "node:assert/strict";
import { state } from "../network/serverConnection/state";
import { setServerUrl } from "../network/serverConnection/outgoing/connectionInfo";
import { send } from "../network/serverConnection/connection/send";
import { handleAuthTickMessage } from "../network/serverConnection/handlers/authTick";
import { resetProtocolCompatibility } from "../network/serverConnection/protocolCompatibility";
import { decodeBatchedServerPackets } from "../network/packet/ServerBinaryDecoder";
import { encodePluginMessage, encodeWelcome, decodeClientPacket } from "../../server/dist/net/protocol/ClientProtocol";

(globalThis as any).WebSocket = { OPEN: 1, CONNECTING: 0 };

async function main(): Promise<void> {
    let staleRuns = 0;
    state.lastUrl = "ws://old.example";
    state.webRtcConfig = undefined;
    state.socket = { close() {}, readyState: 1 } as any;
    state.sessionUsername = "OldAccount";
    state.sessionPassword = "old-token";
    state.isReconnecting = true;
    state.reconnectTimer = setTimeout(() => staleRuns++, 10);
    state.loginConnectRetryTimer = setTimeout(() => staleRuns++, 10);
    const oldAttempt = state.loginConnectAttemptId;
    setServerUrl("ws://new.example", null);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(staleRuns, 0, "world switch cancels old connect/reconnect callbacks");
    assert.equal(state.socket, null);
    assert.equal(state.sessionUsername, null);
    assert.equal(state.sessionPassword, null);
    assert.equal(state.isReconnecting, false);
    assert.ok(state.loginConnectAttemptId > oldAttempt);

    // The hosted transport exposes the same GameSocket boundary. Exercise the
    // real binary decoder, auth owner and encoder without a browser ICE mock.
    for (const version of [2, 1, undefined]) {
        resetProtocolCompatibility();
        state.lastWelcome = undefined;
        state.loginOnWelcome = null;
        const bytes: Uint8Array[] = [];
        let closed = 0;
        state.socket = { readyState: 1, send(data: Uint8Array) { bytes.push(data); }, close(code: number) { closed = code; } } as any;
        send({ type: "login", payload: { username: "HostedTest", password: "token", flags: 1 } });
        assert.equal(bytes.length, 0);
        const packets = version === undefined ? [] : [encodePluginMessage("protocol:version", { version })];
        packets.push(encodeWelcome(600, Date.now()));
        for (const message of decodeBatchedServerPackets(Buffer.concat(packets)).messages) handleAuthTickMessage(message);
        assert.equal(bytes.length, version === 2 ? 0 : 1);
        if (version === 2) assert.equal(closed, 4003);
        else assert.equal(decodeClientPacket(Buffer.from(bytes[0])).type, "login");
    }
    state.socket = null;
    console.log("protocol world-switch lifetime and hosted GameSocket gate: passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
