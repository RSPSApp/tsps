import assert from "node:assert/strict";
import { assertDesktopWorldCompatible, desktopClientManifestUrl } from "../desktop";

async function main() {
    const target = { address: "world.example/game", secure: true };
    let required: unknown = "a".repeat(64);
    const requested: string[] = [];
    (globalThis as any).window = {};
    globalThis.fetch = async input => {
        const url = String(input);
        requested.push(url);
        if (url === "/client-release.json") return Response.json({ clientVersion: "a".repeat(64) });
        assert.equal(url, "https://world.example/api/world-info");
        return Response.json({ clientVersion: required });
    };
    await assertDesktopWorldCompatible(target);
    assert.equal(requested.length, 0, "browser logins are unchanged");
    window.__RSPS_DESKTOP_PROFILE__ = { ...target, name: "Example", maxPlayers: 2047 };
    await assertDesktopWorldCompatible(target);
    assert.equal(await desktopClientManifestUrl(target), `https://github.com/RSPSApp/tsps/releases/download/client-${required}/manifest.json`);

    required = "b".repeat(64);
    await assert.rejects(assertDesktopWorldCompatible(target), /different client version/);
    const { sendLogin } = await import("../network/serverConnection/login");
    const { state } = await import("../network/serverConnection/state");
    state.lastUrl = "wss://world.example/game";
    state.webRtcConfig = undefined;
    const { getSelectedWorld } = await import("../network/serverConnection/outgoing/connectionInfo");
    assert.deepEqual(getSelectedWorld(), { address: "world.example", secure: true, transport: "websocket" });
    state.webRtcConfig = { signalUrl: "wss://relay.example", worldId: "test-world", iceServers: [] };
    assert.deepEqual(getSelectedWorld(), {
        address: "world.example", secure: true, transport: "webrtc", ...state.webRtcConfig,
    });
    state.webRtcConfig = undefined;
    let refused = "";
    state.loginResponseListeners.add(response => { refused = response.error ?? ""; });
    await sendLogin("test-player", "never-transmit");
    assert.match(refused, /different client version/);
    assert.equal(state.sessionPassword, null, "an incompatible world never receives or stores login credentials");

    required = undefined;
    await assert.rejects(assertDesktopWorldCompatible(target), /does not advertise/);
    required = "../../other-repository";
    await assert.rejects(desktopClientManifestUrl(target), /does not advertise/);

    const { default: WebSocket } = await import("ws");
    (globalThis as any).WebSocket = WebSocket;
    const server = new WebSocket.Server({ host: "127.0.0.1", port: 0 });
    await new Promise<void>(resolve => server.once("listening", resolve));
    const frames: unknown[] = [];
    server.on("connection", socket => socket.on("message", bytes => frames.push(bytes)));
    globalThis.fetch = async () => Response.json({ clientVersion: "b".repeat(64) });
    state.lastUrl = `ws://127.0.0.1:${(server.address() as any).port}`;
    state.isReconnecting = true;
    state.sessionUsername = "resume-player";
    state.sessionPassword = "never-resume";
    state.hasLoggedIn = true;
    refused = "";
    try {
        const { initServerConnection } = await import("../network/serverConnection/connection/init");
        initServerConnection(state.lastUrl);
        for (let i = 0; i < 100 && !refused; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.match(refused, /different client version/);
        assert.equal(state.sessionPassword, null);
        assert.equal(frames.length, 1, "only hello is sent: auto-reconnect cannot leak a login after the world updates");
    } finally {
        state.socket?.close();
        server.close();
    }

    globalThis.fetch = async () => { throw new Error("World offline"); };
    await assert.rejects(assertDesktopWorldCompatible(target), /World offline/);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
