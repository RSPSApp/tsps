/**
 * The idle state the server pushes, and whoever wants to hear about it.
 *
 * It arrives on the content-data channel under the `idle` source (server plugin
 * `Hud.IdleMode.js`) and is picked out before the gamemode content store sees it: this is state
 * that changes every few ticks, not cache content to merge and keep.
 *
 * Deliberately tiny and framework-free so the inbound packet handler can import it without
 * dragging React in.
 */
export type IdleState = {
    /** Idle Mode is on for this account. */
    idle: boolean;
    /** Auto-resume is switched on (it can still be paused). */
    auto: boolean;
    /** Why auto-resume stopped — "click", "stuck", "out", "retreat", "logout" — or null. */
    paused: string | null;
    /** What the character is doing, already worded by the server, or null for nothing yet. */
    activity: string | null;
    /** XP an hour of the session being played, to the nearest hundred, or null when too short. */
    xpPerHour: number | null;
    points: number;
    /** How far to the next idle point, 0-100. */
    nextPercent: number;
};

type Listener = (state: IdleState | null) => void;

let current: IdleState | null = null;
const listeners = new Set<Listener>();

export function getIdleState(): IdleState | null {
    return current;
}

export function setIdleState(state: IdleState | null): void {
    current = state;
    for (const listener of listeners) {
        try {
            listener(current);
        } catch (error) {
            console.warn("[idle-hud] listener failed", error);
        }
    }
}

export function subscribeIdleState(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** A login screen, a world hop: the state belongs to the account that just left. */
export function clearIdleState(): void {
    if (current !== null) setIdleState(null);
}

/**
 * Reads the `idle` dataset off a content-data payload. Returns true when it handled one, so the
 * packet handler can stop before the content store, which has no schema for this.
 */
export function acceptIdleContentData(payload: { gamemodeId?: string; datasets?: Array<{ key: string; rows: unknown[] }> }): boolean {
    if (payload?.gamemodeId !== "idle") return false;
    const dataset = payload.datasets?.find((entry) => entry.key === "state");
    if (!dataset) return false;
    const row = dataset.rows?.[0] as IdleState | undefined;
    setIdleState(row ?? null);
    return true;
}
