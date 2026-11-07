import { LOGIN_FLAG_CHARACTER_SELECT } from "../../../network/serverConnection/constants";

/**
 * How long an accepted login with character select waits for the server's character list. A
 * server with character slots sends it straight after the login response; one without them never
 * does, and gets the handshake as before once this has passed.
 */
export const CHARACTER_LIST_WAIT_MS = 1500;

export interface WaitTimers {
    set(cb: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

const defaultTimers: WaitTimers = {
    set: (cb, ms) => setTimeout(cb, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Holds the handshake after an accepted login until the character list shows it isn't needed. */
export class CharacterListWait {
    private timer: unknown = undefined;

    constructor(private readonly timers: WaitTimers = defaultTimers) {}

    /** Sends the handshake now without the flag, else after the wait unless a list comes first. */
    onLoginAccepted(loginFlags: number, sendHandshake: () => void): void {
        this.cancel();
        if ((loginFlags & LOGIN_FLAG_CHARACTER_SELECT) === 0) {
            sendHandshake();
            return;
        }
        this.timer = this.timers.set(() => {
            this.timer = undefined;
            sendHandshake();
        }, CHARACTER_LIST_WAIT_MS);
    }

    /** The server has character slots: the picker or the reconnect select sends the handshake. */
    onCharacterList(): boolean {
        return this.cancel();
    }

    /** Drops a pending fallback handshake; true when one was waiting. */
    cancel(): boolean {
        if (this.timer === undefined) return false;
        this.timers.clear(this.timer);
        this.timer = undefined;
        return true;
    }
}
