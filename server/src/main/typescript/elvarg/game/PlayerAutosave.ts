import { GameConstants } from "./GameConstants";

/**
 * A bounded window for progress loss when the server dies without running its shutdown handler:
 * a nodemon restart on a dev machine, a `taskkill`, a crash. `Server.gracefulShutdown` persists the
 * online players, but nodemon restarts its child by signalling it and Windows cannot deliver a
 * signal to a Node handler, so that path never runs there (#6874).
 *
 * `PLAYER_AUTOSAVE_SECONDS` sets the window: unset is {@link DEFAULT_SECONDS}, `0` turns the
 * autosave off, anything else is clamped to {@link MIN_SECONDS}..{@link MAX_SECONDS}. The reason
 * recorded on each save is `"autosave"`, the one `PlayerPersistence` documents for this.
 */
export class PlayerAutosave {
    /** One minute: the smallest window that is not noise on a live world, and a dev restart costs at most a minute of testing. */
    public static readonly DEFAULT_SECONDS = 60;
    /** Below this an autosave overlaps the previous one's queue on a populated world. */
    public static readonly MIN_SECONDS = 15;
    /** An hour is the point at which the window stops bounding anything worth keeping. */
    public static readonly MAX_SECONDS = 3600;

    private static lastSaveTick = 0;

    /** The configured window in seconds; `0` means the autosave is off. */
    public static intervalSeconds(env: NodeJS.ProcessEnv = process.env): number {
        const raw = (env.PLAYER_AUTOSAVE_SECONDS ?? "").trim();
        if (raw.length === 0) {
            return PlayerAutosave.DEFAULT_SECONDS;
        }
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed)) {
            return PlayerAutosave.DEFAULT_SECONDS;
        }
        if (parsed <= 0) {
            return 0;
        }
        return Math.min(PlayerAutosave.MAX_SECONDS, Math.max(PlayerAutosave.MIN_SECONDS, parsed));
    }

    /** {@link intervalSeconds} in game ticks; `0` means the autosave is off. */
    public static intervalTicks(env: NodeJS.ProcessEnv = process.env): number {
        const seconds = PlayerAutosave.intervalSeconds(env);
        if (seconds <= 0) {
            return 0;
        }
        const tickMs = GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;
        return Math.max(1, Math.round((seconds * 1000) / tickMs));
    }

    /** Forgets the last save, so the next tick starts a fresh window. */
    public static reset(): void {
        PlayerAutosave.lastSaveTick = 0;
    }

    /**
     * Called once per game tick with that tick's number and the save to run. Saves every online
     * player when the window has elapsed, at most once per window, and never when the window is 0.
     */
    public static tick(
        tickNumber: number,
        save: (reason: string) => void,
        env: NodeJS.ProcessEnv = process.env
    ): boolean {
        const interval = PlayerAutosave.intervalTicks(env);
        if (interval <= 0) {
            return false;
        }
        if (tickNumber - PlayerAutosave.lastSaveTick < interval) {
            return false;
        }
        PlayerAutosave.lastSaveTick = tickNumber;
        save("autosave");
        return true;
    }
}
