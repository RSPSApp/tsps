import { GameConstants } from './GameConstants';
import { World } from '../game/World';
import { TaskManager } from './task/TaskManager';
import { ServerPerf } from '../util/ServerPerf';
import { FreezeDiagnostics } from '../util/FreezeDiagnostics';
import { BotRuntimeTelemetry } from '../util/BotRuntimeTelemetry';


/**
 * The engine which processes the game.
 *
 * @author Professor Oak
 */
/**
 * The engine's clock: monotonic, so it can't jump. The wall clock can (WSL2 resyncs it in
 * seconds-long steps), which threw the tick schedule and logged lag that never happened.
 */
const monotonicNow = (): number => performance.now();

/** A monotonic reading as a wall-clock date, for logs. */
const asDate = (monotonicMs: number): string => new Date(performance.timeOrigin + monotonicMs).toISOString();

export class GameEngine  {
    private scheduler: NodeJS.Timeout | null = null;
    private eventLoopMonitor: NodeJS.Timeout | null = null;
    private tickInProgress = false;
    private nextExpectedTickAt = 0;
    private nextEventLoopProbeAt = 0;
    private tickNumber = 0;
    private lastLagLogAt = 0;
    private lastOverrunLogAt = 0;
    private lastOverlapLogAt = 0;
    private lastLagDiagnosticAt = 0;
    private lastFreezeDiagnosticAt = 0;
    private readonly tickRateMs = GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;
    private readonly lagLogThresholdMs = Math.max(450, Math.floor(this.tickRateMs * 0.75));
    private readonly lagDiagnosticThresholdMs = Math.max(450, Math.floor(this.tickRateMs * 0.75));
    private readonly overrunLogThresholdMs = this.tickRateMs;
    private readonly lagLogCooldownMs = 1000;
    private readonly lagWarnCooldownMs = 5000;
    private readonly lagDiagnosticCooldownMs = 5000;
    private readonly freezeDiagnosticCooldownMs = 3000;
    private readonly severeLagThresholdMs = Math.max(1200, this.tickRateMs * 2);
    private readonly severeOverrunThresholdMs = Math.max(1200, this.tickRateMs * 2);
    private readonly eventLoopProbeIntervalMs = 1000;
    private readonly eventLoopStallThresholdMs = Math.max(1500, this.tickRateMs * 2);
    
    constructor() {
        // ...
    }
    
    public init() {
        const now = monotonicNow();
        this.nextExpectedTickAt = now + this.tickRateMs;
        this.startEventLoopProbe(now);
        this.scheduleNextRun(this.tickRateMs);
    }

    private scheduleNextRun(delayMs: number): void {
        if (this.scheduler) {
            clearTimeout(this.scheduler);
        }
        const safeDelayMs = Math.max(0, Math.floor(delayMs));
        this.scheduler = setTimeout(() => {
            void this.run();
        }, safeDelayMs);
        this.scheduler.unref?.();
    }
    
    public async run() {
        const tickStartedAt = monotonicNow();
        this.tickNumber++;

        if (this.tickInProgress) {
            this.logOverlap(tickStartedAt);
            return;
        }

        const driftMs = this.logTickLag(tickStartedAt);
        ServerPerf.beginTick(
            this.tickNumber,
            driftMs,
            World.getPlayers().sizeReturn(),
            World.getNpcs().sizeReturn(),
            TaskManager.getTaskAmount()
        );
        this.tickInProgress = true;

        try {
            await World.process();
        } catch (e) {
            console.log(e);
            World.savePlayers("tick-error");
        } finally {
            const tickEndedAt = monotonicNow();
            const tickDurationMs = Math.round(tickEndedAt - tickStartedAt);
            ServerPerf.endTick(
                tickDurationMs,
                World.getPlayers().sizeReturn(),
                World.getNpcs().sizeReturn(),
                TaskManager.getTaskAmount()
            );
            this.logTickOverrun(tickDurationMs, tickEndedAt);
            this.tickInProgress = false;
            this.scheduleNextRun(this.nextExpectedTickAt - tickEndedAt);
        }
    }

    private startEventLoopProbe(nowMs: number): void {
        this.nextEventLoopProbeAt = nowMs + this.eventLoopProbeIntervalMs;
        if (this.eventLoopMonitor) {
            clearInterval(this.eventLoopMonitor);
        }
        this.eventLoopMonitor = setInterval(() => {
            this.probeEventLoopDelay();
        }, this.eventLoopProbeIntervalMs);
        this.eventLoopMonitor.unref?.();
    }

    private probeEventLoopDelay(): void {
        const nowMs = monotonicNow();
        if (this.nextEventLoopProbeAt <= 0) {
            this.nextEventLoopProbeAt = nowMs + this.eventLoopProbeIntervalMs;
            return;
        }

        const stallMs = Math.round(nowMs - this.nextEventLoopProbeAt);
        this.nextEventLoopProbeAt += this.eventLoopProbeIntervalMs;
        // Fallen a whole probe behind (a stall): start over from now. Catching up only past two
        // probes left a 1.5-2s stall measured against the old schedule on every later probe, so
        // one stall was logged every few seconds, creeping up, for minutes.
        if (nowMs >= this.nextEventLoopProbeAt) {
            this.nextEventLoopProbeAt = nowMs + this.eventLoopProbeIntervalMs;
        }

        if (stallMs < this.eventLoopStallThresholdMs) {
            return;
        }
        this.logFreezeDiagnostic(
            "event_loop_stall",
            nowMs,
            {
                stallMs,
                thresholdMs: this.eventLoopStallThresholdMs,
                tick: this.tickNumber,
            }
        );
    }

