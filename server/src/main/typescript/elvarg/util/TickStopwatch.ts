import { GameConstants } from "../game/GameConstants";
import { lazyRequire } from "./LazyRequire";

/** Read lazily: World imports Player, which owns the stopwatches, so a top-level import would cycle. */
const getWorld = lazyRequire(() => (require("../game/World") as typeof import("../game/World")).World);

function currentCycle(): number {
    return getWorld().getProcessCycle();
}

/**
 * A stopwatch measured in game ticks, for gameplay delays that must match the main loop
 * rather than wall-clock time. A never-started stopwatch reports every delay as elapsed.
 */
export class TickStopwatch {
    private tick: number | null = null;

    public reset(tick?: number): TickStopwatch {
        this.tick = tick ? tick : currentCycle();
        return this;
    }

    public elapsed(): number {
        if (this.tick === null) {
            return Infinity;
        }
        return (currentCycle() - this.tick) * GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;
    }

    public elapsedTime(time: number): boolean {
        return this.elapsed() >= time;
    }

    public hasElapsed(time: number): boolean {
        return this.elapsed() >= time;
    }
}
