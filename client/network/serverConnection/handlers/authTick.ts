import { ClientState } from "../../../game/ClientState";
import { clearHintArrow, setHintArrowNpc, setHintArrowTile } from "../../../game/HintArrow";
import { state } from "../state";

export function handleAuthTickMessage(msg: any): boolean {
    if (msg.type === "welcome") {
        console.log(
            `[ws] welcome tickMs=${msg.payload.tickMs} serverTime=${msg.payload.serverTime}`,
        );
        state.lastWelcome = msg.payload;
        try {
            state.serverTickMs = Math.max(1, (msg.payload.tickMs as number) | 0);
            const now = (performance?.now?.() as number) || Date.now();
            const serverNow = Number(msg.payload.serverTime) || 0;
            if (serverNow > 0) state.serverClockOffsetMs = now - serverNow;
        } catch {}
        for (const cb of state.welcomeListeners) cb(msg.payload);
        return true;
    }
    if (msg.type === "login_response") {
        console.log(`[ws] login_response success=${msg.payload.success}`);
        for (const cb of state.loginResponseListeners) {
            try {
                cb(msg.payload);
            } catch (e) {
                console.warn("[ws] login response listener error:", e);
            }
        }
        return true;
    }
    if (msg.type === "logout_response") {
        console.log(`[ws] logout_response success=${msg.payload.success}`);
        for (const cb of state.logoutResponseListeners) {
            try {
                cb(msg.payload);
            } catch (e) {
                console.warn("[ws] logout response listener error:", e);
            }
        }
        return true;
    }
    if (msg.type === "tick") {
        state.currentTick = msg.payload.tick;
        try {
            const now = (performance?.now?.() as number) || Date.now();
            const serverNow = Number(msg.payload.time) || 0;
            if (serverNow > 0) {
                const off = now - serverNow;
                state.serverClockOffsetMs = state.serverClockOffsetMs * 0.9 + off * 0.1;
                state.lastTickServerTimeMs = serverNow;
                state.lastTickLocalRecvMs = now;
            }
        } catch {}
        for (const cb of state.tickListeners) {
            cb(msg.payload.tick, msg.payload.time);
        }
        return true;
    }
    if (msg.type === "destination") {
        const rawWorldX = Number(msg.payload?.worldX);
        const rawWorldY = Number(msg.payload?.worldY);
        if (!Number.isFinite(rawWorldX) || !Number.isFinite(rawWorldY)) {
            return true;
        }
        const worldX = rawWorldX | 0;
        const worldY = rawWorldY | 0;
        if (worldX === 0 && worldY === 0) {
            ClientState.destinationX = 0;
            ClientState.destinationY = 0;
            ClientState.destinationWorldX = 0;
            ClientState.destinationWorldY = 0;
            return true;
        }
        const localX = (worldX - (ClientState.baseX | 0)) | 0;
        const localY = (worldY - (ClientState.baseY | 0)) | 0;
        ClientState.setDestination(localX, localY);
        ClientState.destinationWorldX = worldX;
        ClientState.destinationWorldY = worldY;
        return true;
    }
    if (msg.type === "hint_arrow") {
        const arrowType = Number(msg.payload?.arrowType) | 0;
        const a = Number(msg.payload?.a) | 0;
        const b = Number(msg.payload?.b) | 0;
        const c = Number(msg.payload?.c) | 0;
        if (arrowType === 1) setHintArrowNpc(a);
        else if (arrowType === 2) setHintArrowTile(a, b, c);
        else clearHintArrow();
        return true;
    }
    return false;
}
