import { CLIENT_TICK_MS } from "./constants";
import { state } from "./state";

/** OSRS's reboottimer uses 20ms client cycles; the wire countdown uses centiseconds. */
export function getRebootTimer(): number {
    const update = state.lastSystemUpdate;
    if (!update) return 0;
    const elapsedMs = Math.max(0, Date.now() - update.receivedAtMs);
    return Math.max(0, Math.floor((update.remainingCentis * 10 - elapsedMs) / CLIENT_TICK_MS));
}

export function subscribeTick(cb: (tick: number, time: number) => void): () => void {
    state.tickListeners.add(cb);
    return () => state.tickListeners.delete(cb);
}

export function getCurrentTick(): number {
    return state.currentTick;
}

export function setClientCycleProvider(provider?: () => number): void {
    state.clientCycleProvider = provider;
}

export function getClientCycle(): number {
    return Math.floor(getClientCycleFloat());
}

export function getClientCycleFloat(): number {
    if (state.clientCycleProvider) {
        try {
            const value = state.clientCycleProvider();
            if (Number.isFinite(value)) {
                // Never return 0. CS2 scripts use varcint vars that default to 0
                // for dedup checks (e.g., rebuildchatbox checks `if (%varcint1112 = clientclock)`).
                // If clientclock returns 0 and varcint1112 defaults to 0, the script returns early.
                return Math.max(1, value as number);
            }
        } catch {
            // Provider errors should not break networking; fall back below.
        }
    }

    const perf = (globalThis as any)?.performance;
    const now =
        perf && typeof perf.now === "function" ? (perf.now.call(perf) as number) : Date.now();
    if (state.clientCycleFallbackStartMs === 0) {
        state.clientCycleFallbackStartMs = now;
        const cyclesPerTick = Math.max(1, Math.round((state.serverTickMs || 600) / CLIENT_TICK_MS));
        // Start at 1, not 0, to avoid dedup collisions with default varcint values
        state.clientCycleFallbackBaseCycle = Math.max(1, (state.currentTick | 0) * cyclesPerTick);
    }
    const elapsedMs = Math.max(0, now - state.clientCycleFallbackStartMs);
    // Never return 0 to avoid dedup collisions with default varcint values
    return Math.max(1, state.clientCycleFallbackBaseCycle + elapsedMs / CLIENT_TICK_MS);
}

export function getServerTickPhaseNow(): { tick: number; phase: number; tickMs: number } {
    const now = ((performance as any)?.now?.() as number) || Date.now();
    let phase = 0;
    if (state.serverTickMs > 0) {
        if (state.lastTickServerTimeMs > 0) {
            const serverNow = now - state.serverClockOffsetMs;
            const msSinceTick = Math.max(0, serverNow - state.lastTickServerTimeMs);
            phase = msSinceTick / state.serverTickMs;
        } else if (state.lastTickLocalRecvMs > 0) {
            // Fallback: use local time since last tick receive
            const msSinceTick = Math.max(0, now - state.lastTickLocalRecvMs);
            phase = msSinceTick / state.serverTickMs;
        } else {
            phase = 0;
        }
    }
    if (!(phase >= 0 && phase <= 1)) phase = Math.max(0, Math.min(1, phase));
    return { tick: state.currentTick, phase, tickMs: state.serverTickMs };
}
