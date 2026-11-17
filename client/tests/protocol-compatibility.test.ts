import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "../../server/node_modules/ws";
(globalThis as any).WebSocket = WebSocket;
import { encodePluginMessage, encodeWelcome, decodeClientPacket } from "../../server/dist/net/protocol/ClientProtocol";
import { initServerConnection } from "../network/serverConnection/connection/init";
import { sendLogin, suppressReconnection, forgetRememberedLogin } from "../network/serverConnection/login";
import { subscribeProtocolNotice, type ProtocolNotice, WELCOME_TIMEOUT_MS } from "../network/serverConnection/protocolCompatibility";
import { clientEncoder } from "../network/packet/ClientBinaryEncoder";
import { state } from "../network/serverConnection/state";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function scenario(announcements: unknown[], expectedLogin: boolean, mode: "normal" | "badbatch" | "decoderthrow" | "badwelcome" | "late" | "cancel" | "cancelopen" | "timeout" | "forget" = "normal"): Promise<void> {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const port = (server.address() as any).port;
    const received: any[] = [];
    let connections = 0;
    let notice: ProtocolNotice;
    const unsubscribe = subscribeProtocolNotice(value => { notice = value; });
    let encodes = 0;
    const originalEncode = clientEncoder.encodeLogin;
    clientEncoder.encodeLogin = function(...args: Parameters<typeof originalEncode>) { encodes++; return originalEncode.apply(this, args); };
    server.on("connection", socket => {
        connections++;
        socket.on("message", bytes => received.push(decodeClientPacket(Buffer.from(bytes as any))));
        if (mode === "timeout") return;
        if (mode === "badwelcome") socket.send(JSON.stringify({type:"welcome",payload:null}));
        if (mode === "decoderthrow") {
            socket.send(Buffer.concat([...announcements.map(data => encodePluginMessage("protocol:version", data)), Buffer.from([6,0,1,123])]));
            setTimeout(() => { if(socket.readyState === WebSocket.OPEN) socket.send(encodeWelcome(600, Date.now())); },30);
            return;
        }
        const packets = announcements.map(data => encodePluginMessage("protocol:version", data));
        if (mode === "badbatch") { socket.send(Buffer.concat([...packets, Buffer.from([255])])); return; }
        if (mode === "late") {
            socket.send(encodeWelcome(600, Date.now()));
            socket.send(encodePluginMessage("protocol:version", { version: 2 }));
            return;
        }
        setTimeout(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            for (const packet of packets) socket.send(packet);
            socket.send(encodeWelcome(600, Date.now()));
        }, mode === "cancel" ? 50 : 0);
    });
    suppressReconnection();
    state.socket = null;
    state.webRtcConfig = null;
    state.autoSendHandshake = false;
    state.lastUrl = `ws://127.0.0.1:${port}`;
    try {
        if (mode === "forget") {
            forgetRememberedLogin("CompatTest", "credential-must-not-leak");
            await wait(100);
            assert.equal(received.some(p => p?.type === "login_forget"), expectedLogin);
            return;
        }
        initServerConnection(state.lastUrl);
        await sendLogin("CompatTest", "credential-must-not-leak", 241, 0);
        if (mode === "cancel") { await wait(20); suppressReconnection(); }
        if (mode === "cancelopen") suppressReconnection();
        if (mode === "timeout") await wait(WELCOME_TIMEOUT_MS + 100);
        for (let i = 0; i < 100 && !received.some(p => p?.type === "login") && state.socket; i++) await wait(10);
        assert.equal(received.some(p => p?.type === "login"), expectedLogin,
            `announcements ${JSON.stringify(announcements)} credential send`);
        assert.equal(encodes, expectedLogin ? 1 : 0, "gate runs before credential serialization");
        if (expectedLogin && announcements.length === 0 && mode !== "late") assert.equal(notice?.kind, "warning");
        if (!expectedLogin) {
            assert.equal(state.reconnectTimer, null, "mismatch cannot schedule automatic reconnect");
            assert.equal(state.loginConnectRetryTimer, null, "mismatch cannot retry login connection");
            assert.equal(connections, 1);
        }
    } finally {
        unsubscribe();
        clientEncoder.encodeLogin = originalEncode;
        suppressReconnection();
        state.socket?.close(1000, "logout");
        for (const socket of server.clients) socket.close();
        await new Promise<void>(resolve => server.close(() => resolve()));
        state.socket = null;
    }
}

async function main() {
    await scenario([{ version: 2 }], false);
    await scenario([{ version: 1 }], true);
    await scenario([], true);
    await scenario([{ version: "2" }], true);
    await scenario([{ version: 0 }], true);
    await scenario([{ version: 1 }, { version: 2 }, { version: 1 }], false);
    await scenario([{ version: 2 }, { version: "invalid" }], false);
    await scenario([{ version: 1 }], true); // a previous mismatch cannot poison another world
    await scenario([{ version: 2 }], false, "badbatch");
    await scenario([{ version: 2 }], false, "decoderthrow");
    await scenario([{ version: 2 }], false, "badwelcome");
    await scenario([], true, "late");
    await scenario([{ version: 1 }], false, "cancel");
    await scenario([{ version: 1 }], false, "cancelopen");
    await scenario([], false, "timeout");
    await scenario([{ version: 2 }], false, "forget");
    await scenario([{ version: 1 }], true, "forget");
    await scenario([], true, "forget");
    console.log("protocol compatibility actual WebSocket send ordering: 18 scenarios passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