    private formatTopPhases(): string[] {
        return ServerPerf.getSummary(30).topPhases.slice(0, 6).map((phase) =>
            `${phase.name}:${phase.totalMs.toFixed(1)}|${phase.avgMs.toFixed(3)}|${phase.maxMs.toFixed(3)}`
        );
    }

    private logFreezeDiagnostic(
        event: string,
        nowMs: number,
        details: Record<string, unknown>
    ): void {
        if (nowMs - this.lastFreezeDiagnosticAt < this.freezeDiagnosticCooldownMs) {
            return;
        }
        this.lastFreezeDiagnosticAt = nowMs;

        const summary = ServerPerf.getSummary(30);
        const topPhases = this.formatTopPhases();
        const botTelemetry = BotRuntimeTelemetry.getIntervalSnapshot(8);
        FreezeDiagnostics.log(event, {
            ...details,
            summaryTicks: summary.ticks,
            avgTickMs: Number(summary.avgTickMs.toFixed(3)),
            maxTickMs: Number(summary.maxTickMs.toFixed(3)),
            avgDriftMs: Number(summary.avgDriftMs.toFixed(3)),
            maxDriftMs: Number(summary.maxDriftMs.toFixed(3)),
            lastTick: summary.lastTickNumber,
            players: summary.lastPlayers,
            npcs: summary.lastNpcs,
            tasks: summary.lastTasks,
            topPhases,
            botTelemetry: botTelemetry.totalEvents > 0 ? botTelemetry : undefined,
        });
    }

    private logTickLag(tickStartedAt: number): number {
        // The first tick waits for the plugins' startup work, which isn't game lag: it sets the
        // schedule instead of being measured against it.
        if (this.nextExpectedTickAt <= 0 || this.tickNumber <= 1) {
            this.nextExpectedTickAt = tickStartedAt + this.tickRateMs;
            return 0;
        }

        // Whole milliseconds: the monotonic clock reads fractions.
        const driftMs = Math.round(tickStartedAt - this.nextExpectedTickAt);
        // Move expected schedule forward for the next cycle, even if we lagged.
        this.nextExpectedTickAt += this.tickRateMs;
        if (tickStartedAt > this.nextExpectedTickAt + this.tickRateMs) {
            this.nextExpectedTickAt = tickStartedAt + this.tickRateMs;
        }

        if (driftMs < this.lagLogThresholdMs) {
            return driftMs;
        }

        if (tickStartedAt - this.lastLagLogAt < this.lagWarnCooldownMs) {
            return driftMs;
        }
        this.lastLagLogAt = tickStartedAt;

        console.warn(
            `[engine] tick_start_lag tick=${this.tickNumber} driftMs=${driftMs} ` +
            `expected=${asDate(this.nextExpectedTickAt - this.tickRateMs)} ` +
            `started=${asDate(tickStartedAt)} players=${World.getPlayers().sizeReturn()} ` +
            `npcs=${World.getNpcs().sizeReturn()} tasks=${TaskManager.getTaskAmount()}`
        );

        if (
            driftMs >= this.lagDiagnosticThresholdMs &&
            tickStartedAt - this.lastLagDiagnosticAt >= this.lagDiagnosticCooldownMs
        ) {
            this.lastLagDiagnosticAt = tickStartedAt;
            this.logFreezeDiagnostic("tick_start_lag_diagnostic", tickStartedAt, {
                tick: this.tickNumber,
                driftMs,
                thresholdMs: this.lagDiagnosticThresholdMs,
                expectedAt: asDate(this.nextExpectedTickAt - this.tickRateMs),
                startedAt: asDate(tickStartedAt),
            });
        }

        if (driftMs >= this.severeLagThresholdMs) {
            this.logFreezeDiagnostic("tick_start_lag_severe", tickStartedAt, {
                tick: this.tickNumber,
                driftMs,
                thresholdMs: this.severeLagThresholdMs,
                expectedAt: asDate(this.nextExpectedTickAt - this.tickRateMs),
                startedAt: asDate(tickStartedAt),
            });
        }
        return driftMs;
    }

    private logTickOverrun(tickDurationMs: number, nowMs: number): void {
        if (tickDurationMs < this.overrunLogThresholdMs) {
            return;
        }
        if (nowMs - this.lastOverrunLogAt < this.lagLogCooldownMs) {
            return;
        }
        this.lastOverrunLogAt = nowMs;

        console.warn(
            `[engine] tick_overrun tick=${this.tickNumber} durationMs=${tickDurationMs} ` +
            `budgetMs=${this.tickRateMs} players=${World.getPlayers().sizeReturn()} ` +
            `npcs=${World.getNpcs().sizeReturn()} tasks=${TaskManager.getTaskAmount()}`
        );

        if (tickDurationMs >= this.severeOverrunThresholdMs) {
            this.logFreezeDiagnostic("tick_overrun_severe", nowMs, {
                tick: this.tickNumber,
                durationMs: tickDurationMs,
                thresholdMs: this.severeOverrunThresholdMs,
                budgetMs: this.tickRateMs,
            });
        }
    }

    private logOverlap(nowMs: number): void {
        if (nowMs - this.lastOverlapLogAt < this.lagLogCooldownMs) {
            return;
        }
        this.lastOverlapLogAt = nowMs;

        console.warn(
            `[engine] tick_overlap tick=${this.tickNumber} ` +
            `players=${World.getPlayers().sizeReturn()} npcs=${World.getNpcs().sizeReturn()} ` +
            `tasks=${TaskManager.getTaskAmount()}`
        );
        this.logFreezeDiagnostic("tick_overlap", nowMs, {
            tick: this.tickNumber,
            players: World.getPlayers().sizeReturn(),
            npcs: World.getNpcs().sizeReturn(),
            tasks: TaskManager.getTaskAmount(),
        });
    }
}
