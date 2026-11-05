export interface StatusTimerState {
    active: boolean;
    endsAt: number | null;
    type: number;
}

/** Countdown state shared by the Timers plugin's poison, freeze and potion timers. */
export class StatusTimer {
    private state: StatusTimerState = { active: false, endsAt: null, type: 0 };

    getState(): StatusTimerState {
        return this.state;
    }

    sync(seconds: number, type: number, now = Date.now()): void {
        if (seconds === 0) {
            if (this.state.active) this.state = { active: false, endsAt: null, type: 0 };
            return;
        }
        if (seconds < 0) {
            if (!this.state.active || this.state.endsAt !== null || this.state.type !== type) {
                this.state = { active: true, endsAt: null, type };
            }
            return;
        }
        const nextEndsAt = now + seconds * 1000;
        const shouldRestart =
            !this.state.active ||
            this.state.type !== type ||
            this.getRemainingSeconds(now) < seconds - 1;
        const endsAt = shouldRestart
            ? nextEndsAt
            : Math.min(this.state.endsAt ?? nextEndsAt, nextEndsAt);
        if (shouldRestart || this.state.endsAt !== endsAt)
            this.state = { active: true, endsAt, type };
    }

    getRemainingSeconds(now = Date.now()): number {
        return this.state.endsAt === null
            ? 0
            : Math.max(0, Math.ceil((this.state.endsAt - now) / 1000));
    }
}
