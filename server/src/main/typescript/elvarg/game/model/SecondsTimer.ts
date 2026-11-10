import { Stopwatch } from "../../util/Stopwatch";

export class SecondsTimer {
    private seconds: number;
    private running: boolean;
    private startTime: any;
    private endTime: any;
    private pausedAt: number | null = null;
    private stopwhatch: Stopwatch = new Stopwatch();

    constructor() {
        this.seconds = 0;
        this.running = false;
    }

    start(seconds: number) {
        this.seconds = seconds;

        //Reset and then start the stopwatch.
        this.stopwhatch.reset();
        this.stopwhatch.start();
        this.startTime = performance.now();
        if (this.pausedAt !== null) {
            this.pausedAt = this.startTime;
        }
        this.running = true;
    }

    stop(): void {
        this.seconds = 0;
        this.endTime = performance.now();
        this.running = false;
    }

    isRunning(): boolean {
        return this.running;
    }

    /** Holds this timer, including future starts, until resume is called. */
    pause(): void {
        if (this.pausedAt === null) {
            this.pausedAt = performance.now();
        }
    }

    resume(): void {
        if (this.pausedAt !== null) {
            if (this.running) {
                this.startTime += performance.now() - this.pausedAt;
            }
            this.pausedAt = null;
        }
    }

    secondsRemaining(): number {
        if (this.seconds === 0) {
            return 0;
        }
        let remaining = this.seconds - this.secondsElapsed();
        if (remaining < 0) {
            remaining = 0;
        }
        return remaining;
    }

    /** Milliseconds left, for countdowns kept in ticks (secondsRemaining() counts whole seconds). */
    millisRemaining(): number {
        if (this.seconds === 0) {
            return 0;
        }
        const elapsed = this.running ? (this.pausedAt ?? performance.now()) - this.startTime : 0;
        return Math.max(0, this.seconds * 1000 - elapsed);
    }

    finished(): boolean {
        if (this.secondsRemaining() === 0) {
            this.stop();
            return true;
        }
        return false;
    }

    secondsElapsed(): number {
        if (!this.running) {
            return 0;
        }
        return Math.floor(((this.pausedAt ?? performance.now()) - this.startTime) / 1000);
    }

    toString(): string {
        let builder = "";

        let secondsRemaining = this.secondsRemaining();
        let minutesRemaining = Math.floor(secondsRemaining / 60);
        secondsRemaining -= minutesRemaining * 60;

        if (minutesRemaining > 0) {
            builder += `${minutesRemaining} ${minutesRemaining > 1 ? "minutes" : "minute"} and `;
        }

        builder += `${secondsRemaining} seconds`;

        return builder;
    }

}    
